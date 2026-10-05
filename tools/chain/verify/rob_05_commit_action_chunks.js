#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 05 (Commit: action chunks).
 * Re-derives every number the lesson quotes with code written separately from chunk_lab.js: its own plant and rollout loop, its own kernel store (frames
 * sorted by the first joint angle, a window of the sorted array scanned, no grid hashing), its own plans, route draw, executor, statistics, finite-difference
 * Jacobian and a numeric root finder for the drift budget.  Only the world's primitives (arm, expert, collision, path, horizon) come from bench.js.
 * Then it asserts the claims of the prose, repeats the key comparisons on more courses and on other data sets, and drives the page's widget into every
 * state the prose quotes.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};

/* ───── the plant and the rollout ───── */
const BW = 0.02, DT = 0.05, JIT = 0.01, VMAX = 1.5, MAXH = 40, GUST = 0.05, N = 200, RSEED = 5, PSEED = 11;
const clip = (v) => Math.max(-VMAX, Math.min(VMAX, v));
function plantStep(q, u, noise, gain, rng) {            // realised velocity = gain * clipped command + gust; the gust is drawn for joint 0, then joint 1
  const c0 = clip(u[0]) * gain, c1 = clip(u[1]) * gain, n0 = noise ? noise * BN.randn(rng) : 0, n1 = noise ? noise * BN.randn(rng) : 0;
  q[0] += DT * (c0 + n0); q[1] += DT * (c1 + n1);
}
function rollout(w, policy, rng, plant) {               // plant: {noise, gain, nojit}
  const T = BN.slalom.horizon(w), xe = BN.slalom.xEnd(w), dy = plant.nojit ? 0 : JIT * BN.randn(rng), q = BN.slalom.startQ(w, dy).slice(), P = [], S = [];
  let coll = false, done = false, steps = T;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); P.push(p); S.push(q.slice());
    if (BN.slalom.collide(w, p)) { coll = true; steps = t; break; }
    if (p[0] > xe - 0.02) { done = true; steps = t; break; }
    plantStep(q, policy(q, t), plant.noise || 0, plant.gain === undefined ? 1 : plant.gain, rng);
  }
  return { P, S, coll, done, steps };
}
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };

/* ───── the data: two operators, each with calm demonstrations and four rounds of DAgger; a stored frame is a state and a route ───── */
class Store {                                           // the operator's own clone (kernel mean of commands), used to roll out the DAgger rounds
  constructor() { this.q0 = []; this.q1 = []; this.y0 = []; this.y1 = []; this.sorted = false; }
  add(q, y) { this.q0.push(q[0]); this.q1.push(q[1]); this.y0.push(y[0]); this.y1.push(y[1]); this.sorted = false; }
  prep() {
    if (this.sorted) return;
    const n = this.q0.length, idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => this.q0[a] - this.q0[b]);
    this.s0 = Float64Array.from(idx.map((i) => this.q0[i])); this.s1 = Float64Array.from(idx.map((i) => this.q1[i])); this.sy0 = Float64Array.from(idx.map((i) => this.y0[i])); this.sy1 = Float64Array.from(idx.map((i) => this.y1[i]));
    this.sorted = true;
  }
  lower(x) { let lo = 0, hi = this.s0.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.s0[m] < x) lo = m + 1; else hi = m; } return lo; }
  mean(q) {
    this.prep(); let sw = 0, a0 = 0, a1 = 0;
    for (let i = this.lower(q[0] - 3 * BW); i < this.s0.length && this.s0[i] <= q[0] + 3 * BW; i++) {
      const dx = (this.s0[i] - q[0]) / BW, dy = (this.s1[i] - q[1]) / BW, e = dx * dx + dy * dy;
      if (e <= 9) { const wgt = Math.exp(-0.5 * e); sw += wgt; a0 += wgt * this.sy0[i]; a1 += wgt * this.sy1[i]; }
    }
    if (sw >= 1e-12) return [a0 / sw, a1 / sw];
    let best = Infinity, bi = 0;
    for (let i = 0; i < this.s0.length; i++) { const dx = (this.s0[i] - q[0]) / BW, dy = (this.s1[i] - q[1]) / BW, e = dx * dx + dy * dy; if (e < best) { best = e; bi = i; } }
    return [this.sy0[bi], this.sy1[bi]];
  }
}
function operatorFrames(w, seed) {                      // 20 calm demonstrations, then 4 rounds of 5 rollouts of the operator's own clone under the gust, every visited state labelled by the operator
  const rng = BN.rng(seed), st = new Store(), X = [];
  for (let k = 0; k < 20; k++) {
    const r = rollout(w, (q) => BN.slalom.expertAct(w, q), rng, { noise: 0 });
    for (let t = 0; t < r.steps; t++) { st.add(r.S[t], BN.slalom.expertAct(w, r.S[t])); X.push(r.S[t]); }
  }
  for (let round = 0; round < 4; round++) {
    const batch = [];
    for (let j = 0; j < 5; j++) { const r = rollout(w, (q) => st.mean(q), rng, { noise: GUST }); for (const s of r.S) batch.push(s); }
    for (const s of batch) { st.add(s, BN.slalom.expertAct(w, s)); X.push(s); }
  }
  return X;
}
function expertPlan(w, q0, len) {                       // the operator's next len commands from q0 on a perfect plant
  const q = q0.slice(), out = [];
  for (let k = 0; k < len; k++) { const u = BN.slalom.expertAct(w, q); out.push(u); q[0] += DT * u[0]; q[1] += DT * u[1]; }
  return out;
}
class TwoRoutes {
  constructor(n, seeds) {
    this.n = n; this.w = BN.slalom.world(n); this.wr = [BN.slalom.world(n, { s0: 1 }), BN.slalom.world(n, { s0: -1 })];
    const XA = operatorFrames(this.wr[0], seeds[0]), XB = operatorFrames(this.wr[1], seeds[1]);
    this.nA = XA.length; this.nB = XB.length; this.N = XA.length + XB.length;
    const X = XA.concat(XB), route = XA.map(() => 0).concat(XB.map(() => 1));
    const order = Array.from({ length: this.N }, (_, i) => i).sort((a, b) => X[a][0] - X[b][0]);
    this.orig = Int32Array.from(order); this.q0 = Float64Array.from(order.map((i) => X[i][0])); this.q1 = Float64Array.from(order.map((i) => X[i][1])); this.route = Uint8Array.from(order.map((i) => route[i]));
    this.plans = new Array(this.N).fill(null);
  }
  lower(x) { let lo = 0, hi = this.N; while (lo < hi) { const m = (lo + hi) >> 1; if (this.q0[m] < x) lo = m + 1; else hi = m; } return lo; }
  reach(q) {                                            // frames within three bandwidths with their kernel weights, and the mass of each route
    const ids = [], ws = [], m = [0, 0];
    for (let i = this.lower(q[0] - 3 * BW); i < this.N && this.q0[i] <= q[0] + 3 * BW; i++) {
      const dx = (this.q0[i] - q[0]) / BW, dy = (this.q1[i] - q[1]) / BW, e = dx * dx + dy * dy;
      if (e <= 9) { const wgt = Math.exp(-0.5 * e); ids.push(i); ws.push(wgt); m[this.route[i]] += wgt; }
    }
    return { ids, ws, m };
  }
  planOf(i, len) {
    const want = len > 1 ? MAXH : 1;
    if (!this.plans[i] || this.plans[i].length < want) this.plans[i] = expertPlan(this.wr[this.route[i]], [this.q0[i], this.q1[i]], want);
    return this.plans[i];
  }
  nearest(q, r) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < this.N; i++) { if (r !== undefined && this.route[i] !== r) continue; const dx = (this.q0[i] - q[0]) / BW, dy = (this.q1[i] - q[1]) / BW, e = dx * dx + dy * dy; if (e < best) { best = e; bi = i; } }
    return bi;
  }
  meanPlan(R, r, len) {                                 // kernel-weighted mean, over the frames of route r in reach, of their first len commands
    const sx = new Array(len).fill(0), sy = new Array(len).fill(0); let tw = 0;
    for (let j = 0; j < R.ids.length; j++) {
      const i = R.ids[j]; if (this.route[i] !== r) continue;
      const pl = this.planOf(i, len); tw += R.ws[j];
      for (let k = 0; k < len; k++) { sx[k] += R.ws[j] * pl[k][0]; sy[k] += R.ws[j] * pl[k][1]; }
    }
    if (tw < 1e-12) return null;
    return sx.map((x, k) => [x / tw, sy[k] / tw]);
  }
}
const pseed = (base, k) => BN.rng(base * 100003 + 7919 * k + 1);
const probB = (m, tau) => { if (tau === 0) return m[1] > m[0] ? 1 : 0; const e = 1 / (tau || 1), a = Math.pow(m[0], e), b = Math.pow(m[1], e); return b / (a + b); };

