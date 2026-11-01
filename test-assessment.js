/* 社交画像量表单元测试：node test-assessment.js
 * 重点：题量与结构、反向计分、场景预测的单调性、与 coach-engine 场景/应急条目的一致性。
 */
'use strict';
const A = require('./assessment.js');
const E = require('./coach-engine.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n== ' + t + ' ==');

/* level=5 表示"每个维度都满分"，level=1 表示"每个维度都零分" */
function answersAt(level) {
  const a = {};
  A.ITEMS.forEach((it) => { a[it.id] = it.reverse ? (6 - level) : level; });
  return a;
}

section('量表结构');
ok('题目数量不少于 90（题库已扩容）', A.itemCount() >= 90, String(A.itemCount()));
ok('题目数量正好 96（8 维 × 12 题）', A.itemCount() === 96, String(A.itemCount()));
ok('维度数量为 8', A.DIMENSIONS.length === 8);
ok('题目 id 唯一', new Set(A.ITEMS.map((i) => i.id)).size === A.ITEMS.length);
let perDimOk = true, reverseOk = true;
A.DIMENSIONS.forEach((d) => {
  const items = A.ITEMS.filter((i) => i.dim === d.key);
  if (items.length !== 12) perDimOk = false;
  if (!items.some((i) => i.reverse)) reverseOk = false;
});
ok('每个维度恰好 12 题', perDimOk);
ok('每个维度都含反向计分题', reverseOk);
ok('每题都绑定到已定义的维度', A.ITEMS.every((i) => A.DIMENSIONS.some((d) => d.key === i.dim)));
ok('自评选项为 5 级', A.LIKERT.length === 5 && A.LIKERT[0].value === 1 && A.LIKERT[4].value === 5);

section('反向计分');
const strong = A.score(answersAt(5), { scenes: E.SCENES });
const weak = A.score(answersAt(1), { scenes: E.SCENES });
ok('正向作答者每个维度都是 100', A.DIMENSIONS.every((d) => strong.dimensions[d.key] === 100),
  JSON.stringify(strong.dimensions));
ok('负向作答者每个维度都是 0', A.DIMENSIONS.every((d) => weak.dimensions[d.key] === 0),
  JSON.stringify(weak.dimensions));
ok('正向作答者准备度 100', strong.readiness === 100);
ok('负向作答者准备度 0', weak.readiness === 0);
const mixed = {};
A.ITEMS.forEach((it) => { mixed[it.id] = it.dim === 'publicspeaking' ? (it.reverse ? 5 : 1) : (it.reverse ? 1 : 5); });
const m = A.score(mixed, { scenes: E.SCENES });
ok('混合作答能区分出维度差异（当众表达=0，其余=100）',
  m.dimensions.publicspeaking === 0 && m.dimensions.group === 100, JSON.stringify(m.dimensions));
ok('准备度等于各维度均值', m.readiness === 88, String(m.readiness));

section('边界与效度');
ok('全部选同一档会被标记为不可靠', A.score(answersAt(3)).flat === true);
ok('正常作答不会被标记', strong.flat === false);
const partial = {};
partial[A.ITEMS[0].id] = 5;
const p = A.score(partial);
ok('未答完时 answered 计数正确', p.answered === 1, String(p.answered));
ok('未答的维度为 null', p.dimensions.smalltalk === null);
ok('没有任何作答时准备度为 null', A.score({}).readiness === null);
ok('分数被夹在 0–100', A.DIMENSIONS.every((d) => strong.dimensions[d.key] >= 0 && strong.dimensions[d.key] <= 100));

section('与 coach-engine 的一致性');
const sceneIds = E.SCENES.map((s) => s.id);
const weightKeys = Object.keys(A.SCENE_WEIGHTS);
ok('预测权重没有多余场景', weightKeys.every((k) => sceneIds.includes(k)),
  weightKeys.filter((k) => !sceneIds.includes(k)).join(','));
ok('预测权重覆盖全部场景', sceneIds.every((k) => weightKeys.includes(k)),
  sceneIds.filter((k) => !weightKeys.includes(k)).join(','));
