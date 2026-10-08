/* 离线模式冒烟测试：node smoke-dom.js
 * 用最小 DOM 垫片真实执行 app.js，且让所有网络请求失败，
 * 验证"双击 index.html 直接打开"这条路径依然完整可用（本地优先、断网不降级）。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSandbox } = require('./dom-shim.js');
const Engine = require('./coach-engine.js');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const engineSrc = fs.readFileSync(path.join(dir, 'coach-engine.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n== ' + t + ' ==');

function boot(opts) {
  const box = createSandbox(Object.assign({ html }, opts));
  const ctx = vm.createContext(box.sandbox);
  vm.runInContext(engineSrc, ctx, { filename: 'coach-engine.js' });
  ctx.CoachEngine = box.sandbox.window.CoachEngine || (box.sandbox.module && box.sandbox.module.exports);
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
  return box;
}

/* ---------- 场景一：以 http 打开但完全断网（例如服务器挂了） ---------- */
console.log('【场景一】http 访问 + 全部请求失败');
const box = boot({ fetch: () => Promise.reject(new Error('network down')) });
const $ = (id) => box.byId[id];

section('初始化');
ok('首屏有欢迎消息', $('chat').childNodes.length >= 2, String($('chat').childNodes.length));
ok('场景快选渲染了 6 条', $('suggest').childNodes.length === 6);
ok('应急按钮与引擎一致', $('sosGrid').childNodes.length === Engine.EMERGENCY.length, String($('sosGrid').childNodes.length));

section('社交前准备');
const before = $('chat').childNodes.length;
$('suggest').childNodes[0].click();
ok('一次准备对话产生两条消息', $('chat').childNodes.length === before + 2);
const lastStack = $('chat').childNodes[$('chat').childNodes.length - 1].querySelector('.stack');
ok('回复包含 6 个区块', lastStack.childNodes.length >= 6, String(lastStack.childNodes.length));
ok('渲染了压力等级条', lastStack.querySelectorAll('.meter').length >= 1);
const breathBtn = lastStack.querySelectorAll('.btn').find((b) => /开始 30 秒/.test(b.textContent));
ok('有 30 秒呼吸卡片按钮', !!breathBtn);
if (breathBtn) {
  breathBtn.click();
  ok('点击后进入计时', /暂停/.test(breathBtn.textContent));
  breathBtn.click();
  ok('可暂停', /继续/.test(breathBtn.textContent));
}
ok('给出可直接念的话术', lastStack.querySelectorAll('.g-item').length >= 5);

section('社交中应急');
$('sosGrid').childNodes[3].click();
const bigSay = $('sosResult').querySelectorAll('.big-say');
ok('应急页给出可直接念的一句话', bigSay.length === 1 && bigSay[0].textContent.length > 0, bigSay[0] && bigSay[0].textContent);

section('社交后复盘');
$('rvLevel').value = 4;
$('rvLevel').dispatchEvent({ type: 'input' });
ok('焦虑徽标跟随滑块', /4\/5/.test($('rvLevelBadge').textContent));
$('rvDemo').click();
$('reviewForm').dispatchEvent({ type: 'submit' });
ok('复盘结果渲染成功', $('reviewResult').childNodes.length > 0);
const saved = JSON.parse(box.storage.get('social-coach.profile.v1'));
ok('复盘写入本机存储', saved && saved.reviews.length === 1);
ok('有效做法进入策略库', saved && saved.strategies.length === 1);

section('成长档案');
$('tendencyChips').childNodes[0].click();
ok('画像可设为偏内向并落盘', JSON.parse(box.storage.get('social-coach.profile.v1')).tendency === 'i');
ok('统计卡片 4 项', $('statGrid').childNodes.length === 4);
$('exportBtn').click();
$('clearBtn').click();
ok('一键清空后本机不再保留画像', !box.storage.has('social-coach.profile.v1'));

section('断网下的云端同步');
ok('网络不可用时不会崩溃，仍显示"仅本机"', /仅本机/.test($('cloudPill').textContent), $('cloudPill').textContent);
ok('登录表单可见（等有网时可用）', !$('cloudForm').classList.contains('hidden'));
ok('登录区块保持隐藏', $('cloudSignedIn').classList.contains('hidden'));
ok('大模型标签回落到本地引擎', /未配置|离线/.test($('llmPill').textContent), $('llmPill').textContent);

section('CSP 约束：页面内不允许内联样式属性');
ok('HTML 中不含内联 style 属性', html.indexOf('style="') === -1);

section('文案不变量');
const allText = (function walk(node, acc) {
  acc.push(node.textContent || '');
  node.childNodes.forEach((c) => walk(c, acc));
  return acc;
})(box.root, []).join('\n');
ok('渲染文案不含"你应该"', allText.indexOf('你应该') === -1);
ok('渲染文案无 undefined / NaN / [object Object]', !/undefined|NaN|\[object Object\]/.test(allText));

/* ---------- 场景二：直接双击打开本地文件（file://） ---------- */
console.log('\n【场景二】file:// 直接打开');
const fileBox = boot({ location: { protocol: 'file:' } });
ok('提示当前是本地文件模式', /本地文件模式/.test(fileBox.byId['cloudPill'].textContent), fileBox.byId['cloudPill'].textContent);
ok('本地文件模式下隐藏登录表单', fileBox.byId['cloudForm'].classList.contains('hidden'));
ok('本地文件模式仍可正常对话', (function () {
  const n = fileBox.byId['chat'].childNodes.length;
  fileBox.byId['suggest'].childNodes[0].click();
  return fileBox.byId['chat'].childNodes.length === n + 2;
})());

console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
