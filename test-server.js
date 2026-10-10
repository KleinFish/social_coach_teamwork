/* 服务端端到端测试：node test-server.js
 * 直接 require('./server.js') 在**同一进程**内起服务（不 spawn 子进程），用 fetch 打真实 HTTP。
 * 覆盖：静态托管 / 安全响应头 / 注册登录 / 会话 Cookie / 多用户隔离 /
 *      乐观并发冲突 / CSRF / 限流 / 改密 / 删号 / 重启持久化 / 大模型代理（用本地 mock 上游）
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('./server.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n== ' + t + ' ==');

let base = '';
function startServer(a) {
  return new Promise((resolve) => {
    a.server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + a.server.address().port; resolve(a.server.address().port); });
  });
}
function stopServer(a) {
  return new Promise((resolve) => { a.server.close(() => { a.close(); resolve(); }); });
}
function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'social-coach-' + tag + '-')); }

/* 用原始 path 发请求，绕过 fetch 的 URL 规范化，才能测出真正的路径穿越 */
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, method: 'GET', path: rawPath }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

function jar() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async req(method, url, body, headers) {
      const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
      if (cookie) h.Cookie = cookie;
      const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
        const m = /^sid=([^;]*)/.exec(c);
        if (m) cookie = m[1] ? 'sid=' + m[1] : '';
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      return { status: res.status, data, headers: res.headers };
    },
    post(u, b, h) { return this.req('POST', u, b, h); },
    put(u, b, h) { return this.req('PUT', u, b, h); },
    del(u, b, h) { return this.req('DELETE', u, b, h); },
    get(u, h) { return this.req('GET', u, undefined, h); }
  };
}

function profile(n, level, effect) {
  const reviews = [];
  for (let i = 0; i < n; i++) {
    reviews.push({
      at: new Date(Date.UTC(2026, 8, 1 + i, 3)).toISOString(),
      sceneId: 'meeting-speak', sceneName: '在会议上发言', level: level || 4,
      triggers: ['人多'], action: '先写三行稿', effect: effect || 'good', next: '提前一天写结论', mood: ''
    });
  }
  return {
    version: 1, tendency: 'i', reviews,
    strategies: reviews.filter(r => r.effect === 'good').map(r => ({ sceneId: r.sceneId, sceneName: r.sceneName, action: r.action, at: r.at })),
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  };
}

/* 本地 mock 大模型上游：不需要任何真实 API Key */
function startMock(mode) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (mode === 'http500') { res.writeHead(500); res.end('boom'); return; }
      const blocks = [{ type: 'empathy', text: 'mock 共情' }, { type: 'script', title: '可以直接念的话', groups: [{ label: '开场', items: ['你好，我是 mock。'] }] }];
      const content = mode === 'ok' ? JSON.stringify({ blocks }) : mode === 'fenced' ? '```json\n' + JSON.stringify({ blocks }) + '\n```' : '这不是 JSON';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions' })));
}

