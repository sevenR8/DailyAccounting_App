import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExpenseTemplates,
  dailyExpenseTotalTone,
  findExpenseTemplates,
  groupExpenseEntriesByDay,
  inferFrequentPaymentMethod,
} from './daily-history.js';

test('每日紀錄以台灣日期合併並分別加總現金與信用卡', () => {
  const days = groupExpenseEntriesByDay([
    { id: '3', amount: 80, payment_method: 'cash', occurred_at: '2026-08-18T17:30:00.000Z' },
    { id: '2', amount: 120, payment_method: 'credit_card', occurred_at: '2026-08-18T16:30:00.000Z' },
    { id: '1', amount: 100, payment_method: 'cash', occurred_at: '2026-08-18T03:30:00.000Z' },
  ]);

  assert.deepEqual(days.map((day) => ({
    key: day.key,
    total: day.total,
    cashTotal: day.cashTotal,
    creditCardTotal: day.creditCardTotal,
    entryIds: day.entries.map((entry) => entry.id),
  })), [
    { key: '2026-08-19', total: 200, cashTotal: 80, creditCardTotal: 120, entryIds: ['3', '2'] },
    { key: '2026-08-18', total: 100, cashTotal: 100, creditCardTotal: 0, entryIds: ['1'] },
  ]);
});

test('每日總開銷使用排除代墊後的個人負擔，付款方式仍保留實付金額', () => {
  const personalAmountsByEntryId = new Map([
    ['advance', 0],
    ['meal', 97],
    ['store', 60],
  ]);
  const [day] = groupExpenseEntriesByDay([
    { id: 'advance', amount: 798, payment_method: 'cash', occurred_at: '2026-08-20T15:25:00.000Z' },
    { id: 'meal', amount: 97, payment_method: 'credit_card', occurred_at: '2026-08-20T10:33:00.000Z' },
    { id: 'store', amount: 60, payment_method: 'credit_card', occurred_at: '2026-08-20T04:43:00.000Z' },
  ], personalAmountsByEntryId);

  assert.equal(day.total, 157);
  assert.equal(day.cashTotal, 798);
  assert.equal(day.creditCardTotal, 157);
});

test('每日總開銷依金額門檻顯示白、綠、藍、紅色', () => {
  assert.equal(dailyExpenseTotalTone(150), 'white');
  assert.equal(dailyExpenseTotalTone(151), 'green');
  assert.equal(dailyExpenseTotalTone(350), 'green');
  assert.equal(dailyExpenseTotalTone(351), 'blue');
  assert.equal(dailyExpenseTotalTone(550), 'blue');
  assert.equal(dailyExpenseTotalTone(999), 'blue');
  assert.equal(dailyExpenseTotalTone(1000), 'red');
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

test('重複歷史帳目會合併成常用範本並依使用次數與最近使用排序', () => {
  const templates = buildExpenseTemplates([
    { id: '1', amount: 39, item_name: '早餐', category_id: 'food', payment_method: 'credit_card', occurred_at: '2026-08-17T01:00:00Z', is_fixed: false },
    { id: '2', amount: 39, item_name: '早餐', category_id: 'food', payment_method: 'credit_card', occurred_at: '2026-08-18T01:00:00Z', is_fixed: false },
    { id: '3', amount: 100, item_name: '午餐', category_id: 'food', payment_method: 'cash', occurred_at: '2026-08-19T01:00:00Z', is_fixed: false },
    { id: '4', amount: 9500, item_name: '房租', category_id: 'life', payment_method: 'cash', occurred_at: '2026-08-05T01:00:00Z', is_fixed: true },
  ]);

  assert.equal(templates.length, 2);
  assert.deepEqual(templates[0], {
    key: '[39,"早餐","","food","credit_card"]',
    amount: 39,
    itemName: '早餐',
    itemDetail: '',
    categoryId: 'food',
    paymentMethod: 'credit_card',
    usageCount: 2,
    lastUsedAt: '2026-08-18T01:00:00Z',
  });
});

test('輸入金額後只顯示相同金額的多筆常用與最近範本', () => {
  const templates = buildExpenseTemplates([
    { amount: 39, item_name: '早餐', category_id: 'food', payment_method: 'credit_card', occurred_at: '2026-08-18T01:00:00Z' },
    { amount: 39, item_name: '茶葉蛋', category_id: 'food', payment_method: 'cash', occurred_at: '2026-08-19T01:00:00Z' },
    { amount: 100, item_name: '晚餐', category_id: 'food', payment_method: 'cash', occurred_at: '2026-08-19T02:00:00Z' },
  ]);

  assert.deepEqual(
    findExpenseTemplates(templates, '39', 5).map((template) => template.itemName),
    ['茶葉蛋', '早餐'],
  );
});

test('依相同項目或店家歷史習慣推斷主要付款方式', () => {
  const templates = buildExpenseTemplates([
    { amount: 39, item_name: '711 早餐', category_id: 'food', payment_method: 'credit_card', occurred_at: '2026-08-17T01:00:00Z' },
    { amount: 45, item_name: '7-11 午餐', category_id: 'food', payment_method: 'credit_card', occurred_at: '2026-08-18T01:00:00Z' },
    { amount: 100, item_name: '麥當勞', category_id: 'food', payment_method: 'credit_card', occurred_at: '2026-08-18T02:00:00Z' },
    { amount: 100, item_name: '麥當勞', category_id: 'food', payment_method: 'cash', occurred_at: '2026-08-19T02:00:00Z' },
  ]);
  const identifyMerchant = (itemName) => /7-11|711/.test(itemName)
    ? { name: '7-11' }
    : /麥當勞/.test(itemName)
      ? { name: '麥當勞' }
      : null;

  assert.equal(inferFrequentPaymentMethod('711', templates, identifyMerchant), 'credit_card');
  assert.equal(inferFrequentPaymentMethod('麥當勞', templates, identifyMerchant), null);
  assert.equal(inferFrequentPaymentMethod('沒有歷史的項目', templates, identifyMerchant), null);
});
