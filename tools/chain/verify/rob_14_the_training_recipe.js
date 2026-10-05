#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 14 (the recipe: stages, mixtures and forgetting).
 * Re-derives every number the lesson quotes with code written separately from forget_lab.js: its own network (nested arrays, own forward, backward and Adam, checked against
 * finite differences), its own vocabulary, probe, layouts, rollouts and plant, its own stages and corrections.  Only the world's primitives (arm, expert, collision, path,
 * BN.demos / BN.rollout for the expert's runs) and the seeded generators come from bench.js.  The arithmetic is written in the same order as the engine's on purpose, so that
 * the two agree to the last bit for the widget's seed, and this file asserts that they do.  Then the page's widget is driven and must print the independent numbers.
 * Five seeds (each its own vocabulary, initial weights and batches) give the means and ranges the prose quotes for effects.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const FL = require(path.join(root, dir, 'forget_lab.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
const lo = (a) => Math.min(...a), hi = (a) => Math.max(...a);
const LOG = (m) => console.error(m);

/* ───── the protocol, restated ───── */
const DW = 8, DIN = 12, NK = 10, DOUT = 12, H = 24, NWORDS = 120, SIGMA = 0.15, BATCH = 40, LR = 0.003, FLOOR = 0.05, PRE = 4000, S3 = 300, LR3 = 0.002, EVERY = 50;
const NPROBE = 600, GUST = 0.08, JIT = 0.01, VS = 0.15, DLS = 1e-4, ALARM = 5;
const SHIFTS = []; for (let i = 0; i < 12; i++) SHIFTS.push(-0.10 + 0.2 * i / 11);
const TILTS = [-0.15, 0, 0.15];
const LAYOUTS = []; for (const s of SHIFTS) for (const t of TILTS) LAYOUTS.push({ shift: s, tilt: t });
const WORLDS = LAYOUTS.map((th) => { const w = BN.slalom.world(2, { shift: th.shift, tilt: th.tilt }); return { th, w, xe: BN.slalom.xEnd(w), T: BN.slalom.horizon(w) }; });
check(PRE === 4000 && BATCH === 40 && S3 === 300 && LR === 0.003 && LR3 === 0.002 && FLOOR === 0.05 && GUST === 0.08 && SIGMA === 0.15 && NWORDS === 120 && NK === 10 && H === 24 && DW === 8 && DIN === 12 && DOUT === 12 && NPROBE === 600 && EVERY === 50 && LAYOUTS.length === 36 && ALARM === 5, 'the constants the prose states in plain text are the experiment\'s');

/* ───── the vocabulary and its stream ───── */
function vocab(seed) {
  const r = BN.rng(seed), words = [], cls = [];
  for (let i = 0; i < NWORDS; i++) { const v = []; for (let j = 0; j < DW; j++) v.push(BN.randn(r)); words.push(v); cls.push(i % NK); }
  BN.shuffle(cls, r);
  return { words, cls };
}
function rendition(voc, rng, n) {                                   // a random word among the first n, as a 12-vector with the robot slots at zero; and the word's index
  const k = Math.floor(rng() * n), x = [];
  for (let j = 0; j < DW; j++) x.push(voc.words[k][j] + SIGMA * BN.randn(rng));
  for (let j = DW; j < DIN; j++) x.push(0);
  return { x, k };
}
function probeSet(voc) { const rng = BN.rng(777), P = []; for (let i = 0; i < NPROBE; i++) P.push(rendition(voc, rng, NWORDS)); return P; }

/* ───── the network, from scratch: nested arrays ───── */
function newNet(seed) {
  const r = BN.rng(seed), mat = (n, m, sc) => { const a = []; for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < m; j++) row.push(sc * BN.randn(r)); a.push(row); } return a; };
  const net = { W1: mat(DIN, H, Math.sqrt(2 / (DIN + H))), b1: new Array(H).fill(0), W2: mat(H, H, Math.sqrt(2 / (H + H))), b2: new Array(H).fill(0), W3: mat(H, DOUT, Math.sqrt(2 / (H + DOUT))), b3: new Array(DOUT).fill(0) };
  for (let i = 0; i < H; i++) for (let k = NK; k < DOUT; k++) net.W3[i][k] = 0;
  return net;
}
const zerosLike = (a) => (Array.isArray(a) ? a.map(zerosLike) : (a !== null && typeof a === 'object' ? Object.fromEntries(Object.keys(a).map((k) => [k, zerosLike(a[k])])) : 0));
const deep = (a) => a.map((x) => (Array.isArray(x) ? deep(x) : x));
const copyNet = (n) => ({ W1: deep(n.W1), b1: n.b1.slice(), W2: deep(n.W2), b2: n.b2.slice(), W3: deep(n.W3), b3: n.b3.slice() });
const newOpt = (n) => ({ t: 0, m: zerosLike(n), v: zerosLike(n) });
function fwd(net, x, k0, k1) {
  const a1 = net.b1.slice(), a2 = net.b2.slice(), o = new Array(DOUT).fill(0);
  for (let i = 0; i < DIN; i++) { const xi = x[i]; if (xi === 0) continue; const row = net.W1[i]; for (let j = 0; j < H; j++) a1[j] += xi * row[j]; }
  for (let j = 0; j < H; j++) a1[j] = Math.tanh(a1[j]);
  for (let i = 0; i < H; i++) { const ai = a1[i], row = net.W2[i]; for (let j = 0; j < H; j++) a2[j] += ai * row[j]; }
  for (let j = 0; j < H; j++) a2[j] = Math.tanh(a2[j]);
  for (let k = k0; k < k1; k++) o[k] = net.b3[k];
  for (let i = 0; i < H; i++) { const bi = a2[i], row = net.W3[i]; for (let k = k0; k < k1; k++) o[k] += bi * row[k]; }
  return { a1, a2, o };
}
function exampleLoss(net, x, kind, tgt) {                           // the squared error one example is charged
  const f = fwd(net, x, 0, DOUT); let loss = 0;
  if (kind === 0) for (let k = 0; k < NK; k++) { const e = f.o[k] - (k === tgt ? 1 : 0); loss += e * e / NK; }
  else for (let k = NK; k < DOUT; k++) { const e = f.o[k] - tgt[k - NK]; loss += e * e / 2; }
  return loss;
}
function backward(net, g, x, kind, tgt) {                           // adds one example's gradient into g
  const f = fwd(net, x, 0, DOUT), d3 = new Array(DOUT).fill(0); let k0, k1;
  if (kind === 0) { k0 = 0; k1 = NK; for (let k = 0; k < NK; k++) { const e = f.o[k] - (k === tgt ? 1 : 0); d3[k] = 2 * e / NK; } }
  else { k0 = NK; k1 = DOUT; for (let k = NK; k < DOUT; k++) { const e = f.o[k] - tgt[k - NK]; d3[k] = 2 * e / 2; } }
  for (let k = k0; k < k1; k++) g.b3[k] += d3[k];
  const d2 = new Array(H), d1 = new Array(H);
  for (let i = 0; i < H; i++) { const row = net.W3[i], grow = g.W3[i], ai = f.a2[i]; let s = 0; for (let k = k0; k < k1; k++) { grow[k] += ai * d3[k]; s += row[k] * d3[k]; } d2[i] = s * (1 - ai * ai); }
  for (let j = 0; j < H; j++) g.b2[j] += d2[j];
  for (let i = 0; i < H; i++) { const row = net.W2[i], grow = g.W2[i], bi = f.a1[i]; let s = 0; for (let j = 0; j < H; j++) { grow[j] += bi * d2[j]; s += row[j] * d2[j]; } d1[i] = s * (1 - bi * bi); }
  for (let j = 0; j < H; j++) g.b1[j] += d1[j];
  for (let i = 0; i < DIN; i++) { const xi = x[i]; if (xi === 0) continue; const grow = g.W1[i]; for (let j = 0; j < H; j++) grow[j] += xi * d1[j]; }
}
function adamStep(net, opt, g, lr, scale, train) {
  const b1 = 0.9, b2 = 0.999; opt.t++;
  const c1 = 1 - Math.pow(b1, opt.t), c2 = 1 - Math.pow(b2, opt.t);
  const one = (W, gw, m, v, i) => { const gi = gw[i] * scale; m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi; W[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8); };
  const rows = (key) => { for (let i = 0; i < net[key].length; i++) for (let j = 0; j < net[key][i].length; j++) one(net[key][i], g[key][i], opt.m[key][i], opt.v[key][i], j); };
  const vec = (key) => { for (let i = 0; i < net[key].length; i++) one(net[key], g[key], opt.m[key], opt.v[key], i); };
  const cols = (c0, c1_) => { for (let i = 0; i < H; i++) for (let k = c0; k < c1_; k++) one(net.W3[i], g.W3[i], opt.m.W3[i], opt.v.W3[i], k); for (let k = c0; k < c1_; k++) one(net.b3, g.b3, opt.m.b3, opt.v.b3, k); };
  if (train.layer1) { rows('W1'); vec('b1'); }
  if (train.layer2) { rows('W2'); vec('b2'); }
  if (train.kHead) cols(0, NK);
  if (train.bHead) cols(NK, DOUT);
}
const TRAIN = { all: { layer1: true, layer2: true, kHead: true, bHead: true }, layer1: { layer1: true, bHead: true }, head: { bHead: true } };
const lrAt = (lr0, s, S) => lr0 * (FLOOR + (1 - FLOOR) * 0.5 * (1 + Math.cos(Math.PI * (s - 1) / S)));
function trunkDist(a, b) {                                          // Euclidean distance over the two hidden layers, in the order W1, b1, W2, b2
  let s = 0;
  const addMat = (x, y) => { for (let i = 0; i < x.length; i++) for (let j = 0; j < x[i].length; j++) { const d = x[i][j] - y[i][j]; s += d * d; } };
  const addVec = (x, y) => { for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; s += d * d; } };
  addMat(a.W1, b.W1); addVec(a.b1, b.b1); addMat(a.W2, b.W2); addVec(a.b2, b.b2);
  return Math.sqrt(s);
}

