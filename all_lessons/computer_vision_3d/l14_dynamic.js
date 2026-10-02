/* l14_dynamic.js — lesson 14, "When the scene moves".  A private engine on top of flatland.js: the dynamic-scene lab of the widget.
 *
 *   The yard         a crate and a tower that stand still (the static scene), a ball that rolls to the right through (-0.5, 4.4) m at the middle frame and hits the
 *                    crate, and a camera that slides to the right for T = 24 frames (0.04 m a frame) and then stands still.  Frames come every 0.1 s.
 *                    A rig of up to three cameras rides on the slide: A (the phone), B (0.5 m to its right, the second eye of a stereo pair), C (0.5 m to its left,
 *                    never trained on: the exam camera).  f = 44 px, 64 pixels, as lesson 1.
 *   L14.video(v)     every photograph the experiments need for a ball speed v (metres per frame): A for 48 frames (the 24 fitted ones and the 24 of the future),
 *                    B and C for the first 24, and A at the half frames 0.5 … 22.5 (the held-out times inside the window).
 *   L14.Lab(opts)    one experiment: canonical Gaussians (lesson 10's splats), ONE constant velocity for the group of Gaussians that moves, and, optionally, a
 *                    correction to the camera pose of every frame.  fit() = the explain-compare-update loop over the frames; score() = the exam in space and time.
 *   L14.draw(cv, lab, o)   the widget's picture.
 * Conventions as flatland.js: x right, z up, metres; deterministic (seeded generators only).
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require === 'function' ? require('./flatland.js') : null);
var G = FL.gs.P, sigmoid = FL.vol.sigmoid;
var L14 = {};
L14.F = 44; L14.W = 64; L14.T = 24; L14.NF = 48; L14.TREF = 11.5; L14.CV = 0.04; L14.CX0 = -0.5; L14.BASE = 0.5;
L14.R = 0.45; L14.ZB = 4.4; L14.XREF = -0.5; L14.XCRATE = 3.0; L14.REST = 0.8; L14.DT = 0.1;
var T = L14.T, NF = L14.NF, W = L14.W, TREF = L14.TREF, R0 = L14.R, ZB = L14.ZB, BG = [0.93, 0.94, 0.96];
var logit = function (p) { p = Math.min(0.995, Math.max(0.005, p)); return Math.log(p / (1 - p)); };

/* ── the world ── */
L14.camAt = function (t, dx) {                       // the slide: 0.04 m a frame for frames 0 … T-1, then the camera holds still
  return FL.camera({ x: L14.CX0 + L14.CV * Math.min(t, T - 1) + (dx || 0), z: 0, a: Math.PI / 2, f: L14.F, W: W });
};
L14.xHit = function () { return L14.XCRATE - 0.5 - R0; };       // where the ball's centre is when it touches the crate
L14.tHit = function (v) { return v > 0 ? TREF + (L14.xHit() - L14.XREF) / v : Infinity; };
L14.ballAt = function (t, v) {                       // a free roll at v m/frame through (XREF, ZB) at TREF; a bounce off the crate that returns REST of the speed
  if (v <= 0) return { x: L14.XREF, z: ZB };
  var th = L14.tHit(v);
  return t <= th ? { x: L14.XREF + v * (t - TREF), z: ZB } : { x: L14.xHit() - L14.REST * v * (t - th), z: ZB };
};
L14.sceneAt = function (ball, r) {
  return { name: 'yard', shapes: [
    FL.box(L14.XCRATE, ZB, 0.5, 0.5, [0.85, 0.35, 0.25], { stripes: 6, name: 'crate' }),
    FL.box(-0.6, 9.0, 0.8, 0.8, [0.30, 0.45, 0.85], { stripes: 4, a: 0.3, name: 'tower' }),
    FL.circle(ball.x, ball.z, r === undefined ? R0 : r, [0.25, 0.65, 0.35], { stripes: 5, name: 'ball' })],
    light: [-0.5, 0.85], amb: 0.35, bg: BG, far: 40, stepScale: 0.8 };
};
var _vid = {}, _vidKeys = [];
L14.video = function (v) {
  var key = v.toFixed(4);
  if (_vid[key]) return _vid[key];
  var out = { v: v, A: [], B: [], C: [], H: [] }, t, cam;
  var shot = function (tt, dx) { cam = L14.camAt(tt, dx); return { t: tt, ti: Math.floor(tt), cam: cam, img: FL.render(L14.sceneAt(L14.ballAt(tt, v)), cam) }; };
  for (t = 0; t < NF; t++) out.A.push(shot(t, 0));
  for (t = 0; t < T; t++) { out.B.push(shot(t, L14.BASE)); out.C.push(shot(t, -L14.BASE)); }
  for (t = 0; t < T - 1; t++) out.H.push(shot(t + 0.5, 0));
  _vid[key] = out; _vidKeys.push(key);
  if (_vidKeys.length > 6) delete _vid[_vidKeys.shift()];
  return out;
};
/* K0 seeds at the points camera A saw at the middle frame (first hits, 5 cm of noise, coloured by their pixel); the seeds on the ball are pushed along their pixel
   rays by the factor s: the depth the ball is GUESSED to have (s = 1: the right one) */