/* ───── the policies.  kinds: route (draw the route, play its mean plan), copy (play one stored frame's plan), hold (route held, command re-read every step), ens (temporal ensembling) ───── */
function makePolicy(D, spec, k) {
  const len = spec.H, kind = spec.kind || 'route', rng = pseed(spec.seed || PSEED, k), hist = [], drift = [], disp = [];
  let buf = [], start = null, route = -1, age = 0; const chunks = [];
  const drawPlan = (q, copy) => {
    const R = D.reach(q);
    if (R.m[0] + R.m[1] < 1e-12) { const i = D.nearest(q); return { route: D.route[i], seq: D.planOf(i, len).slice(0, len) }; }
    if (copy) {                                          // one stored frame in proportion to its weight, the frames taken in storage order
      const ord = R.ids.map((i, j) => [i, R.ws[j]]).sort((a, b) => D.orig[a[0]] - D.orig[b[0]]);
      let u = rng() * (R.m[0] + R.m[1]), j = 0; while (j < ord.length - 1 && u > ord[j][1]) { u -= ord[j][1]; j++; }
      const i = ord[j][0]; return { route: D.route[i], seq: D.planOf(i, len).slice(0, len) };
    }
    const r = rng() < probB(R.m, spec.tau) ? 1 : 0, seq = D.meanPlan(R, r, len);
    if (!seq) { const i = D.nearest(q); return { route: D.route[i], seq: D.planOf(i, len).slice(0, len) }; }
    return { route: r, seq };
  };
  const f = (q, t) => {
    if (kind === 'hold') {
      const R = D.reach(q);
      if (route < 0 || age >= len) { route = (R.m[0] + R.m[1] < 1e-12) ? D.route[D.nearest(q)] : (rng() < probB(R.m) ? 1 : 0); age = 0; hist.push([t, route]); }
      age++;
      const seq = D.meanPlan(R, route, 1); return seq ? seq[0] : D.planOf(D.nearest(q, route), 1)[0];
    }
    if (kind === 'ens') {
      const d = drawPlan(q, false); hist.push([t, d.route]); chunks.push({ t0: t, seq: d.seq });
      while (chunks.length && t - chunks[0].t0 >= len) chunks.shift();
      let a0 = 0, a1 = 0, tw = 0;
      chunks.forEach((c, i) => { const wi = Math.exp(-0.01 * i), u = c.seq[t - c.t0]; a0 += wi * u[0]; a1 += wi * u[1]; tw += wi; });
      return [a0 / tw, a1 / tw];
    }
    if (buf.length === 0) {
      if (start) { const pi = BN.arm.fk([start.q[0] + DT * start.s[0], start.q[1] + DT * start.s[1]]), pa = BN.arm.fk(q); drift.push(Math.hypot(pa[0] - pi[0], pa[1] - pi[1])); }
      const d = drawPlan(q, kind === 'copy'); hist.push([t, d.route]); buf = d.seq.map((u) => u.slice());
      let sx = 0, sy = 0; for (const u of buf) { sx += u[0]; sy += u[1]; }
      const p0 = BN.arm.fk(q), p1 = BN.arm.fk([q[0] + DT * sx, q[1] + DT * sy]); disp.push(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
      start = { q: q.slice(), s: [sx, sy] };
    }
    return buf.shift();
  };
  f.hist = hist; f.drift = drift; f.disp = disp; return f;
}
function evaluate(D, spec, plant, n, seed) {
  const rng = BN.rng(seed === undefined ? RSEED : seed), post1 = D.w.posts[0];
  const o = { N: n, ok: 0, coll: 0, chg: 0, dec: 0, d2: 0, dn: 0, disp: 0, dispn: 0, above: 0, below: 0 };
  for (let k = 0; k < n; k++) {
    const pol = makePolicy(D, spec, k), ro = rollout(D.w, pol, rng, plant);
    if (ro.done) o.ok++; if (ro.coll) o.coll++;
    let c = 0; for (let i = 1; i < pol.hist.length; i++) if (pol.hist[i][1] !== pol.hist[i - 1][1]) c++;
    o.chg += c; o.dec += pol.hist.length; for (const d of pol.drift) { o.d2 += d * d; o.dn++; } for (const d of pol.disp) { o.disp += d; o.dispn++; }
    let j = 0; while (j < ro.P.length - 1 && ro.P[j][0] < post1[0]) j++;
    if (ro.P[j][1] > post1[1]) o.above++; else o.below++;
  }
  o.succ = o.ok / n * 100; o.collp = o.coll / n * 100; o.changes = o.chg / n; o.decisions = o.dec / n; o.drift = o.dn ? Math.sqrt(o.d2 / o.dn) * 100 : NaN; o.displ = o.dispn ? o.disp / o.dispn * 100 : NaN;
  o.ci = wilson(o.ok, n).map((x) => x * 100);
  return o;
}
const cache = new Map();
function ev(D, spec, plant, n, seed) {
  const key = [D.tag, spec.kind || 'route', spec.H, spec.tau === undefined ? '' : spec.tau, plant.noise || 0, plant.gain === undefined ? 1 : plant.gain, n === undefined ? N : n, seed === undefined ? RSEED : seed].join('|');
  if (!cache.has(key)) cache.set(key, evaluate(D, Object.assign({ seed: PSEED }, spec), plant, n === undefined ? N : n, seed));
  return cache.get(key);
}

/* ───── what the course leaves: forks, room, geometry ───── */
const R0 = new TwoRoutes(5, [1, 2]); R0.tag = 'main';
const clean = (w) => rollout(w, (q) => BN.slalom.expertAct(w, q), BN.rng(1), { noise: 0, nojit: true });
function forkWindows(D) {                               // along each operator's own clean route: runs of steps in which the kernel puts 5 to 95 % of its mass on route B
  const runs = [];
  for (let r = 0; r < 2; r++) {
    const ro = clean(D.wr[r]); let run = 0;
    ro.S.forEach((q) => { const R = D.reach(q), p = R.m[0] + R.m[1] > 0 ? R.m[1] / (R.m[0] + R.m[1]) : 0; if (p >= 0.05 && p <= 0.95) run++; else { if (run) runs.push(run); run = 0; } });
    if (run) runs.push(run);
  }
  return runs;
}
function roomAndGeometry(D) {
  let dmin = Infinity, j2 = 0, ns = 0, len = 0, nl = 0; const E = 1e-6;
  for (const w of D.wr) {
    const ro = clean(w);
    for (const c of w.posts) for (const p of ro.P) dmin = Math.min(dmin, Math.hypot(p[0] - c[0], p[1] - c[1]));
    for (const q of ro.S) {                              // the Jacobian by central differences of the forward kinematics
      const a = BN.arm.fk([q[0] + E, q[1]]), b = BN.arm.fk([q[0] - E, q[1]]), c = BN.arm.fk([q[0], q[1] + E]), d = BN.arm.fk([q[0], q[1] - E]);
      j2 += ((a[0] - b[0]) / (2 * E)) ** 2 + ((a[1] - b[1]) / (2 * E)) ** 2 + ((c[0] - d[0]) / (2 * E)) ** 2 + ((c[1] - d[1]) / (2 * E)) ** 2; ns++;
    }
    for (let t = 0; t + 1 < ro.P.length; t++) { len += Math.hypot(ro.P[t + 1][0] - ro.P[t][0], ro.P[t + 1][1] - ro.P[t][1]); nl++; }
  }
  return { clear: dmin, room: dmin - (BN.slalom.W.postR + BN.slalom.W.grip), c: Math.sqrt(j2 / ns), l: len / nl };
}
const GEO = roomAndGeometry(R0);
const lawDrift = (sigma, gain, H) => Math.sqrt((GEO.c * sigma * DT) ** 2 * H + ((1 - gain) * GEO.l) ** 2 * H * H);     // rms drift of an H-step plan (m)
function budget(sigma, gain) {                          // the H at which the systematic drift plus two standard deviations of the random drift use up the room, by bisection
  const f = (H) => (1 - gain) * GEO.l * H + 2 * GEO.c * sigma * DT * Math.sqrt(H) - GEO.room;
  if (f(1e6) < 0) return Infinity;
  let lo = 0, hi = 1e6; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/* ───── facts: the setting ───── */
F.nA = R0.nA; F.nB = R0.nB; F.frames = R0.N; F.T = BN.slalom.horizon(R0.w); F.posts = 5;
const wins = forkWindows(R0);
F.win_n = wins.length; F.win_mean = wins.reduce((a, b) => a + b, 0) / wins.length; F.win_min = Math.min(...wins); F.win_max = Math.max(...wins);
F.clear_cm = GEO.clear * 100; F.room_cm = GEO.room * 100; F.touch_cm = (BN.slalom.W.postR + BN.slalom.W.grip) * 100;
F.c_jac = GEO.c; F.l_step = GEO.l * 100; F.unit_cm = GEO.c * GUST * DT * 100;          // c, cup displacement per step, the cup's random step per root step at the default gust
F.speed_step = BN.slalom.W.speed * DT * 100;
F.unit2_cm = 2 * GEO.c * GUST * DT * 100;                                                   // twice that: the denominator of the drift budget at the default gust
{ const q0 = BN.slalom.startQ(R0.w, 0), r = R0.reach(q0), pB = r.m[1] / (r.m[0] + r.m[1]); F.mixA = (1 - pB) * 100; F.mixB = pB * 100; F.mixB_t05 = probB(r.m, 0.5) * 100; F.mixB_t025 = probB(r.m, 0.25) * 100; F.mixB_t01 = probB(r.m, 0.1) * 100; }

/* ───── facts: the entry ───── */
const plain = ev(R0, { kind: 'copy', H: 1 }, { noise: GUST }), head1 = ev(R0, { kind: 'route', H: 1 }, { noise: GUST });
F.plain_coll = plain.collp; F.plain_succ = plain.succ; F.head1_coll = head1.collp; F.head1_succ = head1.succ; F.head1_chg = head1.changes; F.head1_dec = head1.decisions; F.head1_drift = head1.drift;
const sets = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16]], setPlain = [], setHead = [];
sets.forEach((s, i) => { const D = i === 0 ? R0 : Object.assign(new TwoRoutes(5, s), { tag: 'set' + i }); setPlain.push(ev(D, { kind: 'copy', H: 1 }, { noise: GUST }).collp); setHead.push(ev(D, { kind: 'route', H: 1 }, { noise: GUST }).collp); });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
F.sets_n = sets.length; F.sets_plain_lo = Math.min(...setPlain); F.sets_plain_hi = Math.max(...setPlain); F.sets_plain_mean = mean(setPlain); F.sets_head_lo = Math.min(...setHead); F.sets_head_hi = Math.max(...setHead); F.sets_head_mean = mean(setHead);
const nodrift0 = ev(R0, { kind: 'route', H: 1 }, { noise: 0 }), holdAll0 = ev(R0, { kind: 'hold', H: 1000 }, { noise: 0 }), holdAll = ev(R0, { kind: 'hold', H: 1000 }, { noise: GUST });
F.g0_succ1 = nodrift0.succ; F.g0_fail1 = 100 - nodrift0.succ; F.g0_holdall_fail = 100 - holdAll0.succ; F.g0_chg1 = nodrift0.changes;

