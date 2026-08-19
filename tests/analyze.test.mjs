// ── 分析层降级路径单测 ──────────────────────────────────
// 零 npm 依赖,运行: node --test tests/
// 验证 analyze.mjs 的关键词引擎兜底:无 key / proxy 不可达 / 翻译失败 / 板块矩阵完整性。
// 注意:这些测试走纯本地引擎路径,不触发真实网络请求(本地无 ANTHROPIC_API_KEY,
// CONFIG.apiBase 指向 127.0.0.1 proxy,proxyReachable 探测失败即降级)。

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../pipeline/config.mjs';
import { analyzeWithKeywords, analyzeWithClaude, translateWithLocalDict, proxyReachable } from '../pipeline/analyze.mjs';
import { SECTORS } from '../pipeline/sectors.mjs';

// 清空 CONFIG.apiKey,确保走关键词引擎兜底(与本地无 key 的真实状态一致)
before(() => {
  CONFIG.apiKey = '';
  CONFIG.apiBase = 'http://127.0.0.1:15721';
});

const item = (title, description = '', guessedSector = '半导体') => ({
  title, description, guessedSector, pubDate: new Date(), source: '测试源',
});

// ── analyzeWithKeywords 核心产出 ───────────────────────

test('关键词引擎:返回结构化结果(isAi=false, 四板块矩阵)', async () => {
  const items = [
    item('英伟达营收创新高,业绩超预期', '数据中心 GPU 需求旺盛', '半导体'),
    item('金价创历史新高,央行持续购金', '', '黄金'),
  ];
  const r = await analyzeWithKeywords(items);
  assert.equal(r.isAi, false);
  assert.ok(Array.isArray(r.analyzed) && r.analyzed.length > 0);
  assert.ok(Array.isArray(r.sectorMatrix) && r.sectorMatrix.length === SECTORS.length);
  assert.ok(Array.isArray(r.keyPoints) && r.keyPoints.length > 0);
  assert.ok(typeof r.marketSummary === 'string' && r.marketSummary.length > 0);
});

test('关键词引擎:每条第中文标题+完整字段', async () => {
  const r = await analyzeWithKeywords([item('中芯国际先进制程突破', '产线投产', '半导体')]);
  const a = r.analyzed[0];
  assert.ok(a.title_cn, '应有 title_cn');
  assert.ok(['利好', '利空', '中性', '分化'].includes(a.direction));
  assert.ok(['极高', '高', '中', '低'].includes(a.impact));
  assert.ok(['高', '中', '低'].includes(a.certainty));
  assert.ok(['短期', '中期', '长期'].includes(a.time_window));
});

test('关键词引擎:命中硬信号 → 利好/方向', async () => {
  const r = await analyzeWithKeywords([item('XX公司营收创新高,业绩超预期', '', '半导体')]);
  const a = r.analyzed[0];
  assert.equal(a.direction, '利好');
  assert.ok(a.notes.includes('评分引擎'), 'notes 应含可审计的评分依据');
});

// ── 降级路径触发 ──────────────────────────────────────

test('analyzeWithClaude:无 apiKey → 自动降级到关键词引擎(零 AI 调用)', async () => {
  const items = [item('金价创历史新高', '', '黄金')];
  const r = await analyzeWithClaude(items);
  assert.equal(r.isAi, false);
  assert.equal(r.analyzed.length, 1);
  assert.equal(r.analyzed[0].category, '黄金');
});

test('analyzeWithClaude:本地 proxy 不可达 → 关键词引擎兜底,不空等', async () => {
  // CONFIG.apiBase 已是 127.0.0.1:15721,且本地通常无 proxy → 应快速降级
  const reachable = await proxyReachable();
  const r = await analyzeWithClaude([item('中芯国际扩产', '', '半导体')]);
  assert.equal(r.isAi, false);
  assert.equal(typeof reachable, 'boolean');
});

// ── 翻译与词典 ─────────────────────────────────────────

test('translateWithLocalDict:英文 → 中文金融术语', () => {
  assert.match(translateWithLocalDict('SK hynix earnings beat'), /SK海力士/);
  assert.match(translateWithLocalDict('Nvidia stock surges'), /英伟达/);
});

test('translateWithLocalDict:裸 AI 不误伤词内子串', () => {
  assert.ok(!translateWithLocalDict('Shanghai market').includes('ShanghAI'));
  assert.ok(translateWithLocalDict('AI chip demand').includes('AI'));
});

// ── 降级产物质量:确保不空壳 ───────────────────────────

test('降级产物:板块矩阵每块有中文 summary,不至于空', async () => {
  const items = [
    item('英伟达业绩超预期', 'GPU 需求旺盛', '半导体'),
    item('光模块 800G 订单饱满', '中际旭创放量', '光模块'),
    item('创新药 FDA 批准上市', 'III期临床成功', '创新药'),
    item('央行购金,金价大涨', '黄金储备上升', '黄金'),
  ];
  const r = await analyzeWithKeywords(items);
  for (const s of r.sectorMatrix) {
    assert.ok(s.summary && s.summary.length > 0, `${s.name} summary 不应为空`);
    assert.ok(s.news_count >= 0, `${s.name} news_count 应 >=0`);
  }
});

// ── ETF 硬校准:板块方向以当日 ETF 涨跌为准 ─────────────

test('关键词引擎:大跌板块矩阵被 ETF 校准为利空', async () => {
  const etfData = [
    { category: '半导体', change: -8.2 },
    { category: '光模块', change: -7.9 },
    { category: '创新药', change: -2.3 },
    { category: '黄金', change: -1.1 },
  ];
  const r = await analyzeWithKeywords(
    [item('半导体板块继续调整', '光刻胶概念走弱', '半导体')],
    etfData,
  );
  const sem = r.sectorMatrix.find(s => s.name === '半导体');
  assert.equal(sem.direction, '利空');
  // 逐条方向:中性条目随行情调向(卡片/情绪图一致)
  const a = r.analyzed.find(n => n.category === '半导体');
  assert.equal(a.direction, '利空');
  assert.match(a.notes, /ETF/);
});

test('关键词引擎:±1% 内涨跌不干预新闻研判', async () => {
  const etfData = [{ category: '黄金', change: 0.6 }];
  const r = await analyzeWithKeywords([item('央行购金,金价大涨', '', '黄金')], etfData);
  const gold = r.sectorMatrix.find(s => s.name === '黄金');
  assert.equal(gold.direction, '利好'); // 央行购金基本面利好,不被 ±1% 行情覆盖
});
