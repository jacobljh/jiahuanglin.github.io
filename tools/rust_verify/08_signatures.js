#!/usr/bin/env node
/* Oracle for Lesson 08 ("Lifetimes in signatures — the modular contract").
 *
 *   node tools/rust_verify/08_signatures.js [cases=150] [seed=7] [--show N]
 *
 * The lesson claims that checking is per function: a body is checked against its own signature, a call against the
 * callee's signature, and neither check reads the other's code. The widget (MiniRust.check / MiniRust.sigs) computes
 * both halves. Four witnesses, each compared with the real rustc, over random programs (free functions with one to
 * three reference parameters, methods of a struct that holds a reference; lifetime names, elision, 'static; callers
 * whose owners die early or are mutated) plus the widget's own 5 x 4 x 3 table:
 *
 *   (1) ELISION     which signatures the three rules cannot complete: MiniRust's E0106 == rustc's E0106, per case
 *   (2) MODULARITY  rustc on the whole program == rustc on the callee with an empty caller  +  rustc on the caller
 *                   with a callee whose body is `loop {}`  (the claim itself, tested on the compiler)
 *   (3) THE ENGINE  MiniRust's (half, error code, line) set == rustc's, per case; a half is "callee" or "caller"
 *   (4) EXPANSION   the signature MiniRust prints with every lifetime written out (MiniRust.sigs) gives the same
 *                   rustc verdict as the signature with lifetimes elided: the three rules, as implemented, are rustc's
 * Exit status 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const LESSONS = path.join(__dirname, '../../all_lessons/rust/lessons');
const MR = require(process.env.MR || path.join(LESSONS, 'minirust.js'));
const N = +(process.argv[2] || 150), SEED = +(process.argv[3] || 7);
const SHOW = (() => { const i = process.argv.indexOf('--show'); return i > 0 ? +process.argv[i + 1] : 6; })();
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sig08-'));

let seed = SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)], chance = (p) => rnd() < p;
function wpick(pairs) { let t = 0; for (const [w] of pairs) t += w; let r = rnd() * t; for (const [w, v] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][1]; }

/* ───────────────────────────── the cases ─────────────────────────────
   A case is a definition (a free function, or a struct with an impl) and a caller. `def(header, body)` and
   `caller` are functions of the pieces so that the same case can be rendered with another body or header. */

function freeCase(id) {
  const np = 1 + ri(3), pn = ['x', 'y', 'z'].slice(0, np);
  const lts = pn.map(() => wpick([[4, null], [4, "'a"], [2, "'b"], [1, "'static"]]));
  const retLt = wpick([[4, null], [3, "'a"], [2, "'b"], [2, "'static"]]);
  const used = new Set(lts.concat([retLt]).filter(l => l && l !== "'static"));
  const decl = [...used].sort();
  if (used.has("'a") && used.has("'b") && chance(0.25)) decl[1] = "'b: 'a";
  const params = pn.map((n, i) => n + ': &' + (lts[i] ? lts[i] + ' ' : '') + 'str');
  const hasN = chance(0.15); if (hasN) params.splice(ri(params.length + 1), 0, 'n: usize');
  const header = 'fn c' + id + (decl.length ? '<' + decl.join(', ') + '>' : '') + '(' + params.join(', ') + ') -> &' + (retLt ? retLt + ' ' : '') + 'str';
  const i = ri(np), j = ri(np);
  const body = wpick([[5, pn[i]], [np > 1 ? 3 : 0, 'if ' + pn[i] + '.len() > ' + pn[(i + 1) % np] + '.len() { ' + pn[i] + ' } else { ' + pn[(i + 1) % np] + ' }'], [2, '"lit"']]);
  // the caller: each argument is an owner in the outer scope, an owner in an inner block, or a literal
  const kinds = pn.map(() => wpick([[5, 'outer'], [4, 'inner'], [2, 'lit']]));
  const mut = chance(0.35) ? ri(np) : -1;
  return { id, kind: 'free', header, body, def: (h, b) => [h + ' {', '    ' + b, '}'], call: 'c' + id,
    caller: () => {
      const L = ['fn m' + id + '() {'], outer = [], inner = [];
      kinds.forEach((k, q) => { if (k === 'outer') outer.push(q); if (k === 'inner') inner.push(q); });
      const args = pn.map((n, q) => kinds[q] === 'lit' ? '"lit' + q + '"' : '&o' + q);
      if (hasN) args.splice(params.findIndex(p => p.startsWith('n:')), 0, '3');
      const decls = (q) => '    let ' + (q === mut ? 'mut ' : '') + 'o' + q + ' = String::from("s' + q + '");';
      outer.forEach(q => L.push(decls(q)));
      const call = 'c' + id + '(' + args.join(', ') + ')';
      if (inner.length || chance(0.4)) {
        L.push('    let r;', '    {');
        inner.forEach(q => L.push('    ' + decls(q)));
        L.push('        r = ' + call + ';');
        if (inner.includes(mut) && chance(0.6)) L.push('        o' + mut + '.push_str("!");');
        L.push('    }');
        if (outer.includes(mut)) L.push('    o' + mut + '.push_str("!");');
      } else {
        L.push('    let r = ' + call + ';');
        if (outer.includes(mut)) L.push('    o' + mut + '.push_str("!");');
      }
      L.push('    println!("{}", r);', '}');
      return L;
    } };
}