/* ───── facts: the alternatives (gust 0.05, 200 courses) ───── */
const ALT = {
  head1: [{ kind: 'route', H: 1 }], plain: [{ kind: 'copy', H: 1 }], t05: [{ kind: 'route', H: 1, tau: 0.5 }], t025: [{ kind: 'route', H: 1, tau: 0.25 }], t01: [{ kind: 'route', H: 1, tau: 0.1 }], argmax: [{ kind: 'route', H: 1, tau: 0 }],
  holdall: [{ kind: 'hold', H: 1000 }], hold40: [{ kind: 'hold', H: 40 }], hold12: [{ kind: 'hold', H: 12 }], hold4: [{ kind: 'hold', H: 4 }],
  ens4: [{ kind: 'ens', H: 4 }], ens12: [{ kind: 'ens', H: 12 }], ens24: [{ kind: 'ens', H: 24 }], copy4: [{ kind: 'copy', H: 4 }], copy12: [{ kind: 'copy', H: 12 }], copy24: [{ kind: 'copy', H: 24 }], route12: [{ kind: 'route', H: 12 }],
};
for (const [k, [spec]] of Object.entries(ALT)) { const r = ev(R0, spec, { noise: GUST }); F['alt_' + k + '_s'] = r.succ; F['alt_' + k + '_a'] = r.above; F['alt_' + k + '_b'] = r.below; }

