// ── Pipeline: 图表数据准备 ─────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Pick representative ETF per sector
const SECTOR_ETF = {
  '半导体': '159995',
  '光模块': '515050',
  '创新药': '515120',
  '黄金': '518880',
};

const SECTOR_COLORS = {
  '半导体': '#7c3aed',
  '光模块': '#0891b2',
  '创新药': '#0d9488',
  '黄金': '#d97706',
};

const SECTOR_PALETTE = [
  '#7c3aed', '#0891b2', '#0d9488', '#d97706',
  '#dc2626', '#16a34a', '#ea580c', '#2563eb',
];

// ── ETF 历史价格趋势 ───────────────────────────────────

export function loadETFHistory(outputDir) {
  const path = join(outputDir, 'etf_history.json');
  if (!existsSync(path)) return { dates: [], prices: {} };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { dates: [], prices: {} };
  }
}

export function saveETFHistory(outputDir, history) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'etf_history.json'), JSON.stringify(history, null, 2), 'utf-8');
}

// Append today's ETF data to the history and keep last N entries
export function accumulateETF(history, etfData, maxDays = 60) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // If today is already recorded, replace it
  const existingIdx = history.dates.indexOf(dateStr);
  if (existingIdx >= 0) {
    for (const [sector, etfCode] of Object.entries(SECTOR_ETF)) {
      const items = etfData.filter(e => e.category === sector);
      if (items.length > 0) {
        const avg = items.reduce((s, e) => s + e.price, 0) / items.length;
        history.prices[sector][existingIdx] = parseFloat(avg.toFixed(4));
      }
    }
  } else {
    history.dates.push(dateStr);
    for (const [sector, etfCode] of Object.entries(SECTOR_ETF)) {
      if (!history.prices[sector]) history.prices[sector] = [];
      const items = etfData.filter(e => e.category === sector);
      const avg = items.length > 0 ? items.reduce((s, e) => s + e.price, 0) / items.length : null;
      history.prices[sector].push(avg !== null ? parseFloat(avg.toFixed(4)) : null);
    }
  }

  // Trim to maxDays
  if (history.dates.length > maxDays) {
    const cut = history.dates.length - maxDays;
    history.dates = history.dates.slice(cut);
    for (const sector of Object.keys(history.prices)) {
      history.prices[sector] = history.prices[sector].slice(cut);
    }
  }

  return history;
}

// Normalize a series to a base-100 index so sectors with very different
// absolute prices (gold ~9 vs semiconductor ~1.1) share one readable y-axis.
export function normalizeSeries(prices) {
  const first = (prices || []).find(v => v !== null && v !== undefined);
  if (!first) return (prices || []).map(() => null);
  return prices.map(p => (p !== null && p !== undefined) ? parseFloat((p / first * 100).toFixed(2)) : null);
}

// Build Chart.js datasets for the ETF price trend chart
export function buildETFChartData(history) {
  const datasets = Object.keys(SECTOR_ETF).map(sector => ({
    label: sector,
    data: normalizeSeries(history.prices[sector]),
    borderColor: SECTOR_COLORS[sector],
    backgroundColor: SECTOR_COLORS[sector] + '22',
    borderWidth: 2,
    pointRadius: 1.5,
    pointHoverRadius: 4,
    tension: 0.3,
    fill: false,
    spanGaps: true,
  }));

  return {
    dates: history.dates,
    datasets,
    hasData: history.dates.length >= 1,
  };
}

// Build sentiment donut chart data from analyzed news
export function buildSentimentData(analyzed) {
  const bull = analyzed.filter(n => (n.direction || '').includes('利好')).length;
  const bear = analyzed.filter(n => (n.direction || '').includes('利空')).length;
  const neutral = analyzed.filter(n => n.direction === '中性').length;
  const mixed = analyzed.filter(n => n.direction === '分化').length;

  return {
    datasets: [{
      data: [bull, bear, neutral, mixed].filter(c => c > 0),
      backgroundColor: ['#16a34a', '#dc2626', '#9ca0af', '#ea580c'],
      borderWidth: 0,
    }],
    labels: ['利好', '利空', '中性', '分化'].filter((_, i) => [bull, bear, neutral, mixed][i] > 0),
    hasData: bull + bear + neutral + mixed > 0,
  };
}