L14.seeds = function (K0, seed, noise, s) {
  var rng = FL.rng(seed), cam = L14.camAt(TREF), img = FL.render(L14.sceneAt(L14.ballAt(TREF, 0.1)), cam), pts = [], i, k;
  for (i = 0; i < W; i++) if (img.id[i] >= 0) {
    var x = img.hx[i], z = img.hz[i];
    if (img.id[i] === 2 && s !== 1) { x = cam.x + s * (x - cam.x); z = cam.z + s * (z - cam.z); }
    pts.push({ x: x, z: z, c: [img.r[i], img.g[i], img.b[i]], id: img.id[i] });
  }
  var out = [];
  for (k = 0; k < K0; k++) { var q = pts[Math.floor((k + 0.5) * pts.length / K0)]; out.push({ x: q.x + noise * FL.randn(rng), z: q.z + noise * FL.randn(rng), c: q.c, id: q.id }); }
  return out;
};

/* ═══════════════════════════ one experiment ═══════════════════════════
 *   opts: v (m/frame)  s (guessed depth of the ball, x true)  stereo (train on A and B)  dynamic (the moving group may move)  pose ('exact' | 'jitter' | 'estimate')
 *         sig (jitter, m)  seed  K0  steps
 *   The model: Gaussians k = 1..K, each with 9 numbers (lesson 10).  The seeds on the ball form the moving group; at frame t its Gaussians sit at  x_k + V·(t − TREF).
 *   Everything else stands still.  The camera poses the loop is told are the true ones plus a jitter; with pose = 'estimate' it also corrects them.             */
