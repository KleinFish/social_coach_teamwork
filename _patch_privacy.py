# -*- coding: utf-8 -*-
"""方案 C+A：
C. 学到的场景只存「骨架」——通用名字/别名/等级/通用建议，去掉可能带个人信息的内容
A. 提示词里加隐私约束 + 前端隐私声明写清楚
"""
import io

F = 'server.js'
s = io.open(F, encoding='utf-8').read()

# ---------- 1. 新增骨架清洗 ----------
if 'function skeletonizeLearned' not in s:
    ADD = '''
  /* ------------------------------------------------------------------ *
   * 场景骨架化（隐私）：学到的场景会进**公共库**，所以只留通用信息。
   *   · 别名：2–6 字、不含数字/英文/第一人称/时间词/地点细节——宁可少认，不可泄露
   *   · stressor / reframe：出现个人信息迹象就换成通用表述
   *   · scripts / checklist：是通用建议，保留（离线也能用）
   * ------------------------------------------------------------------ */
  const PERSONAL_HINT = /(我|俺|咱|你|他|她|咱家|上次|昨天|前天|今天|明天|上周|下周|那天|那天我|我的)/;
  const DIGIT_HINT = /[0-9０-９]|[A-Za-z]{2,}/;

  function genericAlias(t) {
    const v = String(t || '').replace(/[\\s，。！？、,.!?]/g, '');
    if (v.length < 2 || v.length > 6) return '';
    if (DIGIT_HINT.test(v)) return '';          // 带数字/英文的多半是具体事件
    if (PERSONAL_HINT.test(v)) return '';        // 带人称的多半是个人经历
    return v;
  }

  function skeletonText(t, name) {
    const v = clampText(t, 60);
    if (!v) return '';
    if (PERSONAL_HINT.test(v) || DIGIT_HINT.test(v)) {
      return '这类场景通常卡在「' + name + '」里的评价压力与被看见的感觉。';
    }
    return v;
  }

  function skeletonizeLearned(doc) {
    const aliases = uniqBy((doc.aliases || []).map(genericAlias).filter(Boolean)).slice(0, 5);
    if (!aliases.length) return { ok: false, errors: ['别名全部含个人信息，已丢弃（无法稳定识别）'] };
    const reframe = (doc.reframe || []).map((t) => skeletonText(t, doc.name)).filter(Boolean).slice(0, 3);
    const stressor = skeletonText(doc.stressor, doc.name);
    const scripts = {};
    ['open', 'sustain', 'shift', 'exit'].forEach((k) => {
      scripts[k] = ((doc.scripts && doc.scripts[k]) || []).map((t) => clampText(t, 60)).filter(Boolean);
    });
    const checklist = (doc.checklist || []).map((t) => clampText(t, 60)).filter(Boolean).slice(0, 4);
    if (!reframe.length || !scripts.open || !scripts.open.length) {
      return { ok: false, errors: ['骨架化后内容不足，已丢弃'] };
    }
    return {
      ok: true,
      doc: {
        id: doc.id, name: doc.name, level: doc.level, aliases: aliases, stressor: stressor || '',
        reframe: reframe, scripts: scripts, checklist: checklist, learned: true, source: 'llm'
      }
    };
  }

  /** 简易去重（别名可能重复） */
  function uniqBy(arr) {
    const seen = {};
    return arr.filter((x) => {
      const k = String(x).toLowerCase();
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

'''
    s = s.replace('  function validateLearnedScene(raw, existingNames) {', ADD + '  function validateLearnedScene(raw, existingNames) {', 1)
    print('server: 已加骨架化函数')

# ---------- 2. 出口处应用骨架化 ----------
old_ret = """    return {
      ok: true,
      id: id,
      doc: {
        id: id, name: name, level: level, aliases: aliases, stressor: stressor, reframe: reframe,
        scripts: { open: open, sustain: sustain, shift: shift, exit: exit },
        checklist: checklist, learned: true, source: 'llm'
      }
    };"""
new_ret = """    const skeleton = skeletonizeLearned({
      id: id, name: name, level: level, aliases: aliases, stressor: stressor, reframe: reframe,
      scripts: { open: open, sustain: sustain, shift: shift, exit: exit }, checklist: checklist
    });
    if (!skeleton.ok) return { ok: false, errors: skeleton.errors };
    return { ok: true, id: skeleton.doc.id, doc: skeleton.doc };"""
if old_ret in s:
    s = s.replace(old_ret, new_ret, 1)
    print('server: 入库前已走骨架化')
else:
    print('server: 返回段未匹配')

# ---------- 3. 提示词：newScene 的隐私约束 ----------
old_p = "  '【关于 newScene】只有完全装不进「已有场景」时才返回，否则 null。',"
new_p = ("  '【关于 newScene】只有完全装不进「已有场景」时才返回，否则 null。',\n"
         "  '  newScene 会进入公共场景库，所以：不要复述用户原话，不要出现人名、时间、地点、数字；',\n"
         "  '  name 用通用说法（如「被临时点名发言」），aliases 给 1–5 个 2–6 字的通用叫法（如「临时发言」）；',\n"
         "  '  只要有一处可能认出是「谁的哪件事」，就返回 null。',")
if old_p in s:
    s = s.replace(old_p, new_p, 1)
    print('server: 提示词已加 newScene 隐私约束')
else:
    print('server: 提示词段落未匹配')

io.open(F, 'w', encoding='utf-8').write(s)

# ---------- 4. 前端隐私声明 ----------
G = 'index.html'
h = io.open(G, encoding='utf-8').read()
anchor = '          <li>这是<b>自评预测</b>，不是心理测评，也不做诊断</li>'
if '公共场景库' not in h:
    add = anchor + '\n          <li>大模型从对话里学到的新场景会进<b>公共场景库</b>，但只存「骨架」：场景名、通用别名、难度等级和通用建议——不含你的原话、人名、时间、地点</li>'
    if anchor in h:
        h = h.replace(anchor, add, 1)
        io.open(G, 'w', encoding='utf-8').write(h)
        print('index.html: 测试页隐私清单已补一条')
    else:
        print('index.html: 锚点未匹配')
else:
    print('index.html: 已存在公共场景库说明')
