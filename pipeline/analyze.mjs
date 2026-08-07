// ── Pipeline: AI 分析与关键词引擎 ───────────────────────

import { CONFIG, KEYWORD_RULES } from './config.mjs';

// Match AI-consolidated brief to its most recent source news pubDate
// Returns { date, link } so each brief keeps the source article's real
// publish time and a working "原文" link.
export function findSourceDate(ai, newsItems, fallback, index) {
  const title = (ai.title_cn || '').toLowerCase();
  const summary = (ai.summary_cn || '').toLowerCase();
  const cat = (ai.category || '');

  let bestDate = null;
  let bestLink = '';
  let bestScore = 0;

  const titleWords = title.replace(/[^a-z0-9一-鿿]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  const summaryWords = summary.replace(/[^a-z0-9一-鿿]/g, ' ').split(/\s+/).filter(w => w.length >= 2);

  for (const item of newsItems) {
    let score = 0;
    const itemTitle = (item.title || '').toLowerCase();
    const itemDesc = (item.description || '').toLowerCase();

    if (item.guessedSector && item.guessedSector === cat) score += 3;

    for (const w of titleWords) {
      if (itemTitle.includes(w)) score += 2;
      if (itemDesc.includes(w)) score += 1;
    }
    for (const w of summaryWords) {
      if (itemTitle.includes(w)) score += 1;
      if (itemDesc.includes(w)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestDate = item.pubDate;
      bestLink = item.link || '';
    }
  }

  if (bestDate && bestScore >= 2) return { date: bestDate, link: bestLink };

  const sectorItems = newsItems.filter(item => item.guessedSector === cat);
  if (sectorItems.length > 0) {
    const sorted = [...sectorItems].sort((a, b) => b.pubDate - a.pubDate);
    const chosen = sorted[Math.min(index, sorted.length - 1)];
    return { date: chosen.pubDate, link: chosen.link || '' };
  }

  return { date: fallback, link: '' };
}

// ── Claude API analysis ──────────────────────────────────

// Detect whether a title is not in Chinese and needs translation.
// Only Chinese characters are treated as "already translated" — English and
// Korean headlines (e.g. Samsung/SK hynix feeds) must go through translation.
const HAN_RE = /[一-鿿]/;
function needsTranslation(text) {
  return typeof text === 'string' && text.length > 0 && !HAN_RE.test(text);
}

function extractTextBlock(data) {
  let responseText = '';
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'thinking') continue;
      if (typeof block.text === 'string') { responseText = block.text.trim(); break; }
    }
    if (!responseText) {
      responseText = data.content.filter(b => b.type !== 'thinking').map(b => b.text || '').join('').trim();
    }
  }
  return responseText || data?.choices?.[0]?.message?.content || '';
}