let weightSumOk = true;
weightKeys.forEach((k) => {
  const sum = Object.values(A.SCENE_WEIGHTS[k]).reduce((x, y) => x + y, 0);
  if (Math.abs(sum - 1) > 0.01) weightSumOk = false;
});
ok('每个场景的维度权重之和为 1', weightSumOk);
ok('权重只引用已定义维度',
  weightKeys.every((k) => Object.keys(A.SCENE_WEIGHTS[k]).every((d) => A.DIMENSIONS.some((x) => x.key === d))));
ok('推荐的应急入口都真实存在',
  Object.values(A.SCENE_WEIGHTS).length > 0 &&
  Object.keys(A.DIM_EMERGENCY).every((d) => E.EMERGENCY.some((t) => t.id === A.DIM_EMERGENCY[d])));

section('场景预测');
ok('预测覆盖全部 13 个场景', strong.scenes.length === sceneIds.length, String(strong.scenes.length));
ok('强画像（全 100）所有场景难度都不高', strong.scenes.every((s) => s.difficulty <= 3.2),
  JSON.stringify(strong.scenes.map((s) => s.difficulty)));
ok('弱画像（全 0）所有场景难度都偏高', weak.scenes.every((s) => s.difficulty >= 3.0),
  JSON.stringify(weak.scenes.map((s) => s.difficulty)));
ok('难度落在 1–5 之间',
  strong.scenes.concat(weak.scenes).every((s) => s.difficulty >= 1 && s.difficulty <= 5));
ok('同一场景上弱画像比强画像更难',
  sceneIds.every((id) => {
    const a = weak.scenes.find((s) => s.id === id).difficulty;
    const b = strong.scenes.find((s) => s.id === id).difficulty;
    return a > b;
  }));
const neutral = A.score(answersAt(3)).dimensions;   // 全 3 分 → 各维度 50
const neutralPred = A.predictScenes(neutral, E.SCENES);
const sortedByLevel = [...neutralPred].sort((a, b) => a.level - b.level).map((s) => s.id);
ok('能力中性时，预测难度顺序与访谈的基准压力排序一致',
  JSON.stringify(neutralPred.map((s) => s.id)) === JSON.stringify(sortedByLevel),
  JSON.stringify(neutralPred.map((s) => s.id)) + ' vs ' + JSON.stringify(sortedByLevel));
const jobInterview = weak.scenes.find((s) => s.id === 'job-interview');
ok('预测带有可读的依据', jobInterview.reasons.length >= 2 && /基准压力 5\/5/.test(jobInterview.reasons.join(' ')),
  JSON.stringify(jobInterview.reasons));
ok('预测带有可执行建议', typeof jobInterview.tip === 'string' && jobInterview.tip.length > 5);
ok('每条预测都有分档标签', strong.scenes.every((s) => ['较擅长', '一般', '偏吃力', '很吃力'].includes(s.bandLabel)));

section('强弱场景与维度排序');
const splitStrong = A.splitScenes(strong.scenes);
const splitWeak = A.splitScenes(weak.scenes);
ok('强画像有"较擅长"场景', splitStrong.strengths.length > 0, String(splitStrong.strengths.length));
ok('强画像没有"偏吃力"场景', splitStrong.challenges.length === 0, String(splitStrong.challenges.length));
ok('弱画像有"偏吃力/很吃力"场景', splitWeak.challenges.length > 0, String(splitWeak.challenges.length));
const rank = A.rankDimensions(m.dimensions);
ok('维度排序把最弱项排在前面', rank.weakest[0].key === 'publicspeaking', JSON.stringify(rank.weakest.map((x) => x.key)));
ok('推荐应急入口来自最弱维度', A.recommendEmergency(m.dimensions) === 'called', A.recommendEmergency(m.dimensions));

section('文字总结');
const summary = A.summarize(strong);
ok('总结非空且包含准备度', summary.length >= 2 && /准备度 100/.test(summary.join('')));
ok('总结提示了不可靠作答', A.summarize(A.score(answersAt(3))).join('').includes('同一档'));
ok('总结与免责声明不含"你应该"',
  (summary.join('') + A.DISCLAIMER).indexOf('你应该') === -1);

