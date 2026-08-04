#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(PROJECT_ROOT, 'output');

// ── 配置 ──────────────────────────────────────────────
const CONFIG = {
  apiKey: 'PROXY_MANAGED',
  apiBase: 'http://127.0.0.1:15721',
  model: 'claude-sonnet-4-20250514',

  // Google News RSS feeds (direct fetch, no proxy)
  feeds: [
    { url: 'https://news.google.com/rss/search?q=stock+market+finance+economy+oil+gold+federal+reserve&hl=en-US&gl=US&ceid=US:en', name: 'Global Markets' },
    { url: 'https://news.google.com/rss/search?q=China+A+share+stock+market+PBOC+policy+economy&hl=en-US&gl=US&ceid=US:en', name: 'China Markets' },
    { url: 'https://news.google.com/rss/search?q=AI+semiconductor+chip+Nvidia+technology+big+tech&hl=en-US&gl=US&ceid=US:en', name: 'Tech & AI' },
    { url: 'https://news.google.com/rss/search?q=central+bank+interest+rate+inflation+ECB+BOJ&hl=en-US&gl=US&ceid=US:en', name: 'Central Banks' },
    { url: 'https://news.google.com/rss/search?q=geopolitics+trade+war+tariff+sanction+conflict+military&hl=en-US&gl=US&ceid=US:en', name: 'Geopolitics' },
    { url: 'https://news.google.com/rss/search?q=crypto+bitcoin+blockchain+SEC+regulation&hl=en-US&gl=US&ceid=US:en', name: 'Crypto' },
    { url: 'https://news.google.com/rss/search?q=real+estate+housing+property+market&hl=en-US&gl=US&ceid=US:en', name: 'Real Estate' },
    { url: 'https://news.google.com/rss/search?q=EV+electric+vehicle+solar+energy+renewable+autonomous&hl=en-US&gl=US&ceid=US:en', name: 'Auto & Energy' },
  ],

  maxAgeSeconds: 7 * 24 * 3600,
  maxNewsCount: 25,
};

// ── 工具函数 ──────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function htmlToText(s) {
  // Decode XML/HTML entities first, then strip tags
  let t = (s || '')
    .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

  t = t.replace(/<a\b[^>]*>/gi, '').replace(/<\/a\s*>/gi, '');
  t = t.replace(/<li\b[^>]*>/gi, ' · ').replace(/<\/li\s*>/gi, '');
  t = t.replace(/<ol\b[^>]*>/gi, '').replace(/<\/ol\s*>/gi, '');
  t = t.replace(/<ul\b[^>]*>/gi, '').replace(/<\/ul\s*>/gi, '');
  t = t.replace(/<br\b[^>]*\/?>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function stripCDATA(s) {
  return (s || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function timeAgo(date) {
  const diff = Date.now() - date.getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 24) return h + '小时前';
  return Math.floor(h / 24) + '天前';
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function getTodayDisplay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── 1. 直接解析 Google News RSS ────────────────────────

async function fetchGoogleNewsRSS(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let resp;
  try {
    resp = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DailyStockNews/1.0)' },
    });
  } catch (err) {
    throw new Error('fetch failed: ' + err.message);
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const xml = await resp.text();

  // Simple XML regex parser — avoids needing an XML library dep
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const desc = (block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || '';

    items.push({
      title: htmlToText(stripCDATA(title)),
      description: htmlToText(stripCDATA(desc)).substring(0, 600),
      link: link.trim(),
      pubDate: pubDate ? new Date(pubDate.trim()) : new Date(),
      source: source ? htmlToText(stripCDATA(source)) : feed.name,
    });
  }
  return items;
}

async function fetchAllNews() {
  console.log('\n📡 拉取 Google News RSS...');
  const allItems = [];

  for (let i = 0; i < CONFIG.feeds.length; i++) {
    const feed = CONFIG.feeds[i];
    console.log(`  [${i + 1}/${CONFIG.feeds.length}] ${feed.name}...`);
    try {
      const items = await fetchGoogleNewsRSS(feed);
      console.log(`    → ${items.length} 条`);
      allItems.push(...items);
    } catch (err) {
      console.warn(`    ⚠ 失败: ${err.message}`);
    }
    // Space requests to avoid rate limiting
    if (i < CONFIG.feeds.length - 1) await sleep(1500);
  }

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const item of allItems) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  // Freshness filter
  const now = Date.now();
  const recent = deduped.filter(item => (now - item.pubDate.getTime()) < CONFIG.maxAgeSeconds * 1000);
  console.log(`  去重后 ${deduped.length} 条，7天内 ${recent.length} 条`);

  if (recent.length < 10) {
    console.log('  7天内不足10条，放宽到30天...');
    const wide = deduped.filter(item => (now - item.pubDate.getTime()) < 30 * 24 * 3600 * 1000);
    console.log(`  30天内 ${wide.length} 条`);
    return wide.slice(0, CONFIG.maxNewsCount);
  }

  return recent.slice(0, CONFIG.maxNewsCount);
}

