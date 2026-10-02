/* l14_action.js — private engine of World Models lesson 14, "Actions without labels, worlds in real time".  Global L14; needs courtyard.js (CY) first.
 *
 * THE VIDEO.  Courtyard clips (no curtain).  A player presses one of 9 buttons at every step: neutral (probability P0 = 0.5) or one of the 8 compass directions (each 1/16),
 *   a push of M = 0.6 m/s added to the velocity at the start of the step.  The player's presses are never recorded.  A frame is a READING of the ball's state:
 *   position to SX = 1 cm, velocity to SV = 0.06 m/s, independent for every frame.  Clips start in the middle of the floor at 0.6 m/s per axis and end after 40 steps or as soon as the
 *   ball is within 0.4 m of a wall (L14.video, walls = false); with walls = true they run on and the ball bounces (section 6).
 * THE PASSIVE LAW is fitted from the unlabelled video by least squares: v' = d^ v and x' - x = g^ v.  THE UNEXPLAINED PUSH of a frame pair is u = v'/d^ - v (two numbers, m/s).
 * THE INVERSE DYNAMICS MODEL (IDM) is a ridge regression from the two frames (8 numbers + 1) to the push; THE LATENT ACTION MODEL (LAM) is k-means on u with K codes
 *   (restarts, then Lloyd): the encoder is "nearest code", the decoder is "passive law + the code's push".
 * NAMING a code = the majority of the true buttons among the labelled frame pairs that fall in it.  CONTROLLABILITY = the spread of the next frame's velocity between two
 *   different buttons against the spread between two draws of the same button (lesson 11's definition).
 * THE SAMPLER draws the push by n passes of Euler steps on the probability-flow ODE of a variance-exploding diffusion, with the EXACT denoiser of the code mixture
 *   (so the only error is the step count); one pass is the conditional mean.
 * THE SMOOTH MODEL (section 6) is a linear map plus 48 random tanh features with output weights fitted by ridge regression: state, push -> change of state.
 * Everything is deterministic (seeded).  Node: module.exports.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require === 'function' ? require('./courtyard.js') : null);
var PI = Math.PI, L = {};
L.C = { P0: 0.5, M: 0.6, SX: 0.01, SV: 0.06, MARGIN: 0.4, TCLIP: 40, N: 3600, SMAX: 1.5, SMIN: 0.02, RHO: 7, FPS: 24 };
L.W = CY.world({ curtain: null });
var D0 = Math.exp(-L.W.gamma * L.W.dt), G0 = (1 - D0) / L.W.gamma;               // the exact friction constants of one step
L.D0 = D0; L.G0 = G0;
L.SYM = function (k) { return k < 0 ? [0, 0] : [L.C.M * Math.cos(k * PI / 4), L.C.M * Math.sin(k * PI / 4)]; };      // the push of button k (-1 = neutral)

/* ───────── the video ───────── */
function reading(s, rng) { var P = L.C; return [s[0] + P.SX * CY.randn(rng), s[1] + P.SX * CY.randn(rng), s[2] + P.SV * CY.randn(rng), s[3] + P.SV * CY.randn(rng)]; }
function nearWall(s) { var m = L.C.MARGIN; return s[0] < m || s[0] > L.W.W - m || s[1] < m || s[1] > L.W.H - m; }
L.video = function (seed, n, o) {
  o = o || {};
  var rng = CY.rng(seed), rows = [], P = L.C, clip = 0;
  while (rows.length < n) {
    var s = [1 + 6 * rng(), 1 + 3 * rng(), 0.6 * CY.randn(rng), 0.6 * CY.randn(rng)];
    for (var t = 0; t < P.TCLIP && rows.length < n; t++) {
      var u = rng(), k = -1, a = [0, 0];
      if (u >= P.P0) { k = Math.min(7, Math.floor((u - P.P0) / (1 - P.P0) * 8)); a = L.SYM(k); }
      var s2 = CY.step(L.W, s, k < 0 ? null : a);
      var contact = Math.abs(s2[0] - (s[0] + G0 * (s[2] + a[0]))) > 1e-9 || Math.abs(s2[1] - (s[1] + G0 * (s[3] + a[1]))) > 1e-9;
      rows.push({ s: s, s2: s2, z: reading(s, rng), z2: reading(s2, rng), k: k, a: a, contact: contact, clip: clip, t: t });
      s = s2;
      if (!o.walls && nearWall(s)) break;
    }
    clip++;
  }
  return rows;
};

/* ───────── the passive law and the unexplained push ───────── */
L.fitPassive = function (rows) {
  var vv = 0, v2v = 0, xv = 0, i, q;
  for (i = 0; i < rows.length; i++) for (q = 0; q < 2; q++) { var v = rows[i].z[2 + q]; vv += v * v; v2v += rows[i].z2[2 + q] * v; xv += (rows[i].z2[q] - rows[i].z[q]) * v; }
  return { d: v2v / vv, g: xv / vv };
};
L.unexplained = function (rows, pas) { return rows.map(function (r) { return [r.z2[2] / pas.d - r.z[2], r.z2[3] / pas.d - r.z[3]]; }); };

