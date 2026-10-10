/* 语音输入模块单元测试：node test-voice.js
 * 用注入的假 SpeechRecognition / MediaRecorder / FileReader 覆盖两条通道与各类失败路径。
 */
'use strict';
const V = require('./voice.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n== ' + t + ' ==');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 假实现 ---------------- */
class FakeSR {
  constructor() { FakeSR.last = this; this.lang = ''; this.interimResults = false; this.continuous = true; }
  start() { this.started = true; }
  abort() { this.aborted = true; if (this.onend) this.onend(); }
  emitResults(list) { this.onresult({ resultIndex: 0, results: list }); }
  end() { if (this.onend) this.onend(); }
}

class FakeMR {
  constructor(stream, opts) { this.stream = stream; this.mimeType = (opts || {}).mimeType; this.state = 'inactive'; FakeMR.last = this; }
  static isTypeSupported(t) { return t === 'audio/webm;codecs=opus'; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: { size: 10 } });
    if (this.onstop) this.onstop();
  }
}

class FakeFR {
  readAsDataURL(blob) { this.result = 'data:' + blob.type + ';base64,' + (blob.b64 || 'AAAA'); if (this.onload) this.onload(); }
}

class FakeBlob {
  constructor(parts, opts) { this.parts = parts; this.type = (opts || {}).type || ''; this.size = 10; this.b64 = 'AAAA'; }
}

function makeEnv(opts) {
  const o = opts || {};
  const env = { window: {}, navigator: {}, FileReader: FakeFR };
  env.window.Blob = FakeBlob;
  if (o.sr !== false) env.window.SpeechRecognition = FakeSR;
  if (o.recorder !== false) {
    env.window.MediaRecorder = FakeMR;
    env.navigator.mediaDevices = {
      getUserMedia: o.denyMic
        ? () => Promise.reject(new Error('denied'))
        : () => Promise.resolve({ getTracks: () => [{ stop() {} }] })
    };
  }
  return env;
}

