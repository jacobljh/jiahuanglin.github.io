#!/usr/bin/env node
/* Oracle for Lesson 07 ("The borrow checker — liveness on the control-flow graph").
 *
 *   node tools/rust_verify/07_region_probe.js [programs=150] [seed=7]
 *
 * The lesson says a region is liveness on the control-flow graph, and the widget (MiniRust.flow / flowAll) shows, per
 * line, the references that are live on entry and the loans that are in scope. rustc exposes neither, so the test
 * has three independent witnesses:
 *
 *   (1) LIVENESS — the generator builds programs as trees (blocks, if/else, while, for, loop, iterators, break,
 *       continue, return), so the expected live set at every statement is computed by a second implementation of
 *       liveness, written by structural recursion on the tree (loops by fixed point), not by dataflow on a graph.
 *       It must equal MiniRust's `at[line].live`.
 *   (2) SCOPE — a loan on `x` is in scope on entry to a line exactly when an exclusive access to `x` placed there is
 *       rejected. For every statement line of every program, `x.clear();` is inserted before it and the variant is
 *       compiled with the real rustc; the prediction is read from the BASE program's MiniRust.flow `scope`.
 *   (3) ANATOMY — where rustc rejects a probe with E0499/E0502, MiniRust's B (the borrow) and U (the later use) lines
 *       must equal the lines rustc labels, and on every variant the whole set of (error code, line) must agree.
 *
 * Three more families check the lesson's claims directly against rustc, program by program:
 *   (4) TWO-PHASE — `x.push(E)` for expressions E that read x: MiniRust must agree with rustc, and MiniRust with two-phase
 *       switched off must agree with rustc on the written-out `Vec::push(&mut x, E)` (the lesson's counterfactual).
 *   (5) PROBLEM CASE 3 — a borrow returned on one path, then used again on the other.
 *   (6) PLACES — two borrows of fields, indices and whole values.
 * Exit status 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const LESSONS = path.join(__dirname, '../../all_lessons/rust/lessons');
const MR = require(process.env.MR || path.join(LESSONS, 'minirust.js'));
const N = +(process.argv[2] || 150), SEED = +(process.argv[3] || 7);
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe07-'));

let seed = SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)], chance = (p) => rnd() < p;
function wpick(pairs) { let t = 0; for (const [w] of pairs) t += w; let r = rnd() * t; for (const [w, v] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][1]; }

const PRELUDE = '#![allow(unused)]\nfn cond() -> bool { false }\n';

/* ───────────────────────── the generator: programs as trees ───────────────────────── */
const TY = { shV: '&Vec<i32>', shI: '&i32', exV: '&mut Vec<i32>', exI: '&mut i32' };
const borrowOf = (kind, owner) => ({ shV: '&' + owner, shI: '&' + owner + '[0]', exV: '&mut ' + owner, exI: '&mut ' + owner + '[0]' })[kind];
const useOf = (kind, name) => ({ shV: 'println!("{}", ' + name + '.len());', shI: 'println!("{}", *' + name + ');', exV: name + '.push(1);', exI: '*' + name + ' += 1;' })[kind];

