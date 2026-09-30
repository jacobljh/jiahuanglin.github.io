#!/usr/bin/env node
/* Differential test: lesson 11's widget engine vs the real rustc.
 *
 *   node tools/rust_verify/11_coherence.js [crates=400] [seed=1] [structs=160]
 *
 * Part 1 — "Can I write this impl?" (all_lessons/rust/lessons/coherence.js).  Each case is a small crate:
 *   three local structs with random (valid) derive sets, a local trait `Describe`, and 1–3 impl headers
 *   drawn from the grammar the widget accepts (Describe, Display, Debug, Clone, Default, ToString, From<_>
 *   over i32 u8 f64 bool String Vec Option Box & &mut tuples, the local structs and a parameter T with at
 *   most one bound).  Each crate is compiled as a library; the set of error codes rustc attaches to every
 *   impl line and every derive line is compared with the model's prediction for that line.
 * Part 2 — the widget's derive model (Coherence.solverEnv / deriveProblem feeding traitsolver.js).  Random
 *   struct definitions (generic or not, fields over std types) with random derive sets: (a) is the struct
 *   accepted, with which codes; (b) for accepted ones, does `S<X>: Trait` hold for random X (E0277 or not).
 * Any disagreement is printed; exit status 1 if any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const LESSONS = path.join(__dirname, '..', '..', 'all_lessons', 'rust', 'lessons');
const TS = require(path.join(LESSONS, 'traitsolver.js'));
global.TraitSolver = TS;
const C = require(path.join(LESSONS, 'coherence.js'));

const NCRATES = +(process.argv[2] || 400), SEED = +(process.argv[3] || 1), NSTRUCTS = +(process.argv[4] || 160);
let seed = SEED;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l11coh_'));

function compile(name, src) {
  const file = path.join(tmp, name + '.rs');
  fs.writeFileSync(file, src);
  return new Promise((resolve) => {
    const p = cp.spawn(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json',
      '--crate-name', name, '-o', path.join(tmp, name + '.rmeta'), file]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const out = [];
      for (const ln of err.split('\n')) {
        let d; try { d = JSON.parse(ln); } catch (e) { continue; }
        if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
        const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
        out.push({ code: (d.code && d.code.code) || '_', line: sp ? sp.line_start : 0, msg: d.message });
      }
      resolve(out);
    });
  });
}
async function pool(jobs, n) {
  const res = new Array(jobs.length); let next = 0;
  async function worker() { while (next < jobs.length) { const i = next++; res[i] = await jobs[i](); } }
  await Promise.all(Array.from({ length: n }, worker));
  return res;
}
const set = (a) => Array.from(new Set(a)).sort().join(',') || 'ok';

/* ───────────── part 1: coherence ───────────── */
const CLOSE = { Copy: ['Clone'], Eq: ['PartialEq'], PartialOrd: ['PartialEq'], Ord: ['PartialOrd', 'Eq', 'PartialEq'] };
function closeDerives(list) {
  const s = new Set(list);
  let grew = true;
  while (grew) { grew = false; for (const d of Array.from(s)) for (const x of (CLOSE[d] || [])) if (!s.has(x)) { s.add(x); grew = true; } }
  return C.DERIVABLE.filter(d => s.has(d));
}
const STRUCTS = [
  { name: 'Reading', decl: 'struct Reading { celsius: f64, label: String }', ok: ['Clone', 'Debug', 'Default', 'PartialEq', 'PartialOrd'] },
  { name: 'Meters', decl: 'struct Meters(f64);', ok: ['Clone', 'Copy', 'Debug', 'Default', 'PartialEq', 'PartialOrd'] },
  { name: 'Wrapper', decl: 'struct Wrapper<T> { inner: T }', ok: C.DERIVABLE },
];
const TRAITS = [['Describe', 32], ['Display', 16], ['Debug', 8], ['Clone', 12], ['Default', 10], ['ToString', 8], ['From', 14]];
function pickTrait() { let t = rnd() * 100, acc = 0; for (const [n, w] of TRAITS) { acc += w; if (t < acc) return n; } return 'Describe'; }
function genTy(d, hasT) {
  const leaves = ['i32', 'u8', 'f64', 'bool', 'String', 'Meters', 'Reading'];
  if (hasT) leaves.push('T', 'T');
  if (d <= 0 || chance(0.42)) return pick(leaves);
  const r = rnd();
  if (r < 0.16) return 'Vec<' + genTy(d - 1, hasT) + '>';
  if (r < 0.30) return 'Option<' + genTy(d - 1, hasT) + '>';
  if (r < 0.46) return 'Box<' + genTy(d - 1, hasT) + '>';
  if (r < 0.64) return '&' + genTy(d - 1, hasT);
  if (r < 0.68) return '&mut ' + genTy(d - 1, hasT);
  if (r < 0.88) return 'Wrapper<' + genTy(d - 1, hasT) + '>';
  return '(' + genTy(d - 1, hasT) + ', ' + genTy(d - 1, hasT) + ')';
}
function genLocalish(d, hasT) {             // a type the orphan rule counts as local
  const r = rnd();
  if (d <= 0 || r < 0.35) return pick(['Meters', 'Reading']);
  if (r < 0.65) return 'Wrapper<' + genTy(d - 1, hasT) + '>';
  if (r < 0.82) return 'Box<' + genLocalish(d - 1, hasT) + '>';
  if (r < 0.95) return '&' + genLocalish(d - 1, hasT);
  return '&mut ' + genLocalish(d - 1, hasT);
}
function genImpl(prev) {
  if (prev.length && chance(0.3)) {            // a sibling of an earlier impl: same trait, related header
    const p = pick(prev), q = genImpl([]);
    if (q.trait !== p.trait) { q.head = q.head.replace(' ' + q.trait + (q.arg ? '<' + q.arg + '>' : '') + ' for ', ' ' + p.trait + (p.arg ? '<' + p.arg + '>' : '') + ' for '); q.trait = p.trait; q.arg = p.arg; }
    if (/\bT\b/.test(q.head) && !/^impl</.test(q.head)) q.head = q.head.replace(/^impl /, 'impl<T> ');   // declare the copied T
    return q;
  }
  const trait = pickTrait();
  const pr = rnd(), bounds = ['Display', 'Debug', 'Clone', 'Copy', 'Default', 'Describe'];
  let params = pr < 0.45 ? '' : pr < 0.70 ? 'T' : 'T: ' + pick(bounds);
  // excluded: a blanket impl of a std trait bounded by that same trait (`impl<T: Default> Default for T`):
  // it is E0210, and rustc then also reports a cascading query cycle (E0391) at unrelated derives.
  if (params === 'T: ' + trait && trait !== 'Describe') params = 'T';
  let self, arg, tries = 0;
  const localish = trait !== 'Describe' && chance(0.55);
  do {
    self = localish && (trait !== 'From' || chance(0.5)) ? genLocalish(2, !!params) : genTy(2, !!params);
    arg = trait === 'From' ? (localish && !/Meters|Reading|Wrapper/.test(self) ? genLocalish(2, !!params) : genTy(2, !!params)) : null;
    tries++;
  } while (params && !/\bT\b/.test(self + ' ' + (arg || '')) && (tries < 8 || chance(0.9)));
  const head = 'impl' + (params ? '<' + params + '>' : '') + ' ' + trait + (arg ? '<' + arg + '>' : '') + ' for ' + self;
  return { head, trait, arg };
}
function rustImpl(g) {                        // the same header with explicit lifetimes, plus a body that type-checks
  const lt = (s) => s.replace(/&(mut )?/g, (m, mu) => "&'a " + (mu || ''));
  let head = lt(g.head);
  if (/&'a/.test(head)) head = head.replace(/^impl(<)?/, (m, lt2) => lt2 ? "impl<'a, " : "impl<'a>");
  const body = {
    Describe: '{}',
    Display: "{ fn fmt(&self, _f: &mut fmt::Formatter<'_>) -> fmt::Result { Ok(()) } }",
    Debug: "{ fn fmt(&self, _f: &mut fmt::Formatter<'_>) -> fmt::Result { Ok(()) } }",
    Clone: '{ fn clone(&self) -> Self { unimplemented!() } }',
    Default: '{ fn default() -> Self { unimplemented!() } }',
    ToString: '{ fn to_string(&self) -> String { String::new() } }',
    From: g.arg ? '{ fn from(_: ' + lt(g.arg) + ') -> Self { unimplemented!() } }' : '',
  }[g.trait];
  return head + ' ' + body;
}
function genCrate(k) {
  const derives = STRUCTS.map(s => closeDerives(s.ok.filter(() => chance(0.35))));
  const n = 1 + Math.floor(rnd() * 4), impls = [];
  while (impls.length < n) {
    const g = genImpl(impls), m = /^impl<T: (\w+)> (\w+) for T$/.exec(g.head);
    if (m && m[1] === m[2] && m[2] !== 'Describe') continue;      // excluded, see genImpl
    impls.push(g);
  }
  const modelSrc = STRUCTS.map((s, i) => (derives[i].length ? '#[derive(' + derives[i].join(', ') + ')] ' : '') + s.decl).join('\n') + '\ntrait Describe {}\n';
  const header = ['#![allow(unused)]', 'use std::fmt::{self, Debug, Display};'];
  const structLine = {};
  STRUCTS.forEach((s, i) => { structLine[header.length + 1] = s.name; header.push((derives[i].length ? '#[derive(' + derives[i].join(', ') + ')] ' : '') + s.decl); });
  header.push('trait Describe { fn describe(&self) -> String { String::from("?") } }');
  const implLine = {};
  impls.forEach((g, i) => { implLine[header.length + 1] = i; header.push(rustImpl(g)); });
  return { k, derives, impls, modelSrc, src: header.join('\n') + '\n', structLine, implLine };
}
function predict(cs) {
  const cr = C.parseCrate(cs.modelSrc);
  const heads = cs.impls.map(g => g.head);
  const r = C.check(cr, heads.slice(0, -1), heads[heads.length - 1]);
  if (r.haveErrors.some(e => !/: E\d/.test(e))) throw new Error('model refused: ' + r.haveErrors.join('; '));
  const byImpl = heads.map(() => []), byStruct = {};
  const manual = r.all.filter(i => i.source !== 'derive');
  manual.forEach((imp, i) => { byImpl[i] = imp.result.codes; });
  r.all.filter(i => i.source === 'derive').forEach(imp => { (byStruct[imp.struct] = byStruct[imp.struct] || []).push(...imp.result.codes); });
  return { byImpl, byStruct };
}

/* ───────────── part 2: derive model ───────────── */
const FIELD_CTOR = ['Vec', 'Option', 'Box', 'Rc', 'Cell', 'RefCell', 'Mutex', 'PhantomData'];
function genField(d, hasT) {
  const leaves = ['i32', 'f64', 'String', 'bool'];
  if (hasT) leaves.push('T', 'T', 'T');
  if (d <= 0 || chance(0.38)) return pick(leaves);
  const r = rnd();
  if (r < 0.78) return pick(FIELD_CTOR) + '<' + genField(d - 1, hasT) + '>';
  if (r < 0.9) return '(' + genField(d - 1, hasT) + ', ' + genField(d - 1, hasT) + ')';
  return '[' + genField(d - 1, hasT) + '; 2]';
}
const QTYPES = ['i32', 'f64', 'String', 'bool', 'Rc<i32>', 'Mutex<i32>', 'Cell<i32>', 'RefCell<i32>', 'Vec<f64>', 'Box<i32>', 'Option<String>', '(i32, f64)'];
const QTRAITS = ['Clone', 'Copy', 'Debug', 'Default', 'PartialEq', 'Eq', 'PartialOrd', 'Ord', 'Hash', 'Display'];
const BOUND = { Debug: 'std::fmt::Debug', Display: 'std::fmt::Display', Hash: 'std::hash::Hash' };
function genStruct(k) {
  const generic = chance(0.6), nf = 1 + Math.floor(rnd() * 2);
  let fields;
  do { fields = Array.from({ length: nf }, () => genField(2, generic)); } while (generic && !fields.some(f => /\bT\b/.test(f)));
  const derives = closeDerives(C.DERIVABLE.filter(() => chance(0.4)));
  const name = 'S' + k, gen = generic ? '<T>' : '';
  const body = '{ ' + fields.map((f, i) => 'f' + i + ': ' + f).join(', ') + ' }';
  const decl = (derives.length ? '#[derive(' + derives.join(', ') + ')] ' : '') + 'struct ' + name + gen + ' ' + body;
  return { k, name, generic, fields, derives, decl };
}
const PRE2 = ['#![allow(unused)]', 'use std::rc::Rc; use std::cell::{Cell, RefCell}; use std::sync::Mutex; use std::marker::PhantomData;'];

(async function main() {
  let bad = 0, genBugs = 0;
  // ---- part 1
  const crates = Array.from({ length: NCRATES }, (_, k) => genCrate(k));
  const res1 = await pool(crates.map(cs => () => compile('c' + cs.k, cs.src)), Math.max(2, os.cpus().length));
  let lines = 0, errLines = 0; const tally = {};
  crates.forEach((cs, i) => {
    let pred;
    try { pred = predict(cs); } catch (e) { genBugs++; console.log(`  [model threw] crate ${cs.k}: ${e.message}\n${cs.src}`); return; }
    const realImpl = cs.impls.map(() => []), realStruct = {};
    for (const e of res1[i]) {
      if (cs.implLine[e.line] !== undefined) realImpl[cs.implLine[e.line]].push(e.code);
      else if (cs.structLine[e.line]) (realStruct[cs.structLine[e.line]] = realStruct[cs.structLine[e.line]] || []).push(e.code);
      else { genBugs++; console.log(`  [unattributed error] crate ${cs.k} line ${e.line}: ${e.code} ${e.msg}`); }
    }
    cs.impls.forEach((g, j) => {
      lines++;
      const want = set(realImpl[j]), got = set(pred.byImpl[j]);
      tally[want] = (tally[want] || 0) + 1;
      if (want !== 'ok') errLines++;
      if (want !== got) { bad++; console.log(`  MISMATCH crate ${cs.k} impl ${j + 1}/${cs.impls.length}: ${g.head}\n     rustc=${want}  model=${got}\n${cs.src.split('\n').slice(2).map(l => '       | ' + l).join('\n')}`); }
    });
    STRUCTS.forEach((s) => {
      const want = set(realStruct[s.name] || []), got = set(pred.byStruct[s.name] || []);
      if (want !== got) { bad++; console.log(`  MISMATCH crate ${cs.k} derive line of ${s.name}: rustc=${want} model=${got}\n${cs.src.split('\n').slice(2).map(l => '       | ' + l).join('\n')}`); }
    });
  });
  console.log(`part 1 (coherence): ${NCRATES} crates, ${lines} impl lines (${errLines} rejected by rustc; ${Object.entries(tally).map(([k, v]) => k + ' ' + v).join(', ')}): ${bad} mismatches`);

  // ---- part 2
  const bad1 = bad;
  const structs = Array.from({ length: NSTRUCTS }, (_, k) => genStruct(k));
  const res2 = await pool(structs.map(st => () => compile('s' + st.k, PRE2.concat(st.decl).join('\n') + '\n')), Math.max(2, os.cpus().length));
  const accepted = [];
  let acc = 0;
  structs.forEach((st, i) => {
    const cr = C.parseCrate(st.decl);
    const probs = st.derives.map(d => [d, C.deriveProblem(cr, st.name, d)]).filter(x => x[1]);
    const got = set(probs.map(([d]) => d === 'Copy' ? 'E0204' : d === 'PartialEq' ? 'E0369' : 'E0277'));
    const want = set(res2[i].map(e => e.code));
    if (want !== got) { bad++; console.log(`  MISMATCH derive-acceptance ${st.decl}\n     rustc=${want}  model=${got}  ${probs.map(p => p.join(': ')).join(' | ')}`); }
    if (want === 'ok') { acc++; accepted.push(st); }
  });
  console.log(`part 2a (derive accepted?): ${NSTRUCTS} structs (${acc} accepted): ${bad - bad1} mismatches`);
  const bad2 = bad;
  let nq = 0;
  const qfiles = accepted.map(st => {
    const qs = [];
    for (const tr of QTRAITS) {
      const ty = st.generic ? st.name + '<' + pick(QTYPES) + '>' : st.name;
      qs.push([tr, chance(0.25) ? 'Vec<' + ty + '>' : chance(0.2) ? 'Option<' + ty + '>' : ty]);
    }
    const lines2 = PRE2.concat(st.decl);
    QTRAITS.forEach((tr) => lines2.push(`fn need_${tr}<X: ${BOUND[tr] || tr}>() {}`));
    const first = lines2.length + 1;
    qs.forEach(([tr, ty], j) => lines2.push(`fn q${j}() { need_${tr}::<${ty}>(); }`));
    return { st, qs, first, src: lines2.join('\n') + '\n' };
  });
  const res3 = await pool(qfiles.map((q, i) => () => compile('q' + i, q.src)), Math.max(2, os.cpus().length));
  qfiles.forEach((q, i) => {
    const failLine = new Set();
    for (const e of res3[i]) { if (e.code === 'E0277') failLine.add(e.line); else { genBugs++; console.log(`  [query file problem] ${e.code} ${e.msg} @${e.line}\n${q.src}`); } }
    const env = C.solverEnv(C.parseCrate(q.st.decl));
    q.qs.forEach(([tr, ty], j) => {
      nq++;
      const real = !failLine.has(q.first + j);
      let mine; try { mine = TS.solve(tr, TS.parse(ty), env).ok; } catch (e) { mine = 'ERR ' + e.message; }
      if (mine !== real) { bad++; console.log(`  MISMATCH query ${ty}: ${tr}   rustc=${real ? 'holds' : 'fails'} model=${mine}\n     ${q.st.decl}`); }
    });
  });
  console.log(`part 2b (S<X>: Trait?): ${nq} queries on ${accepted.length} accepted structs: ${bad - bad2} mismatches`);
  console.log(`\n${lines} coherence cases + ${NSTRUCTS} derive definitions + ${nq} derive queries: ${bad} mismatches, ${genBugs} generator problems`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad || genBugs ? 1 : 0);
})();