/* ───────── the inverse dynamics model: ridge regression from both frames to the push (non-causal: it reads the frame AFTER the push) ───────── */
L.idmFit = function (rows, idx) {
  var n = idx.length, p = 9, Phi = new Float64Array(n * p), Y = new Float64Array(n * 2), i, q;
  for (i = 0; i < n; i++) { var r = rows[idx[i]]; for (q = 0; q < 4; q++) { Phi[i * p + q] = r.z[q]; Phi[i * p + 4 + q] = r.z2[q]; } Phi[i * p + 8] = 1; Y[i * 2] = r.a[0]; Y[i * 2 + 1] = r.a[1]; }
  return CY.la.ridge(Phi, n, p, Y, 2, 1e-3);
};
L.idmPredict = function (w, r) { var x = r.z.concat(r.z2, [1]), o = [0, 0], j; for (j = 0; j < 9; j++) { o[0] += x[j] * w[j * 2]; o[1] += x[j] * w[j * 2 + 1]; } return o; };
function nearestButton(a) { var bi = -1, bd = Math.hypot(a[0], a[1]), k; for (k = 0; k < 8; k++) { var s = L.SYM(k), d = Math.hypot(a[0] - s[0], a[1] - s[1]); if (d < bd) { bd = d; bi = k; } } return bi; }
L.idmScore = function (w, rows) {          // w = null: no model, the push is guessed to be zero
  var e = 0, ok = 0, i;
  for (i = 0; i < rows.length; i++) { var a = w ? L.idmPredict(w, rows[i]) : [0, 0]; e += (a[0] - rows[i].a[0]) * (a[0] - rows[i].a[0]) + (a[1] - rows[i].a[1]) * (a[1] - rows[i].a[1]); if (nearestButton(a) === rows[i].k) ok++; }
  return { rmse: Math.sqrt(e / rows.length), acc: ok / rows.length };
};

/* ───────── the latent action model: K codes, k-means on the unexplained push ───────── */
function lloyd(U, centers, iters) {
  var K = centers.length, n = U.length, assign = new Int32Array(n), inertia = 0, it, i, k;
  for (it = 0; it < iters; it++) {
    var sx = new Float64Array(K), sy = new Float64Array(K), cnt = new Int32Array(K);
    inertia = 0;
    for (i = 0; i < n; i++) {
      var best = 0, bd = Infinity;
      for (k = 0; k < K; k++) { var dx = U[i][0] - centers[k][0], dy = U[i][1] - centers[k][1], e = dx * dx + dy * dy; if (e < bd) { bd = e; best = k; } }
      assign[i] = best; inertia += bd; sx[best] += U[i][0]; sy[best] += U[i][1]; cnt[best]++;
    }
    for (k = 0; k < K; k++) if (cnt[k]) centers[k] = [sx[k] / cnt[k], sy[k] / cnt[k]];
  }
  return { centers: centers, assign: assign, inertia: inertia };
}
L.lam = function (U, K, restarts) {
  var best = null, sd, n = U.length, i, k;
  for (sd = 1; sd <= (restarts || 12); sd++) { var km = CY.kmeans(U, K, { seed: sd, iters: 10 }); if (!best || km.inertia < best.inertia) best = km; }
  var fin = lloyd(U, Array.prototype.map.call(best.centers, function (c) { return [c[0], c[1]]; }), 25);
  var cnt = new Array(K).fill(0), s2 = new Array(K).fill(0);
  for (i = 0; i < n; i++) { var c = fin.assign[i]; cnt[c]++; s2[c] += (U[i][0] - fin.centers[c][0]) * (U[i][0] - fin.centers[c][0]) + (U[i][1] - fin.centers[c][1]) * (U[i][1] - fin.centers[c][1]); }
  var H = 0; for (k = 0; k < K; k++) if (cnt[k]) H -= cnt[k] / n * Math.log2(cnt[k] / n);
  return { K: K, centers: fin.centers, assign: fin.assign, inertia: fin.inertia, rms: Math.sqrt(fin.inertia / n / 2), pi: cnt.map(function (v) { return v / n; }),
           sd: s2.map(function (v, j) { return cnt[j] ? Math.sqrt(v / cnt[j] / 2) : 0; }), H: H };
};
L.encode = function (lam, u) { return CY.kmeans.nearest(lam.centers, u); };

/* purity, entropy of the code, and the information it carries about the true button (bits) from the confusion table */
L.confusion = function (assign, rows, K) {
  var cnt = [], c, i; for (c = 0; c < K; c++) cnt.push(new Array(9).fill(0));
  for (i = 0; i < rows.length; i++) cnt[assign[i]][rows[i].k + 1]++;
  return cnt;
};
L.codeStats = function (cnt) {
  var K = cnt.length, n = 0, good = 0, pc = [], pa = new Array(9).fill(0), Hc = 0, Ha = 0, I = 0, c, a;
  for (c = 0; c < K; c++) { var t = 0; for (a = 0; a < 9; a++) { t += cnt[c][a]; pa[a] += cnt[c][a]; } pc.push(t); n += t; good += Math.max.apply(null, cnt[c]); }
  pc.forEach(function (t) { if (t) Hc -= t / n * Math.log2(t / n); }); pa.forEach(function (t) { if (t) Ha -= t / n * Math.log2(t / n); });
  for (c = 0; c < K; c++) for (a = 0; a < 9; a++) if (cnt[c][a]) I += cnt[c][a] / n * Math.log2(cnt[c][a] * n / (pc[c] * pa[a]));
  return { purity: good / n, Hc: Hc, Ha: Ha, I: I };
};

