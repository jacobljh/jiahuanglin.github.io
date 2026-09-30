#!/usr/bin/env node
/* Oracle test for all_lessons/rust/lessons/interleave.js (Lesson 17's "All interleavings" widget).
 *
 *   node tools/rust_verify/17_interleave.js [randomPrograms=400] [seed=17] [trials=2000]
 *
 * rustc cannot judge an interleaving, so the oracle is two-fold:
 *  (1) an INDEPENDENT enumerator: breadth-first, forward path counting, its own program
 *      representation (generated here as data, rendered to text for the engine), its own
 *      step semantics and its own state encoding (canonical JSON).  On every preset x
 *      iterations 1-4 and on N random well-formed programs (2-3 threads, locks, loads/stores,
 *      fetch_add, channels) it must agree with the engine on: the number of schedules, the
 *      exact outcome -> schedule-count map, deadlock reachability and count, the length of the
 *      shortest deadlocking schedule, and the number of distinct reachable states.  Every
 *      witness schedule the engine reports is replayed here and must end where it claims.
 *  (2) REAL EXECUTION: presets (a) (b) (c) (e) (f) are compiled as real Rust (rustc
 *      -C opt-level=3, edition 2024) and run `trials` times per iteration count 1-4, plus (a)
 *      with a thread::yield_now() between its two steps (same model, wider window, so real
 *      runs do lose updates); every observed final value must be in the enumerated outcome
 *      set, and (b) (c) (e) (f) must show only the predicted value.  (d) and (g) can deadlock,
 *      so they are not run.
 * Exit status 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const IL = require('../../all_lessons/rust/lessons/interleave.js');

const N = +(process.argv[2] || 400), SEED = +(process.argv[3] || 17), TRIALS = +(process.argv[4] || 2000);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

/* ─────────── (1a) random well-formed programs, as data ─────────── */
// a step is an array: ['load','x'] ['store','x'] ['fetch_add','x'] ['lock','A'] ['unlock','A'] ['send','c',k] ['recv','c','s']
function genBlock(depth, held) {
  const r = rnd();
  if (r < 0.22) { const v = pick(['x', 'y']); return [['load', v], ['store', v]]; }
  if (r < 0.40) return [['fetch_add', pick(['x', 'y'])]];
  if (r < 0.52) return [['send', pick(['c', 'd']), 1 + Math.floor(rnd() * 2)]];
  if (r < 0.62) return [['recv', pick(['c', 'd']), pick(['s', 'x'])]];
  if (r < 0.65 && held.length) { const m = pick(held); return [['lock', m]]; }       // relock a held mutex: self-deadlock
  if (depth >= 2) return [['fetch_add', 'x']];
  const free = ['A', 'B', 'C'].filter(m => held.indexOf(m) < 0);
  if (!free.length) return [['fetch_add', 'y']];
  const m = pick(free), inner = [];
  const k = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < k; i++) inner.push(...genBlock(depth + 1, held.concat([m])));
  return [['lock', m], ...inner, ['unlock', m]];
}
function genProgram() {
  const T = rnd() < 0.7 ? 2 : 3, bodies = [];
  for (let t = 0; t < T; t++) {
    const body = [], k = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < k; i++) body.push(...genBlock(0, []));
    bodies.push(body);
  }
  // balance channels: a recv needs a matching send (the model has no Err(RecvError))
  for (const c of ['c', 'd']) {
    let s = 0, r = 0;
    bodies.forEach(b => b.forEach(st => { if (st[0] === 'send' && st[1] === c) s++; if (st[0] === 'recv' && st[1] === c) r++; }));
    while (s < r) { pick(bodies).push(['send', c, 1]); s++; }
  }
  // a store needs an earlier load of the same variable in the same thread
  bodies.forEach(b => { const seen = {}; for (let i = 0; i < b.length; i++) { if (b[i][0] === 'load') seen[b[i][1]] = 1; if (b[i][0] === 'store' && !seen[b[i][1]]) { b.splice(i, 0, ['load', b[i][1]]); seen[b[i][1]] = 1; i++; } } });
  let n = 1 + Math.floor(rnd() * 3);
  const fits = (n) => { let tot = 0; for (const b of bodies) { if (b.length * n > 24) return false; tot += b.length * n; } return tot <= 40; };
  while (n > 1 && !fits(n)) n--;
  if (!fits(n)) return null;
  return { bodies, n };
}
const render = (body) => body.map(st => st.join(' ')).join('; ');

