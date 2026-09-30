#!/usr/bin/env node
/* Headless widget runner for the Rust lesson track.
 *
 * usage: node tools/rust_widget_check.js lesson1.html [lesson2.html ...]
 *
 * For every page: load its <script src=...> and inline <script>s (in document order)
 * into a vm context backed by a DOM/canvas stub, then drive every control: sweep each
 * range input to min / max / mid, cycle every <select> option, click every button,
 * flip every checkbox — firing input/change/click each time.  Fails the page when
 * a script throws, a control handler throws, or the widget never draws to its canvas.
 * (The in-app browser cannot serve repo files, so this is the widget check that works.)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function parseElements(html) {
  // flat list of {tag, id, classes, attrs, options[]} — enough for widget scripts
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
  // attach <option value=…> to the preceding <select>
  const sre = /<select\b[^>]*?(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/select>/gi;
  let sm;
  while ((sm = sre.exec(html))) {
    const sel = els.find(e => e.tag === 'select' && sm[0].indexOf(sm[1] ? `id="${sm[1]}"` : '<select') >= 0 && (sm[1] ? e.id === sm[1] : true));
    if (!sel) continue;
    const ore = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let om;
    while ((om = ore.exec(sm[2]))) {
      const v = /value="([^"]*)"/.exec(om[1]);
      sel.options.push(v ? v[1] : om[2].trim());
    }
  }
  return els;
}

function makeCtx(counter) {
  const DRAW = new Set(['fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'arc', 'lineTo', 'putImageData']);
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

function runPage(file) {
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const els = parseElements(html);
  const problems = [];
  const counter = { draws: 0, handlers: 0, fired: 0 };
  const stubs = new Map();

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
      checked: 'checked' in attrs, disabled: false, hidden: false, open: false,
      textContent: '', innerHTML: '', innerText: '', className: spec.classes.join(' '), title: '',
      width: 640, height: 300, clientWidth: 640, clientHeight: 300, offsetWidth: 640, offsetHeight: 300, scrollTop: 0, scrollLeft: 0,
      min: attrs.min, max: attrs.max, step: attrs.step, type: attrs.type,
      style, dataset: new Proxy({}, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } }),
      classList: { add() {}, remove() {}, toggle() { return false; }, contains: (c) => spec.classes.includes(c) },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); counter.handlers++; },
      removeEventListener() {},
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
      hasAttribute: (k) => k in attrs, removeAttribute: (k) => { delete attrs[k]; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 300, right: 640, bottom: 300, x: 0, y: 0 }),
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

  const documentStub = {
    getElementById: (id) => { const s = els.find(e => e.id === id); return s ? stubFor(s) : null; },
    querySelector: (sel) => qs(sel)[0] || null, querySelectorAll: (sel) => qs(sel),
    createElement: (tag) => stubFor({ tag, idx: -1, attrs: {}, id: null, classes: [], options: [] }),
    createTextNode: (t) => ({ textContent: t }), createElementNS: (ns, tag) => stubFor({ tag, idx: -1, attrs: {}, id: null, classes: [], options: [] }),
    addEventListener() {}, removeEventListener() {}, documentElement: stubFor({ tag: 'html', idx: -2, attrs: {}, id: null, classes: [], options: [] }),
    body: stubFor({ tag: 'body', idx: -3, attrs: {}, id: null, classes: [], options: [] }), readyState: 'complete', fonts: { ready: Promise.resolve() },
  };
  const getComputedStyle = () => new Proxy({}, { get: (t, k) => (k === 'getPropertyValue' ? () => '' : (k === Symbol.toPrimitive ? () => 0 : '')) });
  const rafQueue = [];
  const win = {
    devicePixelRatio: 1, innerWidth: 900, innerHeight: 700, document: documentStub, getComputedStyle,
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; }, cancelAnimationFrame() {},
    setTimeout: (fn) => { try { fn(); } catch (e) { problems.push('setTimeout cb threw: ' + e); } return 1; }, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, performance: { now: () => 0 }, localStorage: { getItem: () => null, setItem() {} },
    console, navigator: { userAgent: 'stub' }, location: { hash: '', href: '' }, ResizeObserver: class { observe() {} disconnect() {} },
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(Object.assign(win, { document: documentStub }));

  // scripts in document order
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

  // drive every control
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

  if (nScripts === 0) problems.push('no scripts ran');
  if (counter.draws === 0) problems.push('widget never draws to its <canvas> (0 draw calls) — EPUB capture would be blank');
  return { file: path.basename(file), problems, draws: counter.draws, handlers: counter.handlers, fired: counter.fired, scripts: nScripts };
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: rust_widget_check.js <lesson.html>...'); process.exit(2); }
let bad = 0;
for (const f of files) {
  const r = runPage(f);
  const ok = r.problems.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${r.file.padEnd(40)} scripts=${r.scripts} handlers=${r.handlers} fired=${r.fired} draw-calls=${r.draws}`);
  for (const p of r.problems) console.log('     - ' + p);
}
console.log(`${files.length - bad}/${files.length} widget pages ran clean`);
process.exit(bad ? 1 : 0);