/* ───────── naming the codes with labelled frame pairs ───────── */
L.order = function (n, seed) { return CY.shuffle(Array.apply(null, Array(n)).map(function (_, i) { return i; }), CY.rng(seed)); };
L.guidedOrder = function (lam, U, base) {        // one frame pair per code (the one nearest its centre, biggest codes first), then the random order
  var picks = [], seen = {}, k, i;
  var codes = lam.centers.map(function (_, c) { return c; }).sort(function (a, b) { return lam.pi[b] - lam.pi[a]; });
  codes.forEach(function (c) {
    var bi = -1, bd = Infinity;
    for (i = 0; i < U.length; i++) if (lam.assign[i] === c) { var d = Math.hypot(U[i][0] - lam.centers[c][0], U[i][1] - lam.centers[c][1]); if (d < bd) { bd = d; bi = i; } }
    if (bi >= 0) { picks.push(bi); seen[bi] = 1; }
  });
  return picks.concat(base.filter(function (j) { return !seen[j]; }));
};
L.name = function (lam, rows, order, n) {       // names[c] = the majority true button among the first n labelled pairs that fall in code c (null: no label yet)
  var cnt = lam.centers.map(function () { return new Array(9).fill(0); }), i, c;
  for (i = 0; i < n; i++) cnt[lam.assign[order[i]]][rows[order[i]].k + 1]++;
  return cnt.map(function (row) { var t = row.reduce(function (a, b) { return a + b; }, 0), bi = 0; if (!t) return null; row.forEach(function (v, a) { if (v > row[bi]) bi = a; }); return bi - 1; });
};
L.nameScore = function (lam, names, rows, codes) {     // a code with no name is read as "neutral"
  var ok = 0, e = 0, i;
  for (i = 0; i < rows.length; i++) { var nm = names[codes[i]] === null ? -1 : names[codes[i]], p = L.SYM(nm), t = rows[i].a; if (nm === rows[i].k) ok++; e += (p[0] - t[0]) * (p[0] - t[0]) + (p[1] - t[1]) * (p[1] - t[1]); }
  var right = 0, k, c;
  for (k = 0; k < 8; k++) {      // is there a button named k whose code really pushes in direction k?
    var dir = L.SYM(k), good = false;
    for (c = 0; c < names.length; c++) if (names[c] === k) { var ce = lam.centers[c], cs = (ce[0] * dir[0] + ce[1] * dir[1]) / (Math.hypot(ce[0], ce[1]) * Math.hypot(dir[0], dir[1]) + 1e-12); if (cs > Math.cos(PI / 8) && Math.hypot(ce[0], ce[1]) > 0.5 * L.C.M) good = true; }
    if (good) right++;
  }
  return { acc: ok / rows.length, rmse: Math.sqrt(e / rows.length), right: right };
};
L.coupon = function (p) {        // expected number of random labelled examples until every code has one: inclusion-exclusion over the subsets of codes
  var K = p.length, E = 0, m, c;
  for (m = 1; m < (1 << K); m++) { var s = 0, b = 0; for (c = 0; c < K; c++) if (m & (1 << c)) { s += p[c]; b++; } E += (b % 2 ? 1 : -1) / s; }
  return E;
};

