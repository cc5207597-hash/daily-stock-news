#!/usr/bin/env node
// 一次性历史日报回填：把本地 output/ 的旧数据搬进 history/ 存档
// - 08-06: 旧 JSON（有 analyzed/sectorMatrix，无 fullNews/chartData）→ 用 renderHTML 渲染 HTML
// - 08-04/05: 自包含旧 HTML → 直接复制
// - 重建 dates.json（含 08-04 ~ 08-08 全量）
import { writeFileSync, readFileSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'output');
const HISTORY_DIR = join(ROOT, 'history');

import { renderHTML } from './build-daily.mjs';

const EMPTY_CHART = {
  etfTrend: { dates: [], datasets: [], hasData: false },
  sentiment: { hasData: false, labels: [], values: [] },
  heatmap: { hasData: false, sectors: [], levels: [], matrix: [] },
  direction: { hasData: false, sectors: [], directions: [], series: [] },
  timeWindow: { hasData: false, sectors: [], windows: [], series: [] },
};

// ── 08-06: 旧 JSON → 渲染 HTML + 存档 ───────────────
function backfillFromJson(dateStr) {
  const src = join(OUTPUT_DIR, `股市热点日报_${dateStr}.json`);
  if (!existsSync(src)) { console.log(`  ⏭ ${dateStr}: 无旧 JSON，跳过`); return false; }
  const j = JSON.parse(readFileSync(src, 'utf-8'));
  if (!(j.analyzed || []).length) { console.log(`  ⏭ ${dateStr}: analyzed 为空，跳过`); return false; }

  const payload = {
    date: dateStr,
    displayDate: j.displayDate || `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`,
    generatedAt: j.generatedAt || new Date().toISOString(),
    analyzed: (j.analyzed || []).map(n => ({ ...n, pubDate: n.pubDate })),
    sectorMatrix: j.sectorMatrix || [],
    keyPoints: j.keyPoints || [],
    marketSummary: j.marketSummary || '',
    isAi: j.isAi,
    fullNews: (j.analyzed || []).map(n => ({
      title: n.title_cn || n.title,
      description: n.description || '',
      guessedSector: n.category || '',
      pubDate: n.pubDate || null,
      source: n.source || '',
      link: n.link || '',
    })),
    etfData: j.etfData || [],
    chartData: j.chartData || EMPTY_CHART,
  };

  const html = renderHTML(payload, payload.displayDate, payload.etfData, payload.chartData);
  writeFileSync(join(HISTORY_DIR, `日报_${dateStr}.json`), JSON.stringify(payload, null, 2), 'utf-8');
  writeFileSync(join(HISTORY_DIR, `日报_${dateStr}.html`), html, 'utf-8');
  console.log(`  ✅ ${dateStr}: JSON(${j.analyzed.length}条) → HTML 渲染完成`);
  return true;
}

// ── 08-04/05: 旧自包含 HTML → 直接复制 ──────────────
function backfillFromHtml(dateStr) {
  const src = join(OUTPUT_DIR, `股市热点日报_${dateStr}.html`);
  if (!existsSync(src)) { console.log(`  ⏭ ${dateStr}: 无旧 HTML，跳过`); return false; }
  copyFileSync(src, join(HISTORY_DIR, `日报_${dateStr}.html`));
  console.log(`  ✅ ${dateStr}: HTML 复制完成`);
  return true;
}

// ── 重建 dates.json ────────────────────────────────
function rebuildDates() {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  const files = readdirSync(HISTORY_DIR);
  const dates = [...new Set(
    files
      .filter(f => f.startsWith('日报_') && /^\d{8}$/.test(f.replace('日报_', '').replace(/\.\w+$/, '')))
      .map(f => f.replace('日报_', '').replace(/\.\w+$/, ''))
      .filter(d => /^\d{8}$/.test(d))
  )].sort().reverse();
  writeFileSync(join(HISTORY_DIR, 'dates.json'), JSON.stringify({ dates }, null, 2), 'utf-8');
  console.log(`  ✅ dates.json: ${dates.length} 天 → ${dates.join(', ')}`);
  return dates;
}

if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });

console.log('📦 历史日报回填');
backfillFromJson('20260806');
backfillFromHtml('20260805');
backfillFromHtml('20260804');
const dates = rebuildDates();
console.log(`\n完成，history/ 共 ${dates.length} 天`);
