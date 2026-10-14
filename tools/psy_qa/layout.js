// usage: node tools/psy_qa/layout.js FILE WIDTH [actions...]
// layout.js FILE WIDTH [actions...] : run the widget with canvas clientWidth=WIDTH and
// report fillText calls whose estimated extent leaves the canvas (CJK ≈ 1em, ASCII ≈ 0.58em).
// actions as kpi.js: set:ID=V | click:ID | chk:ID | tick:N | clickxy:ID@x,y ; checks after init and after each action.
const fs = require('fs'), vm = require('vm');
const [file, widthArg, ...acts] = process.argv.slice(2);
const WIDTH = parseInt(widthArg || '340', 10);
const html = fs.readFileSync(file, 'utf8');
const path=require('path');
// psy_qa variant: local <script src="psy.js"> files run first (kpi.js/layout.js in cooking_qa skip src scripts)
const srcs=[...html.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(m=>m[1]).filter(u=>!/^(https?:)?\/\//.test(u));
const pre=srcs.map(u=>{try{return fs.readFileSync(path.resolve(path.dirname(file),u),'utf8')}catch(e){return ''}});
const scripts=pre.concat([...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]));
const attrsById = {};
for (const m of html.matchAll(/<(\w+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
  const a = {}; for (const x of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) a[x[1]] = x[2] === undefined ? '' : x[2];
  if (a.id) attrsById[a.id] = { tag: m[1], a };
}
let calls = [], canvasH = { v: 0 };
function estW(s, px) { let w = 0; for (const ch of String(s)) w += /[\u0000-ÿ]/.test(ch) ? px * 0.58 : px; return w; }
function ctx2d() {
  const st = { font: '10px sans-serif', textAlign: 'left' };
  return new Proxy(st, {
    get(o, k) {
      if (k === 'fillText') return (s, x, y) => { const px = parseFloat((o.font.match(/(\d+(?:\.\d+)?)px/) || [0, 10])[1]); calls.push({ s: String(s), x, y, px, align: o.textAlign }); };
      if (k === 'measureText') return s => ({ width: estW(s, parseFloat((o.font.match(/(\d+(?:\.\d+)?)px/) || [0, 10])[1])) });
      if (k in o) return o[k];
      if (/Gradient|Pattern/.test(k)) return () => ({ addColorStop() {} });
      if (k === 'getImageData' || k === 'createImageData') return (w, h) => ({ width: w | 0, height: h | 0, data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) });
      if (typeof k === 'symbol') return undefined;
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; }
  });
}
const H = [], els = {}, TQ = [];
function mk(id) {
  const info = attrsById[id] || { tag: 'div', a: {} }; const a = info.a;
  const cls = new Set((a.class || '').split(/\s+/).filter(Boolean)); let _c = null, _t = '';
  const style = {};
  const el = { id, tagName: info.tag.toUpperCase(), value: a.value || '', min: a.min, max: a.max, step: a.step, checked: 'checked' in a, style, dataset: {},
    clientWidth: info.tag === 'canvas' ? WIDTH : 680, clientHeight: 330, width: 0, height: 0,
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; }, contains: c => cls.has(c) },
    getAttribute: k => a[k] ?? null, setAttribute() {}, addEventListener: (e, fn) => H.push({ el, e, fn }), getContext: () => _c || (_c = ctx2d()),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: 330 }), appendChild: c => c, querySelectorAll: () => [], children: [] };
  Object.defineProperty(el, 'textContent', { get: () => _t, set: v => { _t = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get: () => _t, set: v => { _t = String(v).replace(/<[^>]+>/g, ''); } });
  return el;
}
const document = { getElementById: id => els[id] || (els[id] = mk(id)), querySelectorAll: () => [], createElement: () => mk('x'), addEventListener() {} };
const win = { devicePixelRatio: 2, addEventListener() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setTimeout: fn => { if (typeof fn === 'function') TQ.push(fn); return TQ.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), Math, console, document };
win.window = win; const c = vm.createContext(win);
function canvasEl() { return Object.values(els).find(e => e.tagName === 'CANVAS'); }
function check(label) {
  const cv = canvasEl(); const h = cv ? parseFloat(cv.style.height) || cv.height / 2 : 0;
  let bad = 0;
  for (const k of calls) {
    const w = estW(k.s, k.px);
    let x0 = k.x; if (k.align === 'center') x0 = k.x - w / 2; else if (k.align === 'right' || k.align === 'end') x0 = k.x - w;
    const x1 = x0 + w;
    if (x0 < -1 || x1 > WIDTH + 1 || k.y > h + 1 || k.y - k.px < -2) { bad++; if (bad <= 12) console.log(`  [${label}] OUT "${k.s}" x0=${x0.toFixed(0)} x1=${x1.toFixed(0)} y=${k.y.toFixed(0)} (W=${WIDTH},H=${h})`); }
  }
  console.log(`[${label}] W=${WIDTH} H=${h} texts=${calls.length} out-of-bounds=${bad}`);
  calls = [];
}
for (const s of scripts) vm.runInContext(s, c, { timeout: 20000 });
check('init');
for (const a of acts) {
  if (a.startsWith('click:')) { const id = a.slice(6); H.filter(h => h.el.id === id && h.e === 'click').forEach(h => h.fn({ target: h.el })); }
  else if (a.startsWith('tick:')) { const n = parseInt(a.slice(5), 10) || 1; for (let i = 0; i < n && TQ.length; i++) TQ.shift()(); }
  else if (a.startsWith('clickxy:')) { const [id, xy] = a.slice(8).split('@'); const [x, y] = xy.split(',').map(Number); H.filter(h => h.el.id === id && h.e === 'click').forEach(h => h.fn({ target: h.el, clientX: x, clientY: y, offsetX: x, offsetY: y, preventDefault() {} })); }
  else if (a.startsWith('set:')) { const [id, v] = a.slice(4).split('='); const el = document.getElementById(id); el.value = v; H.filter(h => h.el.id === id && (h.e === 'input' || h.e === 'change')).forEach(h => h.fn({ target: el })); }
  else if (a.startsWith('chk:')) { const id = a.slice(4); const el = document.getElementById(id); el.checked = !el.checked; H.filter(h => h.el.id === id && (h.e === 'change' || h.e === 'input' || h.e === 'click')).forEach(h => h.fn({ target: el })); }
  check(a);
}
