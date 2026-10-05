/* forget_lab.js — lesson 14's private engine: one network that has to keep what it knew while it is taught something else.
 *
 * The network is a small stand-in for a robot model's shared weights: 12 numbers in, two hidden layers of 24 tanh units, 12 numbers out.
 *   K  the knowledge task.  A vocabulary of 120 words (each a code of 8 numbers), each word belonging to one of 10 categories by an arbitrary rule.
 *      The model reads a rendition of a word (the code plus Gaussian noise of 0.15 per number) and writes 10 numbers, one per category (squared error
 *      against a one-hot target).  The rule cannot be derived, only stored, so it lives in the weights.  K-data are a stream: every example is new.
 *      The probe is 600 fresh renditions that no training step ever saw; accuracy is the share whose largest output is the right category (chance 10 %).
 *   B  the robot tasks.  36 layouts of a two-post slalom (12 shifts x 3 tilts), three calm demonstrations each.  The model reads the cup's position and the
 *      layout (4 numbers) and writes the velocity it wants for the cup (2 numbers, in units of 0.15 m/s); the Bench's damped least squares turns it into
 *      joint velocities.  Success is the share of rollouts under gust 0.08 that reach the end of the course without touching a post.
 * Every example trains only the outputs it labels (a K example the 10 category outputs, a B example the 2 velocity outputs); the hidden layers are shared.
 *
 * Stages (a Run):  1  pretrain on K alone (4000 steps)   2  post-train 600 steps on B with a share rho of every batch from K
 *                  3  corrections: one rollout of the current policy per layout, every visited state labelled by the expert (lesson 3), aggregated with the
 *                     demonstrations, 300 more steps with the same share rho of K.
 * A batch is 40 examples: round(40 rho) from K, the rest from B.  Adam (b1 0.9, b2 0.999), learning rate cosine-decayed to 5 % inside each stage.
 * Variants (cfg): mult (learning-rate multiplier; the steps scale by 1/mult), train ('all', 'layer1' = first layer and head, 'head' = the new head only), nwords (how many
 * of the 120 words the mixture can draw), tail ('corr' or 'konly' = K alone at the end), rho3 (the share in stage 3), anchor (an L2 pull towards the stage-1 trunk).
 *
 * Speed: the validator runs pages inside a vm context where every global lookup is slow, so the hot loops use local aliases, typed arrays and no allocation;
 * rollouts are a copy of BN.rollout with the policy inlined (same arithmetic, same random draws), and the lesson's oracle checks it against BN.rollout.
 * Determinism: every draw comes from BN.rng; nothing here reads the clock.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var FL = {};
var CONTACT = BN.slalom.W.postR + BN.slalom.W.grip;                  // the cup touches a post when their centres are closer than this (5 cm)
var tanh = Math.tanh, sqrt = Math.sqrt, floor = Math.floor, cos = Math.cos, sin = Math.sin, hypot = Math.hypot, pow = Math.pow, PI = Math.PI, max = Math.max, min = Math.min, round = Math.round, abs = Math.abs, log = Math.log;

FL.DW = 8; FL.DIN = 12; FL.NK = 10; FL.DOUT = 12; FL.HID = 24;
FL.NWORDS = 120; FL.SIGMA = 0.15; FL.VSEED = 11;                    // the vocabulary of the widget; the oracle's five seeds use VSEED = 10 + seed
FL.BATCH = 40; FL.LR = 0.003; FL.FLOOR = 0.05;
FL.PRE = 4000; FL.S2 = 600; FL.S3 = 300; FL.LR3 = 0.002; FL.EVERY = 50; FL.CHUNK = 500;
FL.NPROBE = 600; FL.PSEED = 777;
FL.NPOSTS = 2; FL.NDEMO = 3; FL.GUST = 0.08; FL.JIT = 0.01; FL.VS = 0.15; FL.DLS = 1e-4; FL.REPS = 4; FL.ESEED = 9000; FL.CSEED = 5000; FL.HSEED = 8000; FL.DSEED = 500;
FL.ALARM = 5;                                                       // points of probe accuracy below the stage-1 value
FL.SHIFTS = []; for (var si = 0; si < 12; si++) FL.SHIFTS.push(-0.10 + 0.2 * si / 11);
FL.TILTS = [-0.15, 0, 0.15];
FL.LAYOUTS = []; FL.SHIFTS.forEach(function (s) { FL.TILTS.forEach(function (t) { FL.LAYOUTS.push({ shift: s, tilt: t }); }); });

/* ───────────────────────────── K: the vocabulary and its stream ───────────────────────────── */
FL.vocab = function (seed) {
  var r = BN.rng(seed), words = [], cls = [], i, j;
  for (i = 0; i < FL.NWORDS; i++) { var v = new Float64Array(FL.DW); for (j = 0; j < FL.DW; j++) v[j] = BN.randn(r); words.push(v); cls.push(i % FL.NK); }
  BN.shuffle(cls, r);                                               // an arbitrary but balanced rule: 12 words per category
  return { words: words, cls: cls };
};
/* one rendition of a random word among the first n, written into x (the robot slots stay 0); returns the word's index */
FL.draw = function (voc, rng, x, n) {
  var k = floor(rng() * n), v = voc.words[k], sg = FL.SIGMA, j;
  for (j = 0; j < FL.DW; j++) x[j] = v[j] + sg * BN.randn(rng);
  for (j = FL.DW; j < FL.DIN; j++) x[j] = 0;
  return k;
};
/* the probe: fresh renditions of all 120 words, never used for training */
FL.probeSet = function (voc) {
  var rng = BN.rng(FL.PSEED), N = FL.NPROBE, X = new Float64Array(N * FL.DIN), word = new Int16Array(N), x = new Float64Array(FL.DIN), i, j;
  for (i = 0; i < N; i++) { word[i] = FL.draw(voc, rng, x, FL.NWORDS); for (j = 0; j < FL.DIN; j++) X[i * FL.DIN + j] = x[j]; }
  return { X: X, word: word, cls: voc.cls, N: N };
};

