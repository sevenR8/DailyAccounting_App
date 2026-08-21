import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountingPeriodFromStart,
  compareExpenseTotals,
  canRebaseEmptyCurrentPeriod,
  scheduledDateInAccountingPeriod,
  shiftAccountingPeriodStart,
} from './accounting-period.js';

test('尚未開始記帳的初始週期可以套用新的起始日', () => {
  assert.equal(canRebaseEmptyCurrentPeriod({
    period: {
      starts_on: '2026-08-05',
      ends_on: '2026-09-04',
      salary_amount: 0,
      previous_card_bill_amount: null,
      previous_card_bill_zero_confirmed: false,
    },
    entries: [],
    otherIncomeEntries: [],
  }), true);
});

test('已有開銷的週期不會因修改設定而重新分組', () => {
  assert.equal(canRebaseEmptyCurrentPeriod({
    period: {
      starts_on: '2026-08-05',
      ends_on: '2026-09-04',
      salary_amount: 0,
      previous_card_bill_amount: null,
      previous_card_bill_zero_confirmed: false,
    },
    entries: [{ occurred_at: '2026-08-22T02:00:00.000Z' }],
    otherIncomeEntries: [],
  }), false);
});

test('帳務週期可按月前後移動並維持自訂起始日', () => {
  assert.equal(shiftAccountingPeriodStart('2026-08-05', -1), '2026-07-05');
  assert.equal(shiftAccountingPeriodStart('2026-08-05', 1), '2026-09-05');
  assert.deepEqual(accountingPeriodFromStart('2026-08-05'), {
    startsOn: '2026-08-05',
    endsOn: '2026-09-04',
  });
});

test('固定開銷日期會落在跨月帳務週期內的正確月份', () => {
  assert.equal(scheduledDateInAccountingPeriod('2026-08-05', '2026-09-04', 25), '2026-08-25');
  assert.equal(scheduledDateInAccountingPeriod('2026-08-05', '2026-09-04', 1), '2026-09-01');
});

test('年度固定開銷只會落在指定月份所在的帳務週期', () => {
  assert.equal(
    scheduledDateInAccountingPeriod('2026-08-05', '2026-09-04', 25, 8),
    '2026-08-25',
  );
  assert.equal(
    scheduledDateInAccountingPeriod('2026-08-05', '2026-09-04', 25, 12),
    null,
  );
  assert.equal(
    scheduledDateInAccountingPeriod('2026-12-05', '2027-01-04', 1, 1),
    '2027-01-01',
  );
});

test('與上月比較可分辨增加、減少、持平與無比較基準', () => {
  assert.deepEqual(compareExpenseTotals(1160, 1000), {
    direction: 'up', percent: 16, hasBaseline: true,
  });
  assert.deepEqual(compareExpenseTotals(750, 1000), {
    direction: 'down', percent: 25, hasBaseline: true,
  });
  assert.deepEqual(compareExpenseTotals(0, 0), {
    direction: 'same', percent: 0, hasBaseline: true,
  });
  assert.deepEqual(compareExpenseTotals(200, 0), {
    direction: 'up', percent: null, hasBaseline: false,
  });
});
