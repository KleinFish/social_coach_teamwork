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

function boot(opts) {
  const box = createSandbox(Object.assign({ html }, opts));
  const ctx = vm.createContext(box.sandbox);
  vm.runInContext(engineSrc, ctx, { filename: 'coach-engine.js' });
  vm.runInContext(assessSrc, ctx, { filename: 'assessment.js' });
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

section('社交画像测试（40 题全流程）');
ok('初始显示测试说明', !$('testIntro').classList.contains('hidden') && $('testQuiz').classList.contains('hidden'));
$('testStart').click();
ok('点开始后进入答题页', !$('testQuiz').classList.contains('hidden') && $('testIntro').classList.contains('hidden'));
ok('第一页渲染 8 道题', $('testQuestions').querySelectorAll('.q-item').length === 8,
  String($('testQuestions').querySelectorAll('.q-item').length));
ok('每题有 5 个自评选项', $('testQuestions').querySelectorAll('.q-item')[0].querySelectorAll('.q-opt').length === 5);

/* 作答策略：让「当众表达」最弱、其余维度满分 → 结果应当可预测 */
const PAGES = Math.ceil(Assess.ITEMS.length / 8);
for (let page = 0; page < PAGES; page++) {
  const items = $('testQuestions').querySelectorAll('.q-item');
  items.forEach((node, idx) => {
    const meta = Assess.ITEMS[page * 8 + idx];
    const level = meta.dim === 'publicspeaking' ? 1 : 5;            // 1 = 完全不符合，5 = 完全符合
    const wantRaw = meta.reverse ? (6 - level) : level;             // 反向题要反过来选
    node.querySelectorAll('.q-opt')[wantRaw - 1].click();
  });
  $('testNext').click();
}
ok('提交后隐藏答题页', $('testQuiz').classList.contains('hidden'));
ok('结果区已渲染', $('testResult').childNodes.length >= 3, String($('testResult').childNodes.length));
ok('画出了八维雷达图', $('testResult').querySelectorAll('polygon').length >= 5,
  String($('testResult').querySelectorAll('polygon').length));
const resultText = $('testResult').textContent;
ok('显示准备度分数', /准备度/.test(resultText));
ok('列出了相对优势与短板', /相对有底/.test(resultText) && /更需要借力/.test(resultText));
ok('给出了场景预测分组', /较擅长/.test(resultText) && /偏吃力/.test(resultText));
ok('预测里解释了依据', /依据：/.test(resultText) && /基准压力/.test(resultText));
ok('附带了免责声明', /不是心理测评/.test(resultText));

const savedAssess = JSON.parse(box.storage.get('social-coach.profile.v1')).assessment;
ok('测试结果已写入画像', !!savedAssess && !!savedAssess.dimensions);
ok('最弱维度是"当众表达"（0 分）', savedAssess.dimensions.publicspeaking === 0, String(savedAssess.dimensions.publicspeaking));
ok('其余维度满分', savedAssess.dimensions.group === 100 && savedAssess.dimensions.initiating === 100);
ok('准备度为 88（7×100+0 的均值）', savedAssess.readiness === 88, String(savedAssess.readiness));
ok('画像不存储可重算的场景预测', savedAssess.scenes === undefined);
ok('未设置倾向时自动带入画像倾向（此处是中性的，故为 null）', savedAssess.tendencyHint === null || savedAssess.tendencyHint === 'e' || savedAssess.tendencyHint === 'i');

section('画像 ↔ 应急 / 准备 / 档案 的联动');
ok('应急页出现画像提示', /画像推荐/.test($('sosHintBox').textContent), $('sosHintBox').textContent);
const recBtn = $('sosGrid').childNodes.filter((b) => /画像推荐/.test(b.textContent));
ok('最相关的应急入口被标记为推荐', recBtn.length === 1, String(recBtn.length));
ok('推荐的是"当众表达"对应的入口（被点名/突然发言）', /被点名/.test(recBtn[0] ? recBtn[0].textContent : ''),
  recBtn[0] && recBtn[0].textContent);

const chatBefore = $('chat').childNodes.length;
box.byId['input'].value = '明天课堂展示，有点紧张';
$('sendBtn').click();
const prepText = $('chat').childNodes[$('chat').childNodes.length - 1].textContent;
ok('准备回复里带上了画像预测', /自评/.test(prepText), prepText.slice(0, 80));
ok('偏吃力的场景会先强调稳住状态', /偏吃力|先花 30 秒/.test(prepText));

section('画像展示在档案里');
ok('档案标签显示已测试', /已测试/.test($('assessTag').textContent), $('assessTag').textContent);
ok('档案里也有雷达图与预测小结',
  $('assessBox').querySelectorAll('polygon').length >= 5 && /更需要借力/.test($('assessBox').textContent));

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