/* ───────────────────────────── the network ───────────────────────────── */
var KEYS = ['W1', 'b1', 'W2', 'b2', 'W3', 'b3'];
FL.net = function (seed) {
  var r = BN.rng(seed), H = FL.HID, din = FL.DIN, dout = FL.DOUT, n = { t: 0, m: {}, v: {} }, i, k;
  var mk = function (len, sc) { var a = new Float64Array(len); if (sc) for (var q = 0; q < len; q++) a[q] = sc * BN.randn(r); return a; };
  n.W1 = mk(din * H, sqrt(2 / (din + H))); n.b1 = mk(H); n.W2 = mk(H * H, sqrt(2 / (H + H))); n.b2 = mk(H); n.W3 = mk(H * dout, sqrt(2 / (H + dout))); n.b3 = mk(dout);
  for (i = 0; i < H; i++) for (k = FL.NK; k < dout; k++) n.W3[i * dout + k] = 0;      // the new head starts at zero: the pretrained model does nothing with an arm
  for (k = 0; k < 6; k++) { n.m[KEYS[k]] = new Float64Array(n[KEYS[k]].length); n.v[KEYS[k]] = new Float64Array(n[KEYS[k]].length); }
  return n;
};
FL.clone = function (a) {
  var b = { t: a.t, m: {}, v: {} };
  for (var k = 0; k < 6; k++) { var key = KEYS[k]; b[key] = Float64Array.from(a[key]); b.m[key] = Float64Array.from(a.m[key]); b.v[key] = Float64Array.from(a.v[key]); }
  return b;
};
FL.resetAdam = function (n) { n.t = 0; for (var k = 0; k < 6; k++) { n.m[KEYS[k]].fill(0); n.v[KEYS[k]].fill(0); } };
FL.work = function () { var H = FL.HID; return { a1: new Float64Array(H), a2: new Float64Array(H), o: new Float64Array(FL.DOUT), d3: new Float64Array(FL.DOUT), d2: new Float64Array(H), d1: new Float64Array(H) }; };
FL.newGrad = function () { var H = FL.HID, din = FL.DIN, dout = FL.DOUT; return { W1: new Float64Array(din * H), b1: new Float64Array(H), W2: new Float64Array(H * H), b2: new Float64Array(H), W3: new Float64Array(H * dout), b3: new Float64Array(dout) }; };
FL.zero = function (g) { for (var k = 0; k < 6; k++) g[KEYS[k]].fill(0); };

