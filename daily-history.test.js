import assert from 'node:assert/strict';
import test from 'node:test';

import { groupExpenseEntriesByDay } from './daily-history.js';

test('每日紀錄以台灣日期合併並分別加總現金與信用卡', () => {
  const days = groupExpenseEntriesByDay([
    { id: '3', amount: 80, payment_method: 'cash', occurred_at: '2026-08-18T17:30:00.000Z' },
    { id: '2', amount: 120, payment_method: 'credit_card', occurred_at: '2026-08-18T16:30:00.000Z' },
    { id: '1', amount: 100, payment_method: 'cash', occurred_at: '2026-08-18T03:30:00.000Z' },
  ]);

  assert.deepEqual(days.map((day) => ({
    key: day.key,
    cashTotal: day.cashTotal,
    creditCardTotal: day.creditCardTotal,
    entryIds: day.entries.map((entry) => entry.id),
  })), [
    { key: '2026-08-19', cashTotal: 80, creditCardTotal: 120, entryIds: ['3', '2'] },
    { key: '2026-08-18', cashTotal: 100, creditCardTotal: 0, entryIds: ['1'] },
  ]);
});

test('每日紀錄不限制筆數且維持日期與時間由新到舊', () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    amount: 10,
    payment_method: 'cash',
    occurred_at: `2026-08-18T0${index}:00:00.000Z`,
  }));

  const [day] = groupExpenseEntriesByDay(entries);

  assert.equal(day.entries.length, 8);
  assert.deepEqual(day.entries.map((entry) => entry.id), ['7', '6', '5', '4', '3', '2', '1', '0']);
});

