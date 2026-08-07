#!/usr/bin/env node
// 本地预览 + 手动刷新服务
// 访问 http://127.0.0.1:3456 看最新页面，点按钮直接重建+推送
import { execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { renderHTML, escHtml } from './build-daily.mjs';
import { buildSentimentData, buildImpactHeatmap, buildDirectionChart, buildTimeWindowData } from '../pipeline/charts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, 'index.html');
const OUTPUT_DIR = join(ROOT, 'output');
const PORT = 3456;

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
      const ext = filePath.split('.').pop();
      const mime = { 'js': 'application/javascript; charset=utf-8', 'css': 'text/css; charset=utf-8', 'html': 'text/html; charset=utf-8', 'png': 'image/png', 'jpg': 'image/jpeg', 'svg': 'image/svg+xml', 'json': 'application/json; charset=utf-8' }[ext] || 'application/octet-stream';
      serveFile(res, 200, mime, readFileSync(filePath));
    } else {
      serveFile(res, 404, 'text/plain', 'Not found');
    }
    return;
  }

  // List available history dates
  if (req.method === 'GET' && req.url === '/history/dates') {
    let dates = [];
    if (existsSync(OUTPUT_DIR)) {
      const files = readdirSync(OUTPUT_DIR);
      dates = files
        .filter(f => f.startsWith('股市热点日报_') && f.endsWith('.json'))
        .map(f => f.replace('股市热点日报_', '').replace('.json', ''))
        .filter(d => /^\d{8}$/.test(d))
        .sort()
        .reverse();
    }
    serveFile(res, 200, 'application/json; charset=utf-8', JSON.stringify({ dates }));
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
    const jsonPath = join(OUTPUT_DIR, `股市热点日报_${dateStr}.json`);
    if (!existsSync(jsonPath)) {
      serveFile(res, 404, 'text/plain', '该日期无数据');
      return;
    }
    try {
      const json = JSON.parse(readFileSync(jsonPath, 'utf-8'));
      // Convert ISO date strings back to Date objects
      json.analyzed = (json.analyzed || []).map(n => ({ ...n, pubDate: new Date(n.pubDate) }));
      const displayDate = json.displayDate || `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
      // Restore chart data — prefer the saved payload, fall back to recomputing
      const chartData = json.chartData || {
        etfTrend: { dates: [], datasets: [], hasData: false },
        sentiment: buildSentimentData(json.analyzed),
        heatmap: buildImpactHeatmap(json.analyzed),
        direction: buildDirectionChart(json.analyzed),
        timeWindow: buildTimeWindowData(json.analyzed),
      };
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
      try {
        console.log('  1/3 构建中...');
        execSync('node scripts/build-daily.mjs', { cwd: ROOT, stdio: 'inherit', timeout: 180_000 });

        console.log('  2/3 git commit...');
        execSync('git add index.html scripts/build-daily.mjs scripts/refresh-server.mjs', { cwd: ROOT, timeout: 10_000 });
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
