# -*- coding: utf-8 -*-
"""准备提示词也加 newScene 隐私约束（并修掉原来「别名写用户日常会说的词」这句——那正是个人信息来源）"""
import io

F = 'server.js'
s = io.open(F, encoding='utf-8').read()

old = "  '- 能覆盖就返回 null。aliases 写用户日常会说的词，不要写成长句。',"
new = ("  '- 能覆盖就返回 null。',\n"
       "  '- newScene 会进入**公共场景库**，所以：不要复述用户原话，不要出现人名、时间、地点、数字；',\n"
       "  '- name 用通用说法，aliases 给 3–6 个 2–6 字的**通用叫法**（不要写用户日常口语、不要带「我/昨天」）。',")
if old in s:
    s = s.replace(old, new, 1)
    print('prep 提示词：已加隐私约束')
else:
    print('prep 提示词：未匹配')
io.open(F, 'w', encoding='utf-8').write(s)

import subprocess
