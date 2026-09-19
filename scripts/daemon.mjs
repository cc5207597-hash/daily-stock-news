#!/usr/bin/env node
// ── 守护脚本:隧道 + 刷新服务 + git 代理 ─────────────────
// 目的:让 http://127.0.0.1:3456 稳定可访问,点刷新推送能成功。
//
// 职责:
//   1. 拉起隧道(scripts/tunnel.mjs, 127.0.0.1:37777) — 让 git push 能连上
//      github.com(被墙的 DNS 解析经隧道转发到可达 IP)。
//   2. 拉起刷新服务(scripts/refresh-server.mjs, 127.0.0.1:3456) — 本地预览
//      + 点按钮重建。
//   3. 配好 git 代理(http://127.0.0.1:37777),否则隧道起来 git 也不会用。
//   4. 任一方崩溃 → 3s 后自动重启,反复崩溃最多退避到 30s,防止死循环刷屏。
//   5. 可重复启动:若 3456/37777 已被占用则复用现有进程,不重复拉起。
//
// 用法:
//   node scripts/daemon.mjs          # 前台(带日志)
//   start /min node scripts/daemon.mjs   # 后台最小化(开机自启用)
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 37777; // 隧道监听
const SITE_PORT = 3456;   // 刷新服务监听

const mkRun = (name, cmd, args, port) => ({
  name, cmd, args, port,
  proc: null,
  startedAt: 0,
  crashCount: 0,
});

const tunnel = mkRun('tunnel', 'node', ['scripts/tunnel.mjs'], PROXY_PORT);
const server = mkRun('refresh-server', 'node', ['scripts/refresh-server.mjs'], SITE_PORT);

function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: PROXY_HOST, port, timeout: 1200 });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function backoff(proc) {
  // 崩溃越频繁,重启间隔越长;上限 30s,避免崩溃循环刷屏
  const sec = Math.min(30, 3 * (proc.crashCount + 1));
  return sec * 1000;
}

function ensureGitProxy() {
  try {
    const cur = execSync('git config --get http.proxy', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const want = `http://${PROXY_HOST}:${PROXY_PORT}`;
    if (cur !== want) {
      execSync(`git config http.proxy "${want}"`, { stdio: 'inherit' });
      console.log(`  [daemon] git http.proxy 已设置为 ${want}`);
    }
  } catch {
    try {
      execSync(`git config http.proxy "http://${PROXY_HOST}:${PROXY_PORT}"`, { stdio: 'inherit' });
      console.log(`  [daemon] git http.proxy 已设置为 http://${PROXY_HOST}:${PROXY_PORT}`);
    } catch (err) {
      console.error('  [daemon] 配置 git 代理失败:', err.message);
    }
  }
}

function startProc(proc) {
  if (proc.proc && proc.proc.exitCode === null) return; // 已在跑
  console.log(`  [daemon] 启动 ${proc.name} (${proc.cmd} ${proc.args.join(' ')})`);
  const child = spawn(proc.cmd, proc.args, { cwd: ROOT, stdio: 'inherit' });
  proc.proc = child;
  proc.startedAt = Date.now();
  proc.crashCount = 0;
  child.on('exit', (code) => {
    console.log(`  [daemon] ${proc.name} 退出 (code=${code})`);
    proc.proc = null;
    // 快速连续崩溃会指数退避,避免刷屏
    const delay = backoff(proc);
    proc.crashCount++;
    setTimeout(() => startProc(proc), delay);
  });
}

async function ensureStarted(proc) {
  // 端口已被占用 → 视为已在跑,不重复拉起
  if (!(await isPortOpen(proc.port))) startProc(proc);
}

async function main() {
  console.log(`[daemon] 启动守护:隧道:${PROXY_PORT} + 刷新服务:${SITE_PORT}`);
  ensureGitProxy();

  await ensureStarted(tunnel);
  await ensureStarted(server);

  // 每 10s 健康检查:进程意外退出后由 exit 事件自动拉起,
  // 这里只兜底"端口被外部进程占用/被杀"的情形。
  setInterval(async () => {
    await ensureStarted(tunnel);
    await ensureStarted(server);
  }, 10_000);

  // 保持进程存活
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch((err) => {
  console.error('[daemon] 启动失败:', err);
  process.exit(1);
});
