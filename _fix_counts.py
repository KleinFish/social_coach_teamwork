# -*- coding: utf-8 -*-
"""更新题库规模相关的旧断言（40/48/5 题 → 96/12 题）"""
import io
import re

# ---------------- test-assessment.js ----------------
F = 'test-assessment.js'
s = io.open(F, encoding='utf-8').read()
s = s.replace("ok('题目数量不超过 48', A.itemCount() <= 48, String(A.itemCount()));",
              "ok('题目数量不少于 90（题库已扩容）', A.itemCount() >= 90, String(A.itemCount()));")
s = s.replace("ok('题目数量正好 40（8 维 × 5 题）', A.itemCount() === 40);",
              "ok('题目数量正好 96（8 维 × 12 题）', A.itemCount() === 96, String(A.itemCount()));")
s = s.replace("ok('每个维度恰好 5 题', perDimOk);", "ok('每个维度恰好 12 题', perDimOk);")
io.open(F, 'w', encoding='utf-8').write(s)
print('test-assessment: 已更新规模断言')

# ---------------- check-wiring.js ----------------
G = 'check-wiring.js'
t = io.open(G, encoding='utf-8').read()

# 1) 之前插坏的那条
bad = [l for l in t.split('\n') if '题库扩到 80 题以上' in l]
for l in bad:
    t = t.replace(l, "report((assessSrc2.match(/dim: '/g) || []).length >= 80, '题库扩到 80 题以上（每维 12 题）');")
# 上一行可能是我插入的 match 表达式，删掉重复
t = re.sub(r"\n *report\(\(assessSrc2\.match\(/dim: '\\\\?\[a-z\\\\?\]\.\.\.?[^\n]*\n", "\n", t)

# 2) 旧的 48 上限 / 5 题断言
t = t.replace("report(assess.itemCount() <= 48, `题库 ${assess.itemCount()} 题（上限 48）`);",
              "report(assess.itemCount() >= 90, `题库 ${assess.itemCount()} 题（8 维 × 12）`);")
t = t.replace("'8 个维度 × 5 题，结构完整');", "'8 个维度 × 12 题，结构完整');")
io.open(G, 'w', encoding='utf-8').write(t)
print('check-wiring: 已更新规模断言')
