import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceRepaymentsInPeriod,
  advancesVisibleInPeriod,
  applyAnalysisExpenseAmounts,
  applyPersonalExpenseAmounts,
  decorateExpenseAdvances,
} from './expense-advance.js';

test('總開銷只扣除實際收回的代墊款，尚未收回時保留完整支出', () => {
  const entries = [{ id: 'toy', amount: 798 }];

  const [outstanding] = applyPersonalExpenseAmounts(entries, [{
    expenseEntryId: 'toy',
    amount: 798,
    repayments: [],
  }]);
  const [partial] = applyPersonalExpenseAmounts(entries, [{
    expenseEntryId: 'toy',
    amount: 798,
    repayments: [{ amount: 300 }],
  }]);
  const [settled] = applyPersonalExpenseAmounts(entries, [{
    expenseEntryId: 'toy',
    amount: 798,
    repayments: [{ amount: 798 }],
  }]);

  assert.equal(outstanding.paid_amount, 798);
  assert.equal(outstanding.amount, 798);
  assert.equal(partial.amount, 498);
  assert.equal(settled.amount, 0);
});

test('分析只計入自己的代墊負擔，全額代墊不會進入分析', () => {
  const entries = [
    { id: 'full', amount: 798 },
    { id: 'half', amount: 9000 },
    { id: 'none', amount: 300 },
  ];
  const [full, half, none] = applyAnalysisExpenseAmounts(entries, [
    { expenseEntryId: 'full', amount: 798 },
    { expenseEntryId: 'half', amount: 4500 },
  ]);

  assert.equal(full.amount, 0);
  assert.equal(half.amount, 4500);
  assert.equal(none.amount, 300);
});

test('待收代墊可區分未收、部分收回與已結清', () => {
  const advances = decorateExpenseAdvances([
    { id: 'a', amount: 4500, repayments: [] },
    { id: 'b', amount: 4500, repayments: [{ amount: 2000 }] },
    { id: 'c', amount: 4500, repayments: [{ amount: 4500 }] },
  ]);

  assert.deepEqual(
    advances.map(({ status, outstandingAmount }) => ({ status, outstandingAmount })),
    [
      { status: 'outstanding', outstandingAmount: 4500 },
      { status: 'partial', outstandingAmount: 2500 },
      { status: 'settled', outstandingAmount: 0 },
    ],
  );
});

test('只有本帳務週期內收到的代墊款納入當期現金流', () => {
  const repayments = advanceRepaymentsInPeriod([{
    repayments: [
      { amount: 2000, receivedAt: '2026-08-20T03:00:00Z' },
      { amount: 2500, receivedAt: '2026-09-10T03:00:00Z' },
    ],
  }], '2026-08-05', '2026-09-04');

  assert.deepEqual(repayments.map((item) => item.amount), [2000]);
});

test('已結清代墊只在收回週期顯示，尚未結清者會跨期保留', () => {
  const advances = decorateExpenseAdvances([
    {
      id: 'outstanding',
      amount: 4500,
      repayments: [],
    },
    {
      id: 'settled-this-period',
      amount: 798,
      repayments: [{ amount: 798, receivedAt: '2026-08-20T03:00:00Z' }],
    },
    {
      id: 'settled-last-period',
      amount: 1000,
      repayments: [{ amount: 1000, receivedAt: '2026-07-20T03:00:00Z' }],
    },
  ]);

  assert.deepEqual(
    advancesVisibleInPeriod(advances, '2026-08-05', '2026-09-04').map(({ id }) => id),
    ['outstanding', 'settled-this-period'],
  );
  assert.deepEqual(
    advancesVisibleInPeriod(advances, '2026-09-05', '2026-10-04').map(({ id }) => id),
    ['outstanding'],
  );
});
