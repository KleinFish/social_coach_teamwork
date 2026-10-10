/*!
 * voice.js —— 语音输入模块
 *
 * 为什么做两层：
 *   浏览器内置的 Web Speech API（Chrome/Edge）会把音频送到厂商服务器，
 *   在国内网络下经常不可用；所以除它之外，再提供一条"上传到本服务转写"的通道：
 *   服务端把音频转发给配置好的 ASR 接口（见 server.js 的 /api/transcribe），音频不落盘。
 *
 * 本文件不做任何网络请求，也不依赖 DOM：
 *   - 识别能力探测、模式选择、错误翻译都是纯函数，可单元测试；
 *   - 录音/识别过程通过注入的 transcribe 回调交给上层（app.js）去发请求。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SocialVoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_LANG = 'zh-CN';

  /* ---------------- 能力探测 ---------------- */
  function detect(env) {
    var g = env || {};
    var w = g.window || g;
    var nav = g.navigator || (w && w.navigator) || {};
    var hasBrowserSR = !!(w && (w.SpeechRecognition || w.webkitSpeechRecognition));
    var hasRecorder = !!(w && w.MediaRecorder && nav && nav.mediaDevices && nav.mediaDevices.getUserMedia);
    return {
      hasBrowserSR: hasBrowserSR,
      hasRecorder: hasRecorder,
      /** 浏览器内置识别（零配置，但可能因网络/浏览器而不可用） */
      browserSupported: hasBrowserSR,
      /** 能录音 → 可以走服务端转写（前提是服务器配置了 ASR） */
      recorderSupported: hasRecorder
    };
  }

  /**
   * 选择输入模式：
   *   'browser' —— 浏览器内置识别（最省事）
   *   'server'  —— 本地录音 + 服务端转写（服务器已配置 ASR）
   *   'none'    —— 都不行，只能手动输入
   */
  function pickMode(env, options) {
    var opts = options || {};
    var caps = detect(env);
    if (opts.prefer === 'server' && caps.hasRecorder && opts.serverAvailable) return 'server';
    if (caps.hasBrowserSR) return 'browser';
    if (caps.hasRecorder && opts.serverAvailable) return 'server';
    return 'none';
  }

  /* ---------------- 错误翻译（不暴露技术细节，给可读的话） ---------------- */
  function mapError(code) {
    var table = {
      'not-allowed': '麦克风权限被拒绝了。可以在浏览器地址栏左侧的权限设置里允许麦克风后重试。',
      'service-not-allowed': '当前浏览器不允许使用语音识别。',
      'no-speech': '没有听到声音，靠近一点再说一次？',
      'audio-capture': '没有找到可用的麦克风。',
      'network': '语音识别服务连不上（可能是网络问题）。可以直接手动输入。',
      'aborted': '语音识别被中断了（微信等内置浏览器常限制这个能力）。可以再点一次试试，或直接手动输入。',
      'unsupported': '当前环境不支持语音输入，手动输入就好。',
      'server-not-configured': '服务器还没有配置语音转写，暂时只能手动输入。',
      'too-large': '这段录音太长了，说短一点再试（建议 30 秒内）。',
      'transcribe-failed': '转写失败了，可以直接手动输入。'
    };
    return table[code] || '语音输入没能完成，可以直接手动输入。';
  }

  /* ---------------- 选择录音格式 ---------------- */
  function pickMimeType(env) {
    var w = (env && env.window) || env || {};
    var MR = w.MediaRecorder;
    if (!MR || !MR.isTypeSupported) return '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (var i = 0; i < candidates.length; i++) {
      if (MR.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function blobToBase64(env, blob) {
    return new Promise(function (resolve, reject) {
      var FR = (env && env.FileReader) || (env && env.window && env.window.FileReader);
      if (!FR) { reject(new Error('no FileReader')); return; }
      var fr = new FR();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.onerror = function () { reject(new Error('read failed')); };
      fr.readAsDataURL(blob);
    });
  }

  /**
   * 开一次语音输入会话。
   * @param {Object} env  依赖注入：{window, navigator, FileReader}
   * @param {Object} opts {mode, lang, onPartial, onFinal, onError, onState, transcribe, maxMs}
   * @returns {Object} {stop(), mode}
   */
  function createSession(env, opts) {
    var o = opts || {};
    var mode = o.mode || 'none';
    var lang = o.lang || DEFAULT_LANG;
    var w = (env && env.window) || env || {};
    var stopped = false;
    var timer = null;
    var session = {
      mode: mode,
      /** 用户主动结束：优雅停止（把已识别到的内容交出来），而不是丢弃 */
      stop: function () { stopped = true; gracefulStop(); }
    };

    function state(s) { if (o.onState) o.onState(s); }
    function fail(code) { if (o.onError) o.onError(code, mapError(code)); }

    function cleanup() { if (timer) { clearTimeout(timer); timer = null; } }

    function gracefulStop() {
      cleanup();
      if (mode === 'browser') {
        try { if (rec) rec.stop(); }
        catch (e) { try { if (rec) rec.abort(); } catch (e2) { /* ignore */ } }
      } else if (mode === 'server') {
        var stoppedRecorder = false;
        try {
          if (mr && mr.state !== 'inactive') { mr.stop(); stoppedRecorder = true; }
        } catch (e) { /* ignore */ }
        // 录音器没在跑（或已被停止）时，直接释放麦克风
        if (!stoppedRecorder && stream) stream.getTracks().forEach(function (t) { t.stop(); });
      }
    }

    /** 仅在需要彻底释放麦克风时使用 */
    function releaseAll() {
      cleanup();
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignore */ }
    }

    // 最长录音时长，避免忘了点停止（默认 60 秒）
    var maxMs = o.maxMs || 60000;
    timer = setTimeout(function () { session.stop(); fail('too-large'); }, maxMs);

    if (mode === 'none') {
      fail('unsupported');
      return session;
    }

    if (mode === 'browser') {
      var rec = (w.SpeechRecognition || w.webkitSpeechRecognition) ? new (w.SpeechRecognition || w.webkitSpeechRecognition)() : null;
      if (!rec) { fail('unsupported'); return session; }
      var finalText = '';
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = function (ev) {
        var interim = '';
        var finals = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var res = ev.results[i];
          if (res.isFinal) finals += res[0].transcript;
          else interim += res[0].transcript;
        }
        if (finals) finalText += finals;
        if (o.onPartial) o.onPartial((finalText + interim).trim());
      };
      rec.onerror = function (ev) {
        var code = (ev && ev.error) || 'transcribe-failed';
        // 用户主动停止时会抛 aborted —— 这不是错误，按正常结束处理
        if (stopped && (code === 'aborted' || code === 'no-speech')) { return; }
        fail(code);
      };
      rec.onend = function () {
        cleanup();
        state('idle');
        if (o.onFinal) o.onFinal(finalText.trim());   // 空文本也交出去，让上层给出"没听到内容"的反馈
      };
      session._release = releaseAll;
      state('recording');
      try { rec.start(); } catch (e) { fail('unsupported'); }
      return session;
    }

    /* mode === 'server'：本地录音 → 交给上层转写 */
    var chunks = [];
    var mr = null;
    var stream = null;
    var mime = pickMimeType(env);
    var nav = (env && env.navigator) || w.navigator;

    state('recording');
    nav.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); state('idle'); return; }
      stream = s;
      try {
        mr = mime ? new w.MediaRecorder(s, { mimeType: mime }) : new w.MediaRecorder(s);
      } catch (e) { fail('audio-capture'); return; }
      mr.ondataavailable = function (ev) { if (ev && ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onerror = function () { fail('transcribe-failed'); };
      mr.onstop = function () {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (!chunks.length) { state('idle'); fail('no-speech'); return; }
        state('transcribing');
        var blob = new w.Blob(chunks, { type: mime || 'audio/webm' });
        blobToBase64(env, blob).then(function (b64) {
          if (!o.transcribe) { state('idle'); fail('server-not-configured'); return; }
          return o.transcribe(b64, blob.type).then(function (text) {
            state('idle');
            if (o.onFinal) o.onFinal(String(text || '').trim());
          });
        }).catch(function (err) {
          state('idle');
          fail((err && err.code) || 'transcribe-failed');
        });
      };
      mr.start();
    }).catch(function () { state('idle'); fail('not-allowed'); });

    session._release = releaseAll;
    return session;
  }

  /* ---------------- 识别文本清洗 ---------------- */
  /**
   * 浏览器内置识别常见问题：汉字之间插空格、开头带口语填充词、句尾没有标点。
   * 这里做保守清洗（不猜内容、不改语序），只去掉明显噪音。
   */
  function normalizeTranscript(text) {
    var t = String(text == null ? '' : text);
    t = t.replace(/[\u200b-\u200f\ufeff]/g, '');                    // 零宽字符
    t = t.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1'); // 汉字之间的空格
    t = t.replace(/^(嗯+|呃+|啊+|唉+)[，,、]?\s*/, '');                // 句首填充词
    t = t.replace(/([，。！？；])\s*(嗯+|呃+|啊+)[，,、]?\s*/g, '$1');   // 标点后的填充词
    t = t.replace(/^(就是说)[，,、]?\s*/, '');                       // 句首口头语
    t = t.replace(/^(那个|然后呢)[，,、]\s*/, '');                    // 只有后面跟停顿标点时才当成口头语（"那个，我…"），
                                                                  // 直接接名词的"那个同学"是实义，必须保留
    t = t.replace(/([，。！？；])\1+/g, '$1');                        // 重复标点
    t = t.replace(/\s{2,}/g, ' ').trim();
    // 只在以汉字结尾时补句号（英文/数字结尾保持原样，避免奇怪的中英混排）
    if (t && /[\u4e00-\u9fff]$/.test(t) && !/[。！？…]$/.test(t)) t += '。';
    return t;
  }

  return {
    DEFAULT_LANG: DEFAULT_LANG,
    LANGS: [
      { value: 'zh-CN', label: '普通话' },
      { value: 'en-US', label: 'English' }
    ],
    detect: detect,
    pickMode: pickMode,
    pickMimeType: pickMimeType,
    mapError: mapError,
    normalizeTranscript: normalizeTranscript,
    createSession: createSession
  };
});
