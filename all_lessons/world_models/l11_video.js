/* l11_video.js — private engine of World Models lesson 11, "Pixels: the world model becomes a video model".  Global L11 (needs courtyard.js first).
 *
 * THE WORLD.  The plain Courtyard with a long curtain: x in [2.2, 3.8] m (1.6 m, 5 of the picture's 24 columns).  A launcher fires the ball from x = 0.5 m at 2.6 m/s,
 *   y in [1,4], angle U[-0.3,0.3] rad (CY.launch).  An operator may nudge once, while the ball is behind the curtain: at step ka (U{9..13}) the y velocity gets +/- 2.5 m/s (kind 1 = up, 2 = down, 0 = no nudge).
 *   A CLIP is T = 32 steps: states s_0..s_T (pictures 0..T) and actions a_0..a_{T-1} in {0,1,2}, a_t applied at the start of step t, so picture t+1 shows its effect.
 *   With the nudge-free launch the ball goes behind the curtain at picture tin = 8 and comes out at picture tout = 17 or 18 (hidden for 9 or 10 pictures).
 * THE PICTURE is lesson 3's: CY.img.render, 24 x 15 pixels (3 px/m), the ball a Gaussian blob of sigma 1.5 px and peak 0.8; optional glare band (width 0.4 m, peak 0.8 nu).
 * THE TOKENIZER.  Patches of 3 x 3 pixels (1 m x 1 m): 8 x 5 = 40 tokens per picture.  A codebook of C codes = weighted k-means (k-means++ seeding, 25 Lloyd steps) on the DISTINCT
 *   patches of 400 training pictures, weights = how often each occurs.  bits per picture = 40 log2 C.  decode = paste the code's patch.
 *   The ball is an additive blob, so a picture's tokens are the background tokens except in the patches the blob touches (within 5 sigma); encodeState uses that and is tested
 *   against the full path (encode of the full render).
 * THE VIDEO MODEL.  A memory-based estimate of p(next picture | last W pictures, actions): among the recorded windows (MCLIP clips) whose pattern "the ball is drawn in these pictures"
 *   equals the query's, the K closest (distance = sum over the W pictures of the squared distance between the two pictures' decoded patches, plus 1000 per picture whose action
 *   differs when the model is told the action), ties included (at most CAP of the tied ones, evenly spaced, stand for all); the next picture of each is one draw.
 *   Output rules: pixel mean, greedy token, independent token, token by token (chain rule).  A transformer LEARNS this conditional; the Courtyard is small enough to look it up.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require === 'function' ? require('./courtyard.js') : null);
var L = {};

var PW = 24, PH = 15, P = 3, GX = 8, GY = 5, NP = 40, SIG = 1.5, PEAK = 0.8, T = 32, PPM = 3, NUDGE = 2.5, NTRAIN = 400, MCLIP = 600, CAP = 40, KNN = 3, SPEED = 2.6, TOL = 0.5;
var WORLD = CY.world({ curtain: [2.2, 3.8] });
L.C = { PW: PW, PH: PH, P: P, GX: GX, GY: GY, NP: NP, SIG: SIG, PEAK: PEAK, T: T, NUDGE: NUDGE, KNN: KNN, NTRAIN: NTRAIN, MCLIP: MCLIP, CAP: CAP, SPEED: SPEED, TOL: TOL, CS: [1, 2, 4, 8, 16, 32, 64, 128], WS: [1, 2, 4, 6, 8, 10, 12, 14, 16, 20] };
L.world = WORLD;

/* ───────── pictures ───────── */
L.render = function (s, o) {
  o = o || {};
  var op = { sigma: SIG, ball: o.noBall ? 0 : PEAK };
  if (o.glare) op.band = { cx: o.glare.cx, width: 0.4, amp: 0.8 * o.glare.nu };
  return CY.img.render(WORLD, s, op);
};
var BG = L.render([0.2, 2.5, 0, 0], { noBall: true });                 // the picture with no ball (the curtain does not move)
L.bg = BG;
var BGD = new Float64Array(PW * PH);                                  // the same numbers in double precision, before the float32 store (floor, goal disc, curtain)
(function () {
  for (var j = 0; j < PH; j++) for (var i = 0; i < PW; i++) {
    var X = (i + 0.5) / PPM, Y = WORLD.H - (j + 0.5) / PPM, v = 0.18;
    if (Math.hypot(X - WORLD.goal.x, Y - WORLD.goal.y) < WORLD.goal.r) v += 0.12;
    if (X > WORLD.curtain[0] && X < WORLD.curtain[1]) v *= 1 - 0.45;
    BGD[j * PW + i] = v;
  }
})();
function patchOf(img, p, out) {                                        // the 9 numbers of patch p (row-major inside the patch)
  var gx = p % GX, gy = (p / GX) | 0, k = 0, i, j;
  for (j = 0; j < P; j++) for (i = 0; i < P; i++) out[k++] = img[(gy * P + j) * PW + gx * P + i];
  return out;
}
L.patchOf = patchOf;

