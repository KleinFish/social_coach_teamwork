# -*- coding: utf-8 -*-
"""题库 40 → 64（每维 8 题，其中 3 道反向），自适应 24–32 → 48–56"""
import io

F = 'assessment.js'
s = io.open(F, encoding='utf-8').read()

# ---------- 每维新题（1 反向 + 2 正向） ----------
NEW = {
 'i5': """    { id: 'i5', dim: 'initiating', reverse: false, text: '我能在几秒内想出一句打破沉默的开场白。' },
    { id: 'i6', dim: 'initiating', reverse: false, text: '在食堂遇到不太熟的同学，我能自然地打个招呼。' },
    { id: 'i7', dim: 'initiating', reverse: true, text: '活动室还在等人时，我宁愿站在外面，也不先进去寒暄。' },
    { id: 'i8', dim: 'initiating', reverse: false, text: '需要加同学微信时，我能把「为什么加你」说得清楚。' },""",
 's5': """    { id: 's5', dim: 'smalltalk', reverse: false, text: '和室友、邻居聊两句日常，对我来说很轻松。' },
    { id: 's6', dim: 'smalltalk', reverse: false, text: '在电梯里遇到同班同学，我能聊上一两句。' },
    { id: 's7', dim: 'smalltalk', reverse: true, text: '和同学两个人一起走路时，我常常一路无话。' },
    { id: 's8', dim: 'smalltalk', reverse: false, text: '对方说「最近好忙」时，我能顺着问出具体在忙什么。' },""",
 'g5': """    { id: 'g5', dim: 'group', reverse: false, text: '我能在一个聚会里自然地从一组人换到另一组人。' },
    { id: 'g6', dim: 'group', reverse: false, text: '小组讨论里，我能把话头接过来，说清自己那部分。' },
    { id: 'g7', dim: 'group', reverse: true, text: '社团破冰游戏轮到我时，我更希望自己被跳过。' },
    { id: 'g8', dim: 'group', reverse: false, text: '饭桌上大家互相介绍时，我能记住一两个名字并再叫出来。' },""",
 'p5': """    { id: 'p5', dim: 'publicspeaking', reverse: false, text: '自我介绍时，我能说出一件具体的事让别人记住我。' },
    { id: 'p6', dim: 'publicspeaking', reverse: false, text: '上台前我会练站姿和开口的第一句，而不是把全文背下来。' },
    { id: 'p7', dim: 'publicspeaking', reverse: true, text: '在全班面前发言时，我会一直盯着稿子、不敢抬头。' },
    { id: 'p8', dim: 'publicspeaking', reverse: false, text: '展示结束被提问时，我能先说一句「这个问题我分两点讲」。' },""",
 'a5': """    { id: 'a5', dim: 'authority', reverse: false, text: '面试中答不上来时，我能坦然承认并给出自己的思路。' },
    { id: 'a6', dim: 'authority', reverse: false, text: '给老师发邮件时，我能写清标题、事由和希望回复的时间。' },
    { id: 'a7', dim: 'authority', reverse: true, text: '学长学姐语气一严肃，我就会把想说的话咽回去。' },
    { id: 'a8', dim: 'authority', reverse: false, text: '面试最后我可以主动提问，比如问这个岗位日常做什么。' },""",
 'm5': """    { id: 'm5', dim: 'improvising', reverse: false, text: '话题不合适时，我能把它转到更轻松的方向。' },
    { id: 'm6', dim: 'improvising', reverse: false, text: '被要求临时补充几句时，我能先讲自己记得住的部分。' },
    { id: 'm7', dim: 'improvising', reverse: true, text: '被问到一个没准备的问题，我会结巴到说不下去。' },
    { id: 'm8', dim: 'improvising', reverse: false, text: '发现自己讲错了，我能当场补一句改过来。' },""",
 'r5': """    { id: 'r5', dim: 'recovery', reverse: false, text: '我能把「心跳快」理解成身体在准备，而不是我不行。' },
    { id: 'r6', dim: 'recovery', reverse: false, text: '上台前心跳很快时，我知道等一分钟它会自己降下来。' },
    { id: 'r7', dim: 'recovery', reverse: true, text: '发出去的消息对方没回，我会反复点开对话框看。' },
    { id: 'r8', dim: 'recovery', reverse: false, text: '一次冷场之后，我能在当天把注意力放回别的事情上。' },""",
 't5': """    { id: 't5', dim: 'stamina', reverse: false, text: '我会提前安排社交和独处的时间比例。' },
    { id: 't6', dim: 'stamina', reverse: false, text: '连着两天有活动，我会提前留出半天完全独处。' },
    { id: 't7', dim: 'stamina', reverse: true, text: '社交排得很密的那几周，我会失眠或者特别烦躁。' },
    { id: 't8', dim: 'stamina', reverse: false, text: '我大概清楚自己一周能承受几场社交。' },""",
}

n = 0
for anchor_id, block in NEW.items():
    # 定位该 id 所在整行
    key = "{ id: '%s'," % anchor_id
    i = s.find(key)
    if i < 0:
        print('未找到', anchor_id)
        continue
    line_start = s.rfind('\n', 0, i) + 1
    line_end = s.find('\n', i)
    old_line = s[line_start:line_end]
    if old_line.strip() in block:
        s = s[:line_start] + block + s[line_end:]
        n += 1
print('已扩充维度:', n)

# ---------- 自适应参数 ----------
s = s.replace("""  var ADAPTIVE = {
    block: 4,          // 每屏几题
    minPerDim: 3,      // 每维至少几题
    minTotal: 24,      // 最少总题数
    maxTotal: 32,      // 最多总题数""",
"""  var ADAPTIVE = {
    block: 4,          // 每屏几题
    minPerDim: 6,      // 每维至少几题（8 维 × 6 = 48，这是我们承诺的下限）
    minTotal: 48,      // 最少总题数
    maxTotal: 56,      // 最多总题数""", 1)

# ---------- VERSION ----------
s = s.replace('var VERSION = 1;', 'var VERSION = 2;   // 2：题库 40→64，自适应下限 48', 1)

io.open(F, 'w', encoding='utf-8').write(s)

# ---------- 校验 ----------
import re
items = len(re.findall(r"\{ id: '[a-z]\d+', dim:", s))
rev = len(re.findall(r'reverse: true', s))
print('题目总数:', items, '｜反向题:', rev)
per = {}
for m in re.finditer(r"id: '([a-z])\d+', dim: '([a-z]+)'", s):
    per[m.group(2)] = per.get(m.group(2), 0) + 1
print('每维题数:', per)
