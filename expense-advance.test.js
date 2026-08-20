import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceRepaymentsInPeriod,
  applyPersonalExpenseAmounts,
  decorateExpenseAdvances,
} from './expense-advance.js';

test('代墊保留實際支付金額，消費分析只計入自己負擔額', () => {
  const [entry] = applyPersonalExpenseAmounts(
    [{ id: 'hotel', amount: 9000 }],
    [{ expenseEntryId: 'hotel', amount: 4500 }],
  );

  assert.equal(entry.paid_amount, 9000);
  assert.equal(entry.amount, 4500);
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