/* ─────────── (1b) the independent enumerator: BFS, forward path counts, JSON states ─────────── */
function bfs(prog) {
  const threads = prog.bodies.map(b => { let e = []; for (let i = 0; i < prog.n; i++) e = e.concat(b); return e; });
  const vars = new Set();
  threads.forEach(th => th.forEach(st => { if (['load', 'store', 'fetch_add'].includes(st[0])) vars.add(st[1]); if (st[0] === 'recv') vars.add(st[2]); }));
  const varList = [...vars].sort();
  const start = { pcs: threads.map(() => 0), vals: {}, regs: threads.map(() => ({})), locks: {}, queues: {} };
  const canon = (s) => JSON.stringify({ p: s.pcs, v: varList.map(v => s.vals[v] || 0),
    r: s.regs.map(r => varList.map(v => r[v] || 0)), l: Object.keys(s.locks).filter(m => s.locks[m] !== undefined).sort().map(m => [m, s.locks[m]]),
    q: Object.keys(s.queues).sort().filter(c => s.queues[c].length).map(c => [c, s.queues[c]]) });
  const canMove = (s, t) => {
    const st = threads[t][s.pcs[t]];
    if (!st) return false;
    if (st[0] === 'lock') return s.locks[st[1]] === undefined;
    if (st[0] === 'recv') return (s.queues[st[1]] || []).length > 0;
    return true;
  };
  const move = (s, t) => {
    const n = JSON.parse(JSON.stringify(s)), st = threads[t][n.pcs[t]];
    if (st[0] === 'load') n.regs[t][st[1]] = n.vals[st[1]] || 0;
    else if (st[0] === 'store') n.vals[st[1]] = (n.regs[t][st[1]] || 0) + 1;
    else if (st[0] === 'fetch_add') n.vals[st[1]] = (n.vals[st[1]] || 0) + 1;
    else if (st[0] === 'lock') n.locks[st[1]] = t;
    else if (st[0] === 'unlock') delete n.locks[st[1]];
    else if (st[0] === 'send') (n.queues[st[1]] = n.queues[st[1]] || []).push(st[2]);
    else if (st[0] === 'recv') n.vals[st[2]] = (n.vals[st[2]] || 0) + n.queues[st[1]].shift();
    n.pcs[t]++;
    return n;
  };
  const outcome = (s) => varList.length ? varList.map(v => v + '=' + (s.vals[v] || 0)).join(' ') : 'done';
  let frontier = new Map([[canon(start), { s: start, ways: 1 }]]), states = 0, depth = 0;
  const outs = {}; let dead = 0, deadDepth = null;
  while (frontier.size) {
    states += frontier.size;
    const next = new Map();
    for (const { s, ways } of frontier.values()) {
      const movers = threads.map((_, t) => t).filter(t => canMove(s, t));
      if (!movers.length) {
        const finished = s.pcs.every((pc, t) => pc >= threads[t].length);
        if (finished) outs[outcome(s)] = (outs[outcome(s)] || 0) + ways;
        else { dead += ways; if (deadDepth === null) deadDepth = depth; }
        continue;
      }
      for (const t of movers) {
        const c = move(s, t), k = canon(c), e = next.get(k);
        if (e) e.ways += ways; else next.set(k, { s: c, ways });
      }
    }
    frontier = next; depth++;
  }
  // replay a schedule under THIS semantics: returns 'x=..' | 'deadlock' | 'stuck-early' | 'illegal'
  const replay = (sched) => {
    let s = start;
    for (const t of sched) { if (!canMove(s, t)) return 'illegal'; s = move(s, t); }
    const movers = threads.map((_, t) => t).filter(t => canMove(s, t));
    if (movers.length) return 'not-maximal';
    return s.pcs.every((pc, t) => pc >= threads[t].length) ? outcome(s) : 'deadlock';
  };
  let total = dead; for (const k in outs) total += outs[k];
  return { total, outs, dead, deadDepth, states, replay };
}