/* ───── facts: the plan a draw plays; a copied plan against the route's mean plan ───── */
{
  const planEnd = (q, seq) => { let a = q[0], b = q[1]; for (const u of seq) { a += DT * u[0]; b += DT * u[1]; } return BN.arm.fk([a, b]); };
  const PH = [1, 4, 8, 12, 24, 40], se = {}; PH.forEach((H) => { se[H] = { c: 0, m: 0 }; }); let n = 0;
  const rng = BN.rng(RSEED), sr = BN.rng(77);
  for (let k = 0; k < 40; k++) {
    const pol = makePolicy(R0, { kind: 'route', H: 12, seed: PSEED }, k), ro = rollout(R0.w, pol, rng, { noise: GUST });
    for (let t = 0; t < ro.S.length; t += 6) {
      const q = ro.S[t], Rr = R0.reach(q); if (Rr.m[0] + Rr.m[1] < 1e-12) continue;
      const r = Rr.m[1] / (Rr.m[0] + Rr.m[1]) > 0.5 ? 1 : 0;
      if (Rr.m[r] / (Rr.m[0] + Rr.m[1]) < 0.9) continue;                                   // away from the forks
      const ids = [], ws = []; let tot = 0; Rr.ids.forEach((i, j) => { if (R0.route[i] === r) { ids.push(i); ws.push(Rr.ws[j]); tot += Rr.ws[j]; } });
      let u = sr() * tot, j = 0; while (j < ids.length - 1 && u > ws[j]) { u -= ws[j]; j++; }
      const one = ids[j]; n++;
      for (const H of PH) {
        const ideal = planEnd(q, expertPlan(R0.wr[r], q, H)), pm = planEnd(q, R0.meanPlan(Rr, r, H)), pc = planEnd(q, R0.planOf(one, H).slice(0, H));
        se[H].m += (pm[0] - ideal[0]) ** 2 + (pm[1] - ideal[1]) ** 2; se[H].c += (pc[0] - ideal[0]) ** 2 + (pc[1] - ideal[1]) ** 2;
      }
    }
  }
  F.pe_n = n; PH.forEach((H) => { F['pe_copy_' + H] = Math.sqrt(se[H].c / n) * 100; F['pe_mean_' + H] = Math.sqrt(se[H].m / n) * 100; });
}

