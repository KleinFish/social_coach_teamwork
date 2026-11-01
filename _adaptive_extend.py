# -*- coding: utf-8 -*-
"""自适应再加一层：每维满 6 题后，若该维均值仍卡在中间带，最多再加 2 组（→52、56）"""
import io

F = 'assessment.js'
s = io.open(F, encoding='utf-8').read()

# 1) shouldStop：中间带还有信息可挖时别停
old = """  function shouldStop(answers, asked) {
    var a = answers || {};
    var done = answeredCount(a);
    if (done >= ADAPTIVE.maxTotal) return true;
    var stats = dimStats(a);
    var allEnough = DIMENSIONS.every(function (d) { return stats[d.key].n >= ADAPTIVE.minPerDim; });
    if (allEnough && done >= ADAPTIVE.minTotal) return true;"""
new = """  /** 该维均值是否仍卡在中间带（说明答案分辨不出高低，值得再问） */
  function isUnclear(stat) {
    return stat && stat.mean !== null &&
      stat.mean >= ADAPTIVE.midLow && stat.mean <= ADAPTIVE.midHigh &&
      stat.n < ADAPTIVE.maxPerDim;
  }

  function shouldStop(answers, asked) {
    var a = answers || {};
    var done = answeredCount(a);
    if (done >= ADAPTIVE.maxTotal) return true;
    var stats = dimStats(a);
    var allEnough = DIMENSIONS.every(function (d) { return stats[d.key].n >= ADAPTIVE.minPerDim; });
    if (allEnough && done >= ADAPTIVE.minTotal) {
      // 已经到 48 题：只有当还有维度「说不清」且没到上限时，才继续挖
      var unclear = DIMENSIONS.filter(function (d) { return isUnclear(stats[d.key]); });
      if (!unclear.length || done >= ADAPTIVE.maxTotal) return true;
    }"""
if old in s:
    s = s.replace(old, new, 1)
    print('shouldStop: 已加「中间带继续挖」')
else:
    print('shouldStop: 未匹配')

# 2) ADAPTIVE 增加 maxPerDim
s = s.replace("    minPerDim: 6,      // 每维至少几题（8 维 × 6 = 48，这是我们承诺的下限）",
              "    minPerDim: 6,      // 每维至少几题（8 维 × 6 = 48，这是我们承诺的下限）\n"
              "    maxPerDim: 7,      // 每维最多几题（模糊的维度可以多问一道）", 1)

# 3) 排序：先补缺题，再看「说不清」，最后看均值高低
old_order = """    var order = DIMENSIONS.map(function (d) {
      var s = stats[d.key];
      // 缺题最多的优先；同样缺题时，均值越低（越吃力）越优先；再同则看均值离中间带多近
      var need = Math.max(0, ADAPTIVE.minPerDim - s.n);
      var middle = s.mean === null ? 3 : Math.abs(s.mean - 3);
      return { key: d.key, need: need, mean: s.mean === null ? 3 : s.mean, middle: middle };
    }).sort(function (x, y) {
      if (y.need !== x.need) return y.need - x.need;
      if (x.mean !== y.mean) return x.mean - y.mean;
      return x.middle - y.middle;
    });"""
new_order = """    var order = DIMENSIONS.map(function (d) {
      var st = stats[d.key];
      var need = Math.max(0, ADAPTIVE.minPerDim - st.n);
      var mean = st.mean === null ? 3 : st.mean;
      var middle = Math.abs(mean - 3);
      return { key: d.key, need: need, mean: mean, middle: middle,
               unclear: (need === 0 && isUnclear(st)) ? 1 : 0 };
    }).sort(function (x, y) {
      if (y.need !== x.need) return y.need - x.need;      // 1. 缺题的先补
      if (y.unclear !== x.unclear) return y.unclear - x.unclear;  // 2. 说不清的优先
      if (x.mean !== y.mean) return x.mean - y.mean;      // 3. 偏弱的先问
      return x.middle - y.middle;
    });"""
if old_order in s:
    s = s.replace(old_order, new_order, 1)
    print('排序：已加 unclear 优先级')

io.open(F, 'w', encoding='utf-8').write(s)