/* ───── what the model is asked ───── */
function probe(net, P, voc) {
  let ok = 0, okA = 0, okB = 0, nA = 0, nB = 0, loss = 0;
  for (const p of P) {
    const f = fwd(net, p.x, 0, NK), c = voc.cls[p.k]; let bi = 0, best = -1e9;
    for (let k = 0; k < NK; k++) { if (f.o[k] > best) { best = f.o[k]; bi = k; } const e = f.o[k] - (k === c ? 1 : 0); loss += e * e / NK; }
    const hit = bi === c ? 1 : 0; ok += hit;
    if (p.k < 60) { nA++; okA += hit; } else { nB++; okB += hit; }
  }
  return { acc: ok / NPROBE * 100, accA: okA / nA * 100, accB: okB / nB * 100, loss: loss / NPROBE };
}
const obs = (p, th) => [0, 0, 0, 0, 0, 0, 0, 0, (p[0] + 0.15) / 0.35, (p[1] - 0.55) / 0.15, th.shift / 0.1, th.tilt / 0.15];
function expertLabel(world, q) { const u = BN.slalom.expertAct(world.w, q), J = BN.arm.jac(q, world.w.body); return [(J[0] * u[0] + J[1] * u[1]) / VS, (J[2] * u[0] + J[3] * u[1]) / VS]; }
function framesOf(world, ro, X, Y) { for (let t = 0; t < ro.S.length; t++) { X.push(obs(ro.P[t], world.th)); Y.push(expertLabel(world, ro.S[t])); } }
let DEMOS = null, HELD = null;
function demos() { if (DEMOS) return DEMOS; const X = [], Y = []; WORLDS.forEach((w, i) => { BN.demos(w.w, 3, BN.rng(500 + i), { noise: 0, jit: JIT }).forEach((ro) => framesOf(w, ro, X, Y)); }); return (DEMOS = { X, Y }); }
function held() { if (HELD) return HELD; const X = [], Y = []; WORLDS.forEach((w, i) => { framesOf(w, BN.demos(w.w, 1, BN.rng(8000 + i), { noise: 0, jit: JIT })[0], X, Y); }); return (HELD = { X, Y }); }
function copyError(net, tab) { let se = 0, ss = 0; for (let i = 0; i < tab.X.length; i++) { const f = fwd(net, tab.X[i], NK, DOUT), a = f.o[NK] - tab.Y[i][0], b = f.o[NK + 1] - tab.Y[i][1]; se += a * a + b * b; ss += tab.Y[i][0] * tab.Y[i][0] + tab.Y[i][1] * tab.Y[i][1]; } return Math.sqrt(se / ss) * 100; }
function policyFor(net, world) {                                    // joint state -> joint command: the network's velocity, then the Bench's damped least squares
  return (q) => { const p = BN.arm.fk(q, world.w.body), f = fwd(net, obs(p, world.th), NK, DOUT); return BN.arm.dls(BN.arm.jac(q, world.w.body), [f.o[NK] * VS, f.o[NK + 1] * VS], DLS); };
}
function gaussStep(q, u, noise, rng) {                              // the plant: q += dt (clip(u) + noise N(0,1)), joint 1 first
  const c = [Math.max(-1.5, Math.min(1.5, u[0])), Math.max(-1.5, Math.min(1.5, u[1]))];
  const n0 = noise * BN.randn(rng), n1 = noise * BN.randn(rng);
  q[0] += 0.05 * (c[0] + n0); q[1] += 0.05 * (c[1] + n1);
}
function run(world, pol, rng) {                                     // one rollout: 1 if it reaches the end without touching a post within the horizon
  const dy = JIT * BN.randn(rng), q = BN.slalom.startQ(world.w, dy).slice();
  for (let t = 0; t < world.T; t++) {
    const p = BN.arm.fk(q, world.w.body);
    if (BN.slalom.collide(world.w, p)) return 0;
    if (p[0] > world.xe - 0.02) return 1;
    gaussStep(q, pol(q), GUST, rng);
  }
  return 0;
}
function success(net, R) { let ok = 0; WORLDS.forEach((w, i) => { const pol = policyFor(net, w); for (let r = 0; r < R; r++) ok += run(w, pol, BN.rng(9000 + 1000 * i + r + 1)); }); return ok / (WORLDS.length * R) * 100; }
function corrections(net) {                                         // one rollout of the model per layout, every visited state labelled by the expert
  const X = [], Y = [];
  WORLDS.forEach((w, i) => { framesOf(w, BN.rollout(w.w, policyFor(net, w), BN.rng(5000 + 1000 * i + 1), { noise: GUST, jit: JIT }), X, Y); });
  return { X, Y };
}

