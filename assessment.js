/*!
 * assessment.js —— 「社交画像」自评量表 + 场景预测
 *
 * 设计依据：《新生社交体验访谈分析报告》中反复出现的真实表现——
 *   生理紧张（心跳、出汗）、认知卡壳（不知道说什么）、事后反刍、
 *   回避倾向、社交电量、角色切换（引领者/倾听者/参与者）。
 *
 * 结构：8 个维度 × 5 题 = 40 题（≤ 48），5 级自评，每个维度含 2 道反向计分题。
 * 产出：维度得分（0–100）→ 场景难度预测（1–5）→ 较擅长 / 一般 / 偏吃力的场景清单，
 *       并给出可直接执行的建议（与「准备」「应急」两个模块联动）。
 *
 * 必须诚实：这是**自评预测**，不是心理测评，也未做信度效度检验，不能用于诊断。
 * 与前两个文件一样，本文件不依赖 DOM，浏览器与 Node 均可运行，因此可被单元测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SocialAssessment = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 3;   // 3：题库 96 题（8 维 × 12），自适应 48–56

  /* ------------------------------------------------------------------ *
   * 一、八个维度
   * ------------------------------------------------------------------ */
  var DIMENSIONS = [
    { key: 'initiating', name: '破冰启动', desc: '向陌生人开口、求助、打第一个电话' },
    { key: 'smalltalk', name: '小范围寒暄', desc: '一对一或少数人之间把话接住' },
    { key: 'group', name: '群体融入', desc: '多人的陌生场合里参与而不隐形' },
    { key: 'publicspeaking', name: '当众表达', desc: '被注视时把话讲清楚' },
    { key: 'authority', name: '权威沟通', desc: '向老师、学长、面试官提出请求' },
    { key: 'improvising', name: '临场应变', desc: '卡壳、冷场、说错话时的自救' },
    { key: 'recovery', name: '情绪恢复', desc: '紧张反应后的平复速度与反刍程度' },
    { key: 'stamina', name: '社交续航', desc: '长时段社交后的电量管理与边界' }
  ];

  /* ------------------------------------------------------------------ *
   * 二、40 道题（reverse: true 表示反向计分）
   * ------------------------------------------------------------------ */
  var ITEMS = [
    // 破冰启动
    { id: 'i1', dim: 'initiating', reverse: false, text: '需要向陌生人开口（问路、问店员）时，我通常能自然地说出第一句。' },
    { id: 'i2', dim: 'initiating', reverse: true, text: '在群里或当面找一个不熟的人帮忙，我会拖很久才开口。' },
    { id: 'i3', dim: 'initiating', reverse: false, text: '需要给陌生机构打电话时，我会先写好要说的话再打。' },
    { id: 'i4', dim: 'initiating', reverse: true, text: '走进一个几乎都是陌生人的房间，我会先找个角落待着。' },
    { id: 'i5', dim: 'initiating', reverse: false, text: '我能在几秒内想出一句打破沉默的开场白。' },
    { id: 'i6', dim: 'initiating', reverse: false, text: '在食堂遇到不太熟的同学，我能自然地打个招呼。' },
    { id: 'i7', dim: 'initiating', reverse: true, text: '活动室还在等人时，我宁愿站在外面，也不先进去寒暄。' },
    { id: 'i8', dim: 'initiating', reverse: false, text: '需要加同学微信时，我能把「为什么加你」说得清楚。' },
    { id: 'i9', dim: 'initiating', reverse: false, text: '需要向邻座同学借一支笔，我能直接开口。' },
    { id: 'i10', dim: 'initiating', reverse: true, text: '群里需要有人去问老师一件事时，我会等别人先开口。' },
    { id: 'i11', dim: 'initiating', reverse: false, text: '在社团招新摊位前，我能主动问一句「你们平时做什么」。' },
    { id: 'i12', dim: 'initiating', reverse: false, text: '和刚认识的人分别时，我能自然地说「加个微信吧」。' },

    // 小范围寒暄
    { id: 's1', dim: 'smalltalk', reverse: false, text: '和不熟的同学一起吃饭，我能聊满一顿饭而不觉得尴尬。' },
    { id: 's2', dim: 'smalltalk', reverse: true, text: '一对一聊天时，我经常想不出下一个话题。' },
    { id: 's3', dim: 'smalltalk', reverse: false, text: '我会用现场可见的东西（菜、活动、教室）自然起话题。' },
    { id: 's4', dim: 'smalltalk', reverse: true, text: '和不太熟的人待在一起，安静几秒我会觉得很难熬。' },
    { id: 's5', dim: 'smalltalk', reverse: false, text: '和室友、邻居聊两句日常，对我来说很轻松。' },
    { id: 's6', dim: 'smalltalk', reverse: false, text: '在电梯里遇到同班同学，我能聊上一两句。' },
    { id: 's7', dim: 'smalltalk', reverse: true, text: '和同学两个人一起走路时，我常常一路无话。' },
    { id: 's8', dim: 'smalltalk', reverse: false, text: '对方说「最近好忙」时，我能顺着问出具体在忙什么。' },
    { id: 's9', dim: 'smalltalk', reverse: false, text: '在食堂和同学拼桌，我能从「今天这个菜还行」聊下去。' },
    { id: 's10', dim: 'smalltalk', reverse: true, text: '排队时遇到熟人，我会假装没看见或者低头看手机。' },
    { id: 's11', dim: 'smalltalk', reverse: false, text: '对方说了一件事，我能追问一个具体细节。' },
    { id: 's12', dim: 'smalltalk', reverse: false, text: '聊天出现三秒安静时，我能接上一句不尴尬的话。' },

    // 群体融入
    { id: 'g1', dim: 'group', reverse: false, text: '参加大多数人不认识的聚会时，我能主动认识一两个人。' },
    { id: 'g2', dim: 'group', reverse: true, text: '多人场合里，我常常全程只是听着。' },
    { id: 'g3', dim: 'group', reverse: false, text: '话题转到我完全不熟悉的领域时，我能问出让对方继续讲的问题。' },
    { id: 'g4', dim: 'group', reverse: true, text: '人多的场合我会尽量少说话，避免被注意到。' },
    { id: 'g5', dim: 'group', reverse: false, text: '我能在一个聚会里自然地从一组人换到另一组人。' },
    { id: 'g6', dim: 'group', reverse: false, text: '小组讨论里，我能把话头接过来，说清自己那部分。' },
    { id: 'g7', dim: 'group', reverse: true, text: '社团破冰游戏轮到我时，我更希望自己被跳过。' },
    { id: 'g8', dim: 'group', reverse: false, text: '饭桌上大家互相介绍时，我能记住一两个名字并再叫出来。' },
    { id: 'g9', dim: 'group', reverse: false, text: '班级群里有人说「有人一起吗」，我能第一个回「我去」。' },
    { id: 'g10', dim: 'group', reverse: true, text: '小组分工时，我宁可多做事，也不主动说自己想做什么。' },
    { id: 'g11', dim: 'group', reverse: false, text: '社团例会上，我能就一个议题说两句自己的想法。' },
    { id: 'g12', dim: 'group', reverse: false, text: '聚会里有人聊我不懂的话题，我能问一句「这个是怎么玩的」。' },

    // 当众表达
    { id: 'p1', dim: 'publicspeaking', reverse: false, text: '需要在课堂上做展示时，我能把开场的三句话讲清楚。' },
    { id: 'p2', dim: 'publicspeaking', reverse: true, text: '被点名发言时，我的大脑会一片空白。' },
    { id: 'p3', dim: 'publicspeaking', reverse: false, text: '发言前我会先写下要点，而不是全靠临场组织语言。' },
    { id: 'p4', dim: 'publicspeaking', reverse: true, text: '在会议上想说点什么，我常常等到最后也没说出口。' },
    { id: 'p5', dim: 'publicspeaking', reverse: false, text: '自我介绍时，我能说出一件具体的事让别人记住我。' },
    { id: 'p6', dim: 'publicspeaking', reverse: false, text: '上台前我会练站姿和开口的第一句，而不是把全文背下来。' },
    { id: 'p7', dim: 'publicspeaking', reverse: true, text: '在全班面前发言时，我会一直盯着稿子、不敢抬头。' },
    { id: 'p8', dim: 'publicspeaking', reverse: false, text: '展示结束被提问时，我能先说一句「这个问题我分两点讲」。' },
    { id: 'p9', dim: 'publicspeaking', reverse: false, text: '做课堂展示时，我能把时间控制在要求之内。' },
    { id: 'p10', dim: 'publicspeaking', reverse: true, text: '一想到要上台，我会提前几天开始睡不好。' },
    { id: 'p11', dim: 'publicspeaking', reverse: false, text: '讲到不熟的部分，我能先说「这块我查得不多，但我理解是……」。' },
    { id: 'p12', dim: 'publicspeaking', reverse: false, text: '被老师当堂点名回答，我能先复述问题再作答。' },

    // 权威沟通
    { id: 'a1', dim: 'authority', reverse: false, text: '遇到不懂的问题，我会主动去问老师或学长。' },
    { id: 'a2', dim: 'authority', reverse: true, text: '面对面试官或老师，我会紧张到说不出准备好的内容。' },
    { id: 'a3', dim: 'authority', reverse: false, text: '我能把请求说得简短明确：我是谁、要什么、需要对方做什么。' },
    { id: 'a4', dim: 'authority', reverse: true, text: '我觉得自己的问题太浅，不好意思去问。' },
    { id: 'a5', dim: 'authority', reverse: false, text: '面试中答不上来时，我能坦然承认并给出自己的思路。' },
    { id: 'a6', dim: 'authority', reverse: false, text: '给老师发邮件时，我能写清标题、事由和希望回复的时间。' },
    { id: 'a7', dim: 'authority', reverse: true, text: '学长学姐语气一严肃，我就会把想说的话咽回去。' },
    { id: 'a8', dim: 'authority', reverse: false, text: '面试最后我可以主动提问，比如问这个岗位日常做什么。' },
    { id: 'a9', dim: 'authority', reverse: false, text: '我能走进办公室，当面向老师请教一个问题。' },
    { id: 'a10', dim: 'authority', reverse: true, text: '老师语气一冷，我就会觉得是自己做错了什么。' },
    { id: 'a11', dim: 'authority', reverse: false, text: '需要请老师签字或写推荐时，我能把材料准备齐再开口。' },
    { id: 'a12', dim: 'authority', reverse: false, text: '和辅导员谈自己的困难时，我能说清具体需要什么帮助。' },

    // 临场应变
    { id: 'm1', dim: 'improvising', reverse: false, text: '说话卡住时，我能用一句过渡话给自己争取时间。' },
    { id: 'm2', dim: 'improvising', reverse: true, text: '场面冷下来的时候，我不知道该怎么接。' },
    { id: 'm3', dim: 'improvising', reverse: false, text: '需要离开时，我能自然地找个理由从容退场。' },
    { id: 'm4', dim: 'improvising', reverse: true, text: '说错话之后，我会当场僵住、很难继续下去。' },
    { id: 'm5', dim: 'improvising', reverse: false, text: '话题不合适时，我能把它转到更轻松的方向。' },
    { id: 'm6', dim: 'improvising', reverse: false, text: '被要求临时补充几句时，我能先讲自己记得住的部分。' },
    { id: 'm7', dim: 'improvising', reverse: true, text: '被问到一个没准备的问题，我会结巴到说不下去。' },
    { id: 'm8', dim: 'improvising', reverse: false, text: '发现自己讲错了，我能当场补一句改过来。' },
    { id: 'm9', dim: 'improvising', reverse: false, text: '临时被推上台说两句，我能先说「我准备得不多」再讲要点。' },
    { id: 'm10', dim: 'improvising', reverse: true, text: '别人开玩笑点到我时，我会脸红到说不出话。' },
    { id: 'm11', dim: 'improvising', reverse: false, text: '讨论跑题时，我能把话题拉回来。' },
    { id: 'm12', dim: 'improvising', reverse: false, text: '发现自己说错了人名，我能自然改口。' },

    // 情绪恢复
    { id: 'r1', dim: 'recovery', reverse: false, text: '心跳加速、手心出汗时，我能在几分钟内平复下来。' },
    { id: 'r2', dim: 'recovery', reverse: true, text: '社交结束后，我会反复回放自己当时说过的话。' },
    { id: 'r3', dim: 'recovery', reverse: false, text: '紧张时我能用呼吸或自我对话让自己稳下来。' },
    { id: 'r4', dim: 'recovery', reverse: true, text: '一次不顺利的社交会影响我接下来一整天的心情。' },
    { id: 'r5', dim: 'recovery', reverse: false, text: '我能把"心跳快"理解成身体在准备，而不是我不行。' },
    { id: 'r6', dim: 'recovery', reverse: false, text: '上台前心跳很快时，我知道等一分钟它会自己降下来。' },
    { id: 'r7', dim: 'recovery', reverse: true, text: '发出去的消息对方没回，我会反复点开对话框看。' },
    { id: 'r8', dim: 'recovery', reverse: false, text: '一次冷场之后，我能在当天把注意力放回别的事情上。' },
    { id: 'r9', dim: 'recovery', reverse: false, text: '一次发言没表现好，我第二天还能正常去上课。' },
    { id: 'r10', dim: 'recovery', reverse: true, text: '反复回想自己说过的蠢话，会占用我很多时间。' },
    { id: 'r11', dim: 'recovery', reverse: false, text: '紧张过后，我会做点别的事把注意力移开。' },
    { id: 'r12', dim: 'recovery', reverse: false, text: '被人指出问题，我能区分「这件事没做好」和「我这个人不行」。' },
    // 社交续航
    { id: 't1', dim: 'stamina', reverse: false, text: '连续参加几场活动后，我知道该怎么给自己留恢复时间。' },
    { id: 't2', dim: 'stamina', reverse: true, text: '一整天的课加上晚间活动，会让我彻底不想说话。' },
    { id: 't3', dim: 'stamina', reverse: false, text: '我能拒绝不想参加的社交活动，而不太感到内疚。' },
    { id: 't4', dim: 'stamina', reverse: true, text: '社交之后我需要很长时间才能恢复精力。' },
    { id: 't5', dim: 'stamina', reverse: false, text: '我会提前安排社交和独处的时间比例。' },
    { id: 't6', dim: 'stamina', reverse: false, text: '连着两天有活动，我会提前留出半天完全独处。' },
    { id: 't7', dim: 'stamina', reverse: true, text: '社交排得很密的那几周，我会失眠或者特别烦躁。' },
    { id: 't8', dim: 'stamina', reverse: false, text: '我大概清楚自己一周能承受几场社交。' },
    { id: 't9', dim: 'stamina', reverse: false, text: '我知道自己每周安排几场社交最合适。' },
    { id: 't10', dim: 'stamina', reverse: true, text: '连续几天有集体活动，我会开始找理由请假。' },
    { id: 't11', dim: 'stamina', reverse: false, text: '社交之后，我会给自己留一段不说话的时间。' },
    { id: 't12', dim: 'stamina', reverse: false, text: '我能判断今天还有没有余力再去一个聚会。' },
  ];

  var LIKERT = [
    { value: 1, label: '完全不符合' },
    { value: 2, label: '比较不符合' },
    { value: 3, label: '说不清' },
    { value: 4, label: '比较符合' },
    { value: 5, label: '完全符合' }
  ];

  /* ------------------------------------------------------------------ *
   * 三、场景 → 维度权重（场景 id 与 coach-engine.js 的 SCENES 对应）
   *     gap 越小说明相关维度越强，预测难度越低。
   * ------------------------------------------------------------------ */
  var SCENE_WEIGHTS = {
    'ask-directions': { initiating: 0.7, improvising: 0.3 },
    'eat-unfamiliar': { smalltalk: 0.8, stamina: 0.2 },
    'icebreaker': { smalltalk: 0.5, initiating: 0.3, stamina: 0.2 },
    'group-chat': { initiating: 0.5, improvising: 0.5 },
    'wechat-first': { initiating: 0.6, smalltalk: 0.2, improvising: 0.2 },
    'party-strangers': { group: 0.6, initiating: 0.4 },
    'self-intro': { publicspeaking: 0.7, group: 0.3 },
    'approach-teacher': { authority: 0.7, initiating: 0.3 },
    'phone-stranger': { initiating: 0.6, improvising: 0.4 },
    'club-interview': { authority: 0.5, publicspeaking: 0.3, improvising: 0.2 },
    'class-present': { publicspeaking: 0.6, recovery: 0.2, improvising: 0.2 },
    'meeting-speak': { publicspeaking: 0.7, recovery: 0.15, authority: 0.15 },
    'job-interview': { authority: 0.5, publicspeaking: 0.25, recovery: 0.25 }
  };

  /* 每个维度最实用的一条动作（用于场景建议） */
  var DIM_TIPS = {
    initiating: '把第一句写死再念一遍，例如"不好意思，打扰一下，请问……"',
    smalltalk: '准备三个可问的问题：课程、食堂、周末怎么过',
    group: '给自己设一个可达目标：认识 2 个人、各聊 3 分钟',
    publicspeaking: '把开场三句背下来，其余内容带要点卡片上台',
    authority: '带着"我已经查过××，卡在××"去问，提问本身就合格',
    improvising: '准备两句过渡话 + 一句离场话，提前放在兜里',
    recovery: '进门前做 3 次"吸 4 秒、停 2 秒、呼 6 秒"',
    stamina: '提前给这场活动定一个离场时间，中间留 10 分钟独处'
  };

  /* 维度偏弱时，推荐先看的「应急」入口（与 coach-engine.js 的 EMERGENCY id 对应） */
  var DIM_EMERGENCY = {
    initiating: 'nosay',
    smalltalk: 'nosay',
    group: 'cold',
    publicspeaking: 'called',
    authority: 'called',
    improvising: 'blank',
    recovery: 'panic',
    stamina: 'exit'
  };

  var BANDS = [
    { key: 'strength', max: 2.4, label: '较擅长', tone: 'good' },
    { key: 'steady', max: 3.5, label: '一般', tone: 'mid' },
    { key: 'challenge', max: 4.3, label: '偏吃力', tone: 'warn' },
    { key: 'hard', max: 5.0, label: '很吃力', tone: 'bad' }
  ];

  var DISCLAIMER = '这是一份自评预测，不是心理测评，也没有做过信度效度检验；它只用来说明"哪些场景可以先练"，不能用来给自己下结论。';

  function bandOf(difficulty) {
    for (var i = 0; i < BANDS.length; i++) if (difficulty <= BANDS[i].max) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }

  /* ------------------------------------------------------------------ *
   * 四、计分
   * ------------------------------------------------------------------ */
  function dimScore(dimKey, answers) {
    var items = ITEMS.filter(function (it) { return it.dim === dimKey; });
    var sum = 0, n = 0;
    items.forEach(function (it) {
      var raw = answers[it.id];
      if (typeof raw === 'number' && raw >= 1 && raw <= 5) {
        sum += it.reverse ? (6 - raw) : raw;
        n += 1;
      }
    });
    if (!n) return null;
    return Math.round(((sum - n) / (4 * n)) * 100);
  }

  /**
   * @param {Object} answers 形如 { i1: 4, i2: 2, ... }，取值 1–5
   * @returns {Object} 画像结果（可直接存进 profile.assessment）
   */
  function score(answers, options) {
    var opts = options || {};
    var a = answers || {};
    var dimensions = {};
    var answered = 0;
    DIMENSIONS.forEach(function (d) {
      dimensions[d.key] = dimScore(d.key, a);
    });
    ITEMS.forEach(function (it) {
      var v = a[it.id];
      if (typeof v === 'number' && v >= 1 && v <= 5) answered += 1;
    });

    var values = DIMENSIONS.map(function (d) { return dimensions[d.key]; }).filter(function (v) { return v !== null; });
    var readiness = values.length ? Math.round(values.reduce(function (x, y) { return x + y; }, 0) / values.length) : null;

    // 效度粗查：全部选同一档 → 结果不可靠
    var flat = false;
    if (answered >= ITEMS.length) {
      var first = a[ITEMS[0].id];
      flat = ITEMS.every(function (it) { return a[it.id] === first; });
    }

    // i/e 倾向只作为建议（群体融入 + 社交续航 + 破冰启动 的均值）
    var trio = ['group', 'stamina', 'initiating'].map(function (k) { return dimensions[k]; }).filter(function (v) { return v !== null; });
    var trioAvg = trio.length ? trio.reduce(function (x, y) { return x + y; }, 0) / trio.length : null;
    var tendencyHint = trioAvg === null ? null : (trioAvg >= 60 ? 'e' : (trioAvg <= 40 ? 'i' : null));

    var result = {
      version: VERSION,
      at: opts.at || new Date().toISOString(),
      answered: answered,
      total: ITEMS.length,
      dimensions: dimensions,
      readiness: readiness,
      tendencyHint: tendencyHint,
      flat: flat,
      scenes: opts.scenes ? predictScenes(dimensions, opts.scenes) : []
    };
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 五、场景难度预测
   *   预测 = 场景基准压力（访谈排序）+ 相关维度的缺口
   * ------------------------------------------------------------------ */
  function predictScene(dimensions, scene) {
    var dims = dimensions || {};
    var w = SCENE_WEIGHTS[scene.id];
    var gap;
    if (w) {
      var keys = Object.keys(w);
      var sum = 0;
      keys.forEach(function (k) {
        var scoreV = (typeof dims[k] === 'number') ? dims[k] : 50;   // 缺失维度按中性处理
        sum += w[k] * ((100 - scoreV) / 100);
      });
      gap = sum;
    } else {
      var vals = DIMENSIONS.map(function (d) { return dims[d.key]; }).filter(function (v) { return typeof v === 'number'; });
      var mean = vals.length ? vals.reduce(function (x, y) { return x + y; }, 0) / vals.length : 50;
      gap = (100 - mean) / 100;
    }

    var base = (Math.max(1, Math.min(5, scene.level)) - 1) / 4;   // 0–1
    var raw = 1 + 4 * (0.35 * base + 0.65 * gap);
    var difficulty = Math.round(Math.max(1, Math.min(5, raw)) * 10) / 10;
    var band = bandOf(difficulty);

    // 找出贡献最大的短板维度，作为"依据"
    var reasons = [];
    if (w) {
      Object.keys(w).map(function (k) {
        var scoreV = (typeof dims[k] === 'number') ? dims[k] : 50;
        return { key: k, weight: w[k], score: scoreV, impact: w[k] * ((100 - scoreV) / 100) };
      }).sort(function (x, y) { return y.impact - x.impact; }).forEach(function (r) {
        var meta = DIMENSIONS.filter(function (d) { return d.key === r.key; })[0];
        if (!meta) return;
        if (r.score < 50 && reasons.length < 2) reasons.push('『' + meta.name + '』偏弱（' + r.score + '/100）');
      });
    }
    reasons.push('场景基准压力 ' + scene.level + '/5');

    var weakest = null;
    if (w) {
      weakest = Object.keys(w).map(function (k) {
        return { key: k, score: (typeof dims[k] === 'number') ? dims[k] : 50 };
      }).sort(function (x, y) { return x.score - y.score; })[0].key;
    }

    return {
      id: scene.id,
      name: scene.name,
      level: scene.level,
      difficulty: difficulty,
      band: band.key,
      bandLabel: band.label,
      reasons: reasons,
      tip: weakest ? DIM_TIPS[weakest] : '先去「准备」里过一遍这个场景'
    };
  }

  function predictScenes(dimensions, scenes) {
    return (scenes || []).filter(function (s) { return s && SCENE_WEIGHTS[s.id]; })
      .map(function (s) { return predictScene(dimensions, s); })
      .sort(function (a, b) { return a.difficulty - b.difficulty; });
  }

  /** 从预测结果里挑出：较擅长的、偏吃力的 */
  function splitScenes(scenes) {
    var list = scenes || [];
    return {
      strengths: list.filter(function (s) { return s.band === 'strength'; }),
      challenges: list.filter(function (s) { return s.band === 'challenge' || s.band === 'hard'; })
    };
  }

  /** 维度排序：最强 / 最弱 */
  function rankDimensions(dimensions) {
    var arr = DIMENSIONS.map(function (d) {
      return { key: d.key, name: d.name, desc: d.desc, score: dimensions ? dimensions[d.key] : null };
    }).filter(function (d) { return typeof d.score === 'number'; });
    arr.sort(function (a, b) { return b.score - a.score; });
    return { sorted: arr, strongest: arr.slice(0, 2), weakest: arr.slice(-2).reverse() };
  }

  /** 根据画像推荐先看的「应急」入口 */
  function recommendEmergency(dimensions) {
    var r = rankDimensions(dimensions);
    if (!r.weakest.length) return null;
    return DIM_EMERGENCY[r.weakest[0].key] || null;
  }

  /** 把画像翻译成几句人话（温和、不说教） */
  function summarize(assessment) {
    if (!assessment || !assessment.readiness === null) return [];
    var r = rankDimensions(assessment.dimensions);
    var out = [];
    if (typeof assessment.readiness === 'number') {
      out.push('整体社交准备度 ' + assessment.readiness + '/100（自评，越高表示越有余力）。');
    }
    if (r.strongest.length) {
      out.push('相对有底的是「' + r.strongest.map(function (d) { return d.name; }).join('」「') + '」，这些地方可以直接用现成的办法。');
    }
    if (r.weakest.length) {
      out.push('更需要借力的是「' + r.weakest.map(function (d) { return d.name; }).join('」「') + '」，建议先把这几个场景的兜底话背下来。');
    }
    if (assessment.flat) {
      out.push('提示：这次所有题目选了同一档，结果可能不太能反映真实差异，可以隔几天重测一次。');
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 自适应选题（分层 / 序贯分配）
   *
   * 说明：这不是 CAT（计算机自适应测验）。CAT 需要每道题的难度与区分度参数，
   * 那得靠大样本校准；在没有校准之前做 CAT 等于假装精确。
   * 这里做的是「按维度缺口 + 作答不确定性来分配题目」：
   *   · 每块 4 题，先补齐最缺题、最拿不准的维度
   *   · 每维至少 3 题；总量 24–32 题（完整版仍是 40 题）
   *   · 某维已答均值落在中间带（2.4–3.6）时，优先挑一道反向计分题，防"一路点同意"
   * 全部是确定性规则，同一份作答序列每次结果一致，方便测试与复现。
   * ------------------------------------------------------------------ */
  var ADAPTIVE = {
    block: 4,          // 每屏几题
    minPerDim: 6,      // 每维至少几题（8 维 × 6 = 48，这是我们承诺的下限）
    maxPerDim: 7,      // 每维最多几题（模糊的维度可以多问一道）
    minTotal: 48,      // 最少总题数
    maxTotal: 56,      // 最多总题数
    midLow: 2.4,       // 中间带下界（用于挑反向题）
    midHigh: 3.6
  };

  function itemsOfDim(key) {
    return ITEMS.filter(function (it) { return it.dim === key; });
  }

  /** 作答统计：每维已答数量与均值（反向题已折算） */
  function dimStats(answers) {
    var a = answers || {};
    var out = {};
    DIMENSIONS.forEach(function (d) {
      var sum = 0, n = 0;
      itemsOfDim(d.key).forEach(function (it) {
        var v = a[it.id];
        if (typeof v === 'number' && v >= 1 && v <= 5) {
          sum += it.reverse ? (6 - v) : v;
          n += 1;
        }
      });
      out[d.key] = { n: n, mean: n ? sum / n : null };
    });
    return out;
  }

  /** 首块固定 12 题：8 维各一道正向题 + 4 道反向题（覆盖高压力维度） */
  function adaptiveStart() {
    var first = [];
    DIMENSIONS.forEach(function (d) {
      var normal = itemsOfDim(d.key).filter(function (it) { return !it.reverse; })[0];
      if (normal) first.push(normal.id);
    });
    ['publicspeaking', 'group', 'initiating', 'authority'].forEach(function (k) {
      var rev = itemsOfDim(k).filter(function (it) { return it.reverse; })[0];
      if (rev && first.indexOf(rev.id) < 0) first.push(rev.id);
    });
    return first.slice(0, 12);
  }

  /** 已经问过哪些题（含首块与后续块） */
  function answeredCount(answers) {
    return ITEMS.filter(function (it) {
      var v = (answers || {})[it.id];
      return typeof v === 'number' && v >= 1 && v <= 5;
    }).length;
  }

  /** 该不该停 */
  /** 该维均值是否仍卡在中间带（说明答案分辨不出高低，值得再问） */
  function isUnclear(stat) {
    return stat && stat.mean !== null &&
      stat.mean >= ADAPTIVE.midLow && stat.mean <= ADAPTIVE.midHigh &&
      stat.n < ADAPTIVE.maxPerDim;
  }

  function shouldStop(answers, asked) {
    var a = answers || {};
    var done = answeredCount(a);
    if (done >= ADAPTIVE.maxTotal) return true;
    var stats = dimStats(a);
    var allEnough = DIMENSIONS.every(function (d) { return stats[d.key].n >= ADAPTIVE.minPerDim; });
    if (allEnough && done >= ADAPTIVE.minTotal) {
      // 已经到 48 题：只有当还有维度「说不清」且没到上限时，才继续挖
      var unclear = DIMENSIONS.filter(function (d) { return isUnclear(stats[d.key]); });
      if (!unclear.length || done >= ADAPTIVE.maxTotal) return true;
    }
    // 题库里没有可问的了（理论上不会发生）
    var left = ITEMS.filter(function (it) { return !(typeof a[it.id] === 'number'); });
    return left.length === 0;
  }

  /**
   * 下一块题目 id（最多 ADAPTIVE.block 个）。
   * @returns {Array<string>} 空数组表示应该结束了
   */
  function adaptiveNext(answers, asked) {
    var a = answers || {};
    var used = {};
    (asked || []).forEach(function (id) { used[id] = true; });
    ITEMS.forEach(function (it) { if (typeof a[it.id] === 'number') used[it.id] = true; });
    if (shouldStop(a, asked)) return [];

    var stats = dimStats(a);
    var order = DIMENSIONS.map(function (d) {
      var st = stats[d.key];
      var need = Math.max(0, ADAPTIVE.minPerDim - st.n);
      var mean = st.mean === null ? 3 : st.mean;
      var middle = Math.abs(mean - 3);
      return { key: d.key, need: need, mean: mean, middle: middle,
               unclear: (need === 0 && isUnclear(st)) ? 1 : 0 };
    }).sort(function (x, y) {
      if (y.need !== x.need) return y.need - x.need;      // 1. 缺题的先补
      if (y.unclear !== x.unclear) return y.unclear - x.unclear;  // 2. 说不清的优先
      if (x.mean !== y.mean) return x.mean - y.mean;      // 3. 偏弱的先问
      return x.middle - y.middle;
    });

    var picked = [];
    var i = 0;
    var guard = 0;
    while (picked.length < ADAPTIVE.block && guard < 200) {
      guard += 1;
      var target = order[i % order.length];
      i += 1;
      var pool = itemsOfDim(target.key).filter(function (it) { return !used[it.id]; });
      if (!pool.length) continue;
      var inMiddle = target.mean >= ADAPTIVE.midLow && target.mean <= ADAPTIVE.midHigh;
      var preferReverse = inMiddle;
      var chosen = pool.filter(function (it) { return !!it.reverse === preferReverse; })[0] || pool[0];
      used[chosen.id] = true;
      picked.push(chosen.id);
      // 更新该维统计，便于下一块排序
      target.need = Math.max(0, target.need - 1);
      if (shouldStop(a, asked)) break;
    }
    return picked;
  }

  /** 进度信息（给 UI 用） */
  function adaptiveStatus(answers, asked) {
    var a = answers || {};
    var done = answeredCount(a);
    var stats = dimStats(a);
    var shortest = DIMENSIONS.map(function (d) { return stats[d.key].n; }).sort(function (x, y) { return x - y; })[0];
    var estimate = Math.max(done, Math.min(ADAPTIVE.maxTotal, ADAPTIVE.minTotal + (ADAPTIVE.minPerDim - shortest) * 2));
    return {
      answered: done,
      minTotal: ADAPTIVE.minTotal,
      maxTotal: ADAPTIVE.maxTotal,
      remainingEstimate: Math.max(0, estimate - done),
      perDim: stats
    };
  }

  /** 把画像压成一句给大模型看的摘要（不带分数细节，只讲人话） */
  function promptBrief(assessment) {
    if (!assessment || !assessment.dimensions) return '';
    var r = rankDimensions(assessment.dimensions);
    var parts = [];
    if (typeof assessment.readiness === 'number') {
      parts.push('自评准备度 ' + assessment.readiness + '/100');
    }
    if (r.weakest.length) {
      parts.push('更吃力的是「' + r.weakest.map(function (d) { return d.name; }).join('」「') + '」');
    }
    if (r.strongest.length) {
      parts.push('相对有底的是「' + r.strongest.map(function (d) { return d.name; }).join('」「') + '」');
    }
    if (assessment.flat) parts.push('这次作答全选同一档，参考价值有限');
    return parts.join('；');
  }

  return {
    VERSION: VERSION,
    DIMENSIONS: DIMENSIONS,
    ITEMS: ITEMS,
    LIKERT: LIKERT,
    SCENE_WEIGHTS: SCENE_WEIGHTS,
    DIM_TIPS: DIM_TIPS,
    DIM_EMERGENCY: DIM_EMERGENCY,
    DISCLAIMER: DISCLAIMER,
    ADAPTIVE: ADAPTIVE,
    itemCount: function () { return ITEMS.length; },
    score: score,
    predictScene: predictScene,
    predictScenes: predictScenes,
    splitScenes: splitScenes,
    rankDimensions: rankDimensions,
    recommendEmergency: recommendEmergency,
    summarize: summarize,
    bandOf: bandOf,
    adaptiveStart: adaptiveStart,
    adaptiveNext: adaptiveNext,
    adaptiveStatus: adaptiveStatus,
    shouldStop: shouldStop,
    dimStats: dimStats,
    promptBrief: promptBrief
  };
});
