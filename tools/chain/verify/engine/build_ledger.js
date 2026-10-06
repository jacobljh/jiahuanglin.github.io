#!/usr/bin/env node
/* build_ledger.js — measures the data track's table on the Bench and writes it into all_lessons/robot_model_training/ledger.js
 *
 *   node tools/chain/verify/engine/build_ledger.js            (rewrites the TABLE block of ledger.js between the two markers)
 *   node tools/chain/verify/engine/build_ledger.js --check    (recomputes a sample of cells live and compares them with the stored table)
 *
 * The table is a set of success-versus-hours curves, one per (task, source), each measured with the engine of the robot-track lesson that introduced the source:
 *   layouts  lesson 7 and 8's engine (bodies_lab.js): a policy that copies the stored demonstration of the layout nearest to the new one; sources are other arms,
 *            footage of a person, and simulators whose arm model is off by a gap; own demonstrations are the baseline.
 *   recover  lesson 3's engine (dagger_lab.js): the five-post course; own calm demonstrations, demonstrations recorded under a gust, corrections.
 *   contact  lesson 10's engine (insertion_lab.js): a peg in a hole with a millimetre of clearance; demonstrations with and without the force channels.
 * Hours are motion hours: attempted demonstrations x 9.3 s (the expert's time on five posts) / 3600; the supervisor's and the operator's other time is priced in lesson 17.
 * Every cell is a function of fixed seeds; the file has no Math.random and no Date.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const LESS = path.join(ROOT, 'all_lessons');
const RD = fs.existsSync(path.join(LESS, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const DD = RD;                                           // the data lessons (16-24) live in the same directory as the robot lessons
const BN = require(path.join(LESS, RD, 'bench.js'));
const BL = require(path.join(LESS, RD, 'bodies_lab.js'));
const DL = require(path.join(LESS, RD, 'dagger_lab.js'));
const INS = require(path.join(LESS, RD, 'insertion_lab.js'));
const LEDGER = path.join(LESS, DD, 'ledger.js');
const CHECK = process.argv.includes('--check');

const SEC_PER_DEMO = 9.3, HOUR = 3600;
const round = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

/* ───────────────────────── layouts ───────────────────────── */
/* the footage body: a person's hand wobbles more than the arm (noise 0.12 against the arm's 0.08), recorded as hand positions only, and tracked in pixels with 3 mm of error */
const demo0 = BL.demo;
BL.demo = function (body, theta, seed) {
  const d = demo0(body, theta, seed);
  if (body.labelNoise) { const r = BN.rng(seed * 7 + 3); for (let i = 0; i < d.P.length; i++) d.P[i] += body.labelNoise * BN.randn(r); }
  return d;
};
const GAPS = [0.001, 0.003, 0.01, 0.03];                                    // relative error of the simulator's link lengths (0.5(1+g), 0.5(1-g))
BL.bodies.video = { name: 'footage of a person', L1: 0.5, L2: 0.5, gain: 0.85, rgain: 0.85, lag: 0, noise: 0.12, labelNoise: 0.003 };
GAPS.forEach((g) => { BL.bodies['sim' + g] = { name: 'simulator, links off by ' + (g * 100) + ' %', L1: 0.5 * (1 + g), L2: 0.5 * (1 - g), gain: 0.85 }; });
const SOURCES = [
  { key: 'twin', body: 'twin', space: 'hand', name: 'an arm of the same make, labelled in task space' },
  { key: 'old', body: 'old', space: 'hand', name: 'an older arm from another laboratory, labelled in task space' },
  { key: 'video', body: 'video', space: 'hand', name: 'footage of a person, hand tracked in pixels' },
].concat(GAPS.map((g) => ({ key: 'sim' + g, body: 'sim' + g, space: 'joint', gap: g, name: 'a simulator whose arm model is off by ' + (g * 100) + ' %, joint angles as labels' })),
  [{ key: 'simH0.03', body: 'sim0.03', space: 'hand', gap: 0.03, name: 'the same simulator, off by 3 %, with hand positions as labels' }]);
