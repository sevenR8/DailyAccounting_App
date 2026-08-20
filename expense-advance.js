const taipeiDateKey = (value) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(value));

const sumRepayments = (advance) => (advance.repayments ?? [])
  .reduce((total, repayment) => total + Number(repayment.amount || 0), 0);

export function decorateExpenseAdvances(advances = []) {
  return advances.map((advance) => {
    const receivedAmount = Math.min(Number(advance.amount), sumRepayments(advance));
    const outstandingAmount = Math.max(0, Number(advance.amount) - receivedAmount);
    return {
      ...advance,
      receivedAmount,
      outstandingAmount,
      status: outstandingAmount === 0
        ? 'settled'
        : receivedAmount > 0
          ? 'partial'
          : 'outstanding',
    };
  });
}

export function applyPersonalExpenseAmounts(entries = [], advances = []) {
  const advancedByExpense = new Map();
  advances.forEach((advance) => {
    advancedByExpense.set(
      advance.expenseEntryId,
      (advancedByExpense.get(advance.expenseEntryId) ?? 0) + Number(advance.amount || 0),
    );
  });
  return entries.map((entry) => ({
    ...entry,
    amount: Math.max(0, Number(entry.amount) - (advancedByExpense.get(entry.id) ?? 0)),
    paid_amount: Number(entry.amount),
  }));
}

export function advanceRepaymentsInPeriod(advances = [], startsOn, endsOn) {
  if (!startsOn || !endsOn) return [];
  return advances.flatMap((advance) => (advance.repayments ?? [])
    .filter((repayment) => {
      const dateKey = taipeiDateKey(repayment.receivedAt);
      return dateKey >= startsOn && dateKey <= endsOn;
    }));
}

export function advancesVisibleInPeriod(advances = [], startsOn, endsOn) {
  return advances.filter((advance) => advance.status !== 'settled'
    || advanceRepaymentsInPeriod([advance], startsOn, endsOn).length > 0);
}