// Hard fallback glossary for English/Korean feed titles when the API is down
const LOCAL_DICT = [
  [/SK hynix/gi, 'SK海力士'], [/Samsung/gi, '三星'], [/TSMC/gi, '台积电'], [/Micron/gi, '美光'],
  [/Nvidia/gi, '英伟达'], [/Intel/gi, '英特尔'], [/Broadcom/gi, '博通'], [/Qualcomm/gi, '高通'],
  [/Gold/gi, '黄金'], [/gold prices?/gi, '金价'], [/semiconductor/gi, '半导体'], [/chip/gi, '芯片'],
  [/memory/gi, '存储'], [/DRAM/gi, 'DRAM'], [/stocks?/gi, '股票'], [/share prices?/gi, '股价'],
  [/price/gi, '价格'], [/market/gi, '市场'], [/Fed/gi, '美联储'], [/rate cut/gi, '降息'],
  [/interest rate/gi, '利率'], [/central bank/gi, '央行'], [/FDA/gi, 'FDA'], [/drug/gi, '药物'],
  [/clinical trial/gi, '临床试验'], [/biotech/gi, '生物科技'], [/pharma/gi, '制药'],
  [/optical/gi, '光通信'], [/transceiver/gi, '光模块'], [/data center/gi, '数据中心'],
  [/server/gi, '服务器'], [/supply/gi, '供应'], [/demand/gi, '需求'], [/record high/gi, '历史新高'],
  [/record/gi, '纪录'], [/forecast/gi, '预测'], [/earnings/gi, '财报'], [/revenue/gi, '营收'],
  [/profit/gi, '利润'], [/surge/gi, '飙升'], [/jump/gi, '大涨'], [/climb/gi, '上涨'],
  [/fall/gi, '下跌'], [/rise/gi, '上涨'], [/China/gi, '中国'], [/South Korea|Korea/gi, '韩国'],
  [/Japan/gi, '日本'], [/company/gi, '公司'], [/industry/gi, '行业'], [/sector/gi, '板块'],
  [/stock market/gi, '股市'], [/trading/gi, '交易'], [/artificial intelligence/gi, '人工智能'],
  [/AI/gi, 'AI'],
  // Korean finance terms (Hangul headlines from KR feeds)
  [/삼성전자/gi, '三星电子'], [/SK하이닉스/gi, 'SK海力士'], [/엔비디아/gi, '英伟达'], [/인텔/gi, '英特尔'],
  [/반도체/gi, '半导体'], [/서버/gi, '服务器'], [/시장/gi, '市场'], [/핵심/gi, '核心'], [/요동/gi, '震荡'],
  [/가격/gi, '价格'], [/상승/gi, '上涨'], [/하락/gi, '下跌'], [/급등/gi, '飙升'], [/급락/gi, '暴跌'],
  [/수요/gi, '需求'], [/공급/gi, '供应'], [/증가/gi, '增长'], [/주가/gi, '股价'], [/증시/gi, '股市'],
  [/금리/gi, '利率'], [/인하/gi, '降息'], [/인상/gi, '加息'], [/연준/gi, '美联储'],
  [/중앙은행/gi, '央行'], [/금값/gi, '金价'], [/금융/gi, '金融'], [/호재/gi, '利好'], [/악재/gi, '利空'],
  [/인공지능/gi, '人工智能'], [/대만/gi, '台湾'], [/중국/gi, '中国'], [/미국/gi, '美国'],
  [/기업/gi, '企业'], [/산업/gi, '产业'], [/생산/gi, '生产'], [/판매/gi, '销售'], [/투자/gi, '投资'],
  [/상장/gi, '上市'], [/거래/gi, '交易'], [/비용/gi, '成本'], [/파운드리/gi, '代工'], [/소재/gi, '材料'],
];

export function translateWithLocalDict(text) {
  let out = String(text);
  for (const [re, cn] of LOCAL_DICT) out = out.replace(re, cn);
  return out;
}

