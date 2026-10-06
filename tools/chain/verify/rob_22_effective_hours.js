#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 22 (was lesson 07 of the old data series: add 15 to the lesson numbers in comments below) (effective hours: duplicates, quality and collapse).
 * Re-derives every number the lesson quotes with code written separately from ess_lab.js and bodies_lab.js: its own recorder of demonstrations (an explicit plant), its own followers
 * (a lookup of one demonstration per situation, a lookup that keeps every repeat of the situation, and a kernel average of demonstrations), its own scorer (a full scan of a matrix of
 * distances), its own own-curve and inversion, its own popularity law, draws, generations of self-training, rig, consistency check and actions.  Only the world's primitives (arm, expert,
 * posts, collision) come from bench.js, the prices (assumptions) and the stored own curve from ledger.js.  Closed forms (the expected number of distinct situations, the collision
 * probability, the loss of diversity per generation, the survival of a singleton) are checked against many draws.  Then the page's widget is driven through the states the prose
 * describes and what it prints is compared with the independent computation.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const LG = require(path.join(root, dir, 'ledger.js'));
const ES = require(path.join(root, dir, 'ess_lab.js'));            // the engine under test: only its seeded counts are compared, everything else is recomputed here
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 4 : d); };
const pc = (x) => 100 * x;
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const lo = (a) => Math.min(...a), hi = (a) => Math.max(...a);

/* ───── the world, written out independently ───── */
const DT = 0.05, JIT = 0.01, GUST = 0.08, CH = 16, KST = 20, EVSEED = 5, GAIN = 0.85, NT = 1000, NS = 256, SEC = 9.3, DELTA = 0.015;
const clip = (x) => Math.max(-1.5, Math.min(1.5, x));
function layouts(n, seed) { const r = BN.rng(seed), out = []; for (let i = 0; i < n; i++) { const s = (2 * r() - 1) * 0.10, t = (2 * r() - 1) * 0.20; out.push([s, t]); } return out; }
const worldOf = (th) => BN.slalom.world(5, { shift: th[0], tilt: th[1], body: { L1: 0.5, L2: 0.5 } });
const postY = new Map();
function ys(th) { let v = postY.get(th); if (!v) { v = worldOf(th).posts.map((p) => p[1]); postY.set(th, v); } return v; }
function dist(a, b) { const ya = ys(a), yb = ys(b); let m = 0; for (let i = 0; i < 5; i++) m = Math.max(m, Math.abs(ya[i] - yb[i])); return m; }
/* one demonstration of the expert on arm A's links: start offset of 1 cm, plant of gain 1, no gust; stored: the hand's position at every step */
function record(th, seed) {
  const w = worldOf(th), rng = BN.rng(seed), T = 2 * BN.slalom.horizon(w), xe = BN.slalom.xEnd(w);
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice(), P = [];
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); P.push(p.slice());
    if (BN.slalom.collide(w, p)) { coll = true; break; }
    if (p[0] > xe - 0.02) { done = true; break; }
    const u = BN.slalom.expertAct(w, q);
    for (let k = 0; k < 2; k++) q[k] += DT * clip(u[k]);
  }
  return { th, P, n: P.length, ok: done && !coll };
}
/* one run of arm A on test layout th, following stored hand targets (a store of one demonstration, or of several: end[i] is the last frame of the demonstration frame i belongs to):
 * 1 completed, 2 touched a post, 3 timed out */
function followStore(th, P, end, seed) {
  const w = worldOf(th), rng = BN.rng(seed), T = BN.slalom.horizon(w), xr = BN.slalom.xEnd(w) - 0.02, n = P.length;
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice();
  let i0 = 0;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body);
    if (BN.slalom.collide(w, p)) return 2;
    if (p[0] > xr) return 1;
    const j = t % CH;
    if (j === 0) { let best = Infinity; for (let i = 0; i < n; i++) { const dx = P[i][0] - p[0], dy = P[i][1] - p[1], e = dx * dx + dy * dy; if (e < best) { best = e; i0 = i; } } }
    const i = Math.min(i0 + j + 1, end ? end[i0] : n - 1);
    const target = BN.arm.ik(P[i], q[1] >= 0 ? 1 : -1, w.body);
    const u0 = clip(KST * (target[0] - q[0])), u1 = clip(KST * (target[1] - q[1]));
    q[0] += DT * (u0 * GAIN + GUST * BN.randn(rng)); q[1] += DT * (u1 * GAIN + GUST * BN.randn(rng));
  }
  return 3;
}
const tests = layouts(NT, 99), ownTh = layouts(NS, 1011);
const own = ownTh.map((th, k) => { const d = record(th, 500 + k); d.k = k; return d; });
check(own.every((d) => d.ok), 'every demonstration of the own file succeeds');
const DMAT = new Float64Array(NT * NS);
for (let k = 0; k < NT; k++) for (let c = 0; c < NS; c++) DMAT[k * NS + c] = dist(tests[k], ownTh[c]);
const shiftedMemo = new Map();
function shifted(c, um) { if (!um) return own[c]; const key = c + '|' + um; let d = shiftedMemo.get(key); if (!d) { d = { P: own[c].P.map((p) => [p[0], p[1] + um * 1e-6]), n: own[c].n }; shiftedMemo.set(key, d); } return d; }
const omemo = new Map();
function outcome(k, c, um) { const key = (k * NS + c) + '|' + (um || 0); let r = omemo.get(key); if (r === undefined) { const d = shifted(c, um); r = followStore(tests[k], d.P, null, 1000 * EVSEED + k + 1) === 1 ? 1 : 0; omemo.set(key, r); } return r; }
/* the lookup policy: off[c] is the offset in micrometres of a stored situation (null when absent); every test layout copies the nearest stored situation */
function lookup(off) {
  let ok = 0;
  for (let k = 0; k < NT; k++) {
    let best = Infinity, bc = -1;
    for (let c = 0; c < NS; c++) { if (off[c] === null) continue; const d = DMAT[k * NS + c]; if (d < best) { best = d; bc = c; } }
    if (bc >= 0) ok += outcome(k, bc, off[bc]);
  }
  return { ok, succ: ok / NT };
}
function lookupDetail(off) {
  const okv = new Uint8Array(NT), pick = new Int16Array(NT);
  for (let k = 0; k < NT; k++) { let best = Infinity, bc = -1; for (let c = 0; c < NS; c++) { if (off[c] === null) continue; const d = DMAT[k * NS + c]; if (d < best) { best = d; bc = c; } } pick[k] = bc; if (bc >= 0) okv[k] = outcome(k, bc, off[bc]); }
  return { okv, pick };
}
const firstN = (n) => Array.from({ length: NS }, (_, c) => (c < n ? 0 : null));