/* ───────── the sampler: n passes of Euler steps with the exact denoiser of the code mixture ───────── */
L.mix = function (lam) { return { pi: lam.pi.slice(), mu: lam.centers.map(function (c) { return c.slice(); }), sd: lam.sd.slice() }; };
L.one = function (mix, c) { return { pi: [1], mu: [mix.mu[c].slice()], sd: [mix.sd[c]] }; };
L.denoise = function (mix, x, sg) {         // E[push | x + noise of size sg]
  var K = mix.pi.length, lw = [], mx = -Infinity, k, Z = 0, o0 = 0, o1 = 0;
  for (k = 0; k < K; k++) { var v = mix.sd[k] * mix.sd[k] + sg * sg, d2 = (x[0] - mix.mu[k][0]) * (x[0] - mix.mu[k][0]) + (x[1] - mix.mu[k][1]) * (x[1] - mix.mu[k][1]), l = Math.log(mix.pi[k]) - Math.log(v) - d2 / (2 * v); lw.push(l); if (l > mx) mx = l; }
  for (k = 0; k < K; k++) {
    var w = Math.exp(lw[k] - mx), v2 = mix.sd[k] * mix.sd[k], sh = v2 / (v2 + sg * sg); Z += w;
    o0 += w * (mix.mu[k][0] + sh * (x[0] - mix.mu[k][0])); o1 += w * (mix.mu[k][1] + sh * (x[1] - mix.mu[k][1]));
  }
  return [o0 / Z, o1 / Z];
};
L.sigmas = function (n) {
  var P = L.C, s = [], i, t;
  for (i = 0; i < n; i++) { t = n === 1 ? 0 : i / (n - 1); s.push(Math.pow(Math.pow(P.SMAX, 1 / P.RHO) + t * (Math.pow(P.SMIN, 1 / P.RHO) - Math.pow(P.SMAX, 1 / P.RHO)), P.RHO)); }
  s.push(0);
  return s;
};
L.sample = function (mix, n, N, seed) {      // N draws of the push, n passes each
  var rng = CY.rng(seed), sg = L.sigmas(n), out = [], j, i;
  for (j = 0; j < N; j++) {
    var x = [L.C.SMAX * CY.randn(rng), L.C.SMAX * CY.randn(rng)];
    for (i = 0; i < n; i++) { var d = L.denoise(mix, x, sg[i]), h = (sg[i + 1] - sg[i]) / sg[i]; x = [x[0] + h * (x[0] - d[0]), x[1] + h * (x[1] - d[1])]; }
    out.push(x);
  }
  return out;
};
L.modeStats = function (mix, xs) {           // which codes the draws land on, against how often the video presses them
  var K = mix.pi.length, h = new Array(K).fill(0), off = 0, i, k;
  for (i = 0; i < xs.length; i++) {
    var bi = 0, bd = Infinity; for (k = 0; k < K; k++) { var d = Math.hypot(xs[i][0] - mix.mu[k][0], xs[i][1] - mix.mu[k][1]); if (d < bd) { bd = d; bi = k; } }
    h[bi]++; if (bd > 3 * mix.sd[bi]) off++;
  }
  var tv = 0; for (k = 0; k < K; k++) tv += Math.abs(h[k] / xs.length - mix.pi[k]) / 2;
  return { covered: h.filter(function (v) { return v > 0; }).length, tv: tv, off: off / xs.length };
};

/* ───────── controllability: between two buttons against two draws of the same button (lesson 11) ───────── */
L.control = function (mix, N, seed, told) {
  var rng = CY.rng(seed), K = mix.pi.length, bt = 0, wn = 0, i;
  function draw(c) { return [mix.mu[c][0] + mix.sd[c] * CY.randn(rng), mix.mu[c][1] + mix.sd[c] * CY.randn(rng)]; }
  function free() { var u = rng(), acc = 0, c; for (c = 0; c < K; c++) { acc += mix.pi[c]; if (u <= acc) break; } return draw(Math.min(c, K - 1)); }
  for (i = 0; i < N; i++) {
    var c1 = Math.floor(rng() * K), c2 = (c1 + 1 + Math.floor(rng() * (K - 1))) % K, a, b, w1, w2;
    if (told) { a = draw(c1); b = draw(c2); w1 = draw(c1); w2 = draw(c1); } else { a = free(); b = free(); w1 = free(); w2 = free(); }
    bt += Math.hypot(a[0] - b[0], a[1] - b[1]) / N; wn += Math.hypot(w1[0] - w2[0], w1[1] - w2[1]) / N;
  }
  return { between: bt, within: wn, ratio: bt / wn };
};

/* ───────── the smooth model of section 6: linear map + 48 random tanh features, ridge regression ───────── */
var NF = 48;
function smoothInput(s, a) { return [s[0] / 4 - 1, s[1] / 2.5 - 1, s[2], s[3], a[0], a[1]]; }
L.smoothFit = function (rows) {
  var rng = CY.rng(11), A = [], b = [], h, j;
  for (h = 0; h < NF; h++) { var w = []; for (j = 0; j < 6; j++) w.push(CY.randn(rng)); A.push(w); b.push(CY.randn(rng)); }
  var model = { A: A, b: b, W: null }, n = rows.length, p = 7 + NF, Phi = new Float64Array(n * p), Y = new Float64Array(n * 4), i;
  for (i = 0; i < n; i++) { Phi.set(L.smoothFeatures(model, smoothInput(rows[i].z, rows[i].a)), i * p); for (j = 0; j < 4; j++) Y[i * 4 + j] = rows[i].z2[j] - rows[i].z[j]; }
  model.W = CY.la.ridge(Phi, n, p, Y, 4, 1e-3);
  return model;
};
L.smoothFeatures = function (m, x) {
  var f = new Float64Array(7 + NF), h, j; for (j = 0; j < 6; j++) f[j] = x[j]; f[6] = 1;
  for (h = 0; h < NF; h++) { var s = m.b[h]; for (j = 0; j < 6; j++) s += m.A[h][j] * x[j]; f[7 + h] = Math.tanh(s); }
  return f;
};
L.smoothStep = function (m, s, a) {          // the model's next state
  var f = L.smoothFeatures(m, smoothInput(s, a)), o = [s[0], s[1], s[2], s[3]], q, j;
  for (q = 0; q < 4; q++) for (j = 0; j < f.length; j++) o[q] += f[j] * m.W[j * 4 + q];
  return o;
};
L.smoothScore = function (m, rows) {          // rms error of the next velocity (m/s) on the steps that touch a wall and on the others, from the TRUE state and push
  var ef = 0, ec = 0, nf = 0, nc = 0, i;
  for (i = 0; i < rows.length; i++) {
    var p = L.smoothStep(m, rows[i].s, rows[i].a), e = (p[2] - rows[i].s2[2]) * (p[2] - rows[i].s2[2]) + (p[3] - rows[i].s2[3]) * (p[3] - rows[i].s2[3]);
    if (rows[i].contact) { ec += e; nc++; } else { ef += e; nf++; }
  }
  return { free: Math.sqrt(ef / nf), contact: Math.sqrt(ec / nc), nFree: nf, nContact: nc, ratio: Math.sqrt(ec / nc) / Math.sqrt(ef / nf) };
};

