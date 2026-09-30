#!/usr/bin/env node
/* Differential test: the collector in all_lessons/rust/lessons/monomorph.js  vs  the real rustc.
 *
 *   node tools/rust_verify/12_mono.js [programs=320] [seed=1]
 *
 * Generates random programs: 2–5 generic functions with 1–3 type parameters. A body calls later
 * functions ("forward" calls) with type arguments built from its own parameters (Vec, Option, Box,
 * tuples, concrete leaves), and sometimes calls itself or an earlier function ("back" calls) with its
 * parameters permuted or replaced by concrete types — or with one of them wrapped in Vec/Option, which
 * may make the set of copies infinite. main calls some functions with concrete types. The top line of
 * every generic body prints its own copy with std::any::type_name.
 *
 * Restriction (so the copies that RUN are exactly the copies rustc STAMPS OUT): every call executes.
 * Forward calls are unconditional; back calls run under `if n > 0` with n - 1; and main passes an n
 * equal to the largest number of back calls on the cheapest path from main to any copy, computed from
 * the collector's own request graph (a program whose run would exceed 200,000 calls is regenerated).
 * Then the collector must predict either (a) exactly the set of copies the program prints, or (b) that
 * rustc rejects it with "reached the recursion limit while instantiating". Exit status 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const Mono = require('../../all_lessons/rust/lessons/monomorph.js');

const N = +(process.argv[2] || 320), SEED = +(process.argv[3] || 1);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const LEAF = ['i32', 'u8', 'f64', 'bool', 'char', 'String', '&str', '()'];
const WRAP = ['Vec', 'Option', 'Box'];
// `pool` holds the caller's parameters not yet used in this call: each is used at most once per call,
// so a cycle can grow a type by a constant amount per turn but never double it.
function genT(depth, pool) {
  const r = rnd();
  if (depth <= 0 || r < 0.45) return pool.length && rnd() < 0.7 ? pool.splice(Math.floor(rnd() * pool.length), 1)[0] : pick(LEAF);
  if (r < 0.8) return pick(WRAP) + '<' + genT(depth - 1, pool) + '>';
  return '(' + genT(depth - 1, pool) + ', ' + genT(depth - 1, pool) + ')';
}

function genProgram() {
  const nf = int(2, 5), fns = [];
  for (let i = 0; i < nf; i++) fns.push({ name: 'f' + i, params: ['A', 'B', 'C'].slice(0, int(1, 3)), calls: [] });
  fns.forEach((f, i) => {
    const nfw = i < nf - 1 ? int(0, 2) : 0;
    for (let c = 0; c < nfw; c++) {
      const g = fns[int(i + 1, nf - 1)], pool = f.params.slice();
      f.calls.push({ fn: g.name, args: g.params.map(() => genT(2, pool)), back: false });
    }
    if (rnd() < 0.35) {                                   // a back call: to itself or an earlier function
      const g = fns[int(0, i)], pool = f.params.slice();
      const args = g.params.map(() => (pool.length && rnd() < 0.8 ? pool.splice(Math.floor(rnd() * pool.length), 1)[0] : pick(LEAF)));
      if (rnd() < 0.5) { const j = int(0, args.length - 1); args[j] = pick(['Vec', 'Option']) + '<' + args[j] + '>'; }
      f.calls.splice(int(0, f.calls.length), 0, { fn: g.name, args, back: true });
    }
  });
  const main = [];
  for (let c = 0, nm = int(1, 3); c < nm; c++) {
    const g = rnd() < 0.6 ? fns[0] : pick(fns);
    main.push({ fn: g.name, args: g.params.map(() => genT(2, [])) });
  }
  return { fns, main };
}

function toProg(p) {
  const fns = {};
  p.fns.forEach((f) => { fns[f.name] = { params: f.params, calls: f.calls.map((c) => ({ fn: c.fn, args: c.args, back: c.back })) }; });
  return { fns, main: p.main };
}

// cheapest number of back calls from main to each copy (0-1 BFS over the collector's request graph)
function backDistances(res) {
  const out = {}, dist = { main: 0 }, dq = ['main'];
  res.requests.forEach((r) => { (out[r.from] = out[r.from] || []).push(r); });
  while (dq.length) {
    const u = dq.shift();
    (out[u] || []).forEach((r) => {
      const d = dist[u] + (r.back ? 1 : 0);
      if (dist[r.to] === undefined || d < dist[r.to]) { dist[r.to] = d; if (r.back) dq.push(r.to); else dq.unshift(r.to); }
    });
  }
  return { dist, out };
}
function runtimeCalls(res, n0, out) {
  const memo = new Map();
  function calls(key, n) {
    const mk = key + '#' + n;
    if (memo.has(mk)) return memo.get(mk);
    memo.set(mk, Infinity);                               // guards a cycle with no back call (cannot happen)
    let c = 1;
    for (const r of out[key] || []) { if (r.back) { if (n > 0) c += calls(r.to, n - 1); } else c += calls(r.to, n); if (c > 1e7) break; }
    memo.set(mk, c);
    return c;
  }
  return res.main.reduce((s, m) => s + calls(m.fn + '::<' + m.args.map((a) => Mono.show(Mono.parse(a))).join(', ') + '>', n0), 0);
}

function rustSource(p, n0, mod) {
  const L = [];
  p.fns.forEach((f) => {
    L.push(`    pub fn ${f.name}<${f.params.join(', ')}>(n: u32) {`);
    L.push(`        println!("@${f.name}|${f.params.map(() => '{}').join('|')}", ${f.params.map((q) => `type_name::<${q}>()`).join(', ')});`);
    f.calls.forEach((c) => {
      const call = `${c.fn}::<${c.args.join(', ')}>`;
      L.push(c.back ? `        if n > 0 { ${call}(n - 1); }` : `        ${call}(n);`);
    });
    L.push('    }');
  });
  L.push('    pub fn run() {');
  p.main.forEach((m) => L.push(`        ${m.fn}::<${m.args.join(', ')}>(${n0});`));
  L.push('    }');
  return `mod ${mod} {\n    #![allow(unused)]\n    use std::any::type_name;\n${L.join('\n')}\n}\n`;
}
const norm = (s) => s.replace(/\b[a-z_][a-z0-9_]*::/g, '');

const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mono12_'));
const okCases = [], errCases = [];
let regenerated = 0;
while (okCases.length + errCases.length < N) {
  const p = genProgram(), prog = toProg(p);
  const res = Mono.collect(prog);
  if (res.error) { errCases.push({ p, res }); continue; }
  const { dist, out } = backDistances(res);
  const n0 = Math.max(0, ...res.instances.map((i) => dist[i.key]));
  if (runtimeCalls(res, n0, out) > 200000) { regenerated++; continue; }
  okCases.push({ p, res, n0 });
}

let bad = 0, compared = 0;
// (a) finite programs: all in one binary, one module each; compare the printed copies per module
{
  const src = ['#![allow(unused)]'];
  okCases.forEach((c, i) => src.push(rustSource(c.p, c.n0, 'p' + i)));
  src.push('fn main() {');
  okCases.forEach((c, i) => src.push(`    println!("#${i}"); p${i}::run();`));
  src.push('}');
  const file = path.join(tmp, 'ok.rs'), exe = path.join(tmp, 'ok');
  fs.writeFileSync(file, src.join('\n') + '\n');
  const r = cp.spawnSync(rustc, ['--edition', '2024', '-C', 'opt-level=0', '-o', exe, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {        // find the culprits: a program the collector called finite that rustc rejects
    okCases.forEach((c, i) => {
      const f1 = path.join(tmp, 'one' + i + '.rs');
      fs.writeFileSync(f1, '#![allow(unused)]\n' + rustSource(c.p, c.n0, 'p') + 'fn main() { p::run(); }\n');
      const r1 = cp.spawnSync(rustc, ['--edition', '2024', '-o', path.join(tmp, 'one' + i), f1], { encoding: 'utf8', maxBuffer: 1 << 26 });
      if (r1.status !== 0) { bad++; console.log(`MISMATCH program ${i}: collector says ${c.res.instances.length} copies, rustc rejects: ${(r1.stderr || '').split('\n')[0]}`); }
    });
    console.log(`the finite programs did not compile together; ${bad} mismatches`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  }
  const run = cp.spawnSync(exe, [], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const seen = okCases.map(() => new Set());
  let cur = -1;
  for (const ln of run.stdout.split('\n')) {
    if (ln[0] === '#') cur = +ln.slice(1);
    else if (ln[0] === '@') { const parts = ln.slice(1).split('|'); seen[cur].add(parts[0] + '::<' + parts.slice(1).map(norm).join(', ') + '>'); }
  }
  okCases.forEach((c, i) => {
    const mine = new Set(c.res.instances.map((x) => x.key));
    compared += mine.size;
    const miss = [...seen[i]].filter((k) => !mine.has(k)), extra = [...mine].filter((k) => !seen[i].has(k));
    if (mine.size !== c.res.instances.length) { bad++; console.log(`MISMATCH program ${i}: the collector stamped a copy out twice`); }
    if (miss.length || extra.length) {
      bad++;
      console.log(`MISMATCH program ${i}: rustc ran ${seen[i].size} copies, collector predicted ${mine.size}`);
      if (miss.length) console.log('   only rustc:     ' + miss.join('  '));
      if (extra.length) console.log('   only collector: ' + extra.join('  '));
      console.log(rustSource(c.p, c.n0, 'p' + i));
    }
  });
}
// (b) programs the collector says never finish: each must be rejected with the recursion-limit error
errCases.forEach((c, i) => {
  const file = path.join(tmp, 'e' + i + '.rs');
  fs.writeFileSync(file, '#![allow(unused)]\n' + rustSource(c.p, 3, 'p') + 'fn main() { p::run(); }\n');
  const r = cp.spawnSync(rustc, ['--edition', '2024', '-C', 'opt-level=0', '-o', path.join(tmp, 'e' + i), file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const errs = (r.stderr || '').split('\n').filter((l) => /^error/.test(l) && !/aborting due to/.test(l));
  const ok = r.status !== 0 && errs.length === 1 && /reached the recursion limit while instantiating/.test(errs[0]);
  if (!ok) { bad++; console.log(`MISMATCH infinite program ${i}: collector says recursion limit at ${Mono.shortKey(c.res.error.at)}; rustc status ${r.status}: ${errs.join(' / ') || '(no error)'}`); console.log(rustSource(c.p, 3, 'p')); }
});
const withCycles = okCases.filter((c) => c.p.fns.some((f) => f.calls.some((x) => x.back))).length;
console.log(`${okCases.length} finite programs (${withCycles} with back calls; ${compared} copies compared against what ran), ` +
            `${errCases.length} infinite programs (each must hit rustc's recursion limit), ${regenerated} regenerated for run time`);

// (c) the widget's own presets, as the real Rust the lesson shows (bodies with values), k = 1..6
const VAL = { 'i32': '3', 'f64': '2.5', 'char': "'q'", 'String': 'String::from("ada")', 'u8': '7u8', '&str': '"net"' };
const PRESET_FNS = `    use std::any::type_name;
    use std::fmt::Debug;
    pub fn largest<T: PartialOrd>(items: &[T]) -> &T {
        println!("@largest|{}", type_name::<T>());
        let mut best = &items[0];
        for x in items { if x > best { best = x; } }
        best
    }
    pub fn show<T: Debug>(x: &T) -> String { println!("@show|{}", type_name::<T>()); format!("{x:?}") }
    pub fn summary<T: PartialOrd + Debug>(items: &[T]) -> String {
        println!("@summary|{}", type_name::<T>());
        format!("max = {}", show(largest(items)))
    }
    pub fn pair<A: Debug, B: Debug>(a: &A, b: &B) -> String {
        println!("@pair|{}|{}", type_name::<A>(), type_name::<B>());
        format!("({}, {})", show(a), show(b))
    }
    pub fn wrap<T: Clone>(x: &T) -> Vec<T> { println!("@wrap|{}", type_name::<T>()); vec![x.clone(), x.clone()] }
    pub fn nested<T: Clone + Debug>(x: &T) -> String { println!("@nested|{}", type_name::<T>()); show(&wrap(&wrap(x))) }
    pub fn count<T>(items: &[T]) -> usize {
        println!("@count|{}", type_name::<T>());
        if items.is_empty() { 0 } else { 1 + count(&items[1..]) }
    }
    pub fn nest<T: Debug>(x: T, depth: u32) -> String {
        println!("@nest|{}", type_name::<T>());
        if depth == 0 { return format!("{x:?}"); }
        nest(vec![x], depth - 1)
    }
`;
const CALL = { largest: (v) => `largest(&[${v}, ${v}]);`, summary: (v) => `summary(&[${v}, ${v}]);`, pair: (v) => `pair(&${v}, &3);`,
               nested: (v) => `nested(&${v});`, count: (v) => `count(&[${v}, ${v}]);`, nest: (v) => `nest(${v}, 3);` };
let presetCases = 0;
{
  const cases = [];
  Object.keys(Mono.PRESETS).filter((id) => id !== 'nest').forEach((id) => { for (let k = 1; k <= 6; k++) cases.push({ id, k }); });
  const src = ['#![allow(unused)]'];
  cases.forEach((c, i) => {
    src.push(`mod q${i} {\n${PRESET_FNS}    pub fn run() {\n` + Mono.TYPES.slice(0, c.k).map((t) => `        ${CALL[c.id](VAL[t])}`).join('\n') + '\n    }\n}');
  });
  src.push('fn main() {');
  cases.forEach((c, i) => src.push(`    println!("#${i}"); q${i}::run();`));
  src.push('}');
  const file = path.join(tmp, 'presets.rs'), exe = path.join(tmp, 'presets');
  fs.writeFileSync(file, src.join('\n') + '\n');
  const r = cp.spawnSync(rustc, ['--edition', '2024', '-C', 'opt-level=0', '-o', exe, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.log('the preset programs did not compile:\n' + (r.stderr || '').split('\n').slice(0, 30).join('\n')); process.exit(1); }
  const out = cp.spawnSync(exe, [], { encoding: 'utf8' }).stdout, seen = cases.map(() => new Set());
  let cur = -1;
  for (const ln of out.split('\n')) {
    if (ln[0] === '#') cur = +ln.slice(1);
    else if (ln[0] === '@') { const parts = ln.slice(1).split('|'); seen[cur].add(parts[0] + '::<' + parts.slice(1).map(norm).join(', ') + '>'); }
  }
  cases.forEach((c, i) => {
    presetCases++;
    const mine = new Set(Mono.collect(Mono.preset(c.id, c.k)).instances.map((x) => x.key));
    const same = mine.size === seen[i].size && [...mine].every((k) => seen[i].has(k));
    if (!same) { bad++; console.log(`MISMATCH preset ${c.id} k=${c.k}: rustc ran {${[...seen[i]].join(', ')}}, widget says {${[...mine].join(', ')}}`); }
  });
  // the growing-recursion preset must be rejected, for every k
  for (let k = 1; k <= 6; k++) {
    presetCases++;
    const f = path.join(tmp, `nest${k}.rs`);
    fs.writeFileSync(f, `#![allow(unused)]\nmod q {\n${PRESET_FNS}    pub fn run() {\n` + Mono.TYPES.slice(0, k).map((t) => `        ${CALL.nest(VAL[t])}`).join('\n') + '\n    }\n}\nfn main() { q::run(); }\n');
    const rr = cp.spawnSync(rustc, ['--edition', '2024', '-o', path.join(tmp, `nest${k}`), f], { encoding: 'utf8' });
    const res = Mono.collect(Mono.preset('nest', k));
    if (!(rr.status !== 0 && /reached the recursion limit while instantiating `nest::</.test(rr.stderr) && res.error)) { bad++; console.log(`MISMATCH preset nest k=${k}`); }
  }
}
console.log(`${presetCases} preset programs of the widget (k = 1..6), run as the lesson's Rust`);

// (d) the limit counts nesting on one chain, not copies: main requests f0 at 140 different types
{
  const tys = [];
  for (let i = 0, t = 'u8'; i < 140; i++, t = 'Vec<' + t + '>') tys.push(t);
  const prog = { fns: { f0: { params: ['A'], calls: [] } }, main: tys.map((t) => ({ fn: 'f0', args: [t] })) };
  const res = Mono.collect(prog);
  const f = path.join(tmp, 'wide.rs');
  fs.writeFileSync(f, 'use std::any::type_name;\nfn f0<A>() { println!("@f0|{}", type_name::<A>()); }\nfn main() {\n' +
    tys.map((t) => `    f0::<${t}>();`).join('\n') + '\n}\n');
  const rr = cp.spawnSync(rustc, ['--edition', '2024', '-o', path.join(tmp, 'wide'), f], { encoding: 'utf8' });
  const ran = rr.status === 0 ? new Set(cp.spawnSync(path.join(tmp, 'wide'), [], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)).size : -1;
  presetCases++;
  if (res.error || res.instances.length !== ran) { bad++; console.log(`MISMATCH wide program: rustc ran ${ran} copies, collector ${res.error ? 'says recursion limit' : res.instances.length}`); }
  else console.log(`1 wide program: 140 sibling copies of f0, no recursion limit (rustc agrees)`);
}
console.log(`${okCases.length + errCases.length + presetCases} programs total, ${bad} mismatches`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
