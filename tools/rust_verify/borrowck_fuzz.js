#!/usr/bin/env node
/* Differential fuzz: MiniRust (all_lessons/rust/lessons/minirust.js) vs rustc's borrow checker.
 *
 *   node tools/rust_verify/borrowck_fuzz.js [programs=600] [seed=1] [profile=basic] [--show N]
 *
 * Generates random well-typed programs in the mini language (each one a `fn pN()`), compiles them
 * in batches with the real rustc, and compares — per program — the set of (error code, primary line)
 * and, for loan conflicts, the line of the first borrow and of the "borrow later used" line.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ENGINE = process.env.MR || path.join(__dirname, '../../all_lessons/rust/lessons/minirust.js');
const MR = require(ENGINE);

const N = +(process.argv[2] || 600), SEED = +(process.argv[3] || 1), PROFILE = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'basic';
const SHOW = (() => { const i = process.argv.indexOf('--show'); return i > 0 ? +process.argv[i + 1] : 6; })();
let seed = SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];
const chance = (p) => rnd() < p;
function wpick(pairs) { let t = 0; for (const [w] of pairs) t += w; let r = rnd() * t; for (const [w, v] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][1]; }

const PRELUDE = `#![allow(unused)]
fn cond() -> bool { false }
fn take_s(s: String) {}
fn take_v(v: Vec<usize>) {}
fn show_s(s: &String) {}
fn show_v(v: &Vec<usize>) {}
fn edit_s(s: &mut String) {}
fn edit_v(v: &mut Vec<usize>) {}
fn get_first<'a>(v: &'a Vec<usize>) -> &'a usize { &v[0] }
fn pick<'a>(a: &'a String, b: &'a String) -> &'a String { if cond() { a } else { b } }
fn make_s() -> String { String::new() }
fn id_i(x: usize) -> usize { x }
struct P { a: usize, s: String }
impl P {
    fn get(&self) -> &String { &self.s }
    fn set(&mut self, n: usize) { self.a = n; }
    fn len(&self) -> usize { self.s.len() }
    fn into_s(self) -> String { self.s }
    fn name_mut(&mut self) -> &mut String { &mut self.s }
}
`;

/* ───────────── types ───────────── */
const T = {
  I: 'usize', S: 'String', V: 'Vec<usize>', VS: 'Vec<String>', P: 'P',
  RI: '&usize', MI: '&mut usize', RS: '&String', MS: '&mut String', RV: '&Vec<usize>', MV: '&mut Vec<usize>', STR: '&str', RP: '&P', MP: '&mut P',
};
const VALUE = ['I', 'S', 'V', 'VS'];
const isRef = (t) => ['RI', 'MI', 'RS', 'MS', 'RV', 'MV', 'STR'].includes(t);