/* forward pass of example x (offset xo): fills w.a1, w.a2 and the outputs k0..k1-1 of w.o */
FL.fwd = function (n, x, xo, w, k0, k1) {
  var H = FL.HID, din = FL.DIN, dout = FL.DOUT, a1 = w.a1, a2 = w.a2, o = w.o, W1 = n.W1, W2 = n.W2, W3 = n.W3, b1 = n.b1, b2 = n.b2, b3 = n.b3, i, j, k;
  for (j = 0; j < H; j++) a1[j] = b1[j];
  for (i = 0; i < din; i++) { var xi = x[xo + i]; if (xi === 0) continue; var r1 = i * H; for (j = 0; j < H; j++) a1[j] += xi * W1[r1 + j]; }
  for (j = 0; j < H; j++) a1[j] = tanh(a1[j]);
  for (j = 0; j < H; j++) a2[j] = b2[j];
  for (i = 0; i < H; i++) { var ai = a1[i], r2 = i * H; for (j = 0; j < H; j++) a2[j] += ai * W2[r2 + j]; }
  for (j = 0; j < H; j++) a2[j] = tanh(a2[j]);
  for (k = k0; k < k1; k++) o[k] = b3[k];
  for (i = 0; i < H; i++) { var bi = a2[i], r3 = i * dout; for (k = k0; k < k1; k++) o[k] += bi * W3[r3 + k]; }
};
/* gradient of one example's squared error, added into g.  kind 0: a K example (10 outputs against the one-hot of category tgt), kind 1: a B example (2 outputs against v, v[0..1] at vo) */
FL.grad = function (n, g, w, x, xo, kind, tgt, v, vo) {
  var H = FL.HID, din = FL.DIN, dout = FL.DOUT, NK = FL.NK, o = w.o, d3 = w.d3, d2 = w.d2, d1 = w.d1, a1 = w.a1, a2 = w.a2, W2 = n.W2, W3 = n.W3, i, j, k, loss = 0, e;
  FL.fwd(n, x, xo, w, 0, dout);
  for (k = 0; k < dout; k++) d3[k] = 0;
  var k0, k1;
  if (kind === 0) { k0 = 0; k1 = NK; for (k = 0; k < NK; k++) { e = o[k] - (k === tgt ? 1 : 0); d3[k] = 2 * e / NK; loss += e * e / NK; } }
  else { k0 = NK; k1 = dout; for (k = NK; k < dout; k++) { e = o[k] - v[vo + k - NK]; d3[k] = 2 * e / 2; loss += e * e / 2; } }
  for (k = k0; k < k1; k++) g.b3[k] += d3[k];
  for (i = 0; i < H; i++) { var r3 = i * dout, ai = a2[i], s = 0; for (k = k0; k < k1; k++) { g.W3[r3 + k] += ai * d3[k]; s += W3[r3 + k] * d3[k]; } d2[i] = s * (1 - ai * ai); }
  for (j = 0; j < H; j++) g.b2[j] += d2[j];
  for (i = 0; i < H; i++) { var r2 = i * H, bi = a1[i], s2 = 0; for (j = 0; j < H; j++) { g.W2[r2 + j] += bi * d2[j]; s2 += W2[r2 + j] * d2[j]; } d1[i] = s2 * (1 - bi * bi); }
  for (j = 0; j < H; j++) g.b1[j] += d1[j];
  for (i = 0; i < din; i++) { var xi = x[xo + i]; if (xi === 0) continue; var r1 = i * H; for (j = 0; j < H; j++) g.W1[r1 + j] += xi * d1[j]; }
  return loss;
};
/* Adam on the weights `train` allows: train.layer1 (W1, b1), train.layer2 (W2, b2), train.kHead (output columns 0..9), train.bHead (columns 10, 11) */
FL.adam = function (n, g, lr, scale, train) {
  var b1 = 0.9, b2 = 0.999, H = FL.HID, dout = FL.DOUT, NK = FL.NK;
  n.t++;
  var c1 = 1 - pow(b1, n.t), c2 = 1 - pow(b2, n.t);
  var upd = function (key, lo, hi) {
    var W = n[key], gw = g[key], m = n.m[key], v = n.v[key];
    for (var i = lo; i < hi; i++) { var gi = gw[i] * scale; m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi; W[i] -= lr * (m[i] / c1) / (sqrt(v[i] / c2) + 1e-8); }
  };
  var cols = function (c0, c1_) {
    var W = n.W3, gw = g.W3, m = n.m.W3, v = n.v.W3, i, k;
    for (i = 0; i < H; i++) { var row = i * dout; for (k = c0; k < c1_; k++) { var id = row + k, gi = gw[id] * scale; m[id] = b1 * m[id] + (1 - b1) * gi; v[id] = b2 * v[id] + (1 - b2) * gi * gi; W[id] -= lr * (m[id] / c1) / (sqrt(v[id] / c2) + 1e-8); } }
    var wb = n.b3, gb = g.b3, mb = n.m.b3, vb = n.v.b3;
    for (k = c0; k < c1_; k++) { var gk = gb[k] * scale; mb[k] = b1 * mb[k] + (1 - b1) * gk; vb[k] = b2 * vb[k] + (1 - b2) * gk * gk; wb[k] -= lr * (mb[k] / c1) / (sqrt(vb[k] / c2) + 1e-8); }
  };
  if (train.layer1) { upd('W1', 0, n.W1.length); upd('b1', 0, n.b1.length); }
  if (train.layer2) { upd('W2', 0, n.W2.length); upd('b2', 0, n.b2.length); }
  if (train.kHead) cols(0, NK);
  if (train.bHead) cols(NK, dout);
};
FL.TRAIN = { all: { layer1: true, layer2: true, kHead: true, bHead: true }, layer1: { layer1: true, bHead: true }, head: { bHead: true } };
/* how far the shared weights (both hidden layers) have moved from net a to net b: the Euclidean distance */
FL.dist = function (a, b) {
  var s = 0, keys = ['W1', 'b1', 'W2', 'b2'];
  for (var k = 0; k < 4; k++) { var x = a[keys[k]], y = b[keys[k]]; for (var i = 0; i < x.length; i++) { var d = x[i] - y[i]; s += d * d; } }
  return sqrt(s);
};
FL.lrAt = function (lr0, s, S) { return lr0 * (FL.FLOOR + (1 - FL.FLOOR) * 0.5 * (1 + cos(PI * (s - 1) / S))); };

