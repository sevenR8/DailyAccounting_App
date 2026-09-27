import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const start = appSource.indexOf('  const openSearchExpenseDetail = (entry) => {');
const end = appSource.indexOf("  expenseSearchForm?.addEventListener('submit'", start);
assert.ok(start >= 0 && end > start, '搜尋結果點擊處理函式必須存在');
const openDetailSource = appSource.slice(start, end);

test('手機搜尋結果即使也在近期紀錄，仍開啟搜尋頁自己的編輯內容', () => {
  const fields = Object.fromEntries([
    'itemName', 'amount', 'categoryId', 'paymentMethod', 'occurredAt',
    'itemDetail', 'includeInDailyAverage', 'isReimbursement',
  ].map((name) => [name, {}]));
  const form = { dataset: {}, elements: fields, querySelector: () => ({ textContent: '' }) };
  const deleteButton = { dataset: {} };
  const openedDialogs = [];
  const entry = {
    id: 'recent-1', is_fixed: false, item_name: '麥當勞', amount: 154,
    category_id: 'food', payment_method: 'credit_card',
    occurred_at: '2026-09-22T12:00:00+08:00', item_detail: '午餐',
  };
  runInNewContext(`${openDetailSource}\nopenSearchExpenseDetail(entry);`, {
    entry,
    document: { getElementById: () => ({ id: 'expense-edit-recent-1' }) },
    searchExpenseEditForm: form,
    searchExpenseEditDeleteButton: deleteButton,
    toDateTimeLocalValue: () => '2026-09-22T12:00',
    openDialog: (id) => openedDialogs.push(id),
  });

  assert.deepEqual(openedDialogs, ['search-expense-edit-dialog']);
  assert.equal(form.dataset.entryId, entry.id);
  assert.equal(fields.itemDetail.value, '午餐');
});
