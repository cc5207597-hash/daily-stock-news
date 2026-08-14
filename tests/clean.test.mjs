// ── 清洗层单测 ───────────────────────────────────────────
// 零 npm 依赖,运行: node --test tests/
// 验证 clean.mjs 的去重 key、direct_api 优先替换、去噪、板块分类联动。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupKey, dedupAndClean } from '../pipeline/clean.mjs';

// ── dedupKey ────────────────────────────────────────────

test('dedupKey:小写化、去标点空格、截断 50 字', () => {
  assert.equal(dedupKey('  三星 存储 涨价！'), dedupKey('三星存储涨价'));
  assert.equal(dedupKey('Apple, Inc. 发布'), dedupKey('apple inc 发布'));
  assert.ok(dedupKey('中'.repeat(80)).length <= 50, '超长标题被截断');
});

test('dedupKey:纯中文不被清空(保留 CJK)', () => {
  assert.ok(dedupKey('黄金价格创历史新高').length > 0);
});

test('dedupKey:空标题 → 空 key', () => {
  assert.equal(dedupKey(''), '');
  assert.equal(dedupKey(null), '');
  assert.equal(dedupKey(undefined), '');
});

test('dedupKey:大小写/英文标点不敏感', () => {
  assert.equal(dedupKey('Nvidia Jumps 10%'), dedupKey('nvidia jumps 10%'));
});

// ── dedupAndClean:去重 ──────────────────────────────────

test('完全重复标题只保留一条', () => {
  const items = [
    { title: '英伟达营收创新高', description: 'a', sourceType: 'direct_api' },
    { title: '英伟达营收创新高', description: 'b', sourceType: 'direct_api' },
  ];
  const out = dedupAndClean(items);
  assert.equal(out.length, 1);
});

test('direct_api 优先替换 RSS 同题(保留 API 版)', () => {
  const items = [
    { title: '台积电 Q2 业绩超预期', description: 'rss版', sourceType: 'rss' },
    { title: '台积电 Q2 业绩超预期', description: 'api版', sourceType: 'direct_api' },
  ];
  const out = dedupAndClean(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].description, 'api版', '应保留 direct_api 版');
  assert.equal(out[0].sourceType, 'direct_api');
});

test('两个 RSS 同题只保留第一条(不替换)', () => {
  const items = [
    { title: '中芯国际扩产', description: 'rss1', sourceType: 'rss' },
    { title: '中芯国际扩产', description: 'rss2', sourceType: 'rss' },
  ];
  const out = dedupAndClean(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].description, 'rss1');
});

// ── dedupAndClean:去噪 ──────────────────────────────────

test('聚合快讯噪声被丢弃', () => {
  const items = [
    { title: '1. 特斯拉：股价新高', description: '', sourceType: 'direct_api' },
    { title: '2、美联储维持利率不变', description: '', sourceType: 'direct_api' },
  ];
  const out = dedupAndClean(items);
  assert.equal(out.length, 0, '枚举式聚合快讯应被去噪');
});

// ── dedupAndClean:板块分类联动 ─────────────────────────

test('分类后仅保留四板块相关新闻', () => {
  const items = [
    { title: '中芯国际先进制程突破', description: '', sourceType: 'direct_api' },
    { title: '某地今日天气晴', description: '', sourceType: 'direct_api' },
  ];
  const out = dedupAndClean(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].guessedSector, '半导体');
});

test('黄金假阳性被 exclude 拦截(黄金周 → 不分类)', () => {
  const items = [
    { title: '十一黄金周旅游数据亮眼', description: '', sourceType: 'direct_api' },
  ];
  const out = dedupAndClean(items);
  assert.equal(out.length, 0, '「黄金周」不应误分类为黄金板块');
});
