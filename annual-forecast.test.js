import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annualCycleForDate,
  buildAnnualFinancialForecast,
  recentVariableSpending,
} from './annual-forecast.js';

test('年度週期預設採 1 月到 12 月，並可改為任意起始月份', () => {
  assert.deepEqual(annualCycleForDate({ now: '2026-09-07T10:00:00+08:00' }), {
    startMonth: 1,
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    label: '2026 年',
  });
  assert.deepEqual(annualCycleForDate({ now: '2026-03-02T10:00:00+08:00', startMonth: 4 }), {
    startMonth: 4,
    startsOn: '2025-04-01',
    endsOn: '2026-03-31',
    label: '2025/04－2026/03',
  });
});

test('近幾期日常開銷排除固定開銷與尚未結束的當期', () => {
  const result = recentVariableSpending({
    now: '2026-09-07T10:00:00+08:00',
    cycleStartDay: 5,
    entries: [
      { occurred_at: '2026-08-10T10:00:00+08:00', amount: 100 },
      { occurred_at: '2026-07-08T10:00:00+08:00', amount: 200 },
      { occurred_at: '2026-07-20T10:00:00+08:00', amount: 50 },
      { occurred_at: '2026-09-06T10:00:00+08:00', amount: 500 },
      { occurred_at: '2026-08-05T10:00:00+08:00', amount: 9_500, is_fixed: true },
    ],
  });

  assert.deepEqual(result, {
    periods: [
      { startsOn: '2026-08-05', amount: 100 },
      { startsOn: '2026-07-05', amount: 250 },
    ],
    includesCurrentPeriod: false,
  });
});

test('年度預估以月薪、近期日常平均、固定開銷與年終分紅計算可存額', () => {
  const forecast = buildAnnualFinancialForecast({
    now: '2026-09-07T10:00:00+08:00',
    currentSalaryAmount: 50_000,
    recentVariableSpendAmounts: [10_000, 14_000, 12_000],
    fixedExpenseRules: [
      { amount: 5_000, recurrence_type: 'monthly' },
      { amount: 12_000, recurrence_type: 'yearly' },
    ],
    expectedBonusAmount: 60_000,
    expectedDividendAmount: 24_000,
  });

  assert.equal(forecast.annualIncome, 684_000);
  assert.equal(forecast.averageMonthlyLivingExpense, 12_000);
  assert.equal(forecast.annualLivingExpense, 144_000);
  assert.equal(forecast.annualFixedExpense, 72_000);
  assert.equal(forecast.monthlySavings, 32_000);
  assert.equal(forecast.estimatedAnnualSavings, 468_000);
  assert.equal(Math.round(forecast.averageSavingsRate * 10) / 10, 68.4);
});
