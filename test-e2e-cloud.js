/* 前端 ↔ 服务端 集成测试：node test-e2e-cloud.js
 * 真实服务端（同进程）+ 最小 DOM 垫片 + 真实 app.js，
 * 验证"两台设备交替使用同一账号"的完整链路：注册 → 自动同步 → 换设备登录取回 → 双向合并 → 退出 → 删号。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createSandbox } = require('./dom-shim.js');
const { createApp, createStore } = require('./server.js');
const { startMockUpstash } = require('./mock-upstash.js');
const Assess = require('./assessment.js');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const engineSrc = fs.readFileSync(path.join(dir, 'coach-engine.js'), 'utf8');
const assessSrc = fs.readFileSync(path.join(dir, 'assessment.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n== ' + t + ' ==');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, step) {
  const t0 = Date.now();
  const limit = ms || 3000;
  while (Date.now() - t0 < limit) {
    if (await fn()) return true;
    await sleep(step || 25);
  }
  return false;
}

/* 带 Cookie 的 fetch 包装：把 app.js 的相对路径转到真实服务端 */
function makeBrowserFetch(base) {
  let cookie = '';
  return function browserFetch(url, init) {
    const target = String(url).startsWith('http') ? String(url) : base + url;
    const headers = Object.assign({}, (init && init.headers) || {});
    if (cookie) headers.Cookie = cookie;
    return fetch(target, Object.assign({}, init, { headers })).then((res) => {
      (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
        const m = /^sid=([^;]*)/.exec(c);
        if (m) cookie = m[1] ? 'sid=' + m[1] : '';
      });
      return res;
    });
  };
}

/** 造一台"设备"：独立 localStorage、独立 Cookie，共用同一个服务端 */
function makeDevice(base, label) {
  const box = createSandbox({ html, fetch: makeBrowserFetch(base), location: { protocol: 'https:' } });
  const ctx = vm.createContext(box.sandbox);
  vm.runInContext(engineSrc, ctx, { filename: 'coach-engine.js' });
  vm.runInContext(assessSrc, ctx, { filename: 'assessment.js' });
  box.sandbox.CoachEngine = box.sandbox.window.CoachEngine;
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
  box.label = label;
  box.$ = (id) => box.byId[id];
  box.profile = () => JSON.parse(box.storage.get('social-coach.profile.v1') || 'null');
  return box;
}

/** 在指定设备上把 40 题答完（whenWeak 决定的维度给低分，制造可预测的画像） */
function takeQuiz(device, weakDims) {
  device.$('testStart').click();
  const pages = Math.ceil(Assess.ITEMS.length / 8);
  for (let page = 0; page < pages; page++) {
    const items = device.$('testQuestions').querySelectorAll('.q-item');
    items.forEach((node, idx) => {
      const meta = Assess.ITEMS[page * 8 + idx];
      const level = weakDims.includes(meta.dim) ? 2 : 5;
      const wantRaw = meta.reverse ? (6 - level) : level;
      node.querySelectorAll('.q-opt')[wantRaw - 1].click();
    });
    device.$('testNext').click();
  }
}