// Batch-translate non-Chinese titles/descriptions via the Claude proxy.
// Returns a copy of newsItems with title_cn / summary_cn set.
async function translateItems(newsItems) {
  const toTranslate = [];
  newsItems.forEach((n, i) => {
    if (needsTranslation(n.title)) toTranslate.push({ id: i, title: n.title, desc: (n.description || '').substring(0, 200) });
  });
  if (toTranslate.length === 0) return newsItems;
  console.log(`  🌐 翻译 ${toTranslate.length} 条非中文标题...`);

  try {
    const prompt = `你是财经新闻翻译。把以下 JSON 数组中的英文/韩文标题和描述翻译成简体中文金融术语，公司名可保留或译名（如 SK Hynix→SK海力士、Nvidia→英伟达、Samsung→三星）。原样返回 JSON 数组（每个对象含 id/title/desc），不要 markdown 代码块，不要加注释：\n${JSON.stringify(toTranslate)}`;
    const resp = await fetch(`${CONFIG.apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: CONFIG.model, max_tokens: 8192, messages: [{ role: 'user', content: prompt }] }),
      timeout: 90000,
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    let text = extractTextBlock(data).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = text.indexOf('['), end = text.lastIndexOf(']');
    const arr = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
    if (!Array.isArray(arr)) throw new Error('bad array');

    const byId = {};
    for (const t of arr) if (t && typeof t.id === 'number') byId[t.id] = t;
    const out = newsItems.map((n, i) => {
      const t = byId[i];
      if (!t) return n;
      return { ...n, title_cn: t.title || n.title, summary_cn: t.desc || n.description, originalTitle: n.title };
    });
    console.log(`  ✅ 批量翻译完成 (${Object.keys(byId).length}/${toTranslate.length})`);
    return out;
  } catch (err) {
    console.warn(`  ⚠ 批量翻译失败 (${err.message})，使用本地词典兜底`);
    return newsItems.map(n => {
      if (!needsTranslation(n.title)) return n;
      return { ...n, title_cn: translateWithLocalDict(n.title), summary_cn: translateWithLocalDict(n.description), originalTitle: n.title };
    });
  }
}

// One attempt at full AI analysis; returns null on any failure so the caller can retry
async function tryAnalyzeOnce(newsItems) {
  console.log('\n🤖 调用 Claude API 进行 AI 分析 + 中文翻译...');

  // Count sector distribution
  const inputSectorCounts = {};
  for (const n of newsItems) {
    const s = n.guessedSector || '未分类';
    inputSectorCounts[s] = (inputSectorCounts[s] || 0) + 1;
  }
  const sectorSummary = Object.entries(inputSectorCounts).map(([k, v]) => `${k} ${v}条`).join('、');

  // Sort items by sector for better AI understanding
  const sortedItems = [...newsItems].sort((a, b) => {
    const sa = a.guessedSector || '未分类', sb = b.guessedSector || '未分类';
    if (sa === sb) return b.pubDate - a.pubDate;
    const order = {'半导体':1, '光模块':2, '创新药':3, '黄金':4, '未分类':5};
    return (order[sa] || 9) - (order[sb] || 9);
  });

  const newsText = sortedItems.map((n, i) =>
    `[${i}]【${n.guessedSector || '未分类'}】标题: ${n.title}\n    描述: ${n.description}\n    日期: ${n.pubDate.toISOString()}\n    来源: ${n.source}`
  ).join('\n\n');

  const prompt = `你是资深金融分析师，专注半导体、光模块、创新药、黄金四大赛道。以下 ${newsItems.length} 条新闻已按板块预分类（${sectorSummary}），每条标题前的【】标签为板块提示，请以此为主要参考进行归类。

核心任务：从这些新闻中提炼出 12-20 条行业简讯，四个板块必须有覆盖。规则：
1. 同类涨跌行情合并为一条，不要多条说同一件事
2. 严厉丢弃纯情绪/个人故事/标题党/重复内容
3. 只保留有产业逻辑支撑的内容：技术突破、政策/制裁变化、客户订单、产能扩张、竞争格局变动、临床数据/FDA审批、金价/利率/央行购金
4. 每个版块至少2条有实质内容的简讯
5. 尽量涵盖不同板块，若某个板块输入新闻确实很少就如实反映，但不要全写半导体

每条简讯包含以下字段（请严格遵守字段名）：
- title_cn：专业平实的行业简讯标题
- summary_cn：客观事实提炼，包含具体公司名/数据/技术细节，30-60字
- category：半导体 / 光模块 / 创新药 / 黄金（四选一）
- direction：利好 / 利空 / 中性 / 分化
- impact：极高 / 高 / 中 / 低
- certainty：高 / 中 / 低
- time_window：短期 / 中期 / 长期
- tickers：1-3个直接关联的A股标的（如中际旭创、中芯国际、药明康德、紫金矿业等），不确定标"—"
- notes：补充说明，无则留空

另外生成：
- sector_matrix：固定四条，分别对应半导体、光模块、创新药、黄金，每条的字段：name、shock（强/中/弱）、direction、news_count、summary、tickers
- key_points：4-6条，以【板块】开头，包含具体数据或标的
- market_summary：一段话总结产业动态

输出 JSON，不要 markdown 包裹，不要任何其他文字：
{"analyzed": [{"title_cn": "...", "summary_cn": "...", "category": "半导体", "direction": "利空", "impact": "高", "certainty": "高", "time_window": "短期", "tickers": "标的", "notes": ""}], "sector_matrix": [{"name": "半导体", "shock": "强", "direction": "分化", "news_count": 5, "summary": "...", "tickers": "..."}], "key_points": ["【半导体】..."], "market_summary": "..."}

新闻原文：

${newsText}`;

  let resp;
  try {
    resp = await fetch(`${CONFIG.apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CONFIG.model,
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      }),
      timeout: 180000,
    });
  } catch (err) {
    console.error(`  Claude API 请求失败 (${err.message})`);
    return null;
  }

  if (!resp.ok) {
    console.error(`  Claude API 错误 (${resp.status})`);
    return null;
  }

  let data;
  try {
    data = await resp.json();
  } catch (err) {
    console.error(`  Claude API 响应解析失败 (${err.message})`);
    return null;
  }
  const responseText = extractTextBlock(data).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  console.log(`  API 模型: ${CONFIG.model}`);
  console.log(`  AI 分析中...（已接收 ${responseText.length} 字）`);
  if (!responseText) {
    console.error('  AI 返回空内容');
    return null;
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (err) {
    console.error('  AI 返回 JSON 解析失败');
    return null;
  }
  if (!Array.isArray(result.analyzed) || result.analyzed.length === 0) {
    console.error('  AI 返回的 analyzed 为空');
    return null;
  }

  // Process AI output with proper source dates
  const maxInputDate = newsItems.reduce((max, n) => n.pubDate > max ? n.pubDate : max, new Date(0));
  const baseDate = maxInputDate.getTime() > 0 ? maxInputDate : new Date();

  const analyzed = (result.analyzed || []).map((ai, i) => {
    const src = findSourceDate(ai, newsItems, baseDate, i);
    return {
      title_cn: ai.title_cn || '[未命名]',
      summary_cn: ai.summary_cn || '',
      category: ai.category || '',
      direction: (ai.direction || '中性').replace('中性偏',''),
      impact: ai.impact || '中',
      certainty: ai.certainty || '中',
      time_window: ai.time_window || '中期',
      tickers: ai.tickers || '—',
      notes: ai.notes || '',
      title: ai.title_cn || '',
      description: ai.summary_cn || '',
      pubDate: src.date,
      source: 'AI综合',
      link: src.link,
    };
  });

  // Merge AI sector_matrix with defaults
  const defaultMatrix = {
    '半导体': { name: '半导体', shock: '中', direction: '中性', news_count: 0, summary: '', tickers: '' },
    '光模块': { name: '光模块', shock: '中', direction: '中性', news_count: 0, summary: '', tickers: '' },
    '创新药': { name: '创新药', shock: '中', direction: '中性', news_count: 0, summary: '', tickers: '' },
    '黄金': { name: '黄金', shock: '中', direction: '中性', news_count: 0, summary: '', tickers: '' },
  };
  const aiMatrix = result.sector_matrix || [];
  for (const s of aiMatrix) {
    if (defaultMatrix[s.name]) {
      defaultMatrix[s.name] = {
        name: s.name,
        shock: s.shock || '中',
        direction: s.direction || '中性',
        news_count: s.news_count || 0,
        summary: s.summary || '',
        tickers: s.tickers || '',
      };
    }
  }
  // Count actual categories
  for (const item of analyzed) {
    if (item.category && defaultMatrix[item.category]) {
      defaultMatrix[item.category].news_count++;
    }
  }

  const sectorMatrix = Object.values(defaultMatrix).filter(s => s.news_count >= 0);
  const shockOrder = { '强': 0, '中': 1, '弱': 2 };
  sectorMatrix.sort((a, b) => shockOrder[a.shock] - shockOrder[b.shock] || b.news_count - a.news_count);

  console.log(`  AI去重合并: ${analyzed.length} 条行业简讯（原始 ${newsItems.length} 条）`);

  return {
    analyzed,
    sectorMatrix,
    keyPoints: result.key_points || [],
    marketSummary: result.market_summary || '',
    isAi: true,
    fullNews: newsItems,
  };
}

