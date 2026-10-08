/* mock-upstash.js —— 本地假的上游 Redis（Upstash REST 协议），仅供测试
 * 支持命令：GET / SET / DEL / SADD / SREM / SMEMBERS / INCR / DECR，以及 /pipeline 批量。
 * 让"外部存储"这条通路可以在完全离线、无需账号的情况下被测到。
 */
'use strict';
const http = require('node:http');

function startMockUpstash(token) {
  const kv = new Map();
  const sets = new Map();
  let commands = 0;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (obj, code) => {
        res.writeHead(code || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (token && (req.headers.authorization || '') !== 'Bearer ' + token) return send({ error: 'UNAUTHORIZED' }, 401);
      let body;
      try { body = JSON.parse(raw || '[]'); } catch (e) { return send({ error: 'BAD_JSON' }, 400); }

      const exec = (args) => {
        commands += 1;
        const cmd = String((args && args[0]) || '').toUpperCase();
        const k = args && args[1];
        switch (cmd) {
          case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
          case 'SET': kv.set(k, String(args[2])); sets.delete(k); return { result: 'OK' };
          case 'DEL': { const had = kv.delete(k) | sets.delete(k); return { result: had ? 1 : 0 }; }
          case 'SADD': {
            if (!sets.has(k)) sets.set(k, new Set());
            const before = sets.get(k).size;
            sets.get(k).add(String(args[2]));
            return { result: sets.get(k).size - before };
          }
          case 'SREM': { const s = sets.get(k); return { result: s && s.delete(String(args[2])) ? 1 : 0 }; }
          case 'SMEMBERS': return { result: sets.has(k) ? [...sets.get(k)] : [] };
          case 'INCR': { const n = (parseInt(kv.get(k) || '0', 10) || 0) + 1; kv.set(k, String(n)); return { result: n }; }
          case 'DECR': { const n = (parseInt(kv.get(k) || '0', 10) || 0) - 1; kv.set(k, String(n)); return { result: n }; }
          default: return { error: 'UNKNOWN_COMMAND' };
        }
      };

      const urlPath = req.url.split('?')[0];
      if (urlPath === '/pipeline') {
        if (!Array.isArray(body)) return send({ error: 'BAD_PIPELINE' }, 400);
        return send(body.map(exec));
      }
      if (!Array.isArray(body)) return send({ error: 'BAD_COMMAND' }, 400);
      return send(exec(body));
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    url: 'http://127.0.0.1:' + server.address().port,
    stats: () => ({ keys: kv.size, sets: sets.size, commands }),
    close: () => server.close()
  })));
}

module.exports = { startMockUpstash };
