# -*- coding: utf-8 -*-
"""题库扩到 64 后的文案/测试同步"""
import io
import re

def patch(path, pairs, label):
    s = io.open(path, encoding='utf-8').read()
    n = 0
    for a, b in pairs:
        if a in s:
            s = s.replace(a, b)
            n += 1
        else:
            print('  [%s] 未找到: %s' % (label, a[:44]))
    io.open(path, 'w', encoding='utf-8').write(s)
    print('%s: %d 处' % (label, n))

# ---------------- 前端文案 ----------------
patch('app.js', [
    ("'差不多了——八个维度都至少问到了 3 题，再问下去信息也不会多多少。'",
     "'差不多了——八个维度都至少问到了 6 题，再问下去信息也不会多多少。'"),
    ("'接下来会多问几个你还没答过的维度，好让画像别一边厚一边薄。'",
     "'接下来会多问几道你还没答过的题，好让画像别一边厚一边薄。'"),
], 'app.js')

patch('index.html', [
    ('最少 24 题 · 约 3 分钟', '最少 48 题 · 约 5 分钟'),
    ('快速版约 24–32 题（会挑题）；完整版 40 题，适合隔一段时间重测做对比',
     '快速版 48–56 题（会挑题，答案模糊就多问几道）；完整版 64 题，适合隔一段时间重测做对比'),
    ('>完整版 40 题<', '>完整版 64 题<'),
    ('题目来自 12 人访谈', '题目来自访谈与写作小组自编'),
], 'index.html')

# ---------------- 测试 ----------------
patch('test-assessment.js', [
    ("ok('总题数落在 24–32 之间', done >= 24 && done <= A.ADAPTIVE.maxTotal, String(done));",
     "ok('总题数落在 48–56 之间', done >= 48 && done <= A.ADAPTIVE.maxTotal, String(done));"),
    ("ok('停止时每个维度至少 3 题',", "ok('停止时每个维度至少 6 题',"),
    ("ok('比完整版 40 题更短', done < A.ITEMS.length, String(done));",
     "ok('比完整版 64 题更短，但不少于 48 题', done < A.ITEMS.length && done >= 48, String(done));"),
], 'test-assessment.js')

patch('smoke-dom.js', [
    ("section('社交画像测试（完整版 40 题全流程）');", "section('社交画像测试（完整版 64 题全流程）');"),
    ("while (rounds < 12 && !$q('testQuiz').classList.contains('hidden')) {",
     "while (rounds < 20 && !$q('testQuiz').classList.contains('hidden')) {"),
    ("ok('实际题数在 24–32 之间', qProf.assessment.answered >= 24 && qProf.assessment.answered <= 32,",
     "ok('实际题数在 48–56 之间', qProf.assessment.answered >= 48 && qProf.assessment.answered <= 56,"),
    ("ok('快速版约 24–32 题（会挑题）'", "ok('快速版 48–56 题（会挑题）'"),
], 'smoke-dom.js')

patch('check-wiring.js', [
    ("report(/minPerDim:\\s*3/.test(assessSrc2) && /maxTotal:\\s*32/.test(assessSrc2),\n  '自适应有明确的量化标准（每维 ≥3 题、总量 ≤32）');",
     "report(/minPerDim:\\s*6/.test(assessSrc2) && /maxTotal:\\s*56/.test(assessSrc2),\n  '自适应有明确的量化标准（每维 ≥6 题、总量 48–56）');"),
], 'check-wiring.js')

# ---------------- README ----------------
s = io.open('README.md', encoding='utf-8').read()
s = s.replace('题目不再是固定 40 题全问一遍：', '题库 64 题（8 维 × 8 题，其中 24 道反向计分），不再固定全问一遍：')
s = s.replace('**会挑题**：每屏 4 题；先补齐「题数最少」的维度，再优先问「最拿不准」的维度',
              '**会挑题**：每屏 4 题；先补齐「题数最少」的维度，再优先问「最拿不准」的维度')
s = s.replace('**会自己停**：每维至少 3 题、总量 24–32 题（完整版仍是 40 题，适合隔期重测做对比）',
              '**会自己停**：每维至少 6 题 → 总量 **48 题起**；若某维均值仍卡在 2.4–3.6（答得说不清），最多再加 2 组到 56 题（完整版 64 题，适合隔期重测做对比）')
io.open('README.md', 'w', encoding='utf-8').write(s)
print('README: 已更新题量说明')