// ── Entry point: AI analysis with retry, keyword engine as hard fallback ──

export async function analyzeWithClaude(newsItems) {
  // Pre-translate all non-Chinese titles so the archived full-news list is
  // also fully in simplified Chinese (independent of which analysis path runs).
  const translated = await translateItems(newsItems);

  if (!CONFIG.apiKey) {
    console.log('\n⚠ ANTHROPIC_API_KEY 未设置，使用本地关键词引擎\n');
    return analyzeWithKeywords(translated);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) console.log(`\n  🔁 重试 AI 分析 (第 ${attempt}/3 次)...`);
    const ok = await tryAnalyzeOnce(translated);
    if (ok) return ok;
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }

  console.log('  AI 分析 3 次均失败，回退到本地关键词引擎');
  return analyzeWithKeywords(translated);
}

// ── Local keyword engine (fallback) ──────────────────────

const SECTOR_DEFAULT_TICKERS = {
  '半导体': '中芯国际、北方华创、中微公司',
  '光模块': '中际旭创、新易盛、天孚通信',
  '创新药': '百济神州、药明康德、恒瑞医药',
  '黄金': '紫金矿业、山东黄金、中金黄金',
};

async function analyzeWithKeywords(newsItems) {
  // Translate non-Chinese titles so the report stays fully in simplified Chinese
  const translated = await translateItems(newsItems);

  const analyzed = translated.map((n) => {
    const text = ((n.title || '') + ' ' + (n.description || '')).toLowerCase();
    let best = null, bestScore = 0;
    for (const rule of KEYWORD_RULES) {
      let match = false;
      for (const k of rule.kw) {
        if (text.includes(k.toLowerCase())) { match = true; break; }
      }
      if (!match) continue;
      const score = rule.kw.reduce((s, k) => s + (text.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length, 0);
      if (score > bestScore) { bestScore = score; best = rule; }
    }

    const rule = best || { impact: '低', dir: '中性', category: n.guessedSector || '', tickers: '—', time: '中期' };
    return {
      ...n,
      title_cn: n.title_cn || n.title,
      summary_cn: n.summary_cn || n.description.substring(0, 80),
      category: rule.category || '',
      direction: rule.dir,
      impact: rule.impact,
      certainty: '低',
      time_window: rule.time,
      tickers: rule.tickers || '—',
      notes: '关键词引擎自动评级，非AI分析',
    };
  }).filter(n => ['半导体', '光模块', '创新药', '黄金'].includes(n.category));

  const secMap = {
    '半导体': { name: '半导体', shock: '中', direction: '分化', news_count: 0, summary: '', tickers: '' },
    '光模块': { name: '光模块', shock: '中', direction: '利好', news_count: 0, summary: '', tickers: '' },
    '创新药': { name: '创新药', shock: '中', direction: '利好', news_count: 0, summary: '', tickers: '' },
    '黄金': { name: '黄金', shock: '中', direction: '利好', news_count: 0, summary: '', tickers: '' },
  };
  const secItems = { '半导体': [], '光模块': [], '创新药': [], '黄金': [] };
  for (const item of analyzed) {
    const cat = item.category;
    if (cat && secMap[cat]) {
      secMap[cat].news_count++;
      secItems[cat].push(item);
      if (item.direction.includes('利好')) secMap[cat].direction = '利好';
      else if (item.direction.includes('利空')) secMap[cat].direction = '利空';
      if (item.impact === '极高' || item.impact === '高') secMap[cat].shock = '强';
    }
  }

  // Fill matrix summary + tickers from each sector's highest-impact news
  const impactRank = { '极高': 0, '高': 1, '中': 2, '低': 3 };
  for (const cat of Object.keys(secMap)) {
    const items = secItems[cat];
    if (items.length === 0) continue;
    const sorted = [...items].sort((a, b) => (impactRank[a.impact] ?? 9) - (impactRank[b.impact] ?? 9));
    const top = sorted[0];
    const topTitle = String(top.title_cn || '');
    const topSummary = (top.summary_cn || '').substring(0, 40);
    // Only append the title/description if they are fully translated to Chinese;
    // otherwise fall back to a Chinese template sentence so no English leaks in.
    const fullyCn = (s) => HAN_RE.test(s) && !/[a-zA-Z]{2,}/.test(s);
    const titlePart = fullyCn(topTitle) ? topTitle : '';
    const descPart = fullyCn(topSummary) ? topSummary : '';
    let summary = `${cat}板块${items.length}条新闻，方向以${secMap[cat].direction}为主`;
    if (titlePart || descPart) summary += `。关注：${[titlePart, descPart].filter(Boolean).join('；')}`;
    secMap[cat].summary = summary.substring(0, 60);
    const tickerSet = new Set();
    for (const item of items) {
      for (const t of String(item.tickers || '').split('、')) {
        const clean = t.trim();
        if (clean && clean !== '—') tickerSet.add(clean);
      }
    }
    secMap[cat].tickers = tickerSet.size > 0 ? [...tickerSet].join('、') : SECTOR_DEFAULT_TICKERS[cat];
  }

  const shockOrder = { '强': 0, '中': 1, '弱': 2 };
  const matrix = Object.values(secMap).sort((a, b) => shockOrder[a.shock] - shockOrder[b.shock] || b.news_count - a.news_count);

  const points = [
    `今日共抓取 ${analyzed.length} 条新闻，聚焦半导体、光模块、创新药、黄金四大赛道。`,
    `极高影响事件 ${analyzed.filter(n => n.impact === '极高').length} 条，高影响 ${analyzed.filter(n => n.impact === '高').length} 条，利好方向 ${analyzed.filter(n => n.direction.includes('利好')).length} 条。`,
  ];
  if (matrix.length > 0) {
    points.push(`板块概况：${matrix.map(s => `${s.name}(${s.direction}, ${s.shock}冲击, ${s.news_count}条)`).join('、')}。`);
  }
  const topNews = [...analyzed].sort((a, b) => {
    const ia = { '极高': 0, '高': 1, '中': 2, '低': 3 };
    return (ia[a.impact] || 9) - (ia[b.impact] || 9);
  }).slice(0, 3);
  if (topNews.length > 0) {
    points.push(`重点关注：${topNews.map(n => n.title_cn).join('；')}。`);
  }

  return {
    analyzed,
    sectorMatrix: matrix,
    keyPoints: points,
    marketSummary: `本日报聚焦半导体、光模块、创新药、黄金四大赛道，${analyzed.length} 条新闻经关键词引擎自动分析生成。`,
    isAi: false,
    fullNews: newsItems,
  };
}
