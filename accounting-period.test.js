import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountingPeriodFromStart,
  compareExpenseTotals,
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