/* ─────────── (1c) compare ─────────── */
let cases = 0, mism = 0;
function compare(label, prog) {
  cases++;
  const texts = prog.bodies.map(render);
  let e;
  try { e = IL.explore(IL.parse(texts, prog.n)); } catch (err) { mism++; console.log(`  MISMATCH ${label}: engine threw ${err.message}\n    ${texts.join('  ||  ')}`); return; }
  const b = bfs(prog), problems = [];
  if (e.truncated) problems.push('engine truncated');
  if (e.schedules !== b.total) problems.push(`schedules ${e.schedules} vs ${b.total}`);
  const eo = {}; e.outcomes.forEach(o => { eo[o.key] = o.count; });
  const keys = new Set([...Object.keys(eo), ...Object.keys(b.outs)]);
  for (const k of keys) if (eo[k] !== b.outs[k]) problems.push(`outcome ${k}: ${eo[k]} vs ${b.outs[k]}`);
  if (e.deadlock.count !== b.dead) problems.push(`deadlock schedules ${e.deadlock.count} vs ${b.dead}`);
  const eLen = e.deadlock.shortest ? e.deadlock.shortest.length : null;
  if (eLen !== b.deadDepth) problems.push(`shortest deadlock ${eLen} vs ${b.deadDepth}`);
  if (e.states !== b.states) problems.push(`states ${e.states} vs ${b.states}`);
  e.outcomes.forEach(o => { const r = b.replay(o.witness); if (r !== o.key) problems.push(`witness for ${o.key} replays to ${r}`); });
  if (e.deadlock.shortest) { const r = b.replay(e.deadlock.shortest); if (r !== 'deadlock') problems.push(`deadlock witness replays to ${r}`); }
  if (problems.length) { mism++; console.log(`  MISMATCH ${label} (n=${prog.n}): ${problems.join('; ')}\n    ${texts.join('  ||  ')}`); }
}

const toData = (text) => text.split(';').map(s => s.trim().split(/\s+/)).map(w => w[0] === 'send' ? ['send', w[1], w.length > 2 ? +w[2] : 1] : w);
for (const p of IL.PRESETS) for (let n = 1; n <= 4; n++) compare(`preset ${p.id}`, { bodies: p.threads.map(toData), n });
const presetCases = cases;
let made = 0, dl = 0, three = 0, chans = 0;
while (made < N) {
  const prog = genProgram();
  if (!prog) continue;
  made++;
  if (prog.bodies.length === 3) three++;
  if (prog.bodies.some(b => b.some(s => s[0] === 'recv'))) chans++;
  const before = mism;
  compare(`random #${made}`, prog);
  if (before === mism && bfs(prog).dead) dl++;
}
console.log(`(1) enumerator vs independent BFS: ${cases} programs (${presetCases} preset cases, ${made} random: ${three} with 3 threads, ${chans} with channels, ${dl} with a reachable deadlock): ${mism} mismatches`);