/* ───────── codebooks ───────── */
function wkmeans(X, wt, K, seed) {                                      // weighted k-means: X array of Float64Array(9), wt multiplicities
  var rng = CY.rng(seed), n = X.length, d = 9, i, j, k, tot = 0;
  var d2 = function (a, b) { var s = 0, t; for (var u = 0; u < d; u++) { t = a[u] - b[u]; s += t * t; } return s; };
  for (i = 0; i < n; i++) tot += wt[i];
  var r = rng() * tot, acc = 0, first = 0;
  for (i = 0; i < n; i++) { acc += wt[i]; if (acc >= r) { first = i; break; } }
  var centers = [Float64Array.from(X[first])], dist = new Float64Array(n).fill(Infinity);
  while (centers.length < Math.min(K, n)) {
    var last = centers[centers.length - 1], tt = 0;
    for (i = 0; i < n; i++) { var dd = d2(X[i], last); if (dd < dist[i]) dist[i] = dd; tt += dist[i] * wt[i]; }
    if (tt === 0) break;
    var rr = rng() * tt, a2 = 0, pick = n - 1;
    for (i = 0; i < n; i++) { a2 += dist[i] * wt[i]; if (a2 >= rr) { pick = i; break; } }
    centers.push(Float64Array.from(X[pick]));
  }
  var Kc = centers.length, assign = new Int32Array(n);
  for (var it = 0; it < 25; it++) {
    for (i = 0; i < n; i++) {                                         // nearest centre; a partial sum that already reaches the best distance cannot win, so the loop stops early (same answer)
      var b = 0, bd = Infinity, x = X[i];
      for (k = 0; k < Kc; k++) { var c = centers[k], e = 0, u, t; for (u = 0; u < d; u++) { t = x[u] - c[u]; e += t * t; if (e >= bd) break; } if (u === d) { bd = e; b = k; } }
      assign[i] = b;
    }
    var sum = [], cnt = new Float64Array(Kc);
    for (k = 0; k < Kc; k++) sum.push(new Float64Array(d));
    for (i = 0; i < n; i++) { cnt[assign[i]] += wt[i]; for (j = 0; j < d; j++) sum[assign[i]][j] += wt[i] * X[i][j]; }
    for (k = 0; k < Kc; k++) if (cnt[k] > 0) for (j = 0; j < d; j++) centers[k][j] = sum[k][j] / cnt[k];
  }
  return centers;
}
L.wkmeans = wkmeans;
var TRAIN = {};
function trainSet(glare) {                                              // the distinct patches of the training pictures and how often each occurs
  var key = glare ? 'g' + glare : 'c';
  if (TRAIN[key]) return TRAIN[key];
  var rng = CY.rng(11), map = {}, X = [], wt = [], t, p, buf = new Float64Array(9), n, u, k;
  for (n = 0; n < NTRAIN; n++) {
    var s = CY.launch(WORLD, rng, { speed: [SPEED, SPEED] }), tt = Math.floor(rng() * 30), cx = 0.5 + 7 * rng();
    for (t = 0; t < tt; t++) s = CY.step(WORLD, s, null);
    var img = L.render(s, glare ? { glare: { cx: cx, nu: glare } } : null);
    for (p = 0; p < NP; p++) {
      patchOf(img, p, buf); k = '';
      for (u = 0; u < 9; u++) k += Math.round(buf[u] * 2000) + ',';
      if (map[k] === undefined) { map[k] = X.length; X.push(Float64Array.from(buf)); wt.push(1); } else wt[map[k]]++;
    }
  }
  TRAIN[key] = { X: X, wt: wt };
  return TRAIN[key];
}
L.trainSet = trainSet;
function nearestCode(cen, v) {
  var b = 0, bd = Infinity, k, u, s, t, K = cen.length;
  for (k = 0; k < K; k++) { s = 0; var c = cen[k]; for (u = 0; u < 9; u++) { t = v[u] - c[u]; s += t * t; if (s >= bd) break; } if (u === 9) { bd = s; b = k; } }
  return b;
}
L.nearestCode = nearestCode;
var CB = {};
L.codebook = function (C, glare) {
  var key = C + (glare ? 'g' + glare : '');
  if (CB[key]) return CB[key];
  var ts = trainSet(glare), cen = wkmeans(ts.X, ts.wt, C, 3), K = cen.length, D = new Float64Array(K * K), a, b, u, s, t;
  for (a = 0; a < K; a++) for (b = 0; b < K; b++) { s = 0; for (u = 0; u < 9; u++) { t = cen[a][u] - cen[b][u]; s += t * t; } D[a * K + b] = s; }
  var bgTok = new Uint8Array(NP), buf = new Float64Array(9);
  for (a = 0; a < NP; a++) bgTok[a] = nearestCode(cen, patchOf(BG, a, buf));
  CB[key] = { C: C, K: K, cen: cen, D: D, bgTok: bgTok, glare: glare || 0, bits: NP * Math.log2(C) };
  return CB[key];
};
L.encode = function (cb, img) {                                         // reference path: the nearest code for every patch of a full picture
  var tok = new Uint8Array(NP), buf = new Float64Array(9), p;
  for (p = 0; p < NP; p++) tok[p] = nearestCode(cb.cen, patchOf(img, p, buf));
  return tok;
};
L.decode = function (cb, tok) {
  var img = new Float32Array(PW * PH), g, i, j, k;
  for (g = 0; g < NP; g++) { var gx = g % GX, gy = (g / GX) | 0, c = cb.cen[tok[g]]; k = 0; for (j = 0; j < P; j++) for (i = 0; i < P; i++) img[(gy * P + j) * PW + gx * P + i] = c[k++]; }
  return img;
};
L.psnr = function (a, b) { var s = 0, i; for (i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return 10 * Math.log10(1 / Math.max(1e-12, s / a.length)); };

/* fast path: only the patches the ball touches (within 5 sigma) can differ from the background tokens */
var RB = 5 * SIG;
L.encodeState = function (cb, s) {
  var tok = Uint8Array.from(cb.bgTok);
  if (CY.occluded(WORLD, s)) return tok;
  var bx = s[0] * PPM, by = (WORLD.H - s[1]) * PPM, gx0 = Math.max(0, Math.floor((bx - RB) / P)), gx1 = Math.min(GX - 1, Math.floor((bx + RB) / P)), gy0 = Math.max(0, Math.floor((by - RB) / P)), gy1 = Math.min(GY - 1, Math.floor((by + RB) / P));
  var buf = new Float64Array(9), gx, gy, i, j, k, inv = 1 / (2 * SIG * SIG);
  for (gy = gy0; gy <= gy1; gy++) for (gx = gx0; gx <= gx1; gx++) {
    k = 0;
    for (j = 0; j < P; j++) for (i = 0; i < P; i++) {
      var px = gx * P + i, py = gy * P + j, dx = px + 0.5 - bx, dy = py + 0.5 - by;
      buf[k++] = Math.fround(BGD[py * PW + px] + PEAK * Math.exp(-(dx * dx + dy * dy) * inv));
    }
    tok[gy * GX + gx] = nearestCode(cb.cen, buf);
  }
  return tok;
};
L.hasBall = function (cb, tok) { for (var p = 0; p < NP; p++) if (tok[p] !== cb.bgTok[p]) return true; return false; };
/* what the tokens say about the ball: the decoded picture minus the decoded background (the same background tokens, or the tokens of the picture without the ball);
 * {x, y, e, n}: centroid of the positive part in metres, its energy, the number of tokens that differ; null when nothing differs */
L.readBall = function (cb, tok, ref) {
  ref = ref || cb.bgTok;
  var img = L.decode(cb, tok), im0 = ref === cb.bgTok ? (cb.bgImg || (cb.bgImg = L.decode(cb, cb.bgTok))) : L.decode(cb, ref), sw = 0, sx = 0, sy = 0, i, j, v, n = 0, p;
  for (p = 0; p < NP; p++) if (tok[p] !== ref[p]) n++;
  if (n === 0) return null;
  for (j = 0; j < PH; j++) for (i = 0; i < PW; i++) { v = img[j * PW + i] - im0[j * PW + i]; if (v > 0) { sw += v; sx += v * (i + 0.5); sy += v * (j + 0.5); } }
  if (sw < 1e-9) return null;
  return { x: sx / sw / PPM, y: WORLD.H - sy / sw / PPM, e: sw, n: n };
};
/* how many separate blobs a picture shows above the background: components (8-neighbour, at least 2 pixels) of the pixels brighter than the decoded background by thr; {n, peak} */
L.blobs = function (cb, img, thr) {
  thr = thr || 0.1;
  var ref = cb.bgImg || (cb.bgImg = L.decode(cb, cb.bgTok)), seen = new Uint8Array(PW * PH), n = 0, peak = 0, i, j, st, q, di, dj, size, pk;
  for (j = 0; j < PH; j++) for (i = 0; i < PW; i++) {
    if (seen[j * PW + i] || img[j * PW + i] - ref[j * PW + i] <= thr) continue;
    st = [[i, j]]; seen[j * PW + i] = 1; size = 0; pk = 0;
    while (st.length) {
      q = st.pop(); size++; pk = Math.max(pk, img[q[1] * PW + q[0]] - ref[q[1] * PW + q[0]]);
      for (dj = -1; dj <= 1; dj++) for (di = -1; di <= 1; di++) {
        var a = q[0] + di, b = q[1] + dj;
        if (a < 0 || b < 0 || a >= PW || b >= PH || seen[b * PW + a] || img[b * PW + a] - ref[b * PW + a] <= thr) continue;
        seen[b * PW + a] = 1; st.push([a, b]);
      }
    }
    if (size >= 2) { n++; peak = Math.max(peak, pk); }
  }
  return { n: n, peak: peak };
};

/* ───────── clips ───────── */
function launchOf(seed) {                                              // the launch, the nudge step and the nudge kind of recorded clip `seed` (draw order fixed)
  var rng = CY.rng(seed), s0 = CY.launch(WORLD, rng, { speed: [SPEED, SPEED] }), ka = 9 + Math.floor(rng() * 5), kind = Math.floor(rng() * 3);
  return { s0: s0, ka: ka, kind: kind };
}
L.launchOf = launchOf;
L.simulate = function (s0, kind, ka) {                                  // the clip of this launch with the nudge (kind, ka); kind 0 = none
  var s = s0, st = [s0], ac = [], hid = [], t, first = -1, last = -1;
  for (t = 0; t < T; t++) {
    var a = (t === ka && kind > 0) ? kind : 0;
    ac.push(a);
    s = CY.step(WORLD, s, a === 1 ? [0, NUDGE] : a === 2 ? [0, -NUDGE] : null);
    st.push(s);
  }
  for (t = 0; t <= T; t++) { var h = CY.occluded(WORLD, st[t]); hid.push(h); if (h) { if (first < 0) first = t; last = t; } }
  return { s: st, a: ac, ka: ka, kind: kind, hidden: hid, tin: first, tout: last + 1 };
};
var CLIPS = {};
L.clip = function (seed) { if (!CLIPS[seed]) { var l = launchOf(seed); CLIPS[seed] = L.simulate(l.s0, l.kind, l.ka); } return CLIPS[seed]; };
L.examClip = function (i) { var k = 'e' + i; if (!CLIPS[k]) CLIPS[k] = L.simulate(launchOf(6000 + i).s0, 0, 0); return CLIPS[k]; };       // nudge-free launch number i
L.demoClip = function (i) {                                                                                                    // nudged while the ball is hidden: kinds up, down, none in turn
  var k = 'd' + i;
  if (!CLIPS[k]) { var l = launchOf(5000 + i), base = L.simulate(l.s0, 0, 0), kind = [1, 2, 0][i % 3]; CLIPS[k] = L.simulate(l.s0, kind, base.tin + 2); }
  return CLIPS[k];
};
L.testState = function (i) { var rng = CY.rng(7000 + i), s = CY.launch(WORLD, rng, { speed: [SPEED, SPEED] }), t, tt = Math.floor(rng() * 30); for (t = 0; t < tt; t++) s = CY.step(WORLD, s, null); return s; };

/* ───────── rate and distortion: PSNR, the ball's token floor, how many tokens carry the ball (200 test pictures: all of them for PSNR, the visible ones for the rest) ───────── */
L.NTEST = 200;
var TEST = null;
function testSet() { if (!TEST) { TEST = []; for (var i = 0; i < L.NTEST; i++) { var s = L.testState(i); TEST.push({ s: s, img: L.render(s), hid: CY.occluded(WORLD, s) }); } } return TEST; }
var RATE = {};
L.rate = function (C) {
  if (RATE[C]) return RATE[C];
  var cb = L.codebook(C), ts = testSet(), ps = 0, errs = [], nt = 0, nv = 0, lost = 0, i;
  for (i = 0; i < ts.length; i++) {
    var s = ts[i].s, tok = L.encodeState(cb, s);
    ps += L.psnr(L.decode(cb, tok), ts[i].img) / ts.length;
    if (ts[i].hid) continue;
    nv++; var rb = L.readBall(cb, tok);
    if (!rb) { lost++; errs.push(3); continue; }
    nt += rb.n; errs.push(Math.min(3, Math.hypot(rb.x - s[0], rb.y - s[1])));
  }
  errs.sort(function (a, b) { return a - b; });
  RATE[C] = { C: C, bits: cb.bits, psnr: ps, floor: errs[errs.length >> 1], tokens: nt / nv, lost: lost / nv };
  return RATE[C];
};

/* ───────── the corpus, tokenised with one codebook (sparse: only tokens that differ from the background are stored) ───────── */
L.corpus = function (cb, M, seed0) {
  M = M || MCLIP; seed0 = seed0 || 1000;
  var key = 'corp' + cb.C + '_' + (cb.glare || 0) + '_' + M + '_' + seed0;
  if (CB[key]) return CB[key];
  var nF = M * (T + 1), start = new Int32Array(nF + 1), fp = [], ft = [], E = new Float64Array(nF), act = new Uint8Array(M * T), m, t, p, g = 0;
  for (m = 0; m < M; m++) {
    var c = L.clip(seed0 + m);
    for (t = 0; t < T; t++) act[m * T + t] = c.a[t];
    for (t = 0; t <= T; t++) {
      var tok = L.encodeState(cb, c.s[t]), e = 0;
      start[g] = fp.length;
      for (p = 0; p < NP; p++) if (tok[p] !== cb.bgTok[p]) { fp.push(p); ft.push(tok[p]); e += cb.D[tok[p] * cb.K + cb.bgTok[p]]; }
      E[g] = e; g++;
    }
  }
  start[nF] = fp.length;
  CB[key] = { M: M, start: start, fp: Uint8Array.from(fp), ft: Uint8Array.from(ft), E: E, act: act, cb: cb };
  return CB[key];
};
L.frameOf = function (cb, co, m, t) {                                    // dense token grid of picture t of recorded clip m
  var g = m * (T + 1) + t, tok = Uint8Array.from(cb.bgTok), q;
  for (q = co.start[g]; q < co.start[g + 1]; q++) tok[co.fp[q]] = co.ft[q];
  return tok;
};

/* ───────── the model: p(next picture | last W pictures, actions) by looking up the closest recorded windows ───────── */
var EMPTY = { p: [], t: [], e: 0 };
L.EMPTY = EMPTY;
function sparseOfTok(cb, tok) {                                          // foreground list of a dense grid: the patches whose token is not the background's
  var P_ = [], T_ = [], e = 0, p;
  for (p = 0; p < NP; p++) if (tok[p] !== cb.bgTok[p]) { P_.push(p); T_.push(tok[p]); e += cb.D[tok[p] * cb.K + cb.bgTok[p]]; }
  return { p: P_, t: T_, e: e };
}
L.sparseOfTok = sparseOfTok;
function frameDist(cb, qa, co, g) {                                      // squared codebook distance between a query picture (sparse) and recorded picture g
  var K = cb.K, D = cb.D, bt = cb.bgTok, s = co.start[g], e = co.start[g + 1];
  if (qa.p.length === 0) return co.E[g];
  if (e === s) return qa.e;
  var i = 0, j = s, d = 0, np = qa.p.length;
  while (i < np || j < e) {
    var pi = i < np ? qa.p[i] : 99, pj = j < e ? co.fp[j] : 99;
    if (pi === pj) { d += D[qa.t[i] * K + co.ft[j]]; i++; j++; }
    else if (pi < pj) { d += D[qa.t[i] * K + bt[pi]]; i++; }
    else { d += D[co.ft[j] * K + bt[pj]]; j++; }
  }
  return d;
}
/* THE INDEX.  Bit i of a window's pattern is 1 when the picture i steps before the last shows any token other than the background (pictures before the clip started count as empty).
 * Only recorded windows with the query's pattern are compared; if none has it, all windows are. */
function patternOf(sp, W) { var key = 0, n = sp.length, i; for (i = 0; i < W; i++) { var q = n - 1 - i; if (q >= 0 && sp[q].p.length > 0) key |= (1 << i); } return key; }
L.patternOf = patternOf;
function indexOf(co, W) {
  co.idx = co.idx || {};
  if (co.idx[W]) return co.idx[W];
  var map = {}, m, t, i, key, all = new Int32Array(co.M * T), n = 0;
  for (m = 0; m < co.M; m++) for (t = 0; t < T; t++) {
    key = 0;
    for (i = 0; i < W; i++) { var tc = t - i; if (tc >= 0 && co.start[m * (T + 1) + tc + 1] > co.start[m * (T + 1) + tc]) key |= (1 << i); }
    (map[key] = map[key] || []).push(m * T + t); all[n++] = m * T + t;
  }
  var out = { all: all };
  for (key in map) out[key] = Int32Array.from(map[key]);
  co.idx[W] = out;
  return out;
}
/* ctx: {frames: [sparse...] oldest first, acts: [0|1|2 ...] same length, last = most recent}; returns the nearest windows, ties included: {m: [], t: [], d: []}, t = index of the window's last picture */
L.nearest = function (cb, co, ctx, W, K, useAct) {
  var n = ctx.frames.length, ix = indexOf(co, W), key = patternOf(ctx.frames, W), ids = ix[key] || ix.all, N = ids.length, dist = new Float64Array(N), i, j;
  var qfr = [], qac = new Uint8Array(W), blank = key === 0 && ix[key] !== undefined;   // blank: no picture of the window shows the ball, so only the actions can differ
  for (i = 0; i < W; i++) { var qi = n - 1 - i; qfr.push(qi >= 0 ? ctx.frames[qi] : EMPTY); qac[i] = qi >= 0 ? ctx.acts[qi] : 0; }
  for (j = 0; j < N; j++) {
    var id = ids[j], m = (id / T) | 0, t = id % T, d = 0;
    for (i = 0; i < W; i++) {
      var tc = t - i;
      if (!blank) d += tc >= 0 ? frameDist(cb, qfr[i], co, m * (T + 1) + tc) : qfr[i].e;
      if (useAct && (tc >= 0 ? co.act[m * T + tc] : 0) !== qac[i]) d += 1e3;
    }
    dist[j] = d;
  }
  var best = [], b;                                                      // the K smallest distances, kept sorted
  for (j = 0; j < N; j++) {
    var dj = dist[j];
    if (best.length < K || dj < best[best.length - 1]) { b = best.length; while (b > 0 && best[b - 1] > dj) b--; best.splice(b, 0, dj); if (best.length > K) best.pop(); }
  }
  var thr = best[best.length - 1], out = { m: [], t: [], d: [] }, nt = 0, step, take = 0, seen = 0;
  for (j = 0; j < N; j++) if (dist[j] <= thr) nt++;
  step = Math.max(1, nt / CAP);                                          // more than CAP windows tied at the threshold: CAP of them, evenly spaced, stand for all
  for (j = 0; j < N; j++) if (dist[j] <= thr) { if (seen >= take) { out.m.push((ids[j] / T) | 0); out.t.push(ids[j] % T); out.d.push(dist[j]); take += step; } seen++; }
  return out;
};

/* ───────── the four ways to draw the next picture from the candidates ───────── */
L.nextTokens = function (cb, co, cand, i) { return L.frameOf(cb, co, cand.m[i], cand.t[i] + 1); };
L.rule = function (cb, co, cand, rule, rng) {                            // returns {tok} (a token grid) or {img} (the pixel mean)
  var n = cand.m.length, grids = [], i, p, q;
  for (i = 0; i < n; i++) grids.push(L.nextTokens(cb, co, cand, i));
  if (rule === 'mean') {
    var img = new Float32Array(PW * PH), tmp;
    for (i = 0; i < n; i++) { tmp = L.decode(cb, grids[i]); for (q = 0; q < img.length; q++) img[q] += tmp[q] / n; }
    return { img: img };
  }
  var out = new Uint8Array(NP);
  if (rule === 'greedy' || rule === 'alone') {
    for (p = 0; p < NP; p++) {
      var cnt = {}, tk;
      for (i = 0; i < n; i++) { tk = grids[i][p]; cnt[tk] = (cnt[tk] || 0) + 1; }
      if (rule === 'greedy') { var best = -1, bt = cb.bgTok[p]; for (tk in cnt) { if (cnt[tk] > best || (cnt[tk] === best && +tk === cb.bgTok[p])) { best = cnt[tk]; bt = +tk; } } out[p] = bt; }
      else out[p] = grids[Math.min(n - 1, Math.floor(rng() * n))][p];
    }
    return { tok: out };
  }
  var live = []; for (i = 0; i < n; i++) live.push(i);                   // 'chain': token by token, each drawn from the candidates consistent with the tokens drawn so far
  for (p = 0; p < NP; p++) {
    var pick = live[Math.min(live.length - 1, Math.floor(rng() * live.length))], tok = grids[pick][p], keep = [];
    for (q = 0; q < live.length; q++) if (grids[live[q]][p] === tok) keep.push(live[q]);
    out[p] = tok; live = keep;
  }
  return { tok: out };
};

/* ───────── contexts and rollouts ───────── */
L.context = function (cb, c, t, W) {                                     // the last W pictures of clip c up to picture t, and their actions
  var frames = [], acts = [], i;
  for (i = t - W + 1; i <= t; i++) {
    if (i < 0) { frames.push(EMPTY); acts.push(0); }
    else { frames.push(sparseOfTok(cb, L.encodeState(cb, c.s[i]))); acts.push(c.a[i]); }
  }
  return { frames: frames, acts: acts };
};
/* free-running generation: from the true pictures up to t0, draw pictures t0+1 .. t0+steps, each from the window that ends at the previous draw.  o: {K, told, rule, rng}; the actions are inputs. */
L.generate = function (cb, co, c, t0, W, steps, o) {
  var K = o.K || KNN, ctx = L.context(cb, c, t0, W), frames = ctx.frames, acts = ctx.acts, out = [], k;
  for (k = 0; k < steps; k++) {
    var t = t0 + k, cand = L.nearest(cb, co, { frames: frames, acts: acts }, W, K, o.told), r = L.rule(cb, co, cand, o.rule || 'chain', o.rng);
    out.push(r);
    var tok = r.tok || L.encode(cb, r.img);
    frames.push(sparseOfTok(cb, tok)); acts.push(t + 1 < T ? c.a[t + 1] : 0);
    if (frames.length > W) { frames.shift(); acts.shift(); }
  }
  return out;
};

/* ───────── what the model draws at the picture where the ball comes out ───────── */
L.kindOf = function (b) { return b.n === 0 ? 'none' : b.n === 1 ? (b.peak >= 0.4 ? 'ball' : 'smear') : 'pieces'; };
L.answers = function (cb, co, c, W, told, seed) {                         // the same candidates drawn four ways, for clip c at the picture tout (true pictures up to tout - 1 are the context)
  var rng = CY.rng(seed), ctx = L.context(cb, c, c.tout - 1, W), cand = L.nearest(cb, co, ctx, W, KNN, told), rules = ['mean', 'greedy', 'alone', 'chain'], out = { cand: cand, truth: L.render(c.s[c.tout]) }, i;
  for (i = 0; i < 4; i++) {
    var o = L.rule(cb, co, cand, rules[i], rng), img = o.img || L.decode(cb, o.tok), b = L.blobs(cb, img, 0.1);
    out[rules[i]] = { img: img, tok: o.tok || null, n: b.n, peak: b.peak, kind: L.kindOf(b), ball: o.tok ? L.readBall(cb, o.tok) : null };
  }
  return out;
};
L.whatIf = function (cb, co, s0, W, told, seed) {                         // the operator nudges up, down or not at all while the ball is hidden: what is drawn where the ball comes out (two draws each)
  var base = L.simulate(s0, 0, 0), rng = CY.rng(seed), out = [], a, k;
  for (a = 0; a < 3; a++) {
    var c = L.simulate(s0, a, base.tin + 2), ctx = L.context(cb, c, c.tout - 1, W), cand = L.nearest(cb, co, ctx, W, KNN, told), draws = [];
    for (k = 0; k < 2; k++) { var o = L.rule(cb, co, cand, 'chain', rng); draws.push({ tok: o.tok, ball: L.readBall(cb, o.tok) }); }
    out.push({ a: a, clip: c, truth: c.s[c.tout], draws: draws });
  }
  return out;
};
L.control = function (wi) {                                               // heights of the drawn balls: between actions, within one action, and the true ball's, plus how far the draws are from the truth
  var bt = 0, nb = 0, wn = 0, nw = 0, tt = 0, er = 0, ne = 0, miss = 0, i, j;
  for (i = 0; i < 3; i++) {
    wi[i].draws.forEach(function (d) { if (!d.ball) miss++; else { er += Math.abs(d.ball.y - wi[i].truth[1]); ne++; } });
    if (wi[i].draws[0].ball && wi[i].draws[1].ball) { wn += Math.abs(wi[i].draws[0].ball.y - wi[i].draws[1].ball.y); nw++; }
    for (j = i + 1; j < 3; j++) { tt += Math.abs(wi[i].truth[1] - wi[j].truth[1]) / 3; if (wi[i].draws[0].ball && wi[j].draws[0].ball) { bt += Math.abs(wi[i].draws[0].ball.y - wi[j].draws[0].ball.y); nb++; } }
  }
  return { between: nb ? bt / nb : NaN, within: nw ? wn / nw : NaN, trueBetween: tt, err: ne ? er / ne : NaN, missing: miss, nb: nb, nw: nw };
};

/* ───────── the re-appearance exam: from the last picture before the ball goes behind the curtain, run the model free, and look at the picture where the ball comes out ───────── */
L.reappear = function (cb, co, c, W, rng, o) {
  o = o || {};
  var t0 = c.tin - 1, gen = L.generate(cb, co, c, t0, W, c.tout - t0, { K: o.K || KNN, told: true, rule: 'chain', rng: rng }), tok = gen[gen.length - 1].tok, rb = L.readBall(cb, tok), st = c.s[c.tout];
  var err = rb ? Math.hypot(rb.x - st[0], rb.y - st[1]) : null;
  return { ok: err !== null && err < TOL, err: err, drawn: !!rb, tok: tok, gen: gen };
};
L.forgetting = function (cb, co, W, n) {                                  // over n nudge-free launches: the share where the ball is drawn within TOL of where it is, and the share where any ball is drawn, at the picture where it comes out; byH: the same split by how many pictures the curtain hid the ball
  var rng = CY.rng(21), ok = 0, dr = 0, i, byH = {};
  for (i = 0; i < n; i++) {
    var c = L.examClip(i), r = L.reappear(cb, co, c, W, rng), h = c.tout - c.tin, b = byH[h] || (byH[h] = { n: 0, ok: 0 });
    b.n++; if (r.ok) { ok++; b.ok++; } if (r.drawn) dr++;
  }
  return { p: ok / n, drawn: dr / n, n: n, byH: byH };
};

root.L11 = L;
if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
