const TAIPEI_TIME_ZONE = 'Asia/Taipei';

const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const positiveAmount = (value) => Math.max(0, asNumber(value));

const taipeiDay = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const formatDay = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const startOfAccountingPeriod = (value, cycleStartDay) => {
  const [year, month, day] = taipeiDay(value).split('-').map(Number);
  const safeStartDay = Math.min(28, Math.max(1, Number(cycleStartDay) || 5));
  if (day >= safeStartDay) return formatDay(year, month, safeStartDay);
  const previousMonth = month === 1 ? 12 : month - 1;
  return formatDay(month === 1 ? year - 1 : year, previousMonth, safeStartDay);
};

const addYear = (year, month, amount) => {
  const date = new Date(Date.UTC(year + amount, month - 1, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
};

export function annualCycleForDate({ now = new Date(), startMonth = 1 } = {}) {
  const [currentYear, currentMonth] = taipeiDay(now).split('-').map(Number);
  const normalizedStartMonth = Math.min(12, Math.max(1, Number(startMonth) || 1));
  const startsYear = currentMonth < normalizedStartMonth ? currentYear - 1 : currentYear;
  const ends = addYear(startsYear, normalizedStartMonth, 1);
  const endsOn = new Date(Date.UTC(ends.year, ends.month - 1, 0)).toISOString().slice(0, 10);
  const [endsYear, endsMonth] = endsOn.split('-').map(Number);
  return {
    startMonth: normalizedStartMonth,
    startsOn: formatDay(startsYear, normalizedStartMonth, 1),
    endsOn,
    label: normalizedStartMonth === 1
      ? `${startsYear} 年`
      : `${startsYear}/${String(normalizedStartMonth).padStart(2, '0')}－${endsYear}/${String(endsMonth).padStart(2, '0')}`,
  };
}

export function recentVariableSpending({
  entries = [],
  cycleStartDay = 5,
  now = new Date(),
  limit = 3,
} = {}) {
  const today = taipeiDay(now);
  const currentStartsOn = startOfAccountingPeriod(today, cycleStartDay);
  const totalsByPeriod = new Map();
  entries.forEach((entry) => {
    if (entry?.is_fixed || entry?.isFixed) return;
    if (entry?.include_in_daily_average === false || entry?.includeInDailyAverage === false) return;
    const occurredOn = taipeiDay(entry?.occurred_at ?? entry?.occurredAt);
    if (occurredOn > today) return;
    const startsOn = startOfAccountingPeriod(occurredOn, cycleStartDay);
    totalsByPeriod.set(startsOn, (totalsByPeriod.get(startsOn) ?? 0) + positiveAmount(entry?.amount));
  });
  const completedPeriods = [...totalsByPeriod.entries()]
    .filter(([startsOn]) => startsOn < currentStartsOn)
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, Math.max(1, Number(limit) || 3))
    .map(([startsOn, amount]) => ({ startsOn, amount }));
  if (completedPeriods.length) {
    return { periods: completedPeriods, includesCurrentPeriod: false };
  }

  const currentAmount = totalsByPeriod.get(currentStartsOn) ?? 0;
  return currentAmount > 0
    ? { periods: [{ startsOn: currentStartsOn, amount: currentAmount }], includesCurrentPeriod: true }
    : { periods: [], includesCurrentPeriod: false };
}

export function buildAnnualFinancialForecast({
  now = new Date(),
  annualCycleStartMonth = 1,
  currentSalaryAmount = 0,
  fixedExpenseRules = [],
  recentVariableSpendAmounts = [],
  includesCurrentPeriod = false,
  expectedBonusAmount = 0,
  expectedDividendAmount = 0,
} = {}) {
  const cycle = annualCycleForDate({ now, startMonth: annualCycleStartMonth });
  const monthlySalary = positiveAmount(currentSalaryAmount);
  const recentAmounts = recentVariableSpendAmounts
    .map((value) => positiveAmount(value?.amount ?? value))
    .filter((value) => Number.isFinite(value));
  const averageMonthlyLivingExpense = recentAmounts.length
    ? Math.round(recentAmounts.reduce((total, value) => total + value, 0) / recentAmounts.length)
    : 0;
  const annualFixedExpense = Math.round(fixedExpenseRules.reduce((total, rule) => {
    const frequency = (rule?.recurrence_type ?? rule?.recurrenceType) === 'yearly' ? 1 : 12;
    return total + (positiveAmount(rule?.amount) * frequency);
  }, 0));
  const expectedBonus = positiveAmount(expectedBonusAmount);
  const expectedDividend = positiveAmount(expectedDividendAmount);
  const annualIncome = Math.round((monthlySalary * 12) + expectedBonus + expectedDividend);
  const annualLivingExpense = Math.round(averageMonthlyLivingExpense * 12);
  const monthlySavings = Math.round(monthlySalary - averageMonthlyLivingExpense - (annualFixedExpense / 12));
  const estimatedAnnualSavings = Math.round((monthlySavings * 12) + expectedBonus + expectedDividend);

  return {
    cycle: {
      ...cycle,
    },
    inputs: {
      monthlySalary,
      expectedBonus,
      expectedDividend,
      recentPeriodCount: recentAmounts.length,
      includesCurrentPeriod: Boolean(includesCurrentPeriod),
    },
    annualIncome,
    annualLivingExpense,
    annualFixedExpense,
    averageMonthlyLivingExpense,
    monthlySavings,
    estimatedAnnualSavings,
    averageSavingsRate: annualIncome > 0 ? (estimatedAnnualSavings / annualIncome) * 100 : null,
  };
}