/* ───── stage 1 and the later stages ───── */
function stage1(seed, vseed) {
  const voc = vocab(vseed), net = newNet(seed), opt = newOpt(net), rng = BN.rng(21 + seed), P = probeSet(voc);
  for (let s = 1; s <= PRE; s++) {
    const g = zerosLike(net);
    for (let b = 0; b < BATCH; b++) { const r = rendition(voc, rng, NWORDS); backward(net, g, r.x, 0, voc.cls[r.k]); }
    adamStep(net, opt, g, lrAt(LR, s, PRE), 1 / BATCH, TRAIN.all);
  }
  const p = probe(net, P, voc);
  return { seed, voc, net, P, k0: p.acc, kA0: p.accA, kB0: p.accB, kloss0: p.loss };
}
/* cfg: rho, rho3, mult, train, nwords, tail ('corr' | 'konly'), anchor (lambda), steps2 (post-training steps), R (rollouts per layout at the checkpoints; 0 = no success at the
 * checkpoints), every (checkpoint spacing in stage 2), only2 (stop after stage 2) */
function stages(s1, cfg) {
  const rho = cfg.rho || 0, rho3 = cfg.rho3 === undefined ? rho : cfg.rho3, mult = cfg.mult || 1, nwords = cfg.nwords || NWORDS, train = TRAIN[cfg.train || 'all'], lam = cfg.anchor || 0, tail = cfg.tail || 'corr';
  const every = cfg.every || (cfg.steps2 ? Math.round(cfg.steps2 / 12) : Math.round(EVERY / mult)), steps2 = cfg.steps2 || 12 * every, R = cfg.R === undefined ? 4 : cfg.R;
  const net = copyNet(s1.net), opt = newOpt(net), rng = BN.rng(300 + s1.seed), ref = s1.net, curve = [];
  const rec = (s, stage) => { const p = probe(net, s1.P, s1.voc); const pt = { s, stage, k: p.acc, kA: p.accA, kB: p.accB, kloss: p.loss, d: trunkDist(net, ref), copy: copyError(net, held()) }; if (R > 0) pt.b = success(net, R); curve.push(pt); return pt; };
  rec(0, 2);
  const d = demos();
  const train1 = (S, lr0, tab, nK, nW, doAnchor, from, to) => {
    const nB = BATCH - nK, anc = doAnchor ? lam : 0;
    for (let s = from + 1; s <= to; s++) {
      const g = zerosLike(net);
      if (nB > 0 && tab) for (let b = 0; b < nB; b++) { const id = Math.floor(rng() * tab.X.length); backward(net, g, tab.X[id], 1, tab.Y[id]); }
      for (let b = 0; b < nK; b++) { const r = rendition(s1.voc, rng, nW); backward(net, g, r.x, 0, s1.voc.cls[r.k]); }
      if (anc > 0) for (const key of ['W1', 'b1', 'W2', 'b2']) { const Wq = net[key], Rq = ref[key], Gq = g[key]; if (Array.isArray(Wq[0])) { for (let i = 0; i < Wq.length; i++) for (let j = 0; j < Wq[i].length; j++) Gq[i][j] += BATCH * anc * (Wq[i][j] - Rq[i][j]); } else for (let i = 0; i < Wq.length; i++) Gq[i] += BATCH * anc * (Wq[i] - Rq[i]); }
      adamStep(net, opt, g, lrAt(lr0, s, S), 1 / BATCH, train);
    }
  };
  const nK2 = Math.round(rho * BATCH), nK3 = Math.round(rho3 * BATCH);
  for (let from = 0; from < steps2; from += every) { const to = Math.min(steps2, from + every); train1(steps2, LR * mult, d, nK2, nwords, true, from, to); rec(to, 2); }
  const post = curve[curve.length - 1], postNet = copyNet(net);
  if (cfg.only2) return { curve, post, postNet, steps2 };
  const fresh = newOpt(net); opt.t = 0; opt.m = fresh.m; opt.v = fresh.v;
  let ncor = 0, tab3 = null;
  if (tail === 'corr') { const cor = corrections(net); ncor = cor.X.length; tab3 = { X: d.X.concat(cor.X), Y: d.Y.concat(cor.Y) }; }
  const nK3eff = tail === 'corr' ? nK3 : BATCH, nW3 = tail === 'corr' ? nwords : NWORDS;
  for (let from = 0; from < S3; from += EVERY) { const to = Math.min(S3, from + EVERY); train1(S3, LR3, tab3, nK3eff, nW3, tail === 'corr', from, to); rec(steps2 + to, 3); }
  const end = curve[curve.length - 1];
  return { curve, post, end, ncor, net, postNet, steps2 };
}
const tfirst = (curve, pred) => { for (const c of curve) if (c.stage === 2 && pred(c)) return c.s; return null; };
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h) * 100, Math.min(1, c + h) * 100]; };