function genProgram(allowDirect) {
  let uid = 0;
  const scopes = [[]];
  const vars = () => scopes.flat();
  const fresh = () => 'r' + (uid++);
  function block(depth, n, loop) {
    scopes.push([]);
    const out = [];
    for (let i = 0; i < n; i++) { const s = stmt(depth, loop); if (s) out.push(s); }
    scopes.pop();
    return out;
  }
  function stmt(depth, loop) {
    const vs = vars(), sh = vs.filter(v => v.kind[0] === 's'), ex = vs.filter(v => v.kind[0] === 'e');
    const c = [[4, 'let'], [5, 'use']];
    if (vs.length) c.push([2, 'set']);
    if (sh.length) c.push([2, 'copy']);
    if (vs.length) c.push([1.5, 'reb']);
    if (allowDirect) c.push([1.2, 'direct']);
    if (depth < 3) c.push([2.5, 'if'], [1, 'while'], [1, 'for'], [0.8, 'loop'], [1, 'foriter']);
    c.push([0.8, 'ifret']);
    if (loop) c.push([1.3, 'ifbrk'], [0.8, 'ifcont']);
    const k = wpick(c);
    if (k === 'let') { const kind = pick(['shV', 'shI', 'exV', 'exI']), owner = chance(0.75) ? 'x' : 'y', name = fresh(); const node = { t: 'let', name, kind, owner, init: borrowOf(kind, owner) }; scopes[scopes.length - 1].push({ name, kind }); return node; }
    if (k === 'use') { if (!vs.length) return null; const v = pick(vs); return { t: 'use', name: v.name, text: useOf(v.kind, v.name), uses: [v.name] }; }
    if (k === 'set') { const v = pick(vs); return { t: 'set', name: v.name, init: borrowOf(v.kind, chance(0.75) ? 'x' : 'y') }; }
    if (k === 'copy') { const f = pick(sh), name = fresh(); scopes[scopes.length - 1].push({ name, kind: f.kind }); return { t: 'copy', name, from: f.name, kind: f.kind }; }
    if (k === 'reb') { const f = pick(vs), name = fresh(); scopes[scopes.length - 1].push({ name, kind: f.kind }); return { t: 'reb', name, from: f.name, kind: f.kind }; }
    if (k === 'direct') { return { t: 'direct', text: pick(['x.push(9);', 'x.len();', 'y.push(9);', 'y.len();']) }; }
    if (k === 'if') { const a = block(depth + 1, 1 + ri(3), loop); const b = chance(0.6) ? block(depth + 1, 1 + ri(3), loop) : null; return { t: 'if', then: a, els: b }; }
    if (k === 'while') return { t: 'while', body: block(depth + 1, 1 + ri(3), true) };
    if (k === 'for') return { t: 'for', body: block(depth + 1, 1 + ri(3), true) };
    if (k === 'loop') { const b = block(depth + 1, 1 + ri(3), true); b.push({ t: 'ifbrk' }); return { t: 'loop', body: b }; }
    if (k === 'foriter') {
      const owner = chance(0.8) ? 'x' : 'y', name = fresh();
      scopes.push([{ name, kind: 'shI' }]);
      const body = block(depth + 1, 1 + ri(3), true);
      scopes.pop();
      return { t: 'foriter', name, owner, body };
    }
    if (k === 'ifret') return { t: 'ifret' };
    if (k === 'ifbrk') return { t: 'ifbrk' };
    if (k === 'ifcont') return { t: 'ifcont' };
    return null;
  }
  return { body: block(0, 4 + ri(5), false) };
}

/* render to text; every statement gets its 1-based line inside the function (line 1 is `fn`, 2 and 3 declare x and y) */
function render(prog, name) {
  const lines = ['fn ' + name + '() {', '    let mut x = vec![1, 2, 3];', '    let mut y = vec![4, 5];'];
  const push = (d, s) => { lines.push('    '.repeat(d) + s); return lines.length; };
  function go(list, d) {
    list.forEach(s => {
      switch (s.t) {
        case 'let': s.line = push(d, 'let mut ' + s.name + ': ' + TY[s.kind] + ' = ' + s.init + ';'); break;
        case 'use': s.line = push(d, s.text); break;
        case 'set': s.line = push(d, s.name + ' = ' + s.init + ';'); break;
        case 'copy': s.line = push(d, 'let mut ' + s.name + ': ' + TY[s.kind] + ' = ' + s.from + ';'); break;
        case 'reb': s.line = push(d, 'let mut ' + s.name + ': ' + TY[s.kind] + ' = ' + (s.kind[0] === 's' ? '&*' : '&mut *') + s.from + ';'); break;
        case 'direct': s.line = push(d, s.text); break;
        case 'if': s.line = push(d, 'if cond() {'); go(s.then, d + 1); if (s.els) { push(d, '} else {'); go(s.els, d + 1); } push(d, '}'); break;
        case 'while': s.line = push(d, 'while cond() {'); go(s.body, d + 1); push(d, '}'); break;
        case 'for': s.line = push(d, 'for i in 0..2 {'); go(s.body, d + 1); push(d, '}'); break;
        case 'loop': s.line = push(d, 'loop {'); go(s.body, d + 1); push(d, '}'); break;
        case 'foriter': s.line = push(d, 'for ' + s.name + ' in ' + s.owner + '.iter() {'); go(s.body, d + 1); push(d, '}'); break;
        case 'ifret': s.line = push(d, 'if cond() {'); push(d + 1, 'return;'); push(d, '}'); break;
        case 'ifbrk': s.line = push(d, 'if cond() {'); push(d + 1, 'break;'); push(d, '}'); break;
        case 'ifcont': s.line = push(d, 'if cond() {'); push(d + 1, 'continue;'); push(d, '}'); break;
      }
    });
  }
  go(prog.body, 1);
  lines.push('}');
  return lines;
}