(async function run() {
  /* 默认用本地 SQLite；加 --redis 参数则改用"外部 Redis + 本地 mock 上游"，
     也就是 Render/Railway 免费部署时真实使用的存储方式。 */
  const USE_REDIS = process.argv.includes('--redis');
  let mock = null;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-coach-e2e-'));
  let app;
  if (USE_REDIS) {
    mock = await startMockUpstash('e2e-token');
    app = createApp({ store: createStore({ kind: 'upstash', redisUrl: mock.url, redisToken: 'e2e-token' }) });
  } else {
    app = createApp({ dataDir });
  }
  const base = await new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + app.server.address().port));
  });
  console.log('存储后端：' + app.storageKind() + (USE_REDIS ? '（外部 Redis，mock 上游）' : '（本地文件）'));

  section('设备 A：首次打开（未登录）');
  const A = makeDevice(base, 'A');
  ok('云端面板初始为"仅本机"', /仅本机/.test(A.$('cloudPill').textContent), A.$('cloudPill').textContent);
  ok('登录/注册表单可见', !A.$('cloudForm').classList.contains('hidden'));
  ok('登录区块保持隐藏', A.$('cloudSignedIn').classList.contains('hidden'));
  ok('健康检查后大模型标签更新（未配置 → 本地引擎）',
    await until(() => /未配置/.test(A.$('llmPill').textContent)), A.$('llmPill').textContent);

  section('离线也能用：先攒一条本机复盘，再注册');
  A.$('suggest').childNodes[0].click();
  ok('未登录时用本地规则引擎回答', A.$('chat').childNodes.length >= 3);
  A.$('rvScene').value = 'meeting-speak';
  A.$('rvLevel').value = 5;
  A.$('rvLevel').dispatchEvent({ type: 'input' });
  A.$('rvAction').value = '先写三行稿再发言';
  A.$('rvNext').value = '提前一天写结论句';
  A.$('rvEffect').childNodes[0].click();   // 第 1 个是"有效"
  A.$('reviewForm').dispatchEvent({ type: 'submit' });
  ok('本机已有 1 条复盘', (A.profile() || {}).reviews && A.profile().reviews.length === 1);
  ok('标记"有效"的做法进入本机策略库', A.profile().strategies.length === 1);

  section('设备 A：注册账号（应把本机数据带上去）');
  A.$('cloudUser').value = '集成测试同学';
  A.$('cloudPass').value = 'password123';
  A.$('cloudRegister').click();
  ok('界面切换为已登录', await until(() => /已登录/.test(A.$('cloudPill').textContent)), A.$('cloudPill').textContent);
  ok('登录后显示账号名', /集成测试同学/.test(A.$('cloudWho').textContent), A.$('cloudWho').textContent);
  ok('注册后本机数据仍在', (A.profile() || {}).reviews.length === 1);
  // 直接通过存储接口核对服务端真实落库内容（对 sqlite 与外部 Redis 两种后端都成立）
  async function serverProfile() {
    const u = await app.store.findUserByName('集成测试同学');
    if (!u) return null;
    const p = await app.store.getProfile(u.id);
    return p ? JSON.parse(p.doc) : null;
  }
  ok('服务器已收到该用户的画像', await until(async () => {
    const p = await serverProfile();
    return p && p.reviews.length === 1;
  }));
  ok('服务器上的记录内容正确', (await serverProfile()).reviews[0].action === '先写三行稿再发言', JSON.stringify((await serverProfile()).reviews[0]));

  section('设备 B：换一台设备登录同一账号');
  const B = makeDevice(base, 'B');
  B.$('cloudUser').value = '集成测试同学';
  B.$('cloudPass').value = 'password123';
  B.$('cloudForm').dispatchEvent({ type: 'submit' });
  ok('设备 B 登录成功', await until(() => /已登录/.test(B.$('cloudPill').textContent)), B.$('cloudPill').textContent);
  ok('设备 B 取回了设备 A 的记录', await until(() => (B.profile() || {}).reviews && B.profile().reviews.length === 1), JSON.stringify(B.profile()));
  ok('设备 B 的策略库同步到位', (B.profile() || {}).strategies.length === 1);

  section('设备 B 新增一条复盘并同步');
  B.$('rvScene').value = 'party-strangers';
  B.$('rvLevel').value = 2;
  B.$('rvLevel').dispatchEvent({ type: 'input' });
  B.$('rvAction').value = '问了对方周末安排';
  B.$('rvNext').value = '多准备两个开放问题';
  B.$('rvEffect').childNodes[0].click();   // 第 1 个是"有效"
  B.$('reviewForm').dispatchEvent({ type: 'submit' });
  ok('设备 B 本机有 2 条', B.profile().reviews.length === 2);
  ok('自动同步把 2 条推上服务器', await until(async () => ((await serverProfile()) || { reviews: [] }).reviews.length === 2), String(((await serverProfile()) || { reviews: [] }).reviews.length));

  section('设备 A 再次同步：双向合并且不互相覆盖');
  A.$('cloudSyncBtn').click();
  ok('设备 A 合并到 2 条（不是覆盖）', await until(() => A.profile().reviews.length === 2), String(A.profile().reviews.length));
  const serverAfter = await serverProfile();
  ok('服务器条数未因同步而减少', serverAfter.reviews.length === 2, String(serverAfter.reviews.length));
  ok('两条记录都保留（时间升序）',
    serverAfter.reviews[0].sceneId === 'meeting-speak' && serverAfter.reviews[1].sceneId === 'party-strangers',
    JSON.stringify(serverAfter.reviews.map((r) => r.sceneId)));
  ok('策略库由合并后的复盘重建，无重复',
    serverAfter.strategies.length === 2, JSON.stringify(serverAfter.strategies));

  section('画像设置也会同步');
  B.$('tendencyChips').childNodes[0].click();
  ok('服务器收到 tendency=i', await until(async () => ((await serverProfile()) || {}).tendency === 'i'), String(((await serverProfile()) || {}).tendency));

  section('社交画像测试：结果随账号同步到另一台设备');
  takeQuiz(A, ['publicspeaking', 'improvising']);
  const aAssess = A.profile().assessment;
  ok('设备 A 完成 40 题并写入画像', !!aAssess && !!aAssess.dimensions, JSON.stringify(aAssess && aAssess.readiness));
  ok('弱项维度得分明显更低', aAssess.dimensions.publicspeaking < aAssess.dimensions.group,
    aAssess.dimensions.publicspeaking + ' vs ' + aAssess.dimensions.group);
  ok('结果页给出了场景预测', /场景预测/.test(A.$('testResult').textContent));
  ok('自动同步把画像推上服务器', await until(async () => !!((await serverProfile()) || {}).assessment),
    JSON.stringify(((await serverProfile()) || {}).assessment));
  B.$('cloudSyncBtn').click();
  ok('设备 B 同步后拿到同一份画像', await until(() => {
    const p = B.profile();
    return p && p.assessment && typeof p.assessment.readiness === 'number';
  }), JSON.stringify(B.profile() && B.profile().assessment));
  ok('设备 B 的档案页显示已测试', /已测试/.test(B.$('assessTag').textContent), B.$('assessTag').textContent);
  ok('设备 B 的场景预测与 A 一致',
    JSON.stringify(Assess.predictScenes(B.profile().assessment.dimensions, require('./coach-engine.js').SCENES).map((p) => [p.id, p.difficulty])) ===
    JSON.stringify(Assess.predictScenes(aAssess.dimensions, require('./coach-engine.js').SCENES).map((p) => [p.id, p.difficulty])));

  section('设备 B 退出登录：本机数据保留、账号解绑');
  B.$('cloudLogout').click();
  ok('界面回到"仅本机"', await until(() => /仅本机/.test(B.$('cloudPill').textContent)));
  ok('退出后本机复盘仍在', B.profile().reviews.length === 2);
  ok('退出后仍可离线对话', (function () {
    const n = B.$('chat').childNodes.length;
    B.$('suggest').childNodes[1].click();
    return B.$('chat').childNodes.length === n + 2;
  })());

  section('未登录设备看不到任何人的数据');
  const C = makeDevice(base, 'C');
  await sleep(120);
  ok('设备 C 无任何记录', !C.profile() || C.profile() === null);
  const anon = await fetch(base + '/api/me');
  ok('匿名请求 /api/me 返回 401', anon.status === 401);

  section('删除账号与云端数据');
  A.$('cloudPass').value = 'password123';
  A.$('cloudDelete').click();
  ok('界面回到"仅本机"', await until(() => /仅本机/.test(A.$('cloudPill').textContent)));
  ok('服务器上的画像已删除', await until(async () => (await app.store.countProfiles()) === 0));
  ok('服务器上的用户已删除', (await app.store.countUsers()) === 0);
  ok('设备 A 本机数据仍在', A.profile().reviews.length === 2);
  const relogin = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '集成测试同学', password: 'password123' })
  });
  ok('删号后无法再登录', relogin.status === 401, String(relogin.status));

  section('全程文案不变量');
  const allText = (function walk(node, acc) {
    acc.push(node.textContent || '');
    node.childNodes.forEach((c) => walk(c, acc));
    return acc;
  })(A.root, []).join('\n');
  ok('设备 A 文案不含"你应该"', allText.indexOf('你应该') === -1);
  ok('设备 A 文案无 undefined / NaN', !/undefined|NaN/.test(allText));

  app.server.close(() => app.close());
  if (mock) mock.server.close();
  await sleep(120);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试自身异常：', e); process.exit(1); });