/* ───────────── generator ───────────── */
function genProgram() {
  const lines = [];
  let vid = 0;
  const scopes = [[]];
  const vars = () => scopes.flat();
  const fresh = (pre) => pre + (vid++);
  const withT = (...ts) => vars().filter(v => ts.includes(v.ty));
  const anyVar = (...ts) => { const c = withT(...ts); return c.length ? pick(c) : null; };
  const ind = () => '    '.repeat(scopes.length);
  const emit = (s) => lines.push(ind() + s);
  const declare = (name, ty, mut) => { scopes[scopes.length - 1].push({ name, ty, mut }); };

  const litI = () => String(ri(5));
  function exprI() {
    const c = [];
    c.push([3, () => litI()]);
    const x = anyVar('I'); if (x) c.push([3, () => x.name]);
    const r = anyVar('RI', 'MI'); if (r) c.push([2, () => '*' + r.name]);
    const v = anyVar('V'); if (v) c.push([2, () => v.name + '.len()']);
    const rv = anyVar('RV', 'MV'); if (rv) c.push([1, () => rv.name + '.len()']);
    const s = anyVar('S'); if (s) c.push([1, () => s.name + '.len()']);
    if (v) c.push([1, () => v.name + '[0]']);
    c.push([1, () => 'id_i(' + litI() + ')']);
    return wpick(c)();
  }
  function exprS() {
    const c = [[3, () => 'String::from("' + pick(['a', 'b', 'hi']) + '")'], [1, () => 'String::new()'], [1, () => 'make_s()']];
    const s = anyVar('S'); if (s) { c.push([4, () => s.name]); c.push([2, () => s.name + '.clone()']); }
    const r = anyVar('RS', 'MS'); if (r) c.push([2, () => r.name + '.clone()']);
    const vs = anyVar('VS'); if (vs) c.push([1, () => vs.name + '[0].clone()']);
    return wpick(c)();
  }
  function exprV() {
    const c = [[3, () => 'vec![1, 2, 3]'], [1, () => 'Vec::new()']];
    const v = anyVar('V'); if (v) { c.push([3, () => v.name]); c.push([2, () => v.name + '.clone()']); }
    return wpick(c)();
  }
  function exprVS() { const c = [[2, () => 'vec![String::from("x")]'], [1, () => 'Vec::new()']]; const v = anyVar('VS'); if (v) { c.push([2, () => v.name]); c.push([1, () => v.name + '.clone()']); } return wpick(c)(); }

  // expressions of reference type
  function exprRef(ty) {
    const c = [];
    if (ty === 'RI') {
      const x = anyVar('I'); if (x) c.push([4, () => '&' + x.name]);
      const v = anyVar('V'); if (v) { c.push([3, () => '&' + v.name + '[0]']); c.push([2, () => 'get_first(&' + v.name + ')']); }
      const r = anyVar('RI'); if (r) c.push([3, () => r.name]);
      const m = anyVar('MI'); if (m) c.push([2, () => '&*' + m.name]);
      const rv = anyVar('RV', 'MV'); if (rv) c.push([2, () => '&' + rv.name + '[0]']);
    } else if (ty === 'MI') {
      const x = anyVar('I'); if (x) c.push([4, () => '&mut ' + x.name]);
      const v = anyVar('V'); if (v) c.push([3, () => '&mut ' + v.name + '[0]']);
      const m = anyVar('MI'); if (m) { c.push([2, () => '&mut *' + m.name]); c.push([2, () => m.name]); }
      const mv = anyVar('MV'); if (mv) c.push([2, () => '&mut ' + mv.name + '[0]']);
    } else if (ty === 'RS') {
      const s = anyVar('S'); if (s) c.push([4, () => '&' + s.name]);
      const a = anyVar('S'), b = anyVar('S'); if (a && b) c.push([2, () => 'pick(&' + a.name + ', &' + b.name + ')']);
      const vs = anyVar('VS'); if (vs) c.push([2, () => '&' + vs.name + '[0]']);
      const r = anyVar('RS'); if (r) c.push([3, () => r.name]);
      const m = anyVar('MS'); if (m) c.push([2, () => '&*' + m.name]);
    } else if (ty === 'MS') {
      const s = anyVar('S'); if (s) c.push([4, () => '&mut ' + s.name]);
      const vs = anyVar('VS'); if (vs) c.push([2, () => '&mut ' + vs.name + '[0]']);
      const m = anyVar('MS'); if (m) { c.push([2, () => '&mut *' + m.name]); c.push([2, () => m.name]); }
    } else if (ty === 'RV') {
      const v = anyVar('V'); if (v) c.push([4, () => '&' + v.name]);
      const r = anyVar('RV'); if (r) c.push([3, () => r.name]);
      const m = anyVar('MV'); if (m) c.push([2, () => '&*' + m.name]);
    } else if (ty === 'MV') {
      const v = anyVar('V'); if (v) c.push([4, () => '&mut ' + v.name]);
      const m = anyVar('MV'); if (m) { c.push([2, () => '&mut *' + m.name]); c.push([2, () => m.name]); }
    } else if (ty === 'STR') {
      c.push([2, () => '"lit"']);
      const s = anyVar('S'); if (s) c.push([3, () => s.name + '.as_str()']);
    }
    return c.length ? wpick(c)() : null;
  }
  const exprOf = (ty) => ({ I: exprI, S: exprS, V: exprV, VS: exprVS }[ty] || (() => exprRef(ty)))();

  function stmtLet() {
    const ty = wpick([[3, 'I'], [3, 'S'], [3, 'V'], [1, 'VS'], [4, 'RI'], [3, 'MI'], [4, 'RS'], [3, 'MS'], [3, 'RV'], [3, 'MV'], [1, 'STR']]);
    const e = exprOf(ty);
    if (!e) return false;
    const mut = chance(ty === 'I' || ty === 'S' || ty === 'V' || ty === 'VS' ? 0.65 : 0.2);
    const name = fresh(ty === 'I' ? 'x' : ty === 'S' ? 's' : ty === 'V' ? 'v' : ty === 'VS' ? 'w' : 'r');
    const needsAnno = (ty === 'V' || ty === 'VS') && e === 'Vec::new()';
    emit('let ' + (mut ? 'mut ' : '') + name + (needsAnno ? ': ' + T[ty] : '') + ' = ' + e + ';');
    declare(name, ty, mut);
    return true;
  }
  function stmtUse() {
    const c = [];
    const x = anyVar('I'), s = anyVar('S'), v = anyVar('V'), vs = anyVar('VS');
    const ri_ = anyVar('RI', 'MI'), rs = anyVar('RS', 'MS'), rstr = anyVar('STR');
    const ms = anyVar('MS'), mv = anyVar('MV'), mi = anyVar('MI'), rv = anyVar('RV'), rmv = anyVar('RV', 'MV');
    if (x) c.push([3, () => 'println!("{}", ' + x.name + ');']);
    if (s) c.push([3, () => 'println!("{}", ' + s.name + ');']);
    if (ri_) c.push([4, () => 'println!("{}", ' + ri_.name + ');']);
    if (rs) c.push([4, () => 'println!("{}", ' + rs.name + ');']);
    if (rstr) c.push([2, () => 'println!("{}", ' + rstr.name + ');']);
    if (v) c.push([2, () => 'println!("{:?}", ' + v.name + ');']);
    if (rmv) c.push([2, () => 'println!("{:?}", ' + rmv.name + ');']);
    if (s) { c.push([3, () => 'show_s(&' + s.name + ');']); c.push([3, () => 'edit_s(&mut ' + s.name + ');']); c.push([3, () => 'take_s(' + s.name + ');']); c.push([1, () => 'take_s(' + s.name + '.clone());']); c.push([3, () => s.name + '.push_str("x");']); c.push([1, () => 'drop(' + s.name + ');']); }
    if (v) { c.push([3, () => 'show_v(&' + v.name + ');']); c.push([3, () => 'edit_v(&mut ' + v.name + ');']); c.push([3, () => 'take_v(' + v.name + ');']); c.push([4, () => v.name + '.push(' + exprI() + ');']); c.push([2, () => v.name + '.push(' + v.name + '.len());']); c.push([1, () => v.name + '.clear();']); c.push([2, () => v.name + '[0] = ' + exprI() + ';']); }
    if (vs) { c.push([2, () => vs.name + '.push(String::new());']); c.push([1, () => vs.name + '.clear();']); }
    if (rs) c.push([3, () => 'show_s(' + rs.name + ');']);
    if (ms) { c.push([3, () => 'edit_s(' + ms.name + ');']); c.push([3, () => ms.name + '.push_str("y");']); c.push([2, () => '*' + ms.name + ' = ' + exprS() + ';']); }
    if (rv) c.push([2, () => 'show_v(' + rv.name + ');']);
    if (mv) { c.push([3, () => 'edit_v(' + mv.name + ');']); c.push([3, () => mv.name + '.push(' + exprI() + ');']); c.push([2, () => mv.name + '.push(' + mv.name + '.len());']); }
    if (mi) { c.push([3, () => '*' + mi.name + ' = ' + exprI() + ';']); c.push([2, () => '*' + mi.name + ' += 1;']); }
    if (x) { c.push([3, () => x.name + ' = ' + exprI() + ';']); c.push([1, () => x.name + ' += 1;']); }
    if (s) c.push([2, () => s.name + ' = ' + exprS() + ';']);
    if (v) c.push([1, () => v.name + ' = ' + exprV() + ';']);
    // refs re-pointed
    const r1 = anyVar('RI'), r1e = r1 && exprRef('RI'); if (r1 && r1e) c.push([2, () => r1.name + ' = ' + r1e + ';']);
    const r2 = anyVar('RS'), r2e = r2 && exprRef('RS'); if (r2 && r2e) c.push([2, () => r2.name + ' = ' + r2e + ';']);
    if (s) c.push([2, () => { const n = fresh('s'); declare(n, 'S', chance(0.5)); return 'let ' + (scopes[scopes.length - 1].slice(-1)[0].mut ? 'mut ' : '') + n + ' = ' + s.name + ';'; }]);
    if (v) c.push([1, () => { const n = fresh('x'); declare(n, 'I', false); return 'let ' + n + ' = ' + v.name + '.len();'; }]);
    if (!c.length) return false;
    const r = wpick(c)();
    emit(r);
    return true;
  }
  const structOn = PROFILE === 'struct' || PROFILE === 'all', scopeOn = PROFILE === 'scope' || PROFILE === 'all';
  function stmtStruct() {
    const p = anyVar('P'), rp = anyVar('RP', 'MP'), mp = anyVar('MP'), s = anyVar('S');
    const c = [];
    c.push([4, () => { const n = fresh('p'); const mut = chance(0.7); declare(n, 'P', mut); return 'let ' + (mut ? 'mut ' : '') + n + ' = P { a: ' + litI() + ', s: ' + exprS() + ' };'; }]);
    if (p) {
      c.push([3, () => p.name + '.a = ' + exprI() + ';']);
      c.push([3, () => 'println!("{}", ' + p.name + '.a);']);
      c.push([3, () => 'println!("{}", ' + p.name + '.s);']);
      c.push([3, () => { const n = fresh('r'); declare(n, 'RS', false); return 'let ' + n + ' = &' + p.name + '.s;'; }]);
      c.push([3, () => { const n = fresh('r'); declare(n, 'MI', false); return 'let ' + n + ' = &mut ' + p.name + '.a;'; }]);
      c.push([2, () => { const n = fresh('r'); declare(n, 'MS', false); return 'let ' + n + ' = &mut ' + p.name + '.s;'; }]);
      c.push([3, () => { const n = fresh('r'); declare(n, 'RS', false); return 'let ' + n + ' = ' + p.name + '.get();'; }]);
      c.push([3, () => p.name + '.set(' + exprI() + ');']);
      c.push([2, () => p.name + '.set(' + p.name + '.len());']);
      c.push([2, () => { const n = fresh('r'); declare(n, 'MS', false); return 'let ' + n + ' = ' + p.name + '.name_mut();'; }]);
      c.push([2, () => { const n = fresh('s'); declare(n, 'S', chance(0.5)); return 'let ' + (scopes[scopes.length - 1].slice(-1)[0].mut ? 'mut ' : '') + n + ' = ' + p.name + '.s;'; }]);
      c.push([2, () => { const n = fresh('s'); declare(n, 'S', chance(0.5)); return 'let ' + (scopes[scopes.length - 1].slice(-1)[0].mut ? 'mut ' : '') + n + ' = ' + p.name + '.into_s();'; }]);
      c.push([2, () => { const n = fresh('r'); declare(n, chance(0.5) ? 'RP' : 'MP', false); const t = scopes[scopes.length - 1].slice(-1)[0].ty; return 'let ' + n + ' = ' + (t === 'RP' ? '&' : '&mut ') + p.name + ';'; }]);
    }
    if (rp) { c.push([3, () => 'println!("{}", ' + rp.name + '.a);']); c.push([2, () => 'println!("{}", ' + rp.name + '.get());']); c.push([1, () => 'println!("{}", ' + rp.name + '.len());']); }
    if (mp) { c.push([3, () => mp.name + '.a = ' + exprI() + ';']); c.push([3, () => mp.name + '.set(' + exprI() + ');']); c.push([2, () => { const n = fresh('r'); declare(n, 'RS', false); return 'let ' + n + ' = &' + mp.name + '.s;'; }]); }
    const r = wpick(c)();
    emit(r);
    return true;
  }
  function stmtScope() {
    const kind = wpick([[3, 'inner'], [2, 'temp'], [1, 'innerv']]);
    if (kind === 'inner') {
      const ty = pick(['RS', 'RI', 'RV']);
      const rn = fresh('r'); const vn = fresh(ty === 'RS' ? 's' : ty === 'RI' ? 'x' : 'v');
      emit('let ' + (chance(0.5) ? 'mut ' : '') + rn + ': ' + T[ty] + ';');
      emit('{'); scopes.push([]);
      emit('    let ' + vn + ' = ' + (ty === 'RS' ? 'String::from("in")' : ty === 'RI' ? '7' : 'vec![1, 2]') + ';');
      emit('    ' + rn + ' = &' + vn + ';');
      scopes.pop(); emit('}');
      if (chance(0.7)) emit((ty === 'RV' ? 'println!("{:?}", ' : 'println!("{}", ') + rn + ');');
      declare(rn, ty, true);
      return true;
    }
    if (kind === 'temp') {
      const n = fresh('r');
      const form = pick(['let ' + n + ' = make_s().as_str();', 'let ' + n + ' = &make_s();', 'let ' + n + ': &String = &make_s();', 'let ' + n + ' = make_s().len();', 'show_s(&make_s());']);
      emit(form);
      if (form.startsWith('let ')) { if (form.includes('as_str')) declare(n, 'STR', false); else if (form.includes('&make_s()')) declare(n, 'RS', false); else if (form.includes('.len()')) declare(n, 'I', false); }
      return true;
    }
    return false;
  }
  function block(depth, n, loopCtx) {
    scopes.push([]);
    for (let i = 0; i < n; i++) stmt(depth, loopCtx);
    scopes.pop();
  }
  function stmt(depth, loopCtx) {
    const r = rnd();
    if (depth < 2 && r < 0.28) {
      const kind = wpick([[3, 'if'], [2, 'while'], [3, 'for'], [1, 'loop'], [1, 'block'], [1, 'ifelse']]);
      if (kind === 'if') { emit('if cond() {'); block(depth + 1, 1 + ri(3), loopCtx); emit('}'); return; }
      if (kind === 'ifelse') { emit('if cond() {'); block(depth + 1, 1 + ri(2), loopCtx); emit('} else {'); block(depth + 1, 1 + ri(2), loopCtx); emit('}'); return; }
      if (kind === 'while') { emit('while cond() {'); block(depth + 1, 1 + ri(3), true); emit('}'); return; }
      if (kind === 'loop') { emit('loop {'); block(depth + 1, 1 + ri(3), true); emit('    break;'); emit('}'); return; }
      if (kind === 'block') { emit('{'); block(depth + 1, 1 + ri(3), loopCtx); emit('}'); return; }
      if (kind === 'for') {
        const src = wpick([[3, 'V'], [2, 'MV'], [1, 'VS'], [1, 'range']]);
        let head;
        const v = src === 'V' ? anyVar('V') : src === 'VS' ? anyVar('VS') : null, mv = src === 'MV' ? anyVar('V') : null;
        const name = fresh('e');
        if (src === 'V' && v) { head = 'for ' + name + ' in &' + v.name + ' {'; scopes.push([{ name, ty: 'RI', mut: false }]); }
        else if (src === 'MV' && mv) { head = 'for ' + name + ' in &mut ' + mv.name + ' {'; scopes.push([{ name, ty: 'MI', mut: false }]); }
        else if (src === 'VS' && v) { head = 'for ' + name + ' in &' + v.name + ' {'; scopes.push([{ name, ty: 'RS', mut: false }]); }
        else { head = 'for ' + name + ' in 0..3 {'; scopes.push([{ name, ty: 'I', mut: false }]); }
        emit(head);
        block(depth + 1, 1 + ri(3), true);
        scopes.pop();
        emit('}');
        return;
      }
    }
    if (loopCtx && r > 0.93) { emit(chance(0.5) ? 'break;' : 'continue;'); return; }
    if (structOn && rnd() < 0.4) { stmtStruct(); return; }
    if (scopeOn && rnd() < 0.25) { if (stmtScope()) return; }
    if (rnd() < 0.42) { if (stmtLet()) return; }
    if (!stmtUse()) stmtLet();
  }
  const n = 4 + ri(8);
  for (let i = 0; i < n; i++) stmt(0, false);
  return lines;
}