/* ───────────────────────────── what the model is asked: the probe and the tasks ───────────────────────────── */
/* K probe: accuracy over all words, over words 0-59 (the half the short mixture can replay), over words 60-119, and the squared error */
FL.probe = function (net, ps, w) {
  var N = ps.N, ok = 0, okA = 0, okB = 0, nA = 0, nB = 0, loss = 0, NK = FL.NK, i, k;
  for (i = 0; i < N; i++) {
    FL.fwd(net, ps.X, i * FL.DIN, w, 0, NK);
    var c = ps.cls[ps.word[i]], bi = 0, best = -1e9;
    for (k = 0; k < NK; k++) { var ok_ = w.o[k]; if (ok_ > best) { best = ok_; bi = k; } var e = ok_ - (k === c ? 1 : 0); loss += e * e / NK; }
    var hit = bi === c ? 1 : 0; ok += hit;
    if (ps.word[i] < 60) { nA++; okA += hit; } else { nB++; okB += hit; }
  }
  return { acc: ok / N * 100, accA: nA ? okA / nA * 100 : NaN, accB: nB ? okB / nB * 100 : NaN, loss: loss / N };
};
/* the layouts' worlds, once */
var worlds = null;
FL.worlds = function () {
  if (worlds) return worlds;
  worlds = FL.LAYOUTS.map(function (th) { var w = BN.slalom.world(FL.NPOSTS, { shift: th.shift, tilt: th.tilt }); return { th: th, w: w, xe: BN.slalom.xEnd(w), T: BN.slalom.horizon(w) }; });
  return worlds;
};
/* B observation of cup position p on layout th, written at x[xo + 8 ..] (the K slots are 0) */
FL.obs = function (p, th, x, xo) {
  x[xo + 8] = (p[0] + 0.15) / 0.35; x[xo + 9] = (p[1] - 0.55) / 0.15; x[xo + 10] = th.shift / 0.1; x[xo + 11] = th.tilt / 0.15;
};
/* the expert's velocity for the cup at joint state q, in the model's units: J(q) u*(q) / 0.15 */
function expertV(w, q, out, o) {
  var u = BN.slalom.expertAct(w, q), J = BN.arm.jac(q, w.body);
  out[o] = (J[0] * u[0] + J[1] * u[1]) / FL.VS; out[o + 1] = (J[2] * u[0] + J[3] * u[1]) / FL.VS;
}
/* a frame table: X (n x 12), Y (n x 2) */
FL.table = function (n) { return { n: 0, X: new Float64Array(n * FL.DIN), Y: new Float64Array(n * 2) }; };
FL.append = function (tab, ro, world) {                              // every visited state of a rollout, labelled by the expert
  var need = (tab.n + ro.S.length), t;
  if (need * FL.DIN > tab.X.length) { var nx = new Float64Array(need * FL.DIN * 2), ny = new Float64Array(need * 4); nx.set(tab.X); ny.set(tab.Y); tab.X = nx; tab.Y = ny; }
  for (t = 0; t < ro.S.length; t++) { FL.obs(ro.P[t], world.th, tab.X, tab.n * FL.DIN); expertV(world.w, ro.S[t], tab.Y, tab.n * 2); tab.n++; }
};
var demoCache = null;
FL.demos = function () {                                             // the demonstrations: three calm runs of the expert per layout
  if (demoCache) return demoCache;
  var W = FL.worlds(), tab = FL.table(8192), i;
  for (i = 0; i < W.length; i++) { var runs = BN.demos(W[i].w, FL.NDEMO, BN.rng(FL.DSEED + i), { noise: 0, jit: FL.JIT }); runs.forEach(function (ro) { FL.append(tab, ro, W[i]); }); }
  demoCache = tab; return tab;
};
var heldCache = null;
FL.held = function () {                                              // held-out expert frames: one fresh calm run per layout
  if (heldCache) return heldCache;
  var W = FL.worlds(), tab = FL.table(4096), i;
  for (i = 0; i < W.length; i++) { var ro = BN.demos(W[i].w, 1, BN.rng(FL.HSEED + i), { noise: 0, jit: FL.JIT })[0]; FL.append(tab, ro, W[i]); }
  heldCache = tab; return tab;
};
/* copy error on a frame table: root-mean-square distance of the model's velocity from the expert's, relative to the expert's size (lesson 1) */
FL.copyError = function (net, tab, w) {
  var se = 0, ss = 0, i, NK = FL.NK;
  for (i = 0; i < tab.n; i++) {
    FL.fwd(net, tab.X, i * FL.DIN, w, NK, FL.DOUT);
    var a = w.o[NK] - tab.Y[2 * i], b = w.o[NK + 1] - tab.Y[2 * i + 1]; se += a * a + b * b; ss += tab.Y[2 * i] * tab.Y[2 * i] + tab.Y[2 * i + 1] * tab.Y[2 * i + 1];
  }
  return sqrt(se / ss) * 100;
};

