/*!
 * check-llm.js —— 大模型接入自检（在本地跑，不用部署）
 *
 * 去 Render 填环境变量之前，先确认三件事：
 *   ① 端点地址对不对（看 HTTP 状态码）
 *   ② Key 能不能用（401/403 会直接告诉你）
 *   ③ 这个模型会不会按我们要求的 JSON 结构回答（换模型最常见的坑）
 *
 * 用法（PowerShell，Windows）：
 *   $env:LLM_ENDPOINT="https://api.siliconflow.cn/v1/chat/completions"
 *   $env:LLM_MODEL="deepseek-ai/DeepSeek-V3"
 *   $env:LLM_API_KEY="sk-你的key"
 *   node check-llm.js
 *
 * 也可以指定测试句：
 *   node check-llm.js --text "明天要跟导师汇报，有点慌"
 *
 * 退出码：0 = 可以用；1 = 有问题（会打印原因和排查建议）
 */
'use strict';

const { LLM_SYSTEM_PROMPT, LLM_BLOCK_TYPES } = require('./server.js');

const DEFAULT_TEXT = '我不确定该不该去这个聚餐，其实我有点累，但又怕错过认识人的机会。';

/** 按状态码给出可执行的排查建议 */
function hintFor(status) {
  if (status === 401 || status === 403) return 'Key 无效、没权限，或被服务商禁用；请回控制台重新复制一次。';
  if (status === 404) return '端点地址或模型 ID 写错：端点要能接 /chat/completions，模型 ID 要和模型中心完全一致。';
  if (status === 429) return '被限流或额度用完了：等一会儿，或去服务商控制台看余额。';
  if (status === 400) return '请求被拒：最常见是模型 ID 写错，或这个模型不支持 /chat/completions。';
  if (status >= 500) return '服务商那边出错了，稍后重试；也可以换个模型试试。';
  return '检查端点地址是否完整（必须以 /chat/completions 结尾）。';
}

function maskKey(k) {
  const s = String(k || '');
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

/**
 * 做一次真实调用并校验返回结构。
 * 返回 {ok, code, detail, status, latencyMs, blocks, usage, model}
 */
async function checkLLM(opts) {
  const o = opts || {};
  const endpoint = o.endpoint || process.env.LLM_ENDPOINT || '';
  const model = o.model || process.env.LLM_MODEL || '';
  const key = o.key || process.env.LLM_API_KEY || '';
  const text = o.text || DEFAULT_TEXT;
  const timeoutMs = o.timeoutMs || 30000;

  if (!endpoint || !model || !key) {
    const missing = [];
    if (!endpoint) missing.push('LLM_ENDPOINT');
    if (!model) missing.push('LLM_MODEL');
    if (!key) missing.push('LLM_API_KEY');
    return { ok: false, code: 'not_configured', detail: '缺少环境变量：' + missing.join(' / ') };
  }

  const body = {
    model: model,
    temperature: 0.6,
    max_tokens: 800,
    messages: [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: '我的场景：' + text + '\n（画像：未设置）' }
    ]
  };

  const t0 = Date.now();
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const reason = (e && e.cause && e.cause.code) || (e && e.name) || 'unknown';
    return {
      ok: false,
      code: 'network',
      detail: '连不上端点（' + reason + '）。检查地址拼写、是否需要代理，或换 api.siliconflow.com 试试。'
    };
  }
  const latencyMs = Date.now() - t0;
  const raw = await resp.text();

  if (!resp.ok) {
    let detail = raw.slice(0, 300);
    try { detail = JSON.stringify(JSON.parse(raw)).slice(0, 300); } catch (e) { /* 保留原文 */ }
    return {
      ok: false,
      code: 'http_' + resp.status,
      status: resp.status,
      latencyMs: latencyMs,
      detail: 'HTTP ' + resp.status + '：' + detail + '\n建议：' + hintFor(resp.status)
    };
  }

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    return { ok: false, code: 'bad_response', status: resp.status, detail: '返回的不是 JSON（可能地址指到了网页）。' };
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    return { ok: false, code: 'empty', status: resp.status, detail: '返回里没有 choices[0].message.content，可能这个端点不是 OpenAI 兼容格式。' };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(content).replace(/```json/g, '').replace(/```/g, '').trim());
  } catch (e) {
    return {
      ok: false,
      code: 'not_json',
      status: resp.status,
      latencyMs: latencyMs,
      detail: '模型没有按要求返回 JSON。原文前 200 字：' + String(content).slice(0, 200) +
        '\n建议：换一个更会遵循指令的模型（DeepSeek 系列通常没问题），或把 temperature 调低。'
    };
  }

  const blocks = Array.isArray(parsed && parsed.blocks) ? parsed.blocks : null;
  if (!blocks || !blocks.length) {
    return { ok: false, code: 'no_blocks', status: resp.status, latencyMs: latencyMs, detail: 'JSON 里没有非空的 blocks 数组。' };
  }
  const unknown = blocks.filter((b) => !b || !LLM_BLOCK_TYPES[b.type]).map((b) => (b && b.type) || '(空)');
  if (unknown.length) {
    return {
      ok: false,
      code: 'bad_blocks',
      status: resp.status,
      latencyMs: latencyMs,
      blocks: blocks,
      detail: '出现了不认识的块类型：' + unknown.join(', ') + '（允许：' + Object.keys(LLM_BLOCK_TYPES).join(', ') + '）'
    };
  }

  return {
    ok: true,
    code: 'ok',
    status: resp.status,
    latencyMs: latencyMs,
    model: (data && data.model) || model,
    blocks: blocks,
    usage: data && data.usage,
    content: content
  };
}

