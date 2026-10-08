/* 规则引擎单元测试：node test-engine.js
 * 覆盖报告要求的四条交互原则与四大模块的规则逻辑。 */
'use strict';
const E = require('./coach-engine.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* 1. 场景识别：访谈中的典型场景应被识别出来 */
section('场景识别');
const s1 = E.detectScenes('待会儿要参加一个8人聚餐，其中两个不太熟');
ok('识别出"与不太熟的人吃饭"', s1.length > 0 && s1[0].scene.id === 'eat-unfamiliar', JSON.stringify(s1.map(x => x.scene.id)));
const s2 = E.detectScenes('明天要去面试，是群面，好紧张');
ok('识别出面试类场景', s2.some(x => x.scene.level >= 4), JSON.stringify(s2.map(x => x.scene.id)));
const s3 = E.detectScenes('第一次上台做课堂展示');
ok('识别出展示/发言类场景', s3.length > 0);

/* 2. 压力分级：观众规模/陌生度/当众展示会抬高，熟人会降低 */
section('压力分级');
const base = E.estimatePressure('eat-unfamiliar', '和不太熟的人吃饭', null);
const big = E.estimatePressure('eat-unfamiliar', '8人聚餐，其中两个不太熟，还有陌生人', null);
ok('人多+陌生会抬高压力', big.level > base.level, base.level + ' -> ' + big.level);
const familiar = E.estimatePressure('meeting-speak', '会上发言，但是有室友一起', null);
const lonely = E.estimatePressure('meeting-speak', '会上发言，都是陌生人', null);
ok('有熟人同行会降低压力', familiar.level < lonely.level, familiar.level + ' vs ' + lonely.level);
ok('压力等级落在 1..5', big.level >= 1 && big.level <= 5 && lonely.level >= 1 && lonely.level <= 5);
ok('面试基准压力最高(5)', E.estimatePressure('job-interview', '面试', null).level >= 4);

/* 3. 情绪识别 */
section('情绪识别');
const em = E.detectEmotions('心跳加速，手心出汗，大脑一片空白，事后还一直自责');
ok('识别出生理+认知+反刍', em.labels.length >= 3, JSON.stringify(em.labels.map(l => l.key)));
ok('强度随信号增多而上升', em.intensity >= 3, String(em.intensity));

/* 4. 准备回复：结构完整 + 30 秒调节 + 话术 + 3 分钟清单 */
section('社交前准备模块');
const prep = E.buildPrepReply('待会儿要参加一个8人聚餐，其中两个不太熟，我有点紧张', E.createProfile());
const types = prep.blocks.map(b => b.type);
ok('包含共情/分析/认知重构/呼吸/话术/清单',
  ['empathy', 'analysis', 'reframe', 'breath', 'script', 'checklist'].every(t => types.includes(t)), types.join(','));
ok('准备时长控制在 3 分钟以内(呼吸 30s + 清单提示)',
  prep.blocks.find(b => b.type === 'breath').seconds === 30 &&
  /3 分钟/.test(prep.blocks.find(b => b.type === 'checklist').hint));
ok('话术块含开场/接话/离场兜底', prep.blocks.find(b => b.type === 'script').groups.length >= 4);

/* 5. 应急模块：每个话题都要有一句可直接念的话 */
section('社交中应急模块');
ok('应急话题 >= 6 个', E.EMERGENCY.length >= 6, String(E.EMERGENCY.length));
let allQuick = true;
E.EMERGENCY.forEach(t => {
  const r = E.buildEmergencyReply(t.id, E.createProfile());
  if (!r.blocks.length || !r.blocks[0].quick || !r.blocks[0].quick.length) allQuick = false;
});
ok('每个应急话题都返回可直接念的话术', allQuick);
ok('未知话题安全返回空块', E.buildEmergencyReply('nope', null).blocks.length === 0);

/* 6. 复盘 + 档案 */
section('复盘与成长档案');
let p = E.createProfile();
p = E.addReview(p, E.buildReview({ sceneId: 'meeting-speak', level: 5, triggers: ['人多', '怕说错'], action: '先写三行再发言', effect: 'good', next: '提前一天写结论句' }).record);
p = E.addReview(p, E.buildReview({ sceneId: 'meeting-speak', level: 3, triggers: ['怕说错'], action: '先写三行再发言', effect: 'good', next: '先说结论' }).record);
p = E.addReview(p, E.buildReview({ sceneId: 'party-strangers', level: 2, action: '问了对方周末安排', effect: 'ok' }).record);
const st = E.stats(p);
ok('统计复盘次数', st.count === 3, String(st.count));
ok('平均焦虑计算正确', st.avg === 3.3, String(st.avg));
ok('焦虑曲线下行为 down', st.trend === 'down', st.trend);
ok('有效策略进入策略库', st.strategies === 2, String(st.strategies));
ok('高频场景识别正确', st.topScene === 'meeting-speak', String(st.topScene));
ok('曲线序列长度=复盘数', st.series.length === 3);

/* 7. 交互原则 4：温和引导，不出现"你应该"式指导 */
section('交互原则：温和引导');
const samples = [
  E.buildPrepReply('明天面试', null), E.buildPrepReply('我不想去聚餐', null),
  E.buildEmergencyReply('blank', null), E.buildEmergencyReply('exit', null)
];
const allText = JSON.stringify(samples) + JSON.stringify(E.buildReview({ action: '硬着头皮说话', effect: 'bad' }).summary);
ok('输出中不含"你应该"', allText.indexOf('你应该') === -1);
ok('soften 会替换硬指导句式', E.soften('你应该先冷静').indexOf('你应该') === -1, E.soften('你应该先冷静'));

/* 8. 安全兜底 */
section('安全兜底');
ok('危机信号被拦截', E.safetyCheck('我觉得活着没意思') !== null);
const crisisReply = E.buildPrepReply('我不想活了，什么都撑不下去', null);
ok('危机输入不走话术流程', crisisReply.crisis === true && crisisReply.blocks.length === 1 && crisisReply.blocks[0].type === 'safety');
ok('路由能把危机识别为 crisis', E.route('活着好累') === 'crisis');
ok('路由区分应急与准备', E.route('我现在正在现场，想马上离开') === 'emergency' && E.route('明天要面试') === 'prep');

/* 9. 隐私：画像结构不包含任何身份字段 */
section('隐私优先');
const prof = E.createProfile();
ok('画像默认不含昵称/学号等身份字段', !('name' in prof) && !('studentId' in prof) && Object.keys(prof).sort().join(',') === 'createdAt,reviews,strategies,tendency,updatedAt,version');

/* 10. 画像校验（服务端不信任客户端结构） */
section('画像校验');
const bad = E.validateProfile({ reviews: 'nope', tendency: '攻击者', extra: 1, strategies: [{}] });
ok('不规范输入被规范化而非报错', bad.profile && Array.isArray(bad.profile.reviews) && bad.profile.reviews.length === 0);
ok('非法 tendency 归零', bad.profile.tendency === null);
ok('未知字段被丢弃', bad.profile.extra === undefined);
ok('非对象输入被拒绝', E.validateProfile(null).ok === false && E.validateProfile([]).ok === false);
const longText = E.validateProfile({ reviews: [{ action: 'x'.repeat(1000), level: 99, effect: 'hack' }] }).profile.reviews[0];
ok('超长文本被截断到 300 字', longText.action.length === 300);
ok('越界等级被夹到 1..5', longText.level === 5);
ok('非法 effect 回落为 ok', longText.effect === 'ok');
const many = E.validateProfile({ reviews: Array.from({ length: 900 }, (_, i) => ({ at: '2026-09-01T00:00:00.000Z', sceneId: 'x' + i })) });
ok('超出 500 条上限会报错并截断', many.ok === false && many.profile.reviews.length === 500);

/* 11. 多端合并 */
section('多端合并');
const localOnly = { version: 1, tendency: 'i', updatedAt: '2026-09-05T00:00:00.000Z',
  reviews: [{ at: '2026-09-01T00:00:00.000Z', sceneId: 'meeting-speak', sceneName: '在会议上发言', level: 4, action: '先写三行稿', effect: 'good', triggers: [], next: '', mood: '' }],
  strategies: [{ sceneId: 'meeting-speak', sceneName: '在会议上发言', action: '先写三行稿', at: '2026-09-01T00:00:00.000Z' }] };
const remoteOnly = { version: 1, tendency: 'e', updatedAt: '2026-09-09T00:00:00.000Z',
  reviews: [{ at: '2026-09-07T00:00:00.000Z', sceneId: 'party-strangers', sceneName: '参加多数人陌生的聚会', level: 3, action: '问了对方周末安排', effect: 'good', triggers: [], next: '', mood: '' }],
  strategies: [{ sceneId: 'party-strangers', sceneName: '参加多数人陌生的聚会', action: '问了对方周末安排', at: '2026-09-07T00:00:00.000Z' }] };
const merged = E.mergeProfiles(localOnly, remoteOnly);
ok('两端记录都保留（2 条）', merged.reviews.length === 2, String(merged.reviews.length));
ok('按时间升序排列', merged.reviews[0].at < merged.reviews[1].at);
ok('策略库由合并结果重建（2 条，不重复）', merged.strategies.length === 2);
ok('画像倾向取更新的一端（remote=e）', merged.tendency === 'e', String(merged.tendency));
const dup = E.mergeProfiles(localOnly, localOnly);
ok('相同记录不会重复计入', dup.reviews.length === 1 && dup.strategies.length === 1, JSON.stringify(dup.reviews.length));
ok('合并不修改入参', localOnly.reviews.length === 1 && remoteOnly.reviews.length === 1);
ok('sameProfile 能识别等价画像', E.sameProfile(merged, E.mergeProfiles(remoteOnly, localOnly)) === true);
ok('sameProfile 能识别差异', E.sameProfile(localOnly, remoteOnly) === false);

console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
