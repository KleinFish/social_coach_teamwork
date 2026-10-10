/* 存储层契约测试：node test-storage.js
 * 同一套断言同时跑在两种后端上：
 *   1) sqlite  —— 本地文件（本地/VPS/Docker）
 *   2) upstash —— 外部 Redis REST（Render/Railway 免费容器用，应用无状态）
 * 第二个后端打的是本地 mock（实现 GET/SET/DEL/SADD/SREM/SMEMBERS/INCR/DECR 与 /pipeline），
 * 因此不需要任何真实账号或网络。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp, createStore } = require('./server.js');
const { startMockUpstash } = require('./mock-upstash.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n-- ' + t + ' --');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 本地 mock：Upstash REST 协议（见 mock-upstash.js） ---------------- */

function jar(base) {
  let cookie = '';
  return {
    async req(method, url, body, extra) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
        const m = /^sid=([^;]*)/.exec(c);
        if (m) cookie = m[1] ? 'sid=' + m[1] : '';
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      return { status: res.status, data, headers: res.headers };
    },
    get(u) { return this.req('GET', u); },
    post(u, b) { return this.req('POST', u, b); },
    put(u, b) { return this.req('PUT', u, b); },
    del(u, b) { return this.req('DELETE', u, b); },
    get cookie() { return cookie; }
  };
}

function sampleProfile(n) {
  return {
    version: 1, tendency: 'i',
    reviews: Array.from({ length: n }, (_, i) => ({
      at: new Date(Date.UTC(2026, 8, 1 + i, 3)).toISOString(),
      sceneId: 'meeting-speak', sceneName: '在会议上发言', level: 4, triggers: ['人多'],
      action: '先写三行稿', effect: 'good', next: '提前写结论', mood: ''
    })),
    strategies: [{ sceneId: 'meeting-speak', sceneName: '在会议上发言', action: '先写三行稿', at: '2026-09-01T03:00:00.000Z' }],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  };
}