// ── 2. Claude AI 分析 + 翻译 ──────────────────────────

async function analyzeWithClaude(newsItems) {
  if (!CONFIG.apiKey) {
    console.log('\n⚠ ANTHROPIC_API_KEY 未设置，使用本地关键词引擎\n');
    return analyzeWithKeywords(newsItems);
  }

  console.log('\n🤖 调用 Claude API 进行 AI 分析 + 中文翻译...');

  const newsText = newsItems.map((n, i) =>
    `[${i}] 标题: ${n.title}\n    描述: ${n.description}\n    日期: ${n.pubDate.toISOString()}\n    来源: ${n.source}`
  ).join('\n\n');

  const prompt = `你是一位资深金融市场分析师。请分析以下 ${newsItems.length} 条财经新闻，对每条做：

1. **中文标题**：将标题翻译为地道的中文财经新闻标题
2. **中文摘要**：用1-2句中文概括核心要点（30-60字）
3. **四维评级**：
   - 影响方向：利好 / 利空 / 中性 / 分化
   - 影响程度：极高 / 高 / 中 / 低
   - 确定性：高 / 中 / 低
   - 时间窗口：短期（数日）/ 中期（数周-数月）/ 长期（半年以上）
4. **A股板块冲击**：1-3个关联板块，每板块：
   - 冲击程度：强 / 中 / 弱
   - 冲击方向：利好 / 利空
   - 传导逻辑（1句话）
5. **关联个股示例**（如确定则给出2-3个A股典型标的，不确定请标注"—"）

另外生成：
6. **板块冲击矩阵**：汇总所有受影响板块
7. **今日要点**：3-5条一句话总结

请严格输出 JSON 格式：
{
  "analyzed": [
    {
      "index": 0,
      "title_cn": "中文标题",
      "summary_cn": "中文摘要",
      "direction": "利好",
      "impact": "高",
      "certainty": "高",
      "time_window": "短期",
      "sectors": [
        { "name": "板块名", "shock_level": "强", "shock_direction": "利好", "logic": "传导逻辑一句话", "tickers": "标的1、标的2" }
      ],
      "notes": ""
    }
  ],
  "sector_matrix": [
    { "name": "板块", "shock": "强", "direction": "利好", "news_count": 3, "summary": "逻辑摘要", "tickers": "标的" }
  ],
  "key_points": ["要点1", "要点2", "要点3", "要点4"],
  "market_summary": "一段话总结今日市场核心逻辑"
}

只输出 JSON，不要任何其他文字。新闻如下：

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
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    console.error(`  Claude API 错误 (${resp.status})`);
    console.log('  回退到本地关键词引擎...');
    return analyzeWithKeywords(newsItems);
  }

  const data = await resp.json();
  console.log('  API 模型:', data.model);

  // Find the text content block (skip thinking blocks)
  let text = '';
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'thinking') continue; // skip deepseek thinking
      if (typeof block.text === 'string') { text = block.text.trim(); break; }
    }
    if (!text) {
      // Fallback: concat all non-thinking blocks
      text = data.content.filter(b => b.type !== 'thinking').map(b => b.text || '').join('').trim();
    }
  }

  if (!text) {
    console.log('  各块类型:', data.content.map(b => ({ type: b.type, hasText: !!b.text })));
    console.error('  未找到文本内容');
    return analyzeWithKeywords(newsItems);
  }
  console.log('  AI 分析中...（已接收 ' + text.length + ' 字）');

  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let result;
  try { result = JSON.parse(text); } catch (e) {
    console.error('  JSON 解析失败，回退到本地引擎');
    return analyzeWithKeywords(newsItems);
  }

  const analyzed = newsItems.map((n, i) => {
    const ai = (result.analyzed || []).find(a => a.index === i);
    if (!ai) {
      return { ...n, title_cn: n.title, summary_cn: n.description.substring(0, 80), direction: '中性', impact: '低', certainty: '低', time_window: '中期', sectors: [], notes: '' };
    }
    return {
      ...n,
      title_cn: ai.title_cn || n.title,
      summary_cn: ai.summary_cn || n.description.substring(0, 80),
      direction: ai.direction || '中性',
      impact: ai.impact || '低',
      certainty: ai.certainty || '低',
      time_window: ai.time_window || '中期',
      sectors: ai.sectors || [],
      notes: ai.notes || '',
    };
  });

  return {
    analyzed,
    sectorMatrix: result.sector_matrix || [],
    keyPoints: result.key_points || [],
    marketSummary: result.market_summary || '',
    isAi: true,
  };
}

// ── 本地关键词引擎 (fallback) ─────────────────────────

function analyzeWithKeywords(newsItems) {
  const RULES = [
    { kw: ['oil crash','oil plunge','oil tumble','oil slump','oil drop','crude crash','crude slump','油价暴跌','油价大跌','原油暴跌'], impact: '极高', dir: '利空', sectors: [{ name: '石油石化', shock: '强', shock_direction: '利空', logic: '油价暴跌→上游利润压缩', tickers: '中国石油、中海油服' },{ name: '航空', shock: '强', shock_direction: '利好', logic: '燃料成本大降→利润弹性', tickers: '中国国航、南方航空' }], time: '短期' },
    { kw: ['oil surge','oil spike','oil rally','oil jump','crude surge','油价飙升','原油暴涨'], impact: '高', dir: '利好', sectors: [{ name: '石油石化', shock: '强', shock_direction: '利好', logic: '油价上涨→上游利润增厚', tickers: '中国石油、中海油服' }], time: '短期' },
    { kw: ['OPEC','output increase','production increase','增产'], impact: '高', dir: '利空', sectors: [{ name: '石油石化', shock: '强', shock_direction: '利空', logic: '供给增加→油价承压', tickers: '中国石油' }], time: '中期' },
    { kw: ['Iran deal','Iran peace','Iran talk','Iran nuclear','Hormuz','伊朗和谈','伊朗谈判'], impact: '极高', dir: '利空', sectors: [{ name: '石油石化', shock: '强', shock_direction: '利空', logic: '地缘缓和→原油供给恢复→油价下行', tickers: '中国石油' },{ name: '军工', shock: '弱', shock_direction: '利空', logic: '中东冲突缓和→军工催化减弱', tickers: '—' },{ name: '航空', shock: '中', shock_direction: '利好', logic: '油价下降→燃料成本降低', tickers: '中国国航' }], time: '短期' },
    { kw: ['Federal Reserve','Fed rate','interest rate','inflation','CPI','ECB','BOJ','央行','加息','降息','利率'], impact: '中', dir: '中性', sectors: [{ name: '金融', shock: '中', shock_direction: '中性', logic: '利率政策变化→银行净息差/资产质量变动', tickers: '—' }], time: '中期' },
    { kw: ['nuclear','reactor','核电','核聚变'], impact: '高', dir: '利好', sectors: [{ name: '核电', shock: '强', shock_direction: '利好', logic: '政策/投资驱动→核电全链条受益', tickers: '融发核电、中国核电' }], time: '中期' },
    { kw: ['chip ban','chip export','semiconductor export','export control','chip restriction','芯片管制','出口管制','半导体管制'], impact: '高', dir: '分化', sectors: [{ name: '半导体', shock: '强', shock_direction: '分化', logic: '管制升级→国产替代加速利好设备；设计/封测出口承压', tickers: '中芯国际、北方华创' }], time: '中期' },
    { kw: ['rare earth','gallium','germanium','antimony','稀土','镓','锗'], impact: '中', dir: '分化', sectors: [{ name: '有色金属', shock: '中', shock_direction: '分化', logic: '出口管制政策→稀土价格→企业利润变动', tickers: '北方稀土' }], time: '短期' },
    { kw: ['Nvidia','OpenAI','AI chip','AI model','英伟达','人工智能','AI模型'], impact: '中', dir: '利好', sectors: [{ name: 'AI', shock: '中', shock_direction: '利好', logic: 'AI商业闭环→算力链受益→光模块/服务器增长', tickers: '中际旭创、工业富联' }], time: '短期' },
    { kw: ['big tech','earnings','tech stock','科技股','财报'], impact: '中', dir: '利好', sectors: [{ name: '科技', shock: '中', shock_direction: '利好', logic: '财报验证→科技板块情绪修复', tickers: '—' }], time: '短期' },
    { kw: ['real estate','housing','property','房贷','公积金','房地产','楼市'], impact: '高', dir: '利好', sectors: [{ name: '房地产', shock: '强', shock_direction: '利好', logic: '政策宽松→成交回暖→估值修复', tickers: '保利发展、万科A' }], time: '中期' },
    { kw: ['trade war','tariff','trade tension','关税','贸易战'], impact: '高', dir: '分化', sectors: [{ name: '外贸', shock: '中', shock_direction: '分化', logic: '关税政策→进出口成本→相关企业利润变化', tickers: '—' }], time: '中期' },
    { kw: ['yen','carry trade','日元','套息','日本央行'], impact: '中', dir: '中性', sectors: [{ name: '金融', shock: '弱', shock_direction: '中性', logic: '日元波动→carry trade→新兴市场资金流动', tickers: '—' }], time: '短期' },
    { kw: ['Bitcoin','crypto','SEC','比特币','加密'], impact: '中', dir: '中性', sectors: [{ name: '金融科技', shock: '弱', shock_direction: '中性', logic: '加密监管政策→风险偏好→相关概念股', tickers: '—' }], time: '短期' },
    { kw: ['Tesla','FSD','self-driving','autonomous','自动驾驶','智能驾驶','电动车'], impact: '中', dir: '利好', sectors: [{ name: '汽车', shock: '中', shock_direction: '利好', logic: '智驾技术落地→激光雷达/域控产业链受益', tickers: '德赛西威、经纬恒润' }], time: '中期' },
    { kw: ['gold','黄金','金价'], impact: '低', dir: '利好', sectors: [{ name: '黄金', shock: '弱', shock_direction: '利好', logic: '央行购金+避险→金价支撑', tickers: '山东黄金' }], time: '中期' },
    { kw: ['copper','aluminum','tin','zinc','copper price','铜','铝','锡','锌'], impact: '中', dir: '利好', sectors: [{ name: '有色金属', shock: '中', shock_direction: '利好', logic: '供给收紧+美元走弱→金属价格中枢上移', tickers: '紫金矿业、江西铜业' }], time: '中期' },
    { kw: ['recession','GDP','PMI','manufacturing','衰退','制造业'], impact: '中', dir: '中性', sectors: [{ name: '制造', shock: '中', shock_direction: '中性', logic: '宏观数据变化→工业需求→制造企业盈利', tickers: '—' }], time: '中期' },
    { kw: ['dollar','DXY','USD','forex','美元','汇率'], impact: '低', dir: '利好', sectors: [{ name: '黄金', shock: '弱', shock_direction: '利好', logic: '美元走弱→美元计价商品→黄金/有色受益', tickers: '山东黄金' }], time: '中期' },
    { kw: ['war','missile','strike','attack','conflict','military','战争','冲突','军事','导弹'], impact: '中', dir: '利好', sectors: [{ name: '军工', shock: '中', shock_direction: '利好', logic: '地缘紧张→军备需求→军工订单预期', tickers: '—' }], time: '短期' },
  ];

  const analyzed = newsItems.map((n) => {
    const text = ((n.title || '') + ' ' + (n.description || '')).toLowerCase();
    let best = null, bestScore = 0;
    for (const rule of RULES) {
      let match = false;
      for (const k of rule.kw) {
        if (text.includes(k.toLowerCase())) { match = true; break; }
      }
      if (!match) continue;
      const score = rule.kw.reduce((s, k) => s + (text.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length, 0);
      if (score > bestScore) { bestScore = score; best = rule; }
    }

    const rule = best || { impact: '低', dir: '中性', sectors: [], time: '中期' };
    return {
      ...n,
      title_cn: n.title,
      summary_cn: n.description.substring(0, 80),
      direction: rule.dir,
      impact: rule.impact,
      certainty: '低',
      time_window: rule.time,
      sectors: rule.sectors,
      notes: '关键词引擎自动评级，非AI分析',
    };
  });

  const secMap = {};
  for (const item of analyzed) {
    for (const sec of item.sectors) {
      if (!secMap[sec.name]) secMap[sec.name] = { name: sec.name, shock: sec.shock, direction: sec.shock_direction, news_count: 0, summary: sec.logic, tickers: sec.tickers };
      secMap[sec.name].news_count++;
    }
  }

  const shockOrder = { '强': 0, '中': 1, '弱': 2 };
  const matrix = Object.values(secMap).sort((a, b) => shockOrder[a.shock] - shockOrder[b.shock] || b.news_count - a.news_count);

  // Build richer key points from sector matrix
  const topSectors = matrix.slice(0, 5);
  const points = [
    `今日共抓取 ${analyzed.length} 条财经新闻，经关键词引擎自动分类评级。`,
    `极高影响事件 ${analyzed.filter(n => n.impact === '极高').length} 条，高影响 ${analyzed.filter(n => n.impact === '高').length} 条，利好方向 ${analyzed.filter(n => n.direction.includes('利好')).length} 条。`,
  ];
  if (topSectors.length > 0) {
    points.push(`重点关注板块：${topSectors.map(s => `${s.name}(${s.direction}, ${s.shock}冲击)`).join('、')}。`);
  }
  const topNews = [...analyzed].sort((a, b) => {
    const ia = { '极高': 0, '高': 1, '中': 2, '低': 3 };
    return (ia[a.impact] || 9) - (ia[b.impact] || 9);
  }).slice(0, 3);
  if (topNews.length > 0) {
    points.push(`核心关注：${topNews.map(n => n.title_cn || n.title).join('；')}。`);
  }

  return {
    analyzed,
    sectorMatrix: matrix,
    keyPoints: points,
    marketSummary: `本日报由关键词引擎自动生成，${analyzed.length} 条新闻覆盖 ${Object.keys(
      analyzed.reduce((acc, n) => { acc[n.source] = 1; return acc; }, {})
    ).length} 个来源，涵盖全球市场、A股、大宗商品、科技、地产等领域。`,
    isAi: false,
  };
}

// ── HTML 渲染 ──────────────────────────────────────────

function renderHTML(result, todayDisplay) {
  const { analyzed, sectorMatrix, keyPoints, marketSummary, isAi } = result;

  const impactCls = (imp) => imp === '极高' ? 'impact-vhigh' : imp === '高' ? 'impact-high' : imp === '中' ? 'impact-mid' : 'impact-low';
  const dirCls = (d) => d.includes('利好') ? 'badge-bull' : d.includes('利空') ? 'badge-bear' : d === '中性' ? 'badge-neutral' : 'badge-mixed';
  const shockCls = (s) => s === '强' ? 'shock-strong' : s === '中' ? 'shock-mid' : 'shock-weak';

  const stats = {
    bull: analyzed.filter(n => n.direction.includes('利好')).length,
    bear: analyzed.filter(n => n.direction.includes('利空')).length,
    mixed: analyzed.filter(n => n.direction === '分化' || n.direction === '中性').length,
    vhigh: analyzed.filter(n => n.impact === '极高').length,
    high: analyzed.filter(n => n.impact === '高').length,
  };

  const newsCards = analyzed.map((n) => {
    const secs = (n.sectors || []).slice(0, 4);
    return [
      `<div class="news-card" onclick="this.classList.toggle('expanded')" data-impact="${n.impact}" data-direction="${n.direction}">`,
      `<div class="card-top">`,
      `<span class="badge ${dirCls(n.direction)}">${n.direction}</span>`,
      `<span class="impact-tag ${impactCls(n.impact)}">${n.impact}影响</span>`,
      `<span class="meta-chip">确定:${n.certainty}</span>`,
      `<span class="meta-chip">${n.time_window}</span>`,
      `</div>`,
      `<div class="card-title">${escHtml(n.title_cn || n.title)}</div>`,
      isAi ? `<div class="card-original-title">原文: ${escHtml(n.title.substring(0, 120))}</div>` : '',
      `<div class="card-summary">${escHtml(n.summary_cn || n.description.substring(0, 100))}</div>`,
      `<div class="card-meta">${n.source} · ${timeAgo(n.pubDate)}${n.link ? ` <a href="${n.link}" target="_blank" rel="noopener" onclick="event.stopPropagation()">原文 →</a>` : ''}</div>`,
      secs.length > 0 ? `<div class="card-tags-row">${secs.map(s => `<span class="tag">${escHtml(typeof s === 'object' ? s.name : s)}</span>`).join('')}</div>` : '',
      `<div class="card-expand">展开分析</div>`,
      `<div class="card-detail">`,
      `<div class="detail-section"><div class="detail-label">评级依据</div>方向:${n.direction} · 程度:${n.impact} · 确定性:${n.certainty} · 窗口:${n.time_window}</div>`,
      n.sectors && n.sectors.length > 0 ? `<div class="detail-section"><div class="detail-label">板块冲击</div>${n.sectors.map(s => `<div style="margin-bottom:4px;">&#9654; <strong>${escHtml(s.name)}</strong> <span class="${shockCls(s.shock_level || s.shock)}">${s.shock_level || s.shock}</span> <span style="color:${s.shock_direction === '利好' ? '#16a34a' : s.shock_direction === '利空' ? '#dc2626' : '#ea580c'}">${s.shock_direction || s.direction}</span> &mdash; ${escHtml(s.logic || '')} ${s.tickers && s.tickers !== '—' ? ' | 标的: ' + escHtml(s.tickers) : ''}</div>`).join('')}</div>` : '',
      n.notes ? `<div class="verify-note">&#x1F4DD; ${escHtml(n.notes)}</div>` : '',
      `</div></div>`,
    ].join('\n');
  }).join('\n');

  const matrixRows = sectorMatrix.map(s =>
    `<tr><td style="font-weight:700;">${escHtml(s.name)}</td><td class="${shockCls(s.shock)}">${s.shock}</td><td style="color:${s.direction === '利好' ? '#16a34a' : s.direction === '利空' ? '#dc2626' : '#ea580c'};">${s.direction}</td><td>${s.news_count}</td><td>${escHtml(s.summary || s.logic || '')}</td><td>${escHtml(s.tickers || '—')}</td></tr>`
  ).join('\n');

  const pointsHTML = keyPoints.map(p => `<div class="kp-card">${escHtml(p)}</div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>全球股市热点日报 · ${todayDisplay}</title>
<style>
  :root { --bg:#f5f6f8; --card-bg:#fff; --border:#e2e4e9; --text:#1a1d28; --text-dim:#6b7080; --text-muted:#9ca0af; --accent:#2563eb; }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh;-webkit-font-smoothing:antialiased;}
  .container{max-width:1080px;margin:0 auto;padding:20px 16px 40px;}
  .header{text-align:center;padding:36px 24px 20px;margin-bottom:20px;}
  .header h1{font-size:clamp(1.5rem,3.5vw,2rem);font-weight:800;color:#0f172a;letter-spacing:-0.02em;margin-bottom:6px;}
  .header .subtitle{font-size:.85rem;color:var(--text-dim);}
  .header .badge-row{margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}
  .chip{padding:3px 12px;border-radius:16px;font-size:.72rem;font-weight:600;border:1px solid var(--border);background:var(--card-bg);}
  .chip-ai{color:#2563eb;border-color:#bfdbfe;background:#eff6ff;}
  .disclaimer{font-size:.74rem;color:#b91c1c;margin-top:12px;display:inline-block;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 14px;}
  .stats-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:20px;}
  .stat-chip{background:var(--card-bg);border:1px solid var(--border);border-radius:20px;padding:5px 14px;font-size:.76rem;color:var(--text-dim);display:flex;align-items:center;gap:5px;}
  .stat-chip strong{color:var(--text);font-size:.95rem;}
  .section-title{font-size:1.05rem;font-weight:700;margin:24px 0 12px;padding-left:12px;border-left:3px solid var(--accent);color:#0f172a;}
  .news-grid{display:grid;gap:8px;}
  .news-card{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:14px 18px;cursor:pointer;transition:box-shadow .15s,border-color .15s;}
  .news-card:hover{box-shadow:0 2px 10px rgba(0,0,0,.05);border-color:#c8cbd4;}
  .card-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:2px;}
  .badge{display:inline-flex;align-items:center;gap:3px;padding:2px 9px;border-radius:12px;font-size:.66rem;font-weight:700;}
  .badge-bull{background:#dcfce7;color:#15803d;}
  .badge-bear{background:#fee2e2;color:#b91c1c;}
  .badge-neutral{background:#fff7ed;color:#c2410c;}
  .badge-mixed{background:#fef3c7;color:#92400e;}
  .impact-tag{font-size:.66rem;font-weight:700;padding:2px 7px;border-radius:4px;}
  .impact-vhigh{background:#fee2e2;color:#b91c1c;}
  .impact-high{background:#fff7ed;color:#c2410c;}
  .impact-mid{background:#fef9c3;color:#a16207;}
  .impact-low{background:#f0fdf4;color:#15803d;}
  .meta-chip{font-size:.64rem;color:var(--text-muted);background:#f3f4f6;padding:1px 6px;border-radius:8px;}
  .card-title{font-size:.9rem;font-weight:700;color:#0f172a;margin-bottom:2px;line-height:1.35;}
  .card-original-title{font-size:.7rem;color:var(--text-muted);margin-bottom:2px;font-style:italic;}
  .card-summary{font-size:.78rem;color:var(--text-dim);margin-bottom:4px;}
  .card-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:.7rem;color:var(--text-muted);}
  .card-meta a{color:var(--accent);text-decoration:none;font-size:.65rem;}
  .card-tags-row{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px;}
  .tag{padding:1px 7px;border-radius:4px;font-size:.66rem;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;}
  .card-expand{font-size:.7rem;color:var(--accent);font-weight:600;margin-top:4px;display:flex;align-items:center;gap:4px;}
  .card-expand::after{content:'\\25B8';font-size:.55rem;transition:transform .2s;}
  .news-card.expanded .card-expand::after{transform:rotate(90deg);}
  .card-detail{display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:.78rem;color:var(--text);line-height:1.65;}
  .news-card.expanded .card-detail{display:block;}
  .detail-section{margin-bottom:8px;}
  .detail-label{font-weight:700;font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;margin-bottom:1px;}
  .verify-note{font-size:.7rem;color:#b45309;font-style:italic;margin-top:6px;padding:6px 10px;background:#fffbeb;border-radius:4px;}
  .table-wrap{overflow-x:auto;margin-bottom:24px;border-radius:10px;border:1px solid var(--border);}
  table{width:100%;border-collapse:collapse;font-size:.76rem;background:var(--card-bg);}
  th{background:#f8f9fb;color:var(--text-dim);padding:9px 11px;text-align:left;font-weight:600;white-space:nowrap;border-bottom:2px solid var(--border);font-size:.7rem;text-transform:uppercase;}
  td{padding:8px 11px;border-bottom:1px solid var(--border);vertical-align:top;}
  tr:last-child td{border-bottom:none;}
  .shock-strong{color:#dc2626;font-weight:700;}
  .shock-mid{color:#ea580c;font-weight:600;}
  .shock-weak{color:#16a34a;}
  .key-points{display:grid;gap:6px;margin-bottom:24px;}
  .kp-card{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:12px 16px;font-size:.8rem;line-height:1.55;border-left:3px solid var(--accent);}
  .market-summary{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:14px 18px;font-size:.82rem;line-height:1.6;margin-bottom:24px;color:var(--text);}
  .footer{text-align:center;padding:16px;font-size:.7rem;color:var(--text-muted);border-top:1px solid var(--border);margin-top:28px;line-height:1.7;}
  @media(max-width:640px){.container{padding:8px 6px 20px;}.header{padding:20px 10px 10px;}.news-card{padding:10px 12px;}}
</style>
</head>
<body>
<div class="container">

<div class="header">
  <h1>全球股市热点日报</h1>
  <div class="subtitle">${todayDisplay} · ${analyzed.length} 条精选 · 自动生成</div>
  <div class="badge-row">
    <span class="chip ${isAi ? 'chip-ai' : 'chip'}">${isAi ? 'AI 分析' : '关键词引擎'}</span>
    ${isAi ? '<span class="chip chip-ai">中文翻译</span>' : ''}
    <span class="chip">每日 ${String(new Date().getHours()).padStart(2,'0')}:00 更新</span>
  </div>
  <div class="disclaimer">免责声明：基于公开信息自动整理，不构成投资建议。股市有风险，投资需谨慎。</div>
</div>

<div class="stats-row">
  <div class="stat-chip">利好 <strong style="color:#16a34a;">${stats.bull}</strong></div>
  <div class="stat-chip">利空 <strong style="color:#dc2626;">${stats.bear}</strong></div>
  <div class="stat-chip">分化/中性 <strong style="color:#92400e;">${stats.mixed}</strong></div>
  <div class="stat-chip">极高 <strong style="color:#dc2626;">${stats.vhigh}</strong></div>
  <div class="stat-chip">高影响 <strong style="color:#ea580c;">${stats.high}</strong></div>
  <div class="stat-chip">板块 <strong>${sectorMatrix.length}</strong></div>
</div>

${marketSummary ? `<div class="market-summary">&#x1F4A1; ${escHtml(marketSummary)}</div>` : ''}

<div class="news-grid">
${newsCards}
</div>

<div class="section-title">板块冲击矩阵</div>
<div class="table-wrap">
  <table>
    <thead><tr><th>板块</th><th>冲击</th><th>方向</th><th>新闻数</th><th>传导逻辑</th><th>关联标的</th></tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>
</div>

<div class="section-title">今日要点</div>
<div class="key-points">${pointsHTML}</div>

<div class="footer">
  基于 Google News RSS 源自动抓取 · ${isAi ? 'Claude API 智能分析 + 中文翻译' : '关键词引擎自动分类'}<br>
  不构成投资建议。<strong>股市有风险，投资需谨慎。</strong><br>
  Generated ${new Date().toISOString()}
</div>

</div>
</body>
</html>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 主流程 ─────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  全球股市热点日报 · 自动构建');
  console.log('═══════════════════════════════════════');
  console.log(`  时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log(`  AI 分析: ${CONFIG.apiKey ? 'Claude API' : '未启用 (关键词引擎)'}`);
  console.log(`  Google News RSS: ${CONFIG.feeds.length} 源`);

  // 1. Fetch
  const newsItems = await fetchAllNews();
  console.log(`\n✅ 最终拉取 ${newsItems.length} 条待分析新闻\n`);

  // 2. Analyze
  const result = await analyzeWithClaude(newsItems);

  // 3. Sort by impact
  const impactRank = { '极高': 0, '高': 1, '中': 2, '低': 3 };
  result.analyzed.sort((a, b) => {
    const ia = impactRank[a.impact] || 9;
    const ib = impactRank[b.impact] || 9;
    if (ia !== ib) return ia - ib;
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  // 4. Render HTML
  const todayDisplay = getTodayDisplay();
  const html = renderHTML(result, todayDisplay);

  // 5. Write files
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const dateStr = getTodayStr();
  const outPath = join(OUTPUT_DIR, `股市热点日报_${dateStr}.html`);
  writeFileSync(outPath, html, 'utf-8');
  console.log(`📄 输出: ${outPath}`);

  const indexPath = join(PROJECT_ROOT, 'index.html');
  writeFileSync(indexPath, html, 'utf-8');
  console.log(`📄 首页: ${indexPath}`);

  console.log('\n✅ 完成！\n');
}

main().catch(err => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
