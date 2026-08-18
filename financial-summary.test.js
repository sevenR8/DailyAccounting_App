import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateFinancialSummary } from './financial-summary.js';

test('可存額扣除上期帳單、非固定現金與現金固定開銷，不先扣本期刷卡', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [
      { amount: 4000, payment_method: 'cash', is_fixed: false },
      { amount: 7000, payment_method: 'credit_card', is_fixed: false },
      { amount: 5000, payment_method: 'cash', is_fixed: true },
      { amount: 2000, payment_method: 'credit_card', is_fixed: true },
    ],
    fixedExpenseRules: [
      { amount: 5000, payment_method: 'cash' },
      { amount: 2000, payment_method: 'credit_card' },
    ],
    salaryAmount: 50000,
    otherIncomeEntries: [{ amount: 3000 }],
    previousCardBillAmount: 10000,
    previousCardBillZeroConfirmed: false,
  });

  assert.equal(summary.totalIncome, 53000);
  assert.equal(summary.cashTotal, 4000);
  assert.equal(summary.creditCardTotal, 7000);
  assert.equal(summary.fixedExpenseTotal, 7000);
  assert.equal(summary.savingsAmount, 34000);
});

test('上期信用卡帳單尚未輸入時不顯示可存額', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [],
    fixedExpenseRules: [],
    salaryAmount: 50000,
    otherIncomeEntries: [],
    previousCardBillAmount: null,
    previousCardBillZeroConfirmed: false,
  });

  assert.equal(summary.previousCardBillReady, false);
  assert.equal(summary.savingsAmount, null);
});

