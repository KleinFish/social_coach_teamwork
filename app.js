/*!
 * app.js —— 「社交教练」原型·交互层
 * 四模块：社交前准备 / 社交中应急 / 社交后复盘 / 社交能力成长档案
 * 混合架构：默认走本地规则引擎（coach-engine.js）；配置了 OpenAI 兼容接口后切换为大模型对话，
 *          接口异常自动回退本地引擎，保证"永远可用"。
 */
(function () {
  'use strict';

  var E = window.CoachEngine;
  var Assess = window.SocialAssessment;
  var Voice = window.SocialVoice;
  var PROFILE_KEY = 'social-coach.profile.v1';
  var CLOUD_KEY = 'social-coach.cloud.v1';

  /* ---------------- 小工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }
  function copyText(text) {
    var done = function () { toast('已复制，可以直接念'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = el('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中'); }
      document.body.removeChild(ta);
    }
  }
  function store(key, val) {
    try {
      if (val === undefined) { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* 隐私模式/存储受限时静默降级为内存态 */ }
    return null;
  }

  /* ---------------- 状态 ---------------- */
  var profile = store(PROFILE_KEY) || E.createProfile();
  var cloudPrefs = store(CLOUD_KEY) || {};
  var cloud = {
    available: typeof location !== 'undefined' && location.protocol !== 'file:',
    user: null,
    revision: 0,
    llm: false,
    asr: false,
    lastSync: null,
    autoSync: cloudPrefs.autoSync !== false,
    busy: false
  };
  var reviewDraft = { triggers: [], effect: 'ok' };

  /* ---------------- 标签页 ---------------- */
  var navBtns = document.querySelectorAll('.nav-btn');
  function switchTab(tab) {
    var i;
    for (i = 0; i < navBtns.length; i++) navBtns[i].classList.toggle('active', navBtns[i].dataset.tab === tab);
    var panels = document.querySelectorAll('.panel');
    for (i = 0; i < panels.length; i++) panels[i].classList.toggle('active', panels[i].id === 'panel-' + tab);
    if (tab === 'me') renderMe();
    if (tab === 'review') renderReviewStage();
    if (tab === 'test') renderTestPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  for (var n = 0; n < navBtns.length; n++) {
    navBtns[n].addEventListener('click', function () { switchTab(this.dataset.tab); });
  }

  /* ---------------- 消息渲染 ---------------- */
  function addMessage(role, content) {
    var msg = el('div', 'msg ' + role);
    msg.appendChild(el('div', 'avatar', role === 'user' ? '我' : '◎'));
    var bubble = el('div', 'bubble');
    var stack = el('div', 'stack');
    if (typeof content === 'string') stack.appendChild(el('div', 'text', content));
    else stack.appendChild(content);
    bubble.appendChild(stack);
    msg.appendChild(bubble);
    $('#chat').appendChild(msg);
    $('#chat').scrollTop = $('#chat').scrollHeight;
    return msg;
  }
  function addUser(text) { addMessage('user', text); }
  function typingNode() {
    var t = el('div', 'typing');
    t.appendChild(el('i')); t.appendChild(el('i')); t.appendChild(el('i'));
    return t;
  }

  /* ---------------- 回复块渲染 ---------------- */
  var LEVEL_COLORS = ['', 'var(--l1)', 'var(--l2)', 'var(--l3)', 'var(--l4)', 'var(--l5)'];
  function levelMeter(level) {
    var m = el('div', 'meter');
    var bars = el('div', 'bars');
    for (var i = 1; i <= 5; i++) {
      var b = el('i');
      if (i <= level) b.style.background = LEVEL_COLORS[level];
      bars.appendChild(b);
    }
    m.appendChild(bars);
    m.appendChild(el('div', 'lv', level + '/5 ' + E.LEVEL_LABELS[level]));
    return m;
  }
  function scriptGroup(label, items) {
    if (!items || !items.length) return null;
    var g = el('div', 'script-group');
    g.appendChild(el('div', 'g-label', label));
    items.forEach(function (it) {
      var row = el('div', 'copyable');
      row.appendChild(el('div', 'g-item', it));
      var btn = el('button', 'copy-btn', '复制');
      btn.addEventListener('click', function () { copyText(it); });
      row.appendChild(btn);
      g.appendChild(row);
    });
    return g;
  }

  function breathNode(b) {
    var wrap = el('div', 'block breath');
    wrap.appendChild(el('div', 'b-title', b.title));
    wrap.appendChild(el('div', 'b-sub', '吸 4 秒 · 停 2 秒 · 呼 6 秒 · 共 30 秒'));
    var row = el('div', 'breath-wrap');
    var circle = el('div', 'breath-circle', '准备');
    var right = el('div');
    right.appendChild(el('div', 'line', b.text));
    right.appendChild(el('div', 'line', '心跳快不等于你不行——它只是身体在准备。'));
    var status = el('div', 'b-sub', '随时可以停，没人会知道。');
    var btn = el('button', 'btn small', '开始 30 秒');
    right.appendChild(btn);
    right.appendChild(status);
    row.appendChild(circle); row.appendChild(right);
    wrap.appendChild(row);

    var phases = [
      { name: '吸气', cls: 'inhale', sec: 4 },
      { name: '停', cls: 'hold', sec: 2 },
      { name: '呼气', cls: 'exhale', sec: 6 }
    ];
    var timer = null, idx = 0, remain = phases[0].sec, elapsed = 0;
    function stop(finished) {
      clearInterval(timer); timer = null;
      btn.textContent = finished ? '再来一次' : '继续';
      circle.className = 'breath-circle';
      circle.textContent = finished ? '完成' : '暂停';
      status.textContent = finished ? '完成 30 秒。现在只需要说出第一句话。' : '已暂停，随时可以继续。';
    }
    btn.addEventListener('click', function () {
      if (timer) { stop(false); return; }
      if (elapsed >= 30) { elapsed = 0; idx = 0; remain = phases[0].sec; }
      btn.textContent = '暂停';
      status.textContent = '跟着圆圈走就行。';
      function paint() {
        var p = phases[idx];
        circle.className = 'breath-circle ' + p.cls;
        circle.textContent = p.name + ' ' + remain;
        status.textContent = '已进行 ' + elapsed + ' / 30 秒' + (p.name === '呼气' ? ' · 呼气比吸气长，身体会慢下来' : '');
      }
      paint();
      timer = setInterval(function () {
        remain -= 1;
        elapsed += 1;
        if (elapsed >= 30) { elapsed = 30; paint(); stop(true); return; }
        if (remain <= 0) { idx = (idx + 1) % phases.length; remain = phases[idx].sec; }
        paint();
      }, 1000);
    });
    return wrap;
  }

  function renderBlock(b) {
    var box;
    switch (b.type) {
      case 'empathy':
        box = el('div', 'block empathy');
        box.appendChild(el('div', 'text', b.text));
        return box;

      case 'analysis':
        box = el('div', 'block analysis');
        box.appendChild(el('div', 'b-title', b.title || '我听到的场景'));
        box.appendChild(el('div', 'line', '场景：' + (b.scene || '待确认')));
        if (b.level) box.appendChild(levelMeter(b.level));
        if (b.factors && b.factors.length) {
          var ul = el('ul', 'factors');
          b.factors.forEach(function (f) { ul.appendChild(el('li', null, f.text)); });
          box.appendChild(ul);
        }
        if (b.emotionLabels && b.emotionLabels.length) {
          var cm = el('div', 'chips-mini');
          b.emotionLabels.forEach(function (t) { cm.appendChild(el('span', null, t)); });
          box.appendChild(cm);
        }
        if (b.alternatives && b.alternatives.length) {
          box.appendChild(el('div', 'soft-note', '也可能是：' + b.alternatives.join(' / ') + '（点下方场景按钮可以换）'));
        }
        if (b.note) box.appendChild(el('div', 'soft-note', b.note));
        if (b.selfCheck) box.appendChild(el('div', 'soft-note', b.selfCheck));
        return box;

      case 'reframe':
        box = el('div', 'block reframe');
        box.appendChild(el('div', 'b-title', b.title || '重新解释这份紧张'));
        if (b.subtitle) box.appendChild(el('div', 'b-sub', b.subtitle));
        (b.lines || []).forEach(function (t) { box.appendChild(el('div', 'line', t)); });
        return box;

      case 'breath':
        return breathNode(b);

      case 'script':
        box = el('div', 'block script');
        box.appendChild(el('div', 'b-title', b.title || '可以直接念的话'));
        (b.groups || []).forEach(function (g) {
          var node = scriptGroup(g.label, g.items);
          if (node) box.appendChild(node);
        });
        return box;

      case 'checklist':
        box = el('div', 'block checklist');
        box.appendChild(el('div', 'b-title', b.title || '准备清单'));
        var cl = el('ul');
        (b.items || []).forEach(function (t) { cl.appendChild(el('li', null, t)); });
        box.appendChild(cl);
        if (b.hint) box.appendChild(el('div', 'soft-note', b.hint));
        return box;

      case 'emergency':
        box = el('div', 'block emergency');
        box.appendChild(el('div', 'b-title', b.title));
        var first = (b.quick || [])[0] || '';
        var say = el('div', 'big-say', first);
        box.appendChild(say);
        var cbtn = el('button', 'btn small', '复制这句话');
        cbtn.addEventListener('click', function () { copyText(first); });
        box.appendChild(cbtn);
        if (b.quick && b.quick.length > 1) {
          var alt = el('div', 'script-group');
          alt.appendChild(el('div', 'g-label', '备选'));
          b.quick.slice(1).forEach(function (t) { alt.appendChild(el('div', 'g-item', t)); });
          box.appendChild(alt);
        }
        var tl = el('div', 'script-group');
        tl.appendChild(el('div', 'g-label', '接着可以做的'));
        var ul2 = el('ul');
        (b.then || []).forEach(function (t) { ul2.appendChild(el('li', null, t)); });
        tl.appendChild(ul2);
        box.appendChild(tl);
        if (b.tip) box.appendChild(el('div', 'soft-note', b.tip));
        return box;

      case 'safety':
        box = el('div', 'block safety');
        box.appendChild(el('div', 'b-title', b.title));
        box.appendChild(el('div', 'text', b.text));
        return box;

      default:
        box = el('div', 'block');
        box.appendChild(el('div', 'text', b.text || ''));
        return box;
    }
  }
  function renderBlocks(host, blocks) {
    (blocks || []).forEach(function (b) { host.appendChild(renderBlock(b)); });
  }

  /* ---------------- 云端：账号、同步、大模型代理 ---------------- */
  function api(path, options) {
    return fetch(path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    }, options || {}));
  }
  function apiJson(path, options) {
    return api(path, options).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { status: r.status, ok: r.ok, data: data };
      });
    });
  }
  function errText(res) { return (res && res.data && res.data.error) || '网络异常，请稍后再试'; }

  // 大模型走服务端代理：API Key 只存在服务器，浏览器拿不到，也没有跨域问题
  function serverCoach(text) {
    if (!cloud.available || !cloud.user || !cloud.llm) return Promise.resolve(null);
    return apiJson('/api/coach', { method: 'POST', body: JSON.stringify({ text: text }) })
      .then(function (res) { return res.ok && res.data.blocks ? res.data.blocks : null; })
      .catch(function () { return null; });
  }

  var syncTimer = null;
  function scheduleSync() {
    if (!cloud.available || !cloud.user || !cloud.autoSync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow(false); }, 1200);
  }

  /**
   * 同步：先合并（本地 ∪ 服务器），再以服务器 revision 做乐观并发提交；
   * 遇到 409 就用服务器最新版本再合并一次，最多重试两次。
   */
  function syncNow(manual, attempt) {
    if (!cloud.available || !cloud.user || cloud.busy) return Promise.resolve(false);
    attempt = attempt || 0;
    cloud.busy = true;
    renderCloud();
    return apiJson('/api/me').then(function (me) {
      if (!me.ok) { cloud.user = null; return false; }
      var merged = E.mergeProfiles(profile, me.data.profile);
      var changed = !E.sameProfile(merged, me.data.profile);
      if (!changed) { adoptRemote(merged, me.data.revision); return true; }
      return apiJson('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ profile: merged, baseRevision: me.data.revision })
      }).then(function (res) {
        if (res.status === 409 && attempt < 2) {
          cloud.busy = false;
          return syncNow(manual, attempt + 1);
        }
        if (!res.ok) { toast(errText(res)); return false; }
        adoptRemote(E.mergeProfiles(merged, res.data.profile), res.data.revision);
        return true;
      });
    }).catch(function () { return false; }).then(function (done) {
      cloud.busy = false;
      if (done) {
        cloud.lastSync = new Date();
        store(PROFILE_KEY, profile);
        store(CLOUD_KEY, { autoSync: cloud.autoSync });
      } else if (manual) {
        toast('同步失败，本地数据未受影响');
      }
      renderMe();
      if (manual && done) toast('已同步到云端');
      return done;
    });
  }
  function adoptRemote(merged, revision) {
    profile = merged;
    cloud.revision = revision;
  }

  function bootstrapCloud() {
    if (!cloud.available) { renderCloud(); renderVoiceButtons(); return; }
    apiJson('/api/health').then(function (res) {
      cloud.llm = !!(res.ok && res.data.llm);
      cloud.asr = !!(res.ok && res.data.asr);
      return apiJson('/api/me');
    }).then(function (me) {
      if (me && me.ok) {
        cloud.user = me.data.user;
        profile = E.mergeProfiles(profile, me.data.profile);
        cloud.revision = me.data.revision;
        store(PROFILE_KEY, profile);
      }
      renderCloud();
      renderMe();
      if (cloud.user) syncNow(false);
    }).catch(function () { renderCloud(); renderVoiceButtons(); });
  }

  function renderCloud() {
    var pill = $('#cloudPill');
    var form = $('#cloudForm');
    var signed = $('#cloudSignedIn');
    if (!pill) return;
    var showForm, showSigned;
    if (!cloud.available) {
      pill.textContent = '本地文件模式';
      pill.className = 'mode-pill';
      $('#cloudHint').textContent = '当前是直接打开本地文件，云端同步不可用。把整个文件夹部署到服务器后，通过网址访问即可注册登录。';
      showForm = false; showSigned = false;
    } else if (cloud.user) {
      pill.textContent = cloud.busy ? '同步中…' : '已登录 · 已同步';
      pill.className = 'mode-pill live';
      $('#cloudHint').textContent = '复盘记录会同时保存在本机和你的账号下；退出登录后仍可离线使用本机数据。';
      showForm = false; showSigned = true;
      $('#cloudWho').textContent = '当前账号：' + cloud.user.username;
      $('#cloudSyncInfo').textContent = cloud.lastSync
        ? '上次同步：' + cloud.lastSync.toLocaleString('zh-CN')
        : '还没有同步过，点"立即同步"即可。';
      $('#cloudAuto').checked = cloud.autoSync;
    } else {
      pill.textContent = '仅本机';
      pill.className = 'mode-pill';
      $('#cloudHint').textContent = '未登录时所有数据只在这台设备上。注册一个账号（只需昵称和密码，不用手机号或邮箱）就能同步到云端。';
      showForm = true; showSigned = false;
    }
    form.classList.toggle('hidden', !showForm);
    signed.classList.toggle('hidden', !showSigned);
    var llmPill = $('#llmPill');
    if (llmPill) {
      llmPill.textContent = cloud.llm ? '服务器已配置' : (cloud.available ? '未配置（用本地引擎）' : '离线不可用');
      llmPill.className = 'mode-pill' + (cloud.llm ? ' live' : '');
    }
  }

  /* ---------------- 社交前准备 ---------------- */
  var SUGGESTS = [
    '待会儿要参加一个 8 人聚餐，其中两个不太熟',
    '明天上午面试，第一次',
    '下周课堂展示，要上台讲 5 分钟',
    '要去社团面试，会群面',
    '刚加了新同学微信，不知道怎么开口',
    '组会上要发言，怕说错'
  ];
  function renderSuggests() {
    var box = $('#suggest');
    box.innerHTML = '';
    SUGGESTS.forEach(function (s) {
      var b = el('button', null, s);
      b.addEventListener('click', function () { send(s); });
      box.appendChild(b);
    });
  }

  function send(text) {
    text = (text || '').trim();
    if (!text) return;
    addUser(text);
    $('#input').value = '';
    autoGrow();
    var holder = addMessage('assistant', typingNode());
    var bubbleStack = holder.querySelector('.stack');

    function show(blocks) {
      bubbleStack.innerHTML = '';
      renderBlocks(bubbleStack, blocks);
      $('#chat').scrollTop = $('#chat').scrollHeight;
    }
    function localReply() {
      var intent = E.route(text);
      if (intent === 'crisis') return { blocks: [E.CRISIS_BLOCK] };
      if (intent === 'emergency') {
        var topic = guessEmergencyTopic(text);
        var r = E.buildEmergencyReply(topic, profile);
        return { blocks: [{ type: 'empathy', text: '先处理眼前这一步，其他都往后放。' }].concat(r.blocks) };
      }
      if (intent === 'review') {
        return {
          blocks: [{
            type: 'checklist',
            title: '这次已经结束了，建议换个方式',
            items: ['去「复盘」标签页，1 分钟填完结构化复盘', '只需要写：触发点、你做了什么、下次换哪个小动作'],
            hint: '复盘的目的是把"事后反刍"关掉，而不是再想一遍细节。'
          }]
        };
      }
      return E.buildPrepReply(text, profile, { selfCheckDifficulty: selfCheckDifficultyFor(text) });
    }

    var local = localReply();
    if (local.crisis || !cloud.user || !cloud.llm) { show(local.blocks); return; }

    serverCoach(text).then(function (blocks) {
      if (blocks && blocks.length) {
        var normalized = blocks.slice();
        if (normalized[0].type !== 'empathy') {
          normalized.unshift({ type: 'empathy', text: '先说一句：在任何场景里紧一下，都是很常见的反应。' });
        }
        show(normalized);
        toast('已由大模型生成');
      } else {
        show(local.blocks);
        toast('大模型暂时不可用，已用本地引擎回答');
      }
    });
  }

  function guessEmergencyTopic(text) {
    var hay = String(text).toLowerCase();
    if (/空白|想不出来|卡住|忘词/.test(hay)) return 'blank';
    if (/不知道说什么|没话说|冷场/.test(hay)) return 'nosay';
    if (/想走|想离开|待不下|撤退/.test(hay)) return 'exit';
    if (/说错|讲错|失言/.test(hay)) return 'mistake';
    if (/点名|突然|被叫|被问/.test(hay)) return 'called';
    if (/心跳|出汗|发抖|撑不住|慌/.test(hay)) return 'panic';
    return 'nosay';
  }

  $('#sendBtn').addEventListener('click', function () { send($('#input').value); });
  $('#input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(this.value); }
  });
  function autoGrow() {
    var ta = $('#input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(96, ta.scrollHeight) + 'px';
  }
  $('#input').addEventListener('input', autoGrow);

  /* ---------------- 社交中应急 ---------------- */
  function renderSosGrid() {
    var grid = $('#sosGrid');
    grid.innerHTML = '';
    var rec = null;
    var dims = assessmentDims();
    if (dims) rec = Assess.recommendEmergency(dims);
    E.EMERGENCY.forEach(function (t) {
      var b = el('button', 'sos-btn');
      var strong = el('strong', null, t.name);
      if (t.id === rec) strong.appendChild(el('span', 'rec', '画像推荐'));
      b.appendChild(strong);
      b.appendChild(el('span', null, t.sub));
      b.addEventListener('click', function () { showEmergency(t.id); });
      grid.appendChild(b);
    });
    var box = $('#sosHintBox');
    if (box) box.innerHTML = '';
    if (rec && box) {
      var meta = E.EMERGENCY.filter(function (t) { return t.id === rec; })[0];
      var r = rankInfo();
      box.appendChild(el('div', 'sos-hint', '你的自测画像里最需要先练的是「' +
        (r.weakest.length ? r.weakest[0].name : '临场应变') + '」，已用"画像推荐"标出最相关的一键入口' +
        (meta ? '（' + meta.name + '）' : '') + '，先把那句话背下来。'));
    }
  }
  function showEmergency(id) {
    var r = E.buildEmergencyReply(id, profile);
    var host = $('#sosResult');
    host.innerHTML = '';
    var card = el('div', 'card');
    card.appendChild(el('div', 'card-title-row')).appendChild(el('span', 'tag', '现在就能用'));
    var wrap = el('div');
    renderBlocks(wrap, r.blocks);
    card.appendChild(wrap);
    host.appendChild(card);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 社交后复盘 ---------------- */
  function renderReviewStage() {
    var sel = $('#rvScene');
    if (!sel.options.length) {
      E.SCENES.forEach(function (s) {
        var o = el('option', null, s.name + '（基准压力 ' + s.level + '/5）');
        o.value = s.id;
        sel.appendChild(o);
      });
      sel.value = 'eat-unfamiliar';
    }
    var trigBox = $('#rvTriggers');
    if (!trigBox.children.length) {
      E.TRIGGER_OPTIONS.forEach(function (t) {
        var c = el('button', 'chip', t);
        c.type = 'button';
        c.addEventListener('click', function () {
          var i = reviewDraft.triggers.indexOf(t);
          if (i >= 0) reviewDraft.triggers.splice(i, 1); else reviewDraft.triggers.push(t);
          c.classList.toggle('on');
        });
        trigBox.appendChild(c);
      });
    }
    var effBox = $('#rvEffect');
    if (!effBox.children.length) {
      E.EFFECT_OPTIONS.forEach(function (o) {
        var c = el('button', 'chip' + (o.value === 'ok' ? ' on' : ''), o.label);
        c.type = 'button';
        c.dataset.value = o.value;
        c.addEventListener('click', function () {
          reviewDraft.effect = o.value;
          var all = effBox.querySelectorAll('.chip');
          for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
          c.classList.add('on');
        });
        effBox.appendChild(c);
      });
    }
  }
  $('#rvLevel').addEventListener('input', function () {
    $('#rvLevelBadge').textContent = this.value + '/5 ' + E.LEVEL_LABELS[+this.value];
  });
  $('#rvDemo').addEventListener('click', function () {
    $('#rvScene').value = 'meeting-speak';
    $('#rvLevel').value = 4;
    $('#rvLevel').dispatchEvent(new Event('input'));
    $('#rvAction').value = '先写三行稿，发言时先给结论';
    $('#rvNext').value = '提前一天写下结论句，会上第一个发言';
    reviewDraft.triggers = ['要当众说话', '怕说错'];
    var chips = $('#rvTriggers').querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('on', reviewDraft.triggers.indexOf(chips[i].textContent) >= 0);
    reviewDraft.effect = 'good';
    var effs = $('#rvEffect').querySelectorAll('.chip');
    for (var j = 0; j < effs.length; j++) effs[j].classList.toggle('on', effs[j].dataset.value === 'good');
    toast('已填入一份示例，可以直接点"完成复盘"');
  });
  $('#reviewForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var result = E.buildReview({
      sceneId: $('#rvScene').value,
      level: $('#rvLevel').value,
      triggers: reviewDraft.triggers,
      action: $('#rvAction').value,
      effect: reviewDraft.effect,
      next: $('#rvNext').value
    });
    profile = E.addReview(profile, result.record);
    store(PROFILE_KEY, profile);
    scheduleSync();
    var host = $('#reviewResult');
    host.innerHTML = '';
    var card = el('div', 'card review-result');
    card.appendChild(el('div', 'card-title-row')).appendChild(el('h2', null, '这次复盘结束了'));
    var ul = el('ul');
    result.summary.forEach(function (t) { ul.appendChild(el('li', null, t)); });
    card.appendChild(ul);
    if (result.record.effect === 'good') {
      card.appendChild(el('p', 'hint', '已存入策略库：' + result.record.action));
    }
    host.appendChild(card);
    toast('已保存到本机档案');
    $('#rvAction').value = '';
    $('#rvNext').value = '';
  });

  /* ---------------- 社交画像测试 ---------------- */
  var QUIZ_PAGE_SIZE = 8;
  var quiz = { page: 0, answers: {}, active: false };

  function assessmentDims() {
    var a = profile.assessment;
    return (a && a.dimensions) ? a.dimensions : null;
  }
  function rankInfo() {
    var dims = assessmentDims();
    return dims ? Assess.rankDimensions(dims) : { sorted: [], strongest: [], weakest: [] };
  }
  function currentPredictions() {
    var dims = assessmentDims();
    return dims ? Assess.predictScenes(dims, E.SCENES) : null;
  }
  /** 给「准备」模块用：这个场景在用户自评里的预测难度 */
  function selfCheckDifficultyFor(text) {
    var preds = currentPredictions();
    if (!preds) return null;
    var found = E.detectScenes(text, 1);
    if (!found.length) return null;
    var hit = preds.filter(function (p) { return p.id === found[0].scene.id; })[0];
    return hit ? hit.difficulty : null;
  }

  function showQuizUI(active) {
    $('#testIntro').classList.toggle('hidden', active);
    $('#testQuiz').classList.toggle('hidden', !active);
    $('#testResult').classList.toggle('hidden', active);
  }

  function renderTestPanel() {
    var last = profile.assessment && profile.assessment.at;
    $('#testLastTime').textContent = last ? ('上次测试：' + new Date(last).toLocaleString('zh-CN')) : '';
    if (quiz.active) { showQuizUI(true); renderQuizPage(); return; }
    showQuizUI(false);
    renderTestResult(profile.assessment);
  }

  function startQuiz() {
    quiz.active = true;
    quiz.page = 0;
    quiz.answers = {};
    showQuizUI(true);
    renderQuizPage();
  }

  function renderQuizPage() {
    var total = Assess.ITEMS.length;
    var pages = Math.ceil(total / QUIZ_PAGE_SIZE);
    var start = quiz.page * QUIZ_PAGE_SIZE;
    var items = Assess.ITEMS.slice(start, start + QUIZ_PAGE_SIZE);
    var host = $('#testQuestions');
    host.innerHTML = '';
    items.forEach(function (it, idx) {
      var wrap = el('div', 'q-item');
      var qt = el('div', 'q-text');
      qt.appendChild(el('span', 'q-no', 'Q' + (start + idx + 1)));
      qt.appendChild(el('span', null, it.text));
      wrap.appendChild(qt);
      var opts = el('div', 'q-opts');
      Assess.LIKERT.forEach(function (o) {
        var b = el('button', 'q-opt' + (quiz.answers[it.id] === o.value ? ' on' : ''), o.label);
        b.addEventListener('click', function () {
          quiz.answers[it.id] = o.value;
          var sibs = opts.querySelectorAll('.q-opt');
          for (var s = 0; s < sibs.length; s++) sibs[s].classList.remove('on');
          b.classList.add('on');
          updateQuizNav();
        });
        opts.appendChild(b);
      });
      wrap.appendChild(opts);
      host.appendChild(wrap);
    });
    updateQuizNav();
  }

  function updateQuizNav() {
    var total = Assess.ITEMS.length;
    var pages = Math.ceil(total / QUIZ_PAGE_SIZE);
    var lastPage = quiz.page >= pages - 1;
    var pageItems = Assess.ITEMS.slice(quiz.page * QUIZ_PAGE_SIZE, quiz.page * QUIZ_PAGE_SIZE + QUIZ_PAGE_SIZE);
    var answeredOnPage = pageItems.every(function (it) { return quiz.answers[it.id]; });
    var answeredAll = Assess.ITEMS.every(function (it) { return quiz.answers[it.id]; });
    $('#testBar').style.width = Math.round(((quiz.page + (answeredOnPage ? 1 : 0.5)) / pages) * 100) + '%';
    $('#testCount').textContent = '第 ' + (quiz.page + 1) + ' / ' + pages + ' 页 · 已答 ' +
      Assess.ITEMS.filter(function (it) { return quiz.answers[it.id]; }).length + ' / ' + total;
    $('#testPrev').disabled = quiz.page === 0;
    $('#testNext').textContent = lastPage ? '提交并生成画像' : '下一页';
    $('#testNext').disabled = lastPage ? !answeredAll : !answeredOnPage;
  }

  function submitQuiz() {
    var missing = Assess.ITEMS.filter(function (it) { return !quiz.answers[it.id]; });
    if (missing.length) {
      toast('还有 ' + missing.length + ' 题没作答');
      quiz.page = Math.floor(Assess.ITEMS.indexOf(missing[0]) / QUIZ_PAGE_SIZE);
      renderQuizPage();
      return;
    }
    var result = Assess.score(quiz.answers, { scenes: E.SCENES });
    quiz.active = false;
    showQuizUI(false);
    saveAssessment(result);
    renderTestResult(result);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** 只把必要字段写进画像：场景预测是可重算的，不入库，避免两处数据打架 */
  function saveAssessment(result) {
    profile.assessment = {
      version: result.version,
      at: result.at,
      answered: result.answered,
      total: result.total,
      dimensions: result.dimensions,
      readiness: result.readiness,
      tendencyHint: result.tendencyHint,
      flat: result.flat
    };
    var noted = '';
    if (!profile.tendency && result.tendencyHint) {
      profile.tendency = result.tendencyHint;
      noted = '，并把画像倾向设为「' + (result.tendencyHint === 'i' ? '偏内向 i' : '偏外向 e') + '」';
    }
    store(PROFILE_KEY, profile);
    renderSosGrid();
    renderMe();
    renderTestPanel();
    scheduleSync();
    toast('画像已写入%s，之后「准备」和「应急」会按它调整建议'.replace('%s', noted));
  }

  function dimBar(name, score) {
    var li = el('li');
    li.appendChild(el('span', 'dim-name', name));
    var bar = el('span', 'dim-bar');
    var fill = el('i');
    fill.style.width = (score === null ? 0 : score) + '%';
    bar.appendChild(fill);
    li.appendChild(bar);
    li.appendChild(el('span', 'dim-val', score === null ? '—' : String(score)));
    return li;
  }

  /** 八维雷达图（纯 SVG，无第三方库） */
  function radarSvg(dims) {
    var list = Assess.DIMENSIONS;
    var n = list.length, size = 300, cx = size / 2, cy = size / 2 + 4, R = 92;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);

    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      var pts = [];
      for (var i = 0; i < n; i++) {
        var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push((cx + Math.cos(ang) * R * k).toFixed(1) + ',' + (cy + Math.sin(ang) * R * k).toFixed(1));
      }
      var poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#e5e8f0');
      poly.setAttribute('stroke-width', '1');
      svg.appendChild(poly);
    });

    var shape = [];
    for (var i = 0; i < n; i++) {
      var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      var x2 = cx + Math.cos(ang) * R, y2 = cy + Math.sin(ang) * R;
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', x2.toFixed(1)); line.setAttribute('y2', y2.toFixed(1));
      line.setAttribute('stroke', '#eceff7');
      svg.appendChild(line);

      var scoreV = (typeof dims[list[i].key] === 'number') ? dims[list[i].key] : 0;
      shape.push((cx + Math.cos(ang) * R * (scoreV / 100)).toFixed(1) + ',' + (cy + Math.sin(ang) * R * (scoreV / 100)).toFixed(1));

      var tx = cx + Math.cos(ang) * (R + 26), ty = cy + Math.sin(ang) * (R + 22) + 3;
      var label = document.createElementNS(ns, 'text');
      label.setAttribute('x', tx.toFixed(1));
      label.setAttribute('y', ty.toFixed(1));
      label.setAttribute('font-size', '10.5');
      label.setAttribute('fill', '#5a6478');
      var cosA = Math.cos(ang);
      label.setAttribute('text-anchor', cosA > 0.3 ? 'start' : (cosA < -0.3 ? 'end' : 'middle'));
      label.textContent = list[i].name + ' ' + (typeof dims[list[i].key] === 'number' ? dims[list[i].key] : '—');
      svg.appendChild(label);
    }

    var area = document.createElementNS(ns, 'polygon');
    area.setAttribute('points', shape.join(' '));
    area.setAttribute('fill', 'rgba(74,124,246,.18)');
    area.setAttribute('stroke', '#4a7cf6');
    area.setAttribute('stroke-width', '2');
    svg.appendChild(area);
    return svg;
  }

  function predCard(p) {
    var card = el('div', 'pred-item');
    var top = el('div', 'p-top');
    top.appendChild(el('span', 'p-name', p.name));
    var tone = p.band === 'strength' ? 'good' : (p.band === 'challenge' ? 'warn' : (p.band === 'hard' ? 'bad' : ''));
    top.appendChild(el('span', 'badge ' + tone, p.bandLabel));
    top.appendChild(el('span', 'p-lv', '预测难度 ' + p.difficulty + '/5'));
    card.appendChild(top);
    card.appendChild(el('div', 'p-why', '依据：' + p.reasons.join('；')));
    card.appendChild(el('div', 'p-tip', '可以先试：' + p.tip));
    return card;
  }

  function renderTestResult(result) {
    var host = $('#testResult');
    host.innerHTML = '';
    if (!result || !result.dimensions) {
      var c0 = el('div', 'card');
      c0.appendChild(el('p', 'hint', '还没有测试结果。点上面的「开始测试」，40 道题大约 4 分钟。'));
      host.appendChild(c0);
      return;
    }

    var dims = result.dimensions;
    var rank = Assess.rankDimensions(dims);
    var preds = Assess.predictScenes(dims, E.SCENES);
    var split = Assess.splitScenes(preds);
    var steady = preds.filter(function (p) { return p.band === 'steady'; });

    /* 1. 总览 + 雷达图 */
    var overview = el('div', 'card');
    var head = el('div', 'assess-head');
    var ring = el('div', 'score-ring');
    ring.style.setProperty('--pct', (result.readiness === null ? 0 : result.readiness) + '%');
    var inner = el('span');
    inner.appendChild(el('b', null, result.readiness === null ? '—' : String(result.readiness)));
    inner.appendChild(el('small', null, '准备度'));
    ring.appendChild(inner);
    head.appendChild(ring);
    var headText = el('div');
    Assess.summarize(result).forEach(function (t) { headText.appendChild(el('div', 'line', t)); });
    head.appendChild(headText);
    overview.appendChild(head);

    var radarBox = el('div', 'radar-box');
    radarBox.appendChild(radarSvg(dims));
    overview.appendChild(radarBox);

    var dimList = el('ul', 'dim-list');
    rank.sorted.forEach(function (d) { dimList.appendChild(dimBar(d.name, d.score)); });
    overview.appendChild(dimList);
    overview.appendChild(el('div', 'disclaimer', Assess.DISCLAIMER + ' 测试时间：' + new Date(result.at).toLocaleString('zh-CN') +
      (result.flat ? '（注意：本次所有题目选了同一档，结果参考价值有限，建议重测）' : '')));
    host.appendChild(overview);

    /* 2. 维度强弱 */
    var strengthCard = el('div', 'card');
    strengthCard.appendChild(el('h2', null, '你的相对优势与短板'));
    if (rank.strongest.length) {
      strengthCard.appendChild(el('p', 'hint', '相对有底：' + rank.strongest.map(function (d) { return d.name + '（' + d.score + '）'; }).join('、')));
    }
    if (rank.weakest.length) {
      strengthCard.appendChild(el('p', 'hint', '更需要借力：' + rank.weakest.map(function (d) { return d.name + '（' + d.score + '）'; }).join('、')));
    }
    if (rank.weakest.length) {
      var tip = Assess.DIM_TIPS[rank.weakest[0].key];
      if (tip) strengthCard.appendChild(el('div', 'sos-hint', '针对最弱项「' + rank.weakest[0].name + '」，可以先做这一件事：' + tip));
    }
    host.appendChild(strengthCard);

    /* 3. 场景预测 */
    var predCardWrap = el('div', 'card');
    predCardWrap.appendChild(el('h2', null, '场景预测：你更擅长 / 更吃力的场景'));
    predCardWrap.appendChild(el('p', 'hint', '预测同时考虑这个场景的基准压力（来自访谈的紧张排序）和你的维度得分，数值越低越顺手。'));

    if (split.strengths.length) {
      var g1 = el('div', 'pred-group good');
      g1.appendChild(el('div', 'g-head', '较擅长（' + split.strengths.length + ' 个）'));
      split.strengths.forEach(function (p) { g1.appendChild(predCard(p)); });
      predCardWrap.appendChild(g1);
    }
    if (steady.length) {
      var g2 = el('div', 'pred-group');
      g2.appendChild(el('div', 'g-head', '一般（' + steady.length + ' 个）'));
      steady.forEach(function (p) { g2.appendChild(predCard(p)); });
      predCardWrap.appendChild(g2);
    }
    if (split.challenges.length) {
      var hard = split.challenges.filter(function (p) { return p.band === 'hard'; });
      var warnOnly = split.challenges.filter(function (p) { return p.band === 'challenge'; });
      if (warnOnly.length) {
        var g3 = el('div', 'pred-group warn');
        g3.appendChild(el('div', 'g-head', '偏吃力（' + warnOnly.length + ' 个）'));
        warnOnly.forEach(function (p) { g3.appendChild(predCard(p)); });
        predCardWrap.appendChild(g3);
      }
      if (hard.length) {
        var g4 = el('div', 'pred-group bad');
        g4.appendChild(el('div', 'g-head', '很吃力（' + hard.length + ' 个）'));
        hard.forEach(function (p) { g4.appendChild(predCard(p)); });
        predCardWrap.appendChild(g4);
      }
    } else if (!split.strengths.length && !steady.length) {
      predCardWrap.appendChild(el('p', 'hint', '本题库暂未覆盖你填写的场景。'));
    }
    host.appendChild(predCardWrap);

    /* 4. 下一步 */
    var next = el('div', 'card');
    next.appendChild(el('h2', null, '接下来怎么用这份画像'));
    var ul = el('ul');
    ul.appendChild(el('li', null, '「准备」里描述场景时，会带上这份画像的预测，偏吃力的场景先做 30 秒状态调整，顺手的场景直接给话术。'));
    ul.appendChild(el('li', null, '「应急」里已经用"画像推荐"标出最该先背的那一句。'));
    ul.appendChild(el('li', null, '「复盘」记满几次之后，能看出焦虑曲线和画像是否对得上。'));
    next.appendChild(ul);
    var row = el('div', 'row-between mt-10');
    var again = el('button', 'btn ghost small', '重新测试');
    again.addEventListener('click', function () { startQuiz(); });
    var goPrep = el('button', 'btn small', '去准备一个场景');
    goPrep.addEventListener('click', function () { switchTab('prep'); $('#input').focus(); });
    row.appendChild(again); row.appendChild(goPrep);
    next.appendChild(row);
    host.appendChild(next);
  }

  function renderAssessmentCard() {
    var tag = $('#assessTag');
    var box = $('#assessBox');
    if (!tag || !box) return;
    box.innerHTML = '';
    var a = profile.assessment;
    if (!a || !a.dimensions) {
      tag.textContent = '未测试';
      box.appendChild(el('p', 'hint', '还没有做过社交画像测试。40 道题、约 4 分钟，测完会预测你在哪些场景更顺手。'));
      var b = el('button', 'btn small', '去做测试');
      b.addEventListener('click', function () { switchTab('test'); renderTestPanel(); });
      box.appendChild(b);
      return;
    }
    tag.textContent = '已测试 · ' + new Date(a.at).toLocaleDateString('zh-CN');
    var rank = Assess.rankDimensions(a.dimensions);
    var preds = Assess.predictScenes(a.dimensions, E.SCENES);
    var split = Assess.splitScenes(preds);
    var radarBox = el('div', 'radar-box');
    radarBox.appendChild(radarSvg(a.dimensions));
    box.appendChild(radarBox);
    var ul = el('ul', 'dim-list');
    rank.sorted.forEach(function (d) { ul.appendChild(dimBar(d.name, d.score)); });
    box.appendChild(ul);
    if (rank.strongest.length) box.appendChild(el('p', 'hint', '相对有底：' + rank.strongest.map(function (d) { return d.name; }).join('、')));
    if (rank.weakest.length) box.appendChild(el('p', 'hint', '更需要借力：' + rank.weakest.map(function (d) { return d.name; }).join('、')));
    var good = split.strengths.slice(0, 4).map(function (p) { return p.name; });
    var bad = split.challenges.slice(0, 4).map(function (p) { return p.name; });
    if (good.length) box.appendChild(el('p', 'hint', '预测较擅长：' + good.join('、') + '（共 ' + split.strengths.length + ' 个）'));
    if (bad.length) box.appendChild(el('p', 'hint', '预测偏吃力：' + bad.join('、') + '（共 ' + split.challenges.length + ' 个）'));
    var row = el('div', 'row-between mt-10');
    var again = el('button', 'btn ghost small', '重新测试');
    again.addEventListener('click', function () { switchTab('test'); startQuiz(); });
    var detail = el('button', 'btn small', '看完整预测');
    detail.addEventListener('click', function () { switchTab('test'); renderTestPanel(); });
    row.appendChild(again); row.appendChild(detail);
    box.appendChild(row);
  }

  $('#testStart').addEventListener('click', function () { startQuiz(); });
  $('#testPrev').addEventListener('click', function () {
    if (quiz.page > 0) { quiz.page -= 1; renderQuizPage(); }
  });
  $('#testNext').addEventListener('click', function () {
    var pages = Math.ceil(Assess.ITEMS.length / QUIZ_PAGE_SIZE);
    if (quiz.page < pages - 1) { quiz.page += 1; renderQuizPage(); return; }
    submitQuiz();
  });

  /* ---------------- 语音输入 ---------------- */
  var voiceState = { session: null, button: null, field: null, base: '' };

  function voiceMode() {
    if (!Voice) return 'none';
    return Voice.pickMode(window, { serverAvailable: !!(cloud.user && cloud.asr) });
  }

  function showVoiceBar(text) {
    var bar = $('#voiceBar');
    if (!bar) return;
    if (!text) { bar.classList.add('hidden'); return; }
    $('#voiceBarText').textContent = text;
    bar.classList.remove('hidden');
  }
  function setVoiceButton(btn, active) { if (btn) btn.classList.toggle('rec', !!active); }

  function stopVoice() {
    if (voiceState.session) { voiceState.session.stop(); voiceState.session = null; }
    setVoiceButton(voiceState.button, false);
    showVoiceBar('');
  }

  function startVoice(fieldId, buttonId) {
    var field = $('#' + fieldId);
    var btn = $('#' + buttonId);
    if (!field || !btn) return;
    if (voiceState.session) { stopVoice(); return; }        // 再点一次＝停止

    var mode = voiceMode();
    if (mode === 'none') {
      if (!cloud.available) toast('本地文件模式不支持语音输入，把网站部署到服务器上即可使用');
      else if (!cloud.user && cloud.asr) toast('登录后就能用语音输入（服务器转写）；现在也可以直接手动输入');
      else if (!cloud.asr) toast('服务器未配置语音转写，当前浏览器也不支持语音识别，请手动输入');
      else toast('当前浏览器不支持语音输入，请手动输入');
      return;
    }

    voiceState.button = btn;
    voiceState.field = field;
    voiceState.base = field.value ? field.value.replace(/\s+$/, '') + ' ' : '';
    setVoiceButton(btn, true);
    showVoiceBar(mode === 'browser' ? '正在聆听…（说完会自动结束）' : '录音中…（说完点「停止」）');

    voiceState.session = Voice.createSession(window, {
      mode: mode,
      lang: 'zh-CN',
      onPartial: function (text) { field.value = voiceState.base + text; },
      onFinal: function (text) {
        if (text) field.value = voiceState.base + text;
        voiceState.session = null;
        setVoiceButton(btn, false);
        showVoiceBar('');
        if (text) toast('已填入语音内容，可以改一改再提交');
      },
      onError: function (code, message) {
        voiceState.session = null;
        setVoiceButton(btn, false);
        showVoiceBar('');
        var msg = message || '语音输入没能完成';
        // 浏览器内置识别常因网络不可用（国内尤甚）：如果服务器配了转写，引导用户登录后改走服务端
        if (code === 'network' && cloud.asr && !cloud.user) {
          msg += ' 登录后可以改用服务器转写。';
        }
        toast(msg);
      },
      onState: function (s) {
        if (s === 'transcribing') showVoiceBar('正在转成文字…');
        else if (s === 'idle') showVoiceBar('');
      },
      transcribe: function (b64, mime) {
        return apiJson('/api/transcribe', {
          method: 'POST',
          body: JSON.stringify({ audioBase64: b64, mime: mime })
        }).then(function (res) {
          if (!res.ok) {
            var err = new Error('transcribe failed');
            err.code = (res.data && res.data.code) || 'transcribe-failed';
            throw err;
          }
          return (res.data && res.data.text) || '';
        });
      }
    });
  }

  function renderVoiceButtons() {
    var native = Voice ? Voice.detect(window).browserSupported : false;
    var server = !!(cloud.asr);
    var usable = native || server;
    ['micInput', 'micAction', 'micNext'].forEach(function (id) {
      var btn = $('#' + id);
      if (!btn) return;
      btn.classList.toggle('hidden', !usable);
      btn.title = native ? '语音输入（浏览器识别）' : (usable ? '语音输入（服务器转写，需登录）' : '当前环境不支持语音输入');
    });
  }

  $('#micInput').addEventListener('click', function () { startVoice('input', 'micInput'); });
  $('#micAction').addEventListener('click', function () { startVoice('rvAction', 'micAction'); });
  $('#micNext').addEventListener('click', function () { startVoice('rvNext', 'micNext'); });
  $('#voiceStop').addEventListener('click', function () { stopVoice(); });

  /* ---------------- 成长档案 ---------------- */
  function renderMe() {
    var st = E.stats(profile);
    $('#tendencyTag').textContent = profile.tendency === 'i' ? '偏内向 i' : profile.tendency === 'e' ? '偏外向 e' : '未设置';

    var chipBox = $('#tendencyChips');
    chipBox.innerHTML = '';
    [{ v: 'i', t: '偏内向 i' }, { v: 'e', t: '偏外向 e' }, { v: null, t: '还不确定' }].forEach(function (o) {
      var c = el('button', 'chip' + (profile.tendency === o.v ? ' on' : ''), o.t);
      c.addEventListener('click', function () {
        profile.tendency = o.v;
        store(PROFILE_KEY, profile);
        renderMe();
        scheduleSync();
        toast(o.v === 'i' ? '之后会更强调"小步、低刺激"的准备' : o.v === 'e' ? '之后会更强调节奏与能量安排' : '已设为未设置');
      });
      chipBox.appendChild(c);
    });

    var grid = $('#statGrid');
    grid.innerHTML = '';
    var items = [
      { b: st.count, s: '复盘次数' },
      { b: st.avg === null ? '—' : st.avg, s: '平均焦虑（1-5）' },
      { b: st.strategies, s: '有效策略' },
      { b: st.trend === 'down' ? '↓ 变轻松' : st.trend === 'up' ? '↑ 更吃力' : '→ 平稳', s: '趋势' }
    ];
    items.forEach(function (it) {
      var d = el('div', 'stat');
      d.appendChild(el('b', null, String(it.b)));
      d.appendChild(el('span', null, it.s));
      grid.appendChild(d);
    });

    var chartBox = $('#chartBox');
    chartBox.innerHTML = '';
    if (!st.count) {
      chartBox.appendChild(el('div', 'chart-empty', '还没有复盘记录。去「复盘」记一次，这里就会长出曲线。'));
    } else {
      chartBox.appendChild(buildChart(st.series));
    }

    var sbox = $('#strategyBox');
    sbox.innerHTML = '';
    if (!profile.strategies || !profile.strategies.length) {
      sbox.appendChild(el('div', 'chart-empty', '还没有"有效"的记录。哪怕只有一条，也会出现在这里。'));
    } else {
      profile.strategies.slice(-6).reverse().forEach(function (s) {
        var d = el('div', 'strategy');
        d.appendChild(el('div', 's-scene', s.sceneName));
        d.appendChild(el('div', 's-action', s.action));
        sbox.appendChild(d);
      });
    }
    $('#modePill').textContent = cloud.llm ? '大模型模式' : '本地规则引擎';
    $('#modePill').className = 'mode-pill' + (cloud.llm ? ' live' : '');
    renderAssessmentCard();
    renderVoiceButtons();
    renderCloud();
  }

  function buildChart(series) {
    var W = 300, H = 100, padL = 22, padR = 8, padT = 10, padB = 18;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    var innerW = W - padL - padR, innerH = H - padT - padB;
    function x(i) { return series.length === 1 ? padL + innerW / 2 : padL + (innerW * i) / (series.length - 1); }
    function y(v) { return padT + innerH * (1 - (v - 1) / 4); }

    [1, 3, 5].forEach(function (v) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
      line.setAttribute('y1', y(v)); line.setAttribute('y2', y(v));
      line.setAttribute('stroke', '#e9ecf4'); line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
      var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', 2); t.setAttribute('y', y(v) + 3);
      t.setAttribute('font-size', '8'); t.setAttribute('fill', '#8b94a6');
      t.textContent = v;
      svg.appendChild(t);
    });

    var pts = series.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ');
    var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#4a7cf6');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('stroke-linecap', 'round');
    svg.appendChild(poly);

    series.forEach(function (v, i) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x(i)); c.setAttribute('cy', y(v)); c.setAttribute('r', '3');
      c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#4a7cf6'); c.setAttribute('stroke-width', '2');
      svg.appendChild(c);
    });
    return svg;
  }

  $('#exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ profile: profile, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'social-coach-profile.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('已导出到本机下载目录');
  });
  $('#clearBtn').addEventListener('click', function () {
    if (!confirm('清空本机保存的复盘记录与画像？此操作不可撤销。')) return;
    profile = E.createProfile();
    try { localStorage.removeItem(PROFILE_KEY); } catch (e) {}
    renderMe();
    toast('已清空本机数据');
  });

  /* ---------------- 云端同步交互 ---------------- */
  function authSubmit(path, okMsg) {
    var username = $('#cloudUser').value.trim();
    var password = $('#cloudPass').value;
    if (!username || !password) { toast('请填写昵称和密码'); return; }
    apiJson(path, { method: 'POST', body: JSON.stringify({ username: username, password: password }) })
      .then(function (res) {
        if (!res.ok) { toast(errText(res)); return; }
        cloud.user = res.data.user;
        cloud.revision = res.data.revision || 0;
        profile = E.mergeProfiles(profile, res.data.profile);
        store(PROFILE_KEY, profile);
        $('#cloudPass').value = '';
        renderMe();
        toast(okMsg);
        syncNow(false);
      })
      .catch(function () { toast('网络异常，请稍后再试'); });
  }
  $('#cloudForm').addEventListener('submit', function (e) {
    e.preventDefault();
    authSubmit('/api/auth/login', '已登录，正在同步');
  });
  $('#cloudRegister').addEventListener('click', function () {
    authSubmit('/api/auth/register', '注册成功，数据已归属你的账号');
  });
  $('#cloudLogout').addEventListener('click', function () {
    apiJson('/api/auth/logout', { method: 'POST' }).then(function () {
      cloud.user = null;
      cloud.revision = 0;
      cloud.lastSync = null;
      renderMe();
      toast('已退出登录，本机数据保留');
    }).catch(function () { toast('网络异常'); });
  });
  $('#cloudSyncBtn').addEventListener('click', function () { syncNow(true); });
  $('#cloudAuto').addEventListener('change', function () {
    cloud.autoSync = this.checked;
    store(CLOUD_KEY, { autoSync: cloud.autoSync });
    toast(cloud.autoSync ? '已开启自动同步' : '已关闭自动同步，之后手动同步');
  });
  $('#cloudChangePass').addEventListener('click', function () {
    apiJson('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: $('#cloudOldPass').value, newPassword: $('#cloudNewPass').value })
    }).then(function (res) {
      if (!res.ok) { toast(errText(res)); return; }
      $('#cloudOldPass').value = '';
      $('#cloudNewPass').value = '';
      toast('密码已更新，其他设备的登录已失效');
    }).catch(function () { toast('网络异常'); });
  });
  $('#cloudDelete').addEventListener('click', function () {
    if (!confirm('删除账号后，服务器上的画像与复盘会立即删除且无法恢复（本机数据保留）。确定继续吗？')) return;
    apiJson('/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ password: $('#cloudPass').value || $('#cloudOldPass').value })
    }).then(function (res) {
      if (!res.ok) { toast(errText(res)); return; }
      cloud.user = null;
      cloud.revision = 0;
      cloud.lastSync = null;
      renderMe();
      toast('账号与云端数据已删除，本机数据仍在');
    }).catch(function () { toast('网络异常'); });
  });

  $('#privacyChip').addEventListener('click', function () {
    switchTab('me');
    toast(cloud.user ? '本机数据 + 你自己账号下的云端副本' : '当前所有内容只保存在这台设备上');
  });

  /* ---------------- 初始化 ---------------- */
  function welcome() {
    var box = el('div', 'block');
    box.appendChild(el('div', 'b-title', '先说一句：紧张不是你的问题'));
    box.appendChild(el('div', 'line', '我是你的社交教练。告诉我待会儿要面对什么场景——几个人、熟不熟、要做什么，我用 30 秒给你状态调整和可以直接念出口的话。'));
    box.appendChild(el('div', 'soft-note', '如果要立刻用，直接点下方任意场景；现场撑不住就切到「应急」。所有内容只存在你的设备里。'));
    addMessage('assistant', box);
    addMessage('assistant', '比如："8 人聚餐，其中两个不太熟，我有点紧张"。');
  }
  renderSuggests();
  renderSosGrid();
  renderReviewStage();
  renderCloud();
  renderMe();
  renderVoiceButtons();
  welcome();
  bootstrapCloud();
  $('#input').focus();
})();