/* ───────── witness 1: liveness by structural recursion (no graph, no dataflow) ───────── */
const U = (a, b) => { const s = new Set(a); b.forEach(v => s.add(v)); return s; };
function live(list, out, ctx) {                         // live-in of a block, given live-out; records `liveIn` on every statement
  let cur = out;
  for (let i = list.length - 1; i >= 0; i--) cur = liveStmt(list[i], cur, ctx);
  return cur;
}
function liveStmt(s, out, ctx) {
  let inn;
  switch (s.t) {
    case 'let': case 'set': { inn = new Set(out); inn.delete(s.name); break; }
    case 'copy': case 'reb': { inn = new Set(out); inn.delete(s.name); inn.add(s.from); break; }
    case 'use': inn = U(out, [s.name]); break;
    case 'direct': inn = new Set(out); break;
    case 'if': { const a = live(s.then, out, ctx), b = s.els ? live(s.els, out, ctx) : out; inn = U(a, b); break; }
    case 'ifret': inn = new Set(out); break;       // the `return` path has nothing live, the other path is `out`
    case 'ifbrk': inn = U(out, ctx.brk || []); break;
    case 'ifcont': inn = U(out, ctx.cont || []); break;
    case 'while': case 'for': case 'foriter': {
      let head = new Set(out);
      for (;;) {
        const c2 = { brk: out, cont: head };
        let body = live(s.body, head, c2);
        if (s.t === 'foriter') { body = new Set(body); body.delete(s.name); }
        const nh = U(out, body);
        if (nh.size === head.size) break;
        head = nh;
      }
      live(s.body, head, { brk: out, cont: head });    // final, recording pass
      inn = head;
      break;
    }
    case 'loop': {
      let head = new Set();
      for (;;) {
        const nh = live(s.body, head, { brk: out, cont: head });
        if (nh.size === head.size) { head = nh; break; }
        head = nh;
      }
      live(s.body, head, { brk: out, cont: head });
      inn = head;
      break;
    }
  }
  s.liveIn = inn;
  return inn;
}
/* a `loop`'s trailing `if cond() { break; }` is an `ifbrk`; in `live()` above, `ifbrk` sees ctx.brk = the loop's live-out */
function allStmts(list, acc) { list.forEach(s => { acc.push(s); ['then', 'els', 'body'].forEach(k => { if (s[k]) allStmts(s[k], acc); }); }); return acc; }

/* ───────── rustc ───────── */
function rustcErrors(file) {
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json', '-A', 'warnings', '-o', path.join(tmp, 'x.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  for (const ln of r.stderr.split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const spans = d.spans || [], prim = spans.find(s => s.is_primary) || spans[0];
    let loanLine = null, useLine = null;
    for (const s of spans) {
      const lab = s.label || '';
      if (s.is_primary) continue;
      if (/later used|used here|used by call/.test(lab) && useLine === null) useLine = s.line_start;
      else if (/borrow.*occurs here|is borrowed here|borrowed here/.test(lab) && loanLine === null) loanLine = s.line_start;
    }
    out.push({ code: (d.code && d.code.code) || '', line: prim ? prim.line_start : 0, loanLine, useLine, msg: d.message });
  }
  return out;
}

