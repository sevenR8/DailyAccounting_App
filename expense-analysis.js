const TAIPEI_TIME_ZONE = 'Asia/Taipei';

export const COUNTRY_LIVING_COST_BASELINES = Object.freeze([
  { code: 'TW', name: '台灣', amount: 37_000, sourceLabel: '單身租房族平均花費' },
  { code: 'JP', name: '日本', amount: 38_370, sourceLabel: '單身租房族平均花費' },
  { code: 'KR', name: '韓國', amount: 41_553, sourceLabel: '單身租房族平均花費' },
  { code: 'CN', name: '中國', amount: 19_000, sourceLabel: '單身租房族平均花費' },
  { code: 'US', name: '美國', amount: 128_000, sourceLabel: '單身租房族平均花費' },
]);

export function countryBaselinesFromSettings(storedBaselines) {
  const values = storedBaselines && typeof storedBaselines === 'object' && !Array.isArray(storedBaselines)
    ? storedBaselines
    : {};
  return COUNTRY_LIVING_COST_BASELINES.map((baseline) => {
    const amount = Number(values[baseline.code]);
    return {
      ...baseline,
      amount: Number.isInteger(amount) && amount > 0 ? amount : baseline.amount,
    };
  });
}

export const DEFAULT_MERCHANT_GROUPS = Object.freeze([
  { name: '麥當勞', groupType: 'fast_food', aliases: ['麥當勞'] },
  { name: '肯德基', groupType: 'fast_food', aliases: ['肯德基', 'KFC'] },
  { name: '摩斯', groupType: 'fast_food', aliases: ['摩斯', 'MOS'] },
  { name: '漢堡王', groupType: 'fast_food', aliases: ['漢堡王', 'Burger King'] },
  { name: '7-11', groupType: 'convenience', aliases: ['7-11', '711', '統一超商'] },
  { name: '全家', groupType: 'convenience', aliases: ['全家', 'FamilyMart'] },
  { name: '萊爾富', groupType: 'convenience', aliases: ['萊爾富', 'Hi-Life'] },
  { name: 'OK', groupType: 'convenience', aliases: ['OK', 'OKmart'] },
]);

const WEEKDAYS = [
  { index: 1, label: '星期一', shortLabel: '一' },
  { index: 2, label: '星期二', shortLabel: '二' },
  { index: 3, label: '星期三', shortLabel: '三' },
  { index: 4, label: '星期四', shortLabel: '四' },
  { index: 5, label: '星期五', shortLabel: '五' },
  { index: 6, label: '星期六', shortLabel: '六' },
  { index: 0, label: '星期日', shortLabel: '日' },
];

