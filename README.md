# 社交教练 · 实时对话式社交辅助工具

把《新生社交体验访谈分析报告》"四、智能体工具设计思路"落成**可部署的多用户网页应用**：
一个人人能访问的网址 + 每个人自己的账号与数据。

零第三方依赖：服务端只用 Node 内置模块（`node:http` / `node:crypto` / 本地部署时用 `node:sqlite`）。

## 两种使用形态（同一份代码）

| 形态 | 打开方式 | 数据在哪 | 适用 |
| --- | --- | --- | --- |
| 本机文件模式 | 直接双击 `index.html`（`file://`） | 只在这台设备的 localStorage | 自己用、离线演示 |
| 服务器模式 | 通过网址访问（`http(s)://`） | localStorage + 你自己账号的云端副本 | 给大家用、换设备接着用 |

## 本地跑起来

```bash
node server.js          # 需要 Node 22.5+（node:sqlite 内置）
# 打开 http://127.0.0.1:8787
npm test                # 跑完全部 6 个测试脚本
```

## 架构

```
浏览器（index.html + app.js + coach-engine.js）
   │  ① 本地优先：所有功能先用本地规则引擎跑通，断网可用
   │  ② 登录后：GET /api/me → 合并 → PUT /api/profile（带 revision 做乐观并发）
   ▼
server.js（零依赖 HTTP 服务）
   ├── 静态托管：仅白名单 index.html / styles.css / app.js / coach-engine.js
   ├── 账号：scrypt 口令散列 + 服务端会话 Cookie（HttpOnly, SameSite=Lax）
   ├── 存储：可插拔（见下），按 user_id 隔离
   └── 大模型代理（可选）：Key 只在服务器环境变量，浏览器拿不到
```

**同步策略**：不做"整体覆盖"。`E.mergeProfiles()` 把本机与服务器两边的复盘按
「时间 + 场景 + 等级」去重合并，策略库由合并结果重建（不会出现重复条目）；
提交时带 `baseRevision`，服务端发现版本过期就返回 `409` 与最新数据，前端再合并一次重试。
所以两台设备交替使用不会互相吃掉数据。

## 存储：为什么有两个后端

| 后端 | 何时使用 | 数据位置 |
| --- | --- | --- |
| `sqlite`（默认） | 本地、VPS、Docker（挂载持久卷） | `DATA_DIR/social-coach.db` |
| `upstash`（外部 Redis） | **Render / Railway 等免费容器**：文件系统是临时的，SQLite 会随重启清空 | Upstash 免费 Redis，走 REST 接口 |

自动选择：设置了 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`（或 Vercel KV 的
`KV_REST_API_URL`/`KV_REST_API_TOKEN`）就用外部存储，否则用本地 SQLite。
`GET /api/health` 会返回当前 `storage` 类型，方便确认配置生效。

> ⚠️ 关键坑：免费容器上**不要**直接用 SQLite。Render 免费实例 15 分钟无访问即休眠，
> 重启时临时文件系统被清空，用户注册的账号和复盘会一起消失。

## 部署到公网

### 步骤一：把代码放到 GitHub（浏览器操作，本机不需要装 git）

1. 打开 <https://github.com/new>，仓库名随意（例如 `social-coach`），选 **Private** 或 Public，点 Create。
2. 进入空仓库页，点 **uploading an existing file**。
3. 把 `social-coach` 文件夹里的**全部文件**拖进去（含 `Dockerfile`、`render.yaml`、`.env.example` 等；隐藏文件也一起拖）。
4. 底部点 **Commit changes**。

### 步骤二：申请免费 Redis（数据持久化，1 分钟）

1. 打开 <https://console.upstash.com/>，用 GitHub 或 Google 登录（免费版不需要信用卡）。
2. **Create Database** → 名字随意、Region 选离 Render 区域近的（如 Singapore）→ Create。
3. 进入数据库页，找到 **REST API** 区块，复制两个值：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 步骤三：在 Render 部署

1. 打开 <https://dashboard.render.com/>，用 GitHub 登录。
2. **New → Blueprint** → 选中刚才的仓库（仓库里的 `render.yaml` 会被自动识别）。
3. Render 会提示填写环境变量，把步骤二复制的两项粘进 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`。
   （`LLM_*` 三项可留空，留空就是本地规则引擎模式。）