(async function run() {
  const dataDir = tempDir('main');
  let app = createApp({ dataDir });
  await startServer(app);
  const mainBase = base;   // 子实例会改写 base，finally 里必须还原

  section('静态托管与安全响应头');
  const r = await fetch(base + '/');
  const html = await r.text();
  ok('首页 200 且是应用页面', r.status === 200 && /社交教练/.test(html), String(r.status));
  ok('CSP 限制脚本来源为 self', /script-src 'self'/.test(r.headers.get('content-security-policy') || ''));
  ok('带 X-Content-Type-Options / X-Frame-Options',
    r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY');
  const js = await fetch(base + '/app.js');
  ok('app.js 以 JavaScript 类型返回', js.status === 200 && /javascript/.test(js.headers.get('content-type') || ''));
  const etag = js.headers.get('etag');
  const cached = await fetch(base + '/app.js', { headers: { 'If-None-Match': etag } });
  ok('支持 ETag 协商缓存（304）', cached.status === 304, String(cached.status));
  ok('阻止路径穿越', [403, 404].includes(await rawGet('/../server.js')));
  ok('阻止编码路径穿越（%2f 到系统目录）', [403, 404].includes(await rawGet('/..%2f..%2fWindows%2fwin.ini')));
  ok('服务端源码不可下载', (await fetch(base + '/server.js')).status === 404);
  ok('测试脚本不可下载', (await fetch(base + '/test-server.js')).status === 404);
  ok('数据库文件不可下载', (await fetch(base + '/data/social-coach.db')).status === 404);
  ok('未知接口返回 JSON 404', (await fetch(base + '/api/nope')).status === 404);

  /* 回归用例：index.html 里引用的每个脚本都必须真的能被访问到，
     否则线上会出现"页面能开、某个标签页报错"的隐蔽故障。 */
  const htmlText = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scriptSrcs = [...htmlText.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ok('首页确实引用了若干脚本', scriptSrcs.length >= 3, scriptSrcs.join(','));
  for (const src of scriptSrcs) {
    const res = await fetch(base + '/' + src.replace(/^\//, ''));
    ok(`脚本 ${src} 可被访问且类型正确`, res.status === 200 && /javascript/.test(res.headers.get('content-type') || ''),
      res.status + ' ' + res.headers.get('content-type'));
  }
  const styleRes = await fetch(base + '/styles.css');
  ok('样式表可被访问', styleRes.status === 200 && /css/.test(styleRes.headers.get('content-type') || ''));

  section('健康检查');
  const health = await (await fetch(base + '/api/health')).json();
  ok('health 正常，未配置大模型时 llm=false', health.ok === true && health.llm === false, JSON.stringify(health));

  section('注册与登录');
  const A = jar();
  ok('密码过短被拒', (await A.post('/api/auth/register', { username: '小舟', password: '123' })).status === 400);
  ok('昵称非法被拒', (await A.post('/api/auth/register', { username: 'bad name!', password: 'password123' })).status === 400);
  const reg = await A.post('/api/auth/register', { username: '小舟', password: 'password123' });
  ok('注册成功 201 并下发会话', reg.status === 201 && A.cookie.startsWith('sid='), String(reg.status));
  const setCookies = reg.headers.getSetCookie().join('; ');
  ok('会话 Cookie 具备 HttpOnly + SameSite=Lax + Path=/',
    /HttpOnly/i.test(setCookies) && /SameSite=Lax/i.test(setCookies) && /Path=\//.test(setCookies));
  ok('未启用 HTTPS 时不加 Secure（本地开发可用）', !/Secure/i.test(setCookies));
  ok('重复昵称被拒（大小写不敏感）', (await new jar().post('/api/auth/register', { username: '小舟', password: 'password123' })).status === 409);
  ok('未登录访问 /api/me → 401', (await new jar().get('/api/me')).status === 401);
  ok('错误密码登录 → 401', (await new jar().post('/api/auth/login', { username: '小舟', password: 'wrongpass' })).status === 401);
  const loginB = await A.post('/api/auth/login', { username: '小舟', password: 'password123' });
  ok('正确密码登录成功且新账号无数据', loginB.status === 200 && loginB.data.profile === null && loginB.data.revision === 0);

  section('画像云同步（基于 revision 的乐观并发）');
  const first = await A.put('/api/profile', { profile: profile(2), baseRevision: 0 });
  ok('首次保存成功，revision=1', first.status === 200 && first.data.revision === 1, JSON.stringify(first.data && first.data.revision));
  const readBack = await A.get('/api/me');
  ok('读回自己的 2 条复盘', readBack.status === 200 && readBack.data.profile.reviews.length === 2);
  const stale = await A.put('/api/profile', { profile: profile(3), baseRevision: 0 });
  ok('过期 baseRevision → 409 并返回服务器版本', stale.status === 409 && stale.data.conflict === true && stale.data.revision === 1);
  const retry = await A.put('/api/profile', { profile: profile(5), baseRevision: stale.data.revision });
  ok('带新 revision 重试成功，revision=2', retry.status === 200 && retry.data.revision === 2);
  ok('空 profile 被拒 400（服务端不信任客户端结构）', (await A.put('/api/profile', { profile: null, baseRevision: 2 })).status === 400);
  const tooBig = await A.put('/api/profile', { profile: { reviews: Array.from({ length: 3 }, () => ({ action: 'x'.repeat(400000) })) }, baseRevision: 2 });
  ok('超过 1MB 的画像被拒', tooBig.status === 400, String(tooBig.status));
  ok('未登录不能写画像', (await new jar().put('/api/profile', { profile: profile(1) })).status === 401);
  const Norm = jar();
  await Norm.post('/api/auth/register', { username: '结构测试', password: 'password789' });
  const norm = await Norm.put('/api/profile', { profile: { reviews: 'nope', extra: 1, tendency: '攻击者' }, baseRevision: 0 });
  ok('不规范结构被规范化（reviews→[]、tendency→null、丢弃未知字段）',
    norm.status === 200 && Array.isArray(norm.data.profile.reviews) && norm.data.profile.reviews.length === 0 && norm.data.profile.tendency === null && norm.data.profile.extra === undefined);
  await Norm.del('/api/account', { password: 'password789' });

  section('多用户数据隔离');
  const C = jar();
  await C.post('/api/auth/register', { username: '另一个同学', password: 'password456' });
  const cMe = await C.get('/api/me');
  ok('新用户看不到别人的数据', cMe.status === 200 && cMe.data.profile === null, JSON.stringify(cMe.data.profile));
  await C.put('/api/profile', { profile: profile(1, 2), baseRevision: 0 });
  ok('A 的数据未被 C 覆盖', (await A.get('/api/me')).data.profile.reviews.length === 5);
  ok('C 只看到自己的 1 条', (await C.get('/api/me')).data.profile.reviews.length === 1);
  ok('两个用户的存储行互相独立', (await app.store.countProfiles()) === 2);

  section('跨站防护');
  ok('跨站 Origin 的写请求被拒 403',
    (await A.post('/api/profile', { profile: profile(1) }, { Origin: 'https://evil.example' })).status === 403);
  ok('同源 Origin 正常放行',
    (await A.put('/api/profile', { profile: profile(5), baseRevision: 2 }, { Origin: base })).status === 200);

  section('大模型代理（本地 mock 上游，无需真实 Key）');
  ok('未登录调用 → 401', (await new jar().post('/api/coach', { text: '面试' })).status === 401);
  const noCfg = await A.post('/api/coach', { text: '明天面试' });
  ok('未配置大模型 → 503 + llm_not_configured（前端据此回退本地引擎）',
    noCfg.status === 503 && noCfg.data.code === 'llm_not_configured', String(noCfg.status));

  const okMock = await startMock('ok');
  const appLLM = createApp({ dataDir: tempDir('llm'), llm: { endpoint: okMock.url, model: 'mock-model', key: 'test-key' } });
  await startServer(appLLM);
  try {
    const F = jar();
    await F.post('/api/auth/register', { username: '云端同学', password: 'password321' });
    const good = await F.post('/api/coach', { text: '明天面试，有点紧张' });
    ok('配置后走大模型并返回块结构', good.status === 200 && good.data.source === 'llm' && good.data.blocks.length === 2, JSON.stringify(good.data));
    const crisis = await F.post('/api/coach', { text: '我觉得活着没意思' });
    ok('危机内容在服务端就被安全兜底拦截（不发给大模型）',
      crisis.status === 200 && crisis.data.source === 'safety' && crisis.data.blocks[0].type === 'safety');
    ok('服务器不会把 API Key 下发给浏览器', !/test-key/.test(JSON.stringify(good.data)));
  } finally { await stopServer(appLLM); okMock.server.close(); base = mainBase; }

  const fencedMock = await startMock('fenced');
  const appFenced = createApp({ dataDir: tempDir('llm2'), llm: { endpoint: fencedMock.url, model: 'm', key: 'k' } });
  await startServer(appFenced);
  try {
    const G = jar();
    await G.post('/api/auth/register', { username: '围栏同学', password: 'password654' });
    const fenced = await G.post('/api/coach', { text: '聚餐' });
    ok('上游带 ```json 代码块标记时也能解析', fenced.status === 200 && fenced.data.source === 'llm', String(fenced.status));
  } finally { await stopServer(appFenced); fencedMock.server.close(); base = mainBase; }

  const badMock = await startMock('notjson');
  const appBad = createApp({ dataDir: tempDir('llm3'), llm: { endpoint: badMock.url, model: 'm', key: 'k' } });
  await startServer(appBad);
  try {
    const H = jar();
    await H.post('/api/auth/register', { username: '坏上游同学', password: 'password987' });
    const bad = await H.post('/api/coach', { text: '聚餐' });
    ok('上游返回非 JSON → 502 + llm_failed（前端回退本地引擎）',
      bad.status === 502 && bad.data.code === 'llm_failed', String(bad.status));
  } finally { await stopServer(appBad); badMock.server.close(); base = mainBase; }

  const deadMock = await startMock('http500');
  const appDead = createApp({ dataDir: tempDir('llm4'), llm: { endpoint: deadMock.url, model: 'm', key: 'k' } });
  await startServer(appDead);
  try {
    const I = jar();
    await I.post('/api/auth/register', { username: '五百同学', password: 'password111' });
    ok('上游 500 → 502', (await I.post('/api/coach', { text: '聚餐' })).status === 502);
  } finally { await stopServer(appDead); deadMock.server.close(); base = mainBase; }

  section('语音转写代理（本地 mock 上游，音频不落盘）');
  const AUDIO = Buffer.from('fake-audio-bytes-for-test').toString('base64');
  ok('未登录调用 → 401', (await new jar().post('/api/transcribe', { audioBase64: AUDIO, mime: 'audio/webm' })).status === 401);
  const notCfg = await A.post('/api/transcribe', { audioBase64: AUDIO, mime: 'audio/webm' });
  ok('未配置 ASR → 503 + asr_not_configured',
    notCfg.status === 503 && notCfg.data.code === 'asr_not_configured', String(notCfg.status));

  // 本地假 ASR 上游（OpenAI 兼容）
  let asrCall = null;
  const asrUpstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      asrCall = { auth: req.headers.authorization, bytes: raw.length, contentType: req.headers['content-type'] || '', body: raw };
      if (/fail/.test(asrCall.auth || '')) { res.writeHead(500); res.end('boom'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: '明天课堂展示，我有点紧张' }));
    });
  });
  const asrUrl = await new Promise((r) => asrUpstream.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + asrUpstream.address().port + '/v1/audio/transcriptions')));
  const appAsr = createApp({ dataDir: tempDir('asr'), asr: { endpoint: asrUrl, model: 'whisper-1', key: 'asr-key' } });
  await startServer(appAsr);
  try {
    const J = jar();
    await J.post('/api/auth/register', { username: '语音同学', password: 'password222' });
    const healthAsr = await (await fetch(base + '/api/health')).json();
    ok('健康检查报告已配置语音转写', healthAsr.asr === true, JSON.stringify(healthAsr));
    const good = await J.post('/api/transcribe', { audioBase64: AUDIO, mime: 'audio/webm' });
    ok('转写成功并返回文本', good.status === 200 && good.data.text === '明天课堂展示，我有点紧张', JSON.stringify(good.data));
    ok('上游收到的是 multipart 与 Bearer 密钥',
      /multipart\/form-data/.test(asrCall.contentType) && asrCall.auth === 'Bearer asr-key', JSON.stringify(asrCall));
    ok('上传体不为空（音频确实转发过去了）', asrCall.bytes > 100, String(asrCall.bytes));
    const wav = await J.post('/api/transcribe', { audioBase64: AUDIO, mime: 'audio/wav' });
    ok('wav 会以 .wav 文件名转发（避免服务商按扩展名解析失败）',
      wav.status === 200 && /filename="speech\.wav"/.test(asrCall.body || ''), (asrCall.body || '').slice(0, 120));
    ok('空音频被拒 400', (await J.post('/api/transcribe', { audioBase64: '', mime: 'audio/webm' })).status === 400);
    const tooBig = await J.post('/api/transcribe', { audioBase64: 'A'.repeat(4 * 1024 * 1024 + 10), mime: 'audio/webm' });
    ok('超长录音被拒（413 或 429）', [400, 413].includes(tooBig.status), String(tooBig.status));
  } finally { await stopServer(appAsr); asrUpstream.close(); base = mainBase; }

  const badAsr = http.createServer((req, res) => { res.writeHead(500); res.end('boom'); });
  const badUrl = await new Promise((r) => badAsr.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + badAsr.address().port + '/v1/audio/transcriptions')));
  const appBadAsr = createApp({ dataDir: tempDir('asr2'), asr: { endpoint: badUrl, model: 'm', key: 'k' } });
  await startServer(appBadAsr);
  try {
    const K = jar();
    await K.post('/api/auth/register', { username: '坏语音同学', password: 'password333' });
    const bad = await K.post('/api/transcribe', { audioBase64: AUDIO, mime: 'audio/webm' });
    ok('上游失败 → 502 + transcribe_failed', bad.status === 502 && bad.data.code === 'transcribe_failed', String(bad.status));
  } finally { await stopServer(appBadAsr); badAsr.close(); base = mainBase; }

  section('限流（独立实例，避免污染其他用例）');
  const rlApp = createApp({ dataDir: tempDir('rl') });
  await startServer(rlApp);
  try {
    let limited = false;
    for (let i = 0; i < 40; i++) {
      const res = await new jar().post('/api/auth/login', { username: '查无此人', password: 'password123' });
      if (res.status === 429) { limited = true; break; }
    }
    ok('连续登录失败触发 429 限流', limited);
  } finally { await stopServer(rlApp); base = mainBase; }

  section('改密与退出');
  const pwApp = createApp({ dataDir: tempDir('pw') });
  await startServer(pwApp);
  try {
    const D = jar();
    await D.post('/api/auth/register', { username: '改密同学', password: 'oldpassword1' });
    ok('原密码错误时拒绝改密', (await D.post('/api/auth/password', { oldPassword: 'nope12345', newPassword: 'newpassword1' })).status === 401);
    ok('新密码过短被拒', (await D.post('/api/auth/password', { oldPassword: 'oldpassword1', newPassword: '123' })).status === 400);
    ok('正常改密成功', (await D.post('/api/auth/password', { oldPassword: 'oldpassword1', newPassword: 'newpassword1' })).status === 200);
    ok('旧密码无法再登录', (await new jar().post('/api/auth/login', { username: '改密同学', password: 'oldpassword1' })).status === 401);
    ok('新密码可以登录', (await new jar().post('/api/auth/login', { username: '改密同学', password: 'newpassword1' })).status === 200);
    ok('改密后当前会话仍有效', (await D.get('/api/me')).status === 200);
    await D.post('/api/auth/logout');
    ok('退出后会话失效', (await D.get('/api/me')).status === 401);
  } finally { await stopServer(pwApp); base = mainBase; }

  section('删除账号与数据');
  ok('密码不对时拒绝删号', (await C.del('/api/account', { password: 'wrongpass' })).status === 401);
  ok('密码正确时删号成功', (await C.del('/api/account', { password: 'password456' })).status === 200);
  ok('删号后无法登录', (await new jar().post('/api/auth/login', { username: '另一个同学', password: 'password456' })).status === 401);
  const usersLeft = await app.store.countUsers();
  const profilesLeft = await app.store.countProfiles();
  ok('用户行与画像行一并清除', usersLeft === 1 && profilesLeft === 1, usersLeft + '/' + profilesLeft);

  section('重启后持久化');
  const meBefore = await A.get('/api/me');
  const before = meBefore.data.profile.reviews.length;
  const revBefore = meBefore.data.revision;
  await stopServer(app);
  app = createApp({ dataDir });
  await startServer(app);
  const E = jar();
  const relogin = await E.post('/api/auth/login', { username: '小舟', password: 'password123' });
  ok('重启后账号仍可登录', relogin.status === 200);
  ok('重启后数据完整（' + before + ' 条）', relogin.data.profile.reviews.length === before, String(relogin.data.profile.reviews.length));
  ok('重启后 revision 保持（' + revBefore + '）', relogin.data.revision === revBefore, String(relogin.data.revision));

  await stopServer(app);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试自身异常：', e); process.exit(1); });
