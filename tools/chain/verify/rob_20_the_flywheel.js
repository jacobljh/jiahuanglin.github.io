#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 20 (was lesson 05 of the old data series: add 15 to the lesson numbers in comments below) (the flywheel: a fleet as a source).
 * Re-derives every number the lesson quotes with code written separately from fleet_lab.js: its own kernel regressor (a hash grid with plain loops), its own rollout loop around the
 * Bench's plant (a forward state machine for the person, a forward scan for the stray that ends in a post), its own lineage and evaluation, its own fit of the learning curve, its own
 * arithmetic of the ledger line, a day-by-day and an attempt-by-attempt simulation of the fleet (expected values, and a seeded Monte Carlo) next to the page's generation loop, and its own
 * versions of the alternatives (labelling everything, a distance rule for the supervisor, demonstrations under a gust).  Only the world's primitives (arm, expert, posts, plant, collision)
 * come from bench.js and the prices (assumptions) from ledger.js, whose arithmetic is repeated here.  The four lineages of the shipped table are measured again here in four worker
 * processes and compared with the table row by row.  Then the page's widget is driven through the states the prose describes and what it prints is compared with the independent numbers.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const LG = require(path.join(root, dir, 'ledger.js'));

/* ───── the Bench's fleet, written out independently ───── */
const GUST = 0.05, JIT = 0.01, H = 0.02, REACT = 6, TOL = 0.025, BACK = 0.01, DT = 0.05, NEV = 1000, EVSEED = 5, GEN = 10, NGEN = 40;
const W = BN.slalom.world(5, { s0: 1 }), HOR = BN.slalom.horizon(W), XE = BN.slalom.xEnd(W);
class Store {
  constructor() { this.X = []; this.Y = []; this.cell = new Map(); }
  add(q, a) { const id = this.X.length; this.X.push(q); this.Y.push(a); const k = Math.floor(q[0] / (3 * H)) * 4096 + Math.floor(q[1] / (3 * H)); let l = this.cell.get(k); if (!l) this.cell.set(k, (l = [])); l.push(id); }
  predict(q) {
    const c0 = Math.floor(q[0] / (3 * H)), c1 = Math.floor(q[1] / (3 * H)); let tot = 0, o0 = 0, o1 = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.cell.get((c0 + i) * 4096 + c1 + j); if (!l) continue;
      for (const id of l) { const x = this.X[id], z0 = (x[0] - q[0]) / H, z1 = (x[1] - q[1]) / H, e = z0 * z0 + z1 * z1; if (e > 9) continue; const w = Math.exp(-0.5 * e); tot += w; o0 += w * this.Y[id][0]; o1 += w * this.Y[id][1]; }
    }
    if (tot < 1e-12) { let b = -1, bd = Infinity; for (let id = 0; id < this.X.length; id++) { const x = this.X[id], z0 = (x[0] - q[0]) / H, z1 = (x[1] - q[1]) / H, e = z0 * z0 + z1 * z1; if (e < bd) { bd = e; b = id; } } return this.Y[b].slice(); }
    return [o0 / tot, o1 / tot];
  }
}
const demoStore = () => { const s = new Store(); for (const ro of BN.demos(W, 20, BN.rng(1), { noise: 0, jit: JIT })) for (let t = 0; t < ro.A.length; t++) s.add(ro.S[t], ro.A[t]); return s; };
/* one run from a random stream: `policy` answers q; `calls` are the steps at which a person is called (reaction, then driving with the expert's command until the cup is within BACK of the path) */
function roll(store, rng, calls) {
  const pl = BN.plant({ noise: GUST }); pl.reset(BN.slalom.startQ(W, JIT * BN.randn(rng)));
  const dev = [], driven = [], spans = []; let coll = false, done = false, steps = HOR, phase = 0, cnt = 0, next = 0, span = 0;
  for (let t = 0; t < HOR; t++) {
    const q = [pl.q[0], pl.q[1]], p = BN.arm.fk(q, W.body), d = BN.slalom.dev(W, p); dev.push(d);
    if (BN.slalom.collide(W, p)) { coll = true; steps = t; break; }
    if (p[0] > XE - 0.02) { done = true; steps = t; break; }
    if (phase === 0 && next < calls.length && t >= calls[next]) { phase = 1; cnt = 0; span = 0; next++; }
    if (phase === 1) { cnt++; span++; if (cnt > REACT) phase = 2; }
    if (phase === 2 && d < BACK) { phase = 0; spans.push(span); }
    let u;
    if (phase === 2) { span++; u = BN.slalom.expertAct(W, q); driven.push([q, u]); } else u = store.predict(q);
    pl.step(u, rng);
  }
  if (phase !== 0) spans.push(span);
  return { coll, done, steps, dev, driven, spans };
}
/* the stray that ended in a post: scanning forward, the last time the cup was within BACK of the path before the end, and the first step above TOL after it */
function strayOf(dev, steps) {
  let low = 0, from = -1;
  for (let t = 0; t < Math.min(steps, dev.length); t++) if (dev[t] < BACK) low = t;
  for (let t = low; t < dev.length; t++) if (dev[t] > TOL) { from = t; break; }
  return from;
}
function attempt(store, seed) {
  let calls = [];
  for (let pass = 0; ; pass++) {
    const r = roll(store, BN.rng(seed), calls);
    if (!r.coll) return { calls, r, late: false };
    const s = strayOf(r.dev, r.steps);
    if (s < 0 || calls.includes(s) || r.steps - s <= REACT || pass >= 8) return { calls, r, late: true };
    calls = calls.concat([s]);
  }
}
function score(store, N, seed) { const rng = BN.rng(seed); let ok = 0; for (let k = 0; k < N; k++) if (roll(store, rng, []).done) ok++; return ok / N; }
function lineage(L, NG) {
  const store = demoStore(), out = []; let seed = 1000000 * (L + 1), n = 0;
  for (let g = 0; g <= NG; g++) {
    const row = { n, s: score(store, NEV, EVSEED), att: 0, fail: 0, late: 0, take: 0, frames: 0, steps: 0 };
    if (g < NG) {
      const add = [];
      while (row.fail < GEN) {
        const a = attempt(store, ++seed); row.att++;
        if (a.calls.length > 0 || a.late) row.fail++;
        if (a.late) row.late++;
        row.take += a.calls.length; row.frames += a.r.driven.length; for (const x of a.r.spans) row.steps += x;
        for (const f of a.r.driven) add.push(f);
      }
      for (const f of add) store.add(f[0], f[1]);
      n += row.fail;
    }
    out.push(row);
  }
  return out;
}