/* ───────────────────────────── rollouts of the model on the plant ───────────────────────────── */
/* the model's command at joint state q on layout th: velocity from the network, then damped least squares (the expert's own solver).  Returns [u1, u2]. */
function command(net, w, x, th, body, q, out) {
  var s1 = sin(q[0]), c1 = cos(q[0]), s12 = sin(q[0] + q[1]), c12 = cos(q[0] + q[1]), L1 = body.L1, L2 = body.L2;
  var px = L1 * c1 + L2 * c12, py = L1 * s1 + L2 * s12;
  x[8] = (px + 0.15) / 0.35; x[9] = (py - 0.55) / 0.15; x[10] = th.shift / 0.1; x[11] = th.tilt / 0.15;
  FL.fwd(net, x, 0, w, FL.NK, FL.DOUT);
  var v0 = w.o[FL.NK] * FL.VS, v1 = w.o[FL.NK + 1] * FL.VS, lam = FL.DLS;
  var a = -L1 * s1 - L2 * s12, b = -L2 * s12, c = L1 * c1 + L2 * c12, d = L2 * c12;
  var m00 = a * a + b * b + lam, m01 = a * c + b * d, m11 = c * c + d * d + lam, det = m00 * m11 - m01 * m01;
  var w0 = (m11 * v0 - m01 * v1) / det, w1 = (-m01 * v0 + m00 * v1) / det;
  out[0] = a * w0 + c * w1; out[1] = b * w0 + d * w1;
}
/* one rollout of the model on a layout under gust FL.GUST: 1 if it reaches the end without touching a post within the horizon, else 0.  The draws are BN.rollout's: the start offset, then two per step. */
FL.rollout = function (net, w, x, world, rng) {
  var th = world.th, body = world.w.body, posts = world.w.posts, np = posts.length, xe = world.xe, T = world.T, noise = FL.GUST, dt = 0.05, vmax = 1.5;
  var q = BN.slalom.startQ(world.w, FL.JIT * BN.randn(rng)).slice(), u = [0, 0], t, i;
  for (t = 0; t < T; t++) {
    var px = body.L1 * cos(q[0]) + body.L2 * cos(q[0] + q[1]), py = body.L1 * sin(q[0]) + body.L2 * sin(q[0] + q[1]);
    for (i = 0; i < np; i++) if (hypot(px - posts[i][0], py - posts[i][1]) < CONTACT) return 0;
    if (px > xe - 0.02) return 1;
    command(net, w, x, th, body, q, u);
    var c0 = max(-vmax, min(vmax, u[0])), c1 = max(-vmax, min(vmax, u[1]));
    q[0] += dt * (c0 + noise * BN.randn(rng)); q[1] += dt * (c1 + noise * BN.randn(rng));
  }
  return 0;
};
/* success over the layouts: R rollouts each, rollout r of layout i drawing from BN.rng(ESEED + 1000 i + r + 1) */
FL.success = function (net, w, R) {
  var W = FL.worlds(), x = new Float64Array(FL.DIN), ok = 0, i, r;
  for (i = 0; i < W.length; i++) for (r = 0; r < R; r++) ok += FL.rollout(net, w, x, W[i], BN.rng(FL.ESEED + 1000 * i + r + 1));
  return ok / (W.length * R) * 100;
};
/* on-policy corrections: one rollout of the model per layout, every visited state labelled by the expert; returns the frames */
FL.corrections = function (net, w) {
  var W = FL.worlds(), tab = FL.table(4096), x = new Float64Array(FL.DIN), u = [0, 0], i;
  for (i = 0; i < W.length; i++) {
    var pol = function (q) { command(net, w, x, W[i].th, W[i].w.body, q, u); return [u[0], u[1]]; };
    var ro = BN.rollout(W[i].w, pol, BN.rng(FL.CSEED + 1000 * i + 1), { noise: FL.GUST, jit: FL.JIT });
    FL.append(tab, ro, W[i]);
  }
  return tab;
};