/* ───── facts: inside a fork window, how often is the route drawn and how fast does the cup move sideways ───── */
function visits(spec, plant, n) {
  const rng = BN.rng(RSEED), lens = [], lat = [], draws = []; let nv = 0;
  for (let k = 0; k < n; k++) {
    const pol = makePolicy(R0, spec, k), ro = rollout(R0.w, pol, rng, plant);
    const p = ro.S.map((q) => { const r = R0.reach(q); return (r.m[0] + r.m[1]) > 0 ? r.m[1] / (r.m[0] + r.m[1]) : 0; }), decT = pol.hist.map((h) => h[0]);
    let run = 0, from = 0;
    const close = (end) => { if (run) { nv++; lens.push(run); lat.push(Math.abs(ro.P[Math.min(end, ro.P.length - 1)][1] - ro.P[from][1]) * 100 / run); draws.push(decT.filter((t) => t >= from && t < from + run).length); } run = 0; };
    for (let t = 0; t < p.length; t++) { if (p[t] >= 0.05 && p[t] <= 0.95) { if (!run) from = t; run++; } else close(t); }
    close(p.length - 1);
  }
  return { perCourse: nv / n, len: mean(lens), lat: mean(lat), draws: mean(draws) };
}
for (const H of [1, 4, 8, 12, 24]) { const v = visits({ kind: 'route', H, seed: PSEED }, { noise: GUST }, N); F['vd_' + H] = v.draws; if (H === 1) { F.vis_per_course = v.perCourse; F.vis_len = v.len; } }
for (const H of [1, 12]) { const v = visits({ kind: 'route', H, seed: PSEED }, { noise: 0 }, N); F['lat0_' + H] = v.lat; }

/* ───── facts: the sweeps ───── */
const HS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40];
const PLANTS = { p0: [0, 1], p5: [GUST, 1], p8: [0.08, 1], g95: [GUST, 0.95], g85: [GUST, 0.85], z85: [0, 0.85] };
const sweep = {};
for (const [name, [g, gain]] of Object.entries(PLANTS)) {
  sweep[name] = HS.map((H) => ev(R0, { kind: 'route', H }, { noise: g, gain }));
  HS.forEach((H, i) => { F['sw_' + name + '_' + H] = sweep[name][i].succ; });
  if (isFinite(budget(g, gain))) F['hb_' + name] = budget(g, gain);
}
HS.forEach((H, i) => { const r = sweep.p5[i]; F['chg_' + H] = r.changes; F['dec_' + H] = r.decisions; F['drift_' + H] = r.drift; F['disp_' + H] = r.displ; F['law_' + H] = lawDrift(GUST, 1, H) * 100; F['succ_' + H] = r.succ; F['coll_' + H] = r.collp; });
F.sw_p5_ci_lo_1 = sweep.p5[0].ci[0]; F.sw_p5_ci_hi_1 = sweep.p5[0].ci[1];
F.z85_drift_12 = sweep.z85[HS.indexOf(12)].drift; F.z85_law_12 = lawDrift(0, 0.85, 12) * 100; F.z85_drift_20 = sweep.z85[HS.indexOf(20)].drift; F.z85_law_20 = lawDrift(0, 0.85, 20) * 100;
F.g95_drift_12 = sweep.g95[HS.indexOf(12)].drift; F.g95_law_12 = lawDrift(GUST, 0.95, 12) * 100;
F.p8_drift_8 = sweep.p8[HS.indexOf(8)].drift; F.p8_law_8 = lawDrift(0.08, 1, 8) * 100;
F.gain_miss_20 = 0.15 * GEO.l * 20 * 100;                  // a 15 % short gain over a 20-step plan, in cm
F.disp20 = F.disp_20;

