import assert from 'node:assert/strict';
import test from 'node:test';

import { LedgerModule } from './ledger-module.js';
import { InMemoryLedgerAdapter } from './ledger-module.test-support.js';

const defaultCategoryNames = ['飲食', '娛樂', '醫療', '交通', '生活', '訂閱'];

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
    defaultCategoryNames,
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
  assert.equal(secondLedger.categories.length, defaultCategoryNames.length);
});

test('沒有顯示名稱的使用者會取得「我的帳本」', async () => {
  const adapter = new InMemoryLedgerAdapter();
  const ledgerModule = new LedgerModule(adapter);

  const ledger = await ledgerModule.provisionPersonalLedger({
    userId: 'user-2',
  });

  assert.equal(ledger.name, '我的帳本');
});

test('帳本模組將原始使用者名稱交給資料層，不在前端拼接帳本名稱', async () => {
  let receivedInput;
  const adapter = {
    async findPersonalLedger() {
      return null;
    },
    async createPersonalLedger(input) {
      receivedInput = input;
      return { id: 'ledger-1' };
    },
  };

  const ledgerModule = new LedgerModule(adapter);
  await ledgerModule.provisionPersonalLedger({ userId: 'user-1', displayName: '小明' });

  assert.deepEqual(receivedInput, { ownerId: 'user-1', displayName: '小明' });
});

test('兩個同時的首次佈建仍只會留下同一個個人帳本', async () => {
  const adapter = new InMemoryLedgerAdapter();
  const ledgerModule = new LedgerModule(adapter);

  const [firstLedger, secondLedger] = await Promise.all([
    ledgerModule.provisionPersonalLedger({ userId: 'user-1', displayName: '小明' }),
    ledgerModule.provisionPersonalLedger({ userId: 'user-1', displayName: '小明' }),
  ]);

  assert.equal(firstLedger.id, secondLedger.id);
  assert.equal(adapter.countLedgers(), 1);
});

