#!/usr/bin/env node
// 本地预览 + 手动刷新服务
// 访问 http://127.0.0.1:3456 看最新页面，点按钮直接重建+推送
import { execSync, spawn } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { renderHTML } from './build-daily.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, 'index.html');
const HISTORY_DIR = join(ROOT, 'history');
const PORT = 3456;

const MIME = {
  'js': 'application/javascript; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'html': 'text/html; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'svg': 'image/svg+xml',
};
function mimeOf(path) {
  return MIME[path.split('.').pop()] || 'application/octet-stream';
}

let lastStatus = { state: 'idle', time: null, error: null };

function serveFile(res, code, contentType, body) {
  res.writeHead(code, { 'Content-Type': contentType });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve static assets (e.g. /assets/chart.umd.min.js)
  if (req.method === 'GET' && req.url.startsWith('/assets/')) {
    const filePath = join(ROOT, req.url.split('?')[0]);
    if (filePath.startsWith(join(ROOT, 'assets')) && existsSync(filePath)) {
      serveFile(res, 200, mimeOf(filePath), readFileSync(filePath));
    } else {
      serveFile(res, 404, 'text/plain', 'Not found');
    }
    return;
  }

  // List available history dates — must precede the /history/ prefix route,
  // which would otherwise shadow this exact match.
  if (req.method === 'GET' && req.url === '/history/dates') {
    let dates = [];
    if (existsSync(HISTORY_DIR)) {
      const files = readdirSync(HISTORY_DIR);
      dates = [...new Set(
        files
          .filter(f => /^日报_\d{8}\.(json|html)$/.test(f))
          .map(f => f.replace('日报_', '').replace(/\.(json|html)$/, ''))
      )].sort().reverse();
    }
    serveFile(res, 200, 'application/json; charset=utf-8', JSON.stringify({ dates }));
    return;
  }

  // Serve static history files (dates.json, 日报_YYYYMMDD.json/.html) — same
  // layout as the gh-pages deployment, so local preview and live behave alike.
  if (req.method === 'GET' && req.url.startsWith('/history/')) {
    // Filenames are Chinese (日报_20260807.html); browsers percent-encode them.
    const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/history\//, ''));
    if (rel && !rel.includes('..')) {
      const filePath = join(HISTORY_DIR, rel);
      if (existsSync(filePath)) {
        serveFile(res, 200, mimeOf(filePath), readFileSync(filePath));
        return;
      }
    }
    serveFile(res, 404, 'text/plain', 'Not found');
    return;
  }

  // Serve historical report as HTML
  if (req.method === 'GET' && req.url.startsWith('/history?date=')) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const dateStr = urlObj.searchParams.get('date');
    if (!/^\d{8}$/.test(dateStr)) {
      serveFile(res, 400, 'application/json', JSON.stringify({ error: 'Invalid date format, use YYYYMMDD' }));
      return;
    }
    const jsonPath = join(HISTORY_DIR, `日报_${dateStr}.json`);
    if (!existsSync(jsonPath)) {
      serveFile(res, 404, 'text/plain', '该日期无数据');
      return;
    }
    try {
      const json = JSON.parse(readFileSync(jsonPath, 'utf-8'));
      // Convert ISO date strings back to Date objects
      json.analyzed = (json.analyzed || []).map(n => ({ ...n, pubDate: new Date(n.pubDate) }));
      const displayDate = json.displayDate || `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
      // The archived payload embeds chartData, so no recompute fallback is needed.
      const chartData = json.chartData || { etfTrend: { dates: [], datasets: [], hasData: false }, sentiment: { hasData: false }, heatmap: { hasData: false }, direction: { hasData: false }, timeWindow: { hasData: false } };
      const html = renderHTML(json, displayDate, json.etfData || [], chartData);
      serveFile(res, 200, 'text/html; charset=utf-8', html);
    } catch (err) {
      serveFile(res, 500, 'text/plain', '历史数据解析失败: ' + err.message);
    }
    return;
  }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    if (existsSync(INDEX)) {
      serveFile(res, 200, 'text/html; charset=utf-8', readFileSync(INDEX, 'utf-8'));
    } else {
      serveFile(res, 404, 'text/plain', 'index.html 不存在，请先构建');
    }
    return;
  }

  // Status endpoint
  if (req.method === 'GET' && req.url === '/status') {
    serveFile(res, 200, 'application/json', JSON.stringify(lastStatus));
    return;
  }

  // Refresh endpoint — run build + push
  if (req.method === 'POST' && req.url === '/refresh') {
    if (lastStatus.state === 'running') {
      serveFile(res, 409, 'application/json', JSON.stringify({ status: 'error', message: '已有构建正在运行' }));
      return;
    }

    lastStatus = { state: 'running', time: new Date().toISOString(), error: null };
    console.log(`\n[${lastStatus.time}] 🔄 收到手动刷新请求`);

    serveFile(res, 202, 'application/json', JSON.stringify({ status: 'accepted', time: lastStatus.time }));

    (async () => {
      const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`exit code ${code}`));
        });
      });
      try {
        console.log('  1/3 构建中...');
        // Run the build as an async child process with NO hard timeout — the
        // pipeline can legitimately take 3-9 min when the AI proxy is slow and
        // the build retries. A sync execSync with a short timeout would get
        // killed mid-AI-analysis and leave a half-written report.
        await run('node', ['scripts/build-daily.mjs']);

        console.log('  2/3 git commit...');
        execSync('git add index.html scripts/build-daily.mjs scripts/refresh-server.mjs history/', { cwd: ROOT, timeout: 10_000 });
        execSync(`git commit -m "手动刷新: ${new Date().toLocaleString('zh-CN')}"`, { cwd: ROOT, timeout: 10_000 });

        console.log('  3/3 git push...');
        execSync('git push', { cwd: ROOT, timeout: 30_000 });

        lastStatus = { state: 'done', time: new Date().toISOString(), error: null };
        console.log('  ✅ 刷新完成');
      } catch (err) {
        lastStatus = { state: 'error', time: new Date().toISOString(), error: err.message };
        console.error(`  ❌ 刷新失败: ${err.message}`);
      }
    })();
    return;
  }

  serveFile(res, 404, 'text/plain', 'Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🌐 本地预览: http://127.0.0.1:${PORT}`);
  console.log(`   GET / — 查看最新页面`);
  console.log(`   GET /history/dates — 历史日期列表`);
  console.log(`   GET /history?date=YYYYMMDD — 历史日报`);
  console.log(`   POST /refresh — 触发重建+推送\n`);
});