/* ───────── sessions: the model driven by the player's presses, against the world ───────── */
L.session = function (m, seed, T) {
  var rng = CY.rng(seed), s = [1 + 6 * rng(), 1 + 3 * rng(), 0.6 * CY.randn(rng), 0.6 * CY.randn(rng)], q = s.slice(), tr = [[s[0], s[1]]], md = [[q[0], q[1]]], err = [], tc = -1, t;
  for (t = 0; t < T; t++) {
    var u = rng(), k = -1, a = [0, 0];
    if (u >= L.C.P0) { k = Math.min(7, Math.floor((u - L.C.P0) / (1 - L.C.P0) * 8)); a = L.SYM(k); }
    var s2 = CY.step(L.W, s, k < 0 ? null : a);
    if (tc < 0 && (Math.abs(s2[0] - (s[0] + G0 * (s[2] + a[0]))) > 1e-9 || Math.abs(s2[1] - (s[1] + G0 * (s[3] + a[1]))) > 1e-9)) tc = t;
    q = L.smoothStep(m, q, a); s = s2; tr.push([s[0], s[1]]); md.push([q[0], q[1]]); err.push(Math.hypot(q[0] - s[0], q[1] - s[1]));
  }
  return { truth: tr, model: md, err: err, tc: tc };
};
function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b.length ? b[Math.floor(b.length / 2)] : NaN; }
L.sessionStats = function (m, N, T, seed) {
  var free = [], hit = [], i;
  for (i = 0; i < N; i++) { var r = L.session(m, seed + i, T); (r.tc < 0 ? free : hit).push(r); }
  return { share: hit.length / N, free10: median(free.map(function (r) { return r.err[9]; })), free20: median(free.map(function (r) { return r.err[19]; })), free40: median(free.map(function (r) { return r.err[T - 1]; })),
           hit0: median(hit.filter(function (r) { return r.tc + 4 < T; }).map(function (r) { return r.err[r.tc]; })), hit4: median(hit.filter(function (r) { return r.tc + 4 < T; }).map(function (r) { return r.err[r.tc + 4]; })),
           nFree: free.length, nHit: hit.length };
};

/* ───────── what the widget needs: one setup, one model per number of codes ───────── */
L.NS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200];
L.setup = function () {
  var S = { cache: {}, samples: {} };
  S.rows = L.video(1, L.C.N); S.pas = L.fitPassive(S.rows); S.U = L.unexplained(S.rows, S.pas);
  S.te = L.video(2, L.C.N); S.Ute = L.unexplained(S.te, S.pas);
  S.order = L.order(S.rows.length, 321);
  var e = 0; S.rows.forEach(function (r, i) { e += Math.pow(S.U[i][0] - r.a[0], 2) + Math.pow(S.U[i][1] - r.a[1], 2); });
  S.floor = Math.sqrt(e / S.rows.length / 2);
  S.idm = L.NS.map(function (n) { return L.idmScore(n ? L.idmFit(S.rows, S.order.slice(0, n)) : null, S.te); });
  return S;
};
L.model = function (S, K) {
  if (S.cache[K]) return S.cache[K];
  var lam = L.lam(S.U, K), codesTe = S.Ute.map(function (u) { return L.encode(lam, u); }), mix = L.mix(lam), guided = L.guidedOrder(lam, S.U, S.order);
  var m = { lam: lam, mix: mix, codesTe: codesTe, guided: guided, stats: L.codeStats(L.confusion(lam.assign, S.rows, K)),
            told: L.control(mix, 4000, 7, true), free: L.control(mix, 4000, 7, false) };
  m.curveR = L.NS.map(function (n) { return L.nameScore(lam, L.name(lam, S.rows, S.order, n), S.te, codesTe); });
  m.curveG = L.NS.map(function (n) { return L.nameScore(lam, L.name(lam, S.rows, guided, n), S.te, codesTe); });
  S.cache[K] = m;
  return m;
};
L.passes = function (S, K, n) {      // 2000 draws of the push by n passes (cached); the picture shows the first 600
  var key = K + '/' + n;
  if (!S.samples[key]) { var m = L.model(S, K); S.samples[key] = { xs: L.sample(m.mix, n, 2000, 5), stat: null }; S.samples[key].stat = L.modeStats(m.mix, S.samples[key].xs); }
  return S.samples[key];
};
L.exitSetup = function (S) {        // section 6: the smooth model fitted to clips cut before the walls, and to a video with the bounces left in
  if (S.exit) return S.exit;
  var teW = L.video(4, L.C.N, { walls: true }), trW = L.video(3, L.C.N, { walls: true }), mC = L.smoothFit(S.rows), mW = L.smoothFit(trW);
  var sC = L.smoothScore(mC, teW), sW = L.smoothScore(mW, teW), ses = L.sessionStats(mC, 400, 40, 9), pick = null, i;
  for (i = 0; i < 400 && !pick; i++) { var r = L.session(mC, 9 + i, 40); if (r.tc >= 14 && r.tc <= 26) pick = r; }
  S.exit = { sC: sC, sW: sW, ses: ses, pick: pick, shareWall: trW.filter(function (r) { return r.contact; }).length / trW.length };
  return S.exit;
};
L.frameMs = function (fps) { return 1000 / fps; };
L.maxPasses = function (fps, ms) { return Math.floor(L.frameMs(fps) / ms + 1e-9); };

