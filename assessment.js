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

  var VERSION = 1;

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

    // 小范围寒暄
    { id: 's1', dim: 'smalltalk', reverse: false, text: '和不熟的同学一起吃饭，我能聊满一顿饭而不觉得尴尬。' },
    { id: 's2', dim: 'smalltalk', reverse: true, text: '一对一聊天时，我经常想不出下一个话题。' },
    { id: 's3', dim: 'smalltalk', reverse: false, text: '我会用现场可见的东西（菜、活动、教室）自然起话题。' },
    { id: 's4', dim: 'smalltalk', reverse: true, text: '和不太熟的人待在一起，安静几秒我会觉得很难熬。' },
    { id: 's5', dim: 'smalltalk', reverse: false, text: '和室友、邻居聊两句日常，对我来说很轻松。' },

    // 群体融入
    { id: 'g1', dim: 'group', reverse: false, text: '参加大多数人不认识的聚会时，我能主动认识一两个人。' },
    { id: 'g2', dim: 'group', reverse: true, text: '多人场合里，我常常全程只是听着。' },
    { id: 'g3', dim: 'group', reverse: false, text: '话题转到我完全不熟悉的领域时，我能问出让对方继续讲的问题。' },
    { id: 'g4', dim: 'group', reverse: true, text: '人多的场合我会尽量少说话，避免被注意到。' },
    { id: 'g5', dim: 'group', reverse: false, text: '我能在一个聚会里自然地从一组人换到另一组人。' },

    // 当众表达
    { id: 'p1', dim: 'publicspeaking', reverse: false, text: '需要在课堂上做展示时，我能把开场的三句话讲清楚。' },
    { id: 'p2', dim: 'publicspeaking', reverse: true, text: '被点名发言时，我的大脑会一片空白。' },
    { id: 'p3', dim: 'publicspeaking', reverse: false, text: '发言前我会先写下要点，而不是全靠临场组织语言。' },
    { id: 'p4', dim: 'publicspeaking', reverse: true, text: '在会议上想说点什么，我常常等到最后也没说出口。' },
    { id: 'p5', dim: 'publicspeaking', reverse: false, text: '自我介绍时，我能说出一件具体的事让别人记住我。' },

    // 权威沟通
    { id: 'a1', dim: 'authority', reverse: false, text: '遇到不懂的问题，我会主动去问老师或学长。' },
    { id: 'a2', dim: 'authority', reverse: true, text: '面对面试官或老师，我会紧张到说不出准备好的内容。' },
    { id: 'a3', dim: 'authority', reverse: false, text: '我能把请求说得简短明确：我是谁、要什么、需要对方做什么。' },
    { id: 'a4', dim: 'authority', reverse: true, text: '我觉得自己的问题太浅，不好意思去问。' },
    { id: 'a5', dim: 'authority', reverse: false, text: '面试中答不上来时，我能坦然承认并给出自己的思路。' },

    // 临场应变
    { id: 'm1', dim: 'improvising', reverse: false, text: '说话卡住时，我能用一句过渡话给自己争取时间。' },
    { id: 'm2', dim: 'improvising', reverse: true, text: '场面冷下来的时候，我不知道该怎么接。' },
    { id: 'm3', dim: 'improvising', reverse: false, text: '需要离开时，我能自然地找个理由从容退场。' },
    { id: 'm4', dim: 'improvising', reverse: true, text: '说错话之后，我会当场僵住、很难继续下去。' },
    { id: 'm5', dim: 'improvising', reverse: false, text: '话题不合适时，我能把它转到更轻松的方向。' },

    // 情绪恢复
    { id: 'r1', dim: 'recovery', reverse: false, text: '心跳加速、手心出汗时，我能在几分钟内平复下来。' },
    { id: 'r2', dim: 'recovery', reverse: true, text: '社交结束后，我会反复回放自己当时说过的话。' },
    { id: 'r3', dim: 'recovery', reverse: false, text: '紧张时我能用呼吸或自我对话让自己稳下来。' },
    { id: 'r4', dim: 'recovery', reverse: true, text: '一次不顺利的社交会影响我接下来一整天的心情。' },
    { id: 'r5', dim: 'recovery', reverse: false, text: '我能把"心跳快"理解成身体在准备，而不是我不行。' },

    // 社交续航
    { id: 't1', dim: 'stamina', reverse: false, text: '连续参加几场活动后，我知道该怎么给自己留恢复时间。' },
    { id: 't2', dim: 'stamina', reverse: true, text: '一整天的课加上晚间活动，会让我彻底不想说话。' },
    { id: 't3', dim: 'stamina', reverse: false, text: '我能拒绝不想参加的社交活动，而不太感到内疚。' },
    { id: 't4', dim: 'stamina', reverse: true, text: '社交之后我需要很长时间才能恢复精力。' },
    { id: 't5', dim: 'stamina', reverse: false, text: '我会提前安排社交和独处的时间比例。' }
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

  return {
    VERSION: VERSION,
    DIMENSIONS: DIMENSIONS,
    ITEMS: ITEMS,
    LIKERT: LIKERT,
    SCENE_WEIGHTS: SCENE_WEIGHTS,
    DIM_TIPS: DIM_TIPS,
    DIM_EMERGENCY: DIM_EMERGENCY,
    DISCLAIMER: DISCLAIMER,
    itemCount: function () { return ITEMS.length; },
    score: score,
    predictScene: predictScene,
    predictScenes: predictScenes,
    splitScenes: splitScenes,
    rankDimensions: rankDimensions,
    recommendEmergency: recommendEmergency,
    summarize: summarize,
    bandOf: bandOf
  };
});
