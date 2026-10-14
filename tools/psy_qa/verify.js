#!/usr/bin/env node
// verify.js — structural + chain + evidence-badge + bet + headless-widget verifier for 《心理学》 and 《从零学会用脑》
// (adapted from tools/regimes_qa/verify.js)
// usage: node tools/psy_qa/verify.js [--plan lessons_play.json] [--final] [--structure-only] [files...]
//   --plan   which plan to verify (default lessons.json = the 20-lesson spine; lessons_play.json = the 8-lesson sidecar)
//   --final  verify PLAN.finalDir instead of PLAN.dir (after the psychology_new -> psychology swap)
// The planned lesson table (slugs, h1s, parts, verbatim batons) lives in the plan json, so every check
// works while only some lessons exist: footers, step-pills and cross-refs are checked against the plan.
// Evidence discipline: every <span class="ev" data-k="KEY"> must match facts/GRADES.json (built from the FACTS files
// by build_grades.py) — the badge letter has to equal the recorded grade of that study.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const args = process.argv.slice(2);
if (args[0] === '--child') { runChild(args[1]); return; }

const ROOT = path.resolve(__dirname, '../..');
let planFile = 'lessons.json', useFinal = false;
for (let i = 0; i < args.length; i++) { if (args[i] === '--plan') { planFile = args[i + 1]; args.splice(i, 2); i--; } else if (args[i] === '--final') { useFinal = true; args.splice(i, 1); i--; } }
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, planFile), 'utf8'));
const DIR = path.join(ROOT, useFinal && PLAN.finalDir ? PLAN.finalDir : PLAN.dir);
const ALL = path.join(ROOT, 'all_lessons');
let GRADES = null;
try { GRADES = JSON.parse(fs.readFileSync(path.join(__dirname, 'facts', 'GRADES.json'), 'utf8')); } catch (e) { GRADES = null; }
const TOTAL = PLAN.lessons.length;
const FILE = n => PLAN.lessons[n].slug + '.html';
const H1 = n => PLAN.lessons[n].h1;
const partOf = n => PLAN.parts.find(p => n >= p.from && n <= p.to).name;
const B = PLAN.batons;
const pad = n => String(n).padStart(2, '0');
const batonIn = n => n === 0 ? B.in00 : B[`${pad(n - 1)}-${pad(n)}`];
const batonOut = n => n === TOTAL - 1 ? B[`out${pad(TOTAL - 1)}`] : B[`${pad(n)}-${pad(n + 1)}`];

let structureOnly = false; const only = [];
for (const a of args) { if (a === '--structure-only') structureOnly = true; else only.push(path.basename(a)); }
const present = fs.readdirSync(DIR).filter(f => /^\d\d_.*\.html$/.test(f)).sort();
const files = only.length ? present.filter(f => only.includes(f)) : present;
let errors = 0, warns = 0;
const E = (f, m) => { errors++; console.log(`  ✗ ${f}: ${m}`); };
const W = (f, m) => { warns++; console.log(`  ! ${f}: ${m}`); };