function methodCase(id) {
  const W = 'W' + id, selfKind = pick(['&self', '&mut self']);
  const hasO = chance(0.6), oLt = hasO ? wpick([[5, null], [3, "'b"], [1, "'static"]]) : null;
  let retLt = wpick([[5, null], [4, "'a"], [2, "'b"], [1, "'static"]]);
  if (retLt === "'b" && oLt !== "'b") retLt = null;
  const decl = (oLt === "'b" || retLt === "'b") ? "<'b>" : '';
  const header = 'fn m' + decl + '(' + selfKind + (hasO ? ', o: &' + (oLt ? oLt + ' ' : '') + 'str' : '') + ') -> &' + (retLt ? retLt + ' ' : '') + 'str';
  const body = wpick([[5, 'self.s'], [hasO ? 4 : 0, 'o'], [2, '"lit"'], [hasO ? 1 : 0, 'if self.s.len() > o.len() { self.s } else { o }']]);
  const shape = pick(['two', 'wdies', 'textdies', 'otherdies', 'mutate']);
  const arg = hasO ? '&other' : '';
  return { id, kind: 'method', header, body, shape, hasO, selfKind,
    def: (h, b) => ['struct ' + W + "<'a> { s: &'a str }", "impl<'a> " + W + "<'a> {", '    ' + h + ' {', '        ' + b, '    }', '}'],
    caller: () => {
      const L = ['fn k' + id + '() {'], call = 'w.m(' + arg + ')';
      const other = '    let other = String::from("oo");';
      switch (shape) {
        case 'two': L.push('    let text = String::from("tt");', other, '    let mut w = ' + W + ' { s: &text };', '    let r1 = ' + call + ';', '    let r2 = ' + call + ';', '    println!("{} {}", r1, r2);'); break;
        case 'wdies': L.push('    let text = String::from("tt");', other, '    let r;', '    {', '        let mut w = ' + W + ' { s: &text };', '        r = ' + call + ';', '    }', '    println!("{}", r);'); break;
        case 'textdies': L.push(other, '    let r;', '    {', '        let text = String::from("tt");', '        let mut w = ' + W + ' { s: &text };', '        r = ' + call + ';', '    }', '    println!("{}", r);'); break;
        case 'otherdies': L.push('    let text = String::from("tt");', '    let mut w = ' + W + ' { s: &text };', '    let r;', '    {', hasO ? '    ' + other : '', '        r = ' + call + ';', '    }', '    println!("{}", r);'); break;
        default: L.push('    let mut text = String::from("tt");', other, '    let mut w = ' + W + ' { s: &text };', '    let r = ' + call + ';', '    text.push_str("!");', '    println!("{}", r);');
      }
      L.push('}');
      return L.filter(l => l !== '');
    } };
}

/* the widget's own table: five signatures x four bodies x three callers (the family MRView.CONTRACT defines, rendered through the same machinery) */
const V = require(path.join(LESSONS, 'mrview.js'));
const W_SIGS = V.CONTRACT.sigs.map(x => x.text), W_BODIES = V.CONTRACT.bodies.map(x => x.text), W_CALLERS = V.CONTRACT.callers.map(x => x.lines);
function widgetCase(id, s, b, c) {
  return { id, kind: 'widget', header: W_SIGS[s], body: W_BODIES[b], def: (h, bd) => [h + ' {', '    ' + bd, '}'], call: 'pick',
    caller: () => ['fn main_' + id + '() {'].concat(W_CALLERS[c], ['}']), tag: 'sig' + s + ' body' + b + ' caller' + c };
}
/* the widget's functions are all called `pick`: rename per case so they can share a file */
function renamePick(lines, id) { return lines.map(l => l.replace(/\bpick\b/g, 'pick' + id)); }