/* ───────────── harness ───────────── */
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrfuzz_'));
const BATCH = 100;
let total = 0, bad = 0, badLabels = 0, shown = 0, parseFails = 0, rustcErrs = 0;
const codeCounts = {};

function rustcErrors(file) {
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json', '-A', 'warnings', '-o', path.join(tmp, 'x.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  for (const ln of r.stderr.split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const spans = d.spans || [];
    const sp = spans.find(s => s.is_primary) || spans[0];
    out.push({ code: (d.code && d.code.code) || '', line: sp ? sp.line_start : 0, msg: d.message, spans });
  }
  return out;
}

for (let b = 0; b * BATCH < N; b++) {
  const progs = [];
  const count = Math.min(BATCH, N - b * BATCH);
  const src = [PRELUDE.trimEnd()];
  const ranges = [];
  for (let i = 0; i < count; i++) {
    const body = genProgram();
    const startLine = src.join('\n').split('\n').length + 1;
    src.push('fn p' + i + '() {'); body.forEach(l => src.push(l)); src.push('}');
    ranges.push({ i, start: startLine, end: startLine + body.length + 1, body });
  }
  const text = src.join('\n') + '\n';
  const file = path.join(tmp, 'b' + b + '.rs');
  fs.writeFileSync(file, text);
  const real = rustcErrors(file);
  let mine;
  try { mine = MR.check(text); } catch (e) { console.log('ENGINE CRASH:', e.stack.split('\n').slice(0, 4).join(' | ')); fs.writeFileSync(path.join(os.tmpdir(), 'mr_crash.rs'), text); console.log('program saved to', path.join(os.tmpdir(), 'mr_crash.rs')); process.exit(2); }
  if (mine.parseError) { parseFails++; console.log('ENGINE PARSE ERROR', JSON.stringify(mine.parseError)); const ln = mine.parseError.line; console.log(text.split('\n').slice(Math.max(0, ln - 4), ln + 2).join('\n')); continue; }
  const rangeOf = (line) => ranges.find(r => line >= r.start && line <= r.end);
  const by = ranges.map(() => ({ real: [], mine: [] }));
  let stray = 0;
  real.forEach(e => { const r = rangeOf(e.line); if (!r) { stray++; if (stray <= 3) console.log('rustc error outside any program:', e.code, e.msg, 'line', e.line, text.split('\n')[e.line - 1]); return; } by[r.i].real.push(e); });
  mine.errors.forEach(e => { const r = rangeOf(e.line); if (!r) { console.log('engine error outside programs', e); return; } by[r.i].mine.push(e); });
  if (stray) rustcErrs += stray;
  ranges.forEach(r => {
    total++;
    const a = new Set(by[r.i].real.map(e => e.code + '@' + (e.line - r.start))), c = new Set(by[r.i].mine.map(e => e.code + '@' + (e.line - r.start)));
    by[r.i].real.forEach(e => { codeCounts[e.code] = (codeCounts[e.code] || 0) + 1; });
    const same = a.size === c.size && [...a].every(k => c.has(k));
    if (!same) {
      bad++;
      if (shown < SHOW) {
        shown++;
        console.log('\n──── MISMATCH (program p' + r.i + ', batch ' + b + ') ────');
        console.log('fn p' + r.i + '() {'); r.body.forEach((l, k) => console.log(String(k + 1).padStart(3) + '  ' + l)); console.log('}');
        console.log('rustc: ' + [...a].sort().join(' ')); by[r.i].real.forEach(e => console.log('   ', e.code, '@' + (e.line - r.start), e.msg));
        console.log('mine : ' + [...c].sort().join(' ')); by[r.i].mine.forEach(e => console.log('   ', e.code, '@' + (e.line - r.start), e.msg));
      }
    }
  });
}
console.log('\n' + (total - bad) + '/' + total + ' programs agree (' + bad + ' mismatches); rustc codes seen: ' + JSON.stringify(codeCounts) + (rustcErrs ? '  [rustc errors outside programs: ' + rustcErrs + ']' : ''));
process.exit(bad || parseFails ? 1 : 0);
