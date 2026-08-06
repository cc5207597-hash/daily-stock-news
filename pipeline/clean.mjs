// ── Pipeline: 清洗、去重与板块分类 ──────────────────────

import { CONFIG, SECTOR_KEYWORDS } from './config.mjs';

export function dedupAndClean(allItems) {
  // Deduplicate — prefer direct API sources over RSS
  const seen = new Map();
  const deduped = [];
  for (const item of allItems) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    const existing = seen.get(key);
    if (existing && existing.sourceType !== 'direct_api' && item.sourceType === 'direct_api') {
      const idx = deduped.findIndex(d => d.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50) === key);
      if (idx >= 0) deduped[idx] = item;
      seen.set(key, item);
      continue;
    }
    if (existing) continue;
    seen.set(key, item);
    deduped.push(item);
  }

  // Sector classification
  deduped.forEach(item => {
    if (!item.guessedSector) {
      item.guessedSector = classifySector((item.title || '') + ' ' + (item.description || ''));
    }
  });

  // Print distribution
  const sectorCounts = {};
  for (const item of deduped) {
    const s = item.guessedSector || '未分类';
    sectorCounts[s] = (sectorCounts[s] || 0) + 1;
  }
  console.log(`  板块分布: ${Object.entries(sectorCounts).map(([k, v]) => `${k} ${v}条`).join(', ') || '无'}`);

  return deduped;
}

export function freshnessFilter(deduped) {
  const now = Date.now();
  const days = Math.ceil(CONFIG.maxAgeSeconds / 86400);
  const recent = deduped.filter(item => (now - item.pubDate.getTime()) < CONFIG.maxAgeSeconds * 1000);
  console.log(`  去重后 ${deduped.length} 条，${days}天内 ${recent.length} 条`);

  if (recent.length < 15) {
    console.log(`  ${days}天内不足15条，放宽到14天...`);
    const wide = deduped.filter(item => (now - item.pubDate.getTime()) < 14 * 24 * 3600 * 1000);
    console.log(`  14天内 ${wide.length} 条`);
    return wide.slice(0, CONFIG.maxNewsCount);
  }

  return recent.slice(0, CONFIG.maxNewsCount);
}

function classifySector(text) {
  const t = text.toLowerCase();
  let best = '', bestScore = 0;
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) if (t.includes(kw.toLowerCase())) score++;
    if (score > bestScore) { bestScore = score; best = sector; }
  }
  return best;
}