/* ───── the ledger's own curve, recomputed, and the inversion ───── */
const GRID = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const curve = GRID.map((n) => lookup(firstN(n)).succ);
{
  let mo = 0; GRID.forEach((n, i) => { mo = Math.max(mo, Math.abs(curve[i] - LG.TABLE.layouts.ownHand.s[i])); });
  check(mo < 1e-9, 'the own curve recomputed here equals the ledger table (max difference ' + mo + ')');
}
function equiv(s) {                                              // the own-layout count that gives success s: running maximum, linear in between, origin below, last segment extended above
  const env = []; let mx = 0; for (const x of curve) { mx = Math.max(mx, x); env.push(mx); }
  if (s <= 0) return 0;
  let pn = 0, ps = 0;
  for (let i = 0; i < GRID.length; i++) { if (s <= env[i]) return pn + (GRID[i] - pn) * (s - ps) / Math.max(1e-12, env[i] - ps); pn = GRID[i]; ps = env[i]; }
  const a = GRID.length - 1, sl = (GRID[a] - GRID[a - 1]) / Math.max(1e-12, env[a] - env[a - 1]);
  return GRID[a] + sl * (s - env[a]);
}
function wilson(k, n) { const z = 1.96, p = k / n, z2 = z * z, den = 1 + z2 / n, c = (p + z2 / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den; return [Math.max(0, c - h), Math.min(1, c + h)]; }
function eff(ok) { const w = wilson(ok, NT); return { n: equiv(ok / NT), lo: equiv(w[0]), hi: equiv(w[1]) }; }

/* ───── corpora, written out independently ───── */
function popularity(a, seed) { const r = BN.rng(seed), perm = Array.from({ length: NS }, (_, i) => i); BN.shuffle(perm, r); const raw = new Array(NS).fill(0); perm.forEach((c, k) => { raw[c] = Math.pow(k + 1, -a); }); const s = raw.reduce((x, y) => x + y, 0); return raw.map((v) => v / s); }
function drawCounts(p, R, seed) { const r = BN.rng(seed), cum = []; let s = 0; for (const x of p) { s += x; cum.push(s); } const cnt = new Array(NS).fill(0); for (let k = 0; k < R; k++) { const u = r() * s; let c = 0; while (cum[c] < u) c++; cnt[c]++; } return cnt; }
const sum = (a) => a.reduce((x, y) => x + y, 0);
const shareOf = (cnt) => { const R = sum(cnt); return cnt.map((v) => v / R); };
function generation(cnt, cnt0, fresh, seed) { const R = sum(cnt), nf = Math.round(fresh * R), a = drawCounts(shareOf(cnt), R - nf, seed); if (nf > 0) { const b = drawCounts(shareOf(cnt0), nf, seed + 500); for (let c = 0; c < NS; c++) a[c] += b[c]; } return a; }
const kishOf = (cnt) => { const R = sum(cnt); return R * R / sum(cnt.map((v) => v * v)); };
const distinct = (cnt) => cnt.filter((v) => v > 0).length;
/* the clearance of a recorded path to the posts the layout states: where the hand crosses each post's x (found by scanning the segments), the sideways distance to the post */
function clearances(c, um) {
  const w = worldOf(ownTh[c]), P = shifted(c, um).P, out = [];
  for (const post of w.posts) { let y = NaN; for (let i = 0; i + 1 < P.length; i++) if (P[i][0] <= post[0] && P[i + 1][0] > post[0]) { y = P[i][1] + (post[0] - P[i][0]) / (P[i + 1][0] - P[i][0]) * (P[i + 1][1] - P[i][1]); break; } out.push(y - post[1]); }
  return out;
}
const CL0 = own.map((d, c) => clearances(c, 0));
const MED = [0, 1, 2, 3, 4].map((k) => { const b = CL0.map((v) => v[k]).sort((x, y) => x - y); return b[Math.floor(0.5 * b.length)]; });
const SIG = (c, um) => { const v = clearances(c, um); let s = 0; for (let k = 0; k < 5; k++) s += v[k] - MED[k]; return s / 5; };
function rigSet(cnt0, share, seed) { const perm = Array.from({ length: NS }, (_, i) => i); BN.shuffle(perm, BN.rng(seed)); const D = distinct(cnt0), want = Math.round(share * D), rig = new Array(NS).fill(false); let m = 0; for (let i = 0; i < NS && m < want; i++) if (cnt0[perm[i]] > 0) { rig[perm[i]] = true; m++; } return rig; }
function welch(cnt, rig, um) {
  const a = [], b = []; for (let c = 0; c < NS; c++) if (cnt[c] > 0) (rig[c] ? a : b).push(SIG(c, rig[c] ? um : 0));
  if (a.length < 3 || b.length < 3) return null;
  const m = (x) => sum(x) / x.length, v = (x) => { const mu = m(x); return sum(x.map((y) => (y - mu) * (y - mu))) / (x.length - 1); };
  const z = (m(a) - m(b)) / Math.sqrt(v(a) / a.length + v(b) / b.length);
  return { z, dhat: m(a) - m(b), nB: a.length, nN: b.length, sdB: Math.sqrt(v(a)), sdN: Math.sqrt(v(b)), flagged: Math.abs(z) > 3 };
}
/* a corpus and its policy, from a spec {mode, R, a, gens, fresh, rig, act, seed, rigSeed, delta}: the independent counterpart of ES.build */
function build(spec) {
  const seed = spec.seed || 1, um = Math.round((spec.delta === undefined ? DELTA : spec.delta) * 1e6);
  let cnt0;
  if (spec.mode === 'scripted') { cnt0 = new Array(NS).fill(0); for (let c = 0; c < 80; c++) cnt0[c] = Math.round(spec.R / 80); } else cnt0 = drawCounts(popularity(spec.a, 5), spec.R, 100 + seed);
  const R = sum(cnt0); let cnt = cnt0;
  for (let g = 1; g <= (spec.gens || 0); g++) cnt = generation(cnt, cnt0, spec.fresh || 0, 700 * seed + g);
  const rig = rigSet(cnt0, spec.rig || 0, spec.rigSeed || 77), off = cnt.map((v, c) => (v > 0 ? (rig[c] ? um : 0) : null));
  let ck = null;
  if (spec.rig > 0) {
    ck = welch(cnt, rig, um);
    if (ck && ck.flagged && spec.act === 'drop') for (let c = 0; c < NS; c++) if (rig[c]) off[c] = null;
    if (ck && ck.flagged && spec.act === 'fix') for (let c = 0; c < NS; c++) if (rig[c] && off[c] !== null) off[c] = Math.round((um * 1e-6 - ck.dhat) * 1e4) * 100;
  }
  const r = lookup(off), e = eff(r.ok);
  let mass = 0; for (let c = 0; c < NS; c++) if (cnt[c] > 0) mass += cnt0[c] / R;
  return { cnt, cnt0, R, D: distinct(cnt), D0: distinct(cnt0), kish: kishOf(cnt), ck, ok: r.ok, succ: r.succ, e, mass, rig, off };
}

/* ───── 1. the engine's seeded counts, signature and scoring are what is recomputed here ───── */
{
  const a = ES.draw(ES.popularity(1, 5), 640, 101), b = drawCounts(popularity(1, 5), 640, 101);
  check(a.every((v, c) => v === b[c]), 'ES.draw equals the independent draw');
  const g1 = ES.generation(a, a, 640, 0.1, 701), g2 = generation(b, b, 0.1, 701);
  check(g1.every((v, c) => v === g2[c]), 'ES.generation equals the independent generation');
  let mx = 0; for (let c = 0; c < NS; c++) mx = Math.max(mx, Math.abs(ES.sig(c) - SIG(c, 0)));
  check(mx < 2e-4, 'the engine signature agrees with the independent one to 0.2 mm (max ' + mx + ')');
}

/* ───── 2. an hour is not an hour: 80 layouts repeated, every repeat a different file ───── */
const SCR = build({ mode: 'scripted', R: 2560 });
put('own80', pc(SCR.succ), 1);
const rep = {};
{
  const MS = [1, 2, 4, 8, 16, 32], reps = own.slice(0, 80).map((d, k) => [d]);
  const hash = new Set(); let files = 0;
  for (let k = 0; k < 80; k++) for (let r = 1; r < 32; r++) reps[k].push(record(ownTh[k], 90000 + 1000 * k + r));
  for (const m of MS) {
    const stores = reps.map((rs) => { const P = [], end = []; for (const d of rs.slice(0, m)) { const base = P.length; for (const p of d.P) { P.push(p); end.push(base + d.n - 1); } } return { P, end }; });
    let ok = 0;
    for (let k = 0; k < NT; k++) { let best = Infinity, bc = -1; for (let c = 0; c < 80; c++) { const d = DMAT[k * NS + c]; if (d < best) { best = d; bc = c; } } if (followStore(tests[k], stores[bc].P, stores[bc].end, 1000 * EVSEED + k + 1) === 1) ok++; }
    rep[m] = ok / NT; put('rep_s' + m, pc(ok / NT), 1); put('rep_h' + m, 80 * m * SEC / 3600, 2);
  }
  for (let k = 0; k < 80; k++) for (const d of reps[k]) { hash.add(d.P.map((p) => p[0] + ',' + p[1]).join(';')); files++; }
  put('files32', hash.size, 0); check(files === 2560 && hash.size === 2560, 'the 2560 recorded files are all different (' + hash.size + ' distinct)');
  put('rep_min', pc(Math.min(...MS.map((m) => rep[m]))), 1); put('rep_max', pc(Math.max(...MS.map((m) => rep[m]))), 1);
  check(Math.abs(rep[1] - SCR.succ) < 1e-9, 'the repeat-keeping policy with one repeat is the policy of the widget');
  check(pc(Math.max(...MS.map((m) => rep[m])) - Math.min(...MS.map((m) => rep[m]))) < 0.6, 'repeats change success by under 0.6 point');
}
put('rec_ep', 2560, 0); put('rec_h', 2560 * SEC / 3600, 2); put('eff_h', 80 * SEC / 3600, 3); put('ratio_scr', 2560 / 80, 0);
put('sc_rec_h', 100000 * SEC / 3600, 0); put('sc_eff_h', 800 * SEC / 3600, 2); put('sc_ratio', 100000 / 800, 0);
put('p_own_h', LG.price('own'), 1); put('cost_rec', LG.price('own') * 2560 * SEC / 3600, 0); put('cost_eff', LG.price('own') * 80 * SEC / 3600, 1); put('cost_eff_h', LG.price('own') * 32, 0);
check(Math.abs(LG.hours(2560) - 2560 * SEC / 3600) < 1e-9, 'ledger hours agree with 9.3 s per episode');

/* ───── 3. counts against the measured size: five corpora ───── */
const TAB = [['t1', { mode: 'scripted', R: 2560 }], ['t2', { mode: 'field', a: 0, R: 80 }], ['t3', { mode: 'field', a: 1, R: 320 }], ['t4', { mode: 'field', a: 2, R: 2560 }], ['t5', { mode: 'field', a: 2, R: 10240 }]];
const TB = {};
for (const [k, spec] of TAB) {
  const b = build(spec); TB[k] = b;
  put(k + '_R', b.R, 0); put(k + '_D', b.D, 0); put(k + '_K', b.kish, 1); put(k + '_n', b.e.n, 0); put(k + '_lo', b.e.lo, 0); put(k + '_hi', b.e.hi, 0); put(k + '_s', pc(b.succ), 1); put(k + '_r', b.R / b.e.n, 1); put(k + '_kr', b.e.n / b.kish, 0); put(k + '_h', b.R * SEC / 3600, 1); put(k + '_eh', b.e.n * SEC / 3600, 2);
  const es = ES.build(spec); check(es.score.ok === b.ok && es.D === b.D && Math.abs(es.kish - b.kish) < 1e-9 && Math.abs(es.eff.n - b.e.n) < 1e-9, 'ES.build agrees with the independent corpus ' + k);
}
{
  const r3 = [], r4 = [], r5 = [];
  for (let s = 1; s <= 8; s++) { for (const [k, spec, arr] of [['t3', TAB[2][1], r3], ['t4', TAB[3][1], r4], ['t5', TAB[4][1], r5]]) { const b = build(Object.assign({}, spec, { seed: s })); arr.push([b.e.n / b.D, b.succ, b.D, b.R / b.e.n]); } }
  put('nd3_lo', lo(r3.map((x) => x[0])), 2); put('nd3_hi', hi(r3.map((x) => x[0])), 2); put('nd4_lo', lo(r4.map((x) => x[0])), 2); put('nd4_hi', hi(r4.map((x) => x[0])), 2);
  put('nd5_lo', lo(r5.map((x) => x[0])), 2); put('nd5_hi', hi(r5.map((x) => x[0])), 2); put('r5_lo', lo(r5.map((x) => x[3])), 0); put('r5_hi', hi(r5.map((x) => x[3])), 0);
  put('d3_lo', lo(r3.map((x) => x[2])), 0); put('d3_hi', hi(r3.map((x) => x[2])), 0);
  check(lo(r3.concat(r4).map((x) => x[0])) > 0.75 && hi(r3.concat(r4).map((x) => x[0])) < 1.2, 'the measured size is within 25 % of the number of situations on the steep part of the curve');
}
check(TB.t2.kish < TB.t2.e.n && TB.t3.kish < TB.t3.e.n && TB.t4.kish < TB.t4.e.n && TB.t5.kish < TB.t5.e.n && Math.abs(TB.t1.kish - TB.t1.e.n) < 1e-6, 'Kish on the counts is below the measured size in every row but the first, where it is equal');
check(TB.t1.R / TB.t1.e.n > 31.9 && TB.t5.R / TB.t5.e.n > 100, 'the repeat factors are about 32 and over 100');
/* Kish's formula applied to the cluster counts is the inverse collision probability: brute force over all pairs of episodes of a small corpus */
{
  const cnt = TB.t3.cnt.map((v, c) => (c < 30 ? v : 0)), R = sum(cnt), ep = []; cnt.forEach((v, c) => { for (let i = 0; i < v; i++) ep.push(c); });
  let same = 0; for (let i = 0; i < ep.length; i++) for (let j = 0; j < ep.length; j++) if (ep[i] === ep[j]) same++;
  check(Math.abs(same / (R * R) - 1 / kishOf(cnt)) < 1e-12, 'the share of equal pairs of episodes is the inverse of (sum k)^2 / sum k^2');
  check(Math.abs(kishOf(new Array(80).fill(32).concat(new Array(176).fill(0))) - 80) < 1e-9, 'equal counts give Kish = number of situations');
}

/* ───── 4. duplicates are up-weighted: the average of the demonstrations near a layout ───── */
function blendScore(cnt, h, K) {
  let ok = 0; const idx0 = []; for (let c = 0; c < NS; c++) if (cnt[c] > 0) idx0.push(c);
  for (let k = 0; k < NT; k++) {
    const idx = idx0.slice().sort((a, b) => DMAT[k * NS + a] - DMAT[k * NS + b]).slice(0, K), nmin = Math.min(...idx.map((c) => own[c].n)), P = [];
    const wts = idx.map((c) => cnt[c] * Math.exp(-DMAT[k * NS + c] * DMAT[k * NS + c] / (2 * h * h))); let sw = sum(wts), use = wts;
    if (!(sw > 1e-300)) { use = idx.map((c, i) => (i === 0 ? 1 : 0)); sw = 1; }
    for (let i = 0; i < nmin; i++) { let x = 0, y = 0; idx.forEach((c, j) => { x += use[j] * own[c].P[i][0]; y += use[j] * own[c].P[i][1]; }); P.push([x / sw, y / sw]); }
    if (followStore(tests[k], P, null, 1000 * EVSEED + k + 1) === 1) ok++;
  }
  return ok / NT;
}
function skewCounts(a, seed) { const r = BN.rng(seed), perm = Array.from({ length: 80 }, (_, i) => i); BN.shuffle(perm, r); const p = new Array(NS).fill(0); perm.forEach((c, k) => { p[c] = Math.pow(k + 1, -a); }); const s = sum(p); return drawCounts(p.map((v) => v / s), 2560, 9); }
const BLH = 0.015, BLK = 8, blr = { 0: [], 1: [], 2: [] };
for (const a of [0, 1, 2]) for (let s = 3; s <= 10; s++) { const cnt = skewCounts(a, s), look = lookup(cnt.map((v) => (v > 0 ? 0 : null))).succ; blr[a].push({ K: kishOf(cnt), P: distinct(cnt), look, avg: blendScore(cnt, BLH, BLK) }); }
for (const a of [0, 1, 2]) { const x = blr[a][0]; put('bl_k' + a, x.K, 1); put('bl_p' + a, x.P, 0); put('bl_look' + a, pc(x.look), 1); put('bl_avg' + a, pc(x.avg), 1); put('bl_col' + a, 100 / x.K, 1);
  put('bl_avg' + a + '_lo', pc(lo(blr[a].map((y) => y.avg))), 1); put('bl_avg' + a + '_hi', pc(hi(blr[a].map((y) => y.avg))), 1); put('bl_look' + a + '_lo', pc(lo(blr[a].map((y) => y.look))), 1); put('bl_look' + a + '_hi', pc(hi(blr[a].map((y) => y.look))), 1); }
put('bl_loss1', F.bl_avg0 - F.bl_avg1, 1); put('bl_loss2', F.bl_avg0 - F.bl_avg2, 1);
check(F.bl_avg0 > F.bl_look0 + 5, 'with equal counts the average of neighbours beats the copy of the nearest');
check(F.bl_avg2_hi < F.bl_avg0 - 15 && F.bl_avg1_hi < F.bl_avg0 - 3 && F.bl_avg2_lo < F.bl_avg0 - 30, 'skewed counts hurt the averaging learner');
check(F.bl_look1_hi - F.bl_look1_lo < 0.01 && F.bl_look1 > 84, 'the lookup is not moved by counts');

/* ───── 5. a bad batch looks like a good one ───── */
const RG = {};
for (const [tag, share] of [['10', 0.10], ['25', 0.25]]) for (const act of ['keep', 'drop', 'fix']) {
  const b = build({ mode: 'scripted', R: 2560, rig: share, act }); RG[tag + act] = b;
  put('rg' + tag + '_' + act + '_s', pc(b.succ), 1); put('rg' + tag + '_' + act + '_n', b.e.n, 0); put('rg' + tag + '_' + act + '_lo', b.e.lo, 0); put('rg' + tag + '_' + act + '_hi', b.e.hi, 0);
  const es = ES.build({ mode: 'scripted', R: 2560, rig: share, act }); check(es.score.ok === b.ok && Math.abs(es.check.z - b.ck.z) < 1e-6 * Math.abs(b.ck.z) + 1e-9, 'ES.build agrees with the independent rig corpus ' + tag + act);
}
{
  const b = RG['25keep'], ck = b.ck, nB = ck.nB;
  put('rg25_keep_n1', RG['25keep'].e.n, 1); put('rg25_drop_n1', RG['25drop'].e.n, 1); put('rg_z', ck.z, 0); put('rg_dhat', ck.dhat * 100, 2); put('rg_sdB', ck.sdB * 1000, 1); put('rg_sdN', ck.sdN * 1000, 1); put('rg_nB', nB, 0); put('rg_nN', ck.nN, 0);
  put('rg_detect', 3 * Math.sqrt(ck.sdB * ck.sdB / ck.nB + ck.sdN * ck.sdN / ck.nN) * 1000, 2);
  put('rg_rho', (RG['25keep'].e.n - RG['25drop'].e.n) / nB, 2);
  put('rg_drop_gain', pc(RG['25drop'].succ - RG['25keep'].succ), 1); put('rg_fix_gain', pc(RG['25fix'].succ - RG['25keep'].succ), 1); put('rg_loss', pc(SCR.succ - RG['25keep'].succ), 1);
  let g = 1e9, bd = 1e9, e0 = 9, e1 = 9, tA = 0, tB = 0; const umD = Math.round(DELTA * 1e6);
  const eucMin = (c, um) => { const w = worldOf(ownTh[c]); let m = 9; for (const p of shifted(c, um).P) for (const q of w.posts) m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1])); return m; };
  for (let c = 0; c < 80; c++) { g = Math.min(g, ...CL0[c].map(Math.abs)); bd = Math.min(bd, ...clearances(c, umD).map(Math.abs)); e0 = Math.min(e0, eucMin(c, 0)); e1 = Math.min(e1, eucMin(c, umD));
    if (shifted(c, umD).P.some((p) => BN.slalom.collide(worldOf(ownTh[c]), p))) tA++; if (shifted(c, 20000).P.some((p) => BN.slalom.collide(worldOf(ownTh[c]), p))) tB++; }
  put('clr_good', g * 100, 1); put('clr_bad', bd * 100, 1); put('euc_good', e0 * 100, 1); put('euc_bad', e1 * 100, 1); put('touch_d', tA, 0); put('touch_20', tB, 0);
  check(tA === 0 && tB > 0 && e1 > 0.05, 'a 1.5 cm offset passes the contact check of every recording, a 2 cm one does not (' + tA + ', ' + tB + ')');
  check(RG['25keep'].succ < RG['25drop'].succ && RG['25drop'].succ < RG['25fix'].succ && RG['25fix'].succ > SCR.succ - 0.005, 'keeping < dropping < correcting = clean');
  check(ck.flagged && ck.sdB < 0.0015 && ck.sdN < 0.0015, 'the batch is as self-consistent as the rest and the check flags it');
  const rk = [], rd = [], rf = [], rho = [];
  for (let s = 1; s <= 8; s++) { const o = { mode: 'scripted', R: 2560, rig: 0.25, rigSeed: 77 + s }, bk = build(Object.assign({ act: 'keep' }, o)), bd = build(Object.assign({ act: 'drop' }, o)); rk.push(pc(bk.succ)); rd.push(pc(bd.succ)); rf.push(pc(build(Object.assign({ act: 'fix' }, o)).succ)); rho.push((bk.e.n - bd.e.n) / bk.ck.nB); }
  put('rg_rho_lo', lo(rho), 2); put('rg_rho_hi', hi(rho), 2); check(rho.every((x) => x < 0), 'the weight of the rig batch is negative for every choice of its layouts');
  { // the mechanism: the test layouts whose nearest stored layout is one of the rig's
    const kd = lookupDetail(RG['25keep'].off), dd = lookupDetail(RG['25drop'].off), T = []; for (let k = 0; k < NT; k++) if (RG['25keep'].rig[kd.pick[k]]) T.push(k);
    put('mech_n', 100 * T.length / NT, 1); put('mech_keep', 100 * sum(T.map((k) => kd.okv[k])) / T.length, 1); put('mech_drop', 100 * sum(T.map((k) => dd.okv[k])) / T.length, 1);
    check(F.mech_drop > F.mech_keep + 10, 'where the nearest stored layout is the rig\'s, dropping it raises the success of those test layouts');
  }
  put('rr_keep_lo', lo(rk), 1); put('rr_keep_hi', hi(rk), 1); put('rr_drop_lo', lo(rd), 1); put('rr_drop_hi', hi(rd), 1); put('rr_fix_lo', lo(rf), 1); put('rr_fix_hi', hi(rf), 1);
  check(rk.every((x, i) => x < rd[i]), 'over eight choices of the rig layouts, dropping beats keeping every time');
  // detection limit: the smallest offset whose z passes 3 on the same batch
  const dets = [0.0005, 0.001, 0.002, 0.005]; for (const dl of dets) { const w = welch(b.cnt, b.rig, Math.round(dl * 1e6)); put('z_' + Math.round(dl * 10000), w.z, 1); }
}