/* ───── the machinery against first principles ───── */
{ // backprop against finite differences, both kinds of example, on a network that has moved off its start
  const net = newNet(3), voc = vocab(5), rng = BN.rng(2);
  for (let i = 0; i < H; i++) for (let k = NK; k < DOUT; k++) net.W3[i][k] = 0.3 * BN.randn(rng);
  const g = zerosLike(net), r = rendition(voc, rng, NWORDS), x = obs([-0.2, 0.5], LAYOUTS[7]), tgt = [0.4, -0.7];
  backward(net, g, r.x, 0, voc.cls[r.k]); backward(net, g, x, 1, tgt);
  const lossAll = () => exampleLoss(net, r.x, 0, voc.cls[r.k]) + exampleLoss(net, x, 1, tgt);
  let worst = 0, checked = 0;
  const probeParam = (arr, i, ga) => { const keep = arr[i], eps = 1e-6; arr[i] = keep + eps; const up = lossAll(); arr[i] = keep - eps; const dn = lossAll(); arr[i] = keep; const num = (up - dn) / (2 * eps); worst = Math.max(worst, Math.abs(num - ga) / (1e-6 + Math.abs(num) + Math.abs(ga))); checked++; };
  for (const [key, two] of [['W1', true], ['W2', true], ['W3', true], ['b1', false], ['b2', false], ['b3', false]]) {
    for (let q = 0; q < 14; q++) { if (two) { const i = (q * 7 + 1) % net[key].length, j = (q * 5 + 2) % net[key][i].length; probeParam(net[key][i], j, g[key][i][j]); } else { const i = (q * 3 + 1) % net[key].length; probeParam(net[key], i, g[key][i]); } }
  }
  F.fd_checked = checked; F.fd_worst = worst;
  check(worst < 1e-5, 'the analytic gradient matches finite differences (worst relative error ' + worst + ' over ' + checked + ' weights)');
}
{ // the Wilson interval used at the end, against the Bench's own
  for (const [k, n] of [[31, 36], [124, 144], [13, 20]]) { const a = wilson(k, n), b = BN.stats.wilson(k, n); check(Math.abs(a[0] - b[0] * 100) < 1e-9 && Math.abs(a[1] - b[1] * 100) < 1e-9, 'Wilson interval of ' + k + '/' + n + ' agrees with the Bench\'s'); }
}

/* ───── seed 1: the numbers of the widget, from the independent implementation, and the engine's agreement ───── */
const S1 = stage1(1, 11);
const e1 = FL.stage1(1); while (e1.advance()) {}
F.k0 = S1.k0; F.kA0 = S1.kA0; F.kB0 = S1.kB0; F.chance = 100 / NK; F.kloss0 = S1.kloss0;
check(e1.k0 === S1.k0 && e1.kloss0 === S1.kloss0, 'stage 1: the engine and the oracle agree on the probe (' + e1.k0 + ' vs ' + S1.k0 + ')');
{ let same = true; for (let i = 0; i < DIN && same; i++) for (let j = 0; j < H; j++) if (e1.net.W1[i * H + j] !== S1.net.W1[i][j]) { same = false; break; }
  for (let i = 0; i < H && same; i++) for (let k = 0; k < DOUT; k++) if (e1.net.W3[i * DOUT + k] !== S1.net.W3[i][k]) { same = false; break; }
  check(same, 'stage 1: the engine and the oracle end with the same weights, bit for bit'); }
F.params = DIN * H + H + H * H + H + H * DOUT + DOUT;
F.demo_frames = demos().X.length; F.held_frames = held().X.length; F.words = NWORDS; F.per_cat = NWORDS / NK; F.layouts = LAYOUTS.length; F.probe_n = NPROBE; F.batch = BATCH; F.pre = PRE; F.s2 = 600; F.s3 = S3;
F.vars_in = DW + 4;

const seedRuns = {};
function seed1(name, cfg, engCfg) {
  const o = stages(S1, cfg); seedRuns[name] = o;
  const eng = FL.run(e1, engCfg); while (eng.advance()) {}
  let worst = 0;
  if (eng.curve.length !== o.curve.length) fail(name + ': the engine has ' + eng.curve.length + ' checkpoints, the oracle ' + o.curve.length);
  else eng.curve.forEach((c, i) => { const q = o.curve[i]; for (const key of ['k', 'kA', 'kB', 'kloss', 'd', 'copy', 'b']) { const dlt = Math.abs(c[key] - q[key]); worst = Math.max(worst, dlt); if (dlt > 1e-9 * Math.max(1, Math.abs(q[key]))) fail(`${name}: checkpoint ${i} (step ${q.s}) ${key}: engine ${c[key]}, oracle ${q[key]}`); } });
  F['agree_' + name] = worst;
  return o;
}
const RHO_DEF = 0.3;
const rhoGrid = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7];
const gridSeed1 = {};
for (const rho of rhoGrid) gridSeed1[rho] = seed1('rho' + rho, { rho }, { variant: 'recipe', rho });
const r0 = gridSeed1[0], D = gridSeed1[RHO_DEF];
const variants1 = {
  lr03: [{ rho: 0, mult: 0.3 }, { variant: 'lr03', rho: 0 }], lr3: [{ rho: 0, mult: 3 }, { variant: 'lr3', rho: 0 }], head: [{ rho: 0, train: 'head' }, { variant: 'head', rho: 0 }],
  layer1: [{ rho: 0, train: 'layer1' }, { variant: 'layer1', rho: 0 }], kend: [{ rho: 0, tail: 'konly' }, { variant: 'kend', rho: RHO_DEF }], half: [{ rho: RHO_DEF, nwords: 60 }, { variant: 'half', rho: RHO_DEF }],
  nomix3: [{ rho: RHO_DEF, rho3: 0 }, { variant: 'nomix3', rho: RHO_DEF }], anchor: [{ rho: 0, anchor: 0.03 }, { variant: 'anchor', rho: RHO_DEF }]
};
for (const k of Object.keys(variants1)) seed1(k, variants1[k][0], variants1[k][1]);
LOG('seed 1 runs done');
{ // the engine's inlined rollout is BN.rollout's: the same outcome on every one of 144 rollouts of the trained default model
  const w = FL.work(), x = new Float64Array(DIN), FW = FL.worlds(); let agree = 0, tot = 0;
  const eng = FL.run(e1, { variant: 'recipe', rho: RHO_DEF, curve: false }); while (eng.advance()) {}
  for (let i = 0; i < FW.length; i++) for (let r = 0; r < 4; r++) { const a = FL.rollout(eng.net, w, x, FW[i], BN.rng(9000 + 1000 * i + r + 1)), b = run(WORLDS[i], policyFor(D.net, WORLDS[i]), BN.rng(9000 + 1000 * i + r + 1)); tot++; if (a === b) agree++; }
  F.rollout_agree = agree; F.rollout_total = tot; check(agree === tot, 'the engine\'s rollout and the oracle\'s agree on every rollout (' + agree + ' of ' + tot + ')');
  check(eng.end.k === D.end.k && eng.end.b === D.end.b && eng.afterPost.b === D.post.b, 'a run without intermediate checkpoints ends exactly where the full run does');
}

