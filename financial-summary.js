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