/* ───────────────────────────── stage 1: pretrain on K ───────────────────────────── */
FL.stage1 = function (seed, vseed) {
  var s = { seed: seed, voc: FL.vocab(vseed === undefined ? FL.VSEED : vseed), net: FL.net(seed), step: 0, curve: [], done: false }, w = FL.work(), g = FL.newGrad(), x = new Float64Array(FL.DIN), rng = BN.rng(21 + seed), train = FL.TRAIN.all;
  s.ps = FL.probeSet(s.voc);
  var rec = function () { var p = FL.probe(s.net, s.ps, w); s.curve.push({ s: s.step, k: p.acc }); s.k0 = p.acc; s.kloss0 = p.loss; s.kA0 = p.accA; s.kB0 = p.accB; };
  rec();
  s.advance = function () {
    var stop = min(FL.PRE, s.step + FL.CHUNK), B = FL.BATCH, b;
    while (s.step < stop) {
      s.step++;
      FL.zero(g);
      for (b = 0; b < B; b++) { var k = FL.draw(s.voc, rng, x, FL.NWORDS); FL.grad(s.net, g, w, x, 0, 0, s.voc.cls[k]); }
      FL.adam(s.net, g, FL.lrAt(FL.LR, s.step, FL.PRE), 1 / B, train);
    }
    rec();
    if (s.step >= FL.PRE) s.done = true;
    return !s.done;
  };
  return s;
};

/* ───────────────────────────── stages 2 and 3: a run ───────────────────────────── */
FL.VARIANTS = {
  recipe: {}, lr03: { mult: 0.3 }, lr3: { mult: 3 }, head: { train: 'head' }, layer1: { train: 'layer1' },
  kend: { tail: 'konly' }, half: { nwords: 60 }, nomix3: { rho3: 0 }, anchor: { anchor: 0.03 }
};
/* cfg: {variant, rho, curve}.  Returns a resumable run: advance() does one chunk of work and returns true while there is more; run.curve is filled as it goes. */
FL.run = function (s1, cfg) {
  var v = FL.VARIANTS[cfg.variant || 'recipe'], rho = (cfg.variant === 'kend' || cfg.variant === 'anchor') ? 0 : cfg.rho, mult = v.mult || 1, every = round(FL.EVERY / mult), S2 = 12 * every;
  var rho3 = v.rho3 !== undefined ? v.rho3 : rho, nwords = v.nwords || FL.NWORDS, train = FL.TRAIN[v.train || 'all'], lam = v.anchor || 0, tail = v.tail || 'corr';
  var run = { cfg: cfg, S2: S2, every: every, S3: FL.S3, curve: [], done: false, stage: 2, step: 0, net: FL.clone(s1.net), s1: s1 };
  FL.resetAdam(run.net);                                            // a fresh optimiser for post-training
  var net = run.net, w = FL.work(), g = FL.newGrad(), x = new Float64Array(FL.DIN), rng = BN.rng(300 + s1.seed), B = FL.BATCH, demos = FL.demos(), held = FL.held();
  var ref = s1.net, steps3 = FL.S3, total = S2 + steps3, full = cfg.curve !== false;
  var rec = function (final) {
    var p = FL.probe(net, s1.ps, w), pt = { s: run.step, stage: run.stage, k: p.acc, kA: p.accA, kB: p.accB, kloss: p.loss, d: FL.dist(net, ref), copy: FL.copyError(net, held, w) };
    pt.b = FL.success(net, w, FL.REPS);
    run.curve.push(pt); return pt;
  };
  rec();
  var train1 = function (S, lr0, tab, nK, nW, doAnchor) {            // the training steps of one stage; the caller asks for them in chunks
    var nB = B - nK, anc = doAnchor ? lam : 0;
    return function (from, to) {
      for (var s = from + 1; s <= to; s++) {
        FL.zero(g);
        var b;
        if (nB > 0 && tab) for (b = 0; b < nB; b++) { var id = floor(rng() * tab.n); FL.grad(net, g, w, tab.X, id * FL.DIN, 1, 0, tab.Y, id * 2); }
        for (b = 0; b < nK; b++) { var k = FL.draw(s1.voc, rng, x, nW); FL.grad(net, g, w, x, 0, 0, s1.voc.cls[k]); }
        if (anc > 0) { var keys = ['W1', 'b1', 'W2', 'b2'], q, i; for (q = 0; q < 4; q++) { var Wq = net[keys[q]], Rq = ref[keys[q]], Gq = g[keys[q]]; for (i = 0; i < Wq.length; i++) Gq[i] += B * anc * (Wq[i] - Rq[i]); } }
        FL.adam(net, g, FL.lrAt(lr0, s, S), 1 / B, train);
      }
    };
  };
  var nK2 = round(rho * B), nK3 = round(rho3 * B);
  var job2 = train1(S2, FL.LR * mult, demos, nK2, nwords, true), job3 = null, from = 0;
  run.advance = function () {
    var to;
    if (run.stage === 2) {
      to = min(S2, from + every); job2(from, to); run.step = to; from = to;
      if (full || to === S2) rec();
      if (to >= S2) { run.stage = 3; from = 0; run.afterPost = run.curve[run.curve.length - 1]; if (tail === 'corr') { var cor = FL.corrections(net, w), agg = FL.table(demos.n + cor.n); agg.X.set(demos.X.subarray(0, demos.n * FL.DIN)); agg.Y.set(demos.Y.subarray(0, demos.n * 2)); agg.X.set(cor.X.subarray(0, cor.n * FL.DIN), demos.n * FL.DIN); agg.Y.set(cor.Y.subarray(0, cor.n * 2), demos.n * 2); agg.n = demos.n + cor.n; run.ncor = cor.n; job3 = train1(steps3, FL.LR3, agg, nK3, nwords, true); } else { job3 = train1(steps3, FL.LR3, null, B, FL.NWORDS, false); } FL.resetAdam(net); }
      return true;
    }
    to = min(steps3, from + FL.EVERY); job3(from, to); run.step = S2 + to; from = to;
    if (full || to === steps3) rec();
    if (to >= steps3) { run.done = true; run.end = run.curve[run.curve.length - 1]; return false; }
    return true;
  };
  return run;
};
/* the numbers a run is read by (from whatever has been computed so far) */
FL.summary = function (run) {
  var c = run.curve, k0 = run.s1.k0, out = { k0: k0, post: run.afterPost || null, end: run.done ? run.end : null, t50: null, alarm: null };
  for (var i = 0; i < c.length; i++) {
    if (c[i].stage === 2 && out.t50 === null && c[i].b >= 50) out.t50 = c[i].s;
    if (c[i].stage === 2 && out.alarm === null && c[i].s > 0 && c[i].k < k0 - FL.ALARM) out.alarm = c[i].s;
  }
  return out;
};

