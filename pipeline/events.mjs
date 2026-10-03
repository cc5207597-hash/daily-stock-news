// ── Pipeline: 事件级去重(Event Clustering) ──────────────
// 同一个财经事件被不同媒体以不同标题报道,精确去重(clean.mjs stageDedup)
// 和"标题包含"去重(stageCollapse)都抓不住。本模块做三层漏斗:
//
//   Layer1 精确去重  → clean.mjs stageDedup(保留不动)
//   Layer2 文本相似度 → 本模块 clusterEvents 的主力,零依赖、零 API 成本
//   Layer3 Embedding → 可插拔钩子 embedSimilarity,默认关闭;
//                      环境变量 EVENT_CLUSTER_EMBED=1 时启用,
//                      仅对 Layer2 灰区(0.45~0.60)的候选对做语义复判
//
// 聚合结果 Event:eventId(确定性哈希,跨构建/跨天稳定)、canonicalTitle、
// sources 全来源、relatedArticles 全部成员。每个 Event 收敛为代表条目继续走
// 下游 analyze/渲染链路,只往条目上挂 eventId/eventSources 等元数据。

import { matchKw } from './sectors.mjs';
import { SIGNALS } from './sentiment.mjs';

// ── 配置(可用真实数据标定) ──────────────────────────────
const MERGE_THRESHOLD = 0.60;      // Layer2 sim ≥ 此值 → 合并
const GRAY_LOW = 0.45;             // 灰区下限:进入 Layer3 复判(若启用)
const SIGNAL_BONUS = 0.15;         // 命中同一板块信号词/实体的加成(封顶 1.0)

// 统一来源名:同一媒体不同渠道的变体归并,来源去重展示用
const SOURCE_ALIASES = {
  '新浪财经': '新浪财经',
  '手机新浪网': '新浪财经',
  '华尔街见闻': '华尔街见闻',
  '华尔街见闻医药': '华尔街见闻',
};

// ── 标题归一化 ──────────────────────────────────────────
// Google News RSS 标题普遍带 " - 来源名" 后缀(如"…黄金 - TradingView")。
// 先剥掉尾部来源名,再做小写/去标点,保留 CJK+拉丁+数字(与 dedupKey 同思路,
// 但不截断——事件标题需要全量特征)。来源名本身也是 CJK/拉丁词序列,
// 所以后缀匹配为"分隔符 + 若干空格分隔的词 token",如 " - TradingView"、
// " — 新浪"、" - The Wall Street Journal"。
const SOURCE_SUFFIX_RE = /\s+[-–—·]\s*(?:[a-z0-9一-鿿.&'’]+(?:\s+[a-z0-9一-鿿.&'’]+)*)$/i;

export function normalizeTitle(title) {
  return String(title || '')
    .replace(SOURCE_SUFFIX_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, '');
}

// 字符 bigram 集合(中文 2-gram 判别力强)+ 拉丁词集合 → 标题特征
export function titleFeatures(norm) {
  const bigrams = new Set();
  for (let i = 0; i + 1 < norm.length; i++) {
    bigrams.add(norm.substring(i, i + 2));
  }
  const words = new Set((norm.match(/[a-z0-9]{2,}/g) || []));
  return { bigrams, words };
}

// 泛财经字符集合:出现在信号词里的字(营收/创新高/财报/获批/制裁…)。这些字在
// 标题里几乎必然出现,对"是不是同一事件"判别力极低,降权后实体字符(公司名、
// 标的、具体数字)才能主导相似度——避免"中芯国际营收创新高"与"台积电营收创新高"
// 因共享"营收创新高"而被误判为同事件。
const SIGNAL_CHARS = new Set();
for (const sig of SIGNALS) {
  for (const k of sig.kw) {
    for (const c of String(k).replace(/[^一-鿿a-z]/g, '')) SIGNAL_CHARS.add(c);
  }
}

const CHAR_WEIGHT = c => SIGNAL_CHARS.has(c) ? 0.15 : 1;

// 加权字符 Jaccard:实体/数字字符满权重,泛财经字符 0.15。
// 导出供合并规则与测试复用(实体共享是"同公司同事件"的关键门控)。
export function entityJaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  let inter = 0, union = 0;
  for (const c of sa) { const w = CHAR_WEIGHT(c); if (sb.has(c)) inter += w; else union += w; }
  for (const c of sb) { if (!sa.has(c)) union += CHAR_WEIGHT(c); }
  union += inter;
  return union === 0 ? 0 : inter / union;
}

