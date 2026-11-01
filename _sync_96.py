# -*- coding: utf-8 -*-
"""题库 96 题后的文案/测试/文档同步"""
import io

def patch(path, pairs, label):
    s = io.open(path, encoding='utf-8').read()
    n = 0
    for a, b in pairs:
        if a in s:
            s = s.replace(a, b)
            n += 1
        else:
            print('  [%s] 未找到: %s' % (label, a[:46]))
    io.open(path, 'w', encoding='utf-8').write(s)
    print('%s: %d 处' % (label, n))

patch('index.html', [
    ('快速版 48–56 题（会挑题，答案模糊就多问几道）；完整版 64 题，适合隔一段时间重测做对比',
     '题库 96 题（八维各 12 题）：快速版 48–56 题，会挑着你拿不准的地方问；完整版 96 题，适合隔一段时间重测做对比'),
    ('>完整版 64 题<', '>完整版 96 题<'),
], 'index.html')

patch('app.js', [
    ("'完整版会把 40 道题都问一遍，适合隔一段时间重测做对比。'",
     "'完整版会把 96 道题都问一遍，适合隔一段时间重测做对比。'"),
], 'app.js')

patch('test-assessment.js', [
    ("ok('比完整版 64 题更短，但不少于 48 题', done < A.ITEMS.length && done >= 48, String(done));",
     "ok('比完整版 96 题更短，但不少于 48 题', done < A.ITEMS.length && done >= 48, String(done));"),
], 'test-assessment.js')

patch('smoke-dom.js', [
    ("section('社交画像测试（完整版 64 题全流程）');", "section('社交画像测试（完整版 96 题全流程）');"),
], 'smoke-dom.js')

patch('check-wiring.js', [
    ("report(/minPerDim:\\s*6/.test(assessSrc2) && /maxTotal:\\s*56/.test(assessSrc2),\n  '自适应有明确的量化标准（每维 ≥6 题、总量 48–56）');",
     "report(/minPerDim:\\s*6/.test(assessSrc2) && /maxTotal:\\s*56/.test(assessSrc2),\n  '自适应有明确的量化标准（每维 ≥6 题、总量 48–56）');\n"
     "report((assessSrc2.match(/dim: '\\(\\[a-z\\]\\)\\+'/g) || []).length >= 80, '题库扩到 80 题以上（每维 12 题）');"),
], 'check-wiring.js')

s = io.open('README.md', encoding='utf-8').read()
s = s.replace('题库 64 题（8 维 × 8 题，其中 24 道反向计分），不再固定全问一遍：',
              '题库 **96 题**（8 维 × 12 题，其中 32 道反向计分），不再固定全问一遍：')
s = s.replace('（完整版 64 题，适合隔期重测做对比）', '（完整版 96 题，适合隔期重测做对比）')
io.open('README.md', 'w', encoding='utf-8').write(s)
print('README: 已更新为 96 题')