/* ───── 6. training on your own samples: a generator that memorises, R episodes per generation ───── */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8], LP = {}, GENS = [0, 1, 2, 4, 8];
for (const fresh of [0, 0.1]) for (const g of GENS) {
  const rs = SEEDS.map((s) => build({ mode: 'field', a: 1, R: 640, gens: g, fresh, seed: s })), tag = (fresh ? 'lf' : 'lp') + '_';
  LP[tag + g] = rs;
  put(tag + 'D' + g, med(rs.map((r) => r.D)), 0); put(tag + 's' + g, med(rs.map((r) => pc(r.succ))), 1); put(tag + 'm' + g, med(rs.map((r) => pc(r.mass))), 0); put(tag + 'K' + g, med(rs.map((r) => r.kish)), 0);
  put(tag + 'Dlo' + g, lo(rs.map((r) => r.D)), 0); put(tag + 'Dhi' + g, hi(rs.map((r) => r.D)), 0); put(tag + 'slo' + g, lo(rs.map((r) => pc(r.succ))), 1); put(tag + 'shi' + g, hi(rs.map((r) => pc(r.succ))), 1);
  put(tag + 'n' + g, med(rs.map((r) => r.e.n)), 0);
}
put('lp_sloss8', F.lp_s0 - F.lp_s8, 1); put('lp_keep8', 100 * F.lp_D8 / F.lp_D0, 0); put('lp_massloss8', 100 - F.lp_m8, 0); put('lp_sitloss8', 100 - 100 * F.lp_D8 / F.lp_D0, 0); put('lf_keep8', 100 * F.lf_D8 / F.lf_D0, 0);
check(LP['lp_8'].every((r) => r.succ < LP['lp_0'].find((q) => q.D0 === r.D0 && q.R === r.R).succ), 'eight generations of self-training lower the success on every draw');
check(F.lp_massloss8 < 0.5 * F.lp_sitloss8, 'an average over the recorded episodes sees less than half of the loss of layouts');
check(med(LP['lf_8'].map((r) => r.D)) > med(LP['lp_8'].map((r) => r.D)) + 15, 'a tenth of the original corpus kept each generation holds many more situations');
{ // closed forms against many draws
  const c0 = TB.t3.cnt, R3 = 320, p0 = shareOf(c0); let dm = 0, h = 0, n1 = 0, n1s = 0; const NMC = 300;
  const ED = sum(c0.map((v) => 1 - Math.pow(1 - v / R3, R3))), Gi0 = 1 - sum(p0.map((v) => v * v)); let gi = 0;
  for (let s = 0; s < NMC; s++) { const c1 = drawCounts(p0, R3, 9000 + s); dm += distinct(c1) / NMC; gi += (1 - sum(shareOf(c1).map((v) => v * v))) / NMC; c0.forEach((v, c) => { if (v === 1) { n1++; if (c1[c] > 0) n1s++; } }); }
  put('cf_ED1', ED, 1); put('cf_D1_mc', dm, 1); put('cf_D0', distinct(c0), 0); put('cf_gi_pred', (1 - 1 / R3) * Gi0, 4); put('cf_gi_mc', gi, 4); put('cf_single', 100 * (1 - Math.pow(1 - 1 / R3, R3)), 1); put('cf_single_mc', 100 * n1s / n1, 1);
  put('cf_decay8', Math.pow(1 - 1 / 640, 8), 4); put('cf_e', 100 * (1 - Math.exp(-1)), 1);
  check(Math.abs(ED - dm) < 0.8, 'expected distinct situations after one generation: closed form ' + ED + ' against ' + dm);
  check(Math.abs((1 - 1 / R3) * Gi0 - gi) < 0.003, 'the diversity 1 - sum p^2 shrinks by 1 - 1/R per generation (' + (1 - 1 / R3) * Gi0 + ' against ' + gi + ')');
  check(Math.abs(100 * n1s / n1 - 100 * (1 - Math.pow(1 - 1 / R3, R3))) < 3, 'a singleton survives a generation with probability 1 - (1 - 1/R)^R');
  const R3b = R3, c = ES.expectedDistinct(c0, R3b); check(Math.abs(c - ED) < 1e-9, 'ES.expectedDistinct is the closed form');
}

