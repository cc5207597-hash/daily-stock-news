// 本地 TCP CONNECT 隧道：把 github.com:443 转发到可达 IP。
// 绕过被墙的 DNS 解析（github.com 经 DNS 拿到的 20.205.243.166 常不可达）。
// git 配置 http.proxy=127.0.0.1:37777 后走此隧道推送。
// 按顺序尝试候选 IP：GitHub 的 IP 会轮换，已失效的会被后面的顶上。
import net from 'net';

const LISTEN_PORT = 37777;
const CANDIDATES = [
  '140.82.112.3',
  '140.82.114.3',
  '140.82.116.3',
  '140.82.121.3',
  '140.82.112.4',
  '140.82.113.3',
  '20.27.177.113',
  '20.27.177.114',
  '20.205.243.168',
];

let healthyIdx = 0;

// 逐个尝试候选 IP，直到有一个成功。GitHub IP 轮换频繁，单个 IP 可能瞬时
// 失效，因此每次 CONNECT 都按 healthyIdx 起步、顺序尝试整个列表。
function connectUp(startIdx = healthyIdx) {
  return new Promise((resolve, reject) => {
    let i = startIdx;
    const attempts = [];
    const tryNext = () => {
      if (i >= CANDIDATES.length) {
        reject(new Error(`all candidates failed: ${attempts.join(', ')}`));
        return;
      }
      const ip = CANDIDATES[i];
      const sock = net.connect({ host: ip, port: 443, timeout: 5000 });
      const fail = (e) => {
        attempts.push(`${ip}:${e.message}`);
        sock.destroy();
        i++;
        tryNext();
      };
      sock.on('connect', () => {
        sock.removeAllListeners('timeout');
        healthyIdx = i;
        resolve(sock);
      });
      sock.on('timeout', () => fail(new Error('timeout')));
      sock.on('error', (e) => fail(e));
    };
    tryNext();
  });
}

// 后台探测：找出第一个可达的 IP，作为初始 healthIdx。
(async function probe() {
  for (let i = 0; i < CANDIDATES.length; i++) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect({ host: CANDIDATES[i], port: 443, timeout: 2500 });
        s.on('connect', () => { s.destroy(); resolve(); });
        s.on('timeout', () => { s.destroy(); reject(); });
        s.on('error', () => { reject(); });
      });
      healthyIdx = i;
      console.log(`[tunnel] probe: healthy=${CANDIDATES[i]}`);
      return;
    } catch { /* 下一个 */ }
  }
  console.log('[tunnel] probe: no candidate reachable');
})();

const server = net.createServer((client) => {
  client.once('data', (chunk) => {
    const head = chunk.toString('latin1');
    if (/^CONNECT\s+([^\s:]+)(?::(\d+))?\s+HTTP\/1\.[01]/i.test(head)) {
      connectUp().then((up) => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.pipe(client);
        client.pipe(up);
      }).catch((e) => {
        console.error(`[tunnel] upstream error: ${e.message}`);
        client.destroy();
      });
      client.on('error', () => {});
      client.resume();
    } else {
      client.destroy();
    }
  });
  client.on('error', () => {});
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[tunnel] listening on 127.0.0.1:${LISTEN_PORT}`);
});