/* ───── harness ───── */
let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { if (!Number.isFinite(+v)) { fail('fact ' + k + ' is not a number: ' + v); return; } F[k] = +(+v).toFixed(6); };                       // facts keep six decimals whatever the page shows, so rounding the fact to the digits shown is exact
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const near = (a, b, tol, m) => check(Math.abs(a - b) <= tol, m + ' (' + a + ' vs ' + b + ')');

/* ───── more of the Bench, for the alternatives: states of a run, frames labelled by the expert, the policies the lesson compares ───── */
function rollStates(store, rng) {                                  // an unassisted run with the states it visited
  const pl = BN.plant({ noise: GUST }); pl.reset(BN.slalom.startQ(W, JIT * BN.randn(rng)));
  const S = [], dev = []; let coll = false, done = false;
  for (let t = 0; t < HOR; t++) {
    const q = [pl.q[0], pl.q[1]], p = BN.arm.fk(q, W.body); S.push(q); dev.push(BN.slalom.dev(W, p));
    if (BN.slalom.collide(W, p)) { coll = true; break; }
    if (p[0] > XE - 0.02) { done = true; break; }
    pl.step(store.predict(q), rng);
  }
  return { S, dev, coll, done };
}
const labelled = (S) => S.map((q) => [q, BN.slalom.expertAct(W, q)]);
function lineageStore(L, NG) {                                     // the clone after NG generations of lineage L
  const store = demoStore(); let seed = 1000000 * (L + 1);
  for (let g = 0; g < NG; g++) {
    let fails = 0; const add = [];
    while (fails < GEN) { const a = attempt(store, ++seed); if (a.calls.length > 0 || a.late) fails++; for (const f of a.r.driven) add.push(f); }
    for (const f of add) store.add(f[0], f[1]);
  }
  return store;
}
const cloneOf = (base, frames) => { const s = new Store(); for (let i = 0; i < base.X.length; i++) s.add(base.X[i], base.Y[i]); for (const f of frames) s.add(f[0], f[1]); return s; };
/* `count` labelled frames from a clone, by where they come from: takeovers on failing attempts, every frame of successful runs, every frame of failing runs, every frame of every run */
function gather(kind, store, count, seed0) {
  const out = []; let att = 0, seed = seed0;
  while (out.length < count && att < 200000) {
    seed++; att++;
    if (kind === 'take') { for (const f of attempt(store, seed).r.driven) out.push(f); continue; }
    const r = rollStates(store, BN.rng(seed));
    if (kind === 'all' || (kind === 'succ' && r.done) || (kind === 'failrun' && r.coll)) for (const f of labelled(r.S)) out.push(f);
  }
  return { frames: out.slice(0, count), att };
}

/* a supervisor with a rule instead of foresight: the person is called when the cup is more than theta from the path (after it was last within BACK), takes REACT steps to arrive and drives until the cup is
 * within BACK of the path.  Returns what the person does in one run: takeovers, steps at the controls (reaction plus driving) and the outcome. */
function rollRule(policy, rng, theta) {
  const pl = BN.plant({ noise: GUST }); pl.reset(BN.slalom.startQ(W, JIT * BN.randn(rng)));
  let phase = 0, cnt = 0, take = 0, steps = 0, coll = false, done = false;
  for (let t = 0; t < HOR; t++) {
    const q = [pl.q[0], pl.q[1]], p = BN.arm.fk(q, W.body), d = BN.slalom.dev(W, p);
    if (BN.slalom.collide(W, p)) { coll = true; break; }
    if (p[0] > XE - 0.02) { done = true; break; }
    if (phase === 0 && d > theta) { phase = 1; cnt = 0; take++; }
    if (phase === 1) { cnt++; steps++; if (cnt > REACT) phase = 2; }
    if (phase === 2 && d < BACK) phase = 0;
    let u;
    if (phase === 2) { steps++; u = BN.slalom.expertAct(W, q); } else u = policy === 'expert' ? BN.slalom.expertAct(W, q) : policy.predict(q);
    pl.step(u, rng);
  }
  return { take, steps, coll, done };
}
function ruleStats(policy, theta, N, seed) {
  const rng = BN.rng(seed); let take = 0, steps = 0, ok = 0;
  for (let k = 0; k < N; k++) { const r = rollRule(policy, rng, theta); take += r.take; steps += r.steps; if (r.done) ok++; }
  return { take: take / N, secs: DT * steps / N, ok: ok / N };
}
const frameValue = (store, count, draws, kinds) => {
  const s0 = score(store, NEV, EVSEED), res = { s0 };
  for (const kind of kinds) { res[kind] = []; for (let d = 0; d < draws; d++) res[kind].push(100 * (score(cloneOf(store, gather(kind, store, count, 9000000 + 1000 * d).frames), NEV, EVSEED) - s0)); }
  return res;
};
if (process.argv[2] === '--lineage') { process.stdout.write(JSON.stringify(lineage(+process.argv[3], +process.argv[4])) + '\n'); process.exit(0); }
if (process.argv[2] === '--frames') {
  const c1 = demoStore(), c6 = lineageStore(0, 5);
  process.stdout.write(JSON.stringify({ c1: frameValue(c1, 400, 8, ['take', 'succ', 'failrun', 'all']), c6: frameValue(c6, 400, 4, ['take', 'succ']) }) + '\n'); process.exit(0);
}
if (process.argv[2] === '--cross') {
  const c1 = demoStore(), c11 = lineageStore(0, 10), out = {};
  for (const [name, pol] of [['expert', 'expert'], ['c1', c1], ['c11', c11]]) {
    out[name] = {};
    for (const th of [0.025, 0.04]) out[name][th] = ruleStats(pol, th, 1000, 77);
    if (pol !== 'expert') out[name].fail = 1 - score(pol, NEV, EVSEED);
  }
  process.stdout.write(JSON.stringify(out) + '\n'); process.exit(0);
}

