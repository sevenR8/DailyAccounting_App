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

export function groupExpenseEntriesByDay(entries) {
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
    day.total += entry.amount;
    if (entry.payment_method === 'cash') {
      day.cashTotal += entry.amount;
    } else if (entry.payment_method === 'credit_card') {
      day.creditCardTotal += entry.amount;
    }
  });

  return [...days.values()];
}