const pick = (o, s) => o.curve.find((c) => c.s === s);
for (const s of [0, 50, 100, 150, 200, 250, 300, 600]) { const c = pick(r0, s); F['c0_k' + s] = c.k; F['c0_b' + s] = c.b; F['c0_cp' + s] = c.copy; }
F.p0_k = r0.post.k; F.p0_b = r0.post.b; F.p0_copy = r0.post.copy; F.p0_d = r0.post.d; F.p0_dk = r0.post.kloss - S1.kloss0; F.p0_kdrop = S1.k0 - r0.post.k;
F.e0_k = r0.end.k; F.e0_b = r0.end.b; F.e0_copy = r0.end.copy; F.e0_gain = r0.end.b - r0.post.b; F.ncor0 = r0.ncor;
F.a0_alarm = tfirst(r0.curve, (c) => c.s > 0 && c.k < S1.k0 - ALARM); F.t50_0 = tfirst(r0.curve, (c) => c.b >= 50);
F.a0_k_at_alarm = pick(r0, F.a0_alarm).k; F.a0_b_at_alarm = pick(r0, F.a0_alarm).b; F.a0_cp_at_alarm = pick(r0, F.a0_alarm).copy; F.a0_k_at_t50 = pick(r0, F.t50_0).k; F.a0_kdrop_at_t50 = S1.k0 - pick(r0, F.t50_0).k; F.a0_gap = F.t50_0 - F.a0_alarm;
F.pd_k = D.post.k; F.pd_kA = D.post.kA; F.pd_kB = D.post.kB; F.pd_b = D.post.b; F.pd_copy = D.post.copy; F.pd_d = D.post.d; F.pd_dk = D.post.kloss - S1.kloss0;
F.ed_k = D.end.k; F.ed_kA = D.end.kA; F.ed_kB = D.end.kB; F.ed_b = D.end.b; F.ed_copy = D.end.copy; F.ed_gain = D.end.b - D.post.b; F.ncord = D.ncor;
F.ad_alarm = tfirst(D.curve, (c) => c.s > 0 && c.k < S1.k0 - ALARM); F.td50 = tfirst(D.curve, (c) => c.b >= 50);
F.pd_dratio = D.post.d / r0.post.d; F.pd_dkratio = (r0.post.kloss - S1.kloss0) / (D.post.kloss - S1.kloss0); F.t50_ratio_d = F.td50 / F.t50_0; F.dilution_d = 1 / (1 - RHO_DEF);
F.price_b_end = r0.end.b - D.end.b; F.price_b_post = r0.post.b - D.post.b;
for (const rho of rhoGrid) { const o = gridSeed1[rho], tag = String(Math.round(rho * 100)); F['g' + tag + '_kp'] = o.post.k; F['g' + tag + '_bp'] = o.post.b; F['g' + tag + '_ke'] = o.end.k; F['g' + tag + '_be'] = o.end.b; F['g' + tag + '_t50'] = tfirst(o.curve, (c) => c.b >= 50) || 0; F['g' + tag + '_alarm'] = tfirst(o.curve, (c) => c.s > 0 && c.k < S1.k0 - ALARM) || 0; F['g' + tag + '_cp'] = o.post.copy; F['g' + tag + '_d'] = o.post.d; F['g' + tag + '_dk'] = o.post.kloss - S1.kloss0; }
for (const k of Object.keys(variants1)) { const o = seedRuns[k]; const p = 'v_' + k + '_'; F[p + 'kp'] = o.post.k; F[p + 'bp'] = o.post.b; F[p + 'ke'] = o.end.k; F[p + 'be'] = o.end.b; F[p + 'd'] = o.post.d; F[p + 'dk'] = o.post.kloss - S1.kloss0; F[p + 'cp'] = o.post.copy; F[p + 'cpe'] = o.end.copy; F[p + 'kAe'] = o.end.kA; F[p + 'kBe'] = o.end.kB; F[p + 'kAp'] = o.post.kA; F[p + 'kBp'] = o.post.kB; F[p + 'steps2'] = o.steps2; F[p + 't50'] = tfirst(o.curve, (c) => c.b >= 50) || 0; F[p + 'alarm'] = tfirst(o.curve, (c) => c.s > 0 && c.k < S1.k0 - ALARM) || 0; }
LOG('seed 1 facts done');

/* ───── the second-order picture: L_K along the straight line from the pretrained weights to the post-trained ones ───── */
function lineRun(s1, post) {
  const net = copyNet(s1.net), rows = [], n = 40;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    for (const key of ['W1', 'b1', 'W2', 'b2', 'W3', 'b3']) {
      const A = s1.net[key], B = post[key], O = net[key];
      if (Array.isArray(A[0])) { for (let r = 0; r < A.length; r++) for (let c = 0; c < A[r].length; c++) O[r][c] = A[r][c] + t * (B[r][c] - A[r][c]); } else for (let r = 0; r < A.length; r++) O[r] = A[r] + t * (B[r] - A[r]);
    }
    const p = probe(net, s1.P, s1.voc);
    rows.push({ t, d: trunkDist(net, s1.net), dk: p.loss - s1.kloss0, k: p.acc });
  }
  const fitw = (t0, t1) => {
    const pts = rows.filter((r) => r.t >= t0 - 1e-9 && r.t <= t1 + 1e-9 && r.dk > 0).map((r) => [Math.log(r.d), Math.log(r.dk)]);
    const m = pts.length, mx = mean(pts.map((q) => q[0])), my = mean(pts.map((q) => q[1])); let sxx = 0, sxy = 0, syy = 0;
    for (const q of pts) { sxx += (q[0] - mx) ** 2; sxy += (q[0] - mx) * (q[1] - my); syy += (q[1] - my) ** 2; }
    return { slope: sxy / sxx, r2: sxy * sxy / (sxx * syy), n: m };
  };
  const at = (t) => rows.find((r) => Math.abs(r.t - t) < 1e-9);
  return { rows, third: fitw(0.025, 0.3), whole: fitw(0.05, 1), kThird: at(0.3).k, last: rows[rows.length - 1] };
}
const line1 = lineRun(S1, r0.postNet);
check(Math.abs(line1.last.dk - (r0.post.kloss - S1.kloss0)) < 1e-9 && line1.last.k === r0.post.k, 'the walk ends where the fine-tune did: the same K loss (' + line1.last.dk + ') and probe (' + line1.last.k + ')');
F.line_third_1 = line1.third.slope; F.line_whole_1 = line1.whole.slope; F.line_k_third_1 = line1.kThird; F.line_n_third = line1.third.n; F.line_n_whole = line1.whole.n;
{ const f10 = stages(S1, { rho: 0, R: 0, every: 10, steps2: 600, only2: true });   // the table's run, read every ten steps
  check(f10.post.d === r0.post.d && f10.post.kloss === r0.post.kloss, 'the run read every ten steps is the table\'s run: it ends at the same weights');
  F.first10_d = f10.curve[1].d; F.first10_kdrop = S1.k0 - f10.curve[1].k; }

/* ───── five seeds: each has its own vocabulary (10 + seed), initial weights and batches; the demonstrations and the evaluation noise are shared ───── */
const SEEDS = [1, 2, 3, 4, 5], cfgs = {};
for (const rho of rhoGrid) cfgs['rho' + rho] = { rho };
Object.assign(cfgs, { lr03: { rho: 0, mult: 0.3 }, lr3: { rho: 0, mult: 3 }, head: { rho: 0, train: 'head' }, layer1: { rho: 0, train: 'layer1' }, kend: { rho: 0, tail: 'konly' }, half: { rho: RHO_DEF, nwords: 60 },
  nomix3: { rho: RHO_DEF, rho3: 0 }, anchor03: { rho: 0, anchor: 0.03 }, anchor01: { rho: 0, anchor: 0.01 }, anchor10: { rho: 0, anchor: 0.1 } });