(async () => {
  /* ───── 1 · the shipped table against four lineages measured here ───── */
  const FL = require(path.join(root, dir, 'fleet_lab.js'));
  const TAB = FL.TABLE.lin;
  const CACHE = process.env.DAT05_CACHE;                          // development only: reuse the workers' output from an earlier run
  const worker = (args) => new Promise((res, rej) => {
    const f = CACHE ? path.join(CACHE, 'w_' + args.join('_') + '.json') : null;
    if (f && fs.existsSync(f)) { res(JSON.parse(fs.readFileSync(f, 'utf8'))); return; }
    const c = cp.spawn(process.execPath, [__filename, ...args]); let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => { try { const j = JSON.parse(out); if (f) fs.writeFileSync(f, out); res(j); } catch (e) { rej(new Error('worker ' + args.join(' ') + ' failed: ' + out.slice(0, 200))); } });
  });
  const [l0, l1, l2, l3, FR, CR] = await Promise.all([...[0, 1, 2, 3].map((L) => worker(['--lineage', String(L), String(NGEN)])), worker(['--frames']), worker(['--cross'])]);
  const lin = [l0, l1, l2, l3];
  let diff = 0;
  lin.forEach((rows, L) => rows.forEach((r, g) => { for (const k of ['n', 's', 'att', 'fail', 'late', 'take', 'frames', 'steps']) if (r[k] !== TAB[L][g][k]) { if (diff++ < 5) fail(`lineage ${L} generation ${g}: ${k} is ${r[k]} here and ${TAB[L][g][k]} in the shipped table`); } }));
  check(diff === 0, 'the four lineages measured here equal the shipped table in every field of every row');
  const G = lin[0].length;
  check(G === NGEN + 1 && lin.every((r) => r.length === G), 'each lineage has ' + (NGEN + 1) + ' rows');
  const gridN = lin[0].map((r) => r.n);
  check(lin.every((rows) => rows.every((r, g) => r.n === GEN * g)), 'every generation closes after exactly ten failing attempts, so n = 10 g in every lineage');
  const pg = gridN.map((_, g) => 1 - mean(lin.map((rows) => rows[g].s)));            // the pooled failure share
  check(FL.P.p.every((p, g) => Math.abs(p - pg[g]) < 1e-12), 'the engine pools the table as this oracle does');
  const mkCurve = (arr) => {                                                    // geometric interpolation of a failure share on the grid n = 0, 10, ... 400, and its inverse by bisection
    const pA = (n) => { const x = Math.max(0, Math.min(400, n)), i = Math.min(39, Math.floor(x / GEN)), f = (x - i * GEN) / GEN; return Math.exp(Math.log(arr[i]) * (1 - f) + Math.log(arr[i + 1]) * f); };
    const nA = (p) => { if (p >= arr[0]) return 0; let lo = 0, hi = 100; for (let it = 0; it < 200; it++) { const m = (lo + hi) / 2; if (pA(m) > p) lo = m; else hi = m; } return (lo + hi) / 2; };
    return { pAt: pA, nAt: nA };
  };
  const CUR = mkCurve(pg), pAt = CUR.pAt, nAt = CUR.nAt;
  for (const n of [0, 3, 10, 17.5, 40, 99, 250, 400]) near(FL.p(n), pAt(n), 1e-12, 'FL.p(' + n + ')');
  for (const p of [0.3, 0.2063, 0.1, 0.04]) near(FL.nOf(p), nAt(p), 1e-6, 'FL.nOf(' + p + ')');

  /* the curve, as the lesson quotes it */
  for (const n of [0, 10, 20, 30, 40, 50, 80, 100, 160, 200, 320, 400]) put('p_' + n, 100 * pg[n / GEN], 2);
  for (const n of [0, 10, 20, 40, 80, 100, 160, 200, 320, 400]) { put('s_' + n, 100 * (1 - pg[n / GEN]), 1); put('apf_' + n, 1 / pg[n / GEN], 1); }
  const cumAtt = (n) => mean(lin.map((rows) => rows.slice(0, n / GEN).reduce((s, r) => s + r.att, 0)));       // attempts a lineage made to take over n failing attempts
  for (const n of [10, 20, 40, 100, 200, 400]) put('cum_' + n, cumAtt(n), 0);
  const sumInv = (n) => { let s = 0; for (let g = 0; g < n / GEN; g++) s += GEN / pAt(g * GEN); return s; };      // the supply law: attempts = failures / failure share, the policy fixed within a generation
  for (const n of [40, 100, 200]) { const rel = Math.abs(sumInv(n) - cumAtt(n)) / cumAtt(n); put('supply_dev_' + n, 100 * rel, 1); }
  check(Math.abs(sumInv(100) - cumAtt(100)) / cumAtt(100) < 0.15 && Math.abs(sumInv(40) - cumAtt(40)) / cumAtt(40) < 0.25, 'attempts used match failures / failure share (the supply law) within 15 % to n = 100');
  const totTake = lin.flat().reduce((s, r) => s + r.take, 0), totFail = lin.flat().reduce((s, r) => s + r.fail, 0), totLate = lin.flat().reduce((s, r) => s + r.late, 0);
  put('take_per_fail', totTake / totFail, 3); put('late_share', 100 * totLate / lin.flat().reduce((s, r) => s + r.att, 0), 2);
  const early = lin.flatMap((rows) => rows.slice(0, 10)), allr = lin.flatMap((rows) => rows.slice(0, 40));
  put('frames_per_take_early', early.reduce((s, r) => s + r.frames, 0) / early.reduce((s, r) => s + r.take, 0), 1);
  put('secs_per_take_early', DT * early.reduce((s, r) => s + r.steps, 0) / early.reduce((s, r) => s + r.take, 0), 2);
  put('frames_per_take_all', allr.reduce((s, r) => s + r.frames, 0) / allr.reduce((s, r) => s + r.take, 0), 1);
  put('secs_per_take_all', DT * allr.reduce((s, r) => s + r.steps, 0) / allr.reduce((s, r) => s + r.take, 0), 2);
  put('motion_secs_per_take_early', DT * early.reduce((s, r) => s + r.frames, 0) / early.reduce((s, r) => s + r.take, 0), 2);
  const framesTo = (n) => mean(lin.map((rows) => rows.slice(0, n / GEN).reduce((s, r) => s + r.frames, 0)));
  put('frames_100', framesTo(100), 0); put('frames_160', framesTo(160), 0);
  // the slope of the failure share on a log-log scale (a power of n), by least squares over n = 20 .. 400
  { const xs = [], ys = []; for (let n = 20; n <= 400; n += 10) { xs.push(Math.log(n)); ys.push(Math.log(pg[n / GEN])); }
    const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    put('slope_20_400', -sxy / sxx, 2); put('slope_r2', sxy * sxy / (sxx * syy), 3); }
  put('fall_per_10_first', 100 * (1 - pg[1] / pg[0]), 0);
  check(pg[1] < pg[0] && pg[2] < pg[1] && pg[3] < pg[2] && pg[4] < pg[3] && pg[10] < pg[5] && pg[20] < pg[10] && pg[40] < pg[20], 'the failure share falls along n at the grid points the lesson quotes');
  put('floor_320_400', 100 * mean(pg.slice(32, 41)), 2);

  /* ───── 2 · the ledger line of one attempt ───── */
  const AS = LG.assume, TASK = LG.UNIT.secPerDemo, PERH = 3600 / TASK, ARMH = AS.arm_cost / AS.arm_life_h;
  check(TASK === 9.3 && Math.abs(PERH - 387.0967741935) < 1e-9, 'an attempt is 9.3 s: 387.1 an hour');
  check(AS.wage_per_h === 40 && AS.arm_cost === 18000 && AS.arm_life_h === 4000 && AS.sup_duty === 0.5, 'the assumptions the lesson reads are the ledger\'s');
  near(LG.price('corr'), (AS.wage_per_h + ARMH) / AS.sup_duty, 1e-12, 'lesson 2\'s price of an hour of corrections');
  const led = (tau, duty, wage) => { duty = duty === undefined ? AS.sup_duty : duty; wage = wage === undefined ? AS.wage_per_h : wage; return { v: wage * TASK / 3600, r: ARMH / PERH, c: wage * tau / (3600 * duty), tau, duty }; };
  const pStar = (e) => Math.min(1, (e.v - e.r) / e.c);
  const E20 = led(20);
  put('v', E20.v, 4); put('r', E20.r, 4); put('vr', E20.v - E20.r, 4); put('c20', E20.c, 4); put('c_over_vr', E20.c / (E20.v - E20.r), 2); put('sec_cost', AS.wage_per_h / AS.sup_duty / 3600, 4);
  put('p_star', pStar(E20), 4); put('s_star', 100 * (1 - pStar(E20)), 1); put('tau_min', (E20.v - E20.r) * 3600 * AS.sup_duty / AS.wage_per_h, 2);
  const eFL = FL.econ(20); near(eFL.pStar, pStar(E20), 1e-12, 'FL.econ break-even'); near(eFL.c, E20.c, 1e-12, 'FL.econ takeover cost'); near(eFL.v, E20.v, 1e-12, 'FL.econ v'); near(eFL.r, E20.r, 1e-12, 'FL.econ r');
  put('perh', PERH, 1); put('arm_h', ARMH, 2); put('wage', AS.wage_per_h, 0); put('duty', AS.sup_duty, 2);
  // a robot-hour of a fleet whose policy fails a share p of its attempts
  const hour = (p, tau) => { const e = led(tau === undefined ? 20 : tau), crew = p * PERH * e.tau / (3600 * e.duty); return { fails: p * PERH, crew, sup: crew * AS.wage_per_h, work: PERH * e.v, net: PERH * (e.v - e.r - p * e.c) }; };
  for (const n of [0, 20, 100]) { const h = hour(pg[n / GEN]), k = 'h' + n + '_'; put(k + 'fails', h.fails, 1); put(k + 'crew', h.crew, 2); put(k + 'sup', h.sup, 1); put(k + 'work', h.work, 1); put(k + 'net', h.net, 1); }
  put('h0_net_fleet10', 10 * hour(pg[0]).net, 0); put('h0_crew_fleet10', 10 * hour(pg[0]).crew, 1);
  put('fixed_crew_cost', AS.wage_per_h, 0);                                       // one supervisor per robot at all times costs a wage per robot-hour
  put('crew_at_star', hour(pStar(E20)).crew, 2);
  // s* against the takeover seconds and the supervisor's utilisation
  for (const tau of [5, 10, 20, 40]) for (const duty of [0.25, 0.5, 1]) put('ss_' + tau + '_' + duty * 100, 100 * (1 - pStar(led(tau, duty))), 1);
  for (const tau of [1.5, 5, 10, 20, 40, 80]) put('sstar_tau_' + String(tau).replace('.', '_'), 100 * (1 - pStar(led(tau))), 1);
  check(Math.abs(pStar(led(10, 0.25)) - pStar(led(20, 0.5))) < 1e-12 && Math.abs(pStar(led(20, 1)) - pStar(led(10, 0.5))) < 1e-12, 'only tau / duty matters');
  check(pStar(led(1.5)) === 1 && pStar(led(4)) === 1 && pStar(led(5)) < 1, 'no break-even below tau = 4.13 s');
  put('sstar_c1_tau', 100 * (1 - pStar(led(10))), 1);

  /* ───── 3 · the fleet over generations: the page's loop, an attempt-level loop and a seeded Monte Carlo ───── */
  const HOURS = 8;
  /* attempt by attempt (a fraction of the last one): failures accumulate as the share p of the policy in force; at K x 10 failures the policy is retrained (n grows by ten) */
  function byAttempt(s0, Fn, tau, K, duty, cur) {
    const Q = cur || CUR, pAt = Q.pAt, nAt = Q.nAt, e = led(tau, duty), perDay = PERH * HOURS * Fn, want = K * GEN, ps = pStar(e); let n = nAt(1 - s0), fails = 0, att = 0, cash = 0;
    const res = { takeDay: null, deficit: null, d: {}, c: {} }, targets = { 90: 0.10, 98: 0.02, 99: 0.01 };
    if (e.v - e.r - pAt(n) * e.c > 0) { res.takeDay = 0; res.deficit = 0; }
    while (n < 400 && !res.d[99]) {
      const p = pAt(n), need = (want - fails) / p;                 // attempts still needed in this generation
      const take = Math.min(1, need);                              // one attempt, or what is left of it
      att += take; cash += take * (e.v - e.r - p * e.c); fails += take * p;
      if (need <= 1) {
        fails = 0; n += GEN; const pn = pAt(n);
        for (const k of Object.keys(targets)) if (!res.d[k] && pn <= targets[k]) { res.d[k] = att / perDay; res.c[k] = cash; }
        if (res.takeDay === null && e.v - e.r - pn * e.c > 0) { res.takeDay = att / perDay; res.deficit = Math.max(0, -cash); }
      }
    }
    return res;
  }
  const page = (s0, Fn, tau, K) => { const S = FL.sim({ s0, F: Fn, tau, K }), r = { 90: FL.reach(S, 0.9), 98: FL.reach(S, 0.98), 99: FL.reach(S, 0.99) }; return { S, r, takeDay: S.take === null ? null : S.rows[S.take].d0 }; };
  const DEF = { s0: 0.635, F: 10, tau: 20, K: 1000 };
  const PG = page(DEF.s0, DEF.F, DEF.tau, DEF.K), BA = byAttempt(DEF.s0, DEF.F, DEF.tau, DEF.K);
  const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
  check(rel(PG.S.deficit, BA.deficit) < 1e-3 && rel(PG.takeDay, BA.takeDay) < 1e-3, 'the page\'s generation loop and the attempt-level loop agree on the deficit and the take-off day (' + PG.S.deficit + ' vs ' + BA.deficit + ')');
  for (const k of [90, 98, 99]) { check(rel(PG.r[k].days, BA.d[k]) < 1e-3 && rel(PG.r[k].cash, BA.c[k]) < 1e-3, 'days and cash at ' + k + ' % agree between the two loops'); }
  const row = (tag, o) => { const g = page(o.s0, o.F, o.tau, o.K), b = byAttempt(o.s0, o.F, o.tau, o.K);
    check(rel(g.S.deficit, b.deficit) < 2e-3 || Math.abs(g.S.deficit - b.deficit) < 1e-6, tag + ': deficit agrees between the two loops (' + g.S.deficit + ' vs ' + b.deficit + ')');
    check(rel(g.r[90].days, b.d[90]) < 2e-3 && rel(g.r[98].days, b.d[98]) < 2e-3, tag + ': days agree between the two loops');
    put(tag + '_def', g.S.deficit, 4); put(tag + '_take', g.takeDay === null ? NaN : g.takeDay, 4); put(tag + '_d90', g.r[90].days, 4); put(tag + '_d98', g.r[98].days, 4); put(tag + '_d99', g.r[99].days, 4); put(tag + '_c90', g.r[90].cash, 2); put(tag + '_c98', g.r[98].cash, 2); put(tag + '_c99', g.r[99].cash, 2);
    put(tag + '_gen', g.S.take === null ? NaN : g.S.take, 0); return g; };
  const base = row('d', DEF);
  // the same fleet on the curve pooled from three of the four lineages: how much of the quoted numbers is the draw
  { const each = lin.map((_, out) => { const rest = lin.filter((__, i) => i !== out); return byAttempt(DEF.s0, DEF.F, DEF.tau, DEF.K, undefined, mkCurve(gridN.map((___, g) => 1 - mean(rest.map((rows) => rows[g].s))))); });      // leave one lineage out, pool the other three
    const rng = (f) => [Math.min(...each.map(f)), Math.max(...each.map(f))];
    const [dl, dh] = rng((b) => b.deficit), [al, ah] = rng((b) => b.d[98]), [bl, bh] = rng((b) => b.d[90]), [rl, rh] = rng((b) => (b.d[98] - b.d[90]) / b.d[90]), [tl, th] = rng((b) => b.takeDay);
    put('lin_def_lo', dl, 0); put('lin_def_hi', dh, 0); put('lin_d98_lo', al, 1); put('lin_d98_hi', ah, 1); put('lin_d90_lo', bl, 1); put('lin_d90_hi', bh, 1); put('lin_ratio_lo', rl, 1); put('lin_ratio_hi', rh, 1); put('lin_take_lo', tl, 1); put('lin_take_hi', th, 1);
    check(dl > 0 && dh < 4 * dl && al > 0, 'each lineage alone gives a deficit and finite days'); }

  put('d_s_take', 100 * (1 - base.S.rows[base.S.take].p), 1);                // success of the first policy that pays
  put('d_n_take', base.S.rows[base.S.take].n, 0);
  put('d_cpp', base.S.deficit / (100 * (1 - base.S.rows[base.S.take].p) - 100 * DEF.s0), 2);      // programme dollars per point gained before take-off
  put('d_pts', 100 * (1 - base.S.rows[base.S.take].p) - 100 * DEF.s0, 1);
  put('d_days_g0', base.S.rows[0].d1, 3); put('d_days_g1', base.S.rows[1].d1 - base.S.rows[1].d0, 3);
  put('d_att_g0', base.S.rows[0].att, 0); put('d_att_g1', base.S.rows[1].att, 0); put('d_per_day', base.S.perDay, 0);
  put('d_loss_g0', -base.S.rows[0].net, 0); put('d_loss_g1', -base.S.rows[1].net, 0);
  put('d_ratio_90_98', (base.r[98].days - base.r[90].days) / base.r[90].days, 1); put('d_ratio_90_99', (base.r[99].days - base.r[90].days) / base.r[90].days, 1);
  put('d_ratio_98_to_90', base.r[98].days / base.r[90].days, 1);
  // days per generation grow like 1 / p: the first, the take-off and the generation that gets the policy to 90 %
  put('d_gen_days_first', base.S.rows[0].d1 - base.S.rows[0].d0, 2); put('d_gen_days_90', base.S.rows[base.r[90].g].d1 - base.S.rows[base.r[90].g].d0, 2); put('d_gen_days_98', base.S.rows[base.r[98].g].d1 - base.S.rows[base.r[98].g].d0, 1);
  put('d_gen90', base.r[90].g + 1, 0); put('d_gen98', base.r[98].g + 1, 0); put('d_gen99', base.r[99].g + 1, 0);
  // the fleet's size changes the days and nothing else
  const f1 = row('f1', { ...DEF, F: 1 }), f100 = row('f100', { ...DEF, F: 100 });
  check(Math.abs(f1.S.deficit - base.S.deficit) < 1e-6 && Math.abs(f100.S.deficit - base.S.deficit) < 1e-6, 'the deficit does not depend on the number of robots');
  check(Math.abs(f1.r[98].cash - base.r[98].cash) < 1e-6 && Math.abs(f1.takeDay / base.takeDay - 10) < 1e-9, 'with a tenth of the robots every day count is ten times as long and every dollar is the same');
  put('f_ratio_days', f1.takeDay / base.takeDay, 1);
  // the task-size factor, the starting success, the price of a takeover
  const k1 = row('k1', { ...DEF, K: 1 }), k100 = row('k100', { ...DEF, K: 100 });
  check(Math.abs(k1.S.deficit * 1000 - base.S.deficit) < 1e-6 * base.S.deficit && Math.abs(k100.S.deficit * 10 - base.S.deficit) < 1e-6 * base.S.deficit, 'dollars and days scale with the task-size factor');
  for (const s of [0.70, 0.75, 0.80]) row('s' + Math.round(s * 100), { ...DEF, s0: s });
  for (const t of [10, 40, 80]) row('t' + t, { ...DEF, tau: t });
  check(F.s80_def === 0 && F.t10_def === 0, 'starting at 80 % or paying a takeover 10 s: no deficit');
  check(F.s70_def < F.d_def && F.s75_def < F.s70_def && F.t40_def > F.d_def && F.t80_def > F.t40_def, 'the deficit falls as the policy starts better and rises with the price of a takeover');
  put('t40_ratio', F.t40_def / F.d_def, 1); put('t40_gen', FL.sim({ ...DEF, tau: 40 }).take, 0);
  put('s0_default', 100 * DEF.s0, 1); put('s0_70', 70, 0);
  // the Monte Carlo (K = 100): failures are drawn, not averaged
  { const o = { ...DEF, K: 100 }, det = page(o.s0, o.F, o.tau, o.K), runs = [];
    const targets = { 90: 0.10, 98: 0.02, 99: 0.01 };
    for (let seed = 1; seed <= 12; seed++) {
      const rng = BN.rng(500 + seed), e = led(o.tau), perDay = PERH * HOURS * o.F; let n = nAt(1 - o.s0), fails = 0, att = 0, cash = 0; const res = {};
      while (n < 400 && !res[99]) {
        const p = pAt(n); att++; cash += e.v - e.r; if (rng() < p) { fails++; cash -= e.c; }
        if (fails >= o.K * GEN) { fails = 0; n += GEN; const pn = pAt(n); for (const k of Object.keys(targets)) if (!res[k] && pn <= targets[k]) res[k] = { days: att / perDay, cash }; }
      }
      runs.push(res);
    }
    for (const k of [90, 98, 99]) { const d = mean(runs.map((r) => r[k].days)), c = mean(runs.map((r) => r[k].cash));
      check(rel(d, det.r[k].days) < 0.04 && Math.abs(c - det.r[k].cash) < 0.06 * Math.max(Math.abs(det.r[k].cash), det.S.deficit), 'Monte Carlo (12 seeds, K = 100) matches the loop at ' + k + ' %: days ' + d.toFixed(2) + ' vs ' + det.r[k].days.toFixed(2) + ', cash ' + c.toFixed(0) + ' vs ' + det.r[k].cash.toFixed(0)); }
    put('mc_days_98', mean(runs.map((r) => r[98].days)), 2); }

  /* ───── 4 · the price of a point, from the fleet and from a dedicated round of corrections ───── */
  const REL = LG.TABLE.relevance, SET = 800 * DT / 3600 * LG.price('corr');                     // one set of 800 labelled frames at lesson 2's price of an hour of corrections
  put('set_price', SET, 3);
  const ded = [0, 1, 2, 3].map((i) => SET / REL.valueByGen[i]), pc4 = [0, 1, 2, 3].map((i) => 1 - REL.successByGen[i] / 100);
  const ptsPerFail = (n) => { const x = Math.min(399.999, n), i = Math.floor(x / GEN); return 100 * pAt(x) * Math.log(pg[i] / pg[i + 1]) / GEN; };
  const fleetPrice = (p, e) => { const n = nAt(p); return (p * e.c - (e.v - e.r)) / (p * ptsPerFail(n)); };       // net dollars a point costs at failure share p (n clamped at the first clone)
  pc4.forEach((p, i) => { put('ded_' + (i + 1), ded[i], 3); put('ded_p_' + (i + 1), 100 * p, 1); put('fleet_' + (i + 1), fleetPrice(p, E20), 3); put('ded_pts_' + (i + 1), REL.valueByGen[i], 1); });
  put('fleet_n_2', nAt(pc4[1]), 1); put('fleet_n_3', nAt(pc4[2]), 1);
  check(F.fleet_1 > F.ded_1 && F.fleet_2 < F.ded_2 && F.fleet_3 < 0 && F.fleet_4 < 0 && F.ded_3 > F.ded_2 && F.ded_4 > F.ded_3, 'a dedicated round is the cheaper point at the first clone, the fleet from the second, and above the break-even the fleet is paid');
  put('ded_ratio_1', F.fleet_1 / F.ded_1, 1); put('ded_ratio_4_1', F.ded_4 / F.ded_1, 0);
  put('fleet_gross_frame', E20.c / (F.frames_per_take_early), 4); put('ledger_frame', LG.price('corr') * DT / 3600, 5); put('gross_ratio', F.fleet_gross_frame / F.ledger_frame, 0);
  // demonstrations recorded under the gust instead (the ledger's table of recover)
  { const R = LG.TABLE.recover, own = LG.price('own') / LG.demos(1), ix = R.g05.n.indexOf(10), i80 = R.g05.n.indexOf(80), c20 = R.calm.n.indexOf(20);
    put('g05_10_s', 100 * R.g05.s[ix], 1); put('g05_10_cost', own * 10, 2); put('g05_80_s', 100 * R.g05.s[i80], 1); put('g05_80_cost', own * 80, 2); put('calm_20_s', 100 * R.calm.s[c20], 1);
    put('g05_10_cpp', own * 10 / (100 * (R.g05.s[ix] - R.calm.s[c20])), 2); put('g05_80_cpp', own * 80 / (100 * (R.g05.s[i80] - R.calm.s[c20])), 2); put('g05_max', 100 * Math.max(...R.g05.s), 1); put('demo_price', own, 4);
    put('calm_max', 100 * Math.max(...R.calm.s), 1); }
  // labelling every frame of every run: the person's seconds per attempt
  put('label_all_cost', TASK * AS.wage_per_h / (3600 * AS.sup_duty), 4); put('label_all_ratio', F.label_all_cost / E20.v, 2); put('label_all_vs_net', F.label_all_cost / (E20.v - E20.r), 2);
  { const g = (a) => mean(a), sp = (a) => [Math.min(...a), Math.max(...a)];
    put('fv_take_c1', g(FR.c1.take), 1); put('fv_succ_c1', g(FR.c1.succ), 1); put('fv_fail_c1', g(FR.c1.failrun), 1); put('fv_all_c1', g(FR.c1.all), 1);
    put('fv_take_c1_lo', sp(FR.c1.take)[0], 1); put('fv_take_c1_hi', sp(FR.c1.take)[1], 1); put('fv_succ_c1_lo', sp(FR.c1.succ)[0], 1); put('fv_succ_c1_hi', sp(FR.c1.succ)[1], 1);
    put('fv_take_c6', g(FR.c6.take), 1); put('fv_succ_c6', g(FR.c6.succ), 1); put('fv_s0_c6', 100 * FR.c6.s0, 1); put('fv_s0_c1', 100 * FR.c1.s0, 1);
    put('fv_ratio_c1', F.fv_take_c1 / F.fv_succ_c1, 1); put('fv_ratio_c6', F.fv_take_c6 / F.fv_succ_c6, 1);
    check(F.fv_take_c1 > 3 * F.fv_succ_c1 && F.fv_take_c1 > 8, 'at the first clone 400 frames of takeovers add several times what 400 frames of successful runs add'); }
  // a supervisor with a rule, not foresight (robot lesson 3's 2.5 cm and a looser 4 cm)
  for (const [nm, tag] of [['expert', 'ex'], ['c1', 'c1'], ['c11', 'c11']]) for (const th of [0.025, 0.04]) {
    const r = CR[nm][th], k = tag + '_' + Math.round(th * 1000);
    put(k + '_take', r.take, 2); put(k + '_secs', r.secs, 1); put(k + '_cost', r.secs * AS.wage_per_h / (3600 * AS.sup_duty), 3); put(k + '_ok', 100 * r.ok, 1);
    if (nm !== 'expert') put(k + '_perfail', r.take / CR[nm].fail, 1);
  }
  put('c1_fail', 100 * CR.c1.fail, 1); put('c11_fail', 100 * CR.c11.fail, 1);
  check(F.ex_25_take > 3 && F.c1_25_take > 3 && F.c11_25_take > 3, 'the 2.5 cm rule calls the person more than three times a run for the expert and for both clones');
  check(F.ex_25_cost > (E20.v - E20.r) && F.c11_25_cost > (E20.v - E20.r), 'with a rule at 2.5 cm the person\'s time at the controls alone costs more than an attempt is worth, whatever the policy');
  put('vr_cents', 100 * (E20.v - E20.r), 2);
  // calls per failure multiply c: the break-even of a fleet supervised by the 4 cm rule
  put('rule_sstar_c1', 100 * (1 - Math.min(1, (E20.v - E20.r) / (E20.c * CR.c1[0.04].take / CR.c1.fail))), 1);
  put('rule_sstar_c11', 100 * (1 - Math.min(1, (E20.v - E20.r) / (E20.c * CR.c11[0.04].take / CR.c11.fail))), 1);

  /* positive variants of signed quantities, and the numbers of the checkpoint */
  put('h0_loss', -F.h0_net, 1); put('h0_loss_fleet10', -F.h0_net_fleet10, 0); put('d_cpp1', F.d_cpp / 1000, 2);
  put('fleet_3_paid', -F.fleet_3, 2); put('fleet_4_paid', -F.fleet_4, 2);
  [0, 20, 40].forEach((n) => put('ppf_' + n, ptsPerFail(n), 2));
  { const ck = led(30), ps = pStar(ck), crew = 0.10 * PERH * 30 / (3600 * 0.5);
    put('ck_c', ck.c, 3); put('ck_pstar', ps, 4); put('ck_sstar', 100 * (1 - ps), 1); put('ck_crew', crew, 3); put('ck_crew20', 20 * crew, 1); put('ck_net', PERH * (ck.v - ck.r - 0.10 * ck.c), 1); put('ck_vr', ck.v - ck.r, 4); }


  /* ───── 5 · the widget prints what the independent computation gives ───── */
  const pageFile = path.join(root, dir, '20_the_flywheel.html');
  if (fs.existsSync(pageFile)) {
    const { loadPage } = require('../dom_probe.js');
    const pg = loadPage(pageFile);
    pg.problems.forEach((m) => fail('page problem: ' + m));
    const FS = [1, 3, 10, 30, 100], TS = [1.5, 5, 10, 20, 40, 80], KS = [1, 10, 100, 1000, 10000];
    const ddec = (x) => (x < 1 ? 2 : x < 100 ? 1 : 0), mdec = (x) => (x >= 100 ? 0 : 2);
    const eqd = (id, want, dec, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -dec) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(dec + 2)}`); };
    const txt = (id, re, what) => { if (!re.test(pg.text(id))) fail(`${what}: widget #${id} prints ${JSON.stringify(pg.text(id))}`); };
    const probe = (name, s0, fi, ti, ki) => {
      pg.set('w05-s0', 100 * s0); pg.set('w05-f', fi); pg.set('w05-tau', ti); pg.set('w05-k', ki); pg.drain();
      const o = { s0, F: FS[fi], tau: TS[ti], K: KS[ki] }, e = led(o.tau), ps = pStar(e), ba = byAttempt(o.s0, o.F, o.tau, o.K), p0 = 1 - s0, n0 = nAt(p0);
      if (ps < 1) eqd('w05-sstar', 100 * (1 - ps), 1, name + ' s*'); else txt('w05-sstar', /none/, name + ' s*');
      eqd('w05-crew', p0 * PERH * o.tau / (3600 * AS.sup_duty), 2, name + ' supervisors per robot');
      eqd('w05-hour', PERH * (e.v - e.r - p0 * e.c), 1, name + ' net per robot-hour');
      if (ba.takeDay === null) txt('w05-take', /–/, name + ' take-off'); else if (ba.takeDay === 0) txt('w05-take', /from the start/, name + ' take-off'); else eqd('w05-take', ba.takeDay, ddec(ba.takeDay), name + ' take-off day');
      eqd('w05-def', ba.deficit, mdec(ba.deficit), name + ' deficit');
      let nt = n0; while (nt < 400 && e.v - e.r - pAt(nt) * e.c <= 0) nt += GEN;
      const pts = 100 * (1 - pAt(nt)) - 100 * s0;
      if (ba.deficit > 0 && pts > 0) eqd('w05-cpp', ba.deficit / pts, mdec(ba.deficit / pts), name + ' cost per point'); else txt('w05-cpp', /–/, name + ' cost per point');
      for (const k of [90, 98, 99]) if (ba.d[k]) eqd('w05-d' + k, ba.d[k], ddec(ba.d[k]), name + ' days to ' + k + ' %');
      eqd('w05-c98', ba.c[98], mdec(Math.abs(ba.c[98])), name + ' cash at 98 %');
      return { o, ba, nt };
    };
    probe('default', 0.635, 2, 3, 3);
    probe('one robot', 0.635, 0, 3, 3); probe('a hundred robots', 0.635, 4, 3, 3);
    probe('start at 70 %', 0.70, 2, 3, 3); probe('start at 80 %', 0.80, 2, 3, 3);
    probe('takeover 10 s', 0.635, 2, 2, 3); probe('takeover 40 s', 0.635, 2, 4, 3); probe('takeover 80 s', 0.635, 2, 5, 3); probe('takeover 1.5 s', 0.635, 2, 0, 3); probe('takeover 5 s', 0.635, 2, 1, 3);
    probe('K = 1', 0.635, 2, 3, 0); probe('K = 100', 0.635, 2, 3, 2);
    probe('a mix', 0.90, 1, 4, 1); probe('a good start', 0.96, 3, 5, 4);
    // the prose's numbers are the page's own outputs: set the defaults again and read the labels the reader sees
    probe('default again', 0.635, 2, 3, 3);
    check(/63\.5 %/.test(pg.text('w05-s0-v')) && /^10$/.test(pg.text('w05-f-v')) && /20 s/.test(pg.text('w05-tau-v')) && /1000/.test(pg.text('w05-k-v')), 'the slider labels show the defaults');
  } else fail('the page is missing: ' + pageFile);


  console.log(JSON.stringify({ facts: F }));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('oracle crashed: ' + (e && e.stack || e)); process.exit(2); });
