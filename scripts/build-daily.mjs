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

  // Google News RSS — 聚焦半导体、光模块、AI应用
  feeds: [
    { url: 'https://news.google.com/rss/search?q=semiconductor+chip+Nvidia+TSMC+Intel+AMD+HBM+foundry&hl=en-US&gl=US&ceid=US:en', name: '半导体' },
    { url: 'https://news.google.com/rss/search?q=optical+transceiver+800G+1.6T+silicon+photonics+CPO+LPO+data+center+interconnect&hl=en-US&gl=US&ceid=US:en', name: '光模块' },
    { url: 'https://news.google.com/rss/search?q=AI+application+agent+LLM+GPT+Claude+Gemini+artificial+intelligence+software&hl=en-US&gl=US&ceid=US:en', name: 'AI应用' },
    { url: 'https://news.google.com/rss/search?q=%E5%8D%8A%E5%AF%BC%E4%BD%93+%E8%8A%AF%E7%89%87+%E5%85%89%E6%A8%A1%E5%9D%97+AI+%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '中文-半导体AI' },
    { url: 'https://news.google.com/rss/search?q=China+semiconductor+chip+sanction+export+control+光刻+EDA&hl=en-US&gl=US&ceid=US:en', name: '中国芯片' },
    { url: 'https://news.google.com/rss/search?q=AI+data+center+server+GPU+compute+power+算力+cloud&hl=en-US&gl=US&ceid=US:en', name: '算力/数据中心' },
    { url: 'https://news.google.com/rss/search?q=光模块+光通信+CPO+硅光+800G+1.6T+中际旭创+新易盛+天孚通信&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '中文-光模块' },
    { url: 'https://news.google.com/rss/search?q=AI应用+大模型+智能体+agent+应用落地+软件&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '中文-AI应用' },
  ],
  // A-share leaders — direct coverage of key stocks
  extraFeeds: [
    { url: 'https://news.google.com/rss/search?q=KOSPI+KOSDAQ+Samsung+SK+hynix+Korean+semiconductor+KRX&hl=en-US&gl=US&ceid=US:en', name: '韩国半导体' },
    { url: 'https://news.google.com/rss/search?q=NASDAQ+SOX+semiconductor+index+Nvidia+AMD+Broadcom+Qualcomm+US+stock&hl=en-US&gl=US&ceid=US:en', name: '美股半导体' },
    { url: 'https://news.google.com/rss/search?q=삼성전자+SK하이닉스+반도체+한국+증시&hl=ko-KR&gl=KR&ceid=KR:ko', name: '한국-반도체' },
    // A-share leader tracking
    { url: 'https://news.google.com/rss/search?q=中际旭创+新易盛+天孚通信+光模块+制裁+出口管制+业绩+订单&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '光模块龙头' },
    { url: 'https://news.google.com/rss/search?q=中芯国际+北方华创+中微公司+海光信息+寒武纪+先进制程+设备+制裁+产能&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: '半导体龙头' },
    { url: 'https://news.google.com/rss/search?q=金山办公+科大讯飞+万兴科技+拓尔思+AI应用+软件+A股+制裁&hl=zh-CN&gl=CN&ceid=CN:zh-Hans', name: 'AI应用龙头' },
    { url: 'https://news.google.com/rss/search?q=Zhongji+Innolight+Eoptolink+Tianfu+optical+sanction+export+ban+BIS+entity+list&hl=en-US&gl=US&ceid=US:en', name: 'Optical-US' },
  ],

  maxAgeSeconds: 2 * 24 * 3600,
  maxNewsCount: 30,
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
  if (h < 1) return Math.floor(diff / 60000) + '分钟前';
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
  const allFeeds = [...CONFIG.feeds, ...(CONFIG.extraFeeds || [])];
  for (let i = 0; i < allFeeds.length; i++) {
    const feed = allFeeds[i];
    console.log(`  [${i + 1}/${allFeeds.length}] ${feed.name}...`);
    try {
      const items = await fetchGoogleNewsRSS(feed);
      console.log(`    → ${items.length} 条`);
      allItems.push(...items);
    } catch (err) {
      console.warn(`    ⚠ 失败: ${err.message}`);
    }
    // Space requests to avoid rate limiting
    if (i < allFeeds.length - 1) await sleep(1500);
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
  const days = Math.ceil(CONFIG.maxAgeSeconds / 86400);
  const recent = deduped.filter(item => (now - item.pubDate.getTime()) < CONFIG.maxAgeSeconds * 1000);
  console.log(`  去重后 ${deduped.length} 条，${days}天内 ${recent.length} 条`);

  if (recent.length < 10) {
    console.log(`  ${days}天内不足10条，放宽到7天...`);
    const wide = deduped.filter(item => (now - item.pubDate.getTime()) < 7 * 24 * 3600 * 1000);
    console.log(`  7天内 ${wide.length} 条`);
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

  const prompt = `你是资深科技行业分析师，专注半导体、光模块、AI应用三大赛道。以下 ${newsItems.length} 条新闻来自 RSS 抓取。

核心任务：去重合并为 8-15 条行业简讯。规则：同类涨跌合并为一条，去情绪化/个人故事/标题党，保留技术突破/政策/订单/产能/竞争/制裁等有产业逻辑内容。三个板块务必各有覆盖。

每条简讯：title_cn、summary_cn、category、direction、impact、certainty、time_window、tickers、notes。
另生成 sector_matrix（三条固定：半导体/光模块/AI应用）、key_points（3-5条）、market_summary。

输出标准 JSON —— 注意 analyzed 是一个数组，放在一个 JSON 对象里：
{"analyzed": [{"title_cn": "...", ...}], "sector_matrix": [...], "key_points": [...], "market_summary": "..."}

只输出 JSON，不要其他内容。新闻原文：

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

  // AI returns consolidated briefs (8-15), not 1:1 with input
  // Use current date for all consolidated items
  const now = new Date().toISOString();
  const analyzed = (result.analyzed || []).map((ai, i) => ({
    title_cn: ai.title_cn || '[未命名]',
    summary_cn: ai.summary_cn || '',
    category: ai.category || '',
    direction: ai.direction || '中性',
    impact: ai.impact || '中',
    certainty: ai.certainty || '中',
    time_window: ai.time_window || '中期',
    tickers: ai.tickers || '—',
    notes: ai.notes || '',
    // Use synthetic values for display since these are consolidated
    title: ai.title_cn || '',
    description: ai.summary_cn || '',
    pubDate: new Date(),
    source: 'AI综合',
    link: '',
  }));
  // Force sector_matrix to always be exactly these 3 with defaults, merging with AI output
  const defaultMatrix = {
    '半导体': { name: '半导体', shock: '中', direction: '中性', news_count: 0, summary: '', tickers: '' },
    '光模块': { name: '光模块', shock: '中', direction: '中性', news_count: 0, summary: '', tickers: '' },
    'AI应用': { name: 'AI应用', shock: '中', direction: '中性', news_count: 0, summary: '', tickers: '' },
  };
  const aiMatrix = Array.isArray(result.sector_matrix) ? result.sector_matrix : [];
  for (const s of aiMatrix) {
    if (s.name && defaultMatrix[s.name]) {
      Object.assign(defaultMatrix[s.name], s);
    }
  }
  // Count categories from analyzed
  for (const item of analyzed) {
    const cat = item.category;
    if (cat && defaultMatrix[cat]) defaultMatrix[cat].news_count++;
  }
  const finalMatrix = Object.values(defaultMatrix).filter(s => s.news_count > 0 || s.summary);
  console.log(`  AI去重合并: ${analyzed.length} 条行业简讯（原始 ${newsItems.length} 条）`);
  return {
    analyzed,
    sectorMatrix: finalMatrix,
    keyPoints: result.key_points || [],
    marketSummary: result.market_summary || '',
    isAi: true,
  };
}

// ── 本地关键词引擎 (fallback) ─────────────────────────

function analyzeWithKeywords(newsItems) {
  const RULES = [
    { kw: ['Nvidia','英伟达','GPU','H100','H200','B100','B200','Blackwell','Hopper','Rubin'], category: '半导体', impact: '极高', dir: '利好', tickers: '—', time: '短期' },
    { kw: ['TSMC','台积电','foundry','代工','3nm','2nm','先进制程','CoWoS'], category: '半导体', impact: '高', dir: '利好', tickers: '中芯国际', time: '中期' },
    { kw: ['ASML','光刻','lithography','EUV','DUV'], category: '半导体', impact: '高', dir: '分化', tickers: '北方华创、中微公司', time: '中期' },
    { kw: ['HBM','高带宽内存','SK hynix','Samsung','美光','Micron'], category: '半导体', impact: '高', dir: '利好', tickers: '—', time: '短期' },
    { kw: ['chip ban','chip export','chip restriction','芯片管制','出口管制','semiconductor export','sanction','制裁','entity list'], category: '半导体', impact: '极高', dir: '分化', tickers: '中芯国际、北方华创、中微公司', time: '短期' },
    { kw: ['optical','transceiver','光模块','800G','1.6T','800g','1.6t','CPO','LPO','光通信','硅光','silicon photonic'], category: '光模块', impact: '高', dir: '利好', tickers: '中际旭创、新易盛、天孚通信', time: '短期' },
    { kw: ['data center','数据中心','hyperscaler','云服务','cloud','AWS','Azure','Google Cloud'], category: '光模块', impact: '高', dir: '利好', tickers: '中际旭创、工业富联', time: '中期' },
    { kw: ['AI agent','智能体','AI应用','大模型','LLM','GPT','Claude','Gemini','应用落地','SaaS','copilot'], category: 'AI应用', impact: '高', dir: '利好', tickers: '金山办公、科大讯飞', time: '中期' },
    { kw: ['open source','开源模型','Llama','Mistral','DeepSeek','深度求索','deepseek'], category: 'AI应用', impact: '中', dir: '利好', tickers: '—', time: '中期' },
    { kw: ['chip','semiconductor','半导体','芯片','processor','封测','EDA','IP'], category: '半导体', impact: '中', dir: '利好', tickers: '—', time: '中期' },
    { kw: ['AI','artificial intelligence','人工智能','算力','compute'], category: 'AI应用', impact: '中', dir: '利好', tickers: '—', time: '中期' },
    { kw: ['server','服务器','rack','机架','cooling','散热','液冷'], category: '光模块', impact: '中', dir: '利好', tickers: '工业富联、浪潮信息', time: '短期' },
    { kw: ['quantum','量子','quantum computing'], category: '半导体', impact: '低', dir: '利好', tickers: '—', time: '长期' },
    { kw: ['China chip','国产替代','自主可控','localization','domestic chip','国产芯片'], category: '半导体', impact: '高', dir: '利好', tickers: '中芯国际、北方华创、海光信息', time: '中期' },
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

    const rule = best || { impact: '低', dir: '中性', category: '', tickers: '—', time: '中期' };
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
  });

  const secMap = {
    '半导体': { name: '半导体', shock: '中', direction: '分化', news_count: 0, summary: '', tickers: '' },
    '光模块': { name: '光模块', shock: '中', direction: '利好', news_count: 0, summary: '', tickers: '' },
    'AI应用': { name: 'AI应用', shock: '中', direction: '利好', news_count: 0, summary: '', tickers: '' },
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
  const matrix = Object.values(secMap).filter(s => s.news_count > 0).sort((a, b) => shockOrder[a.shock] - shockOrder[b.shock] || b.news_count - a.news_count);

  const points = [
    `今日共抓取 ${analyzed.length} 条科技新闻，聚焦半导体、光模块、AI应用三大赛道。`,
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
    points.push(`核心关注：${topNews.map(n => n.title_cn || n.title).join('；')}。`);
  }

  return {
    analyzed,
    sectorMatrix: matrix,
    keyPoints: points,
    marketSummary: `本日报聚焦半导体、光模块、AI应用三大科技赛道，${analyzed.length} 条新闻经AI分析自动生成。`,
    isAi: false,
  };
}

// ── HTML 渲染 ──────────────────────────────────────────

function renderHTML(result, todayDisplay) {
  const { analyzed, sectorMatrix, keyPoints, marketSummary, isAi } = result;

  const impactCls = (imp) => imp === '极高' ? 'impact-vhigh' : imp === '高' ? 'impact-high' : imp === '中' ? 'impact-mid' : 'impact-low';
  const dirCls = (d) => (d || '').includes('利好') ? 'badge-bull' : (d || '').includes('利空') ? 'badge-bear' : (d === '中性' ? 'badge-neutral' : 'badge-mixed');
  const dirEmoji = (d) => (d || '').includes('利好') ? '🟢' : (d || '').includes('利空') ? '🔴' : '🟡';
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
      `<div class="card-cat cat-${n.category === '半导体' ? 'semi' : n.category === '光模块' ? 'optics' : n.category === 'AI应用' ? 'ai' : 'other'}">${escHtml(n.category || '综合')}</div>`,
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
      `<span>${timeAgo(n.pubDate)}</span>`,
      n.tickers && n.tickers !== '—' ? `<span class="ticker-inline">${escHtml(n.tickers)}</span>` : '',
      n.link ? ` <a href="${n.link}" target="_blank" rel="noopener" onclick="event.stopPropagation()">原文</a>` : '',
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

  const matrixRows = (Array.isArray(sectorMatrix) ? sectorMatrix : []).map(s =>
    `<tr><td style="font-weight:700;">${escHtml(s.name)}</td><td class="${shockCls(s.shock)}">${s.shock}</td><td style="color:${s.direction === '利好' ? '#16a34a' : s.direction === '利空' ? '#dc2626' : '#ea580c'};">${s.direction}</td><td>${s.news_count}</td><td>${escHtml(s.summary || s.logic || '')}</td><td>${escHtml(s.tickers || '—')}</td></tr>`
  ).join('\n');

  const pointsHTML = keyPoints.map(p => `<div class="kp-card">${escHtml(p)}</div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>科技板块日报 · ${todayDisplay}</title>
<style>
  :root {
    --bg:#f0f2f5; --card-bg:#fff; --border:#e2e4e9; --text:#1a1d28;
    --text-dim:#5f6570; --text-muted:#9ca0af; --accent:#2563eb;
    --semi:#7c3aed; --optics:#0891b2; --ai:#059669;
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

  /* Stats mini */
  .stats-mini{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:16px;}
  .st{background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:4px 10px;font-size:.7rem;color:var(--text-dim);}
  .st b{color:var(--text);font-size:.82rem;margin:0 1px;}

  /* Sector summary row */
  .sector-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px;}
  @media(max-width:600px){.sector-row{grid-template-columns:1fr;}}
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
  .cat-semi{background:var(--semi);}
  .cat-optics{background:var(--optics);}
  .cat-ai{background:var(--ai);}
  .cat-other{background:#6b7280;}
  .fresh-badge{font-size:.55rem;font-weight:800;color:#fff;background:#ef4444;border-radius:3px;padding:1px 4px;}

  .card-right{flex:1;min-width:0;}
  .card-title{font-size:.85rem;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:2px;}
  .card-original-title{font-size:.67rem;color:var(--text-muted);margin-bottom:2px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .card-summary{font-size:.75rem;color:var(--text-dim);margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .card-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:.66rem;color:var(--text-muted);}
  .card-meta a{color:var(--accent);text-decoration:none;}
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

  .market-summary{background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;font-size:.78rem;line-height:1.6;margin-bottom:16px;}

  /* Footer */
  .footer{text-align:center;padding:14px;font-size:.66rem;color:var(--text-muted);border-top:1px solid var(--border);margin-top:20px;line-height:1.7;}
  .footer strong{color:#b91c1c;}
</style>
</head>
<body>
<div class="container">

<div class="header">
  <h1>📡 科技板块日报</h1>
  <div class="subtitle">${todayDisplay} · ${analyzed.length} 条精选 · 半导体 / 光模块 / AI应用</div>
  <div class="badge-row">
    <span class="chip ${isAi ? 'chip-ai' : 'chip'}">${isAi ? 'AI 分析' : '关键词引擎'}</span>
    ${isAi ? '<span class="chip chip-ai">中文翻译</span>' : ''}
    <span class="chip">每交易日更新</span>
  </div>
  <div class="disclaimer">免责声明：基于公开信息自动整理，不构成投资建议。股市有风险，投资需谨慎。</div>
</div>

<div class="stats-mini">
  <div class="st">📈利好 <b style="color:#15803d">${stats.bull}</b></div>
  <div class="st">📉利空 <b style="color:#dc2626">${stats.bear}</b></div>
  <div class="st">⚡极高 <b style="color:#dc2626">${stats.vhigh}</b></div>
  <div class="st">🔥高影响 <b style="color:#ea580c">${stats.high}</b></div>
  <div class="st">📊板块 <b>${sectorMatrix.length}</b></div>
</div>

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

<div class="sec-title">新闻列表（按时间从近到远）</div>
<div class="news-grid">
${newsCards}
</div>

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
  基于 Google News RSS 自动抓取 · ${isAi ? 'Claude API 智能分析 + 中文翻译' : '关键词引擎自动分类'}<br>
  监控范围：半导体 / 光模块 / AI应用 &nbsp;|&nbsp; 包含韩国及美股半导体市场<br>
  不构成投资建议。<strong>股市有风险，投资需谨慎。</strong>
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

  // 3. Sort by date (newest first), then by impact
  const impactRank = { '极高': 0, '高': 1, '中': 2, '低': 3 };
  result.analyzed.sort((a, b) => {
    const db = new Date(b.pubDate) - new Date(a.pubDate);
    if (Math.abs(db) > 3600000) return db;
    const ia = impactRank[a.impact] || 9;
    const ib = impactRank[b.impact] || 9;
    return ia - ib;
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
