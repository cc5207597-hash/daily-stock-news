// ── 评分引擎单测 ────────────────────────────────────────
// 零 npm 依赖,运行: node --test tests/
// 验证 sentiment.mjs 的方向/冲击/certainty/time_window/板块冲击判定。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreNewsItem, sectorShock, sanitizeRating, SIGNALS } from '../pipeline/sentiment.mjs';

const item = (title, description = '', guessedSector = '') => ({ title, description, guessedSector });

test('信号表:每条信号枚举合法且字段齐全', () => {
  for (const s of SIGNALS) {
    assert.ok(['利好', '利空', '中性', '分化'].includes(s.dir), `dir 非法: ${s.cat}`);
    assert.ok(typeof s.base === 'number' && s.base > 0, `base 非法: ${s.cat}`);
    assert.ok(typeof s.weight === 'number' && s.weight > 0, `weight 非法: ${s.cat}`);
    assert.ok(Array.isArray(s.kw) && s.kw.length > 0, `kw 为空: ${s.cat}`);
    if (s.sectors) assert.ok(s.sectors.every(x => ['半导体', '光模块', '创新药', '黄金'].includes(x)));
  }
});

test('单硬信号:业绩超预期 → 利好/高', () => {
  const r = scoreNewsItem(item('XX公司营收创新高,业绩超预期', ''));
  assert.equal(r.direction, '利好');
  assert.ok(['高', '极高'].includes(r.impact));
  assert.equal(r.certainty, '高');
  assert.equal(r.time_window, '短期');
  assert.match(r.notes, /业绩/);
});

test('单硬信号:FDA 批准 → 创新药 极高利好(板块限定生效)', () => {
  const r = scoreNewsItem(item('FDA批准XX新药上市申请', '', '创新药'));
  assert.equal(r.direction, '利好');
  assert.equal(r.impact, '极高');
  assert.match(r.notes, /临床/);
});

test('板块限定:FDA 批准但属半导体板块 → 不命中(中性)', () => {
  const r = scoreNewsItem(item('FDA批准XX', '', '半导体'));
  assert.equal(r.direction, '中性');
  assert.equal(r.impact, '低');
});

test('制裁 → 半导体/光模块 分化', () => {
  for (const sector of ['半导体', '光模块']) {
    const r = scoreNewsItem(item('美国对华半导体出口管制升级,实体清单扩容', '', sector));
    assert.equal(r.direction, '分化');
    assert.ok(['中', '高'].includes(r.impact));
    assert.match(r.notes, /分化|制裁|政策/);
  }
});

test('利多利空并存 → 分化', () => {
  const r = scoreNewsItem(item('XX营收翻倍(利好)但下调业绩指引(利空)', ''));
  assert.equal(r.direction, '分化');
});

test('无命中 → 中性/低', () => {
  const r = scoreNewsItem(item('今日天气晴朗适合出行', ''));
  assert.equal(r.direction, '中性');
  assert.equal(r.impact, '低');
  assert.equal(r.certainty, '低');
});

test('降息 → 黄金 利好(宏观板块限定)', () => {
  const r = scoreNewsItem(item('美联储宣布降息25个基点', '', '黄金'));
  assert.equal(r.direction, '利好');
  assert.ok(['中', '高'].includes(r.impact));
});

test('降息但不属黄金板块 → 不命中', () => {
  const r = scoreNewsItem(item('美联储宣布降息25个基点', '', '半导体'));
  assert.equal(r.direction, '中性');
});

test('板块冲击:极高利好+高利空 → 强', () => {
  const items = [
    { direction: '利好', impact: '极高' },
    { direction: '利空', impact: '高' },
  ];
  assert.equal(sectorShock(items), '强');
});

test('板块冲击:两条低中性 → 弱', () => {
  const items = [
    { direction: '中性', impact: '低' },
    { direction: '中性', impact: '低' },
  ];
  assert.equal(sectorShock(items), '弱');
});

test('板块冲击:空列表 → 弱', () => {
  assert.equal(sectorShock([]), '弱');
});

test('板块冲击:一条中中性 → 弱(中中性=2×0.3=0.6,低于3分档)', () => {
  assert.equal(sectorShock([{ direction: '中性', impact: '中' }]), '弱');
});

test('sanitizeRating:非法枚举回退默认', () => {
  const r = sanitizeRating({ direction: '涨停', impact: '爆炸', certainty: '?', time_window: '明天' });
  assert.equal(r.direction, '中性');
  assert.equal(r.impact, '中');
  assert.equal(r.certainty, '低');
  assert.equal(r.time_window, '中期');
});