// 标题相似度:加权字符 Jaccard(实体/表述共享,主导) + bigram overlap(局部覆盖,
// 抓"同一事件不同字数表述") 加权合成。命中同一信号词再叠加 bonus。
// 实测(2026-08 真实数据标定):
//   英伟达营收创新高业绩超预期 || 英伟达q2财报超预期营收大增 → 0.46+ (灰区)
//   现货黄金价格站上4600美元    || 现货黄金突破4600美元       → 0.58 (灰区)
//   中芯国际营收创新高     || 台积电营收创新高            → 0.12 不并
export function titleSimilarity(aNorm, bNorm, { bonus = 0 } = {}) {
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  const fa = titleFeatures(aNorm);
  const fb = titleFeatures(bNorm);

  // bigram overlap:短标题 bigram 被长标题覆盖的比例(同事件扩充表述)
  let inter = 0;
  for (const x of fa.bigrams) if (fb.bigrams.has(x)) inter++;
  const overlap = inter / (Math.min(fa.bigrams.size, fb.bigrams.size) || 1);

  const weighted = entityJaccard(aNorm, bNorm);
  let sim = 0.6 * weighted + 0.4 * overlap;
  // 拉丁词弱加成:两标题共享低频公司词(如 sk hynix / tsmc)时提升置信
  let wordHit = 0;
  for (const w of fa.words) {
    if (w.length >= 3 && fb.words.has(w)) wordHit++;
  }
  if (wordHit > 0) sim += 0.05;
  sim += bonus;
  return Math.min(1, sim);
}

// 两标题是否命中同一信号类别(共享事件类型 → 潜在同事件的强证据)。
// 命中同一信号词 +0.15;命中同类别不同词(如"营收创新高"vs"财报超预期"
// 都属"业绩")再 +0.10,把同事件但表述差异大的对抬过阈值,同时不把
// 同公司不同事件(如"英伟达收购arm"vs"英伟达财报超预期")拉高——它们
// 只共享公司名,不共享信号类别。
function sharedSignalBonus(a, b) {
  const hitCats = t => {
    const cats = new Set();
    for (const sig of SIGNALS) {
      for (const k of sig.kw) {
        if (k.length >= 2 && matchKw(t, k)) { cats.add(sig.cat); break; }
      }
    }
    return cats;
  };
  const ca = hitCats(a), cb = hitCats(b);
  let bonus = 0;
  for (const c of ca) {
    if (!cb.has(c)) continue;
    bonus += 0.10; // 同类别基础加成
    // 同一信号词同时出现在两标题 → 额外加成
    const sig = SIGNALS.find(s => s.cat === c);
    if (sig && sig.kw.some(k => k.length >= 2 && matchKw(a, k) && matchKw(b, k))) bonus += 0.05;
  }
  return bonus;
}

// Layer3 可插拔钩子:默认关。EVENT_CLUSTER_EMBED=1 时由外部注入实现
// (复用智谱 key 的 embedding 端点),返回 cosSim 或 null(未启用/失败)。
export let embedSimilarity = () => null;

// ── 确定性哈希(eventId / eventTitle) ───────────────────
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function eventIdFrom(normTitle) {
  return `evt_${hashStr(normTitle)}`;
}

// 实体数字共享:两标题出现同一具体数字(≥1000,排除 19xx/20xx 年份)且实体共享
// (entityJaccard ≥ 0.30)→ 强证据。"现货黄金站上4600美元" vs "现货黄金突破4600
// 美元" 靠共享 4600 兜住(base 0.584 低于阈值、且无共享信号词)。年份(2026)、
// 无实体共享(2026绿色算力大会 vs 安世中国发布会)都不触发——只共享年份/泛词
// 不能证明是同一事件。
function shareNumericToken(a, b) {
  const nums = t => new Set((t.match(/\d{4,}/g) || []).filter(n => n < 1900 || n >= 2100));
  const na = nums(a), nb = nums(b);
  for (const n of na) if (nb.has(n)) return true;
  return false;
}

// 归一化来源名(展示用去重)
export function canonicalSource(name) {
  return SOURCE_ALIASES[name] || name || '未知来源';
}