L14.Lab = function (o) {
  o = o || {};
  this.v = o.v; this.s = o.s === undefined ? 1 : o.s; this.stereo = !!o.stereo; this.dynamic = o.dynamic !== false;
  this.pose = o.pose || 'exact'; this.sig = o.sig === undefined ? 0.06 : o.sig; this.seed = o.seed || 7; this.K0 = o.K0 || 36; this.steps = o.steps || 300;
  this.lr = { pos: 0.016, scale: 0.02, rot: 0.02, opa: 0.05, col: 0.05, vel: 0.003, cam: 0.004 };
  var vid = L14.video(this.v), k, i;
  this.vid = vid;
  this.views = vid.A.slice(0, T).concat(this.stereo ? vid.B : []);
  var ch = L14.seeds(this.K0, this.seed, 0.05, this.s), K = ch.length;
  var S = FL.gs.fromPoints(ch, { scale: 0.11, ol: 0, bg: BG }, FL.rng(3));
  for (k = 0; k < K; k++) {
    for (i = 0; i < 3; i++) S.p[k * G + 6 + i] = logit(ch[k].c[i]);
    if (ch[k].id === 2 && this.s !== 1) { S.p[k * G + 2] += Math.log(this.s); S.p[k * G + 3] += Math.log(this.s); }     // a ball guessed s times as far must be s times as big
  }
  this.S = S; this.K = K; this.mover = ch.map(function (c) { return c.id === 2 ? 1 : 0; });
  this.V = [0, 0]; this.mV = [0, 0]; this.vV = [0, 0]; this.m = new Float64Array(K * G); this.v2 = new Float64Array(K * G); this.n = 0;
  var rng = FL.rng(11); this.jit = new Float64Array(T);                             // the pose error the loop is told about: none at the first and last frame
  if (this.pose !== 'exact') for (i = 1; i < T - 1; i++) this.jit[i] = this.sig * FL.randn(rng);
  this.delta = new Float64Array(T); this.mD = new Float64Array(T); this.vD = new Float64Array(T); this.nD = 0;
  this.St = FL.gs.make(K); this.St.bg = S.bg; this.St.dil = S.dil;
  this.fitted = false;
};
var LP = L14.Lab.prototype;
LP.place = function (t) {                                                           // the Gaussians as they are at time t
  var S = this.S, St = this.St, tau = t - TREF, k;
  St.p.set(S.p);
  if (this.dynamic) for (k = 0; k < this.K; k++) if (this.mover[k]) { St.p[k * G] += this.V[0] * tau; St.p[k * G + 1] += this.V[1] * tau; }
  return St;
};
LP.render = function (cam, t) { return FL.gs.render(this.place(t), cam); };
LP.belief = function (vw) { return Object.assign({}, vw.cam, { x: vw.cam.x + this.jit[vw.ti] + this.delta[vw.ti] }); };      // where the loop thinks the camera was
/* loss and gradients over the given views: g (K*9) for the Gaussians, gV for the velocity, gD for the camera corrections */
LP.grads = function (views) {
  var K = this.K, g = new Float64Array(K * G), gV = [0, 0], gD = new Float64Array(T), loss = 0, j, k, q;
  for (j = 0; j < views.length; j++) {
    var vw = views[j], r = FL.gs.grad(this.place(vw.t), [{ cam: this.belief(vw), img: vw.img }]), tau = vw.t - TREF;
    loss += r.loss;
    for (q = 0; q < K * G; q++) g[q] += r.grad[q];
    for (k = 0; k < K; k++) {
      if (this.mover[k]) { gV[0] += tau * r.grad[k * G]; gV[1] += tau * r.grad[k * G + 1]; }
      gD[vw.ti] -= r.grad[k * G];                            // moving the camera by +d = moving every splat, the moving group included, by -d
    }
  }
  var n = views.length;
  for (q = 0; q < K * G; q++) g[q] /= n;
  for (q = 0; q < T; q++) gD[q] /= n;
  return { loss: loss / n, g: g, gV: [gV[0] / n, gV[1] / n], gD: gD };
};
LP.step = function (views) {
  var r = this.grads(views), K = this.K, S = this.S, b1 = 0.9, b2 = 0.999, k, q, i;
  this.n++;
  var c1 = 1 - Math.pow(b1, this.n), c2 = 1 - Math.pow(b2, this.n);
  for (k = 0; k < K; k++) for (q = 0; q < G; q++) {
    i = k * G + q;
    this.m[i] = b1 * this.m[i] + (1 - b1) * r.g[i]; this.v2[i] = b2 * this.v2[i] + (1 - b2) * r.g[i] * r.g[i];
    var lr = q < 2 ? this.lr.pos : q < 4 ? this.lr.scale : q === 4 ? this.lr.rot : q === 5 ? this.lr.opa : this.lr.col;
    S.p[i] -= lr * (this.m[i] / c1) / (Math.sqrt(this.v2[i] / c2) + 1e-8);
    if (q === 2 || q === 3) S.p[i] = Math.max(Math.log(0.02), Math.min(Math.log(1.5), S.p[i]));
  }
  if (this.dynamic) for (i = 0; i < 2; i++) {
    this.mV[i] = b1 * this.mV[i] + (1 - b1) * r.gV[i]; this.vV[i] = b2 * this.vV[i] + (1 - b2) * r.gV[i] * r.gV[i];
    this.V[i] -= this.lr.vel * (this.mV[i] / c1) / (Math.sqrt(this.vV[i] / c2) + 1e-8);
  }
  if (this.pose === 'estimate') {                             // the first and the last pose are known: they fix the gauge (where the world is, and how big)
    this.nD++;
    var e1 = 1 - Math.pow(b1, this.nD), e2 = 1 - Math.pow(b2, this.nD);
    for (i = 1; i < T - 1; i++) {
      this.mD[i] = b1 * this.mD[i] + (1 - b1) * r.gD[i]; this.vD[i] = b2 * this.vD[i] + (1 - b2) * r.gD[i] * r.gD[i];
      this.delta[i] -= this.lr.cam * (this.mD[i] / e1) / (Math.sqrt(this.vD[i] / e2) + 1e-12);
    }
  }
  return r.loss;
};
/* the loop: half of the frames per step (they alternate), and for the moving model a horizon that grows from 3 to 12 frames around the middle one:
   a velocity can only be found from frames in which the moving thing still overlaps its own image */
