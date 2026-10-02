#!/usr/bin/env node
/* dom_probe.js — run a lesson page's scripts headlessly and let a test drive its widget.
 *
 * Two uses.
 *   1. CLI (what validate_chain.py --widgets runs):
 *        node tools/chain/dom_probe.js lesson1.html [lesson2.html ...]
 *      Loads every <script src> and inline <script> in document order into a vm context backed by a DOM/canvas
 *      stub, then drives every control (range inputs at min/max/mid, every <select> option, every button, checkboxes).
 *      A page fails when a script throws, a handler throws, the widget never draws, uses Math.random / Date (the
 *      widgets must be deterministic), the first range slider changes nothing the reader can see, or the page's
 *      output differs between two identical runs.
 *   2. Library (what the per-lesson oracles use):
 *        const { loadPage } = require('./dom_probe.js');
 *        const page = loadPage('/abs/path/01_x.html');
 *        page.set('w01-b', 0.5);          // set a control and fire input + change
 *        page.text('w01-m1')              // textContent of an element
 *        page.num('w01-m1')               // first number in that text
 *      so an oracle can check that the number the widget prints equals the number an independent computation gives
 *      — and therefore the number the lesson's prose quotes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function parseElements(html) {
  const els = [];
  const re = /<(input|button|select|canvas|div|span|textarea|label|details|pre|p|table|td|tr|th|summary|a|h2|h3|code|em|strong|ul|li|svg)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const are = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')|\b([\w:-]+)(?=\s|$)/g;
    let am;
    while ((am = are.exec(m[2]))) {
      if (am[1]) attrs[am[1].toLowerCase()] = am[3] !== undefined ? am[3] : am[4];
      else if (am[5]) attrs[am[5].toLowerCase()] = '';
    }
    els.push({ tag: m[1].toLowerCase(), idx: m.index, attrs, id: attrs.id || null,
      classes: (attrs.class || '').split(/\s+/).filter(Boolean), options: [] });
  }
  const sre = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let sm;
  while ((sm = sre.exec(html))) {
    const idm = /id="([^"]*)"/.exec(sm[1]);
    const sel = els.find(e => e.tag === 'select' && (idm ? e.id === idm[1] : true) && e.idx === sm.index);
    if (!sel) continue;
    const ore = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let om;
    while ((om = ore.exec(sm[2]))) {
      const v = /value="([^"]*)"/.exec(om[1]);
      sel.options.push(v ? v[1] : om[2].replace(/<[^>]+>/g, '').trim());
      if (/\bselected\b/.test(om[1])) sel.attrs.value = v ? v[1] : om[2].replace(/<[^>]+>/g, '').trim();
    }
  }
  return els;
}

function makeCtx(counter) {
  const DRAW = new Set(['fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'arc', 'lineTo', 'putImageData', 'ellipse']);
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6.2 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'createImageData' || k === 'getImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 });
      if (k === 'canvas') return t.canvas;
      if (k === 'getLineDash') return () => [];
      if (typeof k === 'symbol') return undefined;
      return (...a) => { if (DRAW.has(k)) counter.draws++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function loadPage(file, opts) {
  opts = opts || {};
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const els = parseElements(html);
  const problems = [];
  const counter = { draws: 0, handlers: 0, fired: 0 };
  const stubs = new Map();
  const rafQueue = [];

  function stubFor(spec) {
    if (stubs.has(spec)) return stubs.get(spec);
    const listeners = {};
    const attrs = { ...spec.attrs };
    const style = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'setProperty' || k === 'removeProperty' ? () => {} : '')), set: (t, k, v) => { t[k] = v; return true; } });
    let value = attrs.value !== undefined ? attrs.value : (spec.tag === 'select' ? (spec.options[0] || '') : (spec.tag === 'input' && attrs.type === 'range' ? String(Math.round((+(attrs.min || 0) + +(attrs.max || 100)) / 2)) : ''));
    const el = {
      __spec: spec, __listeners: listeners,
      tagName: spec.tag.toUpperCase(), nodeName: spec.tag.toUpperCase(), id: spec.id || '',
      get value() { return value; }, set value(v) { value = String(v); },
      get valueAsNumber() { return +value; },
      checked: 'checked' in attrs, disabled: false, hidden: false, open: false,
      textContent: '', innerHTML: '', innerText: '', className: spec.classes.join(' '), title: '',
      width: 640, height: 300, clientWidth: 640, clientHeight: opts.canvasHeight || 380, offsetWidth: 640, offsetHeight: 300, scrollTop: 0, scrollLeft: 0,
      min: attrs.min, max: attrs.max, step: attrs.step, type: attrs.type,
      style, dataset: new Proxy({}, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } }),
      classList: { add() {}, remove() {}, toggle() { return false; }, contains: (c) => spec.classes.includes(c) },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); counter.handlers++; },
      removeEventListener() {},
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
      hasAttribute: (k) => k in attrs, removeAttribute: (k) => { delete attrs[k]; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 380, right: 640, bottom: 380, x: 0, y: 0 }),
      getContext: () => { if (!el.__ctx) { el.__ctx = makeCtx(counter); el.__ctx.canvas = el; } return el.__ctx; },
      toDataURL: () => 'data:image/png;base64,', focus() {}, blur() {}, click() { fire(el, 'click'); },
      appendChild(c) { return c; }, removeChild(c) { return c; }, insertBefore(c) { return c; }, remove() {},
      querySelector: (sel) => qs(sel)[0] || null, querySelectorAll: (sel) => qs(sel),
      closest: () => null, parentNode: null, parentElement: null, children: [], childNodes: [],
      options: spec.options.map(v => ({ value: v, text: v })), selectedIndex: 0,
      scrollIntoView() {}, setPointerCapture() {}, releasePointerCapture() {},
    };
    stubs.set(spec, el);
    return el;
  }

  function qs(sel) {
    const last = String(sel).trim().split(/[\s>+~]+/).pop();
    const m = /^([a-z0-9]*)(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[[^\]]*\])*(?::[\w-]+(?:\([^)]*\))?)*$/i.exec(last);
    if (!m) return [];
    const [, tag, id, cls] = m;
    const classes = cls ? cls.split('.').filter(Boolean) : [];
    return els.filter(e => (!tag || e.tag === tag.toLowerCase()) && (!id || e.id === id) && classes.every(c => e.classes.includes(c))).map(stubFor);
  }

  function fire(el, type, extra) {
    const hs = el.__listeners[type] || [];
    for (const h of hs) {
      counter.fired++;
      const ev = Object.assign({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, clientX: 40, clientY: 40, offsetX: 40, offsetY: 40, key: 'ArrowRight', shiftKey: false, pointerId: 1, touches: [], detail: 0 }, extra || {});
      try { h.call(el, ev); } catch (e) { problems.push(`handler '${type}' on #${el.id || el.tagName.toLowerCase()} threw: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
    }
  }

  const mk = (tag, idx) => stubFor({ tag, idx, attrs: {}, id: null, classes: [], options: [] });
  const documentStub = {
    getElementById: (id) => { const s = els.find(e => e.id === id); return s ? stubFor(s) : null; },
    querySelector: (sel) => qs(sel)[0] || null, querySelectorAll: (sel) => qs(sel),
    createElement: (tag) => mk(tag, -1), createTextNode: (t) => ({ textContent: t }), createElementNS: (ns, tag) => mk(tag, -1),
    addEventListener() {}, removeEventListener() {}, documentElement: mk('html', -2),
    body: mk('body', -3), readyState: 'complete', fonts: { ready: Promise.resolve() },
  };
  const getComputedStyle = () => new Proxy({}, { get: (t, k) => (k === 'getPropertyValue' ? () => '' : (k === Symbol.toPrimitive ? () => 0 : '')) });
  const win = {
    devicePixelRatio: opts.dpr || 1, innerWidth: 900, innerHeight: 700, document: documentStub, getComputedStyle,
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; }, cancelAnimationFrame() {},
    setTimeout: (fn) => { try { fn(); } catch (e) { problems.push('setTimeout cb threw: ' + e); } return 1; }, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, performance: { now: () => 0 }, localStorage: { getItem: () => null, setItem() {} },
    console: opts.console || console, navigator: { userAgent: 'stub' }, location: { hash: '', href: '' }, ResizeObserver: class { observe() {} disconnect() {} },
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(Object.assign(win, { document: documentStub }));
  // the widgets must be deterministic: poison the nondeterministic APIs inside the page's context
  vm.runInContext("Math.random = function () { throw new Error('Math.random() in a widget: use the seeded generator'); };" +
                  "Date = function () { throw new Error('Date in a widget: widgets must be deterministic'); }; Date.now = Date;", ctx);

  const sre = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let sm, nScripts = 0;
  while ((sm = sre.exec(html))) {
    const src = /src="([^"]+)"/.exec(sm[1]);
    let code = sm[2];
    let label = path.basename(file) + '<inline>';
    if (src) {
      const p = path.resolve(dir, src[1]);
      if (!fs.existsSync(p)) { problems.push(`missing script ${src[1]}`); continue; }
      code = fs.readFileSync(p, 'utf8'); label = src[1];
    }
    if (!code.trim()) continue;
    nScripts++;
    try { new vm.Script(code, { filename: label }).runInContext(ctx); }
    catch (e) { problems.push(`script ${label} threw: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
  }
  const drainRaf = () => { let n = 0; while (rafQueue.length && n++ < 5) { const fn = rafQueue.shift(); try { fn(0); } catch (e) { problems.push('rAF cb threw: ' + e); } } };
  drainRaf();

  const byId = (id) => { const s = els.find(e => e.id === id); if (!s) throw new Error('no element #' + id + ' in ' + path.basename(file)); return stubFor(s); };
  const page = {
    file, problems, counter, els, nScripts, win, ctx,
    get draws() { return counter.draws; },
    el: byId,
    set(id, v) { const e = byId(id); e.value = String(v); fire(e, 'input'); fire(e, 'change'); drainRaf(); return page; },
    check(id, on) { const e = byId(id); e.checked = !!on; fire(e, 'change'); fire(e, 'click'); drainRaf(); return page; },
    click(id) { fire(byId(id), 'click'); drainRaf(); return page; },
    fire(id, type, extra) { fire(byId(id), type, extra); drainRaf(); return page; },
    text(id) { return String(byId(id).textContent); },
    num(id) { const m = /[-−+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(String(byId(id).textContent)); return m ? parseFloat(m[0].replace(/,/g, '').replace('−', '-')) : NaN; },
    value(id) { return byId(id).value; },
    /* textContent of every element that has an id and some text — the reader-visible state of the page */
    snapshot() { const o = {}; for (const s of els) { const e = stubs.get(s); if (e && s.id && (e.textContent || e.innerHTML)) o[s.id] = String(e.textContent) + '|' + String(e.innerHTML); } return o; },
    drain: drainRaf,
    /* drive every control the way the CLI does */
    exercise() {
      for (const spec of els) {
        const el = stubFor(spec);
        if (spec.tag === 'input' && spec.attrs.type === 'range') {
          const lo = +(spec.attrs.min || 0), hi = +(spec.attrs.max || 100);
          for (const v of [lo, hi, Math.round((lo + hi) / 2), lo + 1]) { el.value = String(v); fire(el, 'input'); fire(el, 'change'); drainRaf(); }
        } else if (spec.tag === 'select') {
          for (const v of spec.options) { el.value = v; fire(el, 'change'); fire(el, 'input'); drainRaf(); }
        } else if (spec.tag === 'input' && spec.attrs.type === 'checkbox') {
          for (const c of [true, false]) { el.checked = c; fire(el, 'change'); fire(el, 'click'); drainRaf(); }
        } else if (spec.tag === 'input' && (spec.attrs.type === 'text' || spec.attrs.type === 'number')) {
          fire(el, 'input'); fire(el, 'change'); drainRaf();
        } else if (spec.tag === 'button') {
          for (let i = 0; i < 3; i++) { fire(el, 'click'); drainRaf(); }
        } else if (spec.tag === 'canvas') {
          for (const t of ['mousemove', 'mousedown', 'mouseup', 'click', 'pointerdown', 'pointermove', 'pointerup']) fire(el, t);
          drainRaf();
        }
      }
      if (typeof win.onresize === 'function') { try { win.onresize(); } catch (e) { problems.push('onresize threw: ' + e); } }
      drainRaf();
    },
  };
  return page;
}