async function runContract(label, makeApp) {
  console.log('\n===== 后端：' + label + ' =====');
  const app = makeApp();
  const base = await new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + app.server.address().port));
  });
  try {
    const A = jar(base);
    console.log('-- 注册与登录 --');
    ok('注册成功并下发会话', (await A.post('/api/auth/register', { username: '存储测试甲', password: 'password123' })).status === 201);
    ok('昵称重复被拒', (await jar(base).post('/api/auth/register', { username: '存储测试甲', password: 'password123' })).status === 409);
    ok('错误密码被拒', (await jar(base).post('/api/auth/login', { username: '存储测试甲', password: 'nope12345' })).status === 401);
    const login2 = await jar(base).post('/api/auth/login', { username: '存储测试甲', password: 'password123' });
    ok('正确密码可登录（第二台设备）', login2.status === 200);
    ok('登录响应含账号创建时间（两种后端字段一致）',
      typeof login2.data.user.createdAt === 'string' && login2.data.user.createdAt.length > 10,
      JSON.stringify(login2.data.user));
    ok('未登录读 /api/me → 401', (await jar(base).get('/api/me')).status === 401);

    console.log('-- 画像读写与冲突 --');
    const first = await A.put('/api/profile', { profile: sampleProfile(1), baseRevision: 0 });
    ok('首次写入 revision=1', first.status === 200 && first.data.revision === 1, JSON.stringify(first.data && first.data.revision));
    const readBack = await A.get('/api/me');
    ok('读回 1 条复盘', readBack.status === 200 && readBack.data.profile.reviews.length === 1);
    const stale = await A.put('/api/profile', { profile: sampleProfile(2), baseRevision: 0 });
    ok('过期 revision → 409 并带回服务端版本', stale.status === 409 && stale.data.revision === 1);
    const retry = await A.put('/api/profile', { profile: sampleProfile(3), baseRevision: stale.data.revision });
    ok('带新 revision 重试 → revision=2', retry.status === 200 && retry.data.revision === 2, JSON.stringify(retry.data && retry.data.revision));
    ok('非法数据被拒（null）', (await A.put('/api/profile', { profile: null, baseRevision: 2 })).status === 400);

    console.log('-- 用户隔离 --');
    const B = jar(base);
    await B.post('/api/auth/register', { username: '存储测试乙', password: 'password456' });
    ok('新用户看到空画像', (await B.get('/api/me')).data.profile === null);
    await B.put('/api/profile', { profile: sampleProfile(1), baseRevision: 0 });
    ok('甲的数据未被乙覆盖', (await A.get('/api/me')).data.profile.reviews.length === 3);
    ok('计数：2 个用户 2 份画像', (await app.store.countUsers()) === 2 && (await app.store.countProfiles()) === 2,
      (await app.store.countUsers()) + '/' + (await app.store.countProfiles()));

    console.log('-- 会话失效与改密 --');
    const session2 = jar(base);
    await session2.post('/api/auth/login', { username: '存储测试甲', password: 'password123' });
    ok('第二台设备会话有效', (await session2.get('/api/me')).status === 200);
    ok('改密成功', (await A.post('/api/auth/password', { oldPassword: 'password123', newPassword: 'newpassword456' })).status === 200);
    ok('当前会话仍然有效', (await A.get('/api/me')).status === 200);
    ok('其他设备会话被踢下线', (await session2.get('/api/me')).status === 401);
    ok('旧密码无法登录', (await jar(base).post('/api/auth/login', { username: '存储测试甲', password: 'password123' })).status === 401);
    ok('新密码可以登录', (await jar(base).post('/api/auth/login', { username: '存储测试甲', password: 'newpassword456' })).status === 200);

    console.log('-- 退出与会话过期 --');
    const out = jar(base);
    await out.post('/api/auth/login', { username: '存储测试甲', password: 'newpassword456' });
    await out.post('/api/auth/logout');
    ok('退出后会话失效', (await out.get('/api/me')).status === 401);
    const expiredId = 'expired-' + Math.random().toString(16).slice(2);
    await app.store.createSession({ id: expiredId, userId: (await app.store.findUserByName('存储测试甲')).id, createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' });
    ok('过期会话被判定为无效并被清理', (await app.store.findSession(expiredId)) === null);

    console.log('-- 删除账号与数据 --');
    ok('密码错误时拒绝删号', (await B.del('/api/account', { password: 'wrongpass' })).status === 401);
    ok('密码正确时删号成功', (await B.del('/api/account', { password: 'password456' })).status === 200);
    ok('删号后无法登录', (await jar(base).post('/api/auth/login', { username: '存储测试乙', password: 'password456' })).status === 401);
    ok('计数随之下降：1 个用户 1 份画像',
      (await app.store.countUsers()) === 1 && (await app.store.countProfiles()) === 1,
      (await app.store.countUsers()) + '/' + (await app.store.countProfiles()));
    await A.del('/api/account', { password: 'newpassword456' });
    ok('全部删除后计数为 0', (await app.store.countUsers()) === 0 && (await app.store.countProfiles()) === 0);

    section('窗口计数器（每日额度靠它，两个后端行为必须一致）');
    const c1 = await app.store.bumpCounter('budget:test:a', 60);
    const c2 = await app.store.bumpCounter('budget:test:a', 60);
    ok('首次自增为 1，之后累加', c1 === 1 && c2 === 2, c1 + ',' + c2);
    ok('不同 key 互不影响', (await app.store.bumpCounter('budget:test:b', 60)) === 1);
    ok('peekCounter 只读不增加', (await app.store.peekCounter('budget:test:a')) === 2);
    ok('未创建的 key 读作 0', (await app.store.peekCounter('budget:test:never')) === 0);
    const e1 = await app.store.bumpCounter('budget:test:exp', 1);
    await sleep(1100);
    const e2 = await app.store.bumpCounter('budget:test:exp', 1);
    ok('窗口过期后重新计数（额度按天重置）', e1 === 1 && e2 === 1, e1 + ',' + e2);

    return app;
  } finally { /* 由调用方关闭 */ }
}

function listenClose(app) {
  return new Promise((resolve) => app.server.close(() => { app.close(); resolve(); }));
}

(async function main() {
  // 1) 本地 SQLite
  const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-coach-store-sqlite-'));
  const appSqlite = await runContract('sqlite（本地文件）', () => createApp({ dataDir: sqliteDir }));
  ok('SQLite 后端确实落到文件', fs.existsSync(path.join(sqliteDir, 'social-coach.db')));
  await listenClose(appSqlite);
  fs.rmSync(sqliteDir, { recursive: true, force: true });

  // 2) 外部 Redis（打本地 mock）
  const mock = await startMockUpstash('test-token');
  const appRedis = await runContract('upstash（外部 Redis REST，mock 上游）', () => createApp({
    store: createStore({ kind: 'upstash', redisUrl: mock.url, redisToken: 'test-token' })
  }));
  ok('确实通过 REST 访问了外部存储', mock.stats().commands > 50, JSON.stringify(mock.stats()));
  ok('健康检查标注了存储类型', (await (await fetch('http://127.0.0.1:' + appRedis.server.address().port + '/api/health')).json()).storage === 'upstash');
  await listenClose(appRedis);

  // 3) 认证失败时要报错，而不是静默降级
  const bad = await fetch(mock.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(['GET', 'x']) });
  ok('mock 会校验 Bearer Token（便于验证密钥配置错误）', bad.status === 401, String(bad.status));
  mock.server.close();

  console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试自身异常：', e); process.exit(1); });