const study = {}, longRuns = { 0: [], 3: [] }, t50Runs = {}, lines = [];
for (const sd of SEEDS) {
  const s1 = sd === 1 ? S1 : stage1(sd, 10 + sd);
  let post0 = null;
  for (const name of Object.keys(cfgs)) {
    const o = stages(s1, Object.assign({}, cfgs[name], { R: 0 }));
    if (name === 'rho0') post0 = o.postNet;
    const kmin = lo(o.curve.filter((c) => c.stage === 2).map((c) => c.k));
    const rr = { k0: s1.k0, kloss0: s1.kloss0, kp: o.post.k, kAp: o.post.kA, kBp: o.post.kB, ke: o.end.k, kAe: o.end.kA, kBe: o.end.kB, dp: o.post.d, de: o.end.d, dkp: o.post.kloss - s1.kloss0, cpp: o.post.copy, cpe: o.end.copy, maxdrop: s1.k0 - kmin, ncor: o.ncor,
      bp: success(o.postNet, 10), be: success(o.net, 10) };
    (study[name] = study[name] || []).push(rr);
  }
  for (const rho of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) { const o = stages(s1, { rho, R: 4, only2: true }); (t50Runs[rho] = t50Runs[rho] || []).push(tfirst(o.curve, (c) => c.b >= 50)); }
  for (const rho of [0, RHO_DEF]) { const o = stages(s1, { rho, R: 0, steps2: 2004, only2: true }); longRuns[rho === 0 ? 0 : 3].push({ k: o.post.k, b: success(o.postNet, 10) }); }
  lines.push(sd === 1 ? line1 : lineRun(s1, post0));
  LOG('seed ' + sd + ' done');
}
const M = (name, key) => mean(study[name].map((r) => r[key])), Lo = (name, key) => lo(study[name].map((r) => r[key])), Hi = (name, key) => hi(study[name].map((r) => r[key]));
const put = (tag, name, key) => { F[tag] = M(name, key); F[tag + '_lo'] = Lo(name, key); F[tag + '_hi'] = Hi(name, key); };
F.s5_k0 = mean(SEEDS.map((_, i) => study.rho0[i].k0)); F.s5_k0_lo = lo(study.rho0.map((r) => r.k0)); F.s5_k0_hi = hi(study.rho0.map((r) => r.k0));
for (const rho of rhoGrid) {
  const tag = 's5_' + String(Math.round(rho * 100)), name = 'rho' + rho;
  put(tag + '_kp', name, 'kp'); put(tag + '_bp', name, 'bp'); put(tag + '_ke', name, 'ke'); put(tag + '_be', name, 'be'); put(tag + '_md', name, 'maxdrop'); put(tag + '_cpp', name, 'cpp'); put(tag + '_cpe', name, 'cpe'); put(tag + '_dp', name, 'dp'); put(tag + '_dk', name, 'dkp');
  F[tag + '_drop_p'] = M(name, 'k0') - M(name, 'kp');
}
for (const rho of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) { const v = t50Runs[rho], tag = 's5_' + String(Math.round(rho * 100)) + '_t50'; const ok = v.filter((x) => x !== null); F[tag + '_n'] = ok.length; F[tag] = ok.length ? mean(ok) : 0; F[tag + '_lo'] = ok.length ? lo(ok) : 0; F[tag + '_hi'] = ok.length ? hi(ok) : 0; }
for (const [name, tag] of [['lr03', 'lr03'], ['lr3', 'lr3'], ['head', 'head'], ['layer1', 'layer1'], ['kend', 'kend'], ['half', 'half'], ['nomix3', 'nomix3'], ['anchor03', 'anc03'], ['anchor01', 'anc01'], ['anchor10', 'anc10']]) {
  put('s5_' + tag + '_kp', name, 'kp'); put('s5_' + tag + '_bp', name, 'bp'); put('s5_' + tag + '_ke', name, 'ke'); put('s5_' + tag + '_be', name, 'be'); put('s5_' + tag + '_dp', name, 'dp'); put('s5_' + tag + '_cpp', name, 'cpp'); put('s5_' + tag + '_kAe', name, 'kAe'); put('s5_' + tag + '_kBe', name, 'kBe'); put('s5_' + tag + '_kAp', name, 'kAp'); put('s5_' + tag + '_kBp', name, 'kBp'); put('s5_' + tag + '_md', name, 'maxdrop');
}
F.s5_long0_b = mean(longRuns[0].map((r) => r.b)); F.s5_long3_b = mean(longRuns[3].map((r) => r.b)); F.s5_long0_k = mean(longRuns[0].map((r) => r.k)); F.s5_long3_k = mean(longRuns[3].map((r) => r.k));
F.s5_long_gap = F.s5_long0_b - F.s5_long3_b;
F.s5_line3 = mean(lines.map((l) => l.third.slope)); F.s5_line3_lo = lo(lines.map((l) => l.third.slope)); F.s5_line3_hi = hi(lines.map((l) => l.third.slope));
F.s5_linew = mean(lines.map((l) => l.whole.slope)); F.s5_linew_lo = lo(lines.map((l) => l.whole.slope)); F.s5_linew_hi = hi(lines.map((l) => l.whole.slope));
F.s5_line_r2_lo = lo(lines.map((l) => Math.min(l.third.r2, l.whole.r2))); F.s5_line_k3 = mean(lines.map((l) => l.kThird));
F.s5_dratio = F.s5_30_dp / F.s5_0_dp; F.s5_dkratio = F.s5_0_dk / F.s5_30_dk; F.s5_dratio_20 = F.s5_20_dp / F.s5_0_dp; F.s5_dkratio_20 = F.s5_0_dk / F.s5_20_dk;
F.s5_price_be = F.s5_0_be - F.s5_30_be; F.s5_price_bp = F.s5_0_bp - F.s5_30_bp; F.s5_gain0 = F.s5_0_be - F.s5_0_bp; F.s5_gain3 = F.s5_30_be - F.s5_30_bp;
{ const diffs = SEEDS.map((_, i) => study.rho0[i].be - study['rho0.3'][i].be); F.s5_price_mean = mean(diffs); F.s5_price_lo = lo(diffs); F.s5_price_hi = hi(diffs); F.s5_price_pos = diffs.filter((d) => d > 0).length; }
{ const ratios = [0.1, 0.2, 0.3, 0.4].map((rho) => F['s5_' + String(Math.round(rho * 100)) + '_t50'] / F.s5_0_t50); F.s5_t50_r10 = ratios[0]; F.s5_t50_r20 = ratios[1]; F.s5_t50_r30 = ratios[2]; F.s5_t50_r40 = ratios[3]; }
F.dil10 = 1 / 0.9; F.dil20 = 1 / 0.8; F.dil30 = 1 / 0.7; F.dil40 = 1 / 0.6;
F.s5_nomix3_drop = F.s5_nomix3_kp - F.s5_nomix3_ke; F.s5_mix3_gain = F.s5_30_ke - F.s5_30_kp;
F.s5_half_gap = F.s5_half_kAe - F.s5_half_kBe;
{ // recommended: the smallest rho on the grid whose worst seed loses fewer than ALARM points at any checkpoint of post-training
  let rec = null; for (const rho of rhoGrid) { if (Hi('rho' + rho, 'maxdrop') < ALARM) { rec = rho; break; } } F.rec_rho = Math.round(rec * 100); F.rec_md_hi = Hi('rho' + rec, 'maxdrop'); F.rec_md_lo = Lo('rho' + rec, 'maxdrop');
  F.rec_prev_md_hi = Hi('rho0.2', 'maxdrop'); }