/* ───────────────────────────── CLI ───────────────────────────── */
function check(file) {
  const a = loadPage(file, { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  const first = a.els.find(e => e.tag === 'input' && e.attrs.type === 'range');
  let live = null;
  if (first && first.id) {
    const lo = +(first.attrs.min || 0), hi = +(first.attrs.max || 100);
    a.set(first.id, lo); const s0 = JSON.stringify(a.snapshot()), d0 = a.draws;
    a.set(first.id, hi); const s1 = JSON.stringify(a.snapshot());
    live = s0 !== s1;
    if (!live) a.problems.push(`the first range slider (#${first.id}) changes nothing the reader can see (no readout or label differs between its min and max)`);
    void d0;
  } else a.problems.push('no range slider with an id: the EPUB builder sweeps the first slider');
  a.exercise();
  if (a.nScripts === 0) a.problems.push('no scripts ran');
  if (a.draws === 0) a.problems.push('widget never draws to its <canvas> (0 draw calls) — EPUB capture would be blank');
  // determinism: a second fresh load, driven identically, must print the same thing
  const b = loadPage(file, { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  if (first && first.id) { const lo = +(first.attrs.min || 0), hi = +(first.attrs.max || 100); b.set(first.id, lo); b.set(first.id, hi); }
  b.exercise();
  const sa = JSON.stringify(a.snapshot()), sb = JSON.stringify(b.snapshot());
  if (sa !== sb) a.problems.push('two identical runs of the page print different text (non-deterministic widget)');
  return { file: path.basename(file), problems: a.problems, draws: a.draws, handlers: a.counter.handlers, fired: a.counter.fired, scripts: a.nScripts };
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: dom_probe.js <lesson.html>...'); process.exit(2); }
  let bad = 0;
  for (const f of files) {
    let r;
    try { r = check(path.resolve(f)); } catch (e) { r = { file: path.basename(f), problems: ['harness crashed: ' + (e && e.stack || e)], draws: 0, handlers: 0, fired: 0, scripts: 0 }; }
    const ok = r.problems.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : 'BAD'} ${r.file.padEnd(40)} scripts=${r.scripts} handlers=${r.handlers} fired=${r.fired} draw-calls=${r.draws}`);
    for (const p of r.problems) console.log('     - ' + p);
  }
  console.log(`${files.length - bad}/${files.length} widget pages ran clean`);
  process.exit(bad ? 1 : 0);
}
module.exports = { loadPage };