/* ---------------- 命令行输出 ---------------- */
function dumpBlocks(blocks) {
  const lines = [];
  blocks.forEach((b, i) => {
    lines.push('  ' + (i + 1) + '. [' + b.type + ']');
    if (b.text) lines.push('     ' + b.text);
    if (b.title) lines.push('     标题：' + b.title);
    if (b.scene) lines.push('     场景：' + b.scene + (b.level ? ' · ' + b.level + '/5' : ''));
    (b.factors || []).forEach((f) => lines.push('     · ' + (f.text || f)));
    (b.lines || []).forEach((t) => lines.push('     · ' + t));
    (b.groups || []).forEach((g) => {
      lines.push('     [' + g.label + ']');
      (g.items || []).forEach((it) => lines.push('       - ' + it));
    });
    (b.items || []).forEach((it) => lines.push('     · ' + it));
  });
  return lines.join('\n');
}

async function main(argv) {
  const args = argv.slice(2);
  const textIdx = args.indexOf('--text');
  const text = textIdx >= 0 ? args[textIdx + 1] : '';
  const asJson = args.indexOf('--json') >= 0;

  const endpoint = process.env.LLM_ENDPOINT || '';
  const model = process.env.LLM_MODEL || '';
  const key = process.env.LLM_API_KEY || '';

  if (asJson) {
    const r = await checkLLM({ text: text || undefined });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  console.log('== 大模型接入自检 ==');
  console.log('端点：' + (endpoint || '(未设置 LLM_ENDPOINT)'));
  console.log('模型：' + (model || '(未设置 LLM_MODEL)'));
  console.log('Key ：' + (key ? maskKey(key) : '(未设置 LLM_API_KEY)'));
  console.log('测试句：' + (text || DEFAULT_TEXT));
  console.log('---');

  const r = await checkLLM({ text: text || undefined });

  if (r.code === 'not_configured') {
    console.log('[✗] ' + r.detail);
    console.log('\n请先设置三行环境变量（PowerShell）：');
    console.log('  $env:LLM_ENDPOINT="https://api.siliconflow.cn/v1/chat/completions"');
    console.log('  $env:LLM_MODEL="deepseek-ai/DeepSeek-V3"');
    console.log('  $env:LLM_API_KEY="sk-你的key"');
    process.exit(1);
  }

  if (!r.ok) {
    console.log('[✗] 失败：' + r.code);
    console.log(r.detail);
    process.exit(1);
  }

  console.log('[✓] HTTP ' + r.status + '，用时 ' + (r.latencyMs / 1000).toFixed(1) + ' 秒');
  console.log('[✓] 返回了可解析的 JSON，共 ' + r.blocks.length + ' 个块：' + r.blocks.map((b) => b.type).join(' / '));
  console.log('[✓] 所有块类型都在约定范围内');
  if (r.usage) {
    const inTok = r.usage.prompt_tokens || r.usage.input_tokens || 0;
    const outTok = r.usage.completion_tokens || r.usage.output_tokens || 0;
    console.log('[i] 本次消耗：输入 ' + inTok + ' token / 输出 ' + outTok + ' token');
    const total = (inTok + outTok) * 1000;
    const human = total >= 1e6 ? (total / 1e6).toFixed(1) + 'M' : Math.round(total / 1e3) + 'k';
    console.log('    最坏情况估算：若每天 1000 次额度全部用满、每次都这么长，约 ' + human + ' token；实际用量通常远低于此。');
    console.log('    换算成钱时用你服务商的单价乘一下即可（比如每百万 token 2 元 → 最坏约 ' + (total / 1e6 * 2).toFixed(1) + ' 元/天，实际通常几毛到几元）。');
  }
  console.log('\n模型实际回复的结构：');
  console.log(dumpBlocks(r.blocks));
  console.log('\n结论：这套配置可以用 ✓  去 Render 的 Environment 里填这三行即可。');
  process.exit(0);
}

if (require.main === module) {
  main(process.argv).catch((e) => {
    console.error('自检脚本自身出错：', e);
    process.exit(1);
  });
}

module.exports = { checkLLM, hintFor, maskKey, DEFAULT_TEXT, main, dumpBlocks };
