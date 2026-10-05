#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 03 (labels on your own states: DAgger and corrections).
 * Re-derives every number the lesson quotes with code written separately from dagger_lab.js: its own rollout loop and plant, a kernel regressor built on frames sorted by the
 * first joint angle (a window scan, not a grid), its own labellers (exact, lagged, noisy, taking over, two operators), its own statistics (Wilson interval, steps lost, distance
 * to the data, pull-back), and the variants the widget does not have (replacing old data, injected noise on the demonstrator, course lengths).  Only the world's primitives
 * (arm, expert, collision, path) come from bench.js.  Then it drives the page's widget through the states the prose describes and checks that what the widget prints is what
 * the independent computation gives.  Last stdout line: {"facts": {...}}. */
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

/* development only: R03_CACHE=/path/file.json memoises the long computations (never set by the validator) */
const CACHE_FILE = process.env.R03_CACHE; let CACHE = {};
if (CACHE_FILE && fs.existsSync(CACHE_FILE)) { try { CACHE = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { CACHE = {}; } }
const memo = (key, fn) => { if (CACHE[key] !== undefined) return CACHE[key]; const v = fn(); CACHE[key] = v; if (CACHE_FILE) fs.writeFileSync(CACHE_FILE, JSON.stringify(CACHE)); return v; };

/* ───── the experiment, written out independently ───── */
const H = 0.02, DT = 0.05, JIT = 0.01, GUST = 0.05, TUBE = 0.04, NEVAL = 200, SEEDEVAL = 5, PER = 5, DEMOS = 20, TOL = 0.025, BACK = 0.01, NP = 5;
const WA = BN.slalom.world(NP, { s0: 1 }), WB = BN.slalom.world(NP, { s0: -1 });
const clip = (v) => Math.max(-1.5, Math.min(1.5, v));
function run(w, pi, rng, noise, T) {                    // one rollout; pi(q, t) -> command.  Returns every state, command and position, the path distance of each state, and the outcome
  const dy = JIT * BN.randn(rng), q = BN.slalom.startQ(w, dy).slice(), S = [], A = [], P = [], xe = BN.slalom.xEnd(w);
  let coll = false, done = false, steps = T;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); S.push(q.slice()); P.push(p);
    if (BN.slalom.collide(w, p)) { coll = true; steps = t; break; }
    if (p[0] > xe - 0.02) { done = true; steps = t; break; }
    const u = pi(q.slice(), t); A.push(u);
    const n0 = noise ? noise * BN.randn(rng) : 0, n1 = noise ? noise * BN.randn(rng) : 0;
    q[0] += DT * (clip(u[0]) + n0); q[1] += DT * (clip(u[1]) + n1);
  }
  return { S, A, P, coll, done, steps, T };
}
const devOf = (w, p) => Math.abs(p[1] - BN.slalom.yref(w, p[0]));
const expert = (w) => (q) => BN.slalom.expertAct(w, q);

/* the nearest-demo regressor over a list of frames: sorted by the first joint angle, a window of three bandwidths scanned for each query */
function kernel(frames) {
  const n = frames.length, ord = frames.map((_, i) => i).sort((a, b) => frames[a][0][0] - frames[b][0][0]);
  const x0 = new Float64Array(n), x1 = new Float64Array(n), y0 = new Float64Array(n), y1 = new Float64Array(n);
  ord.forEach((i, j) => { x0[j] = frames[i][0][0]; x1[j] = frames[i][0][1]; y0[j] = frames[i][1][0]; y1[j] = frames[i][1][1]; });
  const lower = (v) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (x0[m] < v) lo = m + 1; else hi = m; } return lo; };
  const nearestFrame = (q) => { let best = Infinity, bj = 0; for (let j = 0; j < n; j++) { const e = ((x0[j] - q[0]) / H) ** 2 + ((x1[j] - q[1]) / H) ** 2; if (e < best) { best = e; bj = j; } } return bj; };
  return {
    n,
    predict(q) {
      let sw = 0, a0 = 0, a1 = 0;
      for (let j = lower(q[0] - 3 * H); j < n && x0[j] <= q[0] + 3 * H; j++) {
        const e = ((x0[j] - q[0]) / H) ** 2 + ((x1[j] - q[1]) / H) ** 2;
        if (e <= 9) { const w = Math.exp(-0.5 * e); sw += w; a0 += w * y0[j]; a1 += w * y1[j]; }
      }
      if (sw >= 1e-12) return [a0 / sw, a1 / sw];
      const b = nearestFrame(q); return [y0[b], y1[b]];
    },
    dist(q) {                                           // distance to the nearest stored frame in bandwidths, 3 beyond the kernel's reach
      let best = Infinity;
      for (let j = lower(q[0] - 3 * H); j < n && x0[j] <= q[0] + 3 * H; j++) { const e = ((x0[j] - q[0]) / H) ** 2 + ((x1[j] - q[1]) / H) ** 2; if (e < best) best = e; }
      return best > 9 ? 3 : Math.sqrt(best);
    },
  };
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
const demoRuns = (w, m, seed, noise) => { const rng = BN.rng(seed), out = []; for (let k = 0; k < m; k++) out.push(run(w, expert(w), rng, noise, BN.slalom.horizon(w))); return out; };
const framesOf = (runs) => { const f = []; runs.forEach((r) => { for (let t = 0; t < r.A.length; t++) f.push([r.S[t], r.A[t]]); }); return f; };

