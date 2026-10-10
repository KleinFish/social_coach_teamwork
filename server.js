/*!
 * server.js —— 「社交教练」服务端（零依赖）
 * 只用 Node 内置模块：node:http / node:crypto（+ 本地部署时用 node:sqlite）。
 *
 * 提供：静态页面托管、注册登录（scrypt 口令 + 服务端会话 Cookie）、
 *      按用户隔离的画像云同步（基于 revision 的乐观并发）、账号与数据删除、
 *      可选的大模型代理（密钥只存在服务器，浏览器永远拿不到）。
 *
 * 存储可插拔（见 createStore）：
 *   sqlite  —— 默认。数据落在 DATA_DIR/social-coach.db，适合本地、VPS、Docker（挂载卷）。
 *   upstash —— 外部免费 Redis（Upstash / Vercel KV 的 REST 接口）。适合 Render/Railway 这类
 *              **文件系统临时**的免费容器：应用无状态，数据存在外部，重启不丢。
 *   自动选择：设置了 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN 就用 upstash，否则用 sqlite。
 *
 * 运行： node server.js       测试： node test-server.js / node test-storage.js
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Engine = require('./coach-engine.js');

const ROOT = __dirname;
function envInt(v, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 天
const AUTH_WINDOW_MS = 10 * 60 * 1000;             // 登录/注册限流窗口
const AUTH_MAX_ATTEMPTS = 30;
const COACH_WINDOW_MS = 60 * 60 * 1000;            // 大模型代理限流窗口
const COACH_MAX_CALLS = 40;
const ASR_WINDOW_MS = 60 * 60 * 1000;              // 语音转写限流窗口
const ASR_MAX_CALLS = 60;
const ASR_BODY_LIMIT = 8 * 1024 * 1024;            // 转写请求体上限
const ASR_AUDIO_B64_LIMIT = 4 * 1024 * 1024;       // base64 音频上限（约 3MB 音频，够 60 秒）
const BODY_LIMIT = 1.5 * 1024 * 1024;              // 请求体上限（画像 < 1MB）

/* ---------------- 口令与会话 ---------------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = crypto.scryptSync(pw, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}
function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!N || !r || !p || !expected.length) return false;
  const key = crypto.scryptSync(pw, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function tokenId(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

/* ================================================================== *
 * 存储实现 A：本地 SQLite 文件
 * ================================================================== */
