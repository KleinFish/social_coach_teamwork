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
const voiceSrc = fs.readFileSync(path.join(dir, 'voice.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n== ' + t + ' ==');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(opts) {
  const box = createSandbox(Object.assign({ html }, opts));
  const ctx = vm.createContext(box.sandbox);
  vm.runInContext(engineSrc, ctx, { filename: 'coach-engine.js' });
  vm.runInContext(assessSrc, ctx, { filename: 'assessment.js' });
  vm.runInContext(voiceSrc, ctx, { filename: 'voice.js' });
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

section('语音输入（注入假的浏览器识别器）');
ok('无语音能力时麦克风按钮隐藏', (function () {
  const b = boot({ fetch: () => Promise.reject(new Error('offline')) });
  return b.byId['micInput'].classList.contains('hidden') && b.byId['micAction'].classList.contains('hidden');
})());

/* 注入假 SpeechRecognition，走通"点击 → 识别 → 回填输入框"的完整链路 */
class FakeSR {
  constructor() { FakeSR.last = this; this.lang = ''; this.interimResults = false; }
  start() { this.started = true; }
  abort() { this.aborted = true; if (this.onend) this.onend(); }
  emit(list) { this.onresult({ resultIndex: 0, results: list }); }
  end() { if (this.onend) this.onend(); }
}
const vbox = createSandbox({ html, fetch: () => Promise.reject(new Error('offline')) });
vbox.sandbox.window.SpeechRecognition = FakeSR;
vbox.sandbox.SpeechRecognition = FakeSR;
const vctx = vm.createContext(vbox.sandbox);
vm.runInContext(engineSrc, vctx, { filename: 'coach-engine.js' });
vm.runInContext(assessSrc, vctx, { filename: 'assessment.js' });
vm.runInContext(voiceSrc, vctx, { filename: 'voice.js' });
vm.runInContext(appSrc, vctx, { filename: 'app.js' });
const $v = (id) => vbox.byId[id];
ok('有识别能力时麦克风按钮显示', !$v('micInput').classList.contains('hidden'));
$v('micInput').click();
ok('点击后进入录音状态（按钮高亮 + 状态条出现）',
  $v('micInput').classList.contains('rec') && !$v('voiceBar').classList.contains('hidden'));
ok('状态条提示正在聆听', /聆听/.test($v('voiceBarText').textContent), $v('voiceBarText').textContent);
ok('识别器按中文启动', FakeSR.last.lang === 'zh-CN' && FakeSR.last.started === true);
FakeSR.last.emit([{ isFinal: false, 0: { transcript: '明天课堂展示' } }]);
ok('中间结果实时回填到输入框', $v('input').value === '明天课堂展示', $v('input').value);
FakeSR.last.emit([{ isFinal: true, 0: { transcript: '明天课堂展示，有点紧张' } }]);
FakeSR.last.end();
ok('最终结果写入输入框', /明天课堂展示，有点紧张/.test($v('input').value), $v('input').value);
ok('结束后按钮与状态条复位',
  !$v('micInput').classList.contains('rec') && $v('voiceBar').classList.contains('hidden'));
$v('micInput').click();
ok('第二次点击开始新的录音', !$v('voiceBar').classList.contains('hidden'));
$v('voiceStop').click();
ok('点「停止」可以中断', $v('voiceBar').classList.contains('hidden') && FakeSR.last.aborted === true);
$v('micInput').click();
FakeSR.last.onerror({ error: 'not-allowed' });
ok('识别出错时给出提示并复位',
  $v('voiceBar').classList.contains('hidden') && !$v('micInput').classList.contains('rec'));
ok('录音字段也有麦克风按钮（复盘页两处）',
  !$v('micAction').classList.contains('hidden') && !$v('micNext').classList.contains('hidden'));

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

/* ---------- 场景四：触摸设备（点按切换，修复"按下瞬间就退出"） ---------- */
const pTouch = (async function touchDevice() {
  console.log('\n【场景四】触摸设备：点按切换');
  const tbox = createSandbox({ html, fetch: () => Promise.reject(new Error('offline')) });
  tbox.sandbox.SpeechRecognition = FakeSR;
  tbox.sandbox.window.SpeechRecognition = FakeSR;
  tbox.sandbox.PointerEvent = function PointerEvent() {};
  tbox.sandbox.window.PointerEvent = tbox.sandbox.PointerEvent;
  const fakeMM = (q) => ({ matches: /pointer:\s*coarse|hover:\s*none/.test(String(q)) });
  tbox.sandbox.matchMedia = fakeMM;
  tbox.sandbox.window.matchMedia = fakeMM;
  const tctx = vm.createContext(tbox.sandbox);
  vm.runInContext(engineSrc, tctx, { filename: 'coach-engine.js' });
  vm.runInContext(assessSrc, tctx, { filename: 'assessment.js' });
  vm.runInContext(voiceSrc, tctx, { filename: 'voice.js' });
  vm.runInContext(appSrc, tctx, { filename: 'app.js' });
  const $t = (id) => tbox.byId[id];

  ok('触摸设备上麦克风按钮可用', !$t('micInput').classList.contains('hidden'));
  $t('micInput').click();
  ok('点一下 → 开始录音', !$t('voiceBar').classList.contains('hidden') && $t('micInput').classList.contains('rec'));
  ok('状态提示如何结束（不再让人找不到开关）', /停止/.test($t('voiceBarText').textContent), $t('voiceBarText').textContent);

  // 关键回归：触摸设备不绑定 pointer 手势，pointercancel 不应掐掉录音
  $t('micInput').dispatchEvent({ type: 'pointerdown' });
  $t('micInput').dispatchEvent({ type: 'pointercancel' });
  ok('pointercancel 不会中断录音（旧版正是在这里"瞬间退出"）', !$t('voiceBar').classList.contains('hidden'));

  FakeSR.last.emit([{ isFinal: false, 0: { transcript: '嗯 明天 有八个人聚餐' } }]);
  ok('识别中间结果实时回填', /明天/.test($t('input').value), $t('input').value);
  FakeSR.last.emit([{ isFinal: true, 0: { transcript: '嗯 明天 有八个人聚餐 其中两个不太熟' } }]);
  FakeSR.last.end();
  ok('文本已清洗（去句首"嗯"、去汉字间空格、补句号）',
    $t('input').value === '明天有八个人聚餐其中两个不太熟。', $t('input').value);
  ok('识别结束后按钮与状态条复位',
    !$t('micInput').classList.contains('rec') && $t('voiceBar').classList.contains('hidden'));

  $t('micInput').click();
  ok('再次点按开始新的录音', !$t('voiceBar').classList.contains('hidden'));
  $t('voiceBar').click();
  ok('点状态条即可停止（手机上更容易按到）', $t('voiceBar').classList.contains('hidden'));
})();

/* ---------- 场景三：按住说话（桌面指针设备） ---------- */
const pPress = (async function pressAndHold() {
  console.log('\n【场景三】按住说话 / 轻点切换');
  const pbox = createSandbox({ html, fetch: () => Promise.reject(new Error('offline')) });
  pbox.sandbox.SpeechRecognition = FakeSR;
  pbox.sandbox.window.SpeechRecognition = FakeSR;
  pbox.sandbox.PointerEvent = function PointerEvent() {};
  pbox.sandbox.window.PointerEvent = pbox.sandbox.PointerEvent;
  const pctx = vm.createContext(pbox.sandbox);
  vm.runInContext(engineSrc, pctx, { filename: 'coach-engine.js' });
  vm.runInContext(assessSrc, pctx, { filename: 'assessment.js' });
  vm.runInContext(voiceSrc, pctx, { filename: 'voice.js' });
  vm.runInContext(appSrc, pctx, { filename: 'app.js' });
  const $p = (id) => pbox.byId[id];

  ok('支持按压手势时麦克风按钮可用', !$p('micInput').classList.contains('hidden'));
  $p('micInput').dispatchEvent({ type: 'pointerdown' });
  ok('按住即开始录音', !$p('voiceBar').classList.contains('hidden') && $p('micInput').classList.contains('rec'));
  await sleep(450);
  $p('micInput').dispatchEvent({ type: 'pointerup' });
  ok('按住约 0.5 秒后松开 → 自动结束',
    $p('voiceBar').classList.contains('hidden') && !$p('micInput').classList.contains('rec'));

  $p('micInput').dispatchEvent({ type: 'pointerdown' });
  $p('micInput').dispatchEvent({ type: 'pointerup' });          // 轻点（<400ms）
  ok('轻点一下不会立刻结束（进入"再点一下"模式）', !$p('voiceBar').classList.contains('hidden'));
  ok('状态条提示再点一下结束', /再点一下/.test($p('voiceBarText').textContent), $p('voiceBarText').textContent);
  $p('micInput').dispatchEvent({ type: 'pointerdown' });
  $p('micInput').dispatchEvent({ type: 'pointerup' });
  ok('再点一下即结束', $p('voiceBar').classList.contains('hidden'));

  $p('micInput').dispatchEvent({ type: 'pointerdown' });
  $p('micInput').dispatchEvent({ type: 'pointercancel' });
  ok('手势被系统打断时也会停止（不会一直录）', $p('voiceBar').classList.contains('hidden'));

  ok('复盘页的按住说话按钮同样可用',
    !$p('micAction').classList.contains('hidden') && !$p('micNext').classList.contains('hidden'));
  $p('micAction').dispatchEvent({ type: 'pointerdown' });
  ok('复盘输入框的按压手势也进入录音', !$p('voiceBar').classList.contains('hidden'));
  FakeSR.last.emit([{ isFinal: true, 0: { transcript: '我先说了一句兜底的话' } }]);
  FakeSR.last.end();
  await sleep(20);
  ok('识别结果写入复盘输入框', /我先说了一句兜底的话/.test($p('rvAction').value), $p('rvAction').value);
})();

/* ---------- 场景五：识别器"一启动就失败"之后还能不能再用（回归） ---------- */
class FakeSRFailFast {
  constructor() { FakeSRFailFast.count++; this.lang = ''; }
  start() { if (this.onerror) this.onerror({ error: 'aborted' }); if (this.onend) this.onend(); }
  stop() { } abort() { }
}
FakeSRFailFast.count = 0;

(async function failFastRecovery() {
  await pTouch;                       // 等触摸场景跑完（它们内部有 await）
  await pPress;
  console.log('\n【场景五】识别器一启动就失败（微信常见）→ 再次点击应能重新开始');
  const fbox = createSandbox({ html, fetch: () => Promise.reject(new Error('offline')) });
  fbox.sandbox.SpeechRecognition = FakeSRFailFast;
  fbox.sandbox.window.SpeechRecognition = FakeSRFailFast;
  const fctx = vm.createContext(fbox.sandbox);
  vm.runInContext(engineSrc, fctx, { filename: 'coach-engine.js' });
  vm.runInContext(assessSrc, fctx, { filename: 'assessment.js' });
  vm.runInContext(voiceSrc, fctx, { filename: 'voice.js' });
  vm.runInContext(appSrc, fctx, { filename: 'app.js' });
  const $f = (id) => fbox.byId[id];

  $f('micInput').click();                         // 第一次：立刻失败
  ok('第一次点击确实启动了识别器', FakeSRFailFast.count === 1, '启动 ' + FakeSRFailFast.count + ' 次');
  ok('失败后状态条已收起', $f('voiceBar').classList.contains('hidden'));
  $f('micInput').click();                         // 第二次：必须能重新开始（旧版会在这里"点了没反应"）
  ok('**失败后再次点击能重新开始**（不会卡在"已结束的会话"上）',
    FakeSRFailFast.count === 2, '启动 ' + FakeSRFailFast.count + ' 次');
  FakeSRFailFast.count = 0;

  console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