/* ───────────────────────────── the picture ─────────────────────────────
 * P: { s1: the stage-1 model, run: the run on show (null while it is being computed), rho: its share of K, ends: for every share of FL.RHOS the end of its default recipe, { post, end }, or null }.
 * Top: the probe, success and copy error against steps (stage 1 is compressed into the first F1 of the width); bottom: the end of the recipe against the share. */
FL.RHOS = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7]; FL.F1 = 0.17;
FL.paint = function (cv, P) {
  var D = BN.draw, C = BN.C, RHOS = FL.RHOS, F1 = FL.F1, s1 = P.s1, run = P.run;
  function legend(ctx, items, x0, y0, xmax) {         // wraps onto a second row when it would run past xmax
    var x = x0, y = y0;
    items.forEach(function (it) {
      var w = 25 + it.t.length * 6.2;
      if (x + w > xmax && x > x0) { x = x0; y += 13; }
      if (it.dash) D.line(ctx, x, y, x + 12, y, it.c, 2, [3, 2]); else { ctx.fillStyle = it.c; ctx.fillRect(x, y - 4, 10, 8); }
      D.mono(ctx, it.t, x + 15, y, C.mute, 10); x += w;
    });
  }
  function band(ctx, labels, x0, x1, y) {             // the longest label that fits the band
    var t = labels.filter(function (s) { return s.length * 6.2 + 8 < x1 - x0; })[0];
    if (t) D.mono(ctx, t, (x0 + x1) / 2, y, C.mute, 10, 'center');
  }

  function drawCurves(ctx, bx, by, bw, bh, narrow, run) {
    var k0 = s1.k0, S2 = run ? run.S2 : FL.S2, S = S2 + FL.S3, px = bx + 30, pw = bw - 40, py = by + (narrow ? 64 : 50), ph = bh - (py - by) - 34, cs = run ? run.curve : [], sm = run ? FL.summary(run) : null;
    var X2 = function (s) { return F1 + s / S * (1 - F1); }, xs2 = cs.map(function (c) { return X2(c.s); }), col = function (f) { return cs.map(f); };
    D.text(ctx, 'probe, success, copy error (%) against steps', bx + 6, by + 10, C.mute, 11);
    legend(ctx, [{ c: C.teal, t: 'K probe' }, { c: C.amber, t: 'success' }, { c: C.purple, t: 'copy error', dash: 1 }, { c: C.red, t: 'alarm line', dash: 1 }], bx + 6, by + 25, bx + bw - 6);
    var ser = [{ xs: [0, F1], ys: [10, 10], color: C.dim, width: 1, dash: [2, 3] },
               { xs: s1.curve.map(function (c) { return c.s / FL.PRE * F1; }), ys: s1.curve.map(function (c) { return c.k; }), color: C.teal, width: 2 }];
    if (run) ser.push({ xs: [F1, 1], ys: [k0 - FL.ALARM, k0 - FL.ALARM], color: C.red, width: 1, dash: [2, 3] },
      { xs: xs2, ys: col(function (c) { return c.k; }), color: C.teal, width: 2, dots: true, r: 2.5 },
      { xs: xs2, ys: col(function (c) { return c.b; }), color: C.amber, width: 2, dots: true, r: 2.5 },
      { xs: xs2, ys: col(function (c) { return Math.min(100, c.copy); }), color: C.purple, width: 1.5, dash: [4, 3] });
    var PL = D.plot(ctx, ser, px, py, pw, ph, { xmin: 0, xmax: 1, ymin: 0, ymax: 100, yticks: [0, 25, 50, 75, 100] });
    var xa = PL.X(F1), xb = PL.X(X2(S2));
    D.line(ctx, xa, py, xa, py + ph, C.dim, 1, [4, 3]); D.line(ctx, xb, py, xb, py + ph, C.dim, 1, [4, 3]);
    band(ctx, ['1 · K alone', '1'], px, xa, py - 8); band(ctx, ['2 · post-train', '2'], xa, xb, py - 8); band(ctx, ['3 · corrections', '3'], xb, px + pw, py - 8);
    D.mono(ctx, '0', xa, py + ph + 10, C.mute, 10, 'center'); D.mono(ctx, String(S2), xb, py + ph + 10, C.mute, 10, 'center'); D.mono(ctx, String(S), px + pw, py + ph + 10, C.mute, 10, 'right');
    D.mono(ctx, 'steps of post-training and corrections', px + pw / 2, py + ph + 24, C.mute, 10, 'center');
    var at = function (s) { return cs.filter(function (c) { return c.stage === 2 && c.s === s; })[0]; }, a = sm && sm.alarm !== null ? at(sm.alarm) : null, b = sm && sm.t50 !== null ? at(sm.t50) : null;
    if (a) D.dot(ctx, PL.X(X2(a.s)), PL.Y(a.k), 5, C.red, C.white);
    if (b) D.dot(ctx, PL.X(X2(b.s)), PL.Y(b.b), 6, C.white, C.amber);
  }

  function drawSweep(ctx, bx, by, bw, bh, narrow, run) {
    var xs = [], pk = [], pb = [], pp = [], i, e, ci = RHOS.indexOf(P.rho), py = by + (narrow ? 52 : 40), ph = bh - (py - by) - 34;
    for (i = 0; i < RHOS.length; i++) if ((e = P.ends[i])) { xs.push(i); pk.push(e.end.k); pb.push(e.end.b); pp.push(e.post.b); }
    D.text(ctx, 'end of the recipe against the share of K (seed 1)', bx + 6, by + 10, C.mute, 11);
    legend(ctx, [{ c: C.teal, t: 'probe' }, { c: C.amber, t: 'success' }, { c: C.amber, t: 'success when post-training ends', dash: 1 }], bx + 6, by + 25, bx + bw - 6);
    var PL = D.plot(ctx, [{ xs: xs, ys: pp, color: C.amber, width: 1.5, dash: [4, 3] }, { xs: xs, ys: pk, color: C.teal, width: 2, dots: true }, { xs: xs, ys: pb, color: C.amber, width: 2, dots: true }],
      bx + 30, py, bw - 40, ph, { xmin: -0.5, xmax: 7.5, ymin: 0, ymax: 100, xticks: [0, 1, 2, 3, 4, 5, 6, 7], yticks: [0, 50, 100], fmtx: function (t) { return String(Math.round(RHOS[t] * 100)); }, xlabel: 'share of K in every batch, ρ (%)' });
    ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = C.teal; ctx.fillRect(PL.X(ci - 0.5), py, PL.X(ci + 0.5) - PL.X(ci - 0.5), ph); ctx.restore();
    if (run && run.done) { D.dot(ctx, PL.X(ci), PL.Y(run.end.k), 6, C.white, C.teal); D.dot(ctx, PL.X(ci), PL.Y(run.end.b), 6, C.white, C.amber); }
  }

  var narrow = (cv.clientWidth || 640) < 600, hh = narrow ? 740 : 500, topH = narrow ? 380 : 270;
  if (cv.style.height !== hh + 'px') cv.style.height = hh + 'px';
  var s = D.setup(cv);
  drawCurves(s.ctx, 4, 4, s.w - 8, topH, narrow, run);
  drawSweep(s.ctx, 4, topH + 12, s.w - 8, s.h - topH - 16, narrow, run);
};

root.FL = FL;
if (typeof module !== 'undefined' && module.exports) module.exports = FL;
})(typeof window !== 'undefined' ? window : globalThis);