const BASE = [8, 32], M = [0, 4, 8, 16, 32, 64, 128, 256];

function curveWith(space) {
  const own = BL.file('A'), c = { N: BL.GRID.slice(), s: [], lo: [], hi: [] };
  BL.GRID.forEach((n) => { const r = BL.run(own.slice(0, n), [], 0, space); c.s.push(r.succ); c.lo.push(r.ci[0]); c.hi.push(r.ci[1]); });
  return c;
}
function layouts() {
  const out = { N: BL.GRID.slice(), ownHand: curveWith('hand'), ownJoint: curveWith('joint'), base: BASE, M: M, src: {} };
  const cur = { hand: out.ownHand, joint: out.ownJoint };
  SOURCES.forEach((S) => {
    const o = { name: S.name, space: S.space, gap: S.gap === undefined ? null : S.gap, s: {}, lo: {}, hi: {}, kept: {}, rho: {} };
    BASE.forEach((na) => {
      o.s[na] = []; o.lo[na] = []; o.hi[na] = []; o.kept[na] = []; o.rho[na] = [];
      M.forEach((m) => {
        const r = BL.setting({ na: na, body: S.body, m: m, w: 1, space: S.space });
        o.s[na].push(r.succ); o.lo[na].push(r.ci[0]); o.hi[na].push(r.ci[1]); o.kept[na].push(r.kept);
        o.rho[na].push(m > 0 ? (BL.equivalentOwn(cur[S.space], r.succ) - na) / m : null);
      });
    });
    out.src[S.key] = o;
  });
  return out;
}

/* ───────────────────────── recover ───────────────────────── */
const NREC = [1, 2, 3, 5, 10, 20, 40, 80];
function demoCurve(kind) {                                             // the first n demonstrations of one stream, recorded under the gust of `kind`, nested in n
  const g = DL.GUSTS[kind], wA = DL.WA, rng = BN.rng(1), nw = new BN.NW(DL.H), c = { n: NREC, frames: [], s: [], lo: [], hi: [], crashed: [] };
  let done = 0, frames = 0, crashed = 0;
  NREC.forEach((n) => {
    while (done < n) { const ro = BN.rollout(wA, BN.expertPolicy(wA), rng, { noise: g, jit: DL.JIT }); for (let t = 0; t < ro.A.length; t++) nw.add(ro.S[t], ro.A[t]); frames += ro.A.length; done++; if (ro.coll) crashed++; }
    const ev = BN.evaluate(wA, () => (q) => DL.predict(nw, q), DL.NEVAL, DL.SEED, { noise: DL.GUST, jit: DL.JIT });
    c.frames.push(frames); c.s.push(ev.succ); c.lo.push(ev.ci[0]); c.hi.push(ev.ci[1]); c.crashed.push(crashed);
  });
  return c;
}
function recover() {
  const out = { n: NREC, calm: demoCurve('calm'), g05: demoCurve('g05'), g10: demoCurve('g10') };
  const s = DL.session('prog', 0, 'latest', DL.DEFAULT_SEED), K = 6, k = { rounds: [], frames: [], labelled: [], rollouts: [], s: [], lo: [], hi: [] };
  for (let r = 0; r <= K; r++) { const e = DL.evaluate(s, r); k.rounds.push(r); k.frames.push(e.frames); k.labelled.push(e.labelled); k.rollouts.push(e.rollouts); k.s.push(e.succ); k.lo.push(e.ci[0]); k.hi.push(e.ci[1]); }
  out.corr = k;
  return out;
}

