function taipeiDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function groupExpenseEntriesByDay(entries, personalAmountsByEntryId = new Map()) {
  const days = new Map();
  const sortedEntries = [...entries].sort(
    (left, right) => new Date(right.occurred_at) - new Date(left.occurred_at),
  );

  sortedEntries.forEach((entry) => {
    const key = taipeiDateKey(entry.occurred_at);
    if (!days.has(key)) {
      days.set(key, {
        key,
        occurredAt: entry.occurred_at,
        total: 0,
        cashTotal: 0,
        creditCardTotal: 0,
        entries: [],
      });
    }

    const day = days.get(key);
    day.entries.push(entry);
    day.total += personalAmountsByEntryId.get(entry.id) ?? entry.amount;
    if (entry.payment_method === 'cash') {
      day.cashTotal += entry.amount;
    } else if (entry.payment_method === 'credit_card') {
      day.creditCardTotal += entry.amount;
    }
  });

  return [...days.values()];
}

export function buildExpenseTemplates(entries) {
  const templates = new Map();
  const sortedEntries = [...entries]
    .filter((entry) => !entry.is_fixed)
    .sort((left, right) => new Date(right.occurred_at) - new Date(left.occurred_at));

  sortedEntries.forEach((entry) => {
    const itemName = String(entry.item_name ?? '').trim();
    const itemDetail = String(entry.item_detail ?? '').trim();
    const key = JSON.stringify([
      Number(entry.amount),
      itemName.toLocaleLowerCase('zh-TW'),
      itemDetail.toLocaleLowerCase('zh-TW'),
      entry.category_id,
      entry.payment_method,
    ]);
    if (!templates.has(key)) {
      templates.set(key, {
        key,
        amount: Number(entry.amount),
        itemName,
        itemDetail,
        categoryId: entry.category_id,
        paymentMethod: entry.payment_method,
        usageCount: 0,
        lastUsedAt: entry.occurred_at,
      });
    }
    templates.get(key).usageCount += 1;
  });

  return [...templates.values()].sort((left, right) => (
    right.usageCount - left.usageCount
    || new Date(right.lastUsedAt) - new Date(left.lastUsedAt)
  ));
}

export function findExpenseTemplates(templates, amount, limit = 5) {
  const normalizedAmount = String(amount ?? '').trim();
  const matchingTemplates = normalizedAmount === ''
    ? templates
    : templates.filter((template) => template.amount === Number(normalizedAmount));
  return matchingTemplates.slice(0, limit);
}

export function inferFrequentPaymentMethod(
  itemName,
  templates,
  identifyMerchant = null,
) {
  const normalizedItemName = String(itemName ?? '').trim().toLocaleLowerCase('zh-TW');
  if (!normalizedItemName) return null;

  const currentMerchant = identifyMerchant?.(itemName) ?? null;
  const matchingTemplates = templates.filter((template) => {
    const templateMerchant = identifyMerchant?.(template.itemName) ?? null;
    if (currentMerchant && templateMerchant) {
      return currentMerchant.name === templateMerchant.name;
    }
    return template.itemName.trim().toLocaleLowerCase('zh-TW') === normalizedItemName;
  });
  if (!matchingTemplates.length) return null;

  const methodTotals = matchingTemplates.reduce((totals, template) => {
    totals[template.paymentMethod] = (totals[template.paymentMethod] ?? 0) + template.usageCount;
    return totals;
  }, {});
  const paymentMethods = Object.entries(methodTotals)
    .sort((left, right) => right[1] - left[1]);
  if (!paymentMethods.length || paymentMethods[0][0] === undefined) return null;
  if (paymentMethods.length > 1 && paymentMethods[0][1] === paymentMethods[1][1]) {
    return null;
  }
  return paymentMethods[0][0];
}

export function dailyExpenseTotalTone(total) {
  const amount = Number(total);
  if (amount >= 1000) return 'red';
  if (amount > 350) return 'blue';
  if (amount > 150) return 'green';
  return 'white';
}