LP.fit = function (n) {
  var N = this.steps, all = this.views, s0 = this.fitSteps || 0, s, e = Math.min(N, s0 + (n || N));
  for (s = s0; s < e; s++) {
    var H = Math.min(12, 3 + 9 * s / (0.6 * N)), fr = this.dynamic ? all.filter(function (vw) { return Math.abs(vw.t - TREF) <= H + 0.51; }) : all;
    fr = fr.filter(function (vw) { return (vw.ti + s) % 2 === 0; });
    this.step(fr);
  }
  this.fitSteps = e; this.fitted = true;
  return this;
};
LP.psnrOf = function (shots) { var s = 0, j; for (j = 0; j < shots.length; j++) s += FL.psnr(shots[j].img, this.render(shots[j].cam, shots[j].t)); return s / shots.length; };
/* the model's picture of every frame (cached until the next step) and the exam in space and time */
LP.snap = function () {
  var key = this.n + ':' + this.nD;
  if (this._snap && this._snap.key === key) return this._snap;
  var pred = [], t;
  for (t = 0; t < NF; t++) pred.push(this.render(this.vid.A[t].cam, t));
  this._snap = { key: key, pred: pred, sc: this.fitted ? this.score() : null };
  return this._snap;
};
/* the exam in space and time.  Cameras are told their TRUE poses here (as every exam in this track does). */
LP.score = function () {
  var vid = this.vid, perA = [], perC = [], t, a = function (x, i, j) { var s = 0, q; for (q = i; q < j; q++) s += x[q]; return s / (j - i); };
  for (t = 0; t < NF; t++) perA.push(FL.psnr(vid.A[t].img, this.render(vid.A[t].cam, t)));
  for (t = 0; t < T; t++) perC.push(FL.psnr(vid.C[t].img, this.render(vid.C[t].cam, t)));
  var rms = 0; for (t = 1; t < T - 1; t++) rms += Math.pow(this.jit[t] + this.delta[t], 2);
  return { perA: perA, perC: perC, train: a(perA, 0, T), held: a(perC, 0, T), interp: this.psnrOf(vid.H), fut1: a(perA, 24, 32), fut3: a(perA, 40, 48),
           speed: this.V[0] / L14.DT, poseErr: Math.sqrt(rms / (T - 2)) };
};

