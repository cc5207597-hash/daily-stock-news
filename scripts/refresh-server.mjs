#!/usr/bin/env node
// Refresh server — POST /refresh runs the full build + push pipeline
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 3456;

let lastStatus = { state: 'idle', time: null, error: null };

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lastStatus));
    return;
  }

  if (req.method === 'POST' && req.url === '/refresh') {
    if (lastStatus.state === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: '已有构建正在运行' }));
      return;
    }

    lastStatus = { state: 'running', time: new Date().toISOString(), error: null };
    console.log(`\n[${lastStatus.time}] 🔄 收到手动刷新请求`);

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', time: lastStatus.time }));

    // Run build async, don't block the response
    (async () => {
      try {
        console.log('  1/3 构建中...');
        execSync('node scripts/build-daily.mjs', { cwd: ROOT, stdio: 'inherit', timeout: 180_000 });

        console.log('  2/3 git commit...');
        execSync('git add index.html scripts/build-daily.mjs output/', { cwd: ROOT, timeout: 10_000 });
        execSync(`git commit -m "手动刷新: ${new Date().toLocaleString('zh-CN')}"`, { cwd: ROOT, timeout: 10_000 });

        console.log('  3/3 git push...');
        execSync('git push', { cwd: ROOT, timeout: 30_000 });

        lastStatus = { state: 'done', time: new Date().toISOString(), error: null };
        console.log(`  ✅ 刷新完成`);
      } catch (err) {
        lastStatus = { state: 'error', time: new Date().toISOString(), error: err.message };
        console.error(`  ❌ 刷新失败: ${err.message}`);
      }
    })();
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🔄 手动刷新服务: http://127.0.0.1:${PORT}`);
  console.log(`   GET /status — 查看状态`);
  console.log(`   POST /refresh — 触发重建+推送\n`);
});
