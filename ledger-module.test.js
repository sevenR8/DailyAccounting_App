import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CATEGORY_NAMES, InMemoryLedgerAdapter, LedgerModule } from './ledger-module.js';

test('首次登入會建立個人帳本、擁有者成員與六個預設分類', async () => {
  const adapter = new InMemoryLedgerAdapter();
  const ledgerModule = new LedgerModule(adapter);

  const ledger = await ledgerModule.provisionPersonalLedger({
    userId: 'user-1',
    displayName: '小明',
  });

  assert.equal(ledger.ownerId, 'user-1');
  assert.equal(ledger.name, '小明的帳本');
  assert.deepEqual(ledger.members, [{ userId: 'user-1', role: 'owner' }]);
  assert.deepEqual(
    ledger.categories.map((category) => category.name),
    DEFAULT_CATEGORY_NAMES,
  );
});

test('重複登入會取得既有帳本而不建立重複分類', async () => {
  const adapter = new InMemoryLedgerAdapter();
  const ledgerModule = new LedgerModule(adapter);

  const firstLedger = await ledgerModule.provisionPersonalLedger({
    userId: 'user-1',
    displayName: '小明',
  });
  const secondLedger = await ledgerModule.provisionPersonalLedger({
    userId: 'user-1',
    displayName: '更改後的名稱',
  });

  assert.equal(secondLedger.id, firstLedger.id);
  assert.equal(adapter.countLedgers(), 1);
  assert.equal(secondLedger.categories.length, DEFAULT_CATEGORY_NAMES.length);
});

test('沒有顯示名稱的使用者會取得「我的帳本」', async () => {
  const adapter = new InMemoryLedgerAdapter();
  const ledgerModule = new LedgerModule(adapter);

  const ledger = await ledgerModule.provisionPersonalLedger({
    userId: 'user-2',
  });

  assert.equal(ledger.name, '我的帳本');
});