/* ───── facts: the same shapes on 600 courses ───── */
const N6 = 600, BIG = { p5: [1, 4, 8, 12, 20, 40], p0: [1, 12, 40], p8: [1, 4, 8, 12, 20, 40], g95: [1, 4, 8, 12, 20, 40], g85: [1, 4, 6, 12, 20], z85: [1, 12, 16, 20] }, big = {};
for (const [name, [g, gain]] of Object.entries(PLANTS)) { big[name] = {}; BIG[name].forEach((H) => { big[name][H] = ev(R0, { kind: 'route', H }, { noise: g, gain }, N6).succ; }); }
F.big_n = N6; F.big_p5_1 = big.p5[1]; F.big_p5_8 = big.p5[8]; F.big_p5_12 = big.p5[12]; F.big_p5_40 = big.p5[40]; F.big_p0_40 = big.p0[40]; F.big_p0_1 = big.p0[1]; F.big_z85_12 = big.z85[12]; F.big_z85_20 = big.z85[20];
F.big_p5_best = Math.max(...BIG.p5.map((H) => big.p5[H])); F.big_copy12 = ev(R0, { kind: 'copy', H: 12 }, { noise: GUST }, N6).succ; F.big_ens12 = ev(R0, { kind: 'ens', H: 12 }, { noise: GUST }, N6).succ;
F.big_head1_coll = 100 - big.p5[1];
F.p0_min10 = Math.min(...HS.filter((H) => H >= 10).map((H) => F['sw_p0_' + H])); F.p8_gain = F.sw_p8_8 - F.sw_p8_1;

/* ───── the checkpoint: arithmetic on the numbers it states ───── */
{
  const c = 0.81, l = 0.74, room = 1.55, sg = 0.03, dt = 0.05;                              // c in m/rad, l and room in cm
  F.ck_c = c; F.ck_l = l; F.ck_room = room; F.ck_sigma = sg;
  F.ck_step = c * sg * dt * 100;                                                           // cm per root step
  F.ck_a = c * sg * dt * 100 * 4;                                                          // rms drift of a 16-step plan
  F.ck_b = Math.pow(room / (2 * c * sg * dt * 100), 2);
  const a = 2 * c * sg * dt * 100, b = 0.03 * l, x = (-a + Math.sqrt(a * a + 4 * b * room)) / (2 * b); F.ck_c3 = x * x;
  F.ck_sys = 0.03 * l * 16;                                                                // systematic drift of a 16-step plan with a 3 % gain error
}