class SqliteStore {
  constructor(dataDir) {
    const { DatabaseSync } = require('node:sqlite');
    this.kind = 'sqlite';
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'social-coach.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id             TEXT PRIMARY KEY,
        username       TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        pass           TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS profiles (
        user_id    TEXT PRIMARY KEY,
        doc        TEXT NOT NULL,
        revision   INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS counters (
        key      TEXT PRIMARY KEY,
        n        INTEGER NOT NULL,
        exp_at   INTEGER NOT NULL
      );
    `);
    this.q = {
      findUserByName: this.db.prepare('SELECT id, username, pass, created_at FROM users WHERE username_lower = ?'),
      findUserById: this.db.prepare('SELECT id, username, pass, created_at FROM users WHERE id = ?'),
      insertUser: this.db.prepare('INSERT INTO users (id, username, username_lower, pass, created_at) VALUES (?, ?, ?, ?, ?)'),
      updatePass: this.db.prepare('UPDATE users SET pass = ? WHERE id = ?'),
      deleteUser: this.db.prepare('DELETE FROM users WHERE id = ?'),
      insertSession: this.db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
      findSession: this.db.prepare('SELECT id, user_id, expires_at FROM sessions WHERE id = ?'),
      deleteSession: this.db.prepare('DELETE FROM sessions WHERE id = ?'),
      deleteUserSessions: this.db.prepare('DELETE FROM sessions WHERE user_id = ?'),
      deleteOtherSessions: this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?'),
      sweepSessions: this.db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
      getProfile: this.db.prepare('SELECT doc, revision, updated_at FROM profiles WHERE user_id = ?'),
      upsertProfile: this.db.prepare(`INSERT INTO profiles (user_id, doc, revision, updated_at) VALUES (?, ?, 1, ?)
                                      ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc,
                                                                        revision = profiles.revision + 1,
                                                                        updated_at = excluded.updated_at`),
      deleteProfile: this.db.prepare('DELETE FROM profiles WHERE user_id = ?'),
      countUsers: this.db.prepare('SELECT COUNT(*) AS n FROM users'),
      countProfiles: this.db.prepare('SELECT COUNT(*) AS n FROM profiles'),
      getCounter: this.db.prepare('SELECT n, exp_at FROM counters WHERE key = ?'),
      putCounter: this.db.prepare('INSERT INTO counters (key, n, exp_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET n = excluded.n, exp_at = excluded.exp_at'),
      sweepCounters: this.db.prepare('DELETE FROM counters WHERE exp_at < ?')
    };
  }
  // 两种后端统一返回 {id, username, pass, createdAt}，避免上层依赖各自的字段风格
  static user(row) { return row ? { id: row.id, username: row.username, pass: row.pass, createdAt: row.created_at } : null; }
  async findUserByName(lower) { return SqliteStore.user(this.q.findUserByName.get(lower)); }
  async findUserById(id) { return SqliteStore.user(this.q.findUserById.get(id)); }
  async insertUser(u) { this.q.insertUser.run(u.id, u.username, u.lower, u.pass, u.createdAt); }
  async updatePassword(userId, pass) { this.q.updatePass.run(pass, userId); }
  async deleteUser(userId) { this.q.deleteUser.run(userId); }
  async createSession(s) { this.q.insertSession.run(s.id, s.userId, s.createdAt, s.expiresAt); }
  async findSession(id) {
    const row = this.q.findSession.get(id) || null;
    if (!row) return null;
    // 过期会话在存储层就判定为无效，两个后端行为保持一致
    if (row.expires_at < new Date().toISOString()) { this.q.deleteSession.run(id); return null; }
    return row;
  }
  async deleteSession(id) { this.q.deleteSession.run(id); }
  async deleteUserSessions(userId) { this.q.deleteUserSessions.run(userId); }
  async deleteOtherSessions(userId, keepId) { this.q.deleteOtherSessions.run(userId, keepId); }
  async sweepSessions(nowIso) { this.q.sweepSessions.run(nowIso); }
  async getProfile(userId) {
    const row = this.q.getProfile.get(userId);
    return row ? { doc: row.doc, revision: row.revision, updatedAt: row.updated_at } : null;
  }
  async upsertProfile(userId, doc, updatedAt) { this.q.upsertProfile.run(userId, doc, updatedAt); }
  async deleteProfile(userId) { this.q.deleteProfile.run(userId); }
  async countUsers() { return this.q.countUsers.get().n; }
  async countProfiles() { return this.q.countProfiles.get().n; }
  /** 窗口计数器：ttlSec 秒后归零。用于"每日额度"这类花真金白银的限流 */
  async bumpCounter(key, ttlSec) {
    const now = Date.now();
    const row = this.q.getCounter.get(key);
    const n = (row && row.exp_at > now) ? row.n + 1 : 1;
    const exp = (row && row.exp_at > now) ? row.exp_at : now + ttlSec * 1000;
    this.q.putCounter.run(key, n, exp);
    return n;
  }
  async peekCounter(key) {
    const row = this.q.getCounter.get(key);
    return (row && row.exp_at > Date.now()) ? row.n : 0;
  }
  async sweepCounters(nowMs) { this.q.sweepCounters.run(nowMs); }
  close() { try { this.db.close(); } catch (e) { /* 已关闭 */ } }
}

/* ================================================================== *
 * 存储实现 B：外部 Redis（Upstash / Vercel KV 的 REST 接口，零依赖）
 * 数据模型（全部为字符串值）：
 *   user:name:<小写昵称>  -> 用户 JSON {id, username, pass, createdAt}
 *   user:id:<用户 id>     -> 小写昵称（用于按 id 反查）
 *   session:<token 散列>  -> {u: userId, e: 过期时间}
 *   usessions:<用户 id>   -> SET，存放该用户所有会话 id（改密/删号时批量清）
 *   profile:<用户 id>     -> {d: 画像 JSON, r: revision, u: 更新时间}
 *   stat:users / stat:profiles -> 计数（供健康检查与测试）
 * 会话过期采用惰性清理，无需后台扫描。
 * ================================================================== */
class RedisStore {
  constructor(config) {
    this.kind = 'upstash';
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.token = config.token || '';
    if (!this.url || !this.token) throw new Error('RedisStore 需要 url 与 token');
  }
  async cmd(args) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error('存储请求失败 HTTP ' + res.status);
    const data = await res.json();
    if (data && data.error) throw new Error('存储命令失败：' + data.error);
    return data ? data.result : null;
  }
  async pipeline(cmds) {
    if (!cmds.length) return [];
    const res = await fetch(this.url + '/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error('存储请求失败 HTTP ' + res.status);
    const arr = await res.json();
    return (arr || []).map((r) => (r && r.error ? null : (r ? r.result : null)));
  }
  static get(k) { return ['GET', k]; }
  static set(k, v) { return ['SET', k, String(v)]; }
  async findUserByName(lower) {
    const raw = await this.cmd(RedisStore.get('user:name:' + lower));
    return raw ? JSON.parse(raw) : null;
  }
  async findUserById(id) {
    const lower = await this.cmd(RedisStore.get('user:id:' + id));
    if (!lower) return null;
    return this.findUserByName(lower);
  }
  async insertUser(u) {
    const user = { id: u.id, username: u.username, pass: u.pass, createdAt: u.createdAt };
    await this.pipeline([
      RedisStore.set('user:name:' + u.lower, JSON.stringify(user)),
      RedisStore.set('user:id:' + u.id, u.lower),
      ['INCR', 'stat:users']
    ]);
  }
  async updatePassword(userId, pass) {
    const user = await this.findUserById(userId);
    if (!user) return;
    user.pass = pass;
    await this.cmd(RedisStore.set('user:name:' + user.username.toLowerCase(), JSON.stringify(user)));
  }
  async deleteUser(userId) {
    const user = await this.findUserById(userId);
    const cmds = [['DEL', 'user:id:' + userId]];
    if (user) cmds.push(['DEL', 'user:name:' + user.username.toLowerCase()]);
    cmds.push(['DECR', 'stat:users']);
    await this.pipeline(cmds);
  }
  async createSession(s) {
    await this.pipeline([
      RedisStore.set('session:' + s.id, JSON.stringify({ u: s.userId, e: s.expiresAt })),
      ['SADD', 'usessions:' + s.userId, s.id]
    ]);
  }
  async findSession(id) {
    const key = 'session:' + id;
    const raw = await this.cmd(RedisStore.get(key));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.e < new Date().toISOString()) {
      await this.pipeline([['DEL', key], ['SREM', 'usessions:' + s.u, id]]);
      return null;
    }
    return { id: id, user_id: s.u, expires_at: s.e };
  }
  async deleteSession(id) {
    const raw = await this.cmd(RedisStore.get('session:' + id));
    const cmds = [['DEL', 'session:' + id]];
    if (raw) cmds.push(['SREM', 'usessions:' + JSON.parse(raw).u, id]);
    await this.pipeline(cmds);
  }
  async deleteUserSessions(userId) {
    const ids = (await this.cmd(['SMEMBERS', 'usessions:' + userId])) || [];
    const cmds = ids.map((i) => ['DEL', 'session:' + i]);
    cmds.push(['DEL', 'usessions:' + userId]);
    await this.pipeline(cmds);
  }
  async deleteOtherSessions(userId, keepId) {
    const ids = (await this.cmd(['SMEMBERS', 'usessions:' + userId])) || [];
    const cmds = ids.filter((i) => i !== keepId).map((i) => ['DEL', 'session:' + i]);
    cmds.push(['DEL', 'usessions:' + userId], ['SADD', 'usessions:' + userId, keepId]);
    await this.pipeline(cmds);
  }
  async sweepSessions() { /* 惰性过期，无需扫描 */ }
  async getProfile(userId) {
    const raw = await this.cmd(RedisStore.get('profile:' + userId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { doc: p.d, revision: p.r, updatedAt: p.u };
  }
  async upsertProfile(userId, doc, updatedAt) {
    const cur = await this.cmd(RedisStore.get('profile:' + userId));
    const revision = cur ? (JSON.parse(cur).r || 0) + 1 : 1;
    const cmds = [RedisStore.set('profile:' + userId, JSON.stringify({ d: doc, r: revision, u: updatedAt }))];
    if (!cur) cmds.push(['INCR', 'stat:profiles']);
    await this.pipeline(cmds);
  }
  async deleteProfile(userId) {
    const cur = await this.cmd(RedisStore.get('profile:' + userId));
    const cmds = [['DEL', 'profile:' + userId]];
    if (cur) cmds.push(['DECR', 'stat:profiles']);
    await this.pipeline(cmds);
  }
  async countUsers() { return parseInt((await this.cmd(RedisStore.get('stat:users'))) || '0', 10); }
  async countProfiles() { return parseInt((await this.cmd(RedisStore.get('stat:profiles'))) || '0', 10); }
  /** 窗口计数器：与 SqliteStore 行为一致（首次自增时设置过期时间） */
  async bumpCounter(key, ttlSec) {
    const n = parseInt((await this.cmd(['INCR', key])) || '0', 10);
    if (n === 1) await this.cmd(['EXPIRE', key, String(ttlSec)]);
    return n;
  }
  async peekCounter(key) { return parseInt((await this.cmd(RedisStore.get(key))) || '0', 10); }
  close() { /* 无本地资源 */ }
}

function createStore(options) {
  const opts = options || {};
  const url = opts.redisUrl || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = opts.redisToken || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  if (opts.kind === 'upstash' || (!opts.kind && url && token)) return new RedisStore({ url, token });
  return new SqliteStore(opts.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
}

/* ---------------- HTTP 小工具 ---------------- */
function json(res, status, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  }, extraHeaders || {}));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('请求体过大'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('JSON 解析失败'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
const USERNAME_RE = /^[\p{L}\p{N}_-]{2,24}$/u;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
/* 只对外暴露白名单内的前端文件：源码、测试脚本、数据库一律不可下载。
   注意：index.html 里 <script src> 引用的每个文件都必须在这里，否则线上会 404（见 test-server.js 的回归用例）。 */
const PUBLIC_FILES = new Set(['/index.html', '/styles.css', '/app.js', '/coach-engine.js', '/assessment.js', '/voice.js']);

function createApp(options) {
  const opts = options || {};
  const store = opts.store || createStore(opts);
  const llm = opts.llm || {
    endpoint: process.env.LLM_ENDPOINT || '',
    model: process.env.LLM_MODEL || '',
    key: process.env.LLM_API_KEY || ''
  };
  /* 可选：语音转写（OpenAI 兼容的 /audio/transcriptions 接口）。音频只在内存里中转，不落盘。 */
  const asr = opts.asr || {
    endpoint: process.env.ASR_ENDPOINT || '',
    model: process.env.ASR_MODEL || 'whisper-1',
    key: process.env.ASR_API_KEY || ''
  };
  const secureCookies = opts.secureCookies !== undefined ? opts.secureCookies : process.env.SECURE_COOKIES === '1';
  const trustProxy = opts.trustProxy !== undefined ? opts.trustProxy : process.env.TRUST_PROXY === '1';
  /* 花钱的接口做"全局日额度"兜底：即使有人批量注册账号，也刷不爆你的额度。
     计数存在数据后端里（Redis/SQLite），所以免费实例休眠重启也不会清零。0 = 不限。 */
  const budgets = Object.assign({
    llmDaily: envInt(process.env.LLM_DAILY_LIMIT, 1000),
    llmIpDaily: envInt(process.env.LLM_IP_DAILY_LIMIT, 200),
    asrDaily: envInt(process.env.ASR_DAILY_LIMIT, 3000)
  }, opts.budgets || {});
  const DAY_SEC = 24 * 60 * 60;

  /* 内存限流：单进程足够；多实例部署时换成 Redis 即可 */
  const buckets = new Map();
  function rateLimit(key, max, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > max) return Math.ceil((b.resetAt - now) / 1000);
    return 0;
  }
  const sweeper = setInterval(() => {
    const now = Date.now();
    Promise.resolve(store.sweepSessions(new Date(now).toISOString())).catch(() => {});
    if (store.sweepCounters) Promise.resolve(store.sweepCounters(now)).catch(() => {});
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  }, 60 * 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  function clientIp(req) {
    if (trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (xff) return String(xff).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }
  /* ---------------- 每日额度（保护钱包，而不是保护服务器） ---------------- */
  function todayKey(prefix) { return 'budget:' + prefix + ':' + new Date().toISOString().slice(0, 10); }
  /** 记一次消耗并判断是否超额度；存储异常时放行（宁可少省钱，也不能让服务不可用） */
  async function spend(prefix, limit) {
    if (!limit || limit <= 0) return { ok: true, used: 0, limit: 0 };
    try {
      const used = await store.bumpCounter(todayKey(prefix), DAY_SEC);
      return { ok: used <= limit, used: used, limit: limit };
    } catch (e) {
      console.warn('[budget] 计数失败，本次放行：' + e.message);
      return { ok: true, used: 0, limit: limit, degraded: true };
    }
  }
  async function usedToday(prefix) {
    try { return await store.peekCounter(todayKey(prefix)); } catch (e) { return 0; }
  }
  function isSecure(req) {
    if (secureCookies) return true;
    return trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  }
  function sameOrigin(req) {
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; }
    catch (e) { return false; }
  }
  function setSessionCookie(res, token, req) {
    const parts = ['sid=' + token, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)];
    if (isSecure(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }
  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  }
  async function currentUser(req) {
    const token = parseCookies(req).sid;
    if (!token) return null;
    const row = await store.findSession(tokenId(token));
    if (!row) return null;
    // 存储层的双保险：即使某个自定义 store 没做过期判断，这里也不会放行
    if (row.expires_at < new Date().toISOString()) { await store.deleteSession(row.id); return null; }
    return { sessionId: row.id, userId: row.user_id };
  }
  async function publicProfile(userId) {
    const row = await store.getProfile(userId);
    if (!row) return { profile: null, revision: 0 };
    let doc = null;
    try { doc = JSON.parse(row.doc); } catch (e) { doc = null; }
    return { profile: doc, revision: row.revision };
  }

  function serveStatic(req, res, pathname) {
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let rel;
    try { rel = decodeURIComponent(pathname); } catch (e) { json(res, 400, { error: '非法路径' }); return; }
    if (rel === '/') rel = '/index.html';
    if (!PUBLIC_FILES.has(rel)) { json(res, 404, { error: 'Not found' }); return; }
    const target = path.resolve(ROOT, '.' + rel);
    if (!target.startsWith(ROOT + path.sep)) { json(res, 403, { error: '非法路径' }); return; }
    const ext = path.extname(target).toLowerCase();
    if (!MIME[ext]) { json(res, 404, { error: 'Not found' }); return; }
    fs.stat(target, (err, st) => {
      if (err || !st.isFile()) { json(res, 404, { error: 'Not found' }); return; }
      const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return; }
      const stream = fs.createReadStream(target);
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Length': st.size, ETag: etag, 'Cache-Control': 'no-cache' });
      stream.pipe(res);
      stream.on('error', () => res.destroy());
    });
  }

  const SYSTEM_PROMPT = [
    '你是一款面向大学新生的「实时对话式社交教练」。目标不是讲道理，而是让用户 3 分钟内（最好 30 秒内）',
    '拿到可立刻使用的状态调整与话术。语气温和共情，禁止"你应该""你必须"这类指导式表达，',
    '改用"要不要试试""很多人在这类场景中会……"。只输出 JSON，不要代码块标记。格式：',
    '{"blocks":[{"type":"empathy","text":"..."},',
    '{"type":"analysis","title":"我听到的场景","scene":"场景名","level":3,"factors":[{"text":"..."}]},',
    '{"type":"reframe","title":"30 秒：先重新解释这份紧张","lines":["...","..."]},',
    '{"type":"script","title":"可以直接念的话","groups":[{"label":"开场","items":["..."]},{"label":"离场兜底","items":["..."]}]},',
    '{"type":"checklist","title":"如果还有 3 分钟","items":["..."],"hint":"..."}]}'
  ].join('\n');
  const BLOCK_TYPES = { empathy: 1, analysis: 1, reframe: 1, script: 1, checklist: 1, breath: 1 };

  async function callLLM(text, tendency) {
    const resp = await fetch(llm.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + llm.key },
      body: JSON.stringify({
        model: llm.model || 'default',
        temperature: 0.6,
        max_tokens: 800,          // 限制输出长度：单次成本可控，避免被超长回答放大开销
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '我的场景：' + text + '\n（画像：' + (tendency === 'i' ? '偏内向' : tendency === 'e' ? '偏外向' : '未设置') + '）' }
        ]
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!resp.ok) throw Object.assign(new Error('上游返回 ' + resp.status), { status: 502 });
    const data = await resp.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw Object.assign(new Error('上游返回空内容'), { status: 502 });
    const parsed = JSON.parse(String(content).replace(/```json/g, '').replace(/```/g, '').trim());
    const blocks = (parsed && parsed.blocks) || [];
    if (!blocks.length || !blocks.every((b) => b && BLOCK_TYPES[b.type])) {
      throw Object.assign(new Error('上游返回结构不符合约定'), { status: 502 });
    }
    return blocks;
  }

  async function handleApi(req, res, pathname) {
    const method = req.method.toUpperCase();
    const user = await currentUser(req);

    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
      json(res, 403, { error: '跨站请求被拒绝' });
      return;
    }

    if (pathname === '/api/health' && method === 'GET') {
      json(res, 200, {
        ok: true,
        llm: !!(llm.endpoint && llm.key && llm.model),
        asr: !!(asr.endpoint && asr.key),
        storage: store.kind,
        // 今日已用额度（方便部署者随时看还剩多少，避免"刷爆了才知道"）
        llmUsed: await usedToday('llm'),
        llmDailyLimit: budgets.llmDaily,
        asrUsed: await usedToday('asr'),
        asrDailyLimit: budgets.asrDaily,
        time: new Date().toISOString()
      });
      return;
    }

    if (pathname === '/api/auth/register' && method === 'POST') {
      const wait = rateLimit('auth:' + clientIp(req), AUTH_MAX_ATTEMPTS, AUTH_WINDOW_MS);
      if (wait) { json(res, 429, { error: '尝试过于频繁，请 ' + wait + ' 秒后再试' }); return; }
      const body = await readBody(req, 32 * 1024);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!USERNAME_RE.test(username)) { json(res, 400, { error: '昵称需为 2–24 个汉字/字母/数字，可用下划线与连字符' }); return; }
      if (password.length < 8 || password.length > 128) { json(res, 400, { error: '密码长度需在 8–128 位之间' }); return; }
      if (await store.findUserByName(username.toLowerCase())) { json(res, 409, { error: '这个昵称已经被使用了' }); return; }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await store.insertUser({ id, username, lower: username.toLowerCase(), pass: hashPassword(password), createdAt: now });
      const token = newToken();
      await store.createSession({
        id: tokenId(token), userId: id, createdAt: now,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      });
      setSessionCookie(res, token, req);
      json(res, 201, { user: { username: username, createdAt: now }, profile: null, revision: 0 });
      return;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const wait = rateLimit('auth:' + clientIp(req), AUTH_MAX_ATTEMPTS, AUTH_WINDOW_MS);
      if (wait) { json(res, 429, { error: '尝试过于频繁，请 ' + wait + ' 秒后再试' }); return; }
      const body = await readBody(req, 32 * 1024);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const row = await store.findUserByName(username.toLowerCase());
      if (!row || !verifyPassword(password, row.pass)) { json(res, 401, { error: '昵称或密码不正确' }); return; }
      const token = newToken();
      const now = new Date().toISOString();
      await store.createSession({
        id: tokenId(token), userId: row.id, createdAt: now,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      });
      setSessionCookie(res, token, req);
      const p = await publicProfile(row.id);
      json(res, 200, Object.assign({ user: { username: row.username, createdAt: row.createdAt } }, p));
      return;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      if (user) await store.deleteSession(user.sessionId);
      clearSessionCookie(res);
      json(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/auth/password' && method === 'POST') {
      if (!user) { json(res, 401, { error: '请先登录' }); return; }
      const body = await readBody(req, 32 * 1024);
      const row = await store.findUserById(user.userId);
      if (!row || !verifyPassword(String(body.oldPassword || ''), row.pass)) { json(res, 401, { error: '原密码不正确' }); return; }
      const next = String(body.newPassword || '');
      if (next.length < 8 || next.length > 128) { json(res, 400, { error: '新密码长度需在 8–128 位之间' }); return; }
      await store.updatePassword(user.userId, hashPassword(next));
      await store.deleteOtherSessions(user.userId, user.sessionId);
      json(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/me' && method === 'GET') {
      if (!user) { json(res, 401, { error: '未登录' }); return; }
      const row = await store.findUserById(user.userId);
      const p = await publicProfile(user.userId);
      json(res, 200, Object.assign({ user: { username: row.username, createdAt: row.createdAt } }, p));
      return;
    }

    if (pathname === '/api/profile' && method === 'PUT') {
      if (!user) { json(res, 401, { error: '请先登录' }); return; }
      const body = await readBody(req, BODY_LIMIT);
      const check = Engine.validateProfile(body.profile);
      if (!check.ok) { json(res, 400, { error: '画像数据不合法：' + check.errors.join('；') }); return; }
      const base = parseInt(body.baseRevision, 10);
      const current = await publicProfile(user.userId);
      if (current.profile && Number.isFinite(base) && base !== current.revision) {
        json(res, 409, { error: '服务端数据已更新', conflict: true, profile: current.profile, revision: current.revision });
        return;
      }
      const now = new Date().toISOString();
      check.profile.updatedAt = now;
      await store.upsertProfile(user.userId, JSON.stringify(check.profile), now);
      json(res, 200, await publicProfile(user.userId));
      return;
    }

    if (pathname === '/api/coach' && method === 'POST') {
      if (!user) { json(res, 401, { error: '大模型模式需要先登录（防止接口被滥用）' }); return; }
      if (!(llm.endpoint && llm.key && llm.model)) { json(res, 503, { error: '服务器未配置大模型，请使用本地规则引擎', code: 'llm_not_configured' }); return; }
      const wait = rateLimit('coach:' + user.userId, COACH_MAX_CALLS, COACH_WINDOW_MS);
      if (wait) { json(res, 429, { error: '调用过于频繁，请稍后再试' }); return; }
      /* 每日额度：单账号刷号也刷不爆（账号级别 + 来源 IP 级别各一道） */
      const uBudget = await spend('llm', budgets.llmDaily);
      const ipBudget = await spend('llm-ip:' + clientIp(req), budgets.llmIpDaily);
      if (!uBudget.ok || !ipBudget.ok) {
        json(res, 429, { error: '今天的大模型额度已用完，已自动切换到本地模式', code: 'llm_budget_exceeded' });
        return;
      }
      const body = await readBody(req, 64 * 1024);
      const text = String(body.text || '').slice(0, 2000);
      if (!text.trim()) { json(res, 400, { error: '内容为空' }); return; }
      if (Engine.safetyCheck(text)) { json(res, 200, { blocks: [Engine.CRISIS_BLOCK], source: 'safety' }); return; }
      try {
        const p = await publicProfile(user.userId);
        const blocks = await callLLM(text, p.profile && p.profile.tendency);
        json(res, 200, { blocks: blocks, source: 'llm' });
      } catch (e) {
        json(res, 502, { error: '大模型调用失败：' + e.message, code: 'llm_failed' });
      }
      return;
    }

    if (pathname === '/api/transcribe' && method === 'POST') {
      if (!user) { json(res, 401, { error: '语音转写需要先登录' }); return; }
      if (!(asr.endpoint && asr.key)) {
        json(res, 503, { error: '服务器还没有配置语音转写', code: 'asr_not_configured' });
        return;
      }
      const wait = rateLimit('asr:' + user.userId, ASR_MAX_CALLS, ASR_WINDOW_MS);
      if (wait) { json(res, 429, { error: '语音输入过于频繁，请 ' + wait + ' 秒后再试' }); return; }
      const asrBudget = await spend('asr', budgets.asrDaily);
      if (!asrBudget.ok) { json(res, 429, { error: '今天的语音转写额度已用完', code: 'asr_budget_exceeded' }); return; }
      const body = await readBody(req, ASR_BODY_LIMIT);
      const b64 = String(body.audioBase64 || '');
      if (!b64) { json(res, 400, { error: '没有收到音频数据' }); return; }
      if (b64.length > ASR_AUDIO_B64_LIMIT) { json(res, 413, { error: '这段录音太长了，说短一点再试', code: 'too-large' }); return; }
      var buf;
      try { buf = Buffer.from(b64, 'base64'); } catch (e) { json(res, 400, { error: '音频数据无法解析' }); return; }
      if (!buf.length) { json(res, 400, { error: '音频数据为空' }); return; }
      try {
        const form = new FormData();
        const mime = String(body.mime || 'audio/webm').toLowerCase();
        // 按音频类型给出正确的扩展名：部分 ASR 服务靠文件名判断格式，写成 .webm 会让 wav 解析失败
        const ext = mime.indexOf('wav') >= 0 ? 'wav'
          : (mime.indexOf('mp3') >= 0 || mime.indexOf('mpeg') >= 0) ? 'mp3'
            : mime.indexOf('ogg') >= 0 ? 'ogg'
              : (mime.indexOf('mp4') >= 0 || mime.indexOf('m4a') >= 0) ? 'm4a'
                : mime.indexOf('flac') >= 0 ? 'flac' : 'webm';
        form.append('file', new Blob([buf], { type: mime }), 'speech.' + ext);
        form.append('model', asr.model || 'whisper-1');
        const upstream = await fetch(asr.endpoint, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + asr.key },
          body: form,
          signal: AbortSignal.timeout(30000)
        });
        if (!upstream.ok) {
          json(res, 502, { error: '转写服务返回 ' + upstream.status, code: 'transcribe_failed' });
          return;
        }
        const data = await upstream.json();
        const text = (data && (data.text || (data.data && data.data.text) || data.result)) || '';
        json(res, 200, { text: String(text).trim(), chars: buf.length });
      } catch (e) {
        json(res, 502, { error: '转写失败：' + e.message, code: 'transcribe_failed' });
      }
      return;
    }

    if (pathname === '/api/account' && method === 'DELETE') {
      if (!user) { json(res, 401, { error: '请先登录' }); return; }
      const body = await readBody(req, 32 * 1024);
      const row = await store.findUserById(user.userId);
      if (!row || !verifyPassword(String(body.password || ''), row.pass)) { json(res, 401, { error: '密码不正确，未删除任何数据' }); return; }
      await store.deleteProfile(user.userId);
      await store.deleteUserSessions(user.userId);
      await store.deleteUser(user.userId);
      clearSessionCookie(res);
      json(res, 200, { ok: true, deleted: true });
      return;
    }

    json(res, 404, { error: '接口不存在' });
  }

  const server = http.createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const pathname = url.pathname;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (pathname.startsWith('/api/')) {
      Promise.resolve()
        .then(() => handleApi(req, res, pathname))
        .catch((err) => {
          if (res.headersSent) { res.destroy(); return; }
          json(res, err.status || 500, { error: err.status ? err.message : '服务器内部错误' });
        })
        .finally(() => { if (opts.onRequest) opts.onRequest(req, res, Date.now() - started); });
      return;
    }
    serveStatic(req, res, pathname);
  });

  function close() {
    clearInterval(sweeper);
    store.close();
  }

  return {
    server, store, close,
    storageKind: () => store.kind,
    llmConfigured: () => !!(llm.endpoint && llm.key && llm.model),
    asrConfigured: () => !!(asr.endpoint && asr.key)
  };
}

function start() {
  const port = parseInt(process.env.PORT || '8787', 10);
  const host = process.env.HOST || '0.0.0.0';
  const app = createApp({});
  app.server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log('社交教练已启动：http://' + shown + ':' + port);
    console.log('存储方式：' + app.storageKind() + (app.storageKind() === 'sqlite' ? '（数据目录 ' + app.store.dataDir + '）' : '（外部 Redis）'));
    console.log('大模型代理：' + (app.llmConfigured() ? '已配置' : '未配置（使用本地规则引擎）'));
    console.log('语音转写：' + (app.asrConfigured() ? '已配置' : '未配置（浏览器支持内置识别时仍可语音输入）'));
  });
  const shutdown = () => {
    console.log('\n正在关闭…');
    app.server.close(() => { app.close(); process.exit(0); });
    setTimeout(() => { app.close(); process.exit(0); }, 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return app;
}

if (require.main === module) start();

module.exports = { createApp, start, createStore, SqliteStore, RedisStore, hashPassword, verifyPassword };
