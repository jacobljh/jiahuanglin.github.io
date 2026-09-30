#!/usr/bin/env node
/* Differential test: all_lessons/rust/lessons/traitsolver.js  vs  the real rustc.
 *
 *   node tools/test_traitsolver.js [queriesPerTrait=300] [seed=1]
 *
 * For each supported trait it generates random well-formed types, asks the JS solver whether
 * TYPE: TRAIT holds, then compiles one Rust file with a `need::<TYPE>()` per query and reads
 * which lines rustc rejects with E0277. Any disagreement is printed; exit status 1 if any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const TS = require('../all_lessons/rust/lessons/traitsolver.js');

const N = +(process.argv[2] || 300), SEED = +(process.argv[3] || 1);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const LEAF = ['i32', 'u8', 'f64', 'bool', 'char', 'String', '()', 'AtomicUsize', 'AtomicBool'];
const ONE = ['Vec', 'Option', 'Box', 'VecDeque', 'HashSet', 'BTreeSet', 'Rc', 'Arc', 'Cell', 'RefCell', 'Mutex', 'RwLock',
  'std::rc::Weak', 'std::sync::Weak', 'Sender', 'Receiver', 'SyncSender', 'JoinHandle', 'BinaryHeap', 'LinkedList'];
const TWO = ['HashMap', 'BTreeMap', 'Result'];
const DYN = ['dyn Show', 'dyn Show + Send', 'dyn Show + Send + Sync', 'dyn Debug', 'dyn Debug + Send'];
const GUARD = ['MutexGuard', 'RwLockReadGuard', 'RwLockWriteGuard'];

function gen(depth) {
  if (depth <= 0 || rnd() < 0.22) return pick(LEAF);
  const r = rnd();
  if (r < 0.50) return pick(ONE) + '<' + gen(depth - 1) + '>';
  if (r < 0.60) return pick(TWO) + '<' + gen(depth - 1) + ', ' + gen(depth - 1) + '>';
  if (r < 0.66) return pick(GUARD) + "<'static, " + gen(depth - 1) + '>';
  if (r < 0.74) return "&'static " + gen(depth - 1);
  if (r < 0.79) return "&'static mut " + gen(depth - 1);
  if (r < 0.83) return '*const ' + gen(depth - 1);
  if (r < 0.86) return '*mut ' + gen(depth - 1);
  if (r < 0.92) return '(' + gen(depth - 1) + ', ' + gen(depth - 1) + ')';
  if (r < 0.95) return '[' + gen(depth - 1) + '; 3]';
  if (r < 0.97) return 'fn(i32) -> i32';
  return 'Box<' + pick(DYN) + '>';
}
const SIZED_OK = (t) => true;

const HEADER = `#![allow(unused)]
use std::rc::Rc; use std::sync::{Arc, Mutex, RwLock, MutexGuard, RwLockReadGuard, RwLockWriteGuard};
use std::cell::{Cell, RefCell};
use std::collections::*;
use std::sync::mpsc::{Sender, Receiver, SyncSender};
use std::thread::JoinHandle;
use std::sync::atomic::{AtomicUsize, AtomicBool};
use std::fmt::{Debug, Display};
use std::hash::Hash;
trait Show {}
`;
const BOUND = { Send: 'Send', Sync: 'Sync', Copy: 'Copy', Clone: 'Clone', Debug: 'std::fmt::Debug', Display: 'std::fmt::Display',
  Default: 'Default', PartialEq: 'PartialEq', Eq: 'Eq', PartialOrd: 'PartialOrd', Ord: 'Ord', Hash: 'std::hash::Hash' };

const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsdiff_'));
let bad = 0, total = 0, genBugs = 0;
const seen = {};

for (const trait of TS.TRAITS) {
  const qs = [];
  const uniq = new Set();
  while (qs.length < N) { const t = gen(3); if (uniq.has(t)) continue; uniq.add(t); qs.push(t); }
  const lines = HEADER.trimEnd().split('\n');
  lines.push(`fn need<T: ${BOUND[trait]}>() {}`);
  const firstQ = lines.length + 1;                      // 1-based line number of query 0
  qs.forEach((t, i) => lines.push(`fn q${i}() { need::<${t}>(); }`));
  const file = path.join(tmp, trait + '.rs');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json', '-o', path.join(tmp, trait + '.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const failLine = new Set();
  for (const ln of (r.stderr || '').split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const code = d.code && d.code.code;
    const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
    if (code === 'E0277' && sp) failLine.add(sp.line_start);
    else { genBugs++; console.log(`  [generator bug?] ${trait}: ${code} ${d.message} @${sp && sp.line_start}`); }
  }
  let mism = 0;
  qs.forEach((t, i) => {
    const line = firstQ + i;
    const real = !failLine.has(line);
    let mine; try { mine = TS.solve(trait, TS.parse(t)).ok; } catch (e) { mine = 'ERR ' + e.message; }
    total++;
    if (mine !== real) { mism++; bad++; console.log(`  MISMATCH ${trait.padEnd(10)} ${t}\n            rustc=${real ? 'holds' : 'fails'}  solver=${mine === true ? 'holds' : mine === false ? 'fails' : mine}`); }
  });
  const holds = qs.filter((_, i) => !failLine.has(firstQ + i)).length;
  console.log(`${trait.padEnd(10)} ${qs.length} queries (${holds} hold, ${qs.length - holds} fail): ${mism} mismatches`);
}
console.log(`\n${total} queries total, ${bad} mismatches, ${genBugs} generator problems`);
process.exit(bad || genBugs ? 1 : 0);