/* ------------------------------------------------------------------ *
 * 自适应选题（分层 / 序贯分配）
 * ------------------------------------------------------------------ */
section('自适应选题');
{
  const start = A.adaptiveStart();
  ok('首块 12 题', start.length === 12, String(start.length));
  const dimsCovered = new Set(start.map((id) => A.ITEMS.filter((i) => i.id === id)[0].dim));
  ok('首块覆盖全部 8 个维度', dimsCovered.size === 8, String(dimsCovered.size));
  ok('首块含反向计分题', start.some((id) => A.ITEMS.filter((i) => i.id === id)[0].reverse));
  ok('首块无重复题', new Set(start).size === start.length);

  /* 一路答 3 分（最模糊）→ 应当每题都问到、也应当能自己停 */
  let answers = {}, asked = start.slice();
  start.forEach((id) => { answers[id] = 3; });
  let block = A.adaptiveNext(answers, asked);
  let rounds = 0;
  while (block.length && rounds < 20) {
    block.forEach((id) => { answers[id] = 3; asked.push(id); });
    block = A.adaptiveNext(answers, asked);
    rounds++;
  }
  const done = Object.keys(answers).length;
  ok('答完自动停止', A.shouldStop(answers, asked));
  ok('总题数落在 48–56 之间', done >= 48 && done <= A.ADAPTIVE.maxTotal, String(done));
  ok('比完整版 96 题更短，但不少于 48 题', done < A.ITEMS.length && done >= 48, String(done));
  const st = A.dimStats(answers);
  ok('停止时每个维度至少 6 题',
    A.DIMENSIONS.every((d) => st[d.key].n >= A.ADAPTIVE.minPerDim),
    A.DIMENSIONS.map((d) => st[d.key].n).join(','));
  ok('自适应结果也能出完整画像',
    A.score(answers).dimensions && Object.keys(A.score(answers).dimensions).length === 8);

  /* 确定性：同一份作答序列，选题结果必须完全一样 */
  const again = A.adaptiveNext({ ...answers, i1: undefined }, []);
  const again2 = A.adaptiveNext({ ...answers, i1: undefined }, []);
  ok('选题结果确定（两次完全相同）', JSON.stringify(again) === JSON.stringify(again2));

  /* 反向题偏好：其余维度都答满，只留「当众表达」答两道且卡在中间带 */
  const midAnswers = {};
  A.DIMENSIONS.forEach((d) => {
    const pool = A.ITEMS.filter((it) => it.dim === d.key && !it.reverse);
    if (d.key === 'publicspeaking') {
      midAnswers[pool[0].id] = 3;
      midAnswers[pool[1].id] = 3;
    } else {
      pool.slice(0, 3).forEach((it) => { midAnswers[it.id] = 4; });
    }
  });
  const midNext = A.adaptiveNext(midAnswers, Object.keys(midAnswers));
  const midItems = midNext.map((id) => A.ITEMS.filter((i) => i.id === id)[0]);
  const hasMidReverse = midItems.some((it) => it.dim === 'publicspeaking' && it.reverse);
  ok('中间值维度会优先补反向题（防一路点同意）', hasMidReverse, JSON.stringify(midItems.map((i) => i.id)));

  /* 进度估算 */
  const prog = A.adaptiveStatus(answers, asked);
  ok('进度信息带剩余估算', typeof prog.remainingEstimate === 'number' && prog.remainingEstimate >= 0);
  ok('进度信息带每维题数', prog.perDim && prog.perDim.initiating && typeof prog.perDim.initiating.n === 'number');

  /* 给大模型的画像摘要 */
  const brief = A.promptBrief(A.score(answers));
  ok('画像摘要非空且含准备度', /自评准备度/.test(brief), brief);
  ok('画像摘要不提分数以外的细节（≤80 字）', brief.length <= 80, String(brief.length));
  ok('没画像时摘要为空', A.promptBrief(null) === '');
}

console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