4. 点 Apply / Deploy，等 2–3 分钟构建完成，会得到一个 `https://xxx.onrender.com` 地址，**谁都能打开**。

> Railway 同理：New Project → Deploy from GitHub repo → 变量里填同样的两项，启动命令 `npm start`。
> Railway 需要挂 Volume 才能用 SQLite，用 Upstash 则不需要。

### 上线检查清单

- [ ] `GET /api/health` 返回 `{"ok":true,"storage":"upstash",...}`（确认没退回本地 SQLite）
- [ ] 注册一个账号 → 加一条复盘 → 在 Render 里 Manual Deploy 重启一次 → 重新登录，**数据还在**
- [ ] 通过 HTTPS 访问（云平台默认给 HTTPS），并已设置 `SECURE_COOKIES=1`、`TRUST_PROXY=1`
- [ ] 只用单实例：会话与限流计数在内存中，但账号数据在 Upstash，多实例也能读同一份数据
- [ ] 免费实例休眠后首次访问慢十几秒属正常；想常驻可付费或改用 VPS

### 其他部署方式

**自己的 VPS / Docker（最稳，数据在自己手里）**

```bash
cp .env.example .env      # 不填 UPSTASH_*，用本地 SQLite
docker compose up -d      # 或 nohup node server.js > app.log 2>&1 &
```

用 Caddy 自动签发 HTTPS：

```
你的域名 {
    reverse_proxy 127.0.0.1:8787
}
```

配好 HTTPS 后把 `.env` 改成 `SECURE_COOKIES=1` 与 `TRUST_PROXY=1` 并重启。

**临时公网演示（从自己电脑暴露）**

```bash
node server.js
cloudflared tunnel --url http://127.0.0.1:8787   # 或 ngrok http 8787
```

几秒后得到 `https://xxx.trycloudflare.com`，缺点是电脑必须一直开着、地址会变。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口（云平台会注入） |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | SQLite 文件目录（使用外部存储时忽略） |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | 空 | 填了就启用外部 Redis 存储（也支持 `KV_REST_API_URL`/`KV_REST_API_TOKEN`） |
| `SECURE_COOKIES` | `0` | 置 `1` 时会话 Cookie 加 `Secure`（要求 HTTPS） |
| `TRUST_PROXY` | `0` | 置 `1` 时信任 `X-Forwarded-For` / `X-Forwarded-Proto` |
| `LLM_ENDPOINT` / `LLM_MODEL` / `LLM_API_KEY` | 空 | 三项齐全才启用大模型模式，否则用本地规则引擎 |
| `ASR_ENDPOINT` / `ASR_API_KEY` / `ASR_MODEL` | 空 / `whisper-1` | 语音转写（OpenAI 兼容 `/audio/transcriptions`）；不填则只在浏览器支持内置识别时可用语音 |

## 语音输入（打字的地方都可以说）

「准备」页的场景描述框、以及「复盘」页的两个输入框，都带一个 🎤 按钮。

- **手机 / 平板**：点一下开始，再点一下结束（底部会出现"正在聆听…"状态条，**点状态条或按钮都能停**）
- **电脑**：按住说话、松开结束；轻点一下则进入"再点一下结束"模式
- 识别结果会做一次**保守清洗**：去掉句首"嗯/呃""就是说"这类填充词、去掉汉字之间被插入的空格、合并重复标点、补句尾句号（"那个同学"这类实义用法会保留）

> 为什么手机不用"按住说话"：浏览器会把触摸判定为滚动手势，按下后立刻抛出 `pointercancel`，导致录音刚开就被掐断（实测踩过这个坑）。所以触摸设备统一走点按切换。

语音输入做了**两层**：

| 通道 | 条件 | 说明 |
| --- | --- | --- |
| 浏览器内置识别 | Chrome / Edge 等支持 Web Speech API | 零配置，边说边出字；**音频由浏览器厂商服务器处理**，不经过我们的服务器 |
| 服务端转写 | 服务器配置了 `ASR_ENDPOINT` + `ASR_API_KEY`，且用户已登录 | 浏览器录音 → 上传到本服务 → 转发给 ASR 接口 → 返回文字；**音频只走内存、不落盘、不写日志** |

