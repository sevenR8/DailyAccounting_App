import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountingPeriodFromStart,
  compareExpenseTotals,
  scheduledDateInAccountingPeriod,
  shiftAccountingPeriodStart,
} from './accounting-period.js';

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

