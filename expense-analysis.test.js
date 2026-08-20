import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExpenseAnalysis,
  identifyMerchant,
  normalizeMerchantText,
} from './expense-analysis.js';

const period = { startsOn: '2026-08-05', endsOn: '2026-09-04' };
const previousPeriod = { startsOn: '2026-07-05', endsOn: '2026-08-04' };
const categories = [
  { id: 'food', name: '飲食', analysisNature: 'maintenance' },
  { id: 'fun', name: '娛樂', analysisNature: 'pleasure' },
  { id: 'transit', name: '交通', analysisNature: 'maintenance' },
];
const entry = (overrides = {}) => ({
  id: crypto.randomUUID(),
  category_id: 'food',
  item_name: '晚餐',
  amount: 100,
  occurred_at: '2026-08-05T12:00:00+08:00',
  is_fixed: false,
  ...overrides,
});

test('統一分析引擎產生完整生活開銷與兩種每日平均', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-09T12:00:00+08:00',
    categories,
    currentEntries: [entry({ amount: 2_510 })],
    fixedExpenses: [{ amount: 13_361 }],
  });

  assert.equal(analysis.period.elapsedDays, 5);
  assert.equal(analysis.period.totalDays, 31);
  assert.deepEqual(analysis.totals, {
    nonFixedTotal: 2_510,
    fixedExpenseTotal: 13_361,
    completeLivingSpend: 15_871,
    dailyAverage: 502,
    completeDailyAverage: 933,
    projectedCompleteLivingSpend: 28_923,
  });
});

test('已結束週期使用整期實際數字而不是推估值', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-10-01T12:00:00+08:00',
    categories,
    currentEntries: [entry({ amount: 15_559 })],
    fixedExpenses: [{ amount: 13_361 }],
  });

  assert.equal(analysis.period.elapsedDays, 31);
  assert.equal(analysis.totals.completeLivingSpend, 28_920);
  assert.equal(analysis.totals.projectedCompleteLivingSpend, 28_920);
});

test('星期消費分布以相同星期實際出現次數計算平均且排除固定開銷', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-19T12:00:00+08:00',
    categories,
    currentEntries: [
      entry({ occurred_at: '2026-08-05T12:00:00+08:00', amount: 100 }),
      entry({ occurred_at: '2026-08-12T12:00:00+08:00', amount: 300 }),
      entry({ occurred_at: '2026-08-19T12:00:00+08:00', amount: 500 }),
      entry({ occurred_at: '2026-08-19T10:00:00+08:00', amount: 9_500, is_fixed: true }),
    ],
  });

  const wednesday = analysis.weekdayDistribution.find((day) => day.label === '星期三');
  assert.deepEqual(wednesday, {
    index: 3, label: '星期三', shortLabel: '三', total: 900, occurrences: 3, average: 300,
  });
});

test('相同項目與店家別名合併後產生非固定開銷 Top 10', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-19T12:00:00+08:00',
    categories,
    currentEntries: [
      entry({ item_name: '711 早餐', amount: 39 }),
      entry({ item_name: '7-11 晚餐', amount: 100 }),
      entry({ item_name: '統一超商', amount: 80 }),
      entry({ item_name: '麥當勞', amount: 198 }),
      entry({ item_name: '房租', amount: 9_500, is_fixed: true }),
    ],
  });

  assert.deepEqual(analysis.topItems.slice(0, 2).map(({ name, amount, count }) => ({ name, amount, count })), [
    { name: '7-11', amount: 219, count: 3 },
    { name: '麥當勞', amount: 198, count: 1 },
  ]);
});

test('店家辨識忽略常見符號與英文大小寫，短英文別名不誤判一般單字', () => {
  assert.equal(normalizeMerchantText('７－１１ 早餐'), '711早餐');
  assert.equal(identifyMerchant('Family Mart 午餐').name, '全家');
  assert.equal(identifyMerchant('Kfc').name, '肯德基');
  assert.equal(identifyMerchant('book store'), null);
});

test('各國比例使用推估的完整生活開銷並固定比較四國', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-09T12:00:00+08:00',
    categories,
    currentEntries: [entry({ amount: 2_510 })],
    fixedExpenses: [{ amount: 13_361 }],
  });

  assert.deepEqual(analysis.countryComparisons.map(({ name, amount }) => ({ name, amount })), [
    { name: '台灣', amount: 30_000 },
    { name: '中國', amount: 20_000 },
    { name: '日本', amount: 58_000 },
    { name: '美國', amount: 90_000 },
  ]);
  assert.equal(Math.round(analysis.countryComparisons[0].ratio), 96);
});

test('速食與超商分析輸出次數、平均金額及占日常開銷比例', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-19T12:00:00+08:00',
    categories,
    currentEntries: [
      entry({ item_name: '麥當勞', amount: 198 }),
      entry({ item_name: 'KFC', amount: 202 }),
      entry({ item_name: '711 早餐', amount: 100 }),
      entry({ item_name: '晚餐', amount: 500 }),
    ],
  });

  assert.deepEqual(
    (({ total, count, average, share }) => ({ total, count, average, share: Math.round(share) }))(
      analysis.merchantAnalysis.fastFood,
    ),
    { total: 400, count: 2, average: 200, share: 40 },
  );
  assert.equal(Math.round(analysis.merchantAnalysis.convenience.share), 10);
});

test('娛樂預設為快樂支出且固定開銷不參與生活習慣分析', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-19T12:00:00+08:00',
    categories: categories.map(({ analysisNature, ...category }) => category),
    currentEntries: [
      entry({ category_id: 'fun', item_name: '電影', amount: 500 }),
      entry({ category_id: 'food', item_name: '早餐', amount: 100 }),
      entry({ category_id: 'fun', item_name: '訂閱', amount: 300, is_fixed: true }),
    ],
  });

  assert.equal(analysis.spendingNature.pleasure.amount, 500);
  assert.equal(Math.round(analysis.spendingNature.pleasure.share), 83);
  assert.equal(analysis.spendingNature.maintenance.amount, 100);
});

test('進行中週期使用相同經過天數比較並另保留完整上期總額', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-09T12:00:00+08:00',
    categories,
    currentEntries: [entry({ category_id: 'fun', amount: 1_000 })],
    previousEntries: [
      entry({ occurred_at: '2026-07-06T12:00:00+08:00', category_id: 'fun', amount: 400 }),
      entry({ occurred_at: '2026-07-20T12:00:00+08:00', category_id: 'fun', amount: 2_000 }),
    ],
  });

  assert.equal(analysis.comparison.label, '與 7 月比較');
  assert.equal(analysis.comparison.previousComparableTotal, 400);
  assert.equal(analysis.comparison.previousFullTotal, 2_400);
  assert.match(analysis.comparison.summary, /快樂支出.*增加 NT\$600/);
});

test('同期比較處理新增、本期無開銷、雙零省略與穩定文案', () => {
  const analysis = buildExpenseAnalysis({
    period,
    previousPeriod,
    now: '2026-08-09T12:00:00+08:00',
    categories,
    currentEntries: [entry({ category_id: 'transit', amount: 200 })],
    previousEntries: [entry({ occurred_at: '2026-07-06T12:00:00+08:00', category_id: 'food', amount: 200 })],
  });

  assert.equal(analysis.comparison.rows.find((row) => row.label === '交通').status, 'new');
  assert.equal(analysis.comparison.rows.find((row) => row.label === '飲食').status, 'none');
  assert.equal(analysis.comparison.rows.some((row) => row.label === '快樂支出'), false);
  assert.equal(analysis.comparison.summary, '本期消費結構大致穩定');
});