/* ───────────────────────── contact ───────────────────────── */
const MC = [1, 2, 3, 5, 10, 20, 40];
function contact() {
  const W = INS.world(1.0), out = { m: MC, clearance: 1.0, withForce: { s: [], lo: [], hi: [], frames: [] }, noForce: { s: [], lo: [], hi: [] } };
  MC.forEach((m) => {
    const rolls = INS.demos(W, m, 23);
    [[true, out.withForce], [false, out.noForce]].forEach(([wf, o]) => {
      const fr = INS.frames(rolls, wf), cl = INS.clone(fr, wf), ev = INS.evaluate(W, () => cl, 200, 5);
      o.s.push(ev.succ); o.lo.push(ev.ci[0]); o.hi.push(ev.ci[1]); if (wf) o.frames.push(fr.X.length);
    });
  });
  const st = INS.evaluate(W, () => INS.stiff(), 200, 5), yi = INS.evaluate(W, () => INS.yielding(), 200, 5);
  out.stiff = { s: st.succ, lo: st.ci[0], hi: st.ci[1] }; out.yielding = { s: yi.succ, lo: yi.ci[0], hi: yi.ci[1], timeToInsert: yi.time };
  out.secPerAttempt = round(yi.attempt, 2);
  return out;
}

/* ───────────────────────── assemble ───────────────────────── */
function compact(x) {                                                   // round floats to 4 digits for the file
  if (Array.isArray(x)) return x.map(compact);
  if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach((k) => { o[k] = compact(x[k]); }); return o; }
  return typeof x === 'number' && isFinite(x) && !Number.isInteger(x) ? round(x, 4) : x;
}
function build() {
  return { unit: { secPerDemo: SEC_PER_DEMO, demosPerHour: round(HOUR / SEC_PER_DEMO, 1) }, layouts: layouts(), recover: recover(), contact: contact() };
}
const BEGIN = '/*TABLE:BEGIN*/', END = '/*TABLE:END*/';
function writeTable(tab) {
  const src = fs.readFileSync(LEDGER, 'utf8'), a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < 0) throw new Error('ledger.js has no TABLE markers');
  try { const old = require(LEDGER).TABLE; if (old && old.relevance && !tab.relevance) tab.relevance = old.relevance; } catch (e) { /* first build */ }   // lesson 4's block is merged by merge_relevance.js and survives a rebuild
  const json = JSON.stringify(compact(tab));
  fs.writeFileSync(LEDGER, src.slice(0, a + BEGIN.length) + '\nLG.TABLE = ' + json + ';\n' + src.slice(b));
}
function check() {                                                       // live recomputation of sample cells against the stored table
  const LG = require(LEDGER), T = LG.TABLE, bad = [];
  const eq = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) bad.push(what + ': table ' + b + ', live ' + a); };
  const L = layouts(), R = recover(), C = contact();
  ['twin', 'old', 'video', 'sim0.01'].forEach((k) => { [8, 32].forEach((na) => { [3, 5, 7].forEach((i) => { eq(L.src[k].s[na][i], T.layouts.src[k].s[na][i], 6e-5, 'layouts ' + k + ' ' + na + ' ' + M[i]); }); }); });
  [0, 5, 13].forEach((i) => eq(L.ownHand.s[i], T.layouts.ownHand.s[i], 6e-5, 'own hand ' + i));
  [2, 5, 7].forEach((i) => { eq(R.calm.s[i], T.recover.calm.s[i], 6e-5, 'calm ' + i); eq(R.g10.s[i], T.recover.g10.s[i], 6e-5, 'g10 ' + i); });
  [0, 3, 6].forEach((i) => eq(R.corr.s[i], T.recover.corr.s[i], 6e-5, 'corr ' + i));
  [0, 3, 6].forEach((i) => { eq(C.withForce.s[i], T.contact.withForce.s[i], 6e-5, 'with force ' + i); eq(C.noForce.s[i], T.contact.noForce.s[i], 6e-5, 'no force ' + i); });
  if (bad.length) { console.log('LEDGER CHECK FAILED\n' + bad.join('\n')); process.exit(1); }
  console.log('ledger check: sample cells agree with the stored table');
}
if (CHECK) check();
else { const t0 = Date.now(), tab = build(); writeTable(tab); console.log('table written to ' + path.relative(ROOT, LEDGER) + ' in ' + (Date.now() - t0) + ' ms'); }
