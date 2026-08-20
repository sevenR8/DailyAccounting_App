import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAmountExpression } from './amount-expression.js';

test('快速記帳金額可將多個新台幣整數相加', () => {
  assert.equal(parseAmountExpression('39+100+80'), 219);
  assert.equal(parseAmountExpression('39 ＋ 100'), 139);
  assert.equal(parseAmountExpression('100'), 100);
});

test('未完成或不是加法的金額算式不會被儲存', () => {
  assert.equal(parseAmountExpression('39+'), null);
  assert.equal(parseAmountExpression('39-10'), null);
  assert.equal(parseAmountExpression('0'), null);
  assert.equal(parseAmountExpression('9999999999999999+1'), null);
});
