// ── Pipeline: 清洗、去重与板块分类 ──────────────────────

import { CONFIG, SECTOR_KEYWORDS, SECTOR_CORE_KEYWORDS } from './config.mjs';
import { SECTORS, matchKw } from './sectors.mjs';

// Regexes that identify "noise" headlines that should never enter the report:
// aggregate digests ("1. X. 2. Y."), calendar/forecast listings, pure quotes
// of market-movers and macro roundups that carry no industry signal.
const NOISE_PATTERNS = [
  /^\d{1,2}\.\s+[^\d]/,              // "1. 特斯拉：..." aggregate digests
  /^\d{1,2}\s*[、，,]/m,               // "1、..." / "1，整体走势..." enumerated digests
  /【今日重点关注的财经数据与事件/,      // daily calendar reminder
  /【金十整理|机构前瞻|日程提醒/,       // jin10 forecast/countdown digests
  /成交(额|量)报告.*(更新|发布)/,       // "CME volume report updated"
  /欢迎点击查看|更多精彩/,              // CTA boilerplate
  /将于.*(公布|发布|出炉)/,             // "to be published at HH:MM"
  /^(美元|欧元|英镑|日元|人民币)[：:]/i, // forex aggregate blocks
  /涨停分析|涨停复盘/,                  // whole-market limit-up digests
  /挂单|空单|多单/,                     // order-book / futures-position noise
];

function isNoise(item) {
  // A digest can hide in the description even when the title looks clean
  // (e.g. a title naming one company whose description opens with "1，整体走势…").
  const t = (item.title || '').trim();
  const d = (item.description || '').trim();
  const checks = [t, d];
  if (!t) return true;
  if (checks.some(s => NOISE_PATTERNS.some(re => re.test(s)))) return true;
  // Aggregate digest spanning multiple unrelated topics: "1. 特斯拉…2. 中汽协…"
  if (checks.some(s => (s.match(/(\d{1,2}\.\s)/g) || []).length >= 2)) return true;
  return false;
}

// Normalized dedup key: keep Latin letters, digits and CJK (stripping only
// punctuation/whitespace/case). Stripping CJK too would collapse every
// pure-Chinese headline to an empty key and keep only the first one.
export function dedupKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, '')
    .substring(0, 50);
}

export function dedupAndClean(allItems) {
  // Deduplicate — prefer direct API sources over RSS
  const seen = new Map();
  const deduped = [];
  for (const item of allItems) {
    const key = dedupKey(item.title);
    const existing = seen.get(key);
    if (existing && existing.sourceType !== 'direct_api' && item.sourceType === 'direct_api') {
      const idx = deduped.findIndex(d => dedupKey(d.title) === key);
      if (idx >= 0) deduped[idx] = item;
      seen.set(key, item);
      continue;
    }
    if (existing) continue;
    seen.set(key, item);
    deduped.push(item);
  }

  // Drop noise headlines (aggregate digests, calendars, boilerplate) early,
  // before classification — they carry no single-sector signal.
  const preNoise = deduped.length;
  let kept = deduped.filter(item => !isNoise(item));
  if (kept.length < preNoise) {
    console.log(`  丢弃废话/聚合快讯: ${preNoise - kept.length} 条`);
  }

  // Collapse near-duplicates: the same story republished by many feeds with
  // slightly different phrasing (e.g. 6+ SK海力士/三星 variants). If a shorter
  // normalized title is fully contained in an already-accepted longer one, it's
  // the same story — keep the longer, more informative version only.
  {
    const accepted = [];
    kept = kept.filter(item => {
      const norm = dedupKey(item.title);
      if (norm.length < 6) return true; // too short to be a reliable fragment
      for (const acc of accepted) {
        const accNorm = dedupKey(acc.title);
        if (accNorm.length >= norm.length + 4 && accNorm.includes(norm)) return false;
      }
      accepted.push(item);
      return true;
    });
  }

  // Sector classification — title weighted far above description. A title hit
  // is worth more than several description hits, so e.g. "主力资金监控：中际旭创"
  // (a title full of 中际旭创) lands in 光模块 even when the description mentions 半导体.
  kept.forEach(item => {
    if (!item.guessedSector) {
      item.guessedSector = classifyItem(item.title, item.description);
    }
  });

  // Drop items unrelated to the four sectors
  const dropped = kept.filter(item => !SECTORS.includes(item.guessedSector));
  const filtered = kept.filter(item => SECTORS.includes(item.guessedSector));
  if (dropped.length > 0) {
    console.log(`  丢弃与四板块无关: ${dropped.length} 条`);
  }

  // Print distribution
  const sectorCounts = {};
  for (const item of filtered) {
    const s = item.guessedSector || '未分类';
    sectorCounts[s] = (sectorCounts[s] || 0) + 1;
  }
  console.log(`  板块分布: ${Object.entries(sectorCounts).map(([k, v]) => `${k} ${v}条`).join(', ') || '无'}`);

  return filtered;
}

export function freshnessFilter(deduped) {
  const now = Date.now();
  const recent = deduped.filter(item => (now - item.pubDate.getTime()) < 24 * 3600 * 1000);
  console.log(`  去重后 ${deduped.length} 条，24小时内 ${recent.length} 条`);

  return recent;
}

function classifyItem(title, description) {
  const titleText = (title || '').toLowerCase();
  const descText = (description || '').toLowerCase();
  let best = '', bestScore = 0;
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    const core = SECTOR_CORE_KEYWORDS[sector] || [];
    let score = 0;
    let coreHit = false;
    // Core keywords are strong signals: a single hit in the title strongly
    // implies the sector, a hit in the description is enough to count too.
    for (const kw of core) {
      if (matchKw(titleText, kw)) { score += 4; coreHit = true; }
      else if (matchKw(descText, kw)) { score += 2; coreHit = true; }
    }
    // Context keywords (利率, 美联储, 治疗...) only add minor weight. Without a
    // core hit they can never alone push an item into this sector.
    if (coreHit) {
      for (const kw of kws) {
        if (core.includes(kw)) continue;
        if (matchKw(titleText, kw)) score += 1;
        else if (matchKw(descText, kw)) score += 1;
      }
    }
    if (score > bestScore) { bestScore = score; best = sector; }
  }
  return best;
}