/* a batch = one file of functions; returns the functions' extents so errors can be attributed */
function compileBatch(funcs, tag, prelude, noEngine) {
  const src = (prelude || PRELUDE).trimEnd().split('\n'), ranges = [];
  funcs.forEach(f => { const start = src.length + 1; f.lines.forEach(l => src.push(l)); ranges.push({ f, start, end: src.length }); });
  const text = src.join('\n') + '\n', file = path.join(tmp, tag + '.rs');
  fs.writeFileSync(file, text);
  const real = rustcErrors(file);
  const mine = noEngine ? { errors: [] } : MR.check(text);
  if (mine.parseError) { console.log('ENGINE PARSE ERROR', JSON.stringify(mine.parseError), '\n' + text.split('\n').slice(Math.max(0, mine.parseError.line - 4), mine.parseError.line + 2).join('\n')); process.exit(2); }
  const rangeOf = (line) => ranges.find(r => line >= r.start && line <= r.end);
  ranges.forEach(r => { r.real = []; r.mine = []; });
  real.forEach(e => { const r = rangeOf(e.line); if (r) r.real.push(e); });
  mine.errors.forEach(e => { const r = rangeOf(e.line); if (r) r.mine.push(e); });
  return { ranges, text };
}
const key = (e, start) => e.code + '@' + (e.line - start + 1);
const sameSet = (a, b) => a.size === b.size && [...a].every(k => b.has(k));

/* ───────────────────────── run: witnesses 1-3 ───────────────────────── */
const stats = { programs: 0, liveLines: 0, liveBad: 0, probes: 0, probeBad: 0, probeRejected: 0, variants: 0, variantBad: 0, anat: 0, anatExact: 0, anatOther: 0, anatBad: 0 };
let shown = 0;
function show(title, lines, extra) { if (shown++ < (+process.env.SHOWN || 8)) { console.log('\n──── ' + title + ' ────'); lines.forEach((l, k) => console.log(String(k + 1).padStart(3) + '  ' + l)); if (extra) console.log(extra); } }

const progs = [];
for (let i = 0; i < N; i++) {
  const p = genProgram(chance(0.5));
  p.name = 'p' + i; p.lines = render(p, p.name);
  live(p.body, new Set(), {});
  p.stmts = allStmts(p.body, []);
  progs.push(p);
}

/* base file, for MiniRust.flow */
{
  const src = PRELUDE.trimEnd().split('\n'), starts = [];
  progs.forEach(p => { starts.push(src.length + 1); p.lines.forEach(l => src.push(l)); });
  const text = src.join('\n') + '\n';
  const fa = MR.flowAll(text);
  if (fa.parseError) { console.log('ENGINE PARSE ERROR in base file', JSON.stringify(fa.parseError)); process.exit(2); }
  progs.forEach((p, i) => {
    const S = starts[i];
    p.base = (rel) => fa.at[S + rel - 1];
    p.loansOnXAtLine = (rel) => { const at = fa.at[S + rel - 1]; if (!at) return []; return at.scope.map(id => fa.loans.filter(q => q.id === id)[0]).filter(l => l && l.place === 'x').map(l => ({ line: l.line - S + 1 })); };
    p.loansOnX = (rel) => { const at = fa.at[S + rel - 1]; if (!at) return false; return at.scope.some(id => { const l = fa.loans.filter(q => q.id === id)[0]; return l && l.place === 'x'; }); };
    // (1) liveness: every statement start line
    p.stmts.forEach(s => {
      const at = fa.at[S + s.line - 1];
      const mineLive = at ? at.live.filter(n => n !== '⟨iterator⟩').sort() : [];
      const want = [...s.liveIn].filter(n => /^r\d+$/.test(n)).sort();
      stats.liveLines++;
      if (mineLive.join(',') !== want.join(',')) {
        stats.liveBad++;
        show('LIVENESS MISMATCH at line ' + s.line + ' of ' + p.name, p.lines, 'structural: {' + want.join(',') + '}   MiniRust: {' + mineLive.join(',') + '}');
      }
    });
    stats.programs++;
  });
}

