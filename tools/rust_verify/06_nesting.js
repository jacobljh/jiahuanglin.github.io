#!/usr/bin/env node
/* Oracle for Lesson 06 ("Lifetimes — a borrow is a region"): does the lesson's rule predict rustc?
 *
 *   node tools/rust_verify/06_nesting.js [programs=450] [seed=6]
 *
 * The rule: a borrow is valid iff its REGION (the program points where it may still be used) lies inside its OWNER'S EXTENT
 * (a block-local lives to its closing brace, a function's local to the return, a temporary to the end of its statement).
 * MiniRust.nesting() computes exactly that, per borrow, from the regions the checker infers. For random programs in three
 * families — nested blocks (E0597), functions that return borrows (E0515), temporaries (E0716) — the test compiles each
 * one with the real rustc and demands, per program:
 *   (1) "every borrow fits inside its owner" == "rustc reports none of E0597 / E0515 / E0716"          (the rule itself)
 *   (2) the set of (error code, line) from MiniRust equals rustc's                                      (the checker behind it)
 *   (3) the block-shaped model (region = until the holder's scope ends) never accepts what rustc rejects, and the programs
 *       where it rejects what rustc accepts are counted — they are the lesson's bridge to non-lexical lifetimes.
 * The widget's own presets (read from 06_lifetimes_regions.html when it exists) are run through the same three checks.
 * Exit status 1 on any mismatch of (1) or (2) or a violation of (3).
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const LESSONS = path.join(__dirname, '../../all_lessons/rust/lessons');
const MR = require(process.env.MR || path.join(LESSONS, 'minirust.js'));
const N = +(process.argv[2] || 450), SEED = +(process.argv[3] || 6);
const rustc = process.env.RUSTC || 'rustc';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nesting-'));

let seed = SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)], chance = (p) => rnd() < p;

const PRELUDE = `#![allow(unused)]
fn cond() -> bool { false }
fn make_s() -> String { String::new() }
fn id_s(s: &String) -> &String { s }
`;

/* family A: nested blocks. One reference `r`, owners declared at several depths, assignments and uses in between. */
function genBlocks() {
  const out = [], owners = [[]];
  let uid = 0, assigned = false;
  const emit = (depth, s) => out.push('    '.repeat(depth) + s);
  emit(1, 'let r;');
  if (chance(0.6)) { emit(1, 'let o = String::new();'); owners[0].push('o'); }
  function block(depth, limit) {
    const n = 1 + ri(4);
    for (let i = 0; i < n; i++) {
      const c = ri(11), vis = owners.flat();
      if (c < 3) { const nm = 'v' + uid++; emit(depth, 'let ' + nm + ' = String::new();'); owners[owners.length - 1].push(nm); }
      else if (c < 6 && vis.length) { emit(depth, 'r = &' + pick(vis) + ';'); assigned = true; }
      else if (c < 8 && assigned) emit(depth, 'println!("{}", r);');
      else if (c < 10 && depth < limit) { emit(depth, '{'); owners.push([]); block(depth + 1, limit); owners.pop(); emit(depth, '}'); }
    }
  }
  block(1, 3);
  if (assigned && chance(0.6)) emit(1, 'println!("{}", r);');
  return out;
}

/* family B: a function with one reference parameter that returns a borrow of a local, of the parameter, or of either */
function genReturns(name) {
  const body = [];
  const loc = [];
  body.push('    let a = p.clone();'); loc.push('&a');
  if (chance(0.5)) { body.push('    let b = String::new();'); loc.push('&b'); }
  let t = null;
  if (chance(0.4)) { t = pick(['&a', 'p']); body.push('    let t = ' + t + ';'); }
  const pool = [...loc, 'p', ...(t ? ['t'] : [])];
  const form = ri(4);
  if (form === 0) body.push('    ' + pick(pool));
  else if (form === 1) body.push('    if cond() { ' + pick(pool) + ' } else { ' + pick(pool) + ' }');
  else if (form === 2) { body.push('    if cond() {'); body.push('        return ' + pick(pool) + ';'); body.push('    }'); body.push('    ' + pick(pool)); }
  else body.push('    let q = ' + pick(pool) + ';', '    q');
  return ['fn ' + name + '(p: &String) -> &String {', ...body, '}'];
}

/* family C: temporaries, extended or not */
function genTemps() {
  const out = [];
  const n = 1 + ri(3);
  for (let i = 0; i < n; i++) {
    const r = 'r' + i;
    const form = pick(['let R = make_s().as_str();', 'let R = &make_s();', 'let R: &String = &make_s();', 'let R = id_s(&make_s());', 'let R = &id_s(&make_s()).clone();', 'let R = make_s().len();', 'let R = &make_s().clone();']);
    out.push('    ' + form.replace('R', r));
    if (!form.includes('.len()') && chance(0.85)) out.push('    println!("{}", ' + r + ');');
  }
  return out;
}

const programs = [];
for (let i = 0; i < N; i++) {
  const fam = i % 3;
  if (fam === 0) programs.push({ fam: 'blocks', items: ['fn p' + i + '() {', ...genBlocks(), '}'] });
  else if (fam === 1) programs.push({ fam: 'returns', items: genReturns('p' + i) });
  else programs.push({ fam: 'temps', items: ['fn p' + i + '() {', ...genTemps(), '}'] });
}
// the widget's presets, when the lesson exists
try {
  const html = fs.readFileSync(path.join(LESSONS, '06_lifetimes_regions.html'), 'utf8');
  const m = html.match(/var PRE = (\[[\s\S]*?\n  \]);/);
  if (m) {
    const PRE = eval(m[1]);
    PRE.forEach((p, i) => {
      const src = Array.isArray(p) ? p[1] : p, items = [];
      let skipping = false;   // a preset may define its own cond/make_s/id_s (one line or several): the prelude already has them
      for (const l0 of src.replace(/\s+$/, '').split('\n')) {
        const l = l0.replace(/^fn main\(\)/, 'fn preset' + i + '()');
        if (skipping) { if (/^}/.test(l)) skipping = false; continue; }
        if (/^fn (cond|make_s|id_s)\(/.test(l)) { if (!/}\s*$/.test(l)) skipping = true; continue; }
        items.push(l);
      }
      programs.push({ fam: 'preset' + i, items, preset: true });
    });
  }
} catch (e) { /* lesson not written yet */ }