/* what the loop stores: the demonstrations, then the frames each round labels.  who: prog | replay | take | two | noise (iid label noise) | none (the variants below)
 * drive: latest | first.  keep: all (aggregate) | last (demonstrations and the newest round) | own (the newest round only) */
function loop(o) {
  const who = o.who || 'prog', tau = o.tau || 0, drive = o.drive || 'latest', keep = o.keep || 'all', seed = o.seed, w = o.w || WA, nrounds = o.rounds, sig = o.sig || 0;
  const rng = BN.rng(100 + seed), pick = BN.rng(500 + seed), lrng = BN.rng(900 + seed), T = BN.slalom.horizon(w);
  let demos;
  if (who === 'two') demos = framesOf(demoRuns(WA, DEMOS / 2, 1, 0)).concat(framesOf(demoRuns(WB, DEMOS / 2, 1, 0)));
  else demos = framesOf(demoRuns(w, DEMOS, 1, 0));
  let stored = demos.slice(), kern = kernel(stored), first = kern;
  const hist = [{ frames: stored.length, kern, collided: 0, rollouts: 0, labelled: 0 }];
  let collided = 0, rollouts = 0, labelledTotal = 0;
  const RMS = o.rms;
  for (let k = 1; k <= nrounds; k++) {
    const policy = drive === 'first' ? first : kern, fresh = [];
    for (let j = 0; j < PER; j++) {
      let ro;
      if (who === 'take') {
        let mode = 0, cnt = 0;
        ro = run(w, (q) => {
          const dev = devOf(w, BN.arm.fk(q, w.body));
          if (mode === 0 && dev > TOL) { mode = 1; cnt = 0; }
          if (mode === 1) { cnt++; if (cnt > tau) mode = 2; }
          if (mode === 2 && dev < BACK) mode = 0;
          if (mode === 2) { const a = BN.slalom.expertAct(w, q); fresh.push([q, a]); return a; }
          return policy.predict(q);
        }, rng, GUST, T);
      } else {
        const op = who === 'two' && pick() < 0.5 ? WB : w;
        ro = run(w, (q) => policy.predict(q), rng, GUST, T);
        for (let t = 0; t < ro.S.length; t++) {
          let a = BN.slalom.expertAct(op, ro.S[who === 'replay' ? Math.max(0, t - tau) : t]);
          if (who === 'noise') a = [a[0] + sig * RMS * BN.randn(lrng), a[1] + sig * RMS * BN.randn(lrng)];
          fresh.push([ro.S[t], a]);
        }
      }
      rollouts++; if (ro.coll) collided++;
    }
    stored = keep === 'all' ? stored.concat(fresh) : keep === 'last' ? demos.concat(fresh) : fresh;
    labelledTotal += fresh.length;
    kern = kernel(stored);
    hist.push({ frames: stored.length, kern, collided, rollouts, labelled: labelledTotal });
  }
  return hist;
}
/* the clone after a round, run 200 times from jittered starts under the gust: everything the lesson reports */
function evaluate(h, w, who) {
  w = w || WA; const kern = h.kern, T = BN.slalom.horizon(w), rng = BN.rng(SEEDEVAL), rolls = [], worlds = who === 'two' ? [WA, WB] : [w];
  let ok = 0, co = 0;
  for (let k = 0; k < NEVAL; k++) { const r = run(w, (q) => kern.predict(q), rng, GUST, T); rolls.push(r); if (r.done) ok++; if (r.coll) co++; }
  let lostSum = 0;
  rolls.forEach((r) => {                                 // steps lost among the first T: collided, farther than the tube from the nearest path, or never finished
    const dev = r.P.map((p) => Math.min(...worlds.map((ww) => devOf(ww, p))));
    for (let t = 0; t < T; t++) { let b = r.coll && t >= r.steps; if (!b && t < dev.length && dev[t] > TUBE) b = true; if (!b && !r.done && !r.coll && t >= dev.length) b = true; if (b) lostSum++; }
  });
  let se = 0, ss = 0, n = 0, far = 0, dd = 0, ds = 0, m = 0, post1 = 0;
  rolls.forEach((r) => {
    const d = r.S.map((q) => kern.dist(q));
    for (let t = 0; t < r.A.length; t++) { n++; if (d[t] >= 1) far++; if (who !== 'two') { const a = BN.slalom.expertAct(w, r.S[t]); se += (r.A[t][0] - a[0]) ** 2 + (r.A[t][1] - a[1]) ** 2; ss += a[0] * a[0] + a[1] * a[1]; } }
    for (let t = 0; t + 1 < d.length; t++) if (d[t] >= 0.5 && d[t] < 1) { dd += d[t + 1] - d[t]; ds += d[t]; m++; }
    if (r.coll) { const pe = r.P[r.P.length - 1]; let bi = 0, bd = Infinity; w.posts.forEach((c, i) => { const e = Math.hypot(pe[0] - c[0], pe[1] - c[1]); if (e < bd) { bd = e; bi = i; } }); if (bi === 0) post1++; }
  });
  const ci = wilson(ok, NEVAL);
  return { succ: ok / NEVAL * 100, lo: ci[0] * 100, hi: ci[1] * 100, coll: co / NEVAL * 100, T, C: lostSum / NEVAL, err: who === 'two' ? NaN : Math.sqrt(se / ss) * 100, far: far / n * 100,
    pull: who === 'two' || !m ? NaN : -dd / ds * 100, pullN: m, post1: post1 / NEVAL * 100, frames: h.frames, labelled: h.labelled, collected: h.collided, rollouts: h.rollouts, rolls };
}
const strip = (e) => { const o = Object.assign({}, e); delete o.rolls; return o; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
function across(opts, ks, who) {                         // 8 collection seeds, evaluated at the rounds in ks: rows[seedIndex][kIndex]
  const key = 'across|' + JSON.stringify(opts) + '|' + ks.join(',');
  return memo(key, () => SEEDS.map((s) => { const hs = loop(Object.assign({ seed: s, rounds: Math.max(...ks) }, opts)); return ks.map((k) => strip(evaluate(hs[k], opts.w, who || opts.who))); }));
}
const col = (rows, ki, f) => rows.map((r) => r[ki][f]);
const range = (a) => [Math.min(...a), Math.max(...a)];

/* ───── the clone of lessons 1 and 2, again ───── */
const KS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const prog = across({ who: 'prog' }, KS);
for (let ki = 0; ki < KS.length; ki++) {
  const k = KS[ki], s = col(prog, ki, 'succ');
  F[`m${k}_succ`] = mean(s); F[`lo${k}_succ`] = range(s)[0]; F[`hi${k}_succ`] = range(s)[1];
  for (const f of ['C', 'err', 'far', 'pull', 'labelled', 'collected', 'frames']) F[`m${k}_${f}`] = mean(col(prog, ki, f));
}
// the default run: the collection seed whose success curve lies closest to the average of the eight
const dist2 = SEEDS.map((_, si) => KS.reduce((a, k, ki) => a + (prog[si][ki].succ - F[`m${k}_succ`]) ** 2, 0));
const SEED = SEEDS[dist2.indexOf(Math.min(...dist2))];
F.seed = SEED; check(SEED === 8, 'the most typical of the eight collection seeds is seed 8 (got ' + SEED + '): update the engine default');
const def = prog[SEED - 1];
for (let ki = 0; ki < KS.length; ki++) { const k = KS[ki], e = def[ki]; for (const f of ['succ', 'lo', 'hi', 'C', 'err', 'far', 'pull', 'pullN', 'labelled', 'collected', 'frames', 'post1', 'coll']) F[`r${k}_${f}`] = e[f]; }
F.T = def[0].T; F.Ts = F.T * DT;

/* held-out copy error of the first clone on fresh expert runs, as lesson 1: ten runs, rng 99 */
{ const h0 = loop({ who: 'prog', seed: SEED, rounds: 0 })[0], held = demoRuns(WA, 10, 99, 0); let se = 0, ss = 0;
  held.forEach((r) => { for (let t = 0; t < r.A.length; t++) { const p = h0.kern.predict(r.S[t]); se += (p[0] - r.A[t][0]) ** 2 + (p[1] - r.A[t][1]) ** 2; ss += r.A[t][0] ** 2 + r.A[t][1] ** 2; } });
  F.err_exp = Math.sqrt(se / ss) * 100; F.ratio_own = F.r0_err / F.err_exp;
  // the expert under the same gust, measured against the same stored frames: pull-back in the 0.5-1 bandwidth bin
  const rx = BN.rng(SEEDEVAL); let dd = 0, ds = 0, m = 0, okx = 0;
  for (let k = 0; k < 100; k++) { const r = run(WA, expert(WA), rx, GUST, BN.slalom.horizon(WA)); if (r.done) okx++; const d = r.S.map((q) => h0.kern.dist(q)); for (let t = 0; t + 1 < d.length; t++) if (d[t] >= 0.5 && d[t] < 1) { dd += d[t + 1] - d[t]; ds += d[t]; m++; } }
  F.pull_exp = -dd / ds * 100; F.pull_exp_n = m; F.exp_succ = okx; }
F.pull_gap = F.m4_pull - F.pull_exp; F.r4_sec = F.r4_labelled * DT; F.r10_sec = F.r10_labelled * DT;

/* ───── lead time, and the person's tolerance ───── */
{ const h0 = loop({ who: 'prog', seed: SEED, rounds: 0 })[0], ev = evaluate(h0), fails = ev.rolls.filter((r) => r.coll);
  const lead = (x) => fails.map((r) => { let e = r.steps; while (e > 0 && devOf(WA, r.P[e - 1]) > x) e--; return r.steps - e; }).sort((a, b) => a - b);
  for (const [tag, x] of [['25', 0.025], ['40', 0.04]]) { const l = lead(x); F['lead' + tag + '_med'] = l[Math.floor(l.length / 2)]; F['lead' + tag + '_ok'] = l.filter((v) => v > 6).length / l.length * 100; F['lead' + tag + '_min'] = l[0]; }
  F.lead_n = fails.length; }

/* ───── equal labelled frames: more demonstrations, demonstrations under injected noise, the loop ───── */
const GK = { calm: 0, g05: 0.05, g10: 0.10, g15: 0.15 };
function baseline(kind, frames) {                         // whole demonstrations until the same number of frames are stored
  return memo('baseline|' + kind + '|' + frames, () => {
    const rng = BN.rng(1), fr = []; let m = 0, crashed = 0; const w = WA, T = BN.slalom.horizon(w);
    while (fr.length < frames) { const r = run(w, expert(w), rng, GK[kind], T); for (let t = 0; t < r.A.length; t++) fr.push([r.S[t], r.A[t]]); m++; if (r.coll) crashed++; }
    const e = evaluate({ kern: kernel(fr), frames: fr.length, labelled: 0, collided: 0, rollouts: 0 }); return { frames: fr.length, demos: m, crashed, succ: e.succ };
  });
}
const BUD = [0, 2, 4, 6, 8, 10];
for (const k of BUD) for (const kind of Object.keys(GK)) { const b = baseline(kind, def[KS.indexOf(k)].frames); F[`${kind}_k${k}`] = b.succ; F[`${kind}_k${k}_demos`] = b.demos; F[`${kind}_k${k}_crashed`] = b.crashed; F[`${kind}_k${k}_frames`] = b.frames; }
for (const k of [1, 3, 5, 7, 9]) for (const kind of ['g10', 'g15']) { const b = baseline(kind, def[KS.indexOf(k)].frames); F[`${kind}_k${k}`] = b.succ; F[`${kind}_k${k}_frames`] = b.frames; }   // the widget draws the comparison at every round
for (const g of [0, 0.05, 0.075, 0.10, 0.15, 0.20]) {        // how often the demonstrator itself touches a post when it is pushed that hard
  F['crash' + Math.round(g * 1000)] = memo('crash|' + g, () => { const rng = BN.rng(1); let c = 0; for (let k = 0; k < 200; k++) { if (run(WA, expert(WA), rng, g, BN.slalom.horizon(WA)).coll) c++; } return c / 200 * 100; });
}
F.level_ratio = 0.10 / GUST;

/* ───── keep everything, or not ───── */
for (const keep of ['all', 'last', 'own']) {
  const rows = keep === 'all' ? prog : across({ who: 'prog', keep }, [1, 2, 4]);
  const ks = keep === 'all' ? KS : [1, 2, 4];
  for (const k of [1, 2, 4]) F[`keep_${keep}_k${k}`] = mean(col(rows, ks.indexOf(k), 'succ'));
  for (const f of ['far', 'pull']) F[`keep_${keep}_k4_${f}`] = mean(col(rows, ks.indexOf(4), f));   // where the clone's own frames lie, by what is kept
}

/* ───── one batch from the first clone, or retraining after every round ───── */
const first = across({ who: 'prog', drive: 'first' }, [2, 4, 8]);
for (const [ki, k] of [0, 1, 2].entries()) { const kk = [2, 4, 8][ki]; F[`first_k${kk}`] = mean(col(first, ki, 'succ')); F[`first_k${kk}_coll`] = mean(col(first, ki, 'collected')); F[`first_k${kk}_lab`] = mean(col(first, ki, 'labelled')); F[`first_k${kk}_lo`] = range(col(first, ki, 'succ'))[0]; F[`first_k${kk}_hi`] = range(col(first, ki, 'succ'))[1]; void k; }
F.latest_k8_coll = F.m8_collected; F.latest_k4_coll = F.m4_collected;

/* ───── cost against the length of the course ───── */
{ const T = [], Cc = [], Cd = [], Sc = [], Sd = [];
  for (let n = 1; n <= 6; n++) {
    const w = BN.slalom.world(n, { s0: 1 });
    const clone = memo('clone|' + n, () => strip(evaluate(loop({ who: 'prog', seed: 1, rounds: 0, w })[0], w)));
    const dag = across({ who: 'prog', w: BN.slalom.world(n, { s0: 1 }) }, [4]);
    T.push(clone.T); Cc.push(clone.C); Sc.push(clone.succ); Cd.push(mean(col(dag, 0, 'C'))); Sd.push(mean(col(dag, 0, 'succ')));
    F[`n${n}_T`] = clone.T; F[`n${n}_Cc`] = clone.C; F[`n${n}_Cd`] = Cd[n - 1]; F[`n${n}_Sc`] = clone.succ; F[`n${n}_Sd`] = Sd[n - 1];
    F[`n${n}_hc`] = 2 * clone.C / (clone.T ** 2) * 1000; F[`n${n}_hd`] = 2 * Cd[n - 1] / (clone.T ** 2) * 1000;
  }
  const fit = (xs, ys) => BN.stats.logslope(xs, ys);
  const fc = fit(T, Cc), fd = fit(T, Cd); F.slope_clone = fc.slope; F.r2_clone = fc.r2; F.slope_dag = fd.slope; F.r2_dag = fd.r2;
  F.slope_dag_se = F.slope_dag * Math.sqrt((1 - F.r2_dag) / (F.r2_dag * (T.length - 2)));   // standard error of a least-squares slope from its r^2
  F.h_clone_mean = mean(Cc.map((c, i) => 2 * c / (T[i] ** 2) * 1000)); F.h_dag_mean = mean(Cd.map((c, i) => 2 * c / (T[i] ** 2) * 1000)); F.h_ratio = F.h_clone_mean / F.h_dag_mean;
  F.C_ratio_6 = Cc[5] / Cd[5]; F.C_ratio_1 = Cc[0] / Cd[0]; }

/* ───── a person as the labeller ───── */
{ const w = WA, d = demoRuns(w, DEMOS, 1, 0); let ss = 0, c = 0; d.forEach((r) => r.A.forEach((a) => { ss += a[0] * a[0] + a[1] * a[1]; c += 2; })); F.act_rms = Math.sqrt(ss / c);
  // label error of a lagged labeller on the expert's own runs: rms of (command at the state seen tau frames earlier - command now) over the rms command
  for (const tau of [2, 4, 6, 8]) { let se = 0, sq = 0; d.forEach((r) => { for (let t = 0; t < r.A.length; t++) { const a = BN.slalom.expertAct(w, r.S[t]), b = BN.slalom.expertAct(w, r.S[Math.max(0, t - tau)]); se += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; sq += a[0] ** 2 + a[1] ** 2; } }); F['lagerr' + tau] = Math.sqrt(se / sq) * 100; } }
{ // the share of a label error that the clone inherits: the kernel average of the errors over neighbouring frames (what the clone answers with), over the rms error, on the 20 demonstrations
  const d = demoRuns(WA, DEMOS, 1, 0), fr = framesOf(d), rn = BN.rng(77);
  const survive = (err) => { const k = kernel(fr.map((f, i) => [f[0], err[i]])); let a = 0, b = 0; fr.forEach((f, i) => { const m = k.predict(f[0]); a += m[0] * m[0] + m[1] * m[1]; b += err[i][0] ** 2 + err[i][1] ** 2; }); return Math.sqrt(a / b) * 100; };
  const lagE = []; d.forEach((r) => { for (let t = 0; t < r.A.length; t++) { const a = BN.slalom.expertAct(WA, r.S[t]), b = BN.slalom.expertAct(WA, r.S[Math.max(0, t - 6)]); lagE.push([b[0] - a[0], b[1] - a[1]]); } });
  const noiE = fr.map(() => [0.4 * F.act_rms * BN.randn(rn), 0.4 * F.act_rms * BN.randn(rn)]);
  F.survive_lag6 = survive(lagE); F.survive_noise40 = survive(noiE);
  check(F.survive_lag6 > 60 && F.survive_noise40 < 25, 'averaging over neighbouring frames cancels label noise and not a label lag: ' + F.survive_lag6 + ' against ' + F.survive_noise40); }
for (const sg of [0.4, 1.6]) { const rows = across({ who: 'noise', sig: sg, rms: F.act_rms }, [4], 'noise'), t = `noise${Math.round(sg * 100)}`; F[t + '_k4'] = mean(col(rows, 0, 'succ')); F[t + '_lo'] = range(col(rows, 0, 'succ'))[0]; F[t + '_hi'] = range(col(rows, 0, 'succ'))[1]; F[t + '_lab'] = mean(col(rows, 0, 'labelled')); F[t + '_coll'] = mean(col(rows, 0, 'collected')); }
F.noise160_drop = F.m4_succ - F.noise160_k4; F.noise40_drop = F.m4_succ - F.noise40_k4;
for (const tau of [2, 4, 6, 8]) {
  const rows = across({ who: 'replay', tau }, [4]); const s = col(rows, 0, 'succ'); const tag = 'lag' + tau;
  F[tag + '_k4'] = mean(s); F[tag + '_lo'] = range(s)[0]; F[tag + '_hi'] = range(s)[1]; F[tag + '_coll'] = mean(col(rows, 0, 'collected')); F[tag + '_lab'] = mean(col(rows, 0, 'labelled'));
}
for (const tau of [0, 6, 10]) {
  const rows = across({ who: 'take', tau }, [4, 10]); const tag = 'take' + tau;
  F[tag + '_k4'] = mean(col(rows, 0, 'succ')); F[tag + '_lo'] = range(col(rows, 0, 'succ'))[0]; F[tag + '_hi'] = range(col(rows, 0, 'succ'))[1];
  F[tag + '_lab4'] = mean(col(rows, 0, 'labelled')); F[tag + '_coll4'] = mean(col(rows, 0, 'collected'));
  F[tag + '_k10'] = mean(col(rows, 1, 'succ')); F[tag + '_lo10'] = range(col(rows, 1, 'succ'))[0]; F[tag + '_lab10'] = mean(col(rows, 1, 'labelled')); F[tag + '_coll10'] = mean(col(rows, 1, 'collected')); F[tag + '_hi10'] = range(col(rows, 1, 'succ'))[1];
}
F.sec_prog4 = F.m4_labelled * DT; F.sec_take4 = F.take6_lab4 * DT; F.sec_take10 = F.take6_lab10 * DT; F.sec_dag10 = F.m10_labelled * DT;
F.lab_ratio = F.m4_labelled / F.take6_lab4; F.lab_per_round = F.m4_labelled / 4; F.sec_per_round = F.lab_per_round * DT; F.C_ratio_r4 = F.r0_C / F.r4_C; F.C_ratio_m4 = F.m0_C / F.m4_C; F.noise_ratio = 40 / F.err_exp;

/* ───── two people ───── */
{ const two = across({ who: 'two' }, [0, 1, 2, 4]);
  for (const [ki, k] of [0, 1, 2, 4].entries()) { F[`two_k${k}`] = mean(col(two, ki, 'succ')); F[`two_k${k}_post1`] = mean(col(two, ki, 'post1')); F[`two_k${k}_coll`] = mean(col(two, ki, 'coll')); F[`two_k${k}_hi`] = range(col(two, ki, 'succ'))[1]; void ki; }
  F.two_k0_later = F.two_k0_coll - F.two_k0_post1;                      // runs that end at one of posts 2 to 5
  F.two_k0_lab = def[0].frames; F.two_k0_frames = two[0][0].frames;
  const q0 = BN.slalom.startQ(WA, 0), J = BN.arm.jac(q0, WA.body), cup = (u) => [J[0] * u[0] + J[1] * u[1], J[2] * u[0] + J[3] * u[1]], deg = (v) => Math.atan2(v[1], v[0]) * 180 / Math.PI;
  const h2 = loop({ who: 'two', seed: 1, rounds: 0 })[0];
  F.head_A = deg(cup(BN.slalom.expertAct(WA, q0))); F.head_B = deg(cup(BN.slalom.expertAct(WB, q0))); F.head_mean = deg(cup(h2.kern.predict(q0)));
  F.head_one = deg(cup(loop({ who: 'prog', seed: 1, rounds: 0 })[0].kern.predict(q0)));
  F.ck_mean = (F.head_A + F.head_B) / 2; F.ck_cross = 20 * Math.tan(37 * Math.PI / 180); F.ck_clear = F.ck_cross - 5;
  // where the mean heading crosses the first post's column: height above the post centre, against the 5 cm halo
  const dx = WA.posts[0][0] - BN.arm.fk(q0, WA.body)[0]; F.cross_A = dx * Math.tan(F.head_A * Math.PI / 180) * 100; F.cross_mean = dx * Math.tan(F.head_mean * Math.PI / 180) * 100; F.start_gap_cm = dx * 100;
  const dB = demoRuns(WB, DEMOS, 1, 0); const hB = { kern: kernel(framesOf(dB)), frames: 0, labelled: 0, collided: 0, rollouts: 0 }; F.oneB_k0 = evaluate(hB, WA).succ;
  const evA = loop({ who: 'prog', seed: 1, rounds: 0 })[0]; F.oneA_k0 = evaluate(evA).succ; }

/* ───── claims of the prose, asserted ───── */
check(Math.abs(F.m0_succ - 63.5) < 0.01 && Math.abs(F.r0_C - 60.5) < 0.05 && F.T === 235, 'round 0 reproduces lessons 1 and 2: 63.5 % and 60.5 steps lost of 235');
check(Math.abs(F.r0_err - 13.9) < 0.06 && Math.abs(F.r0_far - 23.4) < 0.06 && Math.abs(F.r0_pull + 0.1) < 0.06, 'round 0 reproduces lesson 2: own-frame error 13.9, beyond one bandwidth 23.4, pull-back -0.1');
check(Math.abs(F.pull_exp - 7.5) < 0.06, 'the expert recovers 7.5 % of its distance per step (lesson 2): ' + F.pull_exp);
check(F.m4_succ > 93 && F.m4_succ < 98, 'four rounds of five rollouts: about nineteen runs in twenty (' + F.m4_succ + ')');
check(F.m1_succ < F.m2_succ && F.m2_succ < F.m3_succ && F.m3_succ < F.m4_succ, 'success rises round by round over the first four rounds');
check(F.m10_succ > F.m4_succ - 1 && F.m10_succ < 100, 'the curve is flat after the fourth round');
check(F.m4_far < 1 && F.m4_pull > 5 && F.m4_err < F.m0_err, 'after four rounds the clone lives inside its data, pulls back as the expert does, and its own-frame error falls');
check(F.m4_C < F.m0_C / 4, 'steps lost fall by more than a factor of four at round four');
check(F.calm_k4 < 65 && F.g05_k4 < F.g10_k4 && F.g10_k4 < F.g15_k4 + 1 && F.g05_k4 < F.m4_succ, 'more calm demonstrations do nothing and injected noise rises with its level');
check(KS.every((k) => F[`g15_k${k}`] > F[`r${k}_succ`]), 'demonstrations under a gust of 0.15 reach more than the loop at every number of frames the widget offers');
check(F.g10_k0 > 95 && F.g10_k0_frames < F.r1_frames, 'demonstrations under a gust of 0.10 reach 95 % from fewer frames than the loop holds after one round');
check(F.crash100 < 8 && F.crash150 > 25 && F.crash50 === 0 && F.crash0 === 0, 'the demonstrator is never disturbed at the clone\'s gust, rarely at 0.10, and often at 0.15');
check(F.keep_own_k2 < 50 && F.keep_last_k4 < F.keep_all_k4 - 10, 'replacing the stored frames loses what the earlier rounds taught');
check(F.keep_all_k4_far < 1 && F.keep_last_k4_far > 3 && F.keep_own_k4_far > 40 && F.keep_last_k4_pull < F.keep_all_k4_pull - 4, 'dropping the earlier rounds puts the clone\'s own frames back outside its data');
const flat = (kind) => { const v = BUD.map((k) => F[`${kind}_k${k}`]); return Math.max(...v) - Math.min(...v); };
check(flat('g05') < 7 && flat('g10') < 7 && flat('g15') < 7 && F.g10_k4 - F.g05_k4 > 10, 'what sets the strength of noise injection is its level, not the number of frames');
check(Math.abs(F.first_k4 - F.m4_succ) < 4 && F.first_k4_coll > F.m4_collected + 1.5, 'a batch from the first clone labels as well as retraining each round, and crashes the robot more often while collecting');
check(Math.abs(F.slope_dag - F.slope_clone) < 2 * F.slope_dag_se, 'the loop\'s exponent cannot be told from the clone\'s: ' + F.slope_dag + ' +- ' + F.slope_dag_se + ' against ' + F.slope_clone);
check(F.slope_clone > 1.9 && F.slope_clone < 2.1 && F.h_ratio > 2.5, 'the clone\'s cost grows as T^2 and the loop lowers the hazard by a factor of about four');
check(F.noise40_k4 > F.m4_succ - 4 && F.noise160_k4 > F.noise40_k4 - 15, 'label noise averages out');
check(F.lag6_k4 < F.m4_succ - 8 && F.lag8_k4 < 20 && F.lag2_k4 > F.m4_succ - 4, 'label lag poisons the data past 0.3 s');
check(F.lagerr6 < 50 && F.lagerr6 > 35, 'a 0.3 s lag is a label error of about 40 % of the command');
check(F.take6_k4 < F.m4_succ - 15 && F.take6_coll4 < 2 && Math.abs(F.take0_k4 - F.take10_k4) < 8, 'taking over is safe, independent of the person\'s lag, and slow');
check(F.lead25_med > 10 && F.lead40_med < 5 && F.lead25_ok > 90 && F.lead40_ok < 70, 'a person with a 0.3 s reaction can act on a 2.5 cm tolerance, not on a 4 cm one');
check(F.two_k0 < F.oneA_k0 - 30 && F.two_k4 < 3 && F.two_k4_post1 > 80, 'two operators: the mean runs into the first post, and the loop makes it worse');
check(Math.abs(F.two_k0 + F.two_k0_coll - 100) < 1e-6 && F.two_k0_later > 2 * F.two_k0_post1, 'two operators at round 0: every failure is a collision, and most of them are at the later posts (' + F.two_k0_post1 + ' % at post 1, ' + F.two_k0_later + ' % at posts 2 to 5)');
check(Math.abs(F.head_A + F.head_B) < 0.5 && Math.abs(F.head_mean) < 8 && Math.abs(F.cross_mean) < 5, 'the average of the two routes heads into the first post\'s halo');

/* ───── the states the prose asks the reader to visit in the widget (default run, collection seed 8) ───── */
const at = (opts, k) => { const hs = loop(Object.assign({ seed: SEED, rounds: k }, opts)); return evaluate(hs[k], undefined, opts.who); };
const PROBES = [
  { key: 'first4', opts: { who: 'prog', drive: 'first' }, k: 4, ui: { who: 'prog', tau: 6, drive: 'first' } },
  { key: 'rep2', opts: { who: 'replay', tau: 2 }, k: 4, ui: { who: 'replay', tau: 2, drive: 'latest' } },
  { key: 'rep6', opts: { who: 'replay', tau: 6 }, k: 4, ui: { who: 'replay', tau: 6, drive: 'latest' } },
  { key: 'rep8', opts: { who: 'replay', tau: 8 }, k: 4, ui: { who: 'replay', tau: 8, drive: 'latest' } },
  { key: 'take4', opts: { who: 'take', tau: 6 }, k: 4, ui: { who: 'take', tau: 6, drive: 'latest' } },
  { key: 'take10', opts: { who: 'take', tau: 6 }, k: 10, ui: { who: 'take', tau: 6, drive: 'latest' } },
  { key: 'two0', opts: { who: 'two' }, k: 0, ui: { who: 'two', tau: 6, drive: 'latest' } },
  { key: 'two1', opts: { who: 'two' }, k: 1, ui: { who: 'two', tau: 6, drive: 'latest' } },
  { key: 'two4', opts: { who: 'two' }, k: 4, ui: { who: 'two', tau: 6, drive: 'latest' } },
];
const probed = {};
for (const pr of PROBES) { const e = at(pr.opts, pr.k); probed[pr.key] = e; for (const f of ['succ', 'lo', 'hi', 'labelled', 'C', 'far', 'post1', 'err', 'pull', 'collected', 'rollouts', 'frames']) F[`p_${pr.key}_${f}`] = e[f]; }
F.p_two1_succ_default = F.p_two1_succ;

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '03_labels_on_your_own_states.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${Number(want).toFixed(digits + 2)}`); };
  const setState = (r, ui, cmp) => { pg.set('w03-r', 0); pg.set('w03-who', ui.who); pg.set('w03-drive', ui.drive); pg.set('w03-cmp', cmp); pg.set('w03-tau', ui.tau); pg.set('w03-r', r); pg.drain(); };
  const probe = (e, tag) => {
    eqd('w03-succ', e.succ, 1, tag + ' success'); eqd('w03-lab', e.labelled, 0, tag + ' labelled frames'); eqd('w03-C', e.C, 1, tag + ' steps lost');
    eqd('w03-far', e.far, 1, tag + ' share of own frames beyond one bandwidth'); eqd('w03-post1', e.post1, 1, tag + ' runs ending at post 1');
    if (!isNaN(e.err)) eqd('w03-err', e.err, 1, tag + ' own-frame error'); if (!isNaN(e.pull)) eqd('w03-pull', e.pull, 1, tag + ' pull-back');
    eqd('w03-sec', e.labelled * DT, 0, tag + ' person-seconds'); eqd('w03-crash', e.collected, 0, tag + ' crashes while collecting');
  };
  const UI0 = { who: 'prog', tau: 6, drive: 'latest' };
  for (const k of [0, 4, 10]) { setState(k, UI0, 'none'); probe(def[KS.indexOf(k)], 'round ' + k); }
  for (const pr of PROBES) { setState(pr.k, pr.ui, 'none'); probe(probed[pr.key], pr.key); }
  // the start-frame headings
  setState(0, { who: 'two', tau: 6, drive: 'latest' }, 'none'); eqd('w03-head', F.head_mean, 1, 'two people, heading at the start frame');
  setState(0, UI0, 'none'); eqd('w03-head', F.head_one, 1, 'one operator, heading at the start frame');
  // the comparison with the other ways to buy frames, at the frames of the round on the slider
  for (const kind of ['calm', 'g05', 'g10', 'g15']) { setState(4, UI0, kind); eqd('w03-cmpv', F[`${kind}_k4`], 1, 'compare with ' + kind + ' at round 4'); }
  setState(0, UI0, 'calm'); eqd('w03-cmpv', F.calm_k0, 1, 'compare with calm demonstrations at round 0');
  setState(0, UI0, 'g10'); eqd('w03-cmpv', F.g10_k0, 1, 'compare with a gust of 0.10 at round 0');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