选择逻辑：能用浏览器内置识别就优先用它；否则若服务器配了 ASR 就走服务端（需登录，防止接口被滥用）；两者都不可用时按钮直接隐藏，避免点了没反应。

> 为什么不做「应急」页的语音：那里是 10 秒内拿一句话的场景，人在紧张时说不出话、现场也吵，所以坚持一键点击而不是语音——这一点也写进了课堂展示的 PPT。

隐私：录音仅用于转成文字；服务端不保存音频文件，也没有把音频写进任何日志。相关说明同时出现在「档案 → 隐私与数据」里。

## 社交画像测试（40 题）

「测试」标签页提供一份**自评量表**，测完给出画像与**场景预测**：

- **8 个维度**：破冰启动 / 小范围寒暄 / 群体融入 / 当众表达 / 权威沟通 / 临场应变 / 情绪恢复 / 社交续航
- **40 道题**（上限 48），5 级自评，每个维度含 2 道**反向计分题**（降低"一路选同意"的偏差）
- 维度得分 0–100 → **场景预测**：预测难度 = 场景基准压力（访谈里的紧张排序）× 0.35 + 相关维度缺口 × 0.65
- 输出分档：**较擅长（≤2.4）/ 一般（≤3.5）/ 偏吃力（≤4.3）/ 很吃力**，每条都带依据和一条可执行建议
- 全部题目选同一档时会提示结果参考价值有限

**它不是孤立的测试**，结果会反向驱动另外三个模块：

| 联动点 | 行为 |
| --- | --- |
| 「准备」 | 描述场景时带上该场景的预测难度：偏吃力先做 30 秒状态调整，顺手则直接给话术 |
| 「应急」 | 按最弱维度推荐入口，并在按钮上标"画像推荐" |
| 「档案」 | 展示八维雷达图、优势/短板、擅长与吃力场景清单 |
| 云同步 | 随画像一起同步（只存维度分与时间戳；场景预测可重算，不入库，避免两处数据打架） |

> 诚实说明：这是**自评预测**，不是心理测评，也未做信度效度检验，不能用于诊断。量表题目全部来自访谈报告里出现过的真实表现。

## 数据与隐私（重要）

- **不登录**：所有内容只写进浏览器 localStorage，不上传、不注册、不采集身份信息。
- **登录后**：复盘的**明文副本**保存在你的服务器（或你配置的 Upstash Redis）上，凭账号密码读取。
  服务端不共享、不做数据分析，但**部署者/管理员在技术上可以看到这些内容**。
- 随时可以：一键清空本机数据、导出 JSON、删除账号与云端数据（立即物理删除）。
- 更敏感的内容建议只使用不登录的本地模式，或自行给存储加密。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查，返回 `{ok, llm, storage}` |
| POST | `/api/auth/register` | 注册 `{username, password}`（昵称 2–24 字，密码 ≥ 8 位） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出，销毁服务端会话 |
| POST | `/api/auth/password` | 改密，其他设备会话失效 |
| GET | `/api/me` | 取自己的账号信息 + 画像 + `revision` |
| PUT | `/api/profile` | 保存画像 `{profile, baseRevision}`；版本过期返回 `409` |
| DELETE | `/api/account` | 删除账号与云端数据 `{password}` |
| POST | `/api/coach` | 大模型代理（需登录；未配置返回 `503 llm_not_configured`） |

安全措施：`scrypt` 口令 + 常量时间比较、会话令牌只存散列、Cookie `HttpOnly`+`SameSite=Lax`、
写请求同源校验（CSRF）、认证与大模型接口限流、CSP/`nosniff`/`X-Frame-Options`、
静态文件白名单（服务端源码、测试脚本、数据库都不可下载）。

## 测试（6 个脚本，全部离线可跑，不需要任何账号或密钥）

