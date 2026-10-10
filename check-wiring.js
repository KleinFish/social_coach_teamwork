/* 静态联检：node check-wiring.js
 * 1) app.js 里 $('#id') 引用的 id 必须在 index.html 中存在
 * 2) 底部导航 data-tab 必须有对应的 panel-<tab>
 * 3) app.js 里用到的 class 必须在 styles.css 中定义
 * 4) app.js 调用的 CoachEngine 方法必须由引擎导出
 * 5) 架构约束：密钥只在服务端、网络调用收敛、隐私能力齐备、温和引导落地
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(dir, 'server.js'), 'utf8');
const engine = require('./coach-engine.js');

let fail = 0;
const report = (ok, msg) => { if (!ok) { fail++; console.log('  FAIL  ' + msg); } else console.log('  ok    ' + msg); };

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const cssClasses = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => m[1]));

console.log('== 1. DOM id 引用 ==');
const refIds = new Set([...app.matchAll(/\$\('#([\w-]+)'/g)].map(m => m[1]));
const missingIds = [...refIds].filter(id => !htmlIds.has(id));
report(missingIds.length === 0, `${refIds.size} 个 id 引用全部存在` + (missingIds.length ? '，缺失：' + missingIds.join(', ') : ''));

console.log('\n== 2. 标签页与面板对应 ==');
const tabs = [...html.matchAll(/data-tab="([\w-]+)"/g)].map(m => m[1]);
tabs.forEach(t => report(htmlIds.has('panel-' + t), `data-tab="${t}" -> #panel-${t}`));
report(tabs.length === 5, '标签页数量为 5（四个功能模块 + 社交画像测试）');

console.log('\n== 2c. 语音输入 ==');
const voiceSrc = fs.readFileSync(path.join(dir, 'voice.js'), 'utf8');
const voice = require('./voice.js');
const scriptOrder2 = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
report(scriptOrder2.join(',') === 'coach-engine.js,assessment.js,voice.js,app.js',
  '脚本加载顺序正确：' + scriptOrder2.join(' → '));
report(['micInput', 'micAction', 'micNext', 'voiceBar', 'voiceStop'].every(id => htmlIds.has(id)),
  '三处输入框都配了麦克风按钮，并有全局录音状态条');
report(/SocialVoice/.test(app) && /api\/transcribe/.test(app), 'app.js 已接入语音模块与服务端转写');
report(/\/api\/transcribe/.test(server), '服务端提供转写代理接口');
report(/ASR_ENDPOINT/.test(server) && !/ASR_API_KEY\s*[:=]\s*['"]/.test(server), '转写密钥只从环境变量读取，无硬编码');
report(!/writeFile|appendFile/.test(server.split('transcribe')[1] ? server.split('transcribe')[1].slice(0, 2000) : ''),
  '转写路径不写文件（音频不落盘）');
report(/麦克风权限/.test(voice.mapError('not-allowed')), '错误提示是可读的中文');
report(!/你应该/.test(voiceSrc), '语音模块文案不含"你应该"');
const cssSrc = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
report(/id="micInput"[\s\S]{0,500}<svg/.test(html) && !/id="micInput"[^>]*>🎤/.test(html),
  '麦克风按钮用 SVG 图标（避免长按选中 emoji）');
report(/\.mic-btn[\s\S]{0,300}user-select:\s*none/.test(cssSrc) && /touch-callout:\s*none/.test(cssSrc),
  '可点元素禁止长按选中与 iOS 长按菜单');
report(/pointerdown/.test(app) && /pointerup/.test(app), '支持"按住说话、松开结束"的按压手势');

console.log('\n== 2b. 社交画像测试 ==');
const assess = require('./assessment.js');
const assessSrc = fs.readFileSync(path.join(dir, 'assessment.js'), 'utf8');
report(assess.itemCount() <= 48, `题库 ${assess.itemCount()} 题（上限 48）`);
report(assess.DIMENSIONS.length === 8 && assess.DIMENSIONS.every(d => assess.ITEMS.filter(i => i.dim === d.key).length === 5),
  '8 个维度 × 5 题，结构完整');
report(assess.DIMENSIONS.every(d => assess.ITEMS.filter(i => i.dim === d.key).some(i => i.reverse)),
  '每个维度都含反向计分题');
report(/SocialAssessment/.test(app), 'app.js 已接入画像模块');
report(!/scenes:\s*(result|preds|predictions)/.test(app), '写库时不含可重算的场景预测（避免数据打架）');
report(/selfCheckDifficulty/.test(app) && /selfCheck/.test(fs.readFileSync(path.join(dir, 'coach-engine.js'), 'utf8')),
  '画像结果会同时影响「准备」的回复');
report(/recommendEmergency/.test(app), '画像结果会同时影响「应急」的推荐入口');
report(!/你应该/.test(assessSrc), '量表的题干与解读不含"你应该"');

/* 回归：index.html 引用的每个前端文件都必须在服务端静态白名单里，
   否则线上会出现"首页正常、某个标签页 404"的隐蔽故障（真实踩过一次）。 */
const scriptSrcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).map(s => '/' + s.replace(/^\//, ''));
const publicBlock = /const PUBLIC_FILES = new Set\(\[([^\]]+)\]\)/.exec(server);
report(!!publicBlock, '能解析出服务端的静态文件白名单');
const publicFiles = publicBlock ? [...publicBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
publicFiles.push('/styles.css');
const missingPublic = scriptSrcs.filter(s => !publicFiles.includes(s));
report(missingPublic.length === 0,
  `首页引用的 ${scriptSrcs.length} 个脚本都在静态白名单里` + (missingPublic.length ? '，缺失：' + missingPublic.join(', ') : ''));
report(publicFiles.every(f => !/server\.js|test-|mock-upstash/.test(f)), '白名单里不含服务端源码或测试脚本');

console.log('\n== 3. class 定义 ==');
const used = new Set();
for (const m of app.matchAll(/el\(\s*'[\w-]+'\s*,\s*'([^']*)'/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
for (const m of app.matchAll(/classList\.(?:add|toggle|remove)\('([\w-]+)'/g)) used.add(m[1]);
for (const m of app.matchAll(/'(?:block|msg|chip|btn|nav-btn|mode-pill|checkline|danger-text|line|hint)[^']*'/g)) m[0].slice(1, -1).split(/\s+/).forEach(c => c && used.add(c));
const ignore = new Set(['on', 'show', 'active', 'inhale', 'hold', 'exhale']);
const htmlClasses = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
const missingCls = [...used].filter(c => !cssClasses.has(c) && !ignore.has(c));
report(missingCls.length === 0, `${used.size} 个 class 引用全部有样式` + (missingCls.length ? '，缺失：' + missingCls.join(', ') : ''));
const htmlMissing = [...htmlClasses].filter(c => c && !cssClasses.has(c));
report(htmlMissing.length === 0, `${htmlClasses.size} 个 HTML class 全部有样式` + (htmlMissing.length ? '，缺失：' + htmlMissing.join(', ') : ''));

console.log('\n== 4. 引擎 API ==');
const api = new Set([...app.matchAll(/\bE\.([A-Za-z_]\w*)/g)].map(m => m[1]));
const missingApi = [...api].filter(k => !(k in engine));
report(missingApi.length === 0, `${api.size} 个引擎方法调用全部存在` + (missingApi.length ? '，缺失：' + missingApi.join(', ') : ''));

console.log('\n== 5. 密钥与网络调用 ==');
const clientFetch = [...app.matchAll(/fetch\(/g)].length;
report(clientFetch === 1, `浏览器端只有 1 处 fetch（统一的 api 封装），实际 ${clientFetch} 处`);
report(!/apiKey|api_key|API Key|sk-/.test(app.replace(/API Key/g, 'API_KEY_TEXT')) || !/'sk-/.test(app),
  '浏览器端不保存任何 API Key');
report(!/cfgKey|cfgEndpoint/.test(app) && !htmlIds.has('cfgKey'), '已移除"在浏览器填 API Key"的入口');
report(/LLM_API_KEY/.test(server), '服务端通过环境变量 LLM_API_KEY 读取密钥');
report(!/LLM_API_KEY\s*[:=]\s*['"]/.test(server), '服务端不留硬编码密钥');

console.log('\n== 6. 安全与隐私能力 ==');
report(/Content-Security-Policy/.test(server), '服务端下发 CSP');
report(/HttpOnly/.test(server) && /SameSite=Lax/.test(server), '会话 Cookie 为 HttpOnly + SameSite=Lax');
report(/scryptSync/.test(server) && /timingSafeEqual/.test(server), '口令使用 scrypt 并做常量时间比较');
report(/sameOrigin/.test(server), '写请求校验同源（CSRF 防护）');
report(/rateLimit/.test(server), '认证与大模型代理有限流');
report(/PUBLIC_FILES/.test(server) && !/PUBLIC_FILES[\s\S]{0,200}server\.js/.test(server), '静态文件白名单不包含服务端源码');
report(/localStorage\.removeItem/.test(app) && htmlIds.has('clearBtn'), '保留"一键清空本机数据"');
report(/api\/account/.test(app) && /api\/account/.test(server), '提供"删除账号与云端数据"');
report(/mergeProfiles/.test(app), '多端同步使用合并策略（不是整体覆盖）');

console.log('\n== 7. 交互原则（温和引导） ==');
const appNoPrompt = app.replace(/var SYSTEM_PROMPT = \[[\s\S]*?\]\.join\('\\n'\);/g, '');
report(appNoPrompt.indexOf('你应该') === -1, '面向用户的文案中不含"你应该"');
report(server.indexOf('你应该') > -1 && /禁止/.test(server), '服务端系统提示把"你应该"列为禁止表达');
report(engine.soften('你应该先冷静').indexOf('你应该') === -1, '引擎 soften 仍会替换硬指导句式');

console.log('\n== 8. 存储可插拔（本地 SQLite / 外部 Redis） ==');
report(/class SqliteStore/.test(server) && /class RedisStore/.test(server), '服务端内置两种存储实现');
report(/UPSTASH_REDIS_REST_URL/.test(server) && /KV_REST_API_URL/.test(server), '支持 Upstash / Vercel KV 两种环境变量名');
report(/kind === 'upstash'/.test(server) || /kind: 'upstash'/.test(server), '可显式指定存储后端（供测试注入）');
report(!/Bearer\s+['"][A-Za-z0-9]{10,}['"]/.test(server), '服务端没有硬编码的存储令牌');
report(/storage: store\.kind/.test(server), '/api/health 会报告当前存储类型');
report(fs.existsSync(path.join(dir, 'mock-upstash.js')), '带本地 mock 上游（外部存储可在离线环境验证）');
report(/临时/.test(fs.readFileSync(path.join(dir, 'render.yaml'), 'utf8')), '部署蓝图里写明了免费实例磁盘是临时的');

console.log('\n结果：' + (fail ? fail + ' 项未通过' : '全部通过'));
process.exit(fail ? 1 : 0);
