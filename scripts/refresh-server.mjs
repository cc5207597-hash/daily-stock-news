#!/usr/bin/env node
// 本地预览 + 手动刷新服务
// 访问 http://127.0.0.1:3456 看最新页面，点按钮直接重建+推送
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, 'index.html');
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
        execSync('git add index.html scripts/build-daily.mjs', { cwd: ROOT, timeout: 10_000 });
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
  console.log(`   POST /refresh — 触发重建+推送\n`);
});
