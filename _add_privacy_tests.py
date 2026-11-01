# -*- coding: utf-8 -*-
"""给 test-server 加「场景骨架化」的隐私测试"""
import io

F = 'test-server.js'
s = io.open(F, encoding='utf-8').read()

# 1) mock 新增两个模式
anchor = "      else if (mode === 'learnbad') { payload.newScene = Object.assign({}, goodScene, { name: '面试' }); content = JSON.stringify(payload); }"
if "mode === 'learnprivacy'" not in s:
    add = (anchor + "\n"
           "      else if (mode === 'learnprivacy') {\n"
           "        payload.newScene = Object.assign({}, goodScene, {\n"
           "          name: '深夜便利店遇熟人',\n"
           "          aliases: ['我昨天那场', '2026迎新', '便利店', 'xq'],\n"
           "          stressor: '昨天我在楼下便利店碰到同层熟人，想躲又尴尬'\n"
           "        });\n"
           "        content = JSON.stringify(payload);\n"
           "      } else if (mode === 'learnprivacy2') {\n"
           "        payload.newScene = Object.assign({}, goodScene, {\n"
           "          name: '深夜在便利店遇到熟人的那一刻',\n"
           "          aliases: ['我那天', '2026级', 'xq']\n"
           "        });\n"
           "        content = JSON.stringify(payload);\n"
           "      }")
    s = s.replace(anchor, add, 1)
    print('mock: 已加 learnprivacy / learnprivacy2')
else:
    print('mock: 已存在')

# 2) 测试段：插在「不合规的新场景」循环之前
anchor2 = "  // 不合规的新场景不该污染场景库"
BLOCK = '''  /* 隐私：学到的场景进公共库，所以只存「骨架」 */
  section('场景库的隐私（只存骨架，不留原话）');
  {
    const pm = await startMock('learnprivacy');
    const pa = createApp({ dataDir: tempDir('scenes-privacy'), llm: { endpoint: pm.url, model: 'm', key: 'k' } });
    await startServer(pa);
    try {
      const P = jar();
      await P.post('/api/auth/register', { username: '隐私同学', password: 'password999' });
      const pr = await P.post('/api/coach', { text: '昨天我在楼下便利店碰到同层熟人，想躲又不好意思' });
      ok('场景仍然学得会（骨架可用）', !!(pr.data.learned && pr.data.learned.isNew), JSON.stringify(pr.data && pr.data.learned));
      const pub = await (await fetch(base + '/api/scenes')).json();
      const sc = pub.scenes[0] || {};
      ok('带人称/数字/英文的别名被丢弃，只留通用别名',
        Array.isArray(sc.aliases) && sc.aliases.join('|') === '便利店', JSON.stringify(sc.aliases));
      ok('含「我/昨天」的压力来源被换成通用表述',
        !/我|昨天/.test(sc.stressor || '') && /这类场景/.test(sc.stressor || ''), sc.stressor);
      ok('通用建议（话术/清单）保留，离线也能用',
        sc.scripts && sc.scripts.open && sc.scripts.open.length > 0 && sc.checklist.length > 0);
      const prompt = startMock.lastBody || '';
      ok('提示词要求模型不要复述用户原话', /不要复述用户原话/.test(prompt));
      ok('提示词说明 newScene 会进公共库、要求通用说法', /公共场景库/.test(prompt) && /通用说法/.test(prompt));
      ok('场景库无需登录即可读取（公共库，已在声明里写明）', pub.learnedCount === 1);
    } finally { await stopServer(pa); pm.server.close(); base = mainBase; }
  }
  {
    const pm2 = await startMock('learnprivacy2');
    const pa2 = createApp({ dataDir: tempDir('scenes-privacy2'), llm: { endpoint: pm2.url, model: 'm', key: 'k' } });
    await startServer(pa2);
    try {
      const P2 = jar();
      await P2.post('/api/auth/register', { username: '隐私同学二', password: 'password999' });
      const pr2 = await P2.post('/api/coach', { text: '便利店那个事' });
      ok('别名全是个人信息时，整条场景被拒收（宁可不认，也不泄露）',
        pr2.data.learned === null, JSON.stringify(pr2.data && pr2.data.learned));
      ok('拒收后场景库仍为空', (await (await fetch(base + '/api/scenes')).json()).learnedCount === 0);
    } finally { await stopServer(pa2); pm2.server.close(); base = mainBase; }
  }

''' + anchor2
if '场景库的隐私' not in s:
    s = s.replace(anchor2, BLOCK, 1)
    print('测试: 已加隐私段')
else:
    print('测试: 已存在')

io.open(F, 'w', encoding='utf-8').write(s)