function rustcErrors(file) {
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json', '-A', 'warnings', '-o', path.join(tmp, 'x.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  for (const ln of r.stderr.split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
    out.push({ code: (d.code && d.code.code) || '', line: sp ? sp.line_start : 0, msg: d.message });
  }
  return out;
}

const LIFETIME = /^E0(597|515|716)$/;
const BATCH = 150;
let total = 0, rule = 0, ruleBad = 0, errBad = 0, lexBad = 0, lexStricter = 0, shown = 0;
const byFam = {};
for (let b = 0; b * BATCH < programs.length; b++) {
  const chunk = programs.slice(b * BATCH, (b + 1) * BATCH);
  const src = PRELUDE.trimEnd().split('\n'), ranges = [];
  chunk.forEach((p) => {
    const start = src.length + 1;
    p.items.forEach(l => src.push(l));
    ranges.push({ p, start, end: src.length });
  });
  const text = src.join('\n') + '\n', file = path.join(tmp, 'b' + b + '.rs');
  fs.writeFileSync(file, text);
  const real = rustcErrors(file), nest = MR.nesting(text);
  if (nest.parseError) { console.log('ENGINE PARSE ERROR', JSON.stringify(nest.parseError), '\n' + text.split('\n').slice(Math.max(0, nest.parseError.line - 4), nest.parseError.line + 2).join('\n')); process.exit(2); }
  const rangeOf = (line) => ranges.find(r => line >= r.start && line <= r.end);
  const by = ranges.map(() => ({ real: [], mine: [], lex: [] }));
  real.forEach(e => { const r = rangeOf(e.line); if (r) by[ranges.indexOf(r)].real.push(e); });
  nest.errors.forEach(e => { const r = rangeOf(e.line); if (r) by[ranges.indexOf(r)].mine.push(e); });
  nest.lexErrors.forEach(e => { const r = rangeOf(e.line); if (r) by[ranges.indexOf(r)].lex.push(e); });
  // which programs' borrows do not fit: a loan belongs to the program whose lines contain its creation line
  const unfit = ranges.map(() => false);
  nest.fns.forEach(f => f.loans.forEach(l => { if (!l.fits) { const r = rangeOf(l.line); if (r) unfit[ranges.indexOf(r)] = true; } }));
  ranges.forEach((r, i) => {
    total++;
    const fam = r.p.fam.replace(/\d+$/, '') + (r.p.preset ? 's' : '');
    const s = byFam[fam] = byFam[fam] || { n: 0, rejected: 0, lexOnly: 0 };
    s.n++;
    const rust = by[i].real, key = (e) => e.code + '@' + (e.line - r.start);
    const a = new Set(rust.map(key)), c = new Set(by[i].mine.map(key)), x = new Set(by[i].lex.map(key));
    const lifetimeErr = rust.some(e => LIFETIME.test(e.code));
    if (a.size) s.rejected++;
    let why = [];
    rule++;
    if (unfit[i] === !lifetimeErr) { ruleBad++; why.push('rule: borrows ' + (unfit[i] ? 'do not fit' : 'all fit') + ' but rustc ' + (lifetimeErr ? 'reports a lifetime error' : 'reports none')); }
    if (!(a.size === c.size && [...a].every(k => c.has(k)))) { errBad++; why.push('errors differ'); }
    if (a.size && !x.size) { lexBad++; why.push('block-shaped model accepted a program rustc rejects'); }
    if (!a.size && x.size) { lexStricter++; s.lexOnly++; }
    if (why.length && shown++ < 6) {
      console.log('\n──── MISMATCH (' + why.join('; ') + ') [' + r.p.fam + '] ────');
      r.p.items.forEach((l, k) => console.log(String(k + 1).padStart(3) + '  ' + l));
      console.log('rustc : ' + [...a].sort().join(' ')); console.log('mine  : ' + [...c].sort().join(' ')); console.log('block : ' + [...x].sort().join(' '));
    }
  });
}
console.log('\n' + total + ' programs (' + Object.keys(byFam).map(f => f + ' ' + byFam[f].n).join(', ') + ')');
console.log('(1) rule "every borrow fits inside its owner" == "rustc reports no E0597/E0515/E0716":   ' + (rule - ruleBad) + '/' + rule + ' agree (' + ruleBad + ' mismatches)');
console.log('(2) MiniRust (code, line) set == rustc:                                                 ' + (total - errBad) + '/' + total + ' agree (' + errBad + ' mismatches)');
console.log('(3) block-shaped model accepted a program rustc rejects: ' + lexBad + ' times;  rejected a program rustc accepts: ' + lexStricter + ' times');
console.log('    per family (programs, rejected by rustc, rejected only by the block-shaped model): ' + Object.keys(byFam).map(f => f + ' ' + byFam[f].n + '/' + byFam[f].rejected + '/' + byFam[f].lexOnly).join(', '));
process.exit(ruleBad || errBad || lexBad ? 1 : 0);