/* ───── 7. the checkpoint ───── */
{
  const cnt = [300].concat(new Array(300).fill(1)), R = sum(cnt), K = R * R / sum(cnt.map((v) => v * v)), E20 = sum(cnt.map((v) => 1 - Math.pow(1 - v / R, 20)));
  put('ck_R', R, 0); put('ck_D', cnt.length, 0); put('ck_K', K, 2); put('ck_E20', E20, 1); put('ck_col', 100 / K, 1); put('ck_hs', 100 * (1 - Math.pow(0.5, 20)), 0);
}

/* ───── 8. the widget prints what the independent computation gives ───── */
const html = path.join(root, dir, '22_effective_hours.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const RIDX = (R) => Math.round(Math.log2(R / 80));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const fmtD = (s) => s;
  const state = (tag, spec) => {
    pg.set('w07-col', spec.mode === 'scripted' ? 'scripted' : 'a' + spec.a); pg.set('w07-R', RIDX(spec.R)); pg.set('w07-rig', String(spec.rig || 0)); pg.set('w07-act', spec.act || 'keep'); pg.set('w07-gen', String(spec.gens || 0)); pg.set('w07-fresh', String(spec.fresh || 0)); pg.drain();
    const b = build(spec), hrs = b.R * SEC / 3600;
    eqd('w07-rec', b.R, 0, tag + ' recorded episodes'); eqd('w07-rech', hrs, hrs >= 10 ? 1 : hrs >= 1 ? 2 : 3, tag + ' recorded hours'); eqd('w07-D', b.D, 0, tag + ' situations'); eqd('w07-kish', b.kish, 1, tag + ' Kish');
    eqd('w07-neq', b.e.n, 0, tag + ' effective size'); eqd('w07-succ', pc(b.succ), 1, tag + ' success'); eqd('w07-effh', b.e.n * SEC / 3600, 3, tag + ' effective hours'); eqd('w07-ratio', b.R / b.e.n, 0, tag + ' recorded per effective');
    eqd('w07-cph', LG.price('own') * b.R / b.e.n, 0, tag + ' cost per effective hour'); eqd('w07-lost', b.D0 - b.D + (b.ck && b.ck.flagged && spec.act === 'drop' ? b.ck.nB : 0), 0, tag + ' situations lost or dropped'); eqd('w07-mass', pc(b.mass), 0, tag + ' mass kept');
    const iv = pg.text('w07-neq').replace(/,/g, '').match(/-?\d+(\.\d+)?/g) || []; if (iv.length < 3 || Math.abs(+iv[1] - Math.round(b.e.lo)) > 1 || Math.abs(+iv[2] - Math.round(b.e.hi)) > 1) fail(tag + ': effective-size interval prints ' + pg.text('w07-neq') + ', want about ' + Math.round(b.e.lo) + ' to ' + Math.round(b.e.hi));
    if (b.ck) { eqd('w07-z', b.ck.z, 0, tag + ' z'); eqd('w07-dhat', b.ck.dhat * 100, 2, tag + ' estimated offset'); }
    return b;
  };
  const W = {};
  W.def = state('default', { mode: 'scripted', R: 2560 });
  W.lo = state('R=80', { mode: 'scripted', R: 80 });
  W.hi = state('R=10240', { mode: 'scripted', R: 10240 });
  put('x_lo_s', pc(W.lo.succ), 1); put('x_hi_s', pc(W.hi.succ), 1); put('x_hi_h', W.hi.R * SEC / 3600, 1); put('x_hi_ratio', W.hi.R / W.hi.e.n, 0); put('x_hi_cph', LG.price('own') * W.hi.R / W.hi.e.n, 0);
  put('x_def_s', pc(W.def.succ), 1); put('x_def_n', W.def.e.n, 0); put('x_def_lo', W.def.e.lo, 0); put('x_def_hi', W.def.e.hi, 0); put('x_def_effh', W.def.e.n * SEC / 3600, 3); put('x_def_ratio', W.def.R / W.def.e.n, 0); put('x_def_cph', LG.price('own') * W.def.R / W.def.e.n, 0); put('x_def_K', W.def.kish, 1);
  W.f1 = state('field a=1 R=640', { mode: 'field', a: 1, R: 640 });
  W.f1b = state('field a=1 R=320', { mode: 'field', a: 1, R: 320 });
  W.f2 = state('field a=2 R=10240', { mode: 'field', a: 2, R: 10240 });
  W.f0 = state('field a=0 R=2560', { mode: 'field', a: 0, R: 2560 });
  put('x_f1_D', W.f1.D, 0); put('x_f1_K', W.f1.kish, 1); put('x_f1_s', pc(W.f1.succ), 1); put('x_f1_n', W.f1.e.n, 0);
  put('x_f2_D', W.f2.D, 0); put('x_f2_K', W.f2.kish, 1); put('x_f2_s', pc(W.f2.succ), 1); put('x_f2_n', W.f2.e.n, 0); put('x_f2_lo', W.f2.e.lo, 0); put('x_f2_hi', W.f2.e.hi, 0); put('x_f2_ratio', W.f2.R / W.f2.e.n, 0); put('x_f2_h', W.f2.R * SEC / 3600, 1); put('x_f2_effh', W.f2.e.n * SEC / 3600, 2);
  put('x_f0_D', W.f0.D, 0); put('x_f0_s', pc(W.f0.succ), 1);
  W.rk = state('rig 25 % kept', { mode: 'scripted', R: 2560, rig: 0.25, act: 'keep' });
  W.rd = state('rig 25 % dropped', { mode: 'scripted', R: 2560, rig: 0.25, act: 'drop' });
  W.rf = state('rig 25 % corrected', { mode: 'scripted', R: 2560, rig: 0.25, act: 'fix' });
  W.rk10 = state('rig 10 % kept', { mode: 'scripted', R: 2560, rig: 0.10, act: 'keep' });
  W.rkf = state('field rig 25 % kept', { mode: 'field', a: 1, R: 640, rig: 0.25, act: 'keep' });
  for (const [k, b] of [['rk', W.rk], ['rd', W.rd], ['rf', W.rf]]) { put('x_' + k + '_s', pc(b.succ), 1); put('x_' + k + '_n', b.e.n, 0); put('x_' + k + '_lo', b.e.lo, 0); put('x_' + k + '_hi', b.e.hi, 0); }
  put('x_rk_z', W.rk.ck.z, 0); put('x_rk_dhat', W.rk.ck.dhat * 100, 2); put('x_rk10_s', pc(W.rk10.succ), 1); put('x_rk10_n', W.rk10.e.n, 0); put('x_rkf_s', pc(W.rkf.succ), 1); put('x_rkf_n', W.rkf.e.n, 0);
  W.g8 = state('field a=1 R=640 g=8', { mode: 'field', a: 1, R: 640, gens: 8 });
  W.g8f = state('field a=1 R=640 g=8 fresh 10 %', { mode: 'field', a: 1, R: 640, gens: 8, fresh: 0.1 });
  W.g1 = state('field a=1 R=640 g=1', { mode: 'field', a: 1, R: 640, gens: 1 });
  W.g8s = state('scripted R=2560 g=8', { mode: 'scripted', R: 2560, gens: 8 });
  put('x_g0_D', W.f1.D, 0); put('x_g0_s', pc(W.f1.succ), 1); put('x_g1_D', W.g1.D, 0); put('x_g1_s', pc(W.g1.succ), 1);
  put('x_g8_D', W.g8.D, 0); put('x_g8_s', pc(W.g8.succ), 1); put('x_g8_m', pc(W.g8.mass), 0); put('x_g8_K', W.g8.kish, 1); put('x_g8_lost', W.g8.D0 - W.g8.D, 0); put('x_g8_n', W.g8.e.n, 0);
  put('x_g8f_D', W.g8f.D, 0); put('x_g8f_s', pc(W.g8f.succ), 1); put('x_g8f_m', pc(W.g8f.mass), 0); put('x_g8s_D', W.g8s.D, 0); put('x_g8s_s', pc(W.g8s.succ), 1);
  put('x_g8_ED', ES.expectedDistinct(W.g1.cnt0, 640), 0);
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
