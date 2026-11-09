import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDailyLivingBudget, calculateFinancialSummary, livingExpenseSpentTotal } from './financial-summary.js';

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

test('收回款不算生活開銷，並依付款方式抵銷本期現金流', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [
      { amount: 1000, payment_method: 'cash', is_fixed: false },
      { amount: 350, payment_method: 'cash', is_fixed: false, is_reimbursement: true },
      { amount: 800, payment_method: 'credit_card', is_fixed: false },
      { amount: 200, payment_method: 'credit_card', is_fixed: false, is_reimbursement: true },
    ],
    fixedExpenseRules: [],
    salaryAmount: 3000,
    otherIncomeEntries: [],
    previousCardBillAmount: 0,
  });

  assert.equal(summary.cashTotal, 650);
  assert.equal(summary.creditCardTotal, 600);
  assert.equal(summary.nonFixedExpenseTotal, 1250);
  assert.equal(summary.savingsAmount, 2350);
});

test('投資獨立於現金與信用卡開銷，現金投入另列於實際現金變動', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [
      { category_id: 'food', amount: 2000, payment_method: 'cash', is_fixed: false },
      { category_id: 'investment', amount: 5000, payment_method: 'cash', is_fixed: false },
      { category_id: 'investment', amount: 400, payment_method: 'credit_card', is_fixed: false },
      { category_id: 'food', amount: 300, payment_method: 'credit_card', is_fixed: false },
    ],
    investmentCategoryIds: new Set(['investment']),
    fixedExpenseRules: [],
    salaryAmount: 10000,
    otherIncomeEntries: [],
    previousCardBillAmount: 1000,
  });

  assert.equal(summary.cashTotal, 2000);
  assert.equal(summary.creditCardTotal, 300);
  assert.equal(summary.investmentTotal, 5400);
  assert.equal(summary.cashInvestmentTotal, 5000);
  assert.equal(summary.nonFixedExpenseTotal, 2300);
  assert.equal(summary.savingsAmount, 7000);
  assert.equal(summary.cashFlowAmount, 2000);
});

test('每日生活上限只扣生活消費，不扣投資或固定開銷', () => {
  const spentAmount = livingExpenseSpentTotal([
    { category_id: 'food', amount: 2000, is_fixed: false },
    { category_id: 'investment', amount: 5000, is_fixed: false },
    { category_id: 'rent', amount: 3000, is_fixed: true },
  ], new Set(['investment']));
  const budget = calculateDailyLivingBudget({
    livingExpenseLimitAmount: 8000,
    spentAmount,
    periodStart: '2026-09-05',
    periodEnd: '2026-10-04',
    now: '2026-09-08T10:00:00+08:00',
  });

  assert.equal(budget.spent, 2000);
  assert.equal(budget.remainingAmount, 6000);
});

test('投資代墊收回歸回投資，不誤算為生活現金開銷', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [{ category_id: 'investment', amount: 5000, payment_method: 'cash', is_fixed: false }],
    investmentCategoryIds: new Set(['investment']),
    fixedExpenseRules: [],
    salaryAmount: 10000,
    otherIncomeEntries: [],
    advanceRepaymentEntries: [{ amount: 1000 }],
    investmentAdvanceRepaymentEntries: [{ amount: 1000 }],
    previousCardBillAmount: 0,
  });

  assert.equal(summary.netCashOutflowTotal, 0);
  assert.equal(summary.investmentTotal, 4000);
  assert.equal(summary.cashInvestmentTotal, 4000);
  assert.equal(summary.savingsAmount, 10000);
  assert.equal(summary.cashFlowAmount, 6000);
});

test('固定投資不扣本月收支結餘，但仍記錄現金減少', () => {
  const summary = calculateFinancialSummary({
    periodEntries: [],
    investmentCategoryIds: new Set(['investment']),
    fixedExpenseRules: [
      { category_id: 'investment', amount: 3000, payment_method: 'cash' },
      { category_id: 'rent', amount: 5000, payment_method: 'cash' },
    ],
    salaryAmount: 10000,
    otherIncomeEntries: [],
    previousCardBillAmount: 0,
  });

  assert.equal(summary.fixedExpenseTotal, 8000);
  assert.equal(summary.cashFixedExpenseTotal, 5000);
  assert.equal(summary.investmentTotal, 3000);
  assert.equal(summary.cashInvestmentTotal, 3000);
  assert.equal(summary.savingsAmount, 5000);
  assert.equal(summary.cashFlowAmount, 2000);
});

test('每日可花額以不含固定開銷的本期生活上限扣除已發生生活開銷後除以剩餘天數', () => {
  const budget = calculateDailyLivingBudget({
    livingExpenseLimitAmount: 8000,
    spentAmount: 2500,
    periodStart: '2026-09-05',
    periodEnd: '2026-10-04',
    now: '2026-09-08T10:00:00+08:00',
  });

  assert.equal(budget.limit, 8000);
  assert.equal(budget.spent, 2500);
  assert.equal(budget.remainingAmount, 5500);
  assert.equal(budget.remainingDays, 27);
  assert.equal(budget.dailyAmount, 203);
});