function stripScripts(t) { return t.replace(/<script[\s\S]*?<\/script>/g, ''); }
function stripComments(t) { return t.replace(/<!--[\s\S]*?-->/g, ''); }
function textOnly(t) { return stripComments(stripScripts(t)).replace(/<[^>]+>/g, ''); }
function plain(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function h1Of(t) { const m = t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/); return m ? plain(m[1]) : ''; }
function head(s) { return s.split(/[：:]/)[0].replace(/[「」《》"“”\s]/g, ''); }

const titles = {}; PLAN.lessons.forEach(l => { titles[pad(l.n)] = l.h1; });
const SIBLIST = (PLAN.siblings || []).concat(PLAN.spineLink ? [PLAN.spineLink] : []);
// dirDev: while the new series is built aside (psychology_new), cross-links into it are checked against that folder
const SIBS = SIBLIST.map(s => { const dev = s.dirDev && !useFinal ? path.join(ALL, s.dirDev) : null; return { name: s.name, dir: dev && fs.existsSync(dev) ? dev : path.join(ALL, s.dir) }; }).filter(s => fs.existsSync(s.dir));
const sibTitles = {};
for (const s of SIBS) { const m = {}; for (const f of fs.readdirSync(s.dir).filter(f => /^\d\d_.*\.html$/.test(f))) m[f.slice(0, 2)] = h1Of(fs.readFileSync(path.join(s.dir, f), 'utf8')); sibTitles[s.name] = m; }
const SIB_RE = new RegExp(SIBLIST.map(s => s.name + '|' + s.dir.split('/')[0]).join('|') || '^$');
function sibOf(pre) { for (const k of Object.keys(sibTitles)) if (pre.includes(k)) return k; return null; }

console.log(`verify: ${files.length} file(s) present of ${TOTAL} planned in ${PLAN.dir}${structureOnly ? ' [structure-only]' : ''}`);

for (const f of files) {
  const t = fs.readFileSync(path.join(DIR, f), 'utf8');
  const n = parseInt(f.slice(0, 2), 10);
  if (!PLAN.lessons[n] || FILE(n) !== f) { E(f, `not in plan (want ${PLAN.lessons[n] ? FILE(n) : '—'})`); continue; }
  const body = stripComments(stripScripts(t));
  const size = Buffer.byteLength(t);
  if (size < 18000 || size > 56000) W(f, `size ${Math.round(size / 1024)} KB (aim 22–48 KB)`);

  // 1. tag balance
  for (const tag of ['div', 'p', 'strong', 'em', 'span', 'a', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'section', 'details', 'summary', 'main', 'footer', 'header', 'h2', 'h3', 'b', 'code', 'label', 'button', 'select', 'sub', 'sup']) {
    const open = (body.match(new RegExp(`<${tag}(\\s[^>]*)?>`, 'g')) || []).length;
    const close = (body.match(new RegExp(`</${tag}\\s*>`, 'g')) || []).length;
    if (open !== close) E(f, `<${tag}> open ${open} vs close ${close}`);
  }
  if (/<\/\w+\s+>/.test(body)) E(f, 'closing tag with trailing space (e.g. </strong >)');
  for (const m of body.matchAll(/<div class="callout[^"]*">([\s\S]*?)<\/div>\s*$/gm)) { /* noop: balance check above is authoritative */ }
  if (/class=“|“>/.test(body)) E(f, 'curly quote inside an HTML attribute');
  // 2. exactly one widget / canvas
  const widgets = (body.match(/class="widget[\s"]/g) || []).length;
  if (widgets !== 1) E(f, `widget count ${widgets} (want 1)`);
  const canv = (body.match(/<canvas\b/g) || []).length;
  if (canv !== 1) E(f, `canvas count ${canv} (want 1)`);
  // 3. chrome
  const pill = t.match(/<span class="step-pill">([^<]*)<\/span>/);
  const want = `第 ${n + 1} 课 / 共 ${TOTAL} 课`;
  if (!pill) E(f, 'no step-pill'); else if (pill[1].trim() !== want) E(f, `step-pill "${pill[1]}" want "${want}"`);
  const tt = t.match(/<title>([^<]*)<\/title>/);
  const wantTitle = `${pad(n)} · ${H1(n)} | ${PLAN.series}`;
  if (!tt || tt[1] !== wantTitle) E(f, `<title> "${tt && tt[1]}" want "${wantTitle}"`);
  if (!t.includes(`<span class="crumb">${pad(n)}</span>`)) E(f, 'crumb number missing/mismatch');
  if (h1Of(t) !== H1(n)) E(f, `h1 "${h1Of(t)}" want "${H1(n)}"`);
  const kick = t.match(/<p class="kicker">([^<]*)<\/p>/);
  if (!kick || kick[1] !== partOf(n)) E(f, `kicker "${kick && kick[1]}" want "${partOf(n)}"`);
  // 4. chain strip
  const ch = body.match(/<div class="chain">([\s\S]*?)<\/div>/g) || [];
  if (ch.length !== 1) E(f, `chain count ${ch.length} (want 1)`);
  else {
    const spans = [...ch[0].matchAll(/<span( class="this")?><b>([^<]*)<\/b>([\s\S]*?)<\/span>/g)];
    if (spans.length !== 3) E(f, `chain has ${spans.length} cells (want 3)`);
    else {
      const [L, M, R] = spans;
      if (L[2] !== '被什么逼出' || M[2] !== '本课' || R[2] !== '逼出下一课' || !M[1]) E(f, 'chain labels must be 被什么逼出 / 本课 (class="this") / 逼出下一课');
      if (plain(L[3]) !== batonIn(n)) E(f, `chain left ≠ baton in\n      got:  ${plain(L[3])}\n      want: ${batonIn(n)}`);
      const r = plain(R[3]);
      const wantR = n === TOTAL - 1 ? batonOut(n) : `${batonOut(n)} → ${pad(n + 1)}`;
      if (r !== wantR) E(f, `chain right ≠ baton out\n      got:  ${r}\n      want: ${wantR}`);
    }
  }
  // 5. sections
  const txt = textOnly(t);
  const misc = body.match(/<h2>常见误解<\/h2>\s*<ul class="prompt-list">([\s\S]*?)<\/ul>/);
  if (!misc) E(f, 'missing <h2>常见误解</h2> + ul.prompt-list'); else { const k = (misc[1].match(/<li>/g) || []).length; if (k < 4 || k > 6) E(f, `常见误解 has ${k} items (want 4–6)`); }
  if (!/class="label">一句话带走/.test(body)) E(f, 'missing 一句话带走 callout');
  if (!/class="label">本课路线/.test(body)) E(f, 'missing 本课路线 callout');
  if (!/class="subtitle"/.test(body)) E(f, 'missing subtitle');
  if (!/class="label">回到主线/.test(body)) E(f, 'missing 回到主线 callout');
  { const pr = txt.replace(/其他|他人|他国|他乡|他者|利他|他方|他律|他用|吉他|他山|他杀|排他|他处|他法|他物|他日|他途|他心|他控|自他|他评/g, '');
    const hits = (pr.match(/[他她]/g) || []).length;
    if (hits) { const i = pr.search(/[他她]/); E(f, `gendered pronoun 他/她 ×${hits} (house rule: pronoun-neutral) near「${pr.slice(Math.max(0, i - 12), i + 8).replace(/\s+/g, ' ')}」`); } }
  if (n !== TOTAL - 1) {
    const nx = body.match(/<div class="callout"><div class="label">下一步<\/div>([\s\S]*?)<\/div>/);
    if (!nx) E(f, 'missing 下一步 callout');
    else {
      const p = plain(nx[1]);
      if (!p.startsWith(batonOut(n))) E(f, '下一步 must start with the exit baton verbatim');
      if (!p.includes(`第 ${pad(n + 1)} 课《${H1(n + 1)}》`)) E(f, `下一步 must name 第 ${pad(n + 1)} 课《${H1(n + 1)}》`);
    }
  }
  if (!/<!-- reviewed:v[12] -->/.test(t)) W(f, 'missing reviewed:v1/v2 marker');
  // 5b. evidence badges: every .ev carries data-k + a matching letter/class; research notes must carry badges
  {
    const evs = [...body.matchAll(/<span class="ev ev-([abcd])"([^>]*)>([^<]*)<\/span>/g)];
    const nEvTotal = (body.match(/class="ev[\s"]/g) || []).length;
    if (nEvTotal !== evs.length) E(f, `malformed .ev badge(s): ${nEvTotal} class="ev…" vs ${evs.length} well-formed (<span class="ev ev-X" data-k="KEY">X</span>)`);
    const minEv = PLAN.minEv !== undefined ? PLAN.minEv : 3;
    if (evs.length < minEv) E(f, `only ${evs.length} evidence badge(s) (want ≥ ${minEv}; every named study carries a grade)`);
    for (const m of evs) {
      const cls = m[1].toUpperCase(), attrs = m[2], letter = m[3].trim();
      const k = (attrs.match(/data-k="([^"]+)"/) || [])[1];
      if (letter !== cls) E(f, `.ev class ev-${m[1]} but text "${letter}"`);
      if (!k) { E(f, `.ev badge without data-k (letter ${cls})`); continue; }
      if (GRADES) {
        const g = GRADES[k];
        if (!g) E(f, `.ev data-k="${k}" is not a key in facts/GRADES.json`);
        else if (g !== cls) E(f, `.ev data-k="${k}" shows ${cls} but FACTS grade is ${g}`);
      }
    }
    for (const m of body.matchAll(/<div class="callout source-note"><div class="label">([^<]*)<\/div>([\s\S]*?)<\/div>/g)) {
      if (/^(原著|研究)/.test(m[1]) && !/class="ev /.test(m[2])) E(f, `source-note "${m[1]}" has no .ev badge`);
    }
  }
  // 5c. 押注 (prediction-first bet): exactly one .bet per lesson unless the plan says otherwise
  {
    const bets = [...body.matchAll(/<div class="bet"([^>]*)>/g)];
    const nb = (PLAN.noBet || []).includes(n) ? 0 : 1;
    if (bets.length !== nb) E(f, `bet count ${bets.length} (want ${nb})`);
    for (const b of bets) {
      const a = b[1];
      const id = (a.match(/data-id="([^"]+)"/) || [])[1];
      if (!a.includes(`id="w${pad(n)}-bet"`)) E(f, `.bet needs id="w${pad(n)}-bet"`);
      if (!id || !id.startsWith((PLAN.betPrefix || '') + pad(n))) E(f, `.bet data-id "${id}" must start with ${(PLAN.betPrefix || '') + pad(n)}`);
      const kind = (a.match(/data-kind="([^"]+)"/) || [])[1];
      if (kind === 'num') {
        for (const k of ['data-min', 'data-max', 'data-truth']) if (!a.includes(k + '=')) E(f, `.bet num lacks ${k}`);
        const mn = +(a.match(/data-min="([^"]+)"/) || [])[1], mx = +(a.match(/data-max="([^"]+)"/) || [])[1], tr = +(a.match(/data-truth="([^"]+)"/) || [])[1];
        if (!(mn < mx) || !(tr >= mn && tr <= mx)) E(f, `.bet truth ${tr} outside [${mn}, ${mx}]`);
      } else if (kind === 'pick') {
        for (const k of ['data-options', 'data-truth']) if (!a.includes(k + '=')) E(f, `.bet pick lacks ${k}`);
        const opts = ((a.match(/data-options="([^"]+)"/) || [])[1] || '').split('|'), tr = +(a.match(/data-truth="([^"]+)"/) || [])[1];
        if (opts.length < 2 || !(tr >= 0 && tr < opts.length)) E(f, `.bet pick truth index ${tr} outside ${opts.length} options`);
      } else E(f, '.bet data-kind must be num|pick');
    }
    if (bets.length) {
      const rv = body.match(/<div class="bet-reveal">([\s\S]*?)<\/div>\s*<\/div>/);
      if (!rv) E(f, '.bet needs a <div class="bet-reveal"> (truth + source) inside it');
      else if (!/class="ev /.test(rv[1])) E(f, '.bet-reveal needs an .ev badge for the revealed number');
      if (!/<script src="psy\.js"><\/script>/.test(t)) E(f, 'page with a .bet must load <script src="psy.js"></script>');
    }
  }
  if (/<script src="psy\.js"><\/script>/.test(t) && !fs.existsSync(path.join(DIR, 'psy.js'))) E(f, 'page loads psy.js but the folder has none (run tools/psy_qa/sync_play.py for the sidecar)');
  if (!/<script src="psy\.js"><\/script>/.test(t)) W(f, 'page does not load psy.js (badge tooltips / bets / PSY helpers unavailable)');
  // 6. footer nav
  const foot = t.match(/<footer class="lesson-nav">([\s\S]*?)<\/footer>/);
  if (!foot) E(f, 'no footer.lesson-nav');
  else {
    const hrefs = [...foot[1].matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const ttls = [...foot[1].matchAll(/class="ttl">([^<]*)</g)].map(m => m[1]);
    const prev = n === 0 ? 'index.html' : FILE(n - 1), next = n === TOTAL - 1 ? 'index.html' : FILE(n + 1);
    if (hrefs[0] !== prev) E(f, `footer prev ${hrefs[0]} want ${prev}`);
    if (hrefs[1] !== next) E(f, `footer next ${hrefs[1]} want ${next}`);
    const wantPrevT = n === 0 ? '← 课程总览' : `${pad(n - 1)} · ${H1(n - 1)}`;
    const wantNextT = n === TOTAL - 1 ? '回到课程总览 →' : `${pad(n + 1)} · ${H1(n + 1)}`;
    if (ttls[0] !== wantPrevT) E(f, `footer prev label "${ttls[0]}" want "${wantPrevT}"`);
    if (ttls[1] !== wantNextT) E(f, `footer next label "${ttls[1]}" want "${wantNextT}"`);
  }
  // 7. local hrefs resolve (planned-but-missing lesson files are a warning)
  const plannedFiles = new Set(PLAN.lessons.map(l => l.slug + '.html'));
  // sidecar → spine links are written with the FINAL path (../../psychology/lessons/…); while the new series is built aside, resolve them in psychology_new
  const spine = PLAN.spineLink, spineDev = !!(spine && spine.dirDev && !useFinal && fs.existsSync(path.join(ALL, spine.dirDev)));
  for (const m of t.matchAll(/href="([^"#:]+)(#[^"]*)?"/g)) {
    const p = path.resolve(DIR, spineDev ? m[1].replace('../../' + spine.dir + '/', '../../' + spine.dirDev + '/') : m[1]);
    if (fs.existsSync(p)) continue;
    if (plannedFiles.has(m[1])) W(f, `href ${m[1]} planned but not written yet`); else E(f, `dangling href ${m[1]}`);
  }
  // 8. LaTeX leaks, ASCII quotes in prose, gendered pronouns
  if (/\\(text|texttt|frac|sqrt|cdot|times|to)\b|\$\$/.test(txt)) E(f, 'LaTeX-style escape in prose');
  if (/[他她]们?的?(?:认为|说|发现)/.test(txt) && false) W(f, 'pronoun');
  // 9. xref: 第 NN 课《title》
  for (const m of txt.matchAll(/第\s*(\d{1,2})\s*课\s*《([^》]+)》/g)) {
    const num = m[1].padStart(2, '0'), ttl = m[2];
    const pre = txt.slice(Math.max(0, m.index - 24), m.index);
    const sib = sibOf(pre);
    if (sib) {
      const st = sibTitles[sib];
      if (!st[num]) E(f, `xref 《${sib}》第${m[1]}课 → no such file`);
      else if (head(ttl) !== head(st[num])) E(f, `xref 《${sib}》第${m[1]}课《${ttl}》 but that file is 《${st[num]}》`);
      continue;
    }
    if (!titles[num]) { E(f, `xref 第${m[1]}课 → no such lesson`); continue; }
    if (ttl !== titles[num]) {
      const hit = Object.entries(titles).find(([k, v]) => head(v) === head(ttl));
      E(f, `xref 第${m[1]}课《${ttl}》 but lesson ${num} is 《${titles[num]}》${hit ? ` (title is lesson ${hit[0]})` : ''}`);
    }
  }
  for (const m of txt.matchAll(/第\s*(\d{1,2})\s*课(?!\s*\/\s*共)/g)) {
    const pre = txt.slice(Math.max(0, m.index - 24), m.index);
    if (SIB_RE.test(pre)) continue;
    if (parseInt(m[1], 10) > TOTAL - 1) E(f, `bare ref 第${m[1]}课 > max lesson ${TOTAL - 1}`);
    if (m[1].length === 1) W(f, `ref 第${m[1]}课 should be two digits (第 0${m[1]} 课)`);
  }
  // 10. random/date in scripts; widget ids prefixed
  for (const s of t.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const code = s[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    if (/Math\.random|new Date|Date\.now/.test(code)) E(f, 'Math.random/Date in widget code');
  }
  const pre = `w${pad(n)}-`;
  for (const m of body.matchAll(/(?<![\w-])id="([^"]+)"/g)) if (!m[1].startsWith(pre)) E(f, `id "${m[1]}" lacks prefix ${pre}`);

  // 11. headless widget run (child process)
  if (!structureOnly) {
    const r = cp.spawnSync(process.execPath, ['--max-old-space-size=256', __filename, '--child', path.join(DIR, f)], { encoding: 'utf8', timeout: 30000 });
    if (r.error) E(f, `widget run: ${r.error.code || r.error.message}`);
    else if (r.status !== 0) E(f, `widget run exit ${r.status} ${r.signal || ''}: ${(r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ')}`);
    else for (const line of r.stdout.trim().split('\n')) {
      if (line.startsWith('ERR ')) E(f, line.slice(4));
      else if (line.startsWith('WARN ')) W(f, line.slice(5));
      else if (line.startsWith('OK ')) console.log(`  ✓ ${f}: ${line.slice(3)}`);
    }
  }
}
console.log(`\nverify done: files=${files.length} errors=${errors} warnings=${warns}`);
process.exitCode = errors ? 1 : 0;

// ───────────────────────── child: run one file's widget headless ─────────────────────────
function runChild(file) {
  const vm = require('vm');
  const html = fs.readFileSync(file, 'utf8');
  // local <script src="psy.js"> files run first (in page order), then the inline scripts
  const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(m => m[1]).filter(u => !/^(https?:)?\/\//.test(u));
  const pre = srcs.map(u => { try { return fs.readFileSync(path.resolve(path.dirname(file), u), 'utf8'); } catch (e) { return ''; } });
  const scripts = pre.concat([...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]));
  // parse elements with ids / classes
  const elems = [];
  for (const m of html.matchAll(/<(\w+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const tag = m[1].toLowerCase(); const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2];
    elems.push({ tag, attrs });
  }
  const writes = [];
  const handlers = [];
  let rafQ = [], timerQ = [];
  function ctx2d() {
    const noop = () => {};
    const grad = { addColorStop: noop };
    const c = new Proxy({}, {
      get(o, k) {
        if (k in o) return o[k];
        if (k === 'measureText') return s => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient' || k === 'createPattern') return () => grad;
        if (k === 'createImageData') return (w, h) => { w = Math.max(1, Math.min(4096, w | 0)); h = Math.max(1, Math.min(4096, h | 0)); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; };
        if (k === 'getImageData') return (x, y, w, h) => { w = Math.max(1, Math.min(4096, w | 0)); h = Math.max(1, Math.min(4096, h | 0)); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; };
        if (k === 'getLineDash') return () => [];
        if (k === 'isPointInPath' || k === 'isPointInStroke') return () => false;
        if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        if (k === 'canvas') return undefined;
        if (typeof k === 'symbol') return undefined;
        return noop;
      },
      set(o, k, v) { o[k] = v; return true; }
    });
    return c;
  }
  const byId = {};
  function mkEl(info) {
    const a = Object.assign({}, info ? info.attrs : {});
    const tag = info ? info.tag : 'div';
    const style = new Proxy({ setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } }, { get(o, k) { return k in o ? o[k] : ''; }, set(o, k, v) { o[k] = v; return true; } });
    const cls = new Set((a.class || '').split(/\s+/).filter(Boolean));
    const ds = {};
    for (const k in a) if (k.startsWith('data-')) ds[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[k];
    let _ctx = null;
    const el = {
      tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), id: a.id || '', style, dataset: ds,
      value: a.value !== undefined ? a.value : (tag === 'select' ? (info && info.firstOption) || '' : ''),
      min: a.min || '0', max: a.max || '100', step: a.step || '1', type: a.type || '',
      checked: 'checked' in a, disabled: 'disabled' in a,
      width: 300, height: 150, clientWidth: 680, clientHeight: 340, offsetWidth: 680, offsetHeight: 340,
      children: [], childNodes: [], options: [], selectedIndex: 0,
      classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; }, contains: c => cls.has(c), forEach: fn => cls.forEach(fn) },
      get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); },
      getAttribute: k => (k in a ? a[k] : null), setAttribute: (k, v) => { a[k] = String(v); }, hasAttribute: k => k in a, removeAttribute: k => { delete a[k]; },
      addEventListener: (ev, fn) => handlers.push({ el, ev, fn }), removeEventListener() {},
      getContext: () => (_ctx || (_ctx = ctx2d())),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 680, bottom: 340, width: 680, height: 340, x: 0, y: 0 }),
      appendChild: c => { el.children.push(c); return c; }, insertBefore: c => c, removeChild: c => c, remove() {}, replaceChildren() {}, append() {}, prepend() {},
      insertAdjacentHTML() {}, focus() {}, blur() {}, click() { handlers.filter(h => h.el === el && h.ev === 'click').forEach(h => h.fn({ target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} })); },
      querySelector: () => mkEl(null), querySelectorAll: () => [], closest: () => mkEl(null), contains: () => false,
      setPointerCapture() {}, releasePointerCapture() {},
      parentNode: null, parentElement: null,
      toDataURL: () => 'data:,',
      [Symbol.toPrimitive]: h => (h === 'number' ? 0 : '[el]'),
    };
    el.parentNode = el.parentElement = { clientWidth: 680, clientHeight: 340, offsetWidth: 680, getBoundingClientRect: el.getBoundingClientRect, appendChild: c => c, insertBefore: c => c, removeChild: c => c, style, classList: el.classList, querySelector: () => mkEl(null), querySelectorAll: () => [] };
    let _t = '', _h = '';
    Object.defineProperty(el, 'textContent', { get: () => _t, set: v => { _t = String(v); writes.push({ id: el.id, v: _t }); } });
    Object.defineProperty(el, 'innerText', { get: () => _t, set: v => { _t = String(v); writes.push({ id: el.id, v: _t }); } });
    Object.defineProperty(el, 'innerHTML', { get: () => _h, set: v => { _h = String(v); writes.push({ id: el.id, v: _h.replace(/<[^>]+>/g, '') }); } });
    return el;
  }
  // select default = first option value
  for (let i = 0; i < elems.length; i++) if (elems[i].tag === 'select') {
    for (let j = i + 1; j < elems.length && elems[j].tag !== 'select'; j++) if (elems[j].tag === 'option') { const sel = elems[j].attrs; if (elems[i].firstOption === undefined || 'selected' in sel) elems[i].firstOption = sel.value !== undefined ? sel.value : ''; }
  }
  for (const e of elems) if (e.attrs.id) byId[e.attrs.id] = mkEl(e);
  const missing = new Set();
  const document = {
    getElementById: id => { if (!byId[id]) { missing.add(id); byId[id] = mkEl(null); } return byId[id]; },
    querySelector: sel => { const m = sel.match(/#([\w-]+)/); if (m && byId[m[1]]) return byId[m[1]]; return mkEl(null); },
    querySelectorAll: sel => {
      const last = sel.trim().split(/\s+/).pop();
      const m = last.match(/^(\w+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="?([^"\]]*)"?)?\])?$/);
      if (!m) return [];
      const out = [];
      for (const e of elems) {
        if (m[1] && e.tag !== m[1].toLowerCase()) continue;
        if (m[2] && !(e.attrs.class || '').split(/\s+/).includes(m[2])) continue;
        if (m[3] && !(m[3] in e.attrs)) continue;
        if (m[4] && e.attrs[m[3]] !== m[4]) continue;
        out.push(e.attrs.id && byId[e.attrs.id] ? byId[e.attrs.id] : (e._el || (e._el = mkEl(e))));
      }
      return out;
    },
    createElement: tag => mkEl({ tag, attrs: {} }), createTextNode: s => ({ textContent: s }),
    addEventListener: (ev, fn) => handlers.push({ el: document, ev, fn }), readyState: 'complete',
    documentElement: mkEl(null), body: mkEl(null), fonts: { ready: Promise.resolve() },
  };
  const win = {
    devicePixelRatio: 2, innerWidth: 1024, innerHeight: 768,
    addEventListener: (ev, fn) => handlers.push({ el: win, ev, fn }), removeEventListener() {},
    requestAnimationFrame: fn => { rafQ.push(fn); return rafQ.length; }, cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { if (typeof fn === 'function') timerQ.push(fn); return timerQ.length; }, clearTimeout() {},
    setInterval: (fn, ms) => { if (typeof fn === 'function') timerQ.push(fn); return timerQ.length; }, clearInterval() {},
    getComputedStyle: () => ({ getPropertyValue: () => '#888888', color: '#888888' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    performance: { now: () => 0 }, console, Math, JSON, Number, String, Array, Object, Promise, Set, Map, isFinite, isNaN, parseFloat, parseInt,
    Float32Array, Float64Array, Uint8ClampedArray, Int32Array, Uint8Array, Symbol, Error, RegExp, Boolean,
    navigator: { userAgent: 'node' }, location: { href: 'file:///x', hash: '' },
    localStorage: (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })(),
  };
  win.window = win; win.self = win; win.document = document; win.globalThis = win;
  const context = vm.createContext(win);
  function fire(el, ev, extra) {
    for (const h of handlers.filter(h => h.el === el && h.ev === ev)) h.fn(Object.assign({ target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, clientX: 200, clientY: 100, offsetX: 200, offsetY: 100, touches: [{ clientX: 200, clientY: 100 }], key: 'ArrowRight' }, extra || {}));
  }
  function drain() {
    for (let i = 0; i < 60 && rafQ.length; i++) { const q = rafQ; rafQ = []; q.forEach(fn => fn(i * 16)); }
    rafQ = [];
    for (let i = 0; i < 30 && timerQ.length; i++) { const q = timerQ; timerQ = []; q.forEach(fn => fn()); }
    timerQ = [];
  }
  let step = 'load';
  try {
    for (const s of scripts) vm.runInContext(s, context, { timeout: 5000 });
    step = 'DOMContentLoaded/load';
    fire(document, 'DOMContentLoaded'); fire(win, 'load'); fire(win, 'resize');
    drain();
    // exercise every control
    const ctrls = Object.values(byId);
    let exercised = 0;
    for (const el of ctrls) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' && (el.type === 'range' || el.type === 'number')) {
        const def = el.value;
        for (const v of [el.min, el.max, def]) { step = `#${el.id}=${v}`; el.value = String(v); fire(el, 'input'); fire(el, 'change'); drain(); }
        exercised++;
      } else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
        for (const c of [!el.checked, el.checked]) { step = `#${el.id} checked=${c}`; el.checked = c; fire(el, 'change'); fire(el, 'input'); fire(el, 'click'); drain(); }
        exercised++;
      } else if (tag === 'button') {
        step = `click #${el.id}`; fire(el, 'click'); drain(); fire(el, 'click'); drain(); exercised++;
      } else if (tag === 'select') {
        step = `select #${el.id}`; fire(el, 'change'); drain(); exercised++;
      } else if (tag === 'canvas') {
        for (const ev of ['pointerdown', 'mousedown', 'click', 'pointermove', 'mousemove', 'pointerup', 'mouseup', 'touchstart']) { step = `${ev} #${el.id}`; fire(el, ev); }
        drain();
      }
    }
    // class-selected buttons without ids
    for (const h of handlers.filter(h => h.el && h.el.tagName === 'BUTTON' && !h.el.id)) { step = 'click anon button'; h.fn({ target: h.el, currentTarget: h.el, preventDefault() {}, stopPropagation() {} }); drain(); exercised++; }
    const bad = writes.filter(w => /NaN|Infinity|undefined|\[object/.test(w.v));
    if (bad.length) console.log(`ERR bad KPI text: ${[...new Set(bad.map(b => `#${b.id}="${b.v.slice(0, 40)}"`))].slice(0, 4).join(', ')}`);
    if (missing.size) console.log(`WARN getElementById for ids not in HTML: ${[...missing].slice(0, 6).join(', ')}`);
    console.log(`OK widget ran (${scripts.length} script, ${handlers.length} handlers, ${exercised} controls exercised, ${writes.length} text writes)`);
  } catch (e) {
    console.log(`ERR widget threw during ${step}: ${e && e.message ? e.message : e}`);
  }
  process.exit(0);
}