/* ─────────── (2) real execution of presets a, b, c, e, f ─────────── */
const RUST = `use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use std::sync::{mpsc, Barrier, Mutex};
use std::thread;

fn trial(preset: &str, n: usize) -> String {
    let go = &Barrier::new(2);                         // both threads start together
    match preset {
        "a" => { let x = AtomicUsize::new(0);
                 thread::scope(|s| for _ in 0..2 { s.spawn(|| { go.wait(); for _ in 0..n { let v = x.load(SeqCst); x.store(v + 1, SeqCst); } }); });
                 format!("x={}", x.load(SeqCst)) }
        // (a) again, with a yield between the two steps: the same model (a yield touches no shared
        // state), but the window is wide enough that real runs actually lose updates
        "ay" => { let x = AtomicUsize::new(0);
                 thread::scope(|s| for _ in 0..2 { s.spawn(|| { go.wait(); for _ in 0..n { let v = x.load(SeqCst); thread::yield_now(); x.store(v + 1, SeqCst); } }); });
                 format!("x={}", x.load(SeqCst)) }
        "b" => { let x = AtomicUsize::new(0);
                 thread::scope(|s| for _ in 0..2 { s.spawn(|| { go.wait(); for _ in 0..n { x.fetch_add(1, SeqCst); } }); });
                 format!("x={}", x.load(SeqCst)) }
        "c" => { let m = Mutex::new(0usize);
                 thread::scope(|s| for _ in 0..2 { s.spawn(|| { go.wait(); for _ in 0..n { let mut g = m.lock().unwrap(); let v = *g; *g = v + 1; } }); });
                 format!("x={}", m.into_inner().unwrap()) }
        "e" => { let a = Mutex::new(0usize); let b = Mutex::new(0usize);
                 thread::scope(|s| for _ in 0..2 { s.spawn(|| { go.wait(); for _ in 0..n { let mut ga = a.lock().unwrap(); let mut gb = b.lock().unwrap(); *ga += 1; *gb += 1; } }); });
                 let (a, b) = (a.into_inner().unwrap(), b.into_inner().unwrap());
                 assert_eq!(a, b);
                 format!("x={a}") }
        "f" => { let (tx, rx) = mpsc::channel::<usize>();
                 let got = thread::scope(|s| {
                     s.spawn(move || { go.wait(); for _ in 0..n { tx.send(1).unwrap(); } });
                     let c = s.spawn(move || { go.wait(); let mut sum = 0; for _ in 0..n { sum += rx.recv().unwrap(); } sum });
                     c.join().unwrap()
                 });
                 format!("s={got}") }
        _ => unreachable!(),
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (preset, n, trials): (&str, usize, usize) = (&a[1], a[2].parse().unwrap(), a[3].parse().unwrap());
    let mut seen = BTreeMap::new();
    for _ in 0..trials { *seen.entry(trial(preset, n)).or_insert(0usize) += 1; }
    for (k, c) in seen { println!("{k}\\t{c}"); }
}
`;
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'il17_'));
fs.writeFileSync(path.join(tmp, 'real.rs'), RUST);
const exe = path.join(tmp, 'real');
const comp = cp.spawnSync(rustc, ['--edition', '2024', '-C', 'opt-level=3', '-o', exe, path.join(tmp, 'real.rs')], { encoding: 'utf8' });
let realBad = 0, runs = 0;
if (comp.status !== 0) { console.log('(2) could not compile the real programs:\n' + comp.stderr); realBad++; }
else {
  const presetById = {}; IL.PRESETS.forEach(p => { presetById[p.id] = p; });
  for (const id of ['a', 'ay', 'b', 'c', 'e', 'f']) {
    for (let n = 1; n <= 4; n++) {
      const r = IL.explore(IL.parse(presetById[id === 'ay' ? 'a' : id].threads, n));
      const allowed = new Set(r.outcomes.map(o => o.key));
      const run = cp.spawnSync(exe, [id, String(n), String(TRIALS)], { encoding: 'utf8', timeout: 120000 });
      runs += TRIALS;
      if (run.status !== 0) { realBad++; console.log(`  REAL ${id} n=${n}: exit ${run.status} ${run.stderr}`); continue; }
      const seen = run.stdout.trim().split('\n').map(l => l.split('\t'));
      const outside = seen.filter(([k]) => !allowed.has(k));
      const onlyPredicted = id === 'a' || id === 'ay' || (seen.length === 1 && seen[0][0] === r.sequential);
      const line = seen.map(([k, c]) => `${k}:${c}`).join(' ');
      if (outside.length || !onlyPredicted) { realBad++; console.log(`  REAL MISMATCH ${id} n=${n}: observed ${line}; enumerated {${[...allowed].join(', ')}}`); }
      else console.log(`  real ${id} n=${n}: observed ${line}  (enumerated: ${r.outcomes.map(o => o.key).join(', ')})`);
    }
  }
}
console.log(`(2) real execution: ${runs} runs of presets a (plain and with a yield),b,c,e,f (rustc -C opt-level=3, edition 2024): ${realBad} mismatches`);
console.log(`\n${cases} enumerated programs + ${runs} real runs, ${mism + realBad} mismatches`);
process.exit(mism + realBad ? 1 : 0);