/* variants: `x.clear();` inserted before every statement line of a non-header kind */
const variants = [];
progs.forEach(p => {
  p.stmts.forEach(s => {
    if (['while', 'for', 'loop', 'foriter'].includes(s.t)) return;           // the state before a loop and at its head differ
    const d = /^ */.exec(p.lines[s.line - 1])[0].length;
    const lines = p.lines.slice(); lines.splice(s.line - 1, 0, ' '.repeat(d) + 'x.clear();');
    lines[0] = 'fn ' + p.name + '_' + s.line + '() {';
    variants.push({ p, s, lines });
  });
});
const BATCH = 140;
for (let b = 0; b * BATCH < variants.length; b++) {
  const chunk = variants.slice(b * BATCH, (b + 1) * BATCH);
  const { ranges } = compileBatch(chunk, 'v' + b);
  ranges.forEach(r => {
    const { p, s } = r.f, probeRel = s.line;
    const real = new Set(r.real.map(e => key(e, r.start))), mine = new Set(r.mine.map(e => key(e, r.start)));
    stats.variants++;
    if (!sameSet(real, mine)) { stats.variantBad++; show('ERROR SETS DIFFER for ' + r.f.lines[0] + ' (probe on line ' + probeRel + ')', r.f.lines, 'rustc: ' + [...real].sort().join(' ') + '\nmine : ' + [...mine].sort().join(' ')); }
    // (2) scope prediction from the base program
    const rejected = r.real.some(e => e.line - r.start + 1 === probeRel && /^E0(499|502)$/.test(e.code));
    const predicted = p.loansOnX(s.line);
    stats.probes++; if (rejected) stats.probeRejected++;
    if (rejected !== predicted) { stats.probeBad++; show('SCOPE MISMATCH: probe before line ' + s.line + ' of ' + p.name, p.lines, 'rustc rejects the probe: ' + rejected + '   MiniRust says a loan on x is in scope: ' + predicted); }
    // (3) anatomy of the probe's own error
    const re = r.real.find(e => e.line - r.start + 1 === probeRel && /^E0(499|502)$/.test(e.code));
    const me = r.mine.find(e => e.line - r.start + 1 === probeRel && /^E0(499|502)$/.test(e.code));
    if (re && me) {
      stats.anat++;
      const rl = [re.loanLine === null ? null : re.loanLine - r.start + 1, re.useLine === null ? null : re.useLine - r.start + 1], ml = [me.loanLine - r.start + 1, me.useLine === null ? null : me.useLine - r.start + 1];
      if (rl[0] === ml[0] && rl[1] === ml[1]) stats.anatExact++;
      else {
        // several loans (or several later uses) can qualify; rustc's choice follows the order of its own MIR blocks.
        // The engine's choice must still be a real one: B = a loan on x in scope at the probe, U = a statement that uses a reference live there.
        const toBase = (ln) => ln > s.line ? ln - 1 : ln;                  // the probe shifts every later line of the variant down by one
        const okB = rl[0] === ml[0] || p.loansOnXAtLine(s.line).some(l => l.line === toBase(ml[0]));
        const us = p.stmts.filter(t => t.line === toBase(ml[1]))[0];
        const live = s.liveIn;
        const okU = rl[1] === ml[1] || (us && ((us.t === 'use' && live.has(us.name)) || ((us.t === 'copy' || us.t === 'reb') && live.has(us.from)) || us.t === 'foriter' || us.t === 'for' || us.t === 'while' || us.t === 'loop'));
        if (okB && okU) stats.anatOther++;
        else { stats.anatBad++; show('B/U LINES DIFFER (and the engine\'s choice is not a valid one) for ' + r.f.lines[0], r.f.lines, 'rustc: B ' + rl[0] + ' U ' + rl[1] + '   mine: B ' + ml[0] + ' U ' + ml[1]); }
      }
    }
  });
}