/* ═══════════════════════════ the picture ═══════════════════════════ */
L14.layout = function (w) {
  var narrow = w < 600, L = { narrow: narrow, w: w }, pad = 8, rowH = narrow ? 3 : 4, eh = NF * rowH;
  if (narrow) {
    L.world = [pad, pad, w - 2 * pad, 300];
    var ew = (w - 2 * pad - 2 * 8) / 3, ey = pad + 300 + 38;
    L.epi = [0, 1, 2].map(function (k) { return [pad + k * (ew + 8), ey, ew, eh]; });
    L.plot = [pad + 26, ey + eh + 60, w - 2 * pad - 26, 150];
    L.height = L.plot[1] + L.plot[3] + 28;
  } else {
    var ww = Math.min(250, Math.round(w * 0.34)), rx = pad + ww + 22, rw = w - rx - pad, ew2 = (rw - 2 * 10) / 3, ey2 = pad + 34;
    L.world = [pad, pad, ww, 8 + 34 + eh + 60 + 130];
    L.epi = [0, 1, 2].map(function (k) { return [rx + k * (ew2 + 10), ey2, ew2, eh]; });
    L.plot = [rx + 26, ey2 + eh + 60, rw - 26, 130];
    L.height = L.plot[1] + L.plot[3] + 28;
  }
  return L;
};
L14.draw = function (cv, lab, o) {
  o = o || {};
  var D = FL.draw, C = FL.C, w0 = cv.clientWidth || 640, Ly = L14.layout(w0);
  cv.style.height = Ly.height + 'px';
  var Sx = D.setup(cv), ctx = Sx.ctx, w = Sx.w, narrow = w < 600, i, k, t;
  Ly = L14.layout(w);
  var vid = lab.vid, fitted = lab.fitted, snap = lab.snap(), sc = snap.sc;
  /* ── world view ── */
  var wr = Ly.world, v = D.view(wr[0], wr[1], wr[2], wr[3], -3.2, 4.3, -1.6, 10.2);
  D.frame(ctx, wr[0], wr[1], wr[2], wr[3], C.panel); D.grid(ctx, v, 2);
  ctx.save(); ctx.beginPath(); ctx.rect(wr[0], wr[1], wr[2], wr[3]); ctx.clip();
  var scn = L14.sceneAt({ x: 0, z: 0 });
  D.scene(ctx, { shapes: scn.shapes.slice(0, 2) }, v, { fillAlpha: 0.2, lineWidth: 3 });
  for (k = 0; k < lab.K; k++) {                                                        // the Gaussians at the middle frame: 2σ ellipses in their own colour
    var b = k * G, op = FL.gs.opacity(lab.S, k), mv = lab.mover[k];
    ctx.beginPath(); ctx.ellipse(v.X(lab.S.p[b]), v.Y(lab.S.p[b + 1]), 2 * Math.exp(lab.S.p[b + 2]) * v.s, 2 * Math.exp(lab.S.p[b + 3]) * v.s, -lab.S.p[b + 4], 0, 2 * Math.PI);
    ctx.fillStyle = D.rgb(FL.gs.color(lab.S, k), 0.10 + 0.35 * op); ctx.fill();
    ctx.strokeStyle = mv ? 'rgba(22,101,52,0.75)' : 'rgba(31,36,48,0.35)'; ctx.lineWidth = mv ? 1 : 0.7; ctx.stroke();
  }
  var tHit = L14.tHit(lab.v), bt = [0, 23, 47];                                          // the true ball at three times, its true path every frame
  for (t = 0; t < NF; t++) { var bp = L14.ballAt(t, lab.v); D.dot(ctx, v.X(bp.x), v.Y(bp.z), bt.indexOf(t) >= 0 ? 2.6 : 1.3, t >= T ? C.amber : C.ink); }
  bt.forEach(function (tt) { var bq = L14.ballAt(tt, lab.v); ctx.beginPath(); ctx.arc(v.X(bq.x), v.Y(bq.z), R0 * v.s, 0, 2 * Math.PI); ctx.strokeStyle = tt >= T ? C.amber : C.ink; ctx.lineWidth = 1.2; ctx.stroke(); });
  if (fitted && lab.dynamic) {                                                          // where the model thinks the moving group is, at the same three times
    var mx = 0, mz = 0, nm = 0;
    for (k = 0; k < lab.K; k++) if (lab.mover[k]) { mx += lab.S.p[k * G]; mz += lab.S.p[k * G + 1]; nm++; }
    mx /= nm; mz /= nm;
    var path = []; for (t = 0; t < NF; t += 1) path.push([v.X(mx + lab.V[0] * (t - TREF)), v.Y(mz + lab.V[1] * (t - TREF))]);
    D.path(ctx, path, C.green, 1.6, [4, 3]);
    D.dot(ctx, path[0][0], path[0][1], 3, C.green, C.white); D.dot(ctx, path[23][0], path[23][1], 3, C.green, C.white); D.dot(ctx, path[47][0], path[47][1], 3.5, C.green, C.white);
  }
  var cams = [[0, 'A', C.blue], [L14.BASE, 'B', lab.stereo ? C.blue : C.dim], [-L14.BASE, 'C', C.amber]];
  D.wline(ctx, v, L14.CX0, 0, L14.CX0 + L14.CV * (T - 1), 0, C.blue, 2.5);
  cams.forEach(function (cm) { D.camera(ctx, L14.camAt(T - 1, cm[0]), v, { color: cm[2], label: cm[1], len: 1.6, fov: cm[1] === 'A' }); });
  ctx.restore();
  D.mono(ctx, 'world, from above (m)', wr[0] + 6, wr[1] + 10, C.mute, 9);
  D.mono(ctx, 'black: the true ball at frames 0, 23, 47', wr[0] + 6, wr[1] + wr[3] - 22, C.mute, 9);
  D.mono(ctx, fitted && lab.dynamic ? 'green: the fitted group, same frames' : 'ellipses: the Gaussians, middle frame', wr[0] + 6, wr[1] + wr[3] - 10, C.mute, 9);
  /* ── space-time images ── */
  var E = Ly.epi, rows = [vid.A.map(function (s) { return s.img; }), snap.pred, []], rowH = E[0][3] / NF;
  for (t = 0; t < NF; t++) {
    var pr = snap.pred[t];
    var ro = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W) };
    for (i = 0; i < W; i++) {
      var e = Math.sqrt((Math.pow(vid.A[t].img.r[i] - pr.r[i], 2) + Math.pow(vid.A[t].img.g[i] - pr.g[i], 2) + Math.pow(vid.A[t].img.b[i] - pr.b[i], 2)) / 3), tt = Math.min(1, 3 * e);
      ro.r[i] = 1 - 0.14 * tt; ro.g[i] = 1 - 0.85 * tt; ro.b[i] = 1 - 0.85 * tt;
    }
    rows[2].push(ro);
  }
  var titles = narrow ? ['photographs', fitted ? 'the model' : 'model, unfitted', 'differences'] : ['photographs', fitted ? 'the model' : 'the model (not fitted)', 'where they differ'];
  for (var p = 0; p < 3; p++) {
    var ex = E[p][0], ey = E[p][1], ew = E[p][2], cw = ew / W;
    for (t = 0; t < NF; t++) for (i = 0; i < W; i++) {
      var im = rows[p][t]; ctx.fillStyle = D.rgb([im.r[i], im.g[i], im.b[i]]); ctx.fillRect(ex + i * cw, ey + t * rowH, Math.ceil(cw) + 0.5, Math.ceil(rowH) + 0.5);
    }
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.strokeRect(ex + 0.5, ey + 0.5, ew - 1, NF * rowH - 1);
    D.line(ctx, ex, ey + T * rowH, ex + ew, ey + T * rowH, C.ink, 1, [4, 3]);
    if (isFinite(tHit) && tHit < NF) D.line(ctx, ex - 4, ey + tHit * rowH, ex, ey + tHit * rowH, C.amber, 2);
    D.mono(ctx, titles[p], ex, ey - 8, C.mute, narrow ? 8 : 9);
  }
  D.mono(ctx, 'time ↓  fitted: first 2.4 s (above the dashes)', E[0][0], E[0][1] + NF * rowH + 12, C.mute, 9);
  D.mono(ctx, 'future: the next 2.4 s (below)', E[0][0], E[0][1] + NF * rowH + 24, C.mute, 9);
  /* ── the exam score against time ── */
  var P = Ly.plot, X = function (f) { return P[0] + (f + 0.5) / NF * P[2]; }, Y = function (db) { return P[1] + P[3] - Math.max(0, Math.min(40, db)) / 40 * P[3]; };
  D.frame(ctx, P[0], P[1], P[2], P[3], C.white);
  ctx.fillStyle = 'rgba(37,99,235,0.07)'; ctx.fillRect(P[0], P[1], X(T - 0.5) - P[0], P[3]);
  [0, 10, 20, 30, 40].forEach(function (db) { D.line(ctx, P[0], Y(db), P[0] + P[2], Y(db), C.grid, 1); D.mono(ctx, String(db), P[0] - 4, Y(db), C.mute, 9, 'right'); });
  [0, 12, 24, 36, 47].forEach(function (f) { D.mono(ctx, String(f), X(f), P[1] + P[3] + 10, C.mute, 9, 'center'); });
  D.mono(ctx, narrow ? 'PSNR (dB) of camera A, by frame' : 'PSNR (dB) of camera A against the frame number (0.1 s each)', P[0], P[1] - 8, C.mute, 9);
  if (isFinite(tHit) && tHit < NF) { D.line(ctx, X(tHit), P[1], X(tHit), P[1] + P[3], C.amber, 1.3, [4, 3]); D.mono(ctx, 'contact', X(tHit) + 3, P[1] + 8, C.amber, 9); }
  D.mono(ctx, 'fitted', P[0] + 4, P[1] + 8, C.blue, 9);
  if (sc) {
    D.path(ctx, sc.perA.map(function (db, f) { return [X(f), Y(db)]; }), C.blue, 1.8);
    sc.perC.forEach(function (db, f) { D.dot(ctx, X(f), Y(db), 2.2, C.green); });
    D.mono(ctx, narrow ? 'blue: A · green dots: held-out C' : 'blue: camera A · green dots: held-out camera C', P[0] + 4, P[1] + P[3] - 8, C.mute, 9);
  } else D.mono(ctx, 'press fit', P[0] + P[2] / 2, P[1] + P[3] / 2, C.mute, 11, 'center');
};

if (typeof module !== 'undefined' && module.exports) module.exports = L14;
root.L14 = L14;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
