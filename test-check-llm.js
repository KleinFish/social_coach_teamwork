/* 自检脚本自身的测试：node test-check-llm.js
 * 不 spawn 子进程（沙箱会拦管道），直接在进程内起本地 mock 上游，调用 checkLLM()。
 */
'use strict';
const http = require('node:http');
const { checkLLM, hintFor, maskKey } = require('./check-llm.js');
const { LLM_SYSTEM_PROMPT } = require('./server.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n-- ' + t + ' --');

/** 起一个假上游，mode 决定返回什么 */
function startMock(mode) {
  const state = { body: '', auth: '' };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      state.body = raw;
      state.auth = req.headers.authorization || '';
      if (mode === '401') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid api key"}'); return; }
      if (mode === '404') { res.writeHead(404); res.end('not found'); return; }
      if (mode === '500') { res.writeHead(500); res.end('boom'); return; }
      const blocks = [
        { type: 'empathy', text: 'mock 共情' },
        { type: 'analysis', title: '我听到的场景', scene: 'mock 场景', level: 3, factors: [{ text: '人多' }] },
        { type: 'reframe', title: '30 秒', lines: ['换个说法'] },
        { type: 'script', title: '可以直接念的话', groups: [{ label: '开场', items: ['你好'] }] },
        { type: 'checklist', title: '如果还有 3 分钟', items: ['做一件'], hint: '挑一件' }
      ];
      let content;
      if (mode === 'ok') content = JSON.stringify({ blocks });
      else if (mode === 'fenced') content = '```json\n' + JSON.stringify({ blocks }) + '\n```';
      else if (mode === 'notjson') content = '当然可以，我先给你讲个道理……';
      else if (mode === 'badblocks') content = JSON.stringify({ blocks: [{ type: 'encouragement', text: '瞎编的块' }] });
      else if (mode === 'noblocks') content = JSON.stringify({ answer: '没有 blocks 字段' });
      else content = JSON.stringify({ blocks });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: 'mock-model-1',
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 1200, completion_tokens: 300 }
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions',
      state
    }));
  });
}

(async function run() {
  // 单元级：辅助函数
  section('辅助函数');
  ok('maskKey 不泄露完整 Key', maskKey('sk-1234567890abcdef').indexOf('1234567890') === -1, maskKey('sk-1234567890abcdef'));
  ok('maskKey 保留首尾便于核对', /^sk-1\*\*\*\*cdef$/.test(maskKey('sk-1234567890abcdef')), maskKey('sk-1234567890abcdef'));
  ok('短 Key 全遮', maskKey('abc') === '****');
  ok('401 的建议指向 Key', /Key/.test(hintFor(401)));
  ok('404 的建议指向端点/模型 ID', /端点|模型 ID/.test(hintFor(404)));
  ok('500 的建议指向服务商', /服务商/.test(hintFor(500)));

  section('成功路径');
  const m1 = await startMock('ok');
  const r1 = await checkLLM({ endpoint: m1.url, model: 'mock-model', key: 'sk-test', text: '明天面试' });
  ok('正常返回被判定为可用', r1.ok === true && r1.code === 'ok', JSON.stringify(r1).slice(0, 120));
  ok('块数量与类型正确', r1.blocks.length === 5 && r1.blocks[0].type === 'empathy');
  ok('拿到了 token 用量', r1.usage && r1.usage.prompt_tokens === 1200);
  ok('记录了模型名', r1.model === 'mock-model-1');
  ok('记录了耗时', typeof r1.latencyMs === 'number');
  const sent = JSON.parse(m1.state.body);
  ok('请求体用的是服务端同一份系统提示词', sent.messages[0].content === LLM_SYSTEM_PROMPT);
  ok('请求体带 max_tokens=800（与线上一致）', sent.max_tokens === 800, String(sent.max_tokens));
  ok('请求体把用户的场景传进去了', /明天面试/.test(sent.messages[1].content));
  ok('鉴权头是 Bearer Key', m1.state.auth === 'Bearer sk-test', m1.state.auth);
  m1.server.close();

  const m2 = await startMock('fenced');
  const r2 = await checkLLM({ endpoint: m2.url, model: 'm', key: 'k' });
  ok('模型带 ```json 代码块标记也能解析', r2.ok === true && r2.blocks.length === 5);
  m2.server.close();

  section('失败路径：能给出可执行的结论');
  const m3 = await startMock('notjson');
  const r3 = await checkLLM({ endpoint: m3.url, model: 'm', key: 'k' });
  ok('模型不返回 JSON → 明确报 not_json', r3.ok === false && r3.code === 'not_json', r3.code);
  ok('并给出换模型/降温度的建议', /换一个|temperature/.test(r3.detail), r3.detail.slice(0, 60));
  m3.server.close();

  const m4 = await startMock('badblocks');
  const r4 = await checkLLM({ endpoint: m4.url, model: 'm', key: 'k' });
  ok('块类型不合法 → bad_blocks 并指出是哪个', r4.ok === false && r4.code === 'bad_blocks' && /encouragement/.test(r4.detail), r4.code);

  const m5 = await startMock('noblocks');
  const r5 = await checkLLM({ endpoint: m5.url, model: 'm', key: 'k' });
  ok('没有 blocks 数组 → no_blocks', r5.ok === false && r5.code === 'no_blocks', r5.code);

  const m6 = await startMock('401');
  const r6 = await checkLLM({ endpoint: m6.url, model: 'm', key: 'bad' });
  ok('Key 无效 → http_401 且提示查 Key', r6.ok === false && r6.code === 'http_401' && /Key/.test(r6.detail), r6.code);
  m6.server.close();

  const m7 = await startMock('404');
  const r7 = await checkLLM({ endpoint: m7.url, model: '写错的模型', key: 'k' });
  ok('端点/模型错 → http_404 且提示核对地址', r7.ok === false && r7.code === 'http_404' && /端点|模型 ID/.test(r7.detail), r7.code);
  m7.server.close();

  const m8 = await startMock('500');
  const r8 = await checkLLM({ endpoint: m8.url, model: 'm', key: 'k' });
  ok('上游 500 → http_500 且提示稍后重试', r8.ok === false && r8.code === 'http_500', r8.code);
  m8.server.close();

  const r9 = await checkLLM({ endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'm', key: 'k', timeoutMs: 3000 });
  ok('连不上端点 → network 且提示换域名', r9.ok === false && r9.code === 'network' && /network/.test(r9.code), r9.code);

  section('缺配置时的提示');
  const saved = { e: process.env.LLM_ENDPOINT, m: process.env.LLM_MODEL, k: process.env.LLM_API_KEY };
  delete process.env.LLM_ENDPOINT; delete process.env.LLM_MODEL; delete process.env.LLM_API_KEY;
  const r10 = await checkLLM({});
  ok('缺三行 → not_configured 并列出缺哪些',
    r10.ok === false && r10.code === 'not_configured' && /LLM_ENDPOINT/.test(r10.detail) && /LLM_API_KEY/.test(r10.detail),
    r10.detail);
  const r11 = await checkLLM({ endpoint: 'http://x/y', model: '', key: 'k' });
  ok('只缺模型时只报缺模型', /LLM_MODEL/.test(r11.detail) && !/LLM_ENDPOINT/.test(r11.detail), r11.detail);
  if (saved.e !== undefined) process.env.LLM_ENDPOINT = saved.e;
  if (saved.m !== undefined) process.env.LLM_MODEL = saved.m;
  if (saved.k !== undefined) process.env.LLM_API_KEY = saved.k;

  console.log('\n结果：' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试自身异常：', e); process.exit(1); });