/* ───────────────────────────── rendering & running ───────────────────────────── */
const PRELUDE = '#![allow(unused)]';
/* variant: 'whole' | 'callee' (caller emptied) | 'caller' (callee body = loop {}) | 'sig' (both) | 'expanded' (header replaced) */
function render(c, variant, header) {
  const h = header || c.header;
  if (!c.callerLines) c.callerLines = c.caller();                 // the random choices are made once per case
  let def = c.def(h, variant === 'caller' || variant === 'sig' ? 'loop {}' : c.body), cal = c.callerLines.slice();
  if (c.kind === 'widget') { def = renamePick(def, c.id); cal = renamePick(cal, c.id); }
  if (variant === 'callee' || variant === 'sig') cal = [cal[0].replace(/^fn (\w+).*/, 'fn $1() {}')];
  return { def, cal };
}
function layout(cases, variant, headers) {
  const src = [PRELUDE], seg = [];
  cases.forEach((c, k) => {
    const r = render(c, variant, headers && headers[k]);
    const d0 = src.length + 1; r.def.forEach(l => src.push(l)); const d1 = src.length;
    const c0 = src.length + 1; r.cal.forEach(l => src.push(l)); const c1 = src.length;
    seg.push({ c, d0, d1, c0, c1 });
  });
  return { text: src.join('\n') + '\n', seg };
}
function rustcErrors(file) {
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json', '-A', 'warnings', '-o', path.join(tmp, 'x.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  for (const ln of r.stderr.split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const spans = d.spans || [], prim = spans.find(s => s.is_primary) || spans[0];
    out.push({ code: (d.code && d.code.code) || '', line: prim ? prim.line_start : 0, msg: d.message });
  }
  return out;
}
function halfOf(seg, line) { for (const s of seg) { if (line >= s.d0 && line <= s.d1) return { s, half: 'callee', rel: line - s.d0 + 1 }; if (line >= s.c0 && line <= s.c1) return { s, half: 'caller', rel: line - s.c0 + 1 }; } return null; }
/* errors of a batch, per case: sorted list of "half:code@relline" */
function sortedKeys(seg, errs) {
  const per = new Map(seg.map(s => [s.c.id, []]));
  errs.forEach(e => { const h = halfOf(seg, e.line); if (h) per.get(h.s.c.id).push(h.half + ':' + (e.code || 'error') + '@' + h.rel); });
  per.forEach(v => v.sort());
  return per;
}
let batchNo = 0;
function runBatch(cases, variant, headers, withEngine) {
  const L = layout(cases, variant, headers), file = path.join(tmp, 'b' + (batchNo++) + '.rs');
  fs.writeFileSync(file, L.text);
  const real = sortedKeys(L.seg, rustcErrors(file));
  let mine = null;
  if (withEngine) {
    const r = MR.check(L.text);
    if (r.parseError) { console.log('ENGINE PARSE ERROR', JSON.stringify(r.parseError), '\n' + L.text.split('\n').slice(Math.max(0, r.parseError.line - 6), r.parseError.line + 3).join('\n')); process.exit(2); }
    mine = sortedKeys(L.seg, r.errors.map(e => ({ code: e.code, line: e.line })));
  }
  return { L, real, mine };
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
let shown = 0;
function show(title, c, lines, extra) {
  if (shown++ >= SHOW) return;
  console.log('\n──── ' + title + ' ────');
  lines.forEach((l, k) => console.log(String(k + 1).padStart(3) + '  ' + l));
  if (extra) console.log(extra);
}

/* ───────────────────────────── run ───────────────────────────── */
const cases = [];
let nid = 0;
for (let s = 0; s < W_SIGS.length; s++) for (let b = 0; b < W_BODIES.length; b++) for (let k = 0; k < W_CALLERS.length; k++) cases.push(widgetCase(nid++, s, b, k));
const nWidget = cases.length;
for (let i = 0; i < N; i++) cases.push(i % 3 === 2 ? methodCase(nid++) : freeCase(nid++));

const stats = { elision: 0, elisionBad: 0, elisionRejected: 0, modular: 0, modularBad: 0, modularWithErrors: 0, engine: 0, engineBad: 0, engineRejected: 0, expand: 0, expandBad: 0, expandChanged: 0 };
const codeCounts = {};

/* (1) ELISION — signature only */
const sigRun = runBatch(cases, 'sig', null, false);
const sigsInfo = MR.sigs(sigRun.L.text);
if (sigsInfo.parseError) { console.log('ENGINE PARSE ERROR in sigs', JSON.stringify(sigsInfo.parseError)); process.exit(2); }
const expl = new Map();     // case id -> { explicit, written, rule }
sigRun.L.seg.forEach(s => {
  const want = s.c.kind === 'method' ? 'm' : (s.c.kind === 'widget' ? 'pick' + s.c.id : 'c' + s.c.id);
  const e = sigsInfo.fns.filter(f => f.name === want && f.line >= s.d0 && f.line <= s.d1)[0];
  expl.set(s.c.id, e);
});
const okCases = [];
cases.forEach(c => {
  const real = (sigRun.real.get(c.id) || []).filter(k => /E0106/.test(k)).length > 0;
  const e = expl.get(c.id), mine = !!e && e.rule === 'none';
  stats.elision++; if (real) stats.elisionRejected++;
  if (real !== mine) { stats.elisionBad++; show('ELISION DISAGREES (rustc ' + (real ? 'E0106' : 'accepts') + ', MiniRust ' + (mine ? 'E0106' : 'accepts') + ')', c, render(c, 'whole').def, e && e.written); }
  if (!real && !mine) okCases.push(c);
  if (real) c.noBorrowck = true;
});

/* (2) MODULARITY, (3) THE ENGINE, (4) EXPANSION — on the cases whose signature elision completes */
const BATCH = 60;
for (let i = 0; i < okCases.length; i += BATCH) {
  const part = okCases.slice(i, i + BATCH);
  const whole = runBatch(part, 'whole', null, true);
  const callee = runBatch(part, 'callee', null, false);
  const caller = runBatch(part, 'caller', null, false);
  const headers = part.map(c => { const e = expl.get(c.id); return e.explicit && e.explicit !== e.written ? e.explicit : null; });
  const exp = runBatch(part, 'whole', headers.map((h, k) => h || part[k].header), false);
  part.forEach((c, k) => {
    const w = whole.real.get(c.id), m = whole.mine.get(c.id);
    // (2) the whole program's errors are the callee's (with nothing calling it) plus the caller's (with a stub callee)
    const union = (callee.real.get(c.id) || []).filter(x => x.startsWith('callee:')).concat((caller.real.get(c.id) || []).filter(x => x.startsWith('caller:'))).sort();
    stats.modular++; if (w.length) stats.modularWithErrors++;
    if (!same(w, union)) { stats.modularBad++; show('MODULARITY FAILS for case ' + c.id, c, whole.L.text.split('\n').slice(whole.L.seg.filter(s => s.c === c)[0].d0 - 1, whole.L.seg.filter(s => s.c === c)[0].c1), 'whole=' + JSON.stringify(w) + ' union=' + JSON.stringify(union)); }
    // (3) MiniRust vs rustc
    stats.engine++; if (w.length) stats.engineRejected++;
    w.forEach(x => { const code = x.split(':')[1].split('@')[0]; codeCounts[code] = (codeCounts[code] || 0) + 1; });
    if (!same(w, m)) { stats.engineBad++; const s0 = whole.L.seg.filter(s => s.c === c)[0]; show('ENGINE DISAGREES for case ' + c.id, c, whole.L.text.split('\n').slice(s0.d0 - 1, s0.c1), 'rustc=' + JSON.stringify(w) + ' minirust=' + JSON.stringify(m)); }
    // (4) the expanded signature
    if (headers[k]) {
      stats.expandChanged++;
      const x = exp.real.get(c.id);
      // rustc words the mismatch as E0621 when the offending parameter's lifetime was elided, and without a code once it is written out
      const n21 = (l) => l.map(k => k.replace('E0621', 'error')).sort();
      if (!same(n21(w), n21(x))) { stats.expandBad++; const s0 = exp.L.seg.filter(s => s.c === c)[0]; show('EXPANSION DISAGREES for case ' + c.id, c, exp.L.text.split('\n').slice(s0.d0 - 1, s0.c1), 'as written=' + JSON.stringify(w) + ' expanded=' + JSON.stringify(x)); }
    }
    stats.expand++;
  });
}

/* ───────────────────────────── report ───────────────────────────── */
const nFree = cases.filter(c => c.kind === 'free').length, nMeth = cases.filter(c => c.kind === 'method').length;
console.log(cases.length + ' cases (' + nWidget + ' from the widget\'s table, ' + nFree + ' random free functions, ' + nMeth + ' random methods)');
console.log('(1) elision: the three rules complete the signature  ==  rustc:  ' + (stats.elision - stats.elisionBad) + '/' + stats.elision + ' agree (' + stats.elisionRejected + ' rejected with E0106 by rustc; ' + stats.elisionBad + ' mismatches)');
console.log('(2) modularity: errors(whole) == errors(callee, nothing calls it) + errors(caller, stub callee):  ' + (stats.modular - stats.modularBad) + '/' + stats.modular + ' agree (' + stats.modularWithErrors + ' programs with errors; ' + stats.modularBad + ' mismatches)');
console.log('(3) MiniRust (half, code, line) == rustc:  ' + (stats.engine - stats.engineBad) + '/' + stats.engine + ' agree (' + stats.engineRejected + ' rejected by rustc; ' + stats.engineBad + ' mismatches); codes seen ' + JSON.stringify(codeCounts));
console.log('(4) expanded signature == elided signature, per rustc:  ' + (stats.expandChanged - stats.expandBad) + '/' + stats.expandChanged + ' agree (' + stats.expandBad + ' mismatches)');
const bad = stats.elisionBad + stats.modularBad + stats.engineBad + stats.expandBad;
process.exit(bad ? 1 : 0);