LOG('studies done');

/* ───── the evaluation the lesson ends on: what a few dozen trials can and cannot see ───── */
{ const kk = Math.round(D.end.b / 100 * 144), w144 = wilson(kk, 144), w36 = wilson(Math.round(D.end.b / 100 * 36), 36);
  F.w144_lo = w144[0]; F.w144_hi = w144[1]; F.w36_lo = w36[0]; F.w36_hi = w36[1]; F.w36_half = (w36[1] - w36[0]) / 2; F.w144_half = (w144[1] - w144[0]) / 2; F.w36_k = Math.round(D.end.b / 100 * 36); F.w144_k = kk;
  const p = F.s5_30_be / 100, k5 = Math.round(p * 36), w5 = wilson(k5, 36); F.w36m_lo = w5[0]; F.w36m_hi = w5[1]; F.w36m_k = k5; F.w36m_half = (w5[1] - w5[0]) / 2; F.s5_price_in_w36 = F.s5_price_be / ((w5[1] - w5[0]) / 2); }

/* ───── small derived numbers the prose quotes ───── */
F.ck_k = Math.round(0.3 * BATCH); F.ck_b = BATCH - F.ck_k; F.ck_bound = F.t50_0 * BATCH / F.ck_b; F.ck_seen0 = 600 * BATCH; F.ck_seen3 = 600 * F.ck_b; F.ck_frac = F.ck_seen3 / F.ck_seen0 * 100;
F.cor_frac = F.ncord / F.demo_frames * 100; F.frames_per_layout = F.demo_frames / LAYOUTS.length; F.eval_n = WORLDS.length * 4; F.probe_macs_m = NPROBE * (DW * H + H * H + H * NK) / 1e6;
F.a0_kdrop50 = S1.k0 - pick(r0, 50).k; F.s5_t50_bound30 = F.s5_0_t50 / (1 - 0.3);
F.d_b50 = pick(D, 50).b; F.d_b100 = pick(D, 100).b;   // the default run's early blip of success
{ const a = t50Runs[0], b = t50Runs[0.3], both = SEEDS.map((_, i) => i).filter((i) => a[i] !== null && b[i] !== null);   // the seeds that reach 50 % success within the budget at both shares
  F.s5_t50_npair = both.length; F.s5_t50_miss3 = b.filter((x) => x === null).length; F.s5_t50_pair0 = mean(both.map((i) => a[i])); F.s5_t50_pair3 = mean(both.map((i) => b[i])); F.s5_t50_pairr = F.s5_t50_pair3 / F.s5_t50_pair0; }
F.s5_nomix3_gain3 = F.s5_nomix3_be - F.s5_30_be;