/* ───────────────────────── witness 4: two-phase, and its counterfactual ───────────────────────── */
const tpStats = { n: 0, bad: 0, cfBad: 0, rejected: 0, rescued: 0 };
{
  // each prefix declares some references; `uses` lists what an expression or a trailing statement may mention
  const prefixes = [
    { pre: [], has: [] },
    { pre: ['let r = &x;'], has: ['r'] },
    { pre: ['let r = &x;', 'let q = &x[0];'], has: ['r', 'q'] },
    { pre: ['let r = &y;'], has: ['r'] },
    { pre: ['let q = &x[0];'], has: ['q'] },
  ];
  const exprs = [['x.len()', []], ['x[0]', []], ['y.len()', []], ['x.len() + x.len()', []], ['r.len()', ['r']], ['*q', ['q']], ['r.len() + 1', ['r']]];
  const afters = [['', []], ['r.len();', ['r']], ['println!("{}", *q);', ['q']]];
  const cases = [];
  for (const p of prefixes) for (const [e, need] of exprs) for (const [after, need2] of afters)
    if (need.concat(need2).every(v => p.has.includes(v))) cases.push({ pre: p.pre, e, after });
  const mk = (c, form, name) => {
    const call = form === 'method' ? 'x.push(' + c.e + ');' : 'Vec::push(&mut x, ' + c.e + ');';
    return ['fn ' + name + '() {', '    let mut x = vec![1, 2, 3];', '    let mut y = vec![4, 5];'].concat(c.pre.map(l => '    ' + l), ['    ' + call], c.after ? ['    ' + c.after] : [], ['}']);
  };
  const meth = cases.map((c, i) => ({ lines: mk(c, 'method', 'm' + i) })), expl = cases.map((c, i) => ({ lines: mk(c, 'explicit', 'e' + i) }));
  const rm = compileBatch(meth, 'tp_m'), re = compileBatch(expl, 'tp_e', null, true);
  // the engine with two-phase switched off, on the method-call form
  const offSrc = PRELUDE.trimEnd().split('\n'), offStart = [];
  meth.forEach(f => { offStart.push(offSrc.length + 1); f.lines.forEach(l => offSrc.push(l)); });
  const offRes = MR.check.length >= 0 ? MR.flow(offSrc.join('\n') + '\n', { noTwoPhase: true }) : null;
  meth.forEach((f, i) => {
    const a = rm.ranges[i], bb = re.ranges[i];
    const real = new Set(a.real.map(e => key(e, a.start))), mine = new Set(a.mine.map(e => key(e, a.start)));
    const realExpl = new Set(bb.real.map(e => key(e, bb.start)));
    const offMine = new Set(offRes.errors.filter(e => e.line >= offStart[i] && e.line < offStart[i] + f.lines.length).map(e => key(e, offStart[i])));
    tpStats.n++; if (realExpl.size) tpStats.rejected++; if (!real.size && realExpl.size) tpStats.rescued++;
    if (!sameSet(real, mine)) { tpStats.bad++; show('TWO-PHASE (on) MISMATCH', f.lines, 'rustc: ' + [...real].sort().join(' ') + '\nmine : ' + [...mine].sort().join(' ')); }
    if (!sameSet(realExpl, offMine)) { tpStats.cfBad++; show('TWO-PHASE COUNTERFACTUAL MISMATCH (engine, two-phase off) vs (rustc, written-out &mut)', f.lines, 'rustc written-out: ' + [...realExpl].sort().join(' ') + '\nmine (off)      : ' + [...offMine].sort().join(' ')); }
  });
}

/* ───────────────────────── witness 5: problem case 3 ───────────────────────── */
const c3Stats = { n: 0, bad: 0, rejected: 0 };
{
  const fns = [];
  let k = 0;
  for (const amp of ['&mut ', '&']) {
    const ret = amp === '&' ? '&String' : '&mut String';
    for (const cond of ['first.len() > 3', 'cond()']) {
      for (const shape of ['then', 'else', 'none', 'usedAfter']) {
        for (const access of ['v.push(String::new());', 'v.len();', 'let n = &v[0];', 'v.clear();']) {
          const lines = ['fn c' + k + '(v: &mut Vec<String>) -> ' + ret + ' {', '    let first = ' + amp + 'v[0];'];
          if (shape === 'then') lines.push('    if ' + cond + ' {', '        return first;', '    }');
          else if (shape === 'else') lines.push('    if ' + cond + ' {', '        first.len();', '    } else {', '        return first;', '    }');
          else if (shape === 'none') lines.push('    if ' + cond + ' {', '        first.len();', '    }');
          else lines.push('    if ' + cond + ' {', '        return first;', '    }', '    first.len();');
          lines.push('    ' + access, '    ' + amp + 'v[0]', '}');
          fns.push({ lines }); k++;
        }
      }
    }
  }
  for (let b = 0; b * BATCH < fns.length; b++) {
    const chunk = fns.slice(b * BATCH, (b + 1) * BATCH);
    const { ranges } = compileBatch(chunk, 'c3_' + b);
    ranges.forEach(r => {
      const real = new Set(r.real.map(e => key(e, r.start))), mine = new Set(r.mine.map(e => key(e, r.start)));
      c3Stats.n++; if (real.size) c3Stats.rejected++;
      if (!sameSet(real, mine)) { c3Stats.bad++; show('PROBLEM-CASE-3 MISMATCH', r.f.lines, 'rustc: ' + [...real].sort().join(' ') + '\nmine : ' + [...mine].sort().join(' ')); }
    });
  }
}