/* ───────── the widget: numbers (L14.update) and pictures (L14.paint) ───────── */
var ARW = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
function nameRight(lam, c, k) {        // does code c really push the way its name says?
  var ce = lam.centers[c], r = Math.hypot(ce[0], ce[1]);
  if (k < 0) return r < 0.5 * L.C.M;
  var dir = L.SYM(k);
  return r > 0.5 * L.C.M && (ce[0] * dir[0] + ce[1] * dir[1]) / (r * Math.hypot(dir[0], dir[1])) > Math.cos(PI / 8);
}
L.update = function (S, p) {
  var m = L.model(S, p.K), n = p.labels, order = p.guided ? m.guided : S.order, names = L.name(m.lam, S.rows, order, n), sc = L.nameScore(m.lam, names, S.te, m.codesTe);
  var idm = L.idmScore(n ? L.idmFit(S.rows, S.order.slice(0, n)) : null, S.te), ps = L.passes(S, p.K, p.passes), ex = L.exitSetup(S), ms = p.passes * p.ms;
  return { m: m, names: names, sc: sc, idm: idm, ps: ps, ex: ex, ms: ms, fps: 1000 / ms, fit: L.maxPasses(L.C.FPS, p.ms), budget: L.frameMs(L.C.FPS), dec: m.lam.rms * Math.SQRT2, floor: S.floor * Math.SQRT2 };
};
function hue(c, K, a) { return 'hsla(' + Math.round(360 * c / K + 20) + ',62%,44%,' + (a === undefined ? 1 : a) + ')'; }
function planeBox(ctx, box, title) { var D = CY.draw; D.frame(ctx, box[0], box[1], box[2], box[3], CY.C.white); D.mono(ctx, title, box[0] + 8, box[1] + 12, CY.C.mute, 9); }
function note(ctx, box, s, size) {             // a footnote that fits its panel: it wraps at the panel width and sits on the bottom edge
  var D = CY.draw, sz = size || 8, maxW = box[2] - 16, lines = [], cur = '';
  ctx.font = sz + 'px "SF Mono", Menlo, Consolas, monospace';
  function wid(t) { return ctx.measureText ? ctx.measureText(t).width : t.length * 0.6 * sz; }
  s.split(' ').forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (cur && wid(t) > maxW) { lines.push(cur); cur = w; } else cur = t; });
  lines.push(cur);
  lines.forEach(function (l, i) { D.mono(ctx, l, box[0] + 8, box[1] + box[3] - 7 - (lines.length - 1 - i) * (sz + 3), CY.C.mute, sz); });
}
function planeAxes(ctx, box, lim) {
  var D = CY.draw, side = Math.min(box[2] - 24, box[3] - 58), cx = box[0] + box[2] / 2, cy = box[1] + 22 + side / 2, sc = side / 2 / lim;
  [-0.5, 0, 0.5].forEach(function (g) { D.line(ctx, cx + g * sc, cy - side / 2, cx + g * sc, cy + side / 2, g ? CY.C.grid : CY.C.dim, 1); D.line(ctx, cx - side / 2, cy - g * sc, cx + side / 2, cy - g * sc, g ? CY.C.grid : CY.C.dim, 1); });
  D.mono(ctx, '+' + lim + ' m/s east', cx + side / 2 - 2, cy + side / 2 - 7, CY.C.mute, 8, 'right'); D.mono(ctx, '+' + lim + ' m/s north', cx - side / 2 + 3, cy - side / 2 + 7, CY.C.mute, 8);
  return { X: function (u) { return cx + u * sc; }, Y: function (v) { return cy - v * sc; }, sc: sc };
}
function paintPlane(ctx, box, S, p, R) {
  var D = CY.draw, m = R.m, K = p.K, v, i, c;
  planeBox(ctx, box, 'the nudge plane: the push the passive law cannot explain'); v = planeAxes(ctx, box, 1);
  for (i = 0; i < S.U.length; i += 3) D.dot(ctx, v.X(S.U[i][0]), v.Y(S.U[i][1]), 1.7, hue(m.lam.assign[i], K, 0.5));
  for (i = -1; i < 8; i++) { var q = L.SYM(i); ctx.save(); ctx.strokeStyle = CY.C.ink; ctx.lineWidth = 1; ctx.strokeRect(v.X(q[0]) - 13, v.Y(q[1]) - 13, 26, 26); ctx.restore(); }
  for (c = 0; c < K; c++) {
    var ce = m.lam.centers[c], nm = R.names[c], col = nm === null ? CY.C.dim : (nameRight(m.lam, c, nm) ? CY.C.green : CY.C.red);
    D.dot(ctx, v.X(ce[0]), v.Y(ce[1]), 9, CY.C.white, col); ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(v.X(ce[0]), v.Y(ce[1]), 9, 0, 2 * PI); ctx.stroke(); ctx.restore();
    D.text(ctx, nm === null ? '?' : (nm < 0 ? '0' : ARW[nm]), v.X(ce[0]), v.Y(ce[1]) + 1, col, 12, 'center', 700);
  }
  note(ctx, box, 'square: a real button. circle: a code; green = named right, red = named wrong, grey = no label', box[2] < 330 ? 7 : 8);
}
function paintCurves(ctx, box, S, p, R) {
  var D = CY.draw, x0 = box[0] + 34, y0 = box[1] + 24, w = box[2] - 46, h = box[3] - 58, NS = L.NS, m = R.m, j;
  planeBox(ctx, box, 'pairs read as the right button vs labelled examples');
  var X = function (n) { return x0 + n / 200 * w; }, Y = function (a) { return y0 + h * (1 - a); };
  [0, 0.5, 1].forEach(function (g) { D.line(ctx, x0, Y(g), x0 + w, Y(g), CY.C.grid, 1); D.mono(ctx, Math.round(g * 100) + ' %', x0 - 4, Y(g), CY.C.mute, 8, 'right'); });
  [0, 50, 100, 150, 200].forEach(function (n) { D.mono(ctx, '' + n, X(n), y0 + h + 10, CY.C.mute, 8, 'center'); });
  D.mono(ctx, 'labelled examples', x0 + w / 2, y0 + h + 24, CY.C.mute, 8, 'center');
  function curve(vals, col, wd) { D.path(ctx, NS.map(function (n, i) { return [X(n), Y(vals[i])]; }), col, wd); }
  curve(S.idm.map(function (e) { return e.acc; }), CY.C.cyan, 1.8); curve(m.curveR.map(function (e) { return e.acc; }), CY.C.purple, 2.2); curve(m.curveG.map(function (e) { return e.acc; }), CY.C.green, 2.2);
  D.line(ctx, X(p.labels), y0, X(p.labels), y0 + h, CY.C.amber, 1.4, [3, 3]);
  D.dot(ctx, X(p.labels), Y(R.idm.acc), 4, CY.C.cyan, CY.C.white); D.dot(ctx, X(p.labels), Y(R.sc.acc), 4.5, p.guided ? CY.C.green : CY.C.purple, CY.C.white);
  var lx = x0 + w - 150, ly = y0 + h - 44;
  [['codes, random labels', CY.C.purple], ['codes, one label per code', CY.C.green], ['inverse dynamics, random', CY.C.cyan]].forEach(function (e, i) { D.line(ctx, lx, ly + i * 13, lx + 16, ly + i * 13, e[1], 2.2); D.mono(ctx, e[0], lx + 21, ly + i * 13, CY.C.mute, 8); });
}
function paintSamples(ctx, box, S, p, R) {
  var D = CY.draw, v, i, m = R.m;
  planeBox(ctx, box, 'what ' + p.passes + (p.passes === 1 ? ' pass draws' : ' passes draw') + ' with no button given'); v = planeAxes(ctx, box, 1);
  for (i = 0; i < m.mix.mu.length; i++) { ctx.save(); ctx.strokeStyle = CY.C.dim; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(v.X(m.mix.mu[i][0]), v.Y(m.mix.mu[i][1]), 3 * m.mix.sd[i] * v.sc, 0, 2 * PI); ctx.stroke(); ctx.restore(); }
  R.ps.xs.slice(0, 600).forEach(function (x) { ctx.save(); ctx.strokeStyle = CY.C.amber; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(v.X(x[0]), v.Y(x[1]), 2.2, 0, 2 * PI); ctx.stroke(); ctx.restore(); });
  note(ctx, box, 'grey: the codes (3 sd). orange: draws. ' + R.ps.stat.covered + ' of ' + p.K + ' codes reached; distance to the press rates ' + R.ps.stat.tv.toFixed(2), box[2] < 330 ? 7 : 8);
}
function paintLatency(ctx, box, S, p, R) {
  var D = CY.draw, x0 = box[0] + 34, y0 = box[1] + 40, w = box[2] - 46, h = box[3] - 72, ns = [1, 2, 3, 4, 6, 8, 12, 16], j;
  if (ns.indexOf(p.passes) < 0) { ns.push(p.passes); ns.sort(function (a, b) { return a - b; }); }
  planeBox(ctx, box, 'ms per frame: passes x ' + p.ms + ' ms a pass');
  D.mono(ctx, 'dashed line: the ' + L.C.FPS + ' fps budget, ' + R.budget.toFixed(1) + ' ms', box[0] + 8, box[1] + 26, CY.C.amber, 8);
  var top = Math.max(2.4 * R.budget, 1.1 * ns[ns.length - 1] * p.ms), Y = function (t) { return y0 + h * (1 - Math.min(1, t / top)); }, bw = w / ns.length;
  [0, R.budget].forEach(function (g) { D.mono(ctx, g.toFixed(g ? 1 : 0), x0 - 4, Y(g), CY.C.mute, 8, 'right'); });
  ns.forEach(function (n, i) {
    var t = n * p.ms, ok = t <= R.budget + 1e-9, bx = x0 + i * bw + bw * 0.15;
    ctx.fillStyle = ok ? CY.C.greenSoft : CY.C.redSoft; ctx.fillRect(bx, Y(t), bw * 0.7, y0 + h - Y(t)); ctx.save(); ctx.strokeStyle = n === p.passes ? CY.C.amber : (ok ? CY.C.green : CY.C.red); ctx.lineWidth = n === p.passes ? 2.4 : 1; ctx.strokeRect(bx, Y(t), bw * 0.7, y0 + h - Y(t)); ctx.restore();
    D.mono(ctx, '' + n, bx + bw * 0.35, y0 + h + 10, CY.C.mute, 8, 'center'); D.mono(ctx, t.toFixed(0), bx + bw * 0.35, Y(t) - 7, CY.C.ink, 8, 'center');
  });
  D.line(ctx, x0, Y(R.budget), x0 + w, Y(R.budget), CY.C.amber, 1.5, [5, 3]);
  D.mono(ctx, 'passes per frame', x0 + w / 2, y0 + h + 24, CY.C.mute, 8, 'center');
}
function paintWalls(ctx, box, S, p, R) {
  var D = CY.draw, ex = R.ex, ah = Math.min(box[3] * 0.5, box[3] - 152), v = D.view(box[0] + 6, box[1] + 22, box[2] - 12, ah, 0, 8, 0, 5), i;
  planeBox(ctx, box, 'the model on clean clips, in a real session of 4 s');
  D.arena(ctx, v, L.W, { goal: false, curtain: false });
  if (ex.pick) {
    D.path(ctx, ex.pick.truth.map(function (q) { return [v.X(q[0]), v.Y(q[1])]; }), CY.C.ink, 2); D.path(ctx, ex.pick.model.map(function (q) { return [v.X(q[0]), v.Y(q[1])]; }), CY.C.purple, 2, [4, 3]);
    var hit = ex.pick.truth[ex.pick.tc + 1]; D.dot(ctx, v.X(hit[0]), v.Y(hit[1]), 5, CY.C.red, CY.C.white);
  }
  var bx = box[0] + 8, bw = box[2] - 16 - 44, by = box[1] + 22 + ah + 8;
  var rows = [['trained on clean clips: free steps', ex.sC.free, CY.C.green], ['trained on clean clips: wall steps', ex.sC.contact, CY.C.red], ['trained with the bounces: other steps', ex.sW.free, CY.C.cyan], ['trained with the bounces: wall steps', ex.sW.contact, CY.C.red]];
  var X = function (e) { return bx + bw * Math.log(e / 0.01) / Math.log(300); };
  rows.forEach(function (r, i) { var yy = by + i * 22; D.mono(ctx, r[0], bx, yy + 5, CY.C.mute, 8); ctx.fillStyle = r[2]; ctx.fillRect(bx, yy + 10, Math.max(2, X(r[1]) - bx), 9); D.mono(ctx, r[1].toFixed(3), X(r[1]) + 4, yy + 14, CY.C.ink, 9); });
  note(ctx, box, 'velocity error, m/s, log scale. black: the world; dashed: the model; red dot: the first wall hit', 7);
}
L.paint = function (cv, S, p, R) {
  var D = CY.draw, narrow = cv.clientWidth < 620;
  cv.style.height = (narrow ? 1120 : 640) + 'px';
  var g = D.setup(cv), ctx = g.ctx, w = g.w, h = g.h, wA = Math.round(w * 0.47), A, B, C, E;
  if (narrow) { A = [8, 8, w - 16, 300]; B = [8, 316, w - 16, 215]; C = [8, 539, w - 16, 290]; E = [8, 837, w - 16, h - 845]; }
  else { A = [8, 8, wA, 318]; B = [wA + 16, 8, w - wA - 24, 318]; C = [8, 336, wA, h - 344]; E = [wA + 16, 336, w - wA - 24, h - 344]; }
  paintPlane(ctx, A, S, p, R); paintCurves(ctx, B, S, p, R); paintSamples(ctx, C, S, p, R);
  if (p.view === 'walls') paintWalls(ctx, E, S, p, R); else paintLatency(ctx, E, S, p, R);
};

root.L14 = L;
if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
