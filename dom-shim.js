/* dom-shim.js —— 最小 DOM 垫片（仅供测试用，不参与线上运行）
 * 让 app.js 能在 Node 里真实执行：元素、classList、事件、textContent、localStorage、fetch、location。
 * 被 smoke-dom.js（离线模式）与 test-e2e-cloud.js（真实服务端）共用。
 */
'use strict';

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this._className = '';
    this.dataset = {};
    this.style = {
      _props: {},
      setProperty(k, v) { this._props[k] = String(v); this[k] = String(v); },
      getPropertyValue(k) { return this._props[k] || this[k] || ''; }
    };
    this.listeners = {};
    this._text = '';
    this._html = '';
    this.value = '';
    this.checked = false;
    this.open = false;
  }
  get className() { return this._className; }
  set className(v) { this._className = String(v == null ? '' : v); }
  get children() { return this.childNodes; }
  get classList() {
    const self = this;
    const list = () => self._className.split(/\s+/).filter(Boolean);
    const write = (arr) => { self._className = arr.join(' '); };
    return {
      add: (...cs) => { const s = new Set(list()); cs.forEach((c) => s.add(c)); write([...s]); },
      remove: (...cs) => { const s = new Set(list()); cs.forEach((c) => s.delete(c)); write([...s]); },
      toggle: (c, force) => {
        const has = list().includes(c);
        const want = force === undefined ? !has : !!force;
        const s = new Set(list()); want ? s.add(c) : s.delete(c); write([...s]);
        return want;
      },
      contains: (c) => list().includes(c)
    };
  }
  get textContent() {
    return this.childNodes.length ? this._text + this.childNodes.map((c) => c.textContent).join('') : this._text;
  }
  set textContent(v) { this._text = String(v == null ? '' : v); this.childNodes = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); if (v === '') { this.childNodes = []; this._text = ''; } }
  get options() { return this.childNodes.filter((c) => c.tagName === 'OPTION'); }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
  setAttribute(k, v) { if (k === 'class') this.className = v; else this.dataset['attr_' + k] = v; }
  getAttribute(k) { return k === 'class' ? this.className : this.dataset['attr_' + k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatchEvent(ev) {
    (this.listeners[ev.type] || []).forEach((fn) => fn.call(this, Object.assign({ preventDefault() {}, target: this }, ev)));
    return true;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  select() {} focus() {} blur() {}
  _match(sel) {
    if (sel[0] === '#') return this.dataset.__id === sel.slice(1);
    if (sel[0] === '.') return this.classList.contains(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  _descend(pred, out) {
    this.childNodes.forEach((c) => { if (pred(c)) out.push(c); c._descend(pred, out); });
    return out;
  }
  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    let scope = [this];
    for (let i = 0; i < parts.length - 1; i++) {
      const next = [];
      scope.forEach((node) => node._descend((c) => c._match(parts[i]), []).forEach((hit) => next.push(hit)));
      scope = next;
    }
    const out = [];
    scope.forEach((node) => node._descend((c) => c._match(last), out));
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/** 依据 index.html 的 id / data-tab 造出一个可操作的假 DOM，并返回 vm 沙箱上下文 */
function createSandbox(options) {
  const opts = options || {};
  const html = opts.html;
  if (!html) throw new Error('createSandbox 需要 html 文本');

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const tabs = [...html.matchAll(/data-tab="([\w-]+)"/g)].map((m) => m[1]);
  const root = new El('html');
  const byId = {};
  ids.forEach((id) => {
    const e = new El('div');
    e.dataset.__id = id;
    // 把 HTML 里的初始 class 也带进来（否则"初始隐藏"这类断言会失真）
    const tag = html.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>'));
    const cls = tag ? /class="([^"]*)"/.exec(tag[0]) : null;
    if (cls) e.className = cls[1];
    byId[id] = e;
    root.appendChild(e);
  });
  tabs.forEach((t) => {
    const p = new El('section');
    p.className = 'panel';
    p.dataset.__id = 'panel-' + t;
    byId['panel-' + t] = p;
    root.appendChild(p);
  });
  tabs.forEach((t) => { const b = new El('button'); b.className = 'nav-btn'; b.dataset.tab = t; root.appendChild(b); });

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };
  const documentShim = {
    body: new El('body'),
    createElement: (t) => new El(t),
    createElementNS: (ns, t) => new El(t),
    querySelector: (sel) => (sel[0] === '#' ? byId[sel.slice(1)] || null : root.querySelector(sel)),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    execCommand: () => true
  };

  const offlineFetch = () => Promise.reject(new Error('offline'));
  const sandbox = {
    document: documentShim,
    localStorage,
    navigator: {},
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Event: class { constructor(t) { this.type = t; } },
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => 'blob:mock' },
    confirm: opts.confirm || (() => true),
    scrollTo: () => {},
    alert: () => {},
    fetch: opts.fetch || offlineFetch,
    location: opts.location || { protocol: 'http:' },
    module: undefined
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return { sandbox, root, byId, documentShim, storage, El };
}

module.exports = { createSandbox, El };
