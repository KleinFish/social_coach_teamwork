# -*- coding: utf-8 -*-
"""题库 64 → 96（每维 8→12 题，每维 4 道反向）"""
import io
import re

F = 'assessment.js'
s = io.open(F, encoding='utf-8').read()

NEW = {
 'i8': [("i9", False, "需要向邻座同学借一支笔，我能直接开口。"),
        ("i10", True, "群里需要有人去问老师一件事时，我会等别人先开口。"),
        ("i11", False, "在社团招新摊位前，我能主动问一句「你们平时做什么」。"),
        ("i12", False, "和刚认识的人分别时，我能自然地说「加个微信吧」。")],
 's8': [("s9", False, "在食堂和同学拼桌，我能从「今天这个菜还行」聊下去。"),
        ("s10", True, "排队时遇到熟人，我会假装没看见或者低头看手机。"),
        ("s11", False, "对方说了一件事，我能追问一个具体细节。"),
        ("s12", False, "聊天出现三秒安静时，我能接上一句不尴尬的话。")],
 'g8': [("g9", False, "班级群里有人说「有人一起吗」，我能第一个回「我去」。"),
        ("g10", True, "小组分工时，我宁可多做事，也不主动说自己想做什么。"),
        ("g11", False, "社团例会上，我能就一个议题说两句自己的想法。"),
        ("g12", False, "聚会里有人聊我不懂的话题，我能问一句「这个是怎么玩的」。")],
 'p8': [("p9", False, "做课堂展示时，我能把时间控制在要求之内。"),
        ("p10", True, "一想到要上台，我会提前几天开始睡不好。"),
        ("p11", False, "讲到不熟的部分，我能先说「这块我查得不多，但我理解是……」。"),
        ("p12", False, "被老师当堂点名回答，我能先复述问题再作答。")],
 'a8': [("a9", False, "我能走进办公室，当面向老师请教一个问题。"),
        ("a10", True, "老师语气一冷，我就会觉得是自己做错了什么。"),
        ("a11", False, "需要请老师签字或写推荐时，我能把材料准备齐再开口。"),
        ("a12", False, "和辅导员谈自己的困难时，我能说清具体需要什么帮助。")],
 'm8': [("m9", False, "临时被推上台说两句，我能先说「我准备得不多」再讲要点。"),
        ("m10", True, "别人开玩笑点到我时，我会脸红到说不出话。"),
        ("m11", False, "讨论跑题时，我能把话题拉回来。"),
        ("m12", False, "发现自己说错了人名，我能自然改口。")],
 'r8': [("r9", False, "一次发言没表现好，我第二天还能正常去上课。"),
        ("r10", True, "反复回想自己说过的蠢话，会占用我很多时间。"),
        ("r11", False, "紧张过后，我会做点别的事把注意力移开。"),
        ("r12", False, "被人指出问题，我能区分「这件事没做好」和「我这个人不行」。")],
 't8': [("t9", False, "我知道自己每周安排几场社交最合适。"),
        ("t10", True, "连续几天有集体活动，我会开始找理由请假。"),
        ("t11", False, "社交之后，我会给自己留一段不说话的时间。"),
        ("t12", False, "我能判断今天还有没有余力再去一个聚会。")],
}

added = 0
for anchor_id, rows in NEW.items():
    if "id: '%s'" % rows[0][0] in s:
        print('已存在:', rows[0][0])
        continue
    m = re.search(r"\{ id: '%s', dim: '[a-z]+'[^\n]*\n" % anchor_id, s)
    if not m:
        print('未找到锚点:', anchor_id)
        continue
    lines = ''
    for rid, rev, text in rows:
        dim = re.search(r"dim: '([a-z]+)'", s[m.start():m.end()]).group(1)
        lines += "    { id: '%s', dim: '%s', reverse: %s, text: '%s' },\n" % (
            rid, dim, 'true' if rev else 'false', text)
    s = s[:m.end()] + lines + s[m.end():]
    added += 1

s = s.replace('var VERSION = 2;   // 2：题库 40→64，自适应下限 48',
              'var VERSION = 3;   // 3：题库 96 题（8 维 × 12），自适应 48–56', 1)
io.open(F, 'w', encoding='utf-8').write(s)

items = len(re.findall(r"\{ id: '[a-z]\d+', dim:", s))
rev = len(re.findall(r"reverse: true, text:", s))
per = {}
for mm in re.finditer(r"id: '([a-z])\d+', dim: '([a-z]+)'", s):
    per[mm.group(2)] = per.get(mm.group(2), 0) + 1
print('新增维度:', added, '｜题目总数:', items, '｜反向题:', rev)
print('每维:', per)