// Build sector impact heatmap data
export function buildImpactHeatmap(analyzed) {
  const sectors = ['半导体', '光模块', '创新药', '黄金'];
  const impacts = ['极高', '高', '中', '低'];
  const matrix = {};

  for (const s of sectors) {
    matrix[s] = { '极高': 0, '高': 0, '中': 0, '低': 0 };
  }

  for (const n of analyzed) {
    const cat = n.category;
    const imp = n.impact;
    if (matrix[cat] && matrix[cat][imp] !== undefined) {
      matrix[cat][imp]++;
    }
  }

  return {
    sectors,
    impacts: [...impacts].reverse(),
    matrix,
    hasData: analyzed.length > 0,
  };
}

// Build sector direction stacked bar data
export function buildDirectionChart(analyzed) {
  const sectors = ['半导体', '光模块', '创新药', '黄金'];
  const directions = ['利好', '利空', '中性', '分化'];
  const counts = {};

  for (const s of sectors) {
    counts[s] = { '利好': 0, '利空': 0, '中性': 0, '分化': 0 };
  }

  for (const n of analyzed) {
    const cat = n.category;
    const dir = n.direction;
    if (counts[cat] && counts[cat][dir] !== undefined) {
      counts[cat][dir]++;
    }
  }

  return {
    sectors,
    datasets: directions.filter(d => sectors.some(s => counts[s][d] > 0)).map(d => ({
      label: d,
      data: sectors.map(s => counts[s][d]),
      backgroundColor: d === '利好' ? '#16a34a' : d === '利空' ? '#dc2626' : d === '中性' ? '#9ca0af' : '#ea580c',
    })),
    hasData: sectors.some(s => Object.values(counts[s]).reduce((a, b) => a + b, 0) > 0),
  };
}

// Build time-window (短期/中期/长期) donut chart data
export function buildTimeWindowData(analyzed) {
  const windows = ['短期', '中期', '长期'];
  const counts = { '短期': 0, '中期': 0, '长期': 0 };
  for (const n of analyzed) {
    const w = n.time_window;
    if (counts[w] !== undefined) counts[w]++;
  }
  const colors = { '短期': '#2563eb', '中期': '#ea580c', '长期': '#16a34a' };
  return {
    labels: windows.filter(w => counts[w] > 0),
    datasets: [{
      data: windows.filter(w => counts[w] > 0).map(w => counts[w]),
      backgroundColor: windows.filter(w => counts[w] > 0).map(w => colors[w]),
      borderWidth: 0,
    }],
    hasData: windows.some(w => counts[w] > 0),
  };
}

// Fetch ~30 days of daily close prices for the representative ETF of each sector
// from Sina K-line API, returning a history object in loadETFHistory's shape.
export async function fetchETFHistoryKLine(days = 30) {
  const byDate = {};
  const allDates = new Set();
  for (const sector of Object.keys(SECTOR_ETF)) {
    const code = SECTOR_ETF[sector];
    const market = code.startsWith('5') ? 'sh' : 'sz';
    try {
      const resp = await fetch(`https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${market}${code}&scale=240&ma=no&datalen=${days}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' },
        timeout: 12000,
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      const m = text.match(/=\s*\(?(\[[\s\S]*\])\s*\)?\s*;/);
      if (!m) throw new Error('parse fail');
      const rows = JSON.parse(m[1]);
      for (const r of rows) {
        allDates.add(r.day);
        if (!byDate[sector]) byDate[sector] = {};
        byDate[sector][r.day] = parseFloat(r.close);
      }
      console.log(`  [K线] ${sector}(${code}) → ${rows.length} 天`);
    } catch (err) {
      console.warn(`  [K线] ${sector}(${code}) ⚠ ${err.message}`);
      if (!byDate[sector]) byDate[sector] = {};
    }
  }
  const dates = [...allDates].sort();
  const prices = {};
  for (const sector of Object.keys(SECTOR_ETF)) {
    prices[sector] = dates.map(d => (byDate[sector] && byDate[sector][d] !== undefined) ? byDate[sector][d] : null);
  }
  console.log(`  [K线] 回填 ${dates.length} 个交易日 ETF 历史`);
  return { dates, prices };
}

export { SECTOR_ETF, SECTOR_COLORS, SECTOR_PALETTE };
