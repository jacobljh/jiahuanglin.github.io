#!/usr/bin/env node
/* Differential test: all_lessons/rust/lessons/captures.js  vs  the real rustc (Lesson 14's widget).
 *
 *   node tools/rust_verify/14_captures.js [randomCases=400] [seed=1]
 *
 * Cases:
 *   (a) EVERY closure the widget can build: each choice of use per variable (count, report, picked:
 *       none/read/mutate/move-out; ages: none/read/move-out) x move on/off x every prefix of the body
 *       (the slider), de-duplicated;
 *   (b) randomCases random bodies of 0-8 lines in arbitrary order (a non-Copy variable is never used
 *       again after the line that moves it out), each with move on and off.
 * For every case it compiles, with rustc --edition 2024:
 *   1. trait probes   need_fn(f) / need_fnmut(f) / need_fnonce(f)           -> E0525 or ok
 *   2. action probes  read / mutate / move one variable while f is alive, then f()  -> error codes or ok
 *   3. spawn probe    std::thread::spawn(f)                                   -> {E0373 name, E0597 name} or ok
 *   4. size           a binary printing std::mem::size_of_val(&f)            -> bytes
 * and compares each verdict with Captures.analyze. Prints every mismatch; exit 1 if any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const CAP = require('../../all_lessons/rust/lessons/captures.js');

const NRAND = +(process.argv[2] || 400), SEED = +(process.argv[3] || 1);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');

/* ---------------- cases ---------------- */
const cases = [], seen = new Set();
function add(lines, move, origin) {
  const key = (move ? 'M|' : 'B|') + lines.map(l => l.v + '.' + l.op).join(',');
  if (seen.has(key)) return;
  seen.add(key);
  cases.push({ lines, move, origin });
}
const CHOICES = { count: ['none', 'read', 'mutate', 'move'], report: ['none', 'read', 'mutate', 'move'],
                  ages: ['none', 'read', 'move'], picked: ['none', 'read', 'mutate', 'move'] };
for (const c of CHOICES.count) for (const r of CHOICES.report) for (const a of CHOICES.ages) for (const p of CHOICES.picked)
  for (const move of [false, true]) {
    const full = CAP.body({ count: c, report: r, ages: a, picked: p });
    for (let k = 0; k <= full.length; k++) add(full.slice(0, k), move, 'widget');
  }
const nWidget = cases.length;
let made = 0, guard = 0;
while (made < NRAND && guard++ < NRAND * 50) {
  const n = Math.floor(rnd() * 9), lines = [], dead = new Set();
  while (lines.length < n) {
    const v = pick(CAP.VARS), op = pick(CAP.OPS[v.name]);
    if (dead.has(v.name)) continue;
    lines.push({ v: v.name, op });
    if (op === 'move' && !v.copy) dead.add(v.name);
  }
  const before = cases.length;
  add(lines, false, 'random'); add(lines, true, 'random');
  if (cases.length > before) made++;
}

/* ---------------- Rust generation ---------------- */
const HEADER = [
  '#![allow(warnings)]',
  'fn consume<T>(_x: T) {}',
  'fn need_fn<F: Fn()>(_f: F) {}',
  'fn need_fnmut<F: FnMut()>(_f: F) {}',
  'fn need_fnonce<F: FnOnce()>(_f: F) {}',
];
const SETUP = CAP.VARS.map(v => v.decl).join(' ')
  .replace('let ages', 'let data = vec![1, 2, 3]; let ages')
  .replace('let picked', 'let mut chosen: Vec<i32> = Vec::new(); let picked');
function closure(c) { return (c.move ? 'move ' : '') + '|| { ' + c.lines.map(l => CAP.LINE[l.v][l.op]).join(' ') + ' }'; }