```bash
node test-engine.js              # 规则引擎：场景/压力/四模块/画像校验与合并（67 项）
node test-assessment.js          # 社交画像量表：结构/反向计分/预测单调性/跨模块一致性（42 项）
node test-voice.js               # 语音输入：能力探测/模式选择/两条通道/错误翻译（32 项）
node check-wiring.js             # 静态联检：id、class、脚本顺序、密钥与网络约束（全部通过）
node test-storage.js             # 存储契约：同一套断言跑 sqlite + 外部 Redis（58 项）
node test-server.js              # 服务端 e2e：隔离、409 冲突、CSRF、限流、重启持久化、大模型与语音代理（72 项）
node smoke-dom.js                # 无浏览器 DOM 冒烟：离线模式 + file:// + 40 题作答 + 语音回填（65 项）
node test-e2e-cloud.js           # 前端↔服务端集成：两台设备交替用同一账号（41 项）
node test-e2e-cloud.js --redis   # 同上，但跑在外部 Redis 后端上（41 项）
```

最近一次全量运行：**450 项断言全部通过**，静态联检全部通过。
另外用 `curl` 与脚本对**线上实例**做过端到端验证（`https://social-coach-1lpl.onrender.com`：
`storage: upstash`、注册 → 存数据 → 退出 → 重新登录数据仍在 → 删号清理）。

## 更新线上版本

改完代码后把**改动过的文件**拖到 GitHub 仓库根目录（同名文件会被替换）→ Render 检测到提交会自动重新部署，约 1–2 分钟。数据在 Upstash，重新部署不会丢。

测试里发现并已修复的真实问题：

1. 静态托管曾把 `.js` 全放行，而 `fetch` 会把 `/../server.js` 规范化成 `/server.js` —— **服务端源码可被下载**（已改白名单 + 补穿越用例）。
2. CSP `style-src 'self'` 会拦截 HTML 内联 `style`，导致"改密码/删除账号"区块隐藏态失效、首屏暴露（已全改 class 控制）。
3. `validateProfile` 给缺失字段填当前时间，导致校验/合并结果依赖时钟（已改为确定性）。
4. 把会话过期判断放进 Redis 实现后，**SQLite 路径下过期会话仍被接受**（已把过期判定提到存储契约层，两个后端一致）。

## 与访谈报告的对应关系

| 报告中的设计 | 实现位置 |
| --- | --- |
| 实时对话式社交教练（非日程/静态信息库） | 「准备」页对话 + `route()` 自动区分准备/应急/复盘/危机 |
| 情境识别（场景、对象、情绪） | `detectScenes()` 13 类场景、`estimatePressure()` 1–5 级、`detectEmotions()` 五类信号 |
| 30 秒至 3 分钟状态调整 | 认知重构 + 可交互 30 秒 4-2-6 呼吸卡 |
| 话术辅助 / 应急 / 复盘 / 成长档案 | 开场·接话·转话题·离场兜底；7 个应急入口；结构化复盘；焦虑曲线与策略库 |
| 交互原则：极简、隐私优先、个性化、温和引导 | 四标签 1 次点击；本地优先 + 可选云同步；i/e 画像调语气；`soften()` 强制无"你应该" |
| 社交画像测试（本项目扩展） | 8 维度 × 5 题 = 40 题自评 → 维度得分 → 12 个场景的难度预测（较擅长 / 一般 / 偏吃力），并反向驱动「准备」「应急」「档案」 |
| 技术路径：LLM + 规则引擎混合、场景知识库、情绪识别、用户画像、安全性 | 默认本地引擎 + 可选服务端 LLM 代理；`SCENES`/`EMOTION_PATTERNS`/`profile`；`safetyCheck()` 危机转介 |

## 已知限制与后续路线

- 规则引擎话术是预设内容，用于验证交互与信息结构；真实效果取决于大模型与真实数据。
- 不是心理治疗工具，不做诊断；危机场景只做转介提示。
- 画像以 JSON 文档存储（单用户上限 1MB / 500 条复盘）；若要多维统计或海量数据，应拆表。
- 外部 Redis 后端每次请求有几次网络往返，延迟取决于你选的区域；免费额度为 Upstash 侧限制。
- 限流计数在进程内存中，重启即重置；多实例需要外部限流。
- 未做邮箱验证、找回密码、第三方登录；未做语音输入（需接入浏览器语音识别）。
- UI 的**像素级视觉未做浏览器截图验收**（本环境无法渲染页面），逻辑与交互已由 DOM 冒烟和集成测试覆盖。
