const sumAmounts = (items) => items.reduce((total, item) => total + item.amount, 0);

export function calculateFinancialSummary({
  periodEntries,
  fixedExpenseRules,
  salaryAmount,
  otherIncomeEntries,
  advanceRepaymentEntries = [],
  previousCardBillAmount,
  previousCardBillZeroConfirmed,
}) {
  const nonFixedEntries = periodEntries.filter((entry) => !entry.is_fixed);
  const cashTotal = sumAmounts(nonFixedEntries.filter((entry) => entry.payment_method === 'cash'));
  const creditCardTotal = sumAmounts(nonFixedEntries.filter((entry) => entry.payment_method === 'credit_card'));
  const nonFixedExpenseTotal = cashTotal + creditCardTotal;
  const generatedExpenseTotal = sumAmounts(periodEntries);
  const fixedExpenseTotal = sumAmounts(fixedExpenseRules);
  const cashFixedExpenseTotal = sumAmounts(
    fixedExpenseRules.filter((rule) => rule.payment_method === 'cash'),
  );
  const otherIncomeTotal = sumAmounts(otherIncomeEntries);
  const advanceRepaymentTotal = sumAmounts(advanceRepaymentEntries);
  const netCashOutflowTotal = cashTotal - advanceRepaymentTotal;
  const totalIncome = salaryAmount + otherIncomeTotal;
  // A blank previous bill is intentionally treated as NT$0. Users can still
  // enter the actual amount later, but the savings summary never gets blocked
  // behind a separate “confirmed zero” checkbox.
  const previousCardBillReady = true;
  const savingsAmount = totalIncome - (previousCardBillAmount ?? 0)
    - netCashOutflowTotal - cashFixedExpenseTotal;

  return {
    cashTotal,
    creditCardTotal,
    nonFixedExpenseTotal,
    generatedExpenseTotal,
    fixedExpenseTotal,
    cashFixedExpenseTotal,
    otherIncomeTotal,
    advanceRepaymentTotal,
    netCashOutflowTotal,
    totalIncome,
    previousCardBillReady,
    savingsAmount,
  };
}

export function calculateDailyLivingBudget({
  livingExpenseLimitAmount,
  spentAmount = 0,
  periodStart,
  periodEnd,
  now = new Date(),
} = {}) {
  const limit = Number(livingExpenseLimitAmount);
  if (!Number.isFinite(limit) || limit < 0 || !periodStart || !periodEnd) return null;

  const start = new Date(`${periodStart}T00:00:00+08:00`);
  const endExclusive = new Date(`${periodEnd}T00:00:00+08:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const current = new Date(now);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(endExclusive.getTime())) return null;

  const totalDays = Math.max(1, Math.ceil((endExclusive - start) / 86_400_000));
  const remainingDays = current < start
    ? totalDays
    : current >= endExclusive
      ? 0
      : Math.max(1, Math.ceil((endExclusive - current) / 86_400_000));
  const spent = Math.max(0, Number(spentAmount) || 0);
  const remainingAmount = Math.round(limit - spent);

  return {
    limit: Math.round(limit),
    spent: Math.round(spent),
    remainingAmount,
    remainingDays,
    dailyAmount: remainingDays > 0 ? Math.floor(remainingAmount / remainingDays) : remainingAmount,
  };
}