/* ───────────────────────── witness 6: places ───────────────────────── */
const plStats = { n: 0, bad: 0, rejected: 0 };
{
  const fns = [];
  const places = ['x[0]', 'x[1]', 'x', 'p.f', 'p.g', 'p', 'q[0]'];
  const use = (name, pl) => pl === 'p' ? name + '.f.len();' : name + '.len();';
  let k = 0;
  for (const pa of places) for (const pb of places) for (const ka of ['&', '&mut ']) for (const kb of ['&', '&mut ']) for (const order of ['ab', 'ba']) {
    const lines = ['fn q' + k + '() {', '    let mut x = vec![String::new(), String::new()];', '    let mut q = vec![String::new()];', '    let mut p = Pair { f: String::new(), g: String::new() };',
      '    let a = ' + ka + pa + ';', '    let b = ' + kb + pb + ';'];
    lines.push(order === 'ab' ? '    ' + use('a', pa) : '    ' + use('b', pb), order === 'ab' ? '    ' + use('b', pb) : '    ' + use('a', pa), '}');
    fns.push({ lines }); k++;
  }
  const prelude2 = PRELUDE + 'struct Pair { f: String, g: String }\n';
  for (let b = 0; b * BATCH < fns.length; b++) {
    const chunk = fns.slice(b * BATCH, (b + 1) * BATCH);
    const { ranges } = compileBatch(chunk, 'pl' + b, prelude2);
    ranges.forEach(r => {
      const a = new Set(r.real.map(e => key(e, r.start))), c = new Set(r.mine.map(e => key(e, r.start)));
      plStats.n++; if (a.size) plStats.rejected++;
      if (!sameSet(a, c)) { plStats.bad++; show('PLACES MISMATCH', r.f.lines, 'rustc: ' + [...a].sort().join(' ') + '\nmine : ' + [...c].sort().join(' ')); }
    });
  }
}

/* ───────────────────────── report ───────────────────────── */
const pct = (a, b) => b ? (100 * (b - a) / b).toFixed(2) + '%' : '-';
console.log('\n' + stats.programs + ' random programs (trees of blocks, if/else, while, for, loop, iterators, break, continue, return)');
console.log('(1) liveness: structural recursion == MiniRust live-on-entry on ' + (stats.liveLines - stats.liveBad) + '/' + stats.liveLines + ' statement lines (' + stats.liveBad + ' mismatches)');
console.log('(2) scope: "a loan on x is in scope on entry" == "rustc rejects x.clear() there" on ' + (stats.probes - stats.probeBad) + '/' + stats.probes + ' probes (' + stats.probeRejected + ' rejected by rustc; ' + stats.probeBad + ' mismatches)');
console.log('    whole error sets of the probed variants agree: ' + (stats.variants - stats.variantBad) + '/' + stats.variants + ' (' + stats.variantBad + ' mismatches)');
console.log('(3) anatomy: B and U lines equal rustc\'s on ' + stats.anatExact + '/' + stats.anat + ' probe errors; in ' + stats.anatOther + ' more the engine names another valid loan or later use (rustc\'s pick follows its MIR block order); ' + stats.anatBad + ' invalid');
console.log('(4) two-phase: ' + (tpStats.n - tpStats.bad) + '/' + tpStats.n + ' agree with rustc; counterfactual (engine off == rustc on written-out &mut): ' + (tpStats.n - tpStats.cfBad) + '/' + tpStats.n + '; ' + tpStats.rescued + ' programs are rejected without two-phase and accepted with it');
console.log('(5) problem case 3: ' + (c3Stats.n - c3Stats.bad) + '/' + c3Stats.n + ' agree with rustc (' + c3Stats.rejected + ' rejected)');
console.log('(6) places: ' + (plStats.n - plStats.bad) + '/' + plStats.n + ' agree with rustc (' + plStats.rejected + ' rejected)');
process.exit(stats.liveBad || stats.probeBad || stats.variantBad || stats.anatBad || tpStats.bad || tpStats.cfBad || c3Stats.bad || plStats.bad ? 1 : 0);