// ── 主入口 ─────────────────────────────────────────────
// items: 已过 stageDedup/stageNoise 的条目(含 title/description/link/source/sourceType/pubDate)。
// 返回 { events, annotatedItems }:
//   events: [{ eventId, canonicalTitle, canonicalLink, memberCount, sources[],
//              relatedArticles[], reason[], mergedAt }]
//   annotatedItems: 每条挂 eventId/eventTitle/eventSources/sourceCount/relatedLinks
export function clusterEvents(items, { embedEnabled = false, useEmbed = embedEnabled } = {}) {
  const prepared = items.map(item => ({
    item,
    norm: normalizeTitle(item.title),
  })).filter(p => p.norm.length >= 4); // 太短(<2 个汉字)不可靠,不参与聚合

  // 贪心并查集:按序合并,先到的标题更完整 → 成为 canonical
  const parent = Array.from({ length: prepared.length }, (_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const reason = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      if (find(i) === find(j)) continue;
      const a = prepared[i], b = prepared[j];
      const bonus = sharedSignalBonus(a.norm, b.norm);
      const base = titleSimilarity(a.norm, b.norm, { bonus: 0 });
      let sim = base + bonus;
      // 同信号类别 + 实体共享(加权字符 Jaccard ≥ 0.30)→ 强合并证据,即使总分
      // 略低于阈值:"英伟达Q2财报超预期营收大增"vs"英伟达净利翻倍业绩超预期"
      // base 0.39、同为业绩信号 → 同一事件;"英伟达收购arm"vs"英伟达财报超预期"
      // 只共享公司名不共享信号类别 → 绝不合并;"中芯国际营收创新高"vs"台积电
      // 营收创新高"同为业绩信号但实体不同(entityJaccard 0.12)→ 不合并。
      const shareCat = bonus >= 0.10;
      const shareEntity = entityJaccard(a.norm, b.norm) >= 0.30;
      // 同信号类别 + 实体共享 → 强合并证据;或共享同一具体数字(≥1000,非年份)
      // + 实体共享。避免只看年份/泛词共享就误并不同事件。
      if (sim < MERGE_THRESHOLD && shareEntity && (shareCat || shareNumericToken(a.norm, b.norm))) {
        sim = Math.max(sim, MERGE_THRESHOLD);
      }
      // 灰区 → 可选的 Layer3 语义复判
      if (sim >= GRAY_LOW && sim < MERGE_THRESHOLD && useEmbed) {
        const cos = embedSimilarity(a.norm, b.norm);
        if (typeof cos === 'number' && cos >= 0.85) sim = MERGE_THRESHOLD;
      }
      if (sim < MERGE_THRESHOLD) continue;
      union(i, j);
      reason.push({
        pair: [a.item.title, b.item.title],
        sim: +sim.toFixed(2),
        bonus: bonus > 0,
      });
    }
  }

  // 分组 → Event
  const groups = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(prepared[i]);
  }

  const events = [];
  const annotations = new Map(); // item → 注解
  for (const group of groups.values()) {
    const members = group.map(p => p.item);
    // canonical = 组内最长的原始标题(信息最全)
    const best = members.reduce((m, c) =>
      (String(c.title || '').length > String(m.title || '').length ? c : m), members[0]);
    const normTitle = normalizeTitle(best.title);
    const sourceList = [];
    const seenSrc = new Set();
    for (const m of members) {
      const s = canonicalSource(m.source);
      if (!seenSrc.has(s)) { seenSrc.add(s); sourceList.push(s); }
    }
    const event = {
      eventId: eventIdFrom(normTitle),
      canonicalTitle: best.title,
      canonicalLink: best.link || '',
      memberCount: members.length,
      sources: sourceList,
      relatedArticles: members.map(m => m.link || m.title),
      reason: reason.filter(r => r.pair.includes(best.title)).map(r => r.sim),
      mergedAt: new Date().toISOString(),
    };
    events.push(event);
    for (const m of members) {
      annotations.set(m, {
        eventId: event.eventId,
        eventTitle: event.canonicalTitle,
        eventSources: sourceList,
        sourceCount: sourceList.length,
        relatedLinks: event.relatedArticles.filter(l => l && l !== (m.link || m.title)),
        eventMembers: members,
      });
    }
  }

  const annotatedItems = items.map(item => {
    const ann = annotations.get(item);
    if (!ann) {
      // 未参与聚合的条(标题过短):不挂事件元数据
      return item;
    }
    return { ...item, ...ann };
  });

  return { events, annotatedItems };
}

// ── 供 clean.mjs 调用的阶段包装 ─────────────────────────
// 从 annotatedItems 里收敛代表条目:单事件多来源 → 取 canonical 成员,
// 其余成员变为 relatedArticles 引用(不进入下游分析/渲染)。
// 单条事件原样返回。
export function collapseToRepresentatives(annotatedItems) {
  const byEvent = new Map();
  for (const item of annotatedItems) {
    const key = item.eventId || `__single_${item.title}`;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(item);
  }
  const out = [];
  for (const [key, group] of byEvent) {
    if (key.startsWith('__single_')) { out.push(group[0]); continue; }
    const best = group.reduce((m, c) =>
      (String(c.title || '').length > String(m.title || '').length ? c : m), group[0]);
    out.push(best);
  }
  return out;
}
