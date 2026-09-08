import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDailyLivingBudget, calculateFinancialSummary } from './financial-summary.js';

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
    advanceRepaymentEntries: [{ amount: 2000 }],
    previousCardBillAmount: 10000,
    previousCardBillZeroConfirmed: false,
  });

  assert.equal(summary.totalIncome, 53000);
  assert.equal(summary.cashTotal, 4000);
  assert.equal(summary.creditCardTotal, 7000);
  assert.equal(summary.fixedExpenseTotal, 7000);
  assert.equal(summary.advanceRepaymentTotal, 2000);
  assert.equal(summary.savingsAmount, 36000);
});

test('上期信用卡帳單尚未輸入時按 0 元計算可存額', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [],
    fixedExpenseRules: [],
    salaryAmount: 50000,
    otherIncomeEntries: [],
    previousCardBillAmount: null,
    previousCardBillZeroConfirmed: false,
  });

  assert.equal(summary.previousCardBillReady, true);
  assert.equal(summary.savingsAmount, 50000);
});

test('現金代墊收回後顯示淨現金流出並只扣自己的負擔', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [{ amount: 9000, payment_method: 'cash', is_fixed: false }],
    fixedExpenseRules: [],
    salaryAmount: 0,
    otherIncomeEntries: [],
    advanceRepaymentEntries: [{ amount: 4500 }],
    previousCardBillAmount: 0,
    previousCardBillZeroConfirmed: true,
  });

  assert.equal(summary.cashTotal, 9000);
  assert.equal(summary.advanceRepaymentTotal, 4500);
  assert.equal(summary.netCashOutflowTotal, 4500);
  assert.equal(summary.savingsAmount, -4500);
});

test('信用卡代墊收回保留完整刷卡額並增加本期可用現金', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [{ amount: 9000, payment_method: 'credit_card', is_fixed: false }],
    fixedExpenseRules: [],
    salaryAmount: 0,
    otherIncomeEntries: [],
    advanceRepaymentEntries: [{ amount: 4500 }],
    previousCardBillAmount: 0,
    previousCardBillZeroConfirmed: true,
  });

  assert.equal(summary.creditCardTotal, 9000);
  assert.equal(summary.netCashOutflowTotal, -4500);
  assert.equal(summary.savingsAmount, 4500);
});

test('每日可花額以本期生活上限扣除固定與已發生生活開銷後除以剩餘天數', () => {
  const budget = calculateDailyLivingBudget({
    livingExpenseLimitAmount: 8000,
    reservedFixedAmount: 2000,
    spentAmount: 2500,
    periodStart: '2026-09-05',
    periodEnd: '2026-10-04',
    now: '2026-09-08T10:00:00+08:00',
  });

  assert.equal(budget.limit, 8000);
  assert.equal(budget.fixed, 2000);
  assert.equal(budget.spent, 2500);
  assert.equal(budget.remainingAmount, 3500);
  assert.equal(budget.remainingDays, 27);
  assert.equal(budget.dailyAmount, 129);
});