function compile(name, src, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap14_'));
  const file = path.join(dir, name + '.rs');
  fs.writeFileSync(file, src);
  const args = ['--edition', '2024', '--error-format=json', '--crate-name', name];
  if (run) args.push('-o', path.join(dir, name), file);
  else args.push('--crate-type', 'lib', '--emit=metadata', '-o', path.join(dir, name + '.rmeta'), file);
  const r = cp.spawnSync(rustc, args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  const errs = [];
  for (const ln of (r.stderr || '').split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
    errs.push({ code: d.code && d.code.code, msg: d.message, line: sp ? sp.line_start : -1 });
  }
  let stdout = null;
  if (run && r.status === 0) stdout = cp.spawnSync(path.join(dir, name), { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  if (!process.env.CAP14_KEEP) fs.rmSync(dir, { recursive: true, force: true });
  return { errs, stdout, status: r.status };
}

let mismatches = 0, genBugs = 0, checks = 0;
const tally = { trait: 0, action: 0, spawn: 0, size: 0 };
function fail(kind, c, detail) {
  mismatches++;
  if (mismatches <= 40) console.log(`  MISMATCH [${kind}] ${c.move ? 'move ' : ''}|| { ${c.lines.map(l => CAP.LINE[l.v][l.op]).join(' ')} }\n            ${detail}`);
}

const CHUNK = 300;
for (let start = 0; start < cases.length; start += CHUNK) {
  const chunk = cases.slice(start, start + CHUNK);
  const res = chunk.map(c => CAP.analyze({ lines: c.lines, move: c.move }));

  // 1. trait probes
  { const lines = HEADER.slice(), at = {};
    chunk.forEach((c, i) => ['fn', 'fnmut', 'fnonce'].forEach(k => {
      lines.push(`fn t${i}_${k}() { ${SETUP} let f = ${closure(c)}; need_${k}(f); }`); at[lines.length] = [i, k]; }));
    const out = compile('traits' + start, lines.join('\n') + '\n', false), bad = {};
    for (const e of out.errs) { const w = at[e.line]; if (!w || e.code !== 'E0525') { genBugs++; console.log(`  [generator?] trait file: ${e.code} ${e.msg} @${e.line}`); continue; } bad[w.join('.')] = true; }
    chunk.forEach((c, i) => ['fn', 'fnmut', 'fnonce'].forEach(k => {
      const real = !bad[i + '.' + k], mine = res[i].implements[{ fn: 'Fn', fnmut: 'FnMut', fnonce: 'FnOnce' }[k]];
      checks++; tally.trait++;
      if (real !== mine) fail('trait', c, `${k}: rustc ${real ? 'accepts' : 'E0525'}, engine ${mine ? 'accepts' : 'rejects'} (engine says ${res[i].trait})`);
    })); }

  // 2. action probes
  { const lines = HEADER.slice(), at = {}, probes = [];
    chunk.forEach((c, i) => CAP.VARS.forEach(v => CAP.OPS[v.name].forEach(a => {
      lines.push(`fn a${i}_${v.name}_${a}() { ${SETUP} let mut f = ${closure(c)}; ${CAP.ACT[v.name][a]} f(); }`);
      at[lines.length] = probes.length; probes.push({ i, v: v.name, a, codes: [] }); })));
    const out = compile('actions' + start, lines.join('\n') + '\n', false);
    for (const e of out.errs) { const p = probes[at[e.line]]; if (!p) { genBugs++; console.log(`  [generator?] action file: ${e.code} ${e.msg} @${e.line}`); continue; } p.codes.push(e.code || '_'); }
    for (const p of probes) {
      const real = p.codes.length ? [...new Set(p.codes)].sort().join(',') : 'ok', mine = res[p.i].vars[p.v].actions[p.a];
      checks++; tally.action++;
      if (real !== mine) fail('action', chunk[p.i], `then ${p.a} ${p.v}: rustc ${real}, engine ${mine} (engine mode ${res[p.i].vars[p.v].mode})`);
    } }

  // 3. spawn probes
  { const lines = HEADER.slice(), at = {}, got = chunk.map(() => []);
    chunk.forEach((c, i) => { lines.push(`fn s${i}() { ${SETUP} let f = ${closure(c)}; std::thread::spawn(f); }`); at[lines.length] = i; });
    const out = compile('spawn' + start, lines.join('\n') + '\n', false);
    for (const e of out.errs) {
      const i = at[e.line], m = /`([A-Za-z_]+)`/.exec(e.msg);
      if (i === undefined || !m || (e.code !== 'E0373' && e.code !== 'E0597')) { genBugs++; console.log(`  [generator?] spawn file: ${e.code} ${e.msg} @${e.line}`); continue; }
      got[i].push(e.code + ' ' + m[1]);
    }
    chunk.forEach((c, i) => {
      const real = got[i].slice().sort().join('; ') || 'ok';
      const mine = res[i].spawn.errors.map(e => e.code + ' ' + e.name).sort().join('; ') || 'ok';
      checks++; tally.spawn++;
      if (real !== mine) fail('spawn', c, `thread::spawn(f): rustc ${real}, engine ${mine}`);
    }); }

  // 4. sizes (compiled and run)
  { const body = chunk.map((c, i) => `    { ${SETUP} let f = ${closure(c)}; println!("${i} {}", std::mem::size_of_val(&f)); }`);
    const src = HEADER.join('\n') + '\nfn main() {\n' + body.join('\n') + '\n}\n';
    const out = compile('sizes' + start, src, true);
    if (out.stdout === null) { genBugs++; console.log('  [generator?] size program did not build: ' + out.errs.slice(0, 3).map(e => e.code + ' ' + e.msg).join(' | ')); }
    else {
      const real = {};
      out.stdout.trim().split('\n').forEach(l => { const [i, s] = l.split(' '); real[+i] = +s; });
      chunk.forEach((c, i) => { checks++; tally.size++; if (real[i] !== res[i].size) fail('size', c, `size_of_val: rustc ${real[i]}, engine ${res[i].size}`); });
    } }
}

console.log(`${cases.length} closures (${nWidget} = every widget configuration, ${cases.length - nWidget} random), ` +
            `${checks} verdicts (${tally.trait} trait, ${tally.action} action, ${tally.spawn} spawn, ${tally.size} size): ` +
            `${mismatches} mismatches, ${genBugs} generator problems`);
process.exit(mismatches || genBugs ? 1 : 0);