/* ───── claims of the prose, asserted ───── */
check(F.k0 > 97 && F.s5_k0_lo > 93, 'stage 1 learns K: probe ' + F.k0 + ' (five seeds from ' + F.s5_k0_lo + ')');
check(F.p0_k < 45 && F.s5_0_kp_hi < 55, 'plain fine-tuning erases most of K: ' + F.p0_k + ' (five seeds up to ' + F.s5_0_kp_hi + ')');
check(F.p0_b > 60 && F.e0_b > 85 && F.p0_copy < 20 && F.e0_copy < F.p0_copy, 'every number we track improves under plain fine-tuning');
check(F.a0_alarm !== null && F.t50_0 !== null && F.a0_alarm < F.t50_0 && F.a0_b_at_alarm < 5, 'the probe alarm trips (step ' + F.a0_alarm + ') before success reaches 50 % (step ' + F.t50_0 + ')');
check(F.a0_kdrop_at_t50 > 45, 'by the time success reaches 50 % the probe has lost more than 45 points (' + F.a0_kdrop_at_t50 + ')');
check(F.s5_line3_lo > 1.85 && F.s5_line3_hi < 2.25 && F.s5_linew_lo > 1.7 && F.s5_linew_hi < 2.05 && F.s5_line_r2_lo > 0.99, 'along the straight line from the pretrained to the post-trained weights the K loss rises as the square of the distance: power ' + F.s5_line3_lo + ' to ' + F.s5_line3_hi + ' over the first third, ' + F.s5_linew_lo + ' to ' + F.s5_linew_hi + ' over all of it (r2 from ' + F.s5_line_r2_lo + ')');
check(F.s5_head_bp < 3 && Math.abs(F.s5_head_kp - F.s5_k0) < 2 && F.s5_head_dp === 0, 'freezing everything but the head keeps K and learns nothing');
check(F.s5_layer1_bp < 15 && F.s5_layer1_kp > 80, 'freezing all but layer 1 and the head: K kept, B barely learned in the budget');
check(F.s5_lr03_kp < 55 && F.s5_lr3_kp < 60 && Math.abs(F.s5_lr03_dp - F.s5_0_dp) < 1.5 && Math.abs(F.s5_lr3_dp - F.s5_0_dp) < 1.5, 'the learning rate changes the speed, not the place: K ' + F.s5_lr03_kp + ' / ' + F.s5_0_kp + ' / ' + F.s5_lr3_kp);
check(F.s5_kend_ke > 90 && F.s5_kend_be < 15, 'K alone at the end brings K back and loses B: ' + F.s5_kend_ke + ' / ' + F.s5_kend_be);
check(F.s5_anc03_kp > 88 && F.s5_anc03_bp < 10 && F.s5_anc01_bp > F.s5_anc03_bp && F.s5_anc01_kp < F.s5_anc03_kp, 'an L2 anchor trades K against B with no good setting: lambda 0.03 gives K ' + F.s5_anc03_kp + ' B ' + F.s5_anc03_bp);
for (let i = 1; i < rhoGrid.length; i++) check(F['s5_' + String(Math.round(rhoGrid[i] * 100)) + '_kp'] >= F['s5_' + String(Math.round(rhoGrid[i - 1] * 100)) + '_kp'] - 1.0, 'K after post-training does not fall as rho grows (rho ' + rhoGrid[i] + ')');
check(F.s5_30_md_hi < ALARM && F.s5_0_md_lo > 40 && F.s5_20_md_hi > ALARM - 0.5, 'worst-seed drop of the probe: rho 0 loses more than 40 points, rho 0.3 under 5 points, rho 0.2 does not guarantee it');
check(F.rec_rho === 30, 'the smallest grid value whose worst seed stays under the alarm is 0.3 (got ' + F.rec_rho + ')');
check(F.s5_70_bp < 5 && F.s5_50_bp < F.s5_30_bp && F.s5_30_bp < F.s5_0_bp, 'success at the cut-off falls as the share grows');
check(F.s5_dratio > 0.65 && F.s5_dratio < 0.9 && F.s5_dkratio > 20, 'with rho 0.3 the weights move ' + F.s5_dratio + ' as far and the K loss rises ' + F.s5_dkratio + ' times less');
check(F.s5_30_t50 > F.s5_0_t50 && Math.abs(F.s5_t50_r30 - F.dil30) < 0.2 * F.dil30, 'the price in steps to 50 % is about the dilution 1/(1-rho): ' + F.s5_t50_r30 + ' against ' + F.dil30);
check(F.s5_0_t50_n === 5 && F.s5_30_t50_n === 4 && F.s5_t50_npair === 4 && F.s5_t50_miss3 === 1 && F.s5_50_t50_n === 0, 'five seeds reach 50 % success at rho 0, four at rho 0.3 (the same four reach it at both), none at rho 0.5: ' + [F.s5_0_t50_n, F.s5_30_t50_n, F.s5_t50_npair, F.s5_50_t50_n]);
check(F.s5_t50_pairr > 1.15 && F.s5_t50_pairr < 1.75 && F.t50_ratio_d > 1.15 && F.t50_ratio_d < 1.75, 'the price in steps to 50 % is of the order of the dilution ' + F.dil30 + ': paired ' + F.s5_t50_pairr + ', seed 1 ' + F.t50_ratio_d);
check(F.s5_gain0 > 12 && F.s5_gain3 > 12, 'on-policy corrections lift success by more than 12 points, with and without the mixture');
check(F.s5_nomix3_drop > 4 && F.s5_mix3_gain > -1, 'dropping the mixture in the last stage forgets again (' + F.s5_nomix3_drop + ' points) while keeping it does not (' + F.s5_mix3_gain + ')');
check(F.s5_half_kAe > 95 && F.s5_half_kBe < 78 && F.s5_half_kBe > 40, 'a mixture that holds half the words protects those and only partly the others: ' + F.s5_half_kAe + ' / ' + F.s5_half_kBe);
check(F.s5_long_gap < 6, 'with 2004 post-training steps the mixture\'s price in success is under 6 points (' + F.s5_long_gap + ')');
check(F.s5_price_mean > 2 && F.s5_price_pos === 5, 'the price of rho 0.3 in success after corrections is positive in all five seeds (' + F.s5_price_mean + ')');
check(F.w36_half > 8, 'a 36-trial evaluation of the default model has a half-width above 8 points (' + F.w36_half + ')');
check(F.d_b50 > 15 && F.d_b100 < 3, 'the default run shows one early blip of success (' + F.d_b50 + ' % at step 50, ' + F.d_b100 + ' % at step 100)');
check(F.s5_layer1_kp < F.s5_head_kp - 4, 'training layer 1 and the head still loses K (' + F.s5_layer1_kp + ' against ' + F.s5_head_kp + ')');
check(F.s5_price_mean < F.w36_half && F.w144_half > 0.5 * F.s5_price_mean && F.w144_half < F.s5_price_mean, 'the price of rho 0.3 (' + F.s5_price_mean + ') sits inside the 36-trial half-width (' + F.w36_half + ') and is larger than the 144-rollout half-width (' + F.w144_half + ') which is more than half of it');

/* ───── the page's widget prints the same numbers ───── */
const html = path.join(root, dir, '14_the_training_recipe.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const RHOS = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7];
  const setState = (variant, rho) => { pg.set('w14-var', variant); pg.set('w14-rho', RHOS.indexOf(rho)); pg.drain(); };
  const probeState = (o, tag, opts) => {
    opts = opts || {};
    eqd('w14-k0', S1.k0, 1, tag + ' probe after stage 1'); eqd('w14-k2', o.post.k, 1, tag + ' probe after post-training'); eqd('w14-k3', o.end.k, 1, tag + ' probe at the end');
    eqd('w14-ka', o.end.kA, 0, tag + ' probe on words 0-59'); eqd('w14-kb', o.end.kB, 0, tag + ' probe on words 60-119');
    eqd('w14-b2', o.post.b, 1, tag + ' success after post-training'); eqd('w14-b3', o.end.b, 1, tag + ' success at the end'); eqd('w14-cp', o.post.copy, 1, tag + ' copy error after post-training');
    eqd('w14-d', o.post.d, 2, tag + ' weights moved'); eqd('w14-dk', (o.post.kloss - S1.kloss0) * 1000, 0, tag + ' K-loss rise');
    const t50 = tfirst(o.curve, (c) => c.b >= 50), al = tfirst(o.curve, (c) => c.s > 0 && c.k < S1.k0 - ALARM);
    if (t50 === null) check(/not|never|no/i.test(pg.text('w14-t50')), tag + ': widget should say success never reaches 50 % (prints ' + pg.text('w14-t50') + ')'); else eqd('w14-t50', t50, 0, tag + ' steps to 50 % success');
    if (al === null) check(/never|no/i.test(pg.text('w14-alarm')), tag + ': widget should say the alarm never trips (prints ' + pg.text('w14-alarm') + ')'); else eqd('w14-alarm', al, 0, tag + ' alarm step');
  };
  setState('recipe', RHO_DEF); probeState(D, 'default');
  setState('recipe', 0); probeState(r0, 'rho 0');
  setState('recipe', 0.5); probeState(gridSeed1[0.5], 'rho 0.5');
  setState('recipe', 0.1); probeState(gridSeed1[0.1], 'rho 0.1');
  setState('lr03', 0); probeState(seedRuns.lr03, 'lr x0.3');
  setState('lr3', 0); probeState(seedRuns.lr3, 'lr x3');
  setState('head', 0); probeState(seedRuns.head, 'head only');
  setState('layer1', 0); probeState(seedRuns.layer1, 'layer 1 and head');
  setState('kend', RHO_DEF); probeState(seedRuns.kend, 'K alone at the end');
  setState('half', RHO_DEF); probeState(seedRuns.half, 'half the words');
  setState('nomix3', RHO_DEF); probeState(seedRuns.nomix3, 'no mixture in stage 3');
  setState('anchor', RHO_DEF); probeState(seedRuns.anchor, 'anchor');
}

LOG('all done');
console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