const dayKey = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const dayNumber = (value) => {
  const [year, month, day] = dayKey(value).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

const dayCount = (startsOn, endsOn) => dayNumber(endsOn) - dayNumber(startsOn) + 1;

const addDays = (value, days) => {
  const [year, month, day] = dayKey(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

const weekdayIndex = (value) => {
  const [year, month, day] = dayKey(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const withinPeriod = (entry, period) => {
  const occurredOn = dayKey(entry.occurred_at ?? entry.occurredAt);
  return occurredOn >= period.startsOn && occurredOn <= period.endsOn;
};

const amountOf = (value) => Number(value?.amount) || 0;
const sumAmounts = (values) => values.reduce((total, value) => total + amountOf(value), 0);
const roundAmount = (value) => Math.round(Number.isFinite(value) ? value : 0);
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export function normalizeMerchantText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-TW')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

const matchesAlias = (itemName, alias) => {
  const normalizedAlias = normalizeMerchantText(alias);
  if (!normalizedAlias) return false;
  if (/^[a-z]+$/i.test(normalizedAlias) && normalizedAlias.length <= 2) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i')
      .test(String(itemName ?? '').normalize('NFKC'));
  }
  return normalizeMerchantText(itemName).includes(normalizedAlias);
};

const normalizeMerchantGroups = (merchantGroups) => merchantGroups
  .filter((group) => !group.retiredAt && !group.retired_at)
  .map((group) => ({
    id: group.id ?? null,
    name: String(group.name ?? '').trim(),
    groupType: group.groupType ?? group.group_type ?? 'other',
    aliases: [...new Set([group.name, ...(group.aliases ?? [])].filter(Boolean))],
  }))
  .filter((group) => group.name && group.aliases.length)
  .map((group) => ({
    ...group,
    aliases: group.aliases.sort(
      (left, right) => normalizeMerchantText(right).length - normalizeMerchantText(left).length,
    ),
  }));

export function identifyMerchant(itemName, merchantGroups = DEFAULT_MERCHANT_GROUPS) {
  const matches = normalizeMerchantGroups(merchantGroups)
    .flatMap((group) => group.aliases
      .filter((alias) => matchesAlias(itemName, alias))
      .map((alias) => ({ group, specificity: normalizeMerchantText(alias).length })))
    .sort((left, right) => right.specificity - left.specificity);
  return matches[0]?.group ?? null;
}

const aggregateItems = (entries, merchantGroups) => {
  const aggregate = new Map();
  entries.forEach((entry) => {
    const merchant = identifyMerchant(entry.item_name ?? entry.itemName, merchantGroups);
    const originalName = String(entry.item_name ?? entry.itemName ?? '').trim() || '未命名項目';
    const key = merchant ? `merchant:${merchant.name}` : `item:${normalizeMerchantText(originalName)}`;
    const current = aggregate.get(key) ?? {
      key,
      name: merchant?.name ?? originalName,
      merchantType: merchant?.groupType ?? null,
      amount: 0,
      count: 0,
    };
    current.amount += amountOf(entry);
    current.count += 1;
    aggregate.set(key, current);
  });
  return [...aggregate.values()]
    .filter((item) => item.amount > 0)
    .sort((left, right) => (
      right.amount - left.amount
      || right.count - left.count
      || left.name.localeCompare(right.name, 'zh-TW')
    ));
};

const resolveAnalysisNature = (category) => (
  category?.analysisNature
  ?? category?.analysis_nature
  ?? (category?.name === '娛樂' ? 'pleasure' : 'maintenance')
);

const comparisonRow = ({ key, label, currentAmount, previousAmount, isTotal = false }) => {
  const difference = currentAmount - previousAmount;
  if (currentAmount === 0 && previousAmount === 0) return null;
  if (previousAmount === 0) {
    return {
      key, label, currentAmount, previousAmount, difference,
      status: 'new', percentChange: null, isTotal,
    };
  }
  if (currentAmount === 0) {
    return {
      key, label, currentAmount, previousAmount, difference,
      status: 'none', percentChange: -100, isTotal,
    };
  }
  return {
    key,
    label,
    currentAmount,
    previousAmount,
    difference,
    status: difference === 0 ? 'same' : difference > 0 ? 'up' : 'down',
    percentChange: ((currentAmount - previousAmount) / previousAmount) * 100,
    isTotal,
  };
};

const significantSummary = (rows) => {
  const significant = rows.filter((row) => (
    !row.isTotal
    && Math.abs(row.difference) > 300
    && (row.percentChange === null || Math.abs(row.percentChange) > 10)
  ));
  const largestIncrease = significant
    .filter((row) => row.difference > 0)
    .sort((left, right) => right.difference - left.difference)[0];
  const largestDecrease = significant
    .filter((row) => row.difference < 0)
    .sort((left, right) => left.difference - right.difference)[0];
  if (!largestIncrease && !largestDecrease) return '本期消費結構大致穩定';

  const fragments = [];
  if (largestIncrease) fragments.push(`「${largestIncrease.label}」增加 NT$${roundAmount(largestIncrease.difference).toLocaleString('zh-TW')}`);
  if (largestDecrease) fragments.push(`「${largestDecrease.label}」減少 NT$${roundAmount(Math.abs(largestDecrease.difference)).toLocaleString('zh-TW')}`);
  return `本期${fragments.join('，')}。`;
};

const monthComparisonLabel = (startsOn) => {
  const month = Number(dayKey(startsOn).slice(5, 7));
  return `與 ${month} 月比較`;
};

export function buildExpenseAnalysis({
  period,
  previousPeriod,
  now = new Date(),
  currentEntries = [],
  previousEntries = [],
  fixedExpenses = [],
  categories = [],
  merchantGroups = DEFAULT_MERCHANT_GROUPS,
  countryBaselines = COUNTRY_LIVING_COST_BASELINES,
}) {
  if (!period?.startsOn || !period?.endsOn) {
    throw new Error('必須提供帳務週期起迄日。');
  }

  const today = dayKey(now);
  const totalDays = dayCount(period.startsOn, period.endsOn);
  const completed = today > period.endsOn;
  const elapsedDays = completed
    ? totalDays
    : clamp(dayCount(period.startsOn, today < period.startsOn ? period.startsOn : today), 1, totalDays);
  const analysisEndsOn = addDays(period.startsOn, elapsedDays - 1);
  const periodEntries = currentEntries.filter((entry) => withinPeriod(entry, period));
  const nonFixedEntries = periodEntries.filter((entry) => !entry.is_fixed && !entry.isFixed);
  const nonFixedTotal = sumAmounts(nonFixedEntries);
  const fixedExpenseTotal = sumAmounts(fixedExpenses);
  const completeLivingSpend = nonFixedTotal + fixedExpenseTotal;
  const dailyAverageRaw = nonFixedTotal / elapsedDays;
  const completeDailyAverageRaw = dailyAverageRaw + (fixedExpenseTotal / totalDays);
  const projectedCompleteLivingSpend = completed
    ? completeLivingSpend
    : roundAmount((dailyAverageRaw * totalDays) + fixedExpenseTotal);
  const resolvedCountryBaselines = Array.isArray(countryBaselines) && countryBaselines.length
    ? countryBaselines
      .map((country) => ({
        ...country,
        amount: Number.isInteger(Number(country.amount)) && Number(country.amount) > 0
          ? Number(country.amount)
          : 0,
      }))
      .filter((country) => country.code && country.name && country.amount > 0)
    : COUNTRY_LIVING_COST_BASELINES;
  const taiwanLivingCostBaseline = resolvedCountryBaselines.find((country) => country.code === 'TW');
  const taiwanLivingCostRatio = taiwanLivingCostBaseline?.amount
    ? completeLivingSpend / taiwanLivingCostBaseline.amount
    : 1;
  const spendingLevel = taiwanLivingCostRatio <= 0.8
    ? '節省型'
    : taiwanLivingCostRatio <= 1.2
      ? '平均型'
      : '奢侈型';

  const weekdayTotals = new Map(WEEKDAYS.map((weekday) => [weekday.index, 0]));
  nonFixedEntries.forEach((entry) => {
    const entryDay = dayKey(entry.occurred_at ?? entry.occurredAt);
    if (entryDay <= analysisEndsOn) {
      const index = weekdayIndex(entryDay);
      weekdayTotals.set(index, weekdayTotals.get(index) + amountOf(entry));
    }
  });
  const weekdayOccurrences = new Map(WEEKDAYS.map((weekday) => [weekday.index, 0]));
  for (let offset = 0; offset < elapsedDays; offset += 1) {
    const index = weekdayIndex(addDays(period.startsOn, offset));
    weekdayOccurrences.set(index, weekdayOccurrences.get(index) + 1);
  }
  const weekdayDistribution = WEEKDAYS.map((weekday) => ({
    ...weekday,
    total: weekdayTotals.get(weekday.index),
    occurrences: weekdayOccurrences.get(weekday.index),
    average: roundAmount(weekdayTotals.get(weekday.index) / Math.max(weekdayOccurrences.get(weekday.index), 1)),
  }));

  const allItems = aggregateItems(nonFixedEntries, merchantGroups);
  const topItems = allItems.slice(0, 10);
  const merchantItems = allItems.filter((item) => item.merchantType);
  const merchantGroupSummary = (groupType) => {
    const items = merchantItems.filter((item) => item.merchantType === groupType);
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    const count = items.reduce((sum, item) => sum + item.count, 0);
    return {
      total,
      count,
      average: count ? roundAmount(total / count) : 0,
      share: nonFixedTotal ? (total / nonFixedTotal) * 100 : 0,
      items: items.map((item) => ({
        ...item,
        average: item.count ? roundAmount(item.amount / item.count) : 0,
        share: nonFixedTotal ? (item.amount / nonFixedTotal) * 100 : 0,
      })),
    };
  };
  const fastFood = merchantGroupSummary('fast_food');
  const convenience = merchantGroupSummary('convenience');

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const natureForEntry = (entry) => resolveAnalysisNature(categoryById.get(
    entry.category_id ?? entry.categoryId,
  ));
  const natureEntries = {
    maintenance: nonFixedEntries.filter((entry) => natureForEntry(entry) !== 'pleasure'),
    pleasure: nonFixedEntries.filter((entry) => natureForEntry(entry) === 'pleasure'),
  };
  const natureSummary = (nature) => {
    const amount = sumAmounts(natureEntries[nature]);
    return {
      amount,
      share: nonFixedTotal ? (amount / nonFixedTotal) * 100 : 0,
      items: aggregateItems(natureEntries[nature], merchantGroups),
    };
  };

  const previousPeriodResolved = previousPeriod ?? {
    startsOn: addDays(period.startsOn, -totalDays),
    endsOn: addDays(period.startsOn, -1),
  };
  const previousPeriodEntries = previousEntries.filter(
    (entry) => withinPeriod(entry, previousPeriodResolved) && !entry.is_fixed && !entry.isFixed,
  );
  const previousComparableEndsOn = addDays(previousPeriodResolved.startsOn, elapsedDays - 1);
  const comparablePreviousEntries = previousPeriodEntries.filter((entry) => (
    dayKey(entry.occurred_at ?? entry.occurredAt) <= previousComparableEndsOn
  ));
  const previousCategoryTotals = new Map();
  const currentCategoryTotals = new Map();
  categories.forEach((category) => {
    previousCategoryTotals.set(category.id, 0);
    currentCategoryTotals.set(category.id, 0);
  });
  nonFixedEntries.forEach((entry) => {
    const categoryId = entry.category_id ?? entry.categoryId;
    currentCategoryTotals.set(categoryId, (currentCategoryTotals.get(categoryId) ?? 0) + amountOf(entry));
  });
  comparablePreviousEntries.forEach((entry) => {
    const categoryId = entry.category_id ?? entry.categoryId;
    previousCategoryTotals.set(categoryId, (previousCategoryTotals.get(categoryId) ?? 0) + amountOf(entry));
  });
  const currentPleasure = sumAmounts(natureEntries.pleasure);
  const previousPleasure = sumAmounts(comparablePreviousEntries.filter((entry) => (
    resolveAnalysisNature(categoryById.get(entry.category_id ?? entry.categoryId)) === 'pleasure'
  )));
  const comparisonRows = [
    comparisonRow({
      key: 'daily-total',
      label: '日常總開銷',
      currentAmount: nonFixedTotal,
      previousAmount: sumAmounts(comparablePreviousEntries),
      isTotal: true,
    }),
    ...categories
      .filter((category) => resolveAnalysisNature(category) !== 'pleasure')
      .map((category) => comparisonRow({
        key: `category:${category.id}`,
        label: category.name,
        currentAmount: currentCategoryTotals.get(category.id) ?? 0,
        previousAmount: previousCategoryTotals.get(category.id) ?? 0,
      })),
    comparisonRow({
      key: 'pleasure',
      label: '快樂支出',
      currentAmount: currentPleasure,
      previousAmount: previousPleasure,
    }),
  ].filter(Boolean);

  return {
    period: {
      ...period,
      completed,
      totalDays,
      elapsedDays,
      analysisEndsOn,
    },
    totals: {
      nonFixedTotal,
      fixedExpenseTotal,
      completeLivingSpend,
      dailyAverage: roundAmount(dailyAverageRaw),
      completeDailyAverage: roundAmount(completeDailyAverageRaw),
      projectedCompleteLivingSpend,
    },
    weekdayDistribution,
    topItems,
    countryComparisons: resolvedCountryBaselines.map((country) => ({
      ...country,
      ratio: country.amount ? (completeLivingSpend / country.amount) * 100 : 0,
    })),
    spendingLevel,
    merchantAnalysis: {
      fastFood,
      convenience,
      combinedShare: nonFixedTotal ? ((fastFood.total + convenience.total) / nonFixedTotal) * 100 : 0,
    },
    spendingNature: {
      maintenance: natureSummary('maintenance'),
      pleasure: natureSummary('pleasure'),
    },
    comparison: {
      label: monthComparisonLabel(previousPeriodResolved.startsOn),
      elapsedDays,
      previousFullTotal: sumAmounts(previousPeriodEntries),
      currentComparableTotal: nonFixedTotal,
      previousComparableTotal: sumAmounts(comparablePreviousEntries),
      rows: comparisonRows,
      summary: significantSummary(comparisonRows),
    },
  };
}