(async function run() {
  section('能力探测与模式选择');
  const both = V.detect(makeEnv());
  ok('同时有内置识别与录音能力', both.browserSupported && both.recorderSupported, JSON.stringify(both));
  const onlyBrowser = V.detect(makeEnv({ recorder: false }));
  ok('只有内置识别时也能用', onlyBrowser.browserSupported && !onlyBrowser.recorderSupported);
  const onlyRecorder = V.detect(makeEnv({ sr: false }));
  ok('没有内置识别但有录音能力', !onlyRecorder.browserSupported && onlyRecorder.recorderSupported);
  const none = V.detect(makeEnv({ sr: false, recorder: false }));
  ok('两者都没有', !none.browserSupported && !none.recorderSupported);

  ok('优先用浏览器内置识别', V.pickMode(makeEnv(), {}) === 'browser');
  ok('浏览器无内置识别但有录音 + 服务器可用 → 服务端转写',
    V.pickMode(makeEnv({ sr: false }), { serverAvailable: true }) === 'server');
  ok('服务器未配置 ASR → 只能手动输入',
    V.pickMode(makeEnv({ sr: false }), { serverAvailable: false }) === 'none');
  ok('显式偏好服务端时走服务端',
    V.pickMode(makeEnv(), { serverAvailable: true, prefer: 'server' }) === 'server');

  section('录音格式与错误翻译');
  ok('按浏览器支持情况挑选格式', V.pickMimeType(makeEnv()) === 'audio/webm;codecs=opus', V.pickMimeType(makeEnv()));
  ok('不支持任何格式时返回空串', V.pickMimeType(makeEnv({ recorder: false, sr: false })) === '');
  ok('权限被拒有可读提示', /麦克风权限/.test(V.mapError('not-allowed')));
  ok('没听到声音有可读提示', /没有听到/.test(V.mapError('no-speech')));
  ok('网络问题提示可手动输入', /手动输入/.test(V.mapError('network')));
  ok('未知错误有兜底文案', V.mapError('something-weird').length > 4);
  ok('错误文案不含"你应该"', Object.keys({}).length === 0 &&
    ['not-allowed', 'no-speech', 'network', 'aborted', 'unsupported', 'transcribe-failed', 'x']
      .every((c) => V.mapError(c).indexOf('你应该') === -1));

  section('浏览器内置识别通道');
  let partials = [], finals = [], errors = [], states = [];
  const s1 = V.createSession(makeEnv(), {
    mode: 'browser',
    onPartial: (t) => partials.push(t),
    onFinal: (t) => finals.push(t),
    onError: (c) => errors.push(c),
    onState: (s) => states.push(s)
  });
  ok('会话处于录音状态', states[0] === 'recording', JSON.stringify(states));
  ok('识别器收到了语言设置', FakeSR.last.lang === 'zh-CN' && FakeSR.last.interimResults === true);
  FakeSR.last.emitResults([{ isFinal: false, 0: { transcript: '明天' } }]);
  ok('中间结果实时回调', partials[partials.length - 1] === '明天', JSON.stringify(partials));
  FakeSR.last.emitResults([{ isFinal: true, 0: { transcript: '明天课堂展示' } }]);
  ok('最终结果累积正确', partials[partials.length - 1] === '明天课堂展示', JSON.stringify(partials));
  FakeSR.last.end();
  ok('结束时给出最终文本', finals[0] === '明天课堂展示', JSON.stringify(finals));
  ok('结束后回到空闲态', states[states.length - 1] === 'idle');

  const s2 = V.createSession(makeEnv(), { mode: 'browser', onError: (c) => errors.push(c) });
  FakeSR.last.onerror({ error: 'not-allowed' });
  ok('识别错误被归类', errors[errors.length - 1] === 'not-allowed');
  s2.stop();
  ok('stop() 会中止识别', FakeSR.last.aborted === true);
  s1.stop();

  section('服务端转写通道');
  let serverFinals = [], serverErrors = [], serverStates = [];
  const s3 = V.createSession(makeEnv({ sr: false }), {
    mode: 'server',
    transcribe: (b64, mime) => {
      ok('上传前把音频转成了 base64', typeof b64 === 'string' && b64.length > 0 && mime.indexOf('audio') === 0, mime);
      return Promise.resolve('我有点紧张');
    },
    onFinal: (t) => serverFinals.push(t),
    onError: (c) => serverErrors.push(c),
    onState: (s) => serverStates.push(s)
  });
  await sleep(5);
  ok('录音已开始', FakeMR.last && FakeMR.last.state === 'recording');
  s3.stop();
  await sleep(15);
  ok('转写结果回填', serverFinals[0] === '我有点紧张', JSON.stringify(serverFinals));
  ok('状态经过了 transcribing', serverStates.includes('transcribing'), JSON.stringify(serverStates));
  ok('结束后回到空闲态', serverStates[serverStates.length - 1] === 'idle');

  const s4 = V.createSession(makeEnv({ sr: false, denyMic: true }), { mode: 'server', onError: (c) => serverErrors.push(c) });
  await sleep(10);
  ok('麦克风被拒绝时给出 not-allowed', serverErrors[serverErrors.length - 1] === 'not-allowed', JSON.stringify(serverErrors));

  const s5 = V.createSession(makeEnv({ sr: false }), {
    mode: 'server',
    transcribe: () => Promise.reject(Object.assign(new Error('boom'), { code: 'transcribe-failed' })),
    onError: (c) => serverErrors.push(c)
  });
  await sleep(5);
  s5.stop();
  await sleep(15);
  ok('转写失败时给出可读错误', serverErrors[serverErrors.length - 1] === 'transcribe-failed', JSON.stringify(serverErrors));

  section('识别文本清洗（浏览器识别常见的三类噪音）');
  ok('去掉汉字之间的空格', V.normalizeTranscript('明天 有 八个人 聚餐') === '明天有八个人聚餐。',
    V.normalizeTranscript('明天 有 八个人 聚餐'));
  ok('去掉句首填充词', V.normalizeTranscript('嗯，明天有聚餐') === '明天有聚餐。', V.normalizeTranscript('嗯，明天有聚餐'));
  ok('去掉标点后的填充词', V.normalizeTranscript('明天有聚餐。嗯，其中两个不太熟') === '明天有聚餐。其中两个不太熟。',
    V.normalizeTranscript('明天有聚餐。嗯，其中两个不太熟'));
  ok('保留句中作实义的"那个"', V.normalizeTranscript('那个不太熟的同学也来') === '那个不太熟的同学也来。',
    V.normalizeTranscript('那个不太熟的同学也来'));
  ok('去掉句首作口头语的"那个，"', V.normalizeTranscript('那个，我不太想去') === '我不太想去。',
    V.normalizeTranscript('那个，我不太想去'));
  ok('去掉句首口头语"就是说"', V.normalizeTranscript('就是说，我不太想去') === '我不太想去。');
  ok('合并重复标点', V.normalizeTranscript('好的。。') === '好的。');
  ok('已有句号不重复添加', V.normalizeTranscript('我有点紧张。') === '我有点紧张。');
  ok('英文结尾不强加中文句号', V.normalizeTranscript('hello') === 'hello');
  ok('去掉零宽字符', V.normalizeTranscript('明天\u200b有聚餐') === '明天有聚餐。');
  ok('空输入与 null 安全', V.normalizeTranscript('') === '' && V.normalizeTranscript(null) === '');
  ok('清洗是幂等的', V.normalizeTranscript(V.normalizeTranscript('嗯 明天 有聚餐')) === '明天有聚餐。');

  section('边界情况');
  let noneErr = null;
  V.createSession(makeEnv({ sr: false, recorder: false }), { mode: 'none', onError: (c) => { noneErr = c; } });
  ok('不可用时报 unsupported', noneErr === 'unsupported');
  let timeoutErr = null;
  const s6 = V.createSession(makeEnv(), { mode: 'browser', maxMs: 20, onError: (c) => { timeoutErr = c; } });
  await sleep(40);
  ok('超长录音会被自动停止并提示', timeoutErr === 'too-large', String(timeoutErr));
  s6.stop();

  console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
