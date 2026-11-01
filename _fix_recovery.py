# -*- coding: utf-8 -*-
"""补上 recovery 维度的 3 道新题（r5 行文本含 ASCII 引号，前面未匹配）"""
import io
import re

F = 'assessment.js'
s = io.open(F, encoding='utf-8').read()

ADD = """
    { id: 'r6', dim: 'recovery', reverse: false, text: '上台前心跳很快时，我知道等一分钟它会自己降下来。' },
    { id: 'r7', dim: 'recovery', reverse: true, text: '发出去的消息对方没回，我会反复点开对话框看。' },
    { id: 'r8', dim: 'recovery', reverse: false, text: '一次冷场之后，我能在当天把注意力放回别的事情上。' },"""

if "id: 'r6'" not in s:
    m = re.search(r"\{ id: 'r5', dim: 'recovery'[^\n]*\n", s)
    if m:
        s = s[:m.end()] + ADD.lstrip('\n') + s[m.end():]
        io.open(F, 'w', encoding='utf-8').write(s)
        print('已补 recovery 3 题')
    else:
        print('未找到 r5 行')
else:
    print('recovery 新题已存在')

items = len(re.findall(r"\{ id: '[a-z]\d+', dim:", s))
rev = len(re.findall(r"reverse: true", s))
per = {}
for mm in re.finditer(r"id: '([a-z])\d+', dim: '([a-z]+)'", s):
    per[mm.group(2)] = per.get(mm.group(2), 0) + 1
print('题目总数:', items, '｜reverse: true 计数:', rev)
print('每维题数:', per)
