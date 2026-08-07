#!/usr/bin/env node
// ── 日报构建入口 ───────────────────────────────────────
// 编排 ETL 流水线: fetch → clean → analyze → render → save → notify

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(PROJECT_ROOT, 'output');

import { CONFIG } from '../pipeline/config.mjs';
import { formatTime, getTodayStr, getTodayDisplay } from '../pipeline/utils.mjs';
import { fetchAllNews, fetchETFData } from '../pipeline/fetch.mjs';
import { dedupAndClean, freshnessFilter } from '../pipeline/clean.mjs';
import { analyzeWithClaude } from '../pipeline/analyze.mjs';
import { loadETFHistory, saveETFHistory, accumulateETF, buildETFChartData, buildSentimentData, buildImpactHeatmap, buildDirectionChart, buildTimeWindowData, fetchETFHistoryKLine } from '../pipeline/charts.mjs';

// ── HTML 渲染 ──────────────────────────────────────────

export function renderHTML(result, todayDisplay, etfData, chartData) {
  const { analyzed, sectorMatrix, keyPoints, marketSummary, isAi, fullNews } = result;

  const impactCls = (imp) => imp === '极高' ? 'impact-vhigh' : imp === '高' ? 'impact-high' : imp === '中' ? 'impact-mid' : 'impact-low';
  const dirCls = (d) => (d || '').includes('利好') ? 'badge-bull' : (d || '').includes('利空') ? 'badge-bear' : (d === '中性' ? 'badge-neutral' : 'badge-mixed');
  const shockCls = (s) => s === '强' ? 'shock-strong' : s === '中' ? 'shock-mid' : 'shock-weak';

  const stats = {
    bull: analyzed.filter(n => (n.direction || '').includes('利好')).length,
    bear: analyzed.filter(n => (n.direction || '').includes('利空')).length,
    mixed: analyzed.filter(n => n.direction === '分化' || n.direction === '中性').length,
    vhigh: analyzed.filter(n => n.impact === '极高').length,
    high: analyzed.filter(n => n.impact === '高').length,
  };

  const newsCards = analyzed.map((n) => {
    const fresh = (Date.now() - new Date(n.pubDate).getTime()) < 12 * 3600 * 1000;
    return [
      `<div class="news-card" onclick="this.classList.toggle('expanded')">`,
      `<div class="card-left">`,
      `<div class="card-cat cat-${n.category === '半导体' ? 'semi' : n.category === '光模块' ? 'optics' : n.category === '创新药' ? 'pharma' : n.category === '黄金' ? 'gold' : 'other'}">${escHtml(n.category || '综合')}</div>`,
      fresh ? `<div class="fresh-badge">新</div>` : '',
      `</div>`,
      `<div class="card-right">`,
      `<div class="card-title">${escHtml(n.title_cn || n.title)}</div>`,
      isAi && n.title !== n.title_cn ? `<div class="card-original-title">原文: ${escHtml(n.title.substring(0, 120))}</div>` : '',
      `<div class="card-summary">${escHtml(n.summary_cn || n.description.substring(0, 100))}</div>`,
      `<div class="card-meta">`,
      `<span class="badge ${dirCls(n.direction)}">${n.direction}</span>`,
      `<span class="impact-tag ${impactCls(n.impact)}">${n.impact}</span>`,
      n.source ? `<span>${escHtml(n.source)}</span>` : '',
      `<span>${formatTime(n.pubDate)}</span>`,
      n.tickers && n.tickers !== '—' ? `<span class="ticker-inline">${escHtml(n.tickers)}</span>` : '',
      n.link ? ` <a href="${n.link}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="src-link">原文</a>` : '',
      `</div>`,
      `<div class="card-detail">`,
      `<div class="detail-grid">`,
      `<div><span class="dl">方向</span>${n.direction}</div>`,
      `<div><span class="dl">程度</span>${n.impact}</div>`,
      `<div><span class="dl">确定性</span>${n.certainty}</div>`,
      `<div><span class="dl">窗口</span>${n.time_window}</div>`,
      `</div>`,
      n.notes ? `<div class="verify-note">📝 ${escHtml(n.notes)}</div>` : '',
      `</div>`,
      `</div></div>`,
    ].join('\n');
  }).join('\n');

  // ── Full news list (all news of the day, grouped by sector, newest first) ──
  const SECTORS_ORDER = ['半导体', '光模块', '创新药', '黄金'];
  const fullNewsList = Array.isArray(fullNews) ? fullNews : [];
  const fullNewsGroups = SECTORS_ORDER.map((sector) => {
    const items = fullNewsList
      .filter(n => n.guessedSector === sector)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    if (items.length === 0) return '';
    const itemsHTML = items.map((n) => {
      const pubDate = n.pubDate instanceof Date ? n.pubDate : new Date(n.pubDate);
      const title = n.title_cn || n.title;
      // Only show the description when it is already Chinese — the description
      // is archived untranslated, and an English body would break the all-Chinese report.
      const rawDesc = String(n.description || '');
      const descCn = /[一-鿿]/.test(rawDesc) ? rawDesc.substring(0, 120) : '';
      const desc = descCn ? `<div class="fn-desc">${escHtml(descCn)}</div>` : '';
      const link = n.link ? ` <a href="${n.link}" target="_blank" rel="noopener" class="src-link">原文</a>` : '';
      const time = isNaN(pubDate.getTime()) ? '' : formatTime(pubDate);
      return [
        `<div class="fn-item">`,
        `<div class="fn-time">${time}</div>`,
        `<div class="fn-body">`,
        `<div class="fn-title">${escHtml(title)}</div>`,
        desc,
        `<div class="fn-meta">${n.source ? `<span>${escHtml(n.source)}</span>` : ''}${link}</div>`,
        `</div>`,
        `</div>`,
      ].join('\n');
    }).join('\n');
    return [
      `<div class="fn-group">`,
      `<div class="fn-group-head">${sector} <span class="fn-count">${items.length} 条</span></div>`,
      `<div class="fn-items">${itemsHTML}</div>`,
      `</div>`,
    ].join('\n');
  }).filter(Boolean).join('\n');

  const fullNewsSection = fullNewsGroups ? `
<div class="sec-title">📰 当日全部新闻 <span class="fn-total">${fullNewsList.length} 条 · 按板块分组 · 时间从近到远</span></div>
<div class="fn-wrap">${fullNewsGroups}</div>
` : '';

  const matrixRows = (Array.isArray(sectorMatrix) ? sectorMatrix : []).map(s =>
    `<tr><td style="font-weight:700;">${escHtml(s.name)}</td><td class="${shockCls(s.shock)}">${s.shock}</td><td style="color:${s.direction === '利好' ? '#16a34a' : s.direction === '利空' ? '#dc2626' : '#ea580c'};">${s.direction}</td><td>${s.news_count}</td><td>${escHtml(s.summary || s.logic || '')}</td><td>${escHtml(s.tickers || '—')}</td></tr>`
  ).join('\n');

  const pointsHTML = keyPoints.map(p => `<div class="kp-card">${escHtml(p)}</div>`).join('\n');

  // ── Chart panels ─────────────────────────────────────
  const hasCharts = chartData && (
    chartData.etfTrend?.hasData || chartData.sentiment?.hasData ||
    chartData.heatmap?.hasData || chartData.direction?.hasData ||
    chartData.timeWindow?.hasData
  );

  const chartPanels = hasCharts ? `
<div class="sec-title">📊 市场数据可视化</div>
<div class="chart-grid">
  ${chartData.etfTrend.hasData ? `
  <div class="chart-card wide-chart">
    <div class="chart-title">板块 ETF 走势对比（首日=100，30日）</div>
    <div class="chart-wrap"><canvas id="etfTrendChart"></canvas></div>
  </div>
  ` : ''}
  <div class="chart-card">
    <div class="chart-title">今日情绪分布</div>
    <div class="chart-wrap chart-donut"><canvas id="sentimentChart"></canvas></div>
  </div>
  <div class="chart-card">
    <div class="chart-title">板块方向对比</div>
    <div class="chart-wrap"><canvas id="directionChart"></canvas></div>
  </div>
  <div class="chart-card">
    <div class="chart-title">冲击热力图</div>
    <div class="chart-wrap"><canvas id="heatmapChart"></canvas></div>
  </div>
  <div class="chart-card">
    <div class="chart-title">时间窗口分布</div>
    <div class="chart-wrap chart-donut"><canvas id="timeWindowChart"></canvas></div>
  </div>
</div>
` : '';

  const chartJS = hasCharts ? `
<script>
${chartData.etfTrend?.hasData ? `
// ETF Trend
new Chart(document.getElementById('etfTrendChart'), {
  type: 'line',
  data: {
    labels: ${JSON.stringify(chartData.etfTrend.dates)},
    datasets: ${JSON.stringify(chartData.etfTrend.datasets)},
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 10 }, usePointStyle: true } },
      tooltip: { bodyFont: { size: 11 }, titleFont: { size: 11 } },
    },
    scales: {
      x: { ticks: { font: { size: 9 }, maxTicksLimit: 8, maxRotation: 45 }, grid: { display: false } },
      y: { ticks: { font: { size: 9 } }, grid: { color: '#f0f0f0' }, title: { display: true, text: '指数 (首日=100)', font: { size: 9 } } },
    },
  },
});
` : ''}
// Sentiment donut
new Chart(document.getElementById('sentimentChart'), {
  type: 'doughnut',
  data: {
    labels: ${JSON.stringify(chartData.sentiment.labels)},
    datasets: ${JSON.stringify(chartData.sentiment.datasets)},
  },
  options: {
    responsive: true, maintainAspectRatio: false, cutout: '55%',
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 8, padding: 10, font: { size: 10 }, usePointStyle: true } },
    },
  },
});

// Time window donut
new Chart(document.getElementById('timeWindowChart'), {
  type: 'doughnut',
  data: {
    labels: ${JSON.stringify(chartData.timeWindow.labels)},
    datasets: ${JSON.stringify(chartData.timeWindow.datasets)},
  },
  options: {
    responsive: true, maintainAspectRatio: false, cutout: '55%',
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 8, padding: 10, font: { size: 10 }, usePointStyle: true } },
    },
  },
});

// Direction stacked bar
new Chart(document.getElementById('directionChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(chartData.direction.sectors)},
    datasets: ${JSON.stringify(chartData.direction.datasets)},
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 8, padding: 8, font: { size: 10 }, usePointStyle: true } },
    },
    scales: {
      x: { stacked: true, ticks: { font: { size: 9 } }, grid: { display: false } },
      y: { stacked: true, ticks: { font: { size: 9 }, stepSize: 1 }, grid: { color: '#f0f0f0' } },
    },
  },
});

// Heatmap — using matrix plugin or bar fallback
new Chart(document.getElementById('heatmapChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(chartData.heatmap.sectors)},
    datasets: ${JSON.stringify(chartData.heatmap.impacts.map((imp, i) => ({
      label: imp,
      data: chartData.heatmap.sectors.map(s => chartData.heatmap.matrix[s]?.[imp] || 0),
      backgroundColor: imp === '极高' ? '#dc2626' : imp === '高' ? '#ea580c' : imp === '中' ? '#facc15' : '#16a34a',
    })))},
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    indexAxis: 'x',
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 8, padding: 8, font: { size: 10 }, usePointStyle: true } },
    },
    scales: {
      x: { stacked: false, ticks: { font: { size: 9 } }, grid: { display: false } },
      y: { stacked: false, ticks: { font: { size: 9 }, stepSize: 1 }, grid: { color: '#f0f0f0' } },
    },
  },
});
</script>
` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>行业板块日报 · ${todayDisplay}</title>
<style>
  :root {
    --bg:#f0f2f5; --card-bg:#fff; --border:#e2e4e9; --text:#1a1d28;
    --text-dim:#5f6570; --text-muted:#9ca0af; --accent:#2563eb;
    --semi:#7c3aed; --optics:#0891b2; --pharma:#0d9488; --gold:#d97706;
    --radius:12px; --shadow:0 1px 3px rgba(0,0,0,.04);
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh;-webkit-font-smoothing:antialiased;}
  .container{max-width:900px;margin:0 auto;padding:16px 12px 40px;}

  /* Header */
  .header{text-align:center;padding:28px 16px 16px;margin-bottom:16px;}
  .header h1{font-size:1.5rem;font-weight:800;color:#0f172a;letter-spacing:-0.02em;}
  .header .subtitle{font-size:.78rem;color:var(--text-dim);margin-top:2px;}
  .header .badge-row{margin-top:8px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;}
  .chip{padding:2px 10px;border-radius:14px;font-size:.68rem;font-weight:600;border:1px solid var(--border);background:var(--card-bg);}
  .chip-ai{color:#2563eb;border-color:#bfdbfe;background:#eff6ff;}
  .disclaimer{font-size:.68rem;color:#b91c1c;margin-top:10px;display:inline-block;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:6px 12px;}
  .refresh-btn{display:block;margin:10px auto 0;padding:6px 18px;font-size:.72rem;font-weight:600;color:#fff;background:var(--accent);border:none;border-radius:8px;cursor:pointer;transition:opacity .2s;}
  .refresh-btn:hover{opacity:.85;}
  .refresh-btn:disabled{opacity:.5;cursor:not-allowed;}
  .refresh-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999;padding:10px 20px;border-radius:10px;font-size:.78rem;font-weight:600;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;}
  .toast-ok{background:#059669;}
  .toast-err{background:#dc2626;}

  /* Stats mini */
  .stats-mini{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:16px;}
  .st{background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:4px 10px;font-size:.7rem;color:var(--text-dim);}
  .st b{color:var(--text);font-size:.82rem;margin:0 1px;}

  /* ETF grid */
  .etf-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;}
  @media(max-width:640px){.etf-grid{grid-template-columns:repeat(2,1fr);}}
  .etf-group{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;}
  .etf-group-name{font-size:.6rem;font-weight:700;padding:2px 8px;border-radius:6px;display:inline-block;color:#fff;margin-bottom:6px;}
  .cat-semi{background:var(--semi);}
  .cat-optics{background:var(--optics);}
  .cat-pharma{background:var(--pharma);}
  .cat-gold{background:var(--gold);}
  .etf-item{display:flex;justify-content:space-between;align-items:center;padding:3px 0;}
  .etf-name{font-size:.65rem;color:var(--text-dim);}
  .etf-price{font-size:.72rem;font-weight:700;font-variant-numeric:tabular-nums;}
  .etf-change{font-size:.65rem;font-weight:700;}
  .etf-item+.etf-item{border-top:1px solid var(--border);}

  /* Sector summary row */
  .sector-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px;}
  @media(max-width:640px){.sector-row{grid-template-columns:repeat(2,1fr);}}
  .sc{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;text-align:center;}
  .sc-name{font-weight:700;font-size:.82rem;margin-bottom:4px;}
  .sc-stat{font-size:.7rem;color:var(--text-dim);}
  .sc-stat strong{font-size:.9rem;}

  /* Section divider */
  .sec-title{display:flex;align-items:center;gap:8px;font-size:.82rem;font-weight:700;color:#0f172a;margin:20px 0 10px;}
  .sec-title::before{content:'';width:3px;height:16px;background:var(--accent);border-radius:2px;}

  /* News cards */
  .news-grid{display:grid;gap:6px;}
  .news-card{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;cursor:pointer;transition:box-shadow .15s,border-color .15s;display:flex;gap:10px;}
  .news-card:hover{box-shadow:var(--shadow);border-color:#c8cbd4;}
  .news-card.expanded{box-shadow:0 2px 8px rgba(0,0,0,.06);}
  .card-left{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:44px;}
  .card-cat{font-size:.6rem;font-weight:700;padding:3px 6px;border-radius:6px;text-align:center;white-space:nowrap;color:#fff;}
  .cat-other{background:#6b7280;}
  .fresh-badge{font-size:.55rem;font-weight:800;color:#fff;background:#ef4444;border-radius:3px;padding:1px 4px;}

  .card-right{flex:1;min-width:0;}
  .card-title{font-size:.85rem;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:2px;}
  .card-original-title{font-size:.67rem;color:var(--text-muted);margin-bottom:2px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .card-summary{font-size:.75rem;color:var(--text-dim);margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .card-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:.66rem;color:var(--text-muted);}
  .card-meta a{color:var(--accent);text-decoration:none;font-weight:600;}
  .src-link{padding-left:2px;}
  .badge{display:inline-flex;align-items:center;gap:2px;padding:1px 7px;border-radius:10px;font-size:.62rem;font-weight:700;}
  .badge-bull{background:#dcfce7;color:#15803d;}
  .badge-bear{background:#fee2e2;color:#b91c1c;}
  .badge-neutral{background:#fff7ed;color:#c2410c;}
  .badge-mixed{background:#fef3c7;color:#92400e;}
  .impact-tag{font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:3px;}
  .impact-vhigh{background:#fee2e2;color:#b91c1c;}
  .impact-high{background:#fff7ed;color:#c2410c;}
  .impact-mid{background:#fef9c3;color:#a16207;}
  .impact-low{background:#f0fdf4;color:#15803d;}
  .ticker-inline{color:#7c3aed;font-weight:600;font-size:.63rem;}

  /* Expand detail */
  .card-detail{display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:.72rem;color:var(--text);line-height:1.65;}
  .news-card.expanded .card-detail{display:block;}
  .detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:6px;}
  @media(max-width:480px){.detail-grid{grid-template-columns:repeat(2,1fr);}}
  .dl{display:block;font-size:.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;}
  .verify-note{font-size:.66rem;color:#b45309;font-style:italic;padding:5px 8px;background:#fffbeb;border-radius:6px;}

  /* Matrix table */
  .table-wrap{overflow-x:auto;margin-bottom:16px;border-radius:var(--radius);border:1px solid var(--border);}
  table{width:100%;border-collapse:collapse;font-size:.7rem;background:var(--card-bg);}
  th{background:#f8f9fb;color:var(--text-dim);padding:7px 10px;text-align:left;font-weight:600;white-space:nowrap;border-bottom:2px solid var(--border);font-size:.65rem;text-transform:uppercase;}
  td{padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top;}
  tr:last-child td{border-bottom:none;}
  .shock-strong{color:#dc2626;font-weight:700;}
  .shock-mid{color:#ea580c;font-weight:600;}
  .shock-weak{color:#16a34a;}

  /* Key points */
  .key-points{display:grid;gap:5px;margin-bottom:16px;}
  .kp-card{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;font-size:.76rem;line-height:1.5;border-left:3px solid var(--accent);}

  /* Full news list */
  .fn-total{font-weight:400;font-size:.66rem;color:var(--text-muted);}
  .fn-wrap{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;}
  @media(max-width:640px){.fn-wrap{grid-template-columns:1fr;}}
  .fn-group{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;align-self:start;}
  .fn-group-head{font-size:.72rem;font-weight:700;color:var(--text);padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:6px;}
  .fn-count{font-size:.62rem;font-weight:400;color:var(--text-muted);margin-left:4px;}
  .fn-items{display:flex;flex-direction:column;}
  .fn-item{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6;}
  .fn-item:last-child{border-bottom:none;}
  .fn-time{flex-shrink:0;font-size:.6rem;color:var(--text-muted);padding-top:2px;width:52px;font-variant-numeric:tabular-nums;}
  .fn-body{flex:1;min-width:0;}
  .fn-title{font-size:.72rem;font-weight:600;color:var(--text);line-height:1.4;}
  .fn-desc{font-size:.65rem;color:var(--text-dim);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .fn-meta{font-size:.6rem;color:var(--text-muted);margin-top:2px;display:flex;gap:6px;align-items:center;}
  .fn-meta a{color:var(--accent);text-decoration:none;font-weight:600;}

  .market-summary{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;font-size:.78rem;line-height:1.6;margin-bottom:16px;}

  /* History bar */
  .history-bar{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;}
  .history-bar label{font-size:.72rem;color:var(--text-dim);font-weight:600;}
  .history-bar select{padding:4px 10px;font-size:.72rem;border:1px solid var(--border);border-radius:8px;background:var(--card-bg);color:var(--text);cursor:pointer;max-width:200px;}
  .history-bar button{padding:4px 16px;font-size:.68rem;font-weight:600;border:1px solid var(--border);border-radius:8px;background:var(--card-bg);cursor:pointer;transition:all .15s;}
  .history-bar button:hover{background:#e8ecf1;}
  .history-bar button.active{background:var(--accent);color:#fff;border-color:var(--accent);}

  /* Footer */
  .footer{text-align:center;padding:14px;font-size:.66rem;color:var(--text-muted);border-top:1px solid var(--border);margin-top:20px;line-height:1.7;}
  .footer strong{color:#b91c1c;}

  /* Charts */
  .chart-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px;}
  @media(max-width:640px){.chart-grid{grid-template-columns:1fr;}}
  .chart-card{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;}
  .wide-chart{grid-column:1/-1;}
  .chart-title{font-size:.72rem;font-weight:700;color:var(--text-dim);margin-bottom:8px;}
  .chart-wrap{position:relative;width:100%;}
  .wide-chart .chart-wrap{height:240px;}
  .chart-card .chart-wrap{height:200px;}
  .chart-donut .chart-wrap{height:180px;max-width:240px;margin:0 auto;}
</style>
<script src="assets/chart.umd.min.js"></script>
</head>
<body>
<div class="container">

<div class="header">
  <h1>📡 行业板块日报</h1>
  <div class="subtitle">${todayDisplay} · ${analyzed.length} 条精选 · 半导体 / 光模块 / 创新药 / 黄金</div>
  <div class="badge-row">
    <span class="chip ${isAi ? 'chip-ai' : 'chip'}">${isAi ? 'AI 分析' : '关键词引擎'}</span>
    ${isAi ? '<span class="chip chip-ai">中文翻译</span>' : ''}
    <span class="chip">每交易日更新</span>
  </div>
  <div class="disclaimer">免责声明：基于公开信息自动整理，不构成投资建议。股市有风险，投资需谨慎。</div>
  <button class="refresh-btn" onclick="triggerRefresh()" title="手动刷新日报">🔄 刷新日报</button>
</div>

<div class="history-bar">
  <label>历史日报</label>
  <select id="historySelect" onchange="showHistoryDate()">
    <option value="">-- 选择日期 --</option>
  </select>
  <button id="today-btn" class="active" onclick="goToday()">今天</button>
</div>

<div class="stats-mini">
  <div class="st">📈利好 <b style="color:#15803d">${stats.bull}</b></div>
  <div class="st">📉利空 <b style="color:#dc2626">${stats.bear}</b></div>
  <div class="st">⚡极高 <b style="color:#dc2626">${stats.vhigh}</b></div>
  <div class="st">🔥高影响 <b style="color:#ea580c">${stats.high}</b></div>
  <div class="st">📊板块 <b>${sectorMatrix.length}</b></div>
</div>

${etfData.length > 0 ? `
<div class="sec-title">📈 板块 ETF 指标</div>
<div class="etf-grid">
${['半导体','光模块','创新药','黄金'].map(cat => {
  const items = etfData.filter(e => e.category === cat);
  if (!items.length) return '';
  const catClass = cat === '半导体' ? 'semi' : cat === '光模块' ? 'optics' : cat === '创新药' ? 'pharma' : 'gold';
  return '<div class="etf-group">' +
    '<div class="etf-group-name cat-' + catClass + '">' + cat + '</div>' +
    items.map(e => {
      const pctColor = e.change > 0 ? '#15803d' : e.change < 0 ? '#dc2626' : '#5f6570';
      const pctSign = e.change > 0 ? '+' : '';
      return '<div class="etf-item">' +
        '<span class="etf-name">' + escHtml(e.name) + '</span>' +
        '<span class="etf-price">' + e.price.toFixed(3) + '</span>' +
        '<span class="etf-change" style="color:' + pctColor + '">' + pctSign + e.change.toFixed(2) + '%</span>' +
        '</div>';
    }).join('') +
    '</div>';
}).filter(Boolean).join('')}
</div>
` : ''}

${sectorMatrix.length > 0 ? `
<div class="sec-title">板块速览</div>
<div class="sector-row">
${sectorMatrix.map(s => `
  <div class="sc">
    <div class="sc-name">${escHtml(s.name)}</div>
    <div class="sc-stat">
      <span class="badge ${dirCls(s.direction)}">${s.direction}</span>
      <span class="impact-tag ${impactCls(s.shock === '强' ? '极高' : s.shock === '中' ? '中' : '低')}">${s.shock}冲击</span>
      <br><strong>${s.news_count}</strong> 条新闻
    </div>
  </div>
`).join('')}
</div>
` : ''}

${marketSummary ? `<div class="market-summary">💡 ${escHtml(marketSummary)}</div>` : ''}

${chartPanels}

<div class="sec-title">新闻列表（按时间从近到远）</div>
<div class="news-grid">
${newsCards}
</div>

${fullNewsSection}

<div class="sec-title">板块冲击矩阵</div>
<div class="table-wrap">
  <table>
    <thead><tr><th>板块</th><th>冲击</th><th>方向</th><th>新闻</th><th>传导逻辑</th><th>关联标的</th></tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>
</div>

${keyPoints.length > 0 ? `
<div class="sec-title">今日要点</div>
<div class="key-points">${pointsHTML}</div>
` : ''}

<div class="footer">
  基于多源财经 API 自动抓取 · ${isAi ? 'Claude API 智能分析 + 中文翻译' : '关键词引擎自动分类'}<br>
  监控范围：半导体 / 光模块 / 创新药 / 黄金 &nbsp;|&nbsp; 包含韩国及美股半导体市场<br>
  不构成投资建议。<strong>股市有风险，投资需谨慎。</strong>
</div>

</div>
<script>
const REFRESH_URL = '';
async function triggerRefresh(){
  const btn = document.querySelector('.refresh-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 构建中...';
  try {
    const r = await fetch(REFRESH_URL + '/refresh', { method: 'POST' });
    const d = await r.json();
    if (r.ok) {
      showToast('已提交刷新，约2分钟后生效', 'ok');
      pollStatus();
    } else {
      showToast(d.message || '请求失败', 'err');
      resetBtn();
    }
  } catch(e) {
    showToast('刷新服务未启动，请本地运行 refresh-server.mjs', 'err');
    resetBtn();
  }
}
function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'refresh-toast toast-' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4000);
}
function resetBtn() {
  const btn = document.querySelector('.refresh-btn');
  btn.disabled = false;
  btn.textContent = '🔄 刷新日报';
}
async function pollStatus() {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const r = await fetch(REFRESH_URL + '/status');
      const d = await r.json();
      if (d.state === 'done') {
        showToast('刷新完成！3秒后自动重载', 'ok');
        setTimeout(() => location.reload(), 3000);
        return;
      }
      if (d.state === 'error') {
        showToast('刷新失败，请查看服务端日志', 'err');
        resetBtn();
        return;
      }
    } catch(e) { resetBtn(); return; }
  }
  showToast('构建超时，请稍后手动刷新页面', 'err');
  resetBtn();
}
// History browsing
async function loadHistoryDates(){
  const sel = document.getElementById('historySelect');
  if(!sel) return;
  try {
    const r = await fetch(REFRESH_URL + '/history/dates');
    const d = await r.json();
    sel.innerHTML = '<option value="">-- 选择日期 --</option>';
    (d.dates || []).forEach(dt => {
      const opt = document.createElement('option');
      opt.value = dt;
      const y=dt.slice(0,4), m=dt.slice(4,6), day=dt.slice(6,8);
      opt.textContent = y + '-' + m + '-' + day;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('加载历史日期失败', e); }
}
function showHistoryDate(){
  const sel = document.getElementById('historySelect');
  const dt = sel.value;
  if(!dt) return;
  window.location.href = REFRESH_URL + '/history?date=' + dt;
}
function goToday(){
  window.location.href = REFRESH_URL + '/';
}
document.addEventListener('DOMContentLoaded', loadHistoryDates);
</script>
${chartJS}
</body>
</html>`;
}

export function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 推送通知 ─────────────────────────────────────────────

async function sendNotification(result, etfData, dateStr) {
  if (!CONFIG.serverChanSendkey) {
    console.log('📤 推送通知: 未配置 (设置环境变量 SERVERCHAN_SENDKEY 以启用)');
    return;
  }

  console.log('\n📤 发送微信推送通知...');

  const { analyzed, sectorMatrix, keyPoints, marketSummary } = result;
  const bull = analyzed.filter(n => (n.direction || '').includes('利好')).length;
  const bear = analyzed.filter(n => (n.direction || '').includes('利空')).length;
  const vhigh = analyzed.filter(n => n.impact === '极高').length;

  const impactRank = { '极高': 0, '高': 1, '中': 2, '低': 3 };
  const top3 = [...analyzed].sort((a, b) => (impactRank[a.impact] || 9) - (impactRank[b.impact] || 9)).slice(0, 3);

  const etfLines = ['半导体', '光模块', '创新药', '黄金'].map(cat => {
    const items = etfData.filter(e => e.category === cat);
    if (!items.length) return '';
    const avg = items.reduce((s, e) => s + e.change, 0) / items.length;
    const emoji = avg > 0 ? '📈' : avg < 0 ? '📉' : '➖';
    return emoji + ' ' + cat + ': ' + (avg > 0 ? '+' : '') + avg.toFixed(2) + '%';
  }).filter(Boolean).join('  ');

  const displayDate = dateStr.slice(0,4) + '-' + dateStr.slice(4,6) + '-' + dateStr.slice(6,8);
  const title = '行业板块日报 · ' + displayDate;
  const desp = [
    '## 📡 ' + title,
    '',
    '> ' + (marketSummary ? marketSummary.substring(0, 100) + '...' : '今日产业动态已更新'),
    '',
    '**📊 核心数据**',
    '- 精选简讯: **' + analyzed.length + '** 条',
    '- 利好: <font color="green">' + bull + '</font> 条 | 利空: <font color="red">' + bear + '</font> 条',
    '- 极高影响: ' + vhigh + ' 条',
    '',
    '**🔥 重点关注**',
    ...top3.map((n, i) => (i + 1) + '. ' + n.title_cn + ' — *' + n.category + ' · ' + n.direction + ' · ' + n.impact + '*'),
    '',
    '**📈 板块 ETF**',
    etfLines || '暂无数据',
    '',
    '**💡 要点**',
    ...(keyPoints || []).slice(0, 3).map(p => '- ' + p),
    '',
    '---',
    '🤖 AI 分析 · ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  ].join('\n');

  const isNewKey = CONFIG.serverChanSendkey.startsWith('sctp');
  const apiUrl = isNewKey
    ? 'https://' + CONFIG.serverChanSendkey + '.push.ft07.com/send'
    : 'https://sctapi.ftqq.com/' + CONFIG.serverChanSendkey + '.send';

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ title, desp }),
      timeout: 15000,
    });
    if (resp.ok) {
      const data = await resp.json();
      console.log('  ✅ 推送成功 (' + (data?.data?.pushid || 'ok') + ')');
    } else {
      console.warn('  ⚠ 推送返回 ' + resp.status);
    }
  } catch (err) {
    console.warn('  ⚠ 推送失败: ' + err.message);
  }
}

// ── 主流程 ─────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  全球股市热点日报 · 自动构建');
  console.log('═══════════════════════════════════════');
  console.log(`  时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log(`  AI 分析: ${CONFIG.apiKey ? 'Claude API' : '未启用 (关键词引擎)'}`);
  console.log(`  Google News RSS: ${CONFIG.feeds.length} 源`);

  // 1. Fetch news and ETF data in parallel
  const [newsItems, etfData] = await Promise.all([fetchAllNews(), fetchETFData()]);

  // 2. Clean: dedup, classify, freshness filter
  const deduped = dedupAndClean(newsItems);
  const cleaned = freshnessFilter(deduped);
  console.log(`\n✅ 最终 ${cleaned.length} 条待分析新闻\n`);

  // 3. Analyze
  const result = await analyzeWithClaude(cleaned);

  // 4. Sort by date (newest first), then by impact
  const impactRank = { '极高': 0, '高': 1, '中': 2, '低': 3 };
  result.analyzed.sort((a, b) => {
    const db = new Date(b.pubDate) - new Date(a.pubDate);
    if (Math.abs(db) > 3600000) return db;
    const ia = impactRank[a.impact] || 9;
    const ib = impactRank[b.impact] || 9;
    return ia - ib;
  });

  // 5. Render HTML
  const todayDisplay = getTodayDisplay();

  // Load & accumulate ETF price history (backfill from Sina K-line first)
  console.log('\n📈 回填 ETF 历史数据 (新浪K线)...');
  let history;
  try {
    history = await fetchETFHistoryKLine(30);
  } catch (err) {
    console.warn(`  K线回填失败，使用本地历史: ${err.message}`);
    history = loadETFHistory(OUTPUT_DIR);
  }
  history = accumulateETF(history, etfData);

  // Build chart datasets
  const chartData = {
    etfTrend: buildETFChartData(history),
    sentiment: buildSentimentData(result.analyzed),
    heatmap: buildImpactHeatmap(result.analyzed),
    direction: buildDirectionChart(result.analyzed),
    timeWindow: buildTimeWindowData(result.analyzed),
  };

  const html = renderHTML(result, todayDisplay, etfData, chartData);

  // 6. Write files
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const dateStr = getTodayStr();

  // Save ETF history AFTER computing dateStr
  saveETFHistory(OUTPUT_DIR, history);

  const outPath = join(OUTPUT_DIR, `股市热点日报_${dateStr}.html`);
  writeFileSync(outPath, html, 'utf-8');
  console.log(`📄 输出: ${outPath}`);

  const indexPath = join(PROJECT_ROOT, 'index.html');
  writeFileSync(indexPath, html, 'utf-8');
  console.log(`📄 首页: ${indexPath}`);

  // 7. Save structured JSON for history browsing
  const buildPayload = {
    date: dateStr,
    displayDate: todayDisplay,
    generatedAt: new Date().toISOString(),
    analyzed: result.analyzed.map(n => ({
      title_cn: n.title_cn,
      summary_cn: n.summary_cn,
      category: n.category,
      direction: n.direction,
      impact: n.impact,
      certainty: n.certainty,
      time_window: n.time_window,
      tickers: n.tickers,
      notes: n.notes,
      title: n.title,
      description: n.description,
      pubDate: n.pubDate.toISOString(),
      source: n.source,
      link: n.link,
    })),
    sectorMatrix: result.sectorMatrix,
    keyPoints: result.keyPoints,
    marketSummary: result.marketSummary,
    isAi: result.isAi,
    fullNews: (result.fullNews || []).map(n => ({
      title: n.title_cn || n.title,
      description: n.description || '',
      guessedSector: n.guessedSector || '',
      pubDate: n.pubDate ? new Date(n.pubDate).toISOString() : null,
      source: n.source || '',
      link: n.link || '',
    })),
    etfData: etfData,
    chartData: chartData,
  };
  const jsonPath = join(OUTPUT_DIR, `股市热点日报_${dateStr}.json`);
  writeFileSync(jsonPath, JSON.stringify(buildPayload, null, 2), 'utf-8');
  console.log(`📋 数据: ${jsonPath}`);

  // 8. Send push notification
  await sendNotification(result, etfData, dateStr);

  console.log('\n✅ 完成！\n');
}

// ── 入口 ──────────────────────────────────────────────
// main() 只在 build-daily.mjs 被直接执行时运行。refresh-server.mjs 会
// import 本模块获取 renderHTML —— 若不判断，开机启动服务会顺带触发一次
// 完整抓取 + AI 分析（没联网时全部失败）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('❌ 构建失败:', err);
    process.exit(1);
  });
}
