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

export async function analyzeWithClaude(newsItems) {
  if (!CONFIG.apiKey) {
    console.log('\n⚠ ANTHROPIC_API_KEY 未设置，使用本地关键词引擎\n');
    return analyzeWithKeywords(newsItems);
  }

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

  const resp = await fetch(`${CONFIG.apiBase}/v1/messages`, {
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
  });

  if (!resp.ok) {
    console.error(`  Claude API 错误 (${resp.status})`);
    console.log('  回退到本地关键词引擎...');
    return analyzeWithKeywords(newsItems);
  }

  const data = await resp.json();

  // Find the text content block (skip thinking blocks)
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
  responseText = responseText || data?.choices?.[0]?.message?.content || '';

  // Strip markdown code fences
  responseText = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  console.log(`  API 模型: ${CONFIG.model}`);
  console.log(`  AI 分析中...（已接收 ${responseText.length} 字）`);

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (err) {
    console.error('  AI 返回 JSON 解析失败，回退到关键词引擎');
    return analyzeWithKeywords(newsItems);
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
  };
}

// ── Local keyword engine (fallback) ──────────────────────

function analyzeWithKeywords(newsItems) {
  const analyzed = newsItems.map((n) => {
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
      title_cn: n.title,
      summary_cn: n.description.substring(0, 80),
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
  for (const item of analyzed) {
    const cat = item.category;
    if (cat && secMap[cat]) {
      secMap[cat].news_count++;
      if (item.direction.includes('利好')) secMap[cat].direction = '利好';
      else if (item.direction.includes('利空')) secMap[cat].direction = '利空';
      if (item.impact === '极高' || item.impact === '高') secMap[cat].shock = '强';
    }
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
  };
}
