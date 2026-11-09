const signedAmount = (item) => (item.is_reimbursement ? -1 : 1) * Number(item.amount || 0);
const sumAmounts = (items) => items.reduce((total, item) => total + signedAmount(item), 0);
const categoryIdOf = (entry) => entry.category_id ?? entry.categoryId;

export function livingExpenseSpentTotal(entries = [], investmentCategoryIds = new Set()) {
  return entries
    .filter((entry) => !entry.is_fixed && !investmentCategoryIds.has(categoryIdOf(entry)))
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
}

export function calculateFinancialSummary({
  periodEntries,
  investmentCategoryIds = new Set(),
  fixedExpenseRules,
  salaryAmount,
  otherIncomeEntries,
  advanceRepaymentEntries = [],
  investmentAdvanceRepaymentEntries = [],
  previousCardBillAmount,
  previousCardBillZeroConfirmed,
}) {
  const nonFixedEntries = periodEntries.filter((entry) => !entry.is_fixed);
  const investmentEntries = nonFixedEntries.filter((entry) =>
    investmentCategoryIds.has(categoryIdOf(entry)));
  const fixedInvestmentRules = fixedExpenseRules.filter((rule) =>
    investmentCategoryIds.has(categoryIdOf(rule)));
  const livingEntries = nonFixedEntries.filter((entry) =>
    !investmentCategoryIds.has(categoryIdOf(entry)));
  const cashTotal = sumAmounts(livingEntries.filter((entry) => entry.payment_method === 'cash'));
  const creditCardTotal = sumAmounts(livingEntries.filter((entry) => entry.payment_method === 'credit_card'));
  const investmentRepaymentTotal = sumAmounts(investmentAdvanceRepaymentEntries);
  const investmentTotal = sumAmounts(investmentEntries) + sumAmounts(fixedInvestmentRules)
    - investmentRepaymentTotal;
  const cashInvestmentTotal = sumAmounts(
    investmentEntries.filter((entry) => entry.payment_method === 'cash'),
  ) + sumAmounts(fixedInvestmentRules.filter((rule) => rule.payment_method === 'cash'))
    - investmentRepaymentTotal;
  const nonFixedExpenseTotal = cashTotal + creditCardTotal;
  const generatedExpenseTotal = sumAmounts(periodEntries);
  const fixedExpenseTotal = sumAmounts(fixedExpenseRules);
  const cashFixedExpenseTotal = sumAmounts(
    fixedExpenseRules.filter((rule) => rule.payment_method === 'cash'
      && !investmentCategoryIds.has(categoryIdOf(rule))),
  );
  const otherIncomeTotal = sumAmounts(otherIncomeEntries);
  const advanceRepaymentTotal = sumAmounts(advanceRepaymentEntries);
  const netCashOutflowTotal = cashTotal - (advanceRepaymentTotal - investmentRepaymentTotal);
  const totalIncome = salaryAmount + otherIncomeTotal;
  // A blank previous bill is intentionally treated as NT$0. Users can still
  // enter the actual amount later, but the savings summary never gets blocked
  // behind a separate “confirmed zero” checkbox.
  const previousCardBillReady = true;
  const savingsAmount = totalIncome - (previousCardBillAmount ?? 0)
    - netCashOutflowTotal - cashFixedExpenseTotal;
  const cashFlowAmount = savingsAmount - cashInvestmentTotal;

  return {
    cashTotal,
    creditCardTotal,
    investmentTotal,
    cashInvestmentTotal,
    nonFixedExpenseTotal,
    generatedExpenseTotal,
    fixedExpenseTotal,
    cashFixedExpenseTotal,
    otherIncomeTotal,
    advanceRepaymentTotal,
    investmentRepaymentTotal,
    netCashOutflowTotal,
    totalIncome,
    previousCardBillReady,
    savingsAmount,
    cashFlowAmount,
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
  // The living-expense limit is independent from fixed expenses.
  const remainingAmount = Math.round(limit - spent);

  return {
    limit: Math.round(limit),
    spent: Math.round(spent),
    remainingAmount,
    remainingDays,
    dailyAmount: remainingDays > 0 ? Math.floor(remainingAmount / remainingDays) : remainingAmount,
  };
}