/* ───── claims of the prose, asserted ───── */
check(F.nA > 5000 && F.nB > 5000 && F.T === 235, 'both operators have thousands of frames and the course allows 235 steps');
check(F.plain_coll > 20 && F.plain_coll < 40, 'the plain sampler ends in a post in a quarter to a third of the courses (' + F.plain_coll + ')');
check(F.sets_plain_lo > 18 && F.sets_plain_hi < 45 && F.sets_plain_mean > 26 && F.sets_plain_mean < 35, 'over eight data sets the plain sampler ends in a post in about three courses in ten on average (' + F.sets_plain_lo + '-' + F.sets_plain_hi + ')');
check(F.head1_coll > 12 && F.head1_coll < 28 && F.head1_coll < F.plain_coll, 'the two-route head drawn every step ends in a post in a fifth of the courses and less often than the plain sampler (' + F.head1_coll + ')');
check(F.sets_head_mean < F.sets_plain_mean - 5 && F.sets_head_mean > 17 && F.sets_head_mean < 26, 'the two-route head ends in a post in about a fifth of the courses on average and beats the plain sampler by more than five points (' + F.sets_head_mean + ' vs ' + F.sets_plain_mean + ')');
check(F.head1_chg > 11 && F.head1_chg < 15, 'drawn every step, the route changes 11-15 times per course (' + F.head1_chg + ')');
check(F.win_n === 10 && F.win_min >= 3 && F.win_max <= 12 && F.win_mean > 6 && F.win_mean < 9, 'ten fork windows of 3-12 steps, mean 6-9 (' + F.win_mean + ')');
check(F.vis_len > 6 && F.vis_len < 10 && F.vis_per_course > 4 && F.vis_per_course < 6, 'a rollout visits about five forks of about eight steps (' + F.vis_per_course + ', ' + F.vis_len + ')');
check(F.vd_1 > 7 && F.vd_1 < 9 && F.vd_4 > 1.6 && F.vd_4 < 2.4 && F.vd_12 < 1 && F.vd_24 < F.vd_12 + 0.2, 'draws per fork visit: about eight at H = 1, two at 4, under one at 12');
check(F.lat0_12 > 1.8 * F.lat0_1, 'with no gust the cup crosses a fork about twice as fast when the route is drawn every 12 steps (' + F.lat0_1 + ' vs ' + F.lat0_12 + ')');
check(Math.abs(F.clear_cm - 6.55) < 0.01 && Math.abs(F.room_cm - 1.55) < 0.01 && F.touch_cm === 5, 'the expert passes a post at 6.55 cm, 1.55 cm clear of a touch (' + F.clear_cm + ', ' + F.room_cm + ')');
check(F.g0_fail1 > 7 && F.g0_fail1 < 14 && F.g0_holdall_fail < 2, 'with no gust, drawing every step still fails 7-14 % of the courses and holding the route fails under 2 % (' + F.g0_fail1 + ', ' + F.g0_holdall_fail + ')');
check(Math.abs(F.mixA + F.mixB - 100) < 1e-9 && F.mixB > 30 && F.mixB < 45 && F.mixB_t025 < 0.4 * F.mixB && F.mixB_t01 < 2, 'a sharpened draw squeezes the minority route (' + F.mixB + ' -> ' + F.mixB_t025 + ' -> ' + F.mixB_t01 + ')');
check(F.alt_argmax_a > 150 && F.alt_t01_a > 150 && F.alt_t025_a > F.alt_route12_a + 3 && F.alt_route12_a < 125 && F.alt_route12_a > 100, 'sharpening the draw changes which route is taken: argmax goes above the first post in ' + F.alt_argmax_a + ' of 200, the route head in ' + F.alt_route12_a);
check(F.alt_argmax_s > 90 && F.alt_t025_s > 90 && F.alt_holdall_s > 90, 'sharpening and holding the route with the loop closed both succeed above 90 % (' + F.alt_argmax_s + ', ' + F.alt_t025_s + ', ' + F.alt_holdall_s + ')');
check(F.alt_route12_s > F.alt_head1_s + 8 && F.alt_route12_s > 90, 'a 12-step route plan beats drawing every step by 8 points and succeeds above 90 % (' + F.alt_route12_s + ' vs ' + F.alt_head1_s + ')');
check(F.alt_copy12_s < F.alt_head1_s - 10 && F.alt_copy4_s < F.alt_head1_s - 5 && F.alt_copy24_s < F.alt_head1_s - 10, 'copying one stored plan does worse than drawing every step at every chunk length (' + F.alt_copy4_s + ', ' + F.alt_copy12_s + ', ' + F.alt_copy24_s + ')');
check(F.alt_ens12_s < 25 && F.alt_ens4_s < 55 && F.alt_ens24_s < 55, 'averaging overlapping plans is far worse than the single draw (' + F.alt_ens4_s + ', ' + F.alt_ens12_s + ', ' + F.alt_ens24_s + ')');
check(F.alt_plain_s < F.alt_head1_s && F.alt_hold12_s < F.alt_route12_s && F.alt_hold12_s > F.alt_head1_s, 'plain < route head at H = 1; held route at 12 sits between');
check(F.pe_n >= 800 && F.pe_copy_12 > 2 * F.pe_mean_12 && F.pe_copy_4 > 1.5 * F.pe_mean_4 && F.pe_copy_40 > 2 * F.pe_mean_40, 'a copied plan misses the operator\'s own plan by more than twice the route mean plan (' + F.pe_copy_12 + ' vs ' + F.pe_mean_12 + ')');
check(F.succ_12 > F.succ_1 + 8, 'a 12-step chunk beats the per-step draw by at least 8 points (' + F.succ_12 + ' vs ' + F.succ_1 + ')');
check(F.succ_40 < F.succ_1 + 3 && F.succ_40 < F.succ_12 - 12, 'a 40-step chunk has given the gain back (' + F.succ_40 + ')');
check(F.big_p5_12 > F.big_p5_1 + 10 && F.big_p5_40 < F.big_p5_12 - 12 && F.big_p5_40 < F.big_p5_1 + 3 && F.big_p5_best > 91, 'the same on 800 courses (' + F.big_p5_1 + ', ' + F.big_p5_12 + ', ' + F.big_p5_40 + ')');
check(F.chg_12 < 1.2 && F.chg_1 / F.chg_12 > 10 && F.dec_1 / F.dec_12 > 9, 'route changes fall from about 13 to under 1.2 and draws from about 170 to about 15 (' + F.chg_1 + ' -> ' + F.chg_12 + ', ' + F.dec_1 + ' -> ' + F.dec_12 + ')');
check(F.chg_8 < 1.8 && F.chg_4 > 2 && F.chg_4 < 3.5, 'route changes per course at H = 4 and 8');
check(F.sw_p0_12 >= 97 && F.sw_p0_40 >= 97 && F.sw_p0_20 >= 97 && F.sw_p0_1 < 95 && F.big_p0_40 >= 98 && F.big_p0_1 < 92 && F.p0_min10 >= 99, 'with no gust the curve rises and stays up: no right slope (' + F.sw_p0_12 + ', ' + F.sw_p0_40 + ')');
for (const H of [1, 4, 12, 40]) check(Math.abs(F['law_' + H] - F['drift_' + H]) / F['drift_' + H] < 0.12, 'the drift law sqrt(H) c sigma dt matches the measured rms drift at H = ' + H + ' within 12 % (' + F['law_' + H] + ' vs ' + F['drift_' + H] + ')');
check(Math.abs(F.z85_law_12 - F.z85_drift_12) / F.z85_drift_12 < 0.15 && Math.abs(F.z85_law_20 - F.z85_drift_20) / F.z85_drift_20 < 0.15, 'with no gust a 15 % short gain drifts as (1 - g) l H (' + F.z85_law_12 + ' vs ' + F.z85_drift_12 + '; ' + F.z85_law_20 + ' vs ' + F.z85_drift_20 + ')');
check(Math.abs(F.g95_law_12 - F.g95_drift_12) / F.g95_drift_12 < 0.15 && Math.abs(F.p8_law_8 - F.p8_drift_8) / F.p8_drift_8 < 0.15, 'the combined law matches at gain 0.95 and gust 0.08');
check(F.drift_40 > 5 * F.drift_1 && F.drift_40 < 7.5 * F.drift_1, 'rms drift grows as the square root of H: 40 steps drift about 6 times as far as 1 (' + F.drift_40 / F.drift_1 + ')');
check(Math.abs(F.l_step - F.speed_step) < 0.05 * F.speed_step, 'the cup moves close to 15 cm/s along the route (' + F.l_step + ' vs ' + F.speed_step + ' cm per step)');
check(F.z85_drift_20 > 1.3 * F.room_cm && F.z85_drift_12 < F.room_cm && F.gain_miss_20 > F.room_cm, 'with a gain of 0.85 a 20-step plan drifts past the room and a 12-step plan does not (' + F.z85_drift_12 + ', ' + F.z85_drift_20 + ')');
check(F.sw_z85_12 >= 95 && F.sw_z85_20 <= 5 && F.big_z85_12 >= 94 && F.big_z85_20 <= 2, 'with no gust and a gain of 0.85 success is above 95 % at 12 steps and under 5 % at 20 (' + F.sw_z85_12 + ', ' + F.sw_z85_20 + ')');
for (const [name] of Object.entries(PLANTS)) {
  const hb = F['hb_' + name];
  if (!isFinite(hb)) continue;
  let best = -1, hbest = 1; BIG[name].forEach((H) => { if (big[name][H] > best) { best = big[name][H]; hbest = H; } });
  check(hbest >= hb / 2 && hbest <= 2 * hb, name + ': the best chunk length on ' + N6 + ' courses (' + hbest + ') lies within a factor of two of the budget (' + hb.toFixed(1) + ')');
  const far = BIG[name].filter((H) => H >= 3 * hb); if (far.length) check(big[name][Math.min(...far)] <= best - 5, name + ': at three budgets (H = ' + Math.min(...far) + ') success is at least 5 points under the best (' + big[name][Math.min(...far)] + ' vs ' + best + ')');
  const hmax = Math.max(...BIG[name]); if (hmax >= 2.5 * hb) check(big[name][hmax] <= best - 15, name + ': at H = ' + hmax + ' success is at least 15 points under the best (' + big[name][hmax] + ' vs ' + best + ')');
}
check(F.hb_p5 > 13 && F.hb_p5 < 16 && F.hb_p8 > 5 && F.hb_p8 < 6.5 && F.hb_g95 > 8 && F.hb_g95 < 10 && F.hb_g85 > 4.5 && F.hb_g85 < 6 && F.hb_z85 > 13 && F.hb_z85 < 15, 'the budgets are about 15, 6, 9, 5 and 14 steps');
check(F.hb_p5 > F.win_mean && F.hb_p8 < F.win_mean && F.hb_g85 < F.win_mean && F.hb_g95 > F.win_mean, 'the budget is longer than the fork window at the default plant and shorter at gust 0.08 and gain 0.85');
check(Math.abs(F.ck_a - 0.49) < 0.005 && Math.abs(F.ck_b - 40.7) < 0.1 && Math.abs(F.ck_c3 - 20.4) < 0.1, 'checkpoint arithmetic (' + F.ck_a + ', ' + F.ck_b + ', ' + F.ck_c3 + ')');
check(Math.abs(F.c_jac - 0.81) < 0.005 && Math.abs(F.l_step - 0.74) < 0.005 && Math.abs(F.room_cm - 1.55) < 0.005, 'the checkpoint quotes c = 0.81, l = 0.74 and the room 1.55 as the Bench has them');
F.sw_tau = F.alt_t025_s;

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '05_commit_action_chunks.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const base = (kind, plant) => ev(R0, { kind, H: 1 }, plant);
  const probe = (kind, H, g, gain, tag) => {
    pg.set('w05-kind', kind); pg.set('w05-gust', g); pg.set('w05-gain', gain); pg.set('w05-H', H); pg.drain();
    const plant = { noise: g, gain }, r = ev(R0, { kind, H }, plant), b = base(kind, plant), hb = budget(g, gain);
    eqd('w05-succ', r.succ, 1, tag + ' success'); eqd('w05-coll', r.collp, 1, tag + ' collisions'); eqd('w05-chg', r.changes, 1, tag + ' route changes'); eqd('w05-dec', r.decisions, 0, tag + ' draws');
    eqd('w05-base', b.succ, 1, tag + ' success at H = 1'); eqd('w05-delta', r.succ - b.succ, 1, tag + ' gain over H = 1');
    const ci = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(pg.text('w05-ci')); if (!ci || Math.abs(+ci[1] - r.ci[0]) > 0.5 + 1e-9 || Math.abs(+ci[2] - r.ci[1]) > 0.5 + 1e-9) fail(`${tag} interval: widget prints "${pg.text('w05-ci')}", independent computation gives ${r.ci.map((x) => x.toFixed(2)).join(' to ')}`);
    if (kind === 'route' || kind === 'copy') eqd('w05-drift', r.drift, 2, tag + ' rms drift (cm)');
    if (isFinite(hb)) eqd('w05-bud', hb, 1, tag + ' budget'); else if (!isNaN(pg.num('w05-bud'))) fail(tag + ': with no drift the budget should print no number (prints "' + pg.text('w05-bud') + '")');
  };
  probe('route', 1, 0.05, 1, 'default');
  probe('route', 12, 0.05, 1, 'H = 12'); probe('route', 40, 0.05, 1, 'H = 40'); probe('route', 8, 0.05, 1, 'H = 8'); probe('route', 4, 0.05, 1, 'H = 4');
  probe('route', 12, 0, 1, 'gust 0, H = 12'); probe('route', 40, 0, 1, 'gust 0, H = 40');
  probe('route', 8, 0.08, 1, 'gust 0.08, H = 8');
  probe('route', 8, 0.05, 0.95, 'gain 0.95, H = 8'); probe('route', 40, 0.05, 0.95, 'gain 0.95, H = 40');
  probe('route', 6, 0.05, 0.85, 'gain 0.85, H = 6'); probe('route', 20, 0.05, 0.85, 'gain 0.85, H = 20');
  probe('route', 12, 0, 0.85, 'gust 0, gain 0.85, H = 12'); probe('route', 20, 0, 0.85, 'gust 0, gain 0.85, H = 20');
  probe('copy', 12, 0.05, 1, 'copied plan, H = 12'); probe('ens', 12, 0.05, 1, 'ensemble, H = 12'); probe('hold', 12, 0.05, 1, 'held route, H = 12'); probe('hold', 40, 0.05, 1, 'held route, H = 40');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
