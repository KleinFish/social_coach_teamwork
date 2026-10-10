/*!
 * coach-engine.js —— 「社交教练」原型·规则引擎层
 * 对应《新生社交体验访谈分析报告》四、(四) 技术实现路径：
 *   「建议采用大语言模型与规则引擎的混合架构。大语言模型负责自然语言理解与对话生成，
 *     规则引擎负责基于用户画像和场景标签的个性化建议匹配，确保建议的针对性和安全性。」
 *
 * 本文件是其中的【规则引擎】：场景知识库 + 压力分级 + 情绪识别 + 话术模板 + 安全兜底 + 用户画像。
 * 它不依赖 DOM，可在浏览器与 Node 中同时运行，因此可被单元测试。
 * 真正的 LLM 调用见 app.js 中的 LLMAdapter（默认演示模式走本地引擎，配置 API Key 后自动切换）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoachEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 一、场景知识库
   * 压力基准来自访谈结论：向店员问路 < 与不太熟的人吃饭 < 参加多数人陌生的聚会
   *                     < 在会议上发言 < 面试
   * 每个场景给出：压力源、认知重构（30 秒）、可直接念的话术、兜底离场、3 分钟准备清单
   * ------------------------------------------------------------------ */
  var SCENES = [
    {
      id: 'ask-directions', name: '向店员问路', level: 1,
      aliases: ['问路', '店员', '找不到', '导航', '问一下路', '问个人'],
      stressor: '要主动打断一个陌生人的手头事',
      reframe: [
        '这件事只占用对方十几秒，对方答不上来也完全不会评价你。',
        '这不是社交表现，是一次信息交换：你要的是方向，不是印象分。'
      ],
      scripts: {
        open: ['不好意思，打扰一下，请问××怎么走？', '你好，我导航有点飘，想跟你确认一下方向。'],
        sustain: ['那我朝这边走，对吗？', '大概要走几分钟？'],
        exit: ['好，谢谢您！']
      },
      checklist: ['先把要问的那句话在心里念一遍', '挑一个对方手上没活儿的时候走过去', '问完立刻道谢离开，不用补话']
    },
    {
      id: 'eat-unfamiliar', name: '与不太熟的人吃饭', level: 2,
      aliases: ['吃饭', '聚餐', '一起吃饭', '食堂', '饭局', '不太熟', '约饭', '同桌'],
      stressor: '长时间面对面，冷场时容易觉得"该我说话了"',
      reframe: [
        '吃饭场景里大部分时间都在低头吃，冷场几秒是常态，不是你的失职。',
        '两个人吃饭不需要全程有话题，安静地吃也是被允许的。'
      ],
      scripts: {
        open: ['这个菜看着不错，你常点吗？', '你平时在这个食堂吃得多吗？'],
        sustain: ['你也是××学院的？大一哪个班？', '你周末一般怎么过？', '最近有什么活动值得去吗？'],
        shift: ['说到这个，我前两天听说……', '对了，你怎么看××？'],
        exit: ['我先去加个饭／下午还有课，先走啦，回头见。']
      },
      checklist: ['准备三个可提的问题：课、食堂、周末', '选一个靠边或靠墙的位置', '给自己定一个离场时间']
    },
    {
      id: 'icebreaker', name: '宿舍/新同学破冰', level: 2,
      aliases: ['室友', '宿舍', '新同学', '同班同学', '隔壁宿舍', '认识一下'],
      stressor: '要在没有共同话题的前提下开启长期共处关系',
      reframe: [
        '室友关系不是一次谈成的，是一学期里慢慢长出来的。',
        '今天只需要交换一个信息，比如"你几点睡"。'
      ],
      scripts: {
        open: ['你一般几点睡？我怕我晚上吵到你。', '你是哪儿的呀？来了之后还习惯吗？'],
        sustain: ['食堂你踩过雷吗，我踩了两个了。', '你平时打球吗？'],
        exit: ['那我先收拾东西啦。']
      },
      checklist: ['想一个和自己有关的小事当素材', '从"实用信息"入手（作息、宿舍规则）', '不用一次聊很久，先打个照面']
    },
    {
      id: 'group-chat', name: '群聊求助/线上沟通', level: 2,
      aliases: ['群聊', '微信群', '群消息', '通知', '线上', '私聊', '发消息'],
      stressor: '不确定该找谁、怕打扰别人、等待回复时焦虑',
      reframe: [
        '线上没有实时反馈是常态，回复慢不等于对方对你有意见。',
        '一条信息同时发给负责人和群里，比反复纠结要不要发更省力。'
      ],
      scripts: {
        open: ['学长/老师您好，我是××学院大一的新生××，想问一下××，不知道方不方便？',
               '打扰一下，群里有没有同学知道××的情况？谢谢！'],
        sustain: ['我理解您可能比较忙，方便的时候回我就好。'],
        exit: ['好的，谢谢您，我去问问其他人～']
      },
      checklist: ['把问题写成一句话，别攒成一长段', '发完把手机放下 20 分钟再回来看', '重要的事加一句"不急，方便时回"']
    },
    {
      id: 'wechat-first', name: '线上加了好友，第一句怎么发', level: 2,
      aliases: ['加了微信', '加微信', '微信上', '微信', '好友', '第一句', '第一句话', '打招呼', '怎么开口', '开场白', '刚加'],
      stressor: '对方看不到你的表情、可能不回、担心第一句就说错',
      reframe: [
        '第一句的目标不是"聊起来"，而是"给对方一个好回复的落点"。',
        '线上没有实时反馈是常态，没秒回不等于对方不想理你。'
      ],
      scripts: {
        open: ['你好呀，我是××班的××，刚在群里看到你也在××，就加一下～',
               '嗨，我是××，加个好友。你也是这学期才来××的吧？',
               '你好！我是××，上次××活动上见过你，没来得及打招呼，加个好友～'],
        sustain: ['你是什么时候开始关注××的呀？', '说起来，你这学期选了什么课？'],
        shift: ['对了，你平时除了上课都干嘛？', '话说，你也是住校内吗？'],
        exit: ['那我先去上课啦，回头聊～', '不打扰你啦，回头有空聊～']
      },
      checklist: ['第一句 = 自我介绍 + 一个由头（怎么认识的、有什么共同点）', '把问题放在末尾，让对方"一句话就能回"', '发完就把手机放下 20 分钟，别盯着"对方正在输入"']
    },
    {
      id: 'party-strangers', name: '参加多数人陌生的聚会', level: 3,
      aliases: ['聚会', 'party', '团建', '大家都不认识', '都不熟', '都是陌生人', '陌生聚会', '联谊'],
      stressor: '观众多、话题不受自己控制、随时可能被要求说话',
      reframe: [
        '聚会的默认规则是流动的，没人会盯着你是不是一直有话讲。',
        '你不需要融入全场，只需要在这个房间里认识一两个人。'
      ],
      scripts: {
        open: ['你好，我是××学院的××，你也是被朋友拉来的吗？', '你认识××吗？我是跟着他来的。'],
        sustain: ['你是怎么认识××的？', '你平时喜欢玩什么？'],
        shift: ['你们刚聊的这个我挺好奇，能再多说点吗？'],
        exit: ['我去接杯水，等下回来。', '我去找一下朋友，你们先聊。']
      },
      checklist: ['设一个可达目标：认识 2 个人、各聊 3 分钟', '提前想好 2 个开放问题', '给自己留一个可以自然离场的理由']
    },
    {
      id: 'self-intro', name: '自我介绍', level: 3,
      aliases: ['自我介绍', '介绍自己', '一两分钟', '上台介绍', '起立介绍'],
      stressor: '要在短时间、被注视的情况下定义自己',
      reframe: [
        '自我介绍不是表演，是发一张名片：别人记住一个具体细节就够了。',
        '不要求全面，只要求具体——具体比精彩更好用。'
      ],
      scripts: {
        open: [
          '结构：名字 + 一个小标签 + 一件具体的事 + 一个邀请。',
          '例：大家好，我是××，来自××。我有个不太像大学生的爱好——收集校园里猫的照片。谁要是发现了新的猫，欢迎告诉我。'
        ],
        sustain: ['如果你也喜欢××，我们可以一起。'],
        exit: ['我就先说这些，谢谢大家。']
      },
      checklist: ['写下四行结构填空，不背完整稿', '准备一件"具体的小事"当代替形容词', '结尾放一句邀请，把话头递给别人']
    },
    {
      id: 'approach-teacher', name: '向老师/学长请教', level: 3,
      aliases: ['老师', '教授', '学长', '学姐', '请教', '答疑', '办公室'],
      stressor: '对方是权威，担心问题太浅、占用对方时间',
      reframe: [
        '老师更常抱怨的是没人来问，而不是问题太浅。',
        '带着"我已经查过××，卡在××"去问，本身就是合格的提问。'
      ],
      scripts: {
        open: ['老师您好，我是××课上的××。我查了××，但卡在××，想请教一下方向。',
               '学长你好，打扰一下，关于××，你当时是怎么处理的？'],
        sustain: ['那我先按这个思路试，如果还不行再来问您。'],
        exit: ['明白了，谢谢老师！']
      },
      checklist: ['先把问题写成一句话', '准备好"我已经试过什么"', '约在对方方便的时间/邮件里先约']
    },
    {
      id: 'phone-stranger', name: '给陌生人打电话', level: 3,
      aliases: ['打电话', '电话', '语音通话', '联系客服', '陌生电话'],
      stressor: '没有画面线索、无法中途离场、对方随时可能打断',
      reframe: [
        '打电话只要一句开场白就够了，剩下的靠对方接话。',
        '你可以先写好三行稿子念，没有人知道你念了。'
      ],
      scripts: {
        open: ['您好，我是××，之前在××上和您联系过，想跟您确认一下××。'],
        sustain: ['我记一下，您说的是××，对吗？'],
        exit: ['好的，那我先这样，谢谢您，再见。']
      },
      checklist: ['先写三行稿：我是谁 / 要什么 / 需要对方做什么', '找个安静的地方，站着打', '准备好纸笔记录']
    },
    {
      id: 'club-interview', name: '社团/学生会面试', level: 4,
      aliases: ['社团面试', '学生会', '招新', '部门面试', '群面'],
      stressor: '被多个人同时评估，需要临场自我展示',
      reframe: [
        '面试官想确认的是"能不能一起干活"，不是"你够不够优秀"。',
        '答不上来时承认并给一个思路，比硬编更可信。'
      ],
      scripts: {
        open: ['面试官好，我是××，来自××。我想做的是××，之前做过××。'],
        sustain: ['这个问题我没准备过，我的第一反应是××，可能不成熟，想听听你们的看法。'],
        exit: ['我的情况就是这些，谢谢各位。']
      },
      checklist: ['准备 3 个具体经历：做过什么、结果如何', '准备一个"我不会"的诚实答法', '准备好问对方一个问题']
    },
    {
      id: 'class-present', name: '课堂展示/报告', level: 4,
      aliases: ['课堂展示', 'pre', 'prez', '展示', '汇报', 'ppt', '答辩'],
      stressor: '观众规模大、内容被逐句审视、容错空间小',
      reframe: [
        '台下的人是在听内容，不会逐帧检查你的表情。',
        '把注意力放在"下一句话"上，比放在"我看起来怎样"更省力。'
      ],
      scripts: {
        open: ['老师、同学们好，我这次分享的是××，分三部分：××、××、××。'],
        sustain: ['这一页想说明的是××，如果大家想看细节，我最后留了附录。',
                  '这里我卡过很久，后来发现关键是××。'],
        exit: ['我的部分到这里，谢谢大家，有什么问题我来答。']
      },
      checklist: ['把开场三句写死，背下来', '在每页标注一个"必须说到的点"', '准备一个缓冲句："我喝口水，接着讲××"']
    },
    {
      id: 'meeting-speak', name: '在会议上发言', level: 4,
      aliases: ['会议', '发言', '组会', '讨论', '例会', '发言环节'],
      stressor: '所有人都看着你，说错难以收回',
      reframe: [
        '会议发言的合格标准很低：把一个问题或一个观察说清楚就够。',
        '先说结论再说理由，别人反而更容易接住你的话。'
      ],
      scripts: {
        open: ['我提一个点：关于××，我担心的是××。', '我想补充一个信息，可能和大家刚才说的有关。'],
        sustain: ['我的理解是××，不知道对不对？', '如果按这个方向走，第一步可以先××。'],
        exit: ['我先说这些，具体细节可以会后再对。']
      },
      checklist: ['准备一句结论句 + 一个理由', '把想说的写成三行，不写成一段', '想好"没有意见时也可以说的观察句"']
    },
    {
      id: 'job-interview', name: '求职面试', level: 5,
      aliases: ['求职', '找工作', '应聘', '面试', '实习面试', '校招', 'hr', '终面'],
      stressor: '结果导向、被持续评估、几乎无容错空间',
      reframe: [
        '面试是双向筛选，你也在看他们把不把你当人看。',
        '紧张不会让你失分，装作不紧张才会。'
      ],
      scripts: {
        open: ['面试官好，我是××，来自××，我主要做××方向。'],
        sustain: ['我讲一下背景、我的做法和结果：……', '这一点我当时没想清楚，后来复盘发现应该××。'],
        exit: ['我的情况先介绍到这里，谢谢您的时间。']
      },
      checklist: ['准备自我介绍 60 秒版本', '准备 3 个故事：困难、协作、失败', '准备好反问面试官的两个问题']
    }
  ];

  /* ------------------------------------------------------------------ *
   * 二、情绪识别（对应报告：引入情绪识别模块，动态调整回复策略）
   * ------------------------------------------------------------------ */
  var EMOTION_PATTERNS = [
    { key: 'physical', label: '身体先紧张了', words: ['心跳', '手心出汗', '出汗', '手抖', '发抖', '脸红', '脸热', '声音抖', '表情僵硬', '胃疼', '头晕', '呼吸急', '胸口', '腿软'] },
    { key: 'cognitive', label: '卡在"不知道说什么"', words: ['大脑空白', '一片空白', '不知道说什么', '没话说', '词穷', '卡壳', '接不上', '忘词', '想不到'] },
    { key: 'rumination', label: '事后反刍', words: ['反刍', '反复回放', '反复想', '自责', '后悔', '睡前想', '睡不着', '是不是说错'] },
    { key: 'avoidance', label: '想回避', words: ['不想去', '想逃', '装病', '请假', '迟到', '拖延', '放鸽子', '不敢去'] },
    { key: 'depletion', label: '社交电量见底', words: ['太累', '疲惫', '没精力', '耗竭', '不想说话', '社交累', '电量'] },
    { key: 'eagerness', label: '期待但有点上头', words: ['兴奋', '期待', '跃跃欲试', '有点激动'] }
  ];
  var INTENSIFIERS = ['很', '特别', '非常', '极其', '超级', '一直', '完全', '整个人'];

  // 安全兜底：出现危机信号时不走话术流程（对应报告"确保建议的针对性和安全性"）
  var CRISIS_WORDS = ['自杀', '不想活', '活着没意思', '结束生命', '自残', '伤害自己', '撑不下去', '活着好累'];
  var CRISIS_BLOCK = {
    type: 'safety',
    title: '先停一下，这件事比社交更重要',
    text: '你刚才说的不是"社交紧张"能概括的事。请现在联系你信任的人，或者联系学校心理健康中心/医院心理科；如果当下有危险，请立刻告诉身边的人并拨打当地紧急电话。这个原型能做的只有陪你练话术，做不到替代专业帮助。'
  };

  /* ------------------------------------------------------------------ *
   * 三、通用工具函数
   * ------------------------------------------------------------------ */
  function norm(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, '');
  }
  function hitCount(hay, words) {
    var n = 0;
    for (var i = 0; i < words.length; i++) if (hay.indexOf(norm(words[i])) >= 0) n++;
    return n;
  }
  // 温和引导（对应报告交互原则 4：不说"你应该"，改用"要不要试试""很多人在这类场景中会…"）
  var SOFTEN_RULES = [
    [/你应该/g, '要不要试试'],
    [/你必须/g, '可以'],
    [/你得/g, '你可以'],
    [/建议你/g, '要不要'],
    [/不要再/g, '可以先不'],
    [/你要/g, '你可以']
  ];
  function soften(text) {
    var out = String(text);
    for (var i = 0; i < SOFTEN_RULES.length; i++) out = out.replace(SOFTEN_RULES[i][0], SOFTEN_RULES[i][1]);
    return out;
  }
  function pick(list, seed) {
    if (!list || !list.length) return '';
    var i = ((seed || 0) % list.length + list.length) % list.length;
    return list[i];
  }

  /* ------------------------------------------------------------------ *
   * 四、场景识别与压力分级
   * ------------------------------------------------------------------ */
  function detectScenes(text, limit) {
    var hay = norm(text);
    var scored = [];
    for (var i = 0; i < SCENES.length; i++) {
      var s = SCENES[i], score = 0;
      /* 按**命中词的长度**加权，而不是命中个数：
         "社团面试"（4 字）应当压过泛化的"面试"（2 字）。
         早期版本用"+2 名称命中"，导致凡是提到"面试"都被判成"面试"场景。 */
      for (var j = 0; j < s.aliases.length; j++) {
        var a = norm(s.aliases[j]);
        if (a && hay.indexOf(a) >= 0) score += a.length;
      }
      var nm = norm(s.name);
      if (nm && hay.indexOf(nm) >= 0) score += nm.length;
      if (score > 0) scored.push({ scene: s, score: score });
    }
    scored.sort(function (a, b) { return b.score - a.score || a.scene.level - b.scene.level; });
    return scored.slice(0, limit || 3);
  }
  function getScene(id) {
    for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return SCENES[i];
    return null;
  }
  var LEVEL_LABELS = ['', '轻松', '微紧张', '明显紧张', '高度紧张', '极强压力'];

  // 压力分级：场景基准 + 访谈中提炼的三个驱动因素（观众规模 / 自我展示要求 / 容错空间）
  function estimatePressure(sceneId, text, profile) {
    var scene = getScene(sceneId);
    var hay = norm(text);
    var level = scene ? scene.level : 3;
    var factors = [];
    if (scene) factors.push({ key: 'base', text: '场景基准：' + scene.name + '（' + scene.level + '/5）' });

    var m = hay.match(/(\d+)\s*(人|位|个)/);
    if (m && parseInt(m[1], 10) >= 8) { level += 1; factors.push({ key: 'audience', text: '观众规模：约 ' + m[1] + ' 人，人越多越紧张' }); }
    if (/陌生人|不熟|不认识|没见过|都不认识/.test(hay)) { level += 1; factors.push({ key: 'stranger', text: '陌生度高：缺少可依赖的熟悉面孔' }); }
    if (/当众|发言|上台|演讲|展示|点名|被问|汇报/.test(hay)) { level += 1; factors.push({ key: 'display', text: '自我展示要求高：会被持续看着' }); }
    if (/第一次|从来没|没有经验|第一次参加/.test(hay)) { factors.push({ key: 'first', text: '零经验场景：没有可复用的脚本' }); }
    if (/熟人|好朋友|室友|同学一起|有朋友|跟着朋友|有伴/.test(hay)) { level -= 1; factors.push({ key: 'familiar', text: '有熟人同行：可以用来回血和救场' }); }
    if (/面试|答辩|终面/.test(hay)) { factors.push({ key: 'tolerance', text: '容错空间小：结果导向，说错难以补回' }); }

    if (hay.length > 60) { factors.push({ key: 'detail', text: '描述很具体：说明你已经想过好几遍了' }); }
    level = Math.max(1, Math.min(5, level));

    var tendencyNote = '';
    var t = profile && profile.tendency;
    if (t === 'i') tendencyNote = '你的画像偏内向，同等场景下你的消耗本来就比外向的人大，这是设定，不是缺陷。';
    else if (t === 'e') tendencyNote = '你的画像偏外向，这类场景通常能给你补充能量；如果最近明显吃力，更可能是近期学业负荷的问题。';

    return { level: level, label: LEVEL_LABELS[level], factors: factors, tendencyNote: tendencyNote };
  }

  function detectEmotions(text) {
    var hay = norm(text);
    var labels = [];
    for (var i = 0; i < EMOTION_PATTERNS.length; i++) {
      var p = EMOTION_PATTERNS[i];
      if (hitCount(hay, p.words) > 0) labels.push({ key: p.key, label: p.label });
    }
    var intensity = labels.length;
    for (var j = 0; j < INTENSIFIERS.length; j++) if (hay.indexOf(norm(INTENSIFIERS[j])) >= 0) intensity += 1;
    if (hay.length > 80) intensity += 1;
    return { labels: labels, intensity: Math.min(5, intensity) };
  }

  /* ------------------------------------------------------------------ *
   * 元问题识别：本地规则引擎只会按社交场景给建议。
   * 如果用户问的是产品本身（"接大模型了吗""收费吗""怎么用"），
   * 必须老实说自己答不好，而不是硬凑一个"最接近的场景"。
   * ------------------------------------------------------------------ */
  var META_STRONG = ['大模型', '接入', 'api', '密钥', '收费', '付费', '隐私', '数据安全', '前端', '后端',
    '代码', '部署', '服务器', '离线', '你们', '这个产品', '这个工具', '为什么', '原理', '好用',
    '怎么用', '怎么玩', '准确率', '智能', '答非所问', '胡说'];
  var META_WEAK = ['是不是', '能不能', '支持吗', '有吗', '会吗', '吗', '呢', '对吧'];

  /**
   * 判断是不是"产品/元问题"。只在**没有任何场景命中**时调用，
   * 所以这里可以放宽：没有场景 + 是个问句 → 就老实说答不好，而不是硬猜场景。
   */
  function looksLikeMeta(raw) {
    var s = String(raw == null ? '' : raw);
    var hay = norm(s);
    for (var i = 0; i < META_STRONG.length; i++) {
      if (hay.indexOf(norm(META_STRONG[i])) >= 0) return true;
    }
    var weak = 0;
    for (var j = 0; j < META_WEAK.length; j++) {
      if (hay.indexOf(norm(META_WEAK[j])) >= 0) weak += 1;
    }
    if (weak >= 2) return true;
    var isQuestion = /[?？]/.test(s) || /(吗|呢|对吧|了没|了吗)\s*$/.test(s.trim());
    return isQuestion;
  }

  /** 判断是不是"你怎么判断的"这类**针对我上一次分类**的追问 */
  function isWhyQuestion(raw) {
    var s = norm(raw);
    if (/依据|根据什么|怎么判断|凭什么/.test(s)) return true;
    return /(为什么|怎么|凭什么).{0,8}(觉得|认为|判断|猜|算|是这|说我)/.test(s);
  }

  /**
   * 回答"为什么你觉得这是××场景"：老实交代是关键词匹配，
   * 而不是像原来那样回一句"听不懂产品问题"（那对用户毫无帮助）。
   */
  function whyBlocks(last) {
    var name = (last && last.name) || '某个场景';
    var kws = (last && last.keywords) || [];
    var hit = kws.length ? '「' + kws.slice(0, 4).join('」「') + '」' : '我库里的词';
    return [
      {
        type: 'empathy',
        text: '我不是真的"听懂"了，是按关键词匹配的：你上一条里出现了 ' + hit + '，对应我场景库里的「' + name + '」，所以给了那个场景的模板。'
      },
      {
        type: 'checklist',
        title: '猜错了直接告诉我',
        items: [
          '换一种更具体的说法，例如「线上刚加了好友，第一句怎么发」「和室友第一次同住」',
          '或者直接纠正我：「不是宿舍，是××」，我就按新场景重来'
        ],
        hint: '（我只认关键词，所以偶尔会猜偏。想让这里真正"听懂"，需要在服务器配置大模型 LLM_API_KEY。）'
      }
    ];
  }

  function metaBlocks() {
    return [
      {
        type: 'empathy',
        text: '说实话，这个问题我答不好——我目前跑的是本地规则引擎（没有接入大模型），只会按社交场景给建议，听不懂产品问题。'
      },
      {
        type: 'checklist',
        title: '我能帮上的部分',
        items: [
          '想练某个具体场景，直接说类似「明天上午面试」「8 人聚餐，其中两个不太熟」',
          '已经结束了想整理，去「复盘」页记一条',
          '现在正卡住，切到「应急」点一个按钮，会给你一句能直接念的话'
        ],
        hint: '（如果希望用大模型来聊，部署时在服务器配置 LLM_API_KEY，配置后这类问题就交给大模型回答。）'
      }
    ];
  }


  /* 每个场景的"第一句话"：用户反馈"所有场景都回同一句，太刻板"，
     所以这里按场景给不同的收束，情绪识别命中时再叠加在情绪句后面。 */
  var SCENE_EMPATHY = {
    'ask-directions': '问路这件事容错很高——对方每天被问很多次，你问完就走了，没人会记得。',
    'eat-unfamiliar': '和不熟的人吃饭本来就有"边吃边聊"的节奏，嚼东西的空档不用硬找话说。',
    'icebreaker': '刚认识的同学、刚住到一起的室友，本来就不需要一次聊成朋友，先把日常信息交换清楚就够了。',
    'wechat-first': '线上第一句其实比当面轻松：你可以慢慢打草稿，想好了再发，不用即时反应。',
    'group-chat': '线上的沉默大多数时候只是"对方还没看到"，不等于不想理你。',
    'party-strangers': '陌生场合里尴尬的不止你一个，多数人也在等别人先开口。',
    'self-intro': '自我介绍只要能让人记住一个点就够了，不需要把整个人讲完。',
    'approach-teacher': '老师通常希望学生来问，带着具体问题去，比"问得不够好"重要得多。',
    'phone-stranger': '打电话最难的是开头三句，说完这三句，后面就顺了。',
    'club-interview': '面试看的是合不合适，不是完不完美，一两个问题没答好不会翻盘。',
    'class-present': '台下的人关心的是内容，不会盯着你的小失误。',
    'meeting-speak': '会议上看的是信息有没有价值，不是表达得多漂亮。',
    'job-interview': '面试是双向了解——你在被评估，同时也在评估对方。'
  };

  function empathyLine(emotion, scene) {
    var note = (scene && SCENE_EMPATHY[scene.id]) || '';
    if (!emotion.labels.length) {
      return note || '这种感觉在这类场景里很常见，我们先把它安顿好，再看具体说什么。';
    }
    var map = {
      physical: '身体先有反应是正常的，心跳快不等于你不行——它只是身体在预热。',
      cognitive: '"不知道说什么"不是你笨，是没有可用的话头，这个可以提前备。',
      rumination: '事后反复回放特别耗人，我们把它挪到前面来，提前想，就不用事后想。',
      avoidance: '想躲开是身体的省电模式，不代表你不想参与。',
      depletion: '社交电量见底的时候，先别要求自己表现好，只要求自己到场。',
      eagerness: '你有一点期待，这是很好的起点，我们把它用在具体的一句话上。'
    };
    var base = map[emotion.labels[0].key] || '这种感觉在这类场景里很常见，我们先处理它，再处理说什么。';
    return note ? base + ' ' + note : base;
  }

  function buildPrepReply(input, profile, opts) {
    var text = String(input || '');
    var options = opts || {};
    var crisis = safetyCheck(text);
    if (crisis) return { blocks: [CRISIS_BLOCK], crisis: true };

    var found = detectScenes(text, 3);
    // ① 追问"你凭什么觉得是××"：如实解释关键词匹配（比"听不懂产品问题"有用得多）
    if (isWhyQuestion(text) && options.lastScene) {
      return { blocks: whyBlocks(options.lastScene), why: true };
    }
    // ② 产品/元问题：不走"猜场景"的老路，避免一本正经地胡说八道
    if (!found.length && looksLikeMeta(text)) {
      return { blocks: metaBlocks(), meta: true };
    }
    var scene = found.length ? found[0].scene : getScene('party-strangers');
    var guess = !found.length;
    /* 命中的关键词一并回传，前端记下来：用户下次追问"为什么"时能说清依据 */
    var matched = found.length ? {
      id: scene.id,
      name: scene.name,
      keywords: scene.aliases.filter(function (a) { return norm(text).indexOf(norm(a)) >= 0; })
    } : null;
    var emotion = detectEmotions(text);
    var pressure = estimatePressure(scene.id, text, profile);

    // 结合「社交画像」测试结果：同一个场景，对不同的人强调不同的事
    // 分档口径与 assessment.js 的 BANDS 保持一致：≤2.4 较擅长 / ≤3.5 一般 / >3.5 偏吃力
    var selfCheck = null;
    var d = options.selfCheckDifficulty;
    if (typeof d === 'number' && isFinite(d)) {
      if (d > 3.5) {
        selfCheck = '你的自评里「' + scene.name + '」预测难度 ' + d + '/5，属于偏吃力的场景。我们先花 30 秒把身体稳住，再看话术——顺序反了容易念不出口。';
      } else if (d <= 2.4) {
        selfCheck = '你的自评里「' + scene.name + '」预测难度只有 ' + d + '/5，这类场景你通常应付得来，可以直接跳到下面的话术。';
      } else {
        selfCheck = '你的自评里「' + scene.name + '」预测难度 ' + d + '/5，属于中等：先扫一眼开场句就够了。';
      }
    }

    var blocks = [];
    blocks.push({ type: 'empathy', text: empathyLine(emotion, scene) });
    blocks.push({
      type: 'analysis',
      title: guess ? '我先按最接近的场景来准备' : '我听到的场景',
      scene: scene.name,
      guess: guess,
      level: pressure.level,
      levelLabel: pressure.label,
      factors: pressure.factors,
      emotionLabels: emotion.labels.map(function (l) { return l.label; }),
      note: pressure.tendencyNote,
      selfCheck: selfCheck,
      alternatives: found.slice(1).map(function (f) { return f.scene.name; })
    });
    blocks.push({
      type: 'reframe',
      title: '30 秒：先重新解释这份紧张',
      // 原来这里有一行"报告里受访者最认可的方式"，用户反馈"这行字出现的必要性在于？"——去掉
      lines: scene.reframe
    });
    blocks.push({
      type: 'breath',
      title: '要一起做 30 秒呼吸吗',
      pattern: { inhale: 4, hold: 2, exhale: 6 },
      seconds: 30,
      text: '吸 4 秒，停 2 秒，呼 6 秒。呼气比吸气长，身体会跟着慢下来。'
    });
    blocks.push({
      type: 'script',
      title: '可以直接念的话',
      // 没有对应话术的分组直接不渲染，避免出现"转话题"下面空着
      groups: [
        { label: '开场', items: scene.scripts.open || [] },
        { label: '接话', items: scene.scripts.sustain || [] },
        { label: '转话题', items: scene.scripts.shift || [] },
        { label: '离场兜底', items: scene.scripts.exit || [] }
      ].filter(function (g) { return g.items && g.items.length > 0; })
    });
    blocks.push({
      type: 'checklist',
      title: '如果还有 3 分钟',
      items: scene.checklist,
      hint: '不用全部做完，挑一件做就够了；准备时间控制在 3 分钟以内。'
    });
    return { scene: scene, matched: matched, pressure: pressure, emotion: emotion, blocks: blocks, crisis: false };
  }

  /* ------------------------------------------------------------------ *
   * 六、社交中应急模块（对应报告：即时话术建议、话题转移策略、脱身话术）
   * ------------------------------------------------------------------ */
  var EMERGENCY = [
    {
      id: 'blank', name: '大脑一片空白', sub: '突然说不出话',
      quick: ['我先想一下这个问题。', '我整理一下再回答你。'],
      then: ['把对方的问题重复一遍，借这两秒组织语言。', '复述对方最后一句话，再补自己的看法。']
    },
    {
      id: 'nosay', name: '不知道说什么', sub: '怕冷场',
      quick: ['你最近在忙什么？', '这个你怎么看？'],
      then: ['把话题交给对方：问一个"你怎么看"。', '聊现场可见的东西：这道菜、这个活动、这个教室。']
    },
    {
      id: 'cold', name: '场面冷下来了', sub: '没人接话',
      quick: ['那我们换个话题——你周末一般干嘛？'],
      then: ['冷场 3 秒在对话里是正常呼吸，不用急着填。', '先转话题，而不是硬接上一句。']
    },
    {
      id: 'exit', name: '想离开', sub: '待不下去了',
      quick: ['我去接杯水，等下回来。', '我下午还有点事，先撤啦，回头见。'],
      then: ['提前离场是你的权利，不需要理由充分。', '临走时跟一个人打个招呼就算体面收场。']
    },
    {
      id: 'mistake', name: '刚说错话了', sub: '正在反复回放',
      quick: ['不好意思，我刚才说错了，我的意思是××。'],
      then: ['能补就补一句，补不了就让它过去——别人的注意力没你想的那么长。', '现在不要复盘，复盘留到结束以后。']
    },
    {
      id: 'called', name: '被点名/突然发言', sub: '没有准备',
      quick: ['我先说一个点：关于××，我的想法是××。', '我还没想完整，先说我确定的部分。'],
      then: ['先给结论，再给理由；说不全就说不全。', '用"我确定的是……"开头，把不确定的部分留白。']
    },
    {
      id: 'panic', name: '心跳太快/快撑不住', sub: '生理反应上头',
      quick: ['我先去下洗手间。'],
      then: ['离开现场 60 秒，做 3 次"吸 4 停 2 呼 6"。', '把脚踩实地面，用手摸一下桌沿，把注意力放回身体。']
    }
  ];
  function buildEmergencyReply(topicId, profile) {
    var topic = null;
    for (var i = 0; i < EMERGENCY.length; i++) if (EMERGENCY[i].id === topicId) topic = EMERGENCY[i];
    if (!topic) return { blocks: [] };
    var blocks = [{
      type: 'emergency',
      title: topic.name,
      quick: topic.quick,
      then: topic.then,
      tip: (profile && profile.tendency === 'i')
        ? '内向画像的人更依赖"预先写好的句子"，念出来就行，不必即兴。'
        : '先把第一句说出口，后面的话会自己接上。'
    }];
    return { topic: topic, blocks: blocks };
  }

  /* ------------------------------------------------------------------ *
   * 七、社交后复盘 + 成长档案（对应报告：结构化复盘 + 策略库 + 成长曲线）
   * ------------------------------------------------------------------ */
  var TRIGGER_OPTIONS = ['人多', '要当众说话', '都是陌生人', '怕说错', '被打断', '时间冲突', '事后反复回想', '担心给别人添麻烦'];
  var EFFECT_OPTIONS = [
    { value: 'good', label: '有效' },
    { value: 'ok', label: '一般' },
    { value: 'bad', label: '没帮上' }
  ];

  function buildReview(input) {
    var i = input || {};
    var record = {
      at: i.at || new Date().toISOString(),
      sceneId: i.sceneId || 'party-strangers',
      sceneName: (getScene(i.sceneId) || {}).name || '未分类场景',
      level: Math.max(1, Math.min(5, parseInt(i.level, 10) || 3)),
      triggers: (i.triggers || []).slice(0, 6),
      action: String(i.action || '').slice(0, 300),
      effect: i.effect || 'ok',
      next: String(i.next || '').slice(0, 300),
      mood: String(i.mood || '').slice(0, 200)
    };
    var summary = [];
    summary.push('这次是「' + record.sceneName + '」，焦虑 ' + record.level + '/5（' + LEVEL_LABELS[record.level] + '）。');
    if (record.triggers.length) summary.push('主要触发点：' + record.triggers.join('、') + '。');
    if (record.action) summary.push('你当时做的是：' + record.action);
    summary.push(record.effect === 'good'
      ? '这次的做法是有效的，已经放进你的策略库，下次同类场景可以直接调用。'
      : record.effect === 'ok'
        ? '这次勉强撑住了，我们把"下次换一句开场"作为一个小改动就好。'
        : '这次没起作用不代表你没进步——它说明这个场景需要换一种准备方式，我已经标出来。');
    if (record.next) summary.push('下次想试的：' + record.next);
    summary.push('复盘到这里就够了，不用再回放细节。');
    return { record: record, summary: summary.map(soften) };
  }

  function createProfile() {
    return { version: 1, tendency: null, reviews: [], strategies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  function addReview(profile, record) {
    var p = profile || createProfile();
    p.reviews = p.reviews || [];
    p.strategies = p.strategies || [];
    p.reviews.push(record);
    if (record.effect === 'good' && record.action) {
      p.strategies.push({ sceneId: record.sceneId, sceneName: record.sceneName, action: record.action, at: record.at });
    }
    p.updatedAt = new Date().toISOString();
    return p;
  }

  function stats(profile) {
    var reviews = (profile && profile.reviews) || [];
    var n = reviews.length;
    if (!n) return { count: 0, avg: null, first: null, last: null, trend: 'flat', topScene: null, topSceneName: null, strategies: 0, series: [] };
    var sum = 0, i;
    for (i = 0; i < n; i++) sum += reviews[i].level;
    var counts = {};
    for (i = 0; i < n; i++) {
      var k = reviews[i].sceneId;
      counts[k] = (counts[k] || 0) + 1;
    }
    var topId = null, topN = 0;
    for (var key in counts) if (counts[key] > topN) { topN = counts[key]; topId = key; }
    var first = reviews[0].level, last = reviews[n - 1].level;
    var half = Math.max(1, Math.round(n / 2));
    var early = reviews.slice(0, half).reduce(function (a, r) { return a + r.level; }, 0) / half;
    var late = reviews.slice(n - half).reduce(function (a, r) { return a + r.level; }, 0) / half;
    return {
      count: n,
      avg: Math.round((sum / n) * 10) / 10,
      first: first,
      last: last,
      trend: late < early - 0.3 ? 'down' : (late > early + 0.3 ? 'up' : 'flat'),
      topScene: topId,
      topSceneName: (getScene(topId) || {}).name || '未分类场景',
      strategies: ((profile && profile.strategies) || []).length,
      series: reviews.map(function (r) { return r.level; })
    };
  }

  function safetyCheck(text) {
    var hay = norm(text);
    for (var i = 0; i < CRISIS_WORDS.length; i++) if (hay.indexOf(norm(CRISIS_WORDS[i])) >= 0) return CRISIS_BLOCK;
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 八、多端同步：画像校验与合并（前端登录同步、服务端入库校验共用同一份逻辑）
   *     原则：只保留必要字段、限制长度与条数，服务端不信任客户端传来的结构。
   * ------------------------------------------------------------------ */
  var PROFILE_LIMITS = { maxReviews: 500, maxBytes: 1024 * 1024, maxText: 300 };

  function clip(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }

  /**
   * 清洗"社交画像"自评结果（见 assessment.js）。
   * 只保留必要字段：维度分数、准备度、倾向提示、时间戳；场景预测是可重算的，不入库。
   */
  function sanitizeAssessment(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var dimsRaw = (raw.dimensions && typeof raw.dimensions === 'object' && !Array.isArray(raw.dimensions)) ? raw.dimensions : {};
    var dims = {};
    Object.keys(dimsRaw).slice(0, 16).forEach(function (k) {
      if (!/^[a-z][a-z0-9]{1,23}$/.test(k)) return;
      var v = dimsRaw[k];
      dims[k] = (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.min(100, Math.round(v))) : null;
    });
    if (!Object.keys(dims).length) return null;
    var num = function (v, min, max) {
      return (typeof v === 'number' && isFinite(v)) ? Math.max(min, Math.min(max, Math.round(v))) : null;
    };
    return {
      version: 1,
      at: clip(raw.at, 40) || new Date(0).toISOString(),
      answered: num(raw.answered, 0, 200),
      total: num(raw.total, 0, 200),
      dimensions: dims,
      readiness: num(raw.readiness, 0, 100),
      tendencyHint: (raw.tendencyHint === 'i' || raw.tendencyHint === 'e') ? raw.tendencyHint : null,
      flat: raw.flat === true
    };
  }

  function validateProfile(doc) {
    var errors = [];
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errors: ['画像不是对象'], profile: null };
    var json;
    try { json = JSON.stringify(doc); } catch (e) { return { ok: false, errors: ['画像无法序列化'], profile: null }; }
    if (json.length > PROFILE_LIMITS.maxBytes) errors.push('数据超过 1MB 上限');

    var reviews = Array.isArray(doc.reviews) ? doc.reviews : [];
    if (reviews.length > PROFILE_LIMITS.maxReviews) errors.push('复盘记录超过 ' + PROFILE_LIMITS.maxReviews + ' 条上限');

    var cleanReviews = reviews.slice(0, PROFILE_LIMITS.maxReviews).filter(function (r) {
      return r && typeof r === 'object' && !Array.isArray(r);
    }).map(function (r) {
      return {
        at: clip(r.at, 40) || new Date(0).toISOString(),
        sceneId: clip(r.sceneId, 64),
        sceneName: clip(r.sceneName, 64) || '未分类场景',
        level: Math.max(1, Math.min(5, parseInt(r.level, 10) || 3)),
        triggers: (Array.isArray(r.triggers) ? r.triggers : []).filter(function (t) { return typeof t === 'string'; })
          .slice(0, 6).map(function (t) { return t.slice(0, 32); }),
        action: clip(r.action, PROFILE_LIMITS.maxText),
        effect: ['good', 'ok', 'bad'].indexOf(r.effect) >= 0 ? r.effect : 'ok',
        next: clip(r.next, PROFILE_LIMITS.maxText),
        mood: clip(r.mood, 200)
      };
    }).sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });

    var strategies = (Array.isArray(doc.strategies) ? doc.strategies : []).filter(function (s) {
      return s && typeof s === 'object';
    }).slice(0, PROFILE_LIMITS.maxReviews).map(function (s) {
      return { sceneId: clip(s.sceneId, 64), sceneName: clip(s.sceneName, 64) || '未分类场景', action: clip(s.action, PROFILE_LIMITS.maxText), at: clip(s.at, 40) };
    });

    var clean = {
      version: 1,
      tendency: (doc.tendency === 'i' || doc.tendency === 'e') ? doc.tendency : null,
      reviews: cleanReviews,
      strategies: strategies,
      assessment: sanitizeAssessment(doc.assessment),
      // 缺失时间字段时留空串，而不是补当前时间：避免校验/合并结果依赖时钟，前端本地优先的结构也更可预测
      createdAt: clip(doc.createdAt, 40),
      updatedAt: clip(doc.updatedAt, 40)
    };
    return { ok: errors.length === 0, errors: errors, profile: clean };
  }

  // 合并两端的画像：复盘按"时间+场景+等级"去重并保序，策略库由合并后的复盘重建，避免重复条目。
  function mergeProfiles(local, remote) {
    var a = (validateProfile(local).profile) || createProfile();
    var b = (validateProfile(remote).profile) || createProfile();
    var seen = {}, reviews = [];
    [a, b].forEach(function (p) {
      p.reviews.forEach(function (r) {
        var key = r.at + '|' + r.sceneId + '|' + r.level;
        if (!seen[key]) { seen[key] = 1; reviews.push(r); }
      });
    });
    reviews.sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
    var newer = (a.updatedAt || '') > (b.updatedAt || '') ? a : b;
    var older = newer === a ? b : a;
    // 画像测试结果取"更新的一次"（按测试时间），避免旧结果覆盖新结果
    var assessA = a.assessment, assessB = b.assessment;
    var assessment = null;
    if (assessA && assessB) assessment = (assessA.at >= assessB.at) ? assessA : assessB;
    else assessment = assessA || assessB || null;
    return {
      version: 1,
      tendency: newer.tendency || older.tendency || null,
      reviews: reviews,
      strategies: reviews.filter(function (r) { return r.effect === 'good' && r.action; })
        .map(function (r) { return { sceneId: r.sceneId, sceneName: r.sceneName, action: r.action, at: r.at }; }),
      assessment: assessment,
      // 时间字段一律取自入参，不再回落到当前时间：同一份输入合并两次必须得到完全相同的结果，
      // 否则前端会误判"远端变了"从而多余上传（这里曾被测试抓出过一次）
      createdAt: (a.createdAt && b.createdAt) ? (a.createdAt > b.createdAt ? b.createdAt : a.createdAt) : (a.createdAt || b.createdAt || ''),
      updatedAt: (a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt) || ''
    };
  }

  function sameProfile(a, b) {
    return JSON.stringify(validateProfile(a).profile) === JSON.stringify(validateProfile(b).profile);
  }

  // 对话意图路由：让"实时对话"能自己判断用户想做什么
  function route(text) {
    var hay = norm(text);
    if (safetyCheck(text)) return 'crisis';
    if (/复盘|总结一下|记一下|刚才|刚刚结束|结束后/.test(hay)) return 'review';
    if (/紧急|现在|正在|马上|来不及|现场|当场|撑不住|想走/.test(hay)) return 'emergency';
    return 'prep';
  }

  return {
    SCENES: SCENES,
    EMERGENCY: EMERGENCY,
    TRIGGER_OPTIONS: TRIGGER_OPTIONS,
    EFFECT_OPTIONS: EFFECT_OPTIONS,
    LEVEL_LABELS: LEVEL_LABELS,
    CRISIS_BLOCK: CRISIS_BLOCK,
    soften: soften,
    pick: pick,
    detectScenes: detectScenes,
    empathyLine: empathyLine,
    SCENE_EMPATHY: SCENE_EMPATHY,
    looksLikeMeta: looksLikeMeta,
    isWhyQuestion: isWhyQuestion,
    whyBlocks: whyBlocks,
    metaBlocks: metaBlocks,
    getScene: getScene,
    estimatePressure: estimatePressure,
    detectEmotions: detectEmotions,
    buildPrepReply: buildPrepReply,
    buildEmergencyReply: buildEmergencyReply,
    buildReview: buildReview,
    createProfile: createProfile,
    addReview: addReview,
    stats: stats,
    safetyCheck: safetyCheck,
    route: route,
    validateProfile: validateProfile,
    mergeProfiles: mergeProfiles,
    sameProfile: sameProfile,
    PROFILE_LIMITS: PROFILE_LIMITS
  };
});
