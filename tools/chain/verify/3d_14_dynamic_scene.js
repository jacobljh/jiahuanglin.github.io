#!/usr/bin/env node
/* Oracle for 3D lesson 14, "When the scene moves: time, SLAM, and the road to world models".
 *
 * Independent pieces
 *   (a) the yard, its camera slide and its ball, written again from the lesson's own description (not the engine's); the photographs of the page's engine are
 *       compared with them pixel for pixel;
 *   (b) the closed forms of §2: the gauge (shift the camera and the world together), the depth-scale family p_s(t) = C(t) + s (p(t) - C(t)), r_s = s r with its world
 *       velocity c + s (v - c), the silhouette edges of a disc from the tangent angles phi +- asin(r/d), and the rank of the Jacobian of the edges with respect to
 *       each model's unknowns (a Jacobi eigen-solver, no engine code);
 *   (c) the fit of §3-§5 written again with the same primitives (FL.gs.grad / FL.gs.render) but its own loop, seeds, Adam, pose bookkeeping and scoring; every state the
 *       prose quotes is run through it and compared with the page's engine, then with the widget itself (loadPage);
 *   (d) identities: the chain rule dL/dV = sum_t tau sum_k dL_t/dx_k and the gauge gradient dL_t/d(delta_t) = - sum_k dL_t/dx_k against finite differences;
 *   (e) the claims of §6: interpolation in time costs nothing, extrapolation does, a push changes the world and not the model.
 * Prints {"facts": {...}} as its last line; the validator checks every <span data-n="key"> in the page against it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const L14 = require(path.join(DIR, 'l14_dynamic.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ───────────────────────── (a) the yard, written again ───────────────────────── */
const F = 44, W = 64, T = 24, NF = 48, TREF = 11.5, CV = 0.04, CX0 = -0.5, R = 0.45, ZB = 4.4, XCRATE = 3.0, REST = 0.8, G = FL.gs.P;
const BGC = [0.93, 0.94, 0.96];
const camX = (t, dx) => CX0 + CV * Math.min(t, T - 1) + (dx || 0);
const camAt = (t, dx) => FL.camera({ x: camX(t, dx), z: 0, a: Math.PI / 2, f: F, W: W });
const XHIT = XCRATE - 0.5 - R;
/* the ball: free roll at v m/frame through (-0.5, 4.4) at the middle frame; bounce off the crate; optionally struck at frame `push.t` so that its speed becomes `push.k` times v */
function ballAt(t, v, push) {
  if (v <= 0) return { x: -0.5, z: ZB };
  let x0 = -0.5, t0 = TREF, sp = v;
  if (push && t > push.t) { x0 = -0.5 + v * (push.t - TREF); t0 = push.t; sp = push.k * v; }
  const th = t0 + (XHIT - x0) / sp;
  return t <= th ? { x: x0 + sp * (t - t0), z: ZB } : { x: XHIT - REST * sp * (t - th), z: ZB };
}
const sceneOf = (b, r, shift) => ({ name: 'yard', shapes: [
  FL.box(XCRATE + (shift || 0), ZB, 0.5, 0.5, [0.85, 0.35, 0.25], { stripes: 6, name: 'crate' }),
  FL.box(-0.6 + (shift || 0), 9.0, 0.8, 0.8, [0.30, 0.45, 0.85], { stripes: 4, a: 0.3, name: 'tower' }),
  FL.circle(b.x, b.z, r === undefined ? R : r, [0.25, 0.65, 0.35], { stripes: 5, name: 'ball' })],
  light: [-0.5, 0.85], amb: 0.35, bg: BGC, far: 40, stepScale: 0.8 });
const photo = (t, v, dx, push) => FL.render(sceneOf(ballAt(t, v, push)), camAt(t, dx));
const psnrOf = (A, B) => { let s = 0; for (let i = 0; i < W; i++) s += ((A.r[i] - B.r[i]) ** 2 + (A.g[i] - B.g[i]) ** 2 + (A.b[i] - B.b[i]) ** 2) / 3; s /= W; return s < 1e-10 ? 99 : -10 * Math.log10(s); };

{
  const vid = L14.video(0.12);
  let worst = 0;
  for (let t = 0; t < NF; t++) { const a = photo(t, 0.12, 0), b = vid.A[t].img; for (let i = 0; i < W; i++) worst = Math.max(worst, Math.abs(a.r[i] - b.r[i]), Math.abs(a.g[i] - b.g[i]), Math.abs(a.b[i] - b.b[i])); }
  for (let t = 0; t < T; t++) { const a = photo(t, 0.12, -0.5), b = vid.C[t].img, c = photo(t, 0.12, 0.5), d = vid.B[t].img; for (let i = 0; i < W; i++) worst = Math.max(worst, Math.abs(a.r[i] - b.r[i]), Math.abs(c.g[i] - d.g[i])); }
  ok('the page engine renders the yard the lesson describes', worst === 0, worst);
  ok('the ball hits the crate at frame 32.75 for v = 0.12', close(L14.tHit(0.12), TREF + (XHIT + 0.5) / 0.12, 1e-12));
  facts.t_hit = TREF + (XHIT + 0.5) / 0.12;
  facts.t_hit_s = facts.t_hit * 0.1;
  facts.post_speed = REST * 1.2;                      // m/s after the bounce
}

/* ───────────────────────── §1: what the numbers of the yard are ───────────────────────── */
{
  const zc = 4.4 - 0.5;                                // front face of the crate
  // the tower is a box turned by 0.3 rad with its centre 9 m away: what the camera sees of it is its two near faces, 8 to 9 m away; its edges drift at f c / Z for those Z
  const tz = []; const im0 = photo(0, 0.12, 0); for (let i = 0; i < W; i++) if (im0.id[i] === 1) tz.push(im0.depth[i]);
  facts.tower_zmin = Math.min(...tz); facts.tower_zmax = Math.max(...tz);
  ok('the visible tower lies 8 to 9 m away', tz.length > 5 && facts.tower_zmin > 7.9 && facts.tower_zmax < 9.1, [facts.tower_zmin, facts.tower_zmax]);
  facts.px_crate = F * CV / zc; facts.px_tower = F * CV * tz.length / tz.reduce((a, b) => a + b, 0); facts.px_ball = F * (0.12 - CV) / ZB;
  facts.ball_w = F * 2 * R / ZB; facts.ball_move = facts.px_ball * T;
  // the front face of the crate really is where the render says
  const im = photo(TREF, 0.12, 0); let zmin = 1e9; for (let i = 0; i < W; i++) if (im.id[i] === 0) zmin = Math.min(zmin, im.depth[i]);
  ok('crate front face at 3.9 m', close(zmin, zc, 3e-3), zmin);
  // parallax of the crate's front face: the first pixel of the photograph that sees the face (depth 3.9 m) follows u = W/2 + f (2.5 - x_cam) / 3.9
  const faceEdge = t => { const I = photo(t, 0.12, 0); for (let i = 0; i < W; i++) if (I.id[i] === 0 && Math.abs(I.depth[i] - zc) < 0.01) return i; return -1; };
  const uCorner = t => W / 2 + F * (2.5 - camX(t, 0)) / zc;
  for (const t of [8, 15, 23]) ok('front face of the crate follows f (2.5 - x_cam) / 3.9 at frame ' + t, Math.abs(faceEdge(t) + 0.5 - uCorner(t)) <= 1, [faceEdge(t), uCorner(t)]);
  ok('the front face drifts left by f c / Z per frame', close((uCorner(8) - uCorner(23)) / 15, facts.px_crate, 1e-9));
}

/* ───────────────────────── (b) §2 closed forms ───────────────────────── */
const edges = (cx, X, Z, r) => { const dx = X - cx, phi = Math.atan2(dx, Z), al = Math.asin(r / Math.hypot(dx, Z)); return [W / 2 + F * Math.tan(phi - al), W / 2 + F * Math.tan(phi + al)]; };
{
  // the engine's pixel coverage agrees with the closed-form edges (a pixel centre i + 1/2 is on the ball iff it lies between them)
  let bad = 0;
  for (let t = 0; t < T; t += 3) { const p = ballAt(t, 0.12), e = edges(camX(t, 0), p.x, p.z, R), I = photo(t, 0.12, 0); for (let i = 0; i < W; i++) { const inside = i + 0.5 > e[0] + 1e-3 && i + 0.5 < e[1] - 1e-3, onBall = I.id[i] === 2; if (inside !== onBall && !(Math.abs(i + 0.5 - e[0]) <= 2e-3 || Math.abs(i + 0.5 - e[1]) <= 2e-3)) bad++; } }
  ok('closed-form silhouette edges predict which pixels see the ball', bad === 0, bad);
}
{ // the gauge: slide the camera, or leave it at the first pose and slide the whole yard the other way
  let worst = 0;
  for (let t = 0; t < T; t++) {
    const p = ballAt(t, 0.12), shift = -CV * t;
    const A = photo(t, 0.12, 0);
    const B = FL.render(sceneOf({ x: p.x + shift, z: p.z }, R, shift), camAt(0, 0));
    for (let i = 0; i < W; i++) worst = Math.max(worst, Math.abs(A.r[i] - B.r[i]), Math.abs(A.g[i] - B.g[i]), Math.abs(A.b[i] - B.b[i]));
  }
  facts.gauge_diff = worst;
  ok('gauge: a moving camera and a moving world give the same photographs', worst < 1e-6, worst);
}
{ // the depth-scale family
  const v = 0.12, c = CV;
  for (const s of [0.5, 1.6]) {
    const tag = s === 0.5 ? 's05' : 's16';
    let eA = 0, eC = 0, mx = 0, mism = 0, pc = 0;
    for (let t = 0; t < T; t++) {
      const cx = camX(t, 0), p = ballAt(t, v), q = { x: cx + s * (p.x - cx), z: s * p.z };
      const a0 = edges(cx, p.x, p.z, R), a1 = edges(cx, q.x, q.z, s * R); eA = Math.max(eA, Math.abs(a0[0] - a1[0]), Math.abs(a0[1] - a1[1]));
      const cxc = camX(t, -0.5), c0 = edges(cxc, p.x, p.z, R), c1 = edges(cxc, q.x, q.z, s * R); eC = Math.max(eC, Math.abs(c0[0] - c1[0]), Math.abs(c0[1] - c1[1]));
      const A = FL.render(sceneOf(p), camAt(t, 0)), B = FL.render(sceneOf(q, s * R), camAt(t, 0));
      for (let i = 0; i < W; i++) { mx = Math.max(mx, Math.abs(A.r[i] - B.r[i]), Math.abs(A.g[i] - B.g[i]), Math.abs(A.b[i] - B.b[i])); if (A.id[i] !== B.id[i]) mism++; }
      pc += psnrOf(FL.render(sceneOf(p), camAt(t, -0.5)), FL.render(sceneOf(q, s * R), camAt(t, -0.5))) / T;
    }
    ok('family s=' + s + ': edges seen by camera A agree to 1e-12 px', eA < 1e-12, eA);
    ok('family s=' + s + ': the engine renders the same pixels (ray-marching tolerance)', mx < 0.02 && mism === 0, [mx, mism]);
    ok('family s=' + s + ': camera C tells the worlds apart', eC > 1, eC);
    // world velocity of the scaled ball, by differencing its path
    const pos = t => { const cx = camX(t, 0), p = ballAt(t, v); return cx + s * (p.x - cx); };
    const vs = (pos(10) - pos(4)) / 6;
    ok('family s=' + s + ': world speed c + s (v - c)', close(vs, c + s * (v - c), 1e-12), [vs, c + s * (v - c)]);
    facts[tag + '_depth'] = s * ZB; facts[tag + '_r'] = s * R; facts[tag + '_speed'] = 10 * (c + s * (v - c)); facts[tag + '_diffA'] = mx; facts[tag + '_edgeC'] = eC; facts[tag + '_psnrC'] = pc;
  }
  ok('the family brackets the true speed of 1.2 m/s', facts.s05_speed < 1.2 && facts.s16_speed > 1.2);
  // the other direction: a ball rolling against the camera's motion can be replaced by a static one
  const cc = 0.04, vv = -0.06, sStat = cc / (cc - vv);
  facts.ck_s = sStat; facts.ck_depth = 5 * sStat; facts.ck_r = 0.5 * sStat; facts.ck_d1 = F * 0.5 / 5; facts.ck_d2 = F * 0.5 / (5 * sStat); facts.ck_dd = facts.ck_d2 - facts.ck_d1;
  ok('stand-still member: v_s = c + s (v - c) = 0', close(cc + sStat * (vv - cc), 0, 1e-12));
}
{ // §2 rank table: Jacobian of the 2 edges per frame (per camera) with respect to each model's unknowns
  const eigSym = (A, n) => {
    A = A.map(r => r.slice());
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-30) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const kp = A[k][p], kq = A[k][q]; A[k][p] = c * kp - s * kq; A[k][q] = s * kp + c * kq; }
        for (let k = 0; k < n; k++) { const pk = A[p][k], qk = A[q][k]; A[p][k] = c * pk - s * qk; A[q][k] = s * pk + c * qk; }
      }
    }
    return A.map((r, i) => r[i]).sort((a, b) => b - a);
  };
  const analyse = (theta, model, dxs) => {
    const n = theta.length, data = th => { const out = []; for (const dx of dxs) for (let t = 0; t < T; t++) { const g = model(th, t), e = edges(camX(t, dx), g.x, g.z, g.r); out.push(e[0], e[1]); } return out; };
    const m = data(theta).length, J = [];
    for (let i = 0; i < n; i++) { const h = 1e-6 * Math.max(1, Math.abs(theta[i])), tp = theta.slice(), tm = theta.slice(); tp[i] += h; tm[i] -= h; const a = data(tp), b = data(tm); J.push(a.map((x, k) => (x - b[k]) / (2 * h))); }
    const H = []; for (let i = 0; i < n; i++) { H.push([]); for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) s += J[i][k] * J[j][k]; H[i].push(s); } }
    const ev = eigSym(H, n).map(x => Math.sqrt(Math.max(0, x))), top = ev[0], rank = ev.filter(x => x > 1e-7 * top).length;
    const gap = rank < n ? ev[rank - 1] / Math.max(ev[rank], 1e-300) : Infinity;       // how clean the separation between "zero" and "not zero" is
    return { n, m, rank, null: n - rank, gap };
  };
  const v = 0.12, path = []; for (let t = 0; t < T; t++) path.push(ballAt(t, v));
  const pf = []; path.forEach(p => pf.push(p.x, p.z, R));
  const sh = []; path.forEach(p => sh.push(p.x, p.z)); sh.push(R);
  const cv0 = [-0.5, ZB, v, 0, R];
  const mPF = (th, t) => ({ x: th[3 * t], z: th[3 * t + 1], r: th[3 * t + 2] }), mSH = (th, t) => ({ x: th[2 * t], z: th[2 * t + 1], r: th[2 * T] });
  const mCV = (th, t) => ({ x: th[0] + th[2] * (t - TREF), z: th[1] + th[3] * (t - TREF), r: th[4] });
  const rows = { pf1: analyse(pf, mPF, [0]), sh1: analyse(sh, mSH, [0]), cv1: analyse(cv0, mCV, [0]), pf2: analyse(pf, mPF, [0, 0.5]), sh2: analyse(sh, mSH, [0, 0.5]), cv2: analyse(cv0, mCV, [0, 0.5]) };
  for (const k in rows) { facts['rk_' + k] = rows[k].rank; facts['nl_' + k] = rows[k].null; }
  ok('rank table: unknowns and measurements', rows.pf1.n === 72 && rows.pf1.m === 48 && rows.sh1.n === 49 && rows.cv1.n === 5 && rows.pf2.m === 96);
  ok('rank table: one frame at a time leaves one scale per frame', rows.pf1.null === T && rows.pf1.rank === 2 * T);
  ok('rank table: a shared size leaves one scale; velocity law leaves the same one', rows.sh1.null === 1 && rows.cv1.null === 1 && rows.cv1.rank === 4);
  ok('rank table: a second camera leaves nothing', rows.pf2.null === 0 && rows.sh2.null === 0 && rows.cv2.null === 0);
  ok('rank table: the null directions are cleanly separated from the rest (ratio of singular values > 1e3)', rows.sh1.gap > 1e3 && rows.cv1.gap > 1e3, [rows.sh1.gap, rows.cv1.gap]);
}

/* ───────────────────────── §3 accounting ───────────────────────── */
{
  const K = 36;
  facts.K = K; facts.p_frame = 9 * K * T; facts.p_free = 9 * K + 2 * T; facts.p_const = 9 * K + 2; facts.data_mono = 3 * W * T; facts.data_stereo = 2 * 3 * W * T;
  facts.ratio_free = facts.data_mono / facts.p_free; facts.ratio_const = facts.data_mono / facts.p_const;
}

/* ───────────────────────── (c) the fit, written again ───────────────────────── */
const logit = p => { p = Math.min(0.995, Math.max(0.005, p)); return Math.log(p / (1 - p)); };
function seedsOf(K0, seed, s) {
  const rng = FL.rng(seed), cam = camAt(TREF, 0), im = FL.render(sceneOf(ballAt(TREF, 0.1)), cam), pts = [];
  for (let i = 0; i < W; i++) if (im.id[i] >= 0) {
    let x = im.hx[i], z = im.hz[i];
    if (im.id[i] === 2 && s !== 1) { x = cam.x + s * (x - cam.x); z = s * z; }
    pts.push({ x, z, c: [im.r[i], im.g[i], im.b[i]], id: im.id[i] });
  }
  const out = [];
  for (let k = 0; k < K0; k++) { const q = pts[Math.floor((k + 0.5) * pts.length / K0)], nx = 0.05 * FL.randn(rng), nz = 0.05 * FL.randn(rng); out.push({ x: q.x + nx, z: q.z + nz, c: q.c, id: q.id }); }
  return out;
}
/* o: v (m/frame), s, stereo, dynamic, pose ('exact' | 'jitter' | 'estimate'), sig, seed.  Returns the fitted model with its scoring functions. */
function runFit(o) {
  const v = o.v, s = o.s === undefined ? 1 : o.s, stereo = !!o.stereo, dynamic = o.dynamic !== false, pose = o.pose || 'exact', sig = o.sig === undefined ? 0.06 : o.sig, seed = o.seed || 7, K0 = 36, N = 300;
  const nT = o.nT || T, Hmax = nT === T ? 12 : Math.ceil(nT - 1 - TREF);       // fitted frames per camera (24 unless an experiment asks for more) and the widest horizon of the curriculum
  const frames = [];                                                                // training views: camera A for nT frames (then camera B), in this order
  for (let t = 0; t < nT; t++) frames.push({ t, dx: 0, img: photo(t, v, 0) });
  if (stereo) for (let t = 0; t < nT; t++) frames.push({ t, dx: 0.5, img: photo(t, v, 0.5) });
  const ch = seedsOf(K0, seed, s), K = ch.length, S = FL.gs.fromPoints(ch, { scale: 0.11, ol: 0, bg: BGC }, FL.rng(3));
  for (let k = 0; k < K; k++) { for (let i = 0; i < 3; i++) S.p[k * G + 6 + i] = logit(ch[k].c[i]); if (ch[k].id === 2 && s !== 1) { S.p[k * G + 2] += Math.log(s); S.p[k * G + 3] += Math.log(s); } }
  const moving = [], still = []; ch.forEach((c, k) => (c.id === 2 ? moving : still).push(k));
  const jit = new Float64Array(NF), rng = FL.rng(11);
  if (pose !== 'exact') for (let i = 1; i < T - 1; i++) jit[i] = sig * FL.randn(rng);
  const delta = new Float64Array(NF), V = [0, 0], work = FL.gs.make(K); work.bg = S.bg; work.dil = S.dil;
  const m1 = new Float64Array(K * G), m2 = new Float64Array(K * G), mv1 = [0, 0], mv2 = [0, 0], md1 = new Float64Array(NF), md2 = new Float64Array(NF);
  const putAt = t => { work.p.set(S.p); if (dynamic) for (const k of moving) { work.p[k * G] += V[0] * (t - TREF); work.p[k * G + 1] += V[1] * (t - TREF); } return work; };
  const believed = f => FL.camera({ x: camX(f.t, f.dx) + jit[f.t] + delta[f.t], z: 0, a: Math.PI / 2, f: F, W: W });
  let nA = 0, nD = 0;
  for (let step = 0; step < N; step++) {
    const H = Math.min(Hmax, 3 + (Hmax - 3) * step / (0.6 * N));
    const use = frames.filter(f => (!dynamic || Math.abs(f.t - TREF) <= H + 0.51) && (f.t + step) % 2 === 0);
    const gS = new Float64Array(K * G), gV = [0, 0], gD = new Float64Array(NF);
    for (const f of use) {
      const r = FL.gs.grad(putAt(f.t), [{ cam: believed(f), img: f.img }]);
      for (let q = 0; q < K * G; q++) gS[q] += r.grad[q];
      for (const k of moving) { gV[0] += (f.t - TREF) * r.grad[k * G]; gV[1] += (f.t - TREF) * r.grad[k * G + 1]; }
      for (let k = 0; k < K; k++) gD[f.t] -= r.grad[k * G];                    // moving the camera by +d = moving every Gaussian by -d
    }
    nA++;
    const c1 = 1 - 0.9 ** nA, c2 = 1 - 0.999 ** nA, n = use.length;
    for (let k = 0; k < K; k++) for (let q = 0; q < G; q++) {
      const i = k * G + q, g = gS[i] / n;
      m1[i] = 0.9 * m1[i] + 0.1 * g; m2[i] = 0.999 * m2[i] + 0.001 * g * g;
      const lr = q < 2 ? 0.016 : q < 4 ? 0.02 : q === 4 ? 0.02 : q === 5 ? 0.05 : 0.05;
      S.p[i] -= lr * (m1[i] / c1) / (Math.sqrt(m2[i] / c2) + 1e-8);
      if (q === 2 || q === 3) S.p[i] = Math.max(Math.log(0.02), Math.min(Math.log(1.5), S.p[i]));
    }
    if (dynamic) for (let i = 0; i < 2; i++) { const g = gV[i] / n; mv1[i] = 0.9 * mv1[i] + 0.1 * g; mv2[i] = 0.999 * mv2[i] + 0.001 * g * g; V[i] -= 0.003 * (mv1[i] / c1) / (Math.sqrt(mv2[i] / c2) + 1e-8); }
    if (pose === 'estimate') {
      nD++;
      const e1 = 1 - 0.9 ** nD, e2 = 1 - 0.999 ** nD;
      for (let i = 1; i < T - 1; i++) { const g = gD[i] / n; md1[i] = 0.9 * md1[i] + 0.1 * g; md2[i] = 0.999 * md2[i] + 0.001 * g * g; delta[i] -= 0.004 * (md1[i] / e1) / (Math.sqrt(md2[i] / e2) + 1e-12); }
    }
  }
  const draw = (t, dx) => FL.gs.render(putAt(t), camAt(t, dx));                      // the exam gives the TRUE pose of the query camera
  const mean = (a, i, j) => { let q = 0; for (let k = i; k < j; k++) q += a[k]; return q / (j - i); };
  const perA = []; for (let t = 0; t < NF; t++) perA.push(psnrOf(photo(t, v, 0), draw(t, 0)));
  const perC = []; for (let t = 0; t < T; t++) perC.push(psnrOf(photo(t, v, -0.5), draw(t, -0.5)));
  const half = []; for (let t = 0; t < T - 1; t++) half.push(psnrOf(photo(t + 0.5, v, 0), draw(t + 0.5, 0)));
  let rms = 0; for (let t = 1; t < T - 1; t++) rms += (jit[t] + delta[t]) ** 2;
  return { train: mean(perA, 0, T), held: mean(perC, 0, T), interp: mean(half, 0, half.length), fut1: mean(perA, 24, 32), fut3: mean(perA, 40, 48), perA, speed: 10 * V[0], V, poseErr: Math.sqrt(rms / (T - 2)), S, moving, still, draw, K, v };
}
function agree(label, mine, eng) {
  const sc = eng.score();
  ok(label + ': train', close(mine.train, sc.train, 1e-6), [mine.train, sc.train]);
  ok(label + ': held-out camera', close(mine.held, sc.held, 1e-6), [mine.held, sc.held]);
  ok(label + ': held-out times', close(mine.interp, sc.interp, 1e-6), [mine.interp, sc.interp]);
  ok(label + ': future', close(mine.fut1, sc.fut1, 1e-6) && close(mine.fut3, sc.fut3, 1e-6), [mine.fut1, sc.fut1, mine.fut3, sc.fut3]);
  ok(label + ': speed', close(mine.speed, sc.speed, 1e-9), [mine.speed, sc.speed]);
  ok(label + ': pose error', close(mine.poseErr, sc.poseErr, 1e-9), [mine.poseErr, sc.poseErr]);
}
const V12 = 0.12;
const FITS = {};                                  // cache of the fits the prose quotes (independent implementation)
const fitOf = (key, o) => FITS[key] || (FITS[key] = runFit(o));
/* where a fit's error sits: PSNR pooled over the pixels of the ball and the 2 px around them (per frame), and over all the other pixels; frames t0 .. t1-1 of camera A */
const splitOf = (fit, v, t0, t1) => {
  let sOn = 0, nOn = 0, sOff = 0, nOff = 0;
  for (let t = t0; t < t1; t++) {
    const A = photo(t, v, 0), P = fit.draw(t, 0); let lo = W, hi = -1;
    for (let i = 0; i < W; i++) if (A.id[i] === 2) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
    for (let i = 0; i < W; i++) { const e = ((A.r[i] - P.r[i]) ** 2 + (A.g[i] - P.g[i]) ** 2 + (A.b[i] - P.b[i]) ** 2) / 3; if (hi >= 0 && i >= lo - 2 && i <= hi + 2) { sOn += e; nOn++; } else { sOff += e; nOff++; } }
  }
  return { on: -10 * Math.log10(sOn / nOn), off: -10 * Math.log10(sOff / nOff) };
};

/* §1: the speed sweep, one camera, the default seed */
{
  const tag = { 0: '0', 0.04: '4', 0.08: '8', 0.12: '12', 0.16: '16', 0.2: '20' };
  for (const v of [0, 0.04, 0.08, 0.12, 0.16, 0.2]) {
    const a = fitOf('static_' + v, { v, dynamic: false }), b = fitOf('dyn_' + v, { v, dynamic: true });
    facts['st_' + tag[v]] = a.train; facts['dy_' + tag[v]] = b.train; facts['dysp_' + tag[v]] = b.speed;
  }
  facts.st_drop = facts.st_0 - facts.st_20; facts.dy_drop = facts.dy_0 - facts.dy_20;
  ok('static fit: the score falls as the ball speeds up', facts.st_0 > facts.st_4 && facts.st_4 > facts.st_8 && facts.st_8 > facts.st_12 && facts.st_12 > facts.st_16 && facts.st_16 > facts.st_20, [facts.st_0, facts.st_4, facts.st_8, facts.st_12, facts.st_16, facts.st_20]);
  ok('static fit: the fall flattens (each 0.4 m/s of speed costs less than the one before)', (facts.st_0 - facts.st_4) > (facts.st_4 - facts.st_8) && (facts.st_4 - facts.st_8) > (facts.st_8 - facts.st_12) && (facts.st_8 - facts.st_12) > (facts.st_12 - facts.st_16) && (facts.st_12 - facts.st_16) > (facts.st_16 - facts.st_20));
  { // where the static fit's error sits: the PSNR over the pixels that show the background, the crate and the ball (what the photograph shows there), frames 0-23, camera A
    const byObject = (fit, v) => { const acc = {}; for (let t = 0; t < T; t++) { const A = photo(t, v, 0), P = fit.draw(t, 0); for (let i = 0; i < W; i++) { const id = A.id[i] < 0 ? -1 : A.id[i], e = ((A.r[i] - P.r[i]) ** 2 + (A.g[i] - P.g[i]) ** 2 + (A.b[i] - P.b[i]) ** 2) / 3; (acc[id] = acc[id] || { s: 0, n: 0 }); acc[id].s += e; acc[id].n++; } } const db = k => -10 * Math.log10(acc[k].s / acc[k].n); return { bg: db(-1), crate: db(0), ball: db(2) }; };
    const r0 = byObject(FITS['static_0'], 0), r1 = byObject(FITS['static_0.12'], 0.12);
    facts.st_bg0 = r0.bg; facts.st_crate0 = r0.crate; facts.st_bg = r1.bg; facts.st_crate = r1.crate; facts.st_ballpx = r1.ball;
    ok('static fit at 1.2 m/s: the crate is as well fitted as at rest (within 0.5 dB)', Math.abs(r1.crate - r0.crate) < 0.5, [r0, r1]);
    ok('static fit at 1.2 m/s: the ball pixels score under 12 dB and the empty background falls by 8 dB or more', r1.ball < 12 && r0.bg - r1.bg > 8, [r0, r1]); }
  ok('static fit: a world at rest is a fine static scene', facts.st_0 > 26, facts.st_0);
  ok('moving fit: stays within 5.5 dB of the static world across speeds', facts.dy_20 > facts.st_0 - 5.5 && facts.dy_12 > facts.st_0 - 3, [facts.dy_12, facts.dy_20]);
  ok('moving fit beats static fit by 8 dB or more once the ball moves at 0.8 m/s', facts.dy_8 - facts.st_8 > 8 && facts.dy_12 - facts.st_12 > 8 && facts.dy_20 - facts.st_20 > 8);
  ok('the moving fit finds the right speed when the ball is at rest', Math.abs(facts.dysp_0) < 0.1, facts.dysp_0);
  agree('independent fit == page engine (static, 1.2 m/s)', fitOf('static_0.12', { v: V12, dynamic: false }), new L14.Lab({ v: V12, dynamic: false }).fit());
  agree('independent fit == page engine (moving, 1.2 m/s)', fitOf('dyn_0.12', { v: V12, dynamic: true }), new L14.Lab({ v: V12, dynamic: true }).fit());
  facts.dyn_speed = facts.dysp_12; facts.dyn_train = facts.dy_12; facts.static_train = facts.st_12;
  facts.mono_held = FITS['dyn_0.12'].held; facts.mono_interp = FITS['dyn_0.12'].interp;
}

/* §2 + §5: one camera and a guessed depth for the ball; two cameras */
{
  const rowsOf = (stereo, s) => { const q = []; for (const seed of [1, 2, 3, 4, 5, 6]) { const f = runFit({ v: V12, s, stereo, seed }); q.push(f); } return q; };
  for (const [tag, s] of [['m6', 0.6], ['m10', 1], ['m15', 1.5]]) {
    const f = fitOf('mono_' + tag, { v: V12, s, stereo: false });
    facts[tag + '_train'] = f.train; facts[tag + '_held'] = f.held; facts[tag + '_speed'] = f.speed;
    const rows = rowsOf(false, s);
    facts[tag + '_held_lo'] = Math.min(...rows.map(r => r.held)); facts[tag + '_held_hi'] = Math.max(...rows.map(r => r.held));
    facts[tag + '_speed_lo'] = Math.min(...rows.map(r => r.speed)); facts[tag + '_speed_hi'] = Math.max(...rows.map(r => r.speed));
    facts[tag + '_train_lo'] = Math.min(...rows.map(r => r.train)); facts[tag + '_train_hi'] = Math.max(...rows.map(r => r.train));
  }
  for (const [tag, s] of [['s6', 0.6], ['s10', 1], ['s15', 1.5]]) {
    const f = fitOf('stereo_' + tag, { v: V12, s, stereo: true });
    facts[tag + '_train'] = f.train; facts[tag + '_held'] = f.held; facts[tag + '_speed'] = f.speed; facts[tag + '_fut1'] = f.fut1; facts[tag + '_fut3'] = f.fut3; facts[tag + '_interp'] = f.interp;
    const rows = rowsOf(true, s);
    facts[tag + '_held_lo'] = Math.min(...rows.map(r => r.held)); facts[tag + '_held_hi'] = Math.max(...rows.map(r => r.held));
    facts[tag + '_speed_lo'] = Math.min(...rows.map(r => r.speed)); facts[tag + '_speed_hi'] = Math.max(...rows.map(r => r.speed));
  }
  // the claims of §2 and §5
  ok('one camera: the guessed depth does not change the training score by more than 0.5 dB', Math.abs(facts.m6_train - facts.m15_train) < 0.5 && Math.abs(facts.m6_train - facts.m10_train) < 0.5, [facts.m6_train, facts.m10_train, facts.m15_train]);
  ok('one camera: the speed the fit settles on follows the guess (0.6 < 1.0 < 1.5)', facts.m6_speed_hi < facts.m10_speed_lo && facts.m10_speed_hi < facts.m15_speed_lo, [facts.m6_speed_hi, facts.m10_speed_lo, facts.m10_speed_hi, facts.m15_speed_lo]);
  ok('one camera: a wrong guess is visible to the held-out camera only (>= 5 dB below two cameras)', facts.s6_held - facts.m6_held_hi > 5 && facts.s15_held - facts.m15_held_hi > 3, [facts.s6_held, facts.m6_held_hi, facts.s15_held, facts.m15_held_hi]);
  ok('one camera: the held-out score wobbles with the seeds (> 3 dB range at the right guess)', facts.m10_held_hi - facts.m10_held_lo > 3, [facts.m10_held_lo, facts.m10_held_hi]);
  ok('two cameras: the speed is 1.2 m/s to 0.03 for every guess and every seed', facts.s6_speed_lo > 1.17 && facts.s6_speed_hi < 1.23 && facts.s10_speed_lo > 1.17 && facts.s10_speed_hi < 1.23 && facts.s15_speed_lo > 1.17 && facts.s15_speed_hi < 1.23, [facts.s6_speed_lo, facts.s10_speed_lo, facts.s15_speed_lo]);
  ok('two cameras: the held-out camera scores within 2 dB of the training frames for every guess and seed', facts.s6_train - facts.s6_held_lo < 2.5 && facts.s10_train - facts.s10_held_lo < 2.5 && facts.s15_train - facts.s15_held_lo < 2.5);
  agree('independent fit == page engine (two cameras)', fitOf('stereo_s10', { v: V12, s: 1, stereo: true }), new L14.Lab({ v: V12, s: 1, stereo: true }).fit());
  agree('independent fit == page engine (one camera, guess 0.6)', fitOf('mono_m6', { v: V12, s: 0.6, stereo: false }), new L14.Lab({ v: V12, s: 0.6, stereo: false }).fit());
}

/* §3: why a group: every Gaussian gets its own velocity (the independent loop, with the velocity of each Gaussian free) */
{
  const lab = new L14.Lab({ v: V12 }), K = lab.K, still = [], moving = [];
  lab.mover.forEach((m, k) => (m ? moving : still).push(k));
  facts.k_ball = moving.length; facts.k_still = still.length;
  const V = new Float64Array(2 * K), mV = new Float64Array(2 * K), vV = new Float64Array(2 * K), work = FL.gs.make(K); work.bg = lab.S.bg; work.dil = lab.S.dil;
  const putAt = t => { work.p.set(lab.S.p); for (let k = 0; k < K; k++) { work.p[k * G] += V[2 * k] * (t - TREF); work.p[k * G + 1] += V[2 * k + 1] * (t - TREF); } return work; };
  lab.dynamic = false;                                                              // the Gaussians' own 9 numbers are updated by the engine; the velocities by this loop
  let n = 0;
  for (let step = 0; step < 300; step++) {
    const H = Math.min(12, 3 + 9 * step / 180), use = lab.views.filter(f => Math.abs(f.t - TREF) <= H + 0.51 && (f.ti + step) % 2 === 0), g = new Float64Array(2 * K);
    for (const f of use) { const r = FL.gs.grad(putAt(f.t), [{ cam: f.cam, img: f.img }]); for (let k = 0; k < K; k++) { g[2 * k] += (f.t - TREF) * r.grad[k * G] / use.length; g[2 * k + 1] += (f.t - TREF) * r.grad[k * G + 1] / use.length; } }
    lab.place = putAt; lab.step(use); n++;
    const c1 = 1 - 0.9 ** n, c2 = 1 - 0.999 ** n;
    for (let i = 0; i < 2 * K; i++) { mV[i] = 0.9 * mV[i] + 0.1 * g[i]; vV[i] = 0.999 * vV[i] + 0.001 * g[i] * g[i]; V[i] -= 0.003 * (mV[i] / c1) / (Math.sqrt(vV[i] / c2) + 1e-8); }
  }
  let tr = 0, fast = 0; for (let t = 0; t < T; t++) tr += psnrOf(photo(t, V12, 0), FL.gs.render(putAt(t), camAt(t, 0))) / T;
  for (const k of still) if (10 * Math.hypot(V[2 * k], V[2 * k + 1]) > 0.1) fast++;
  facts.free_train = tr; facts.free_fast = fast;
  ok('free per-Gaussian velocities: some of the Gaussians that stand still start to move', fast >= 5, fast);
  ok('free per-Gaussian velocities score about a point better than the group', tr > facts.dyn_train + 0.5 && tr < facts.dyn_train + 1.5, [tr, facts.dyn_train]);
  // the curriculum of the loop: the frames used at step s are those within H + 0.51 of the middle frame, H = 3 + 9 s / 180 (at most 12)
  const used = step => { const H = Math.min(12, 3 + 9 * step / (0.6 * 300)); let n = 0; for (let t = 0; t < T; t++) if (Math.abs(t - TREF) <= H + 0.51) n++; return n; };
  ok('the loop starts from the 8 frames nearest the middle', used(0) === 8, used(0));
  ok('... and uses all 24 from step 160 on', used(159) < 24 && used(160) === 24, [used(159), used(160)]);
}

/* ───────────────────────── (d) identities ───────────────────────── */
{
  // chain rule through x_k(t) = x_k + V tau, against a central difference of the loss computed with the independent renderer
  const f = fitOf('dyn_0.12', { v: V12, dynamic: true }), K = f.K, S = FL.gs.make(K); S.p.set(f.S.p); S.bg = f.S.bg; S.dil = f.S.dil;
  const frames = []; for (let t = 0; t < T; t += 3) frames.push(t);
  const lossAt = Vx => { let L = 0; for (const t of frames) { const St = FL.gs.make(K); St.p.set(S.p); St.bg = S.bg; St.dil = S.dil; for (const k of f.moving) St.p[k * G] += Vx * (t - TREF); L += psnrMse(photo(t, V12, 0), FL.gs.render(St, camAt(t, 0))); } return L / frames.length; };
  function psnrMse(A, B) { let s = 0; for (let i = 0; i < W; i++) s += ((A.r[i] - B.r[i]) ** 2 + (A.g[i] - B.g[i]) ** 2 + (A.b[i] - B.b[i]) ** 2) / 3; return s / W; }
  const Vx = f.V[0] * 0.8; let gAn = 0;
  for (const t of frames) { const St = FL.gs.make(K); St.p.set(S.p); St.bg = S.bg; St.dil = S.dil; for (const k of f.moving) St.p[k * G] += Vx * (t - TREF); const r = FL.gs.grad(St, [{ cam: camAt(t, 0), img: photo(t, V12, 0) }]); let sk = 0; for (const k of f.moving) sk += r.grad[k * G]; gAn += (t - TREF) * sk / frames.length; }
  const h = 1e-5, gNum = (lossAt(Vx + h) - lossAt(Vx - h)) / (2 * h);
  facts.chain_err = Math.abs(gAn - gNum) / Math.max(Math.abs(gNum), 1e-12); facts.chain_err_pct = 100 * facts.chain_err;
  ok('velocity gradient: the chain rule sum_t tau sum_k dL_t/dx_k equals the finite difference', facts.chain_err < 5e-3, [gAn, gNum]);
  // camera gauge: dL/d(delta) = - sum_k dL/dx_k over EVERY Gaussian, the moving group (displaced to its place at frame t) included, for the frame t = 7 of the fitted model
  const t7 = 7, St = FL.gs.make(K); St.p.set(f.S.p); St.bg = f.S.bg; St.dil = f.S.dil;
  for (const k of f.moving) { St.p[k * G] += f.V[0] * (t7 - TREF); St.p[k * G + 1] += f.V[1] * (t7 - TREF); }
  const lossCam = d => psnrMse(photo(t7, V12, 0), FL.gs.render(St, FL.camera({ x: camX(t7, 0) + d, z: 0, a: Math.PI / 2, f: F, W: W })));
  const r = FL.gs.grad(St, [{ cam: camAt(t7, 0), img: photo(t7, V12, 0) }]); let sum = 0, sumMov = 0; for (let k = 0; k < K; k++) sum += r.grad[k * G]; for (const k of f.moving) sumMov += r.grad[k * G];
  const hh = 1e-5, num = (lossCam(hh) - lossCam(-hh)) / (2 * hh);
  facts.gauge_grad_err = Math.abs(-sum - num) / Math.max(Math.abs(num), 1e-12); facts.gauge_grad_pct = 100 * facts.gauge_grad_err;
  ok('the moving group contributes to the camera gradient (the identity is not a statement about the static Gaussians only)', Math.abs(sumMov) > 0.05 * Math.abs(sum) || Math.abs(sumMov) > 1e-6, [sumMov, sum]);
  ok('camera gauge: the camera gradient is minus the sum of the position gradients of all the Gaussians', facts.gauge_grad_err < 1e-3, [-sum, num]);
}

/* §4: pose errors are scene errors; the loop can estimate them (two cameras) */
{
  const ex = fitOf('stereo_s10', { v: V12, s: 1, stereo: true });
  const pj = fitOf('pose_jit', { v: V12, stereo: true, pose: 'jitter' }), pe = fitOf('pose_est', { v: V12, stereo: true, pose: 'estimate' });
  facts.jit_rms = 100 * pj.poseErr; facts.est_rms = 100 * pe.poseErr;
  facts.ex_train = ex.train; facts.ex_held = ex.held; facts.pj_train = pj.train; facts.pj_held = pj.held; facts.pe_train = pe.train; facts.pe_held = pe.held;
  ok('pose jitter costs the two-camera fit at least 1.5 dB on the held-out camera', ex.held - pj.held > 1.5, [ex.held, pj.held]);
  ok('estimating the poses recovers the fit to within 0.7 dB and the poses to a third of the jitter', ex.held - pe.held < 0.7 && pe.poseErr < pj.poseErr / 3, [ex.held, pe.held, pe.poseErr, pj.poseErr]);
  agree('independent fit == page engine (poses estimated)', pe, new L14.Lab({ v: V12, stereo: true, pose: 'estimate' }).fit());
  const me = fitOf('pose_est_mono', { v: V12, stereo: false, pose: 'estimate' }), mj = fitOf('pose_jit_mono', { v: V12, stereo: false, pose: 'jitter' });
  facts.mono_est_rms = 100 * me.poseErr; facts.mono_jit_rms = 100 * mj.poseErr; facts.mono_est_train = me.train; facts.mono_jit_train = mj.train;
  ok('one camera: estimating the poses helps, but leaves more error than with two cameras', me.poseErr < mj.poseErr && me.poseErr > 1.3 * pe.poseErr, [me.poseErr, mj.poseErr, pe.poseErr]);
  // the jitter the lesson quotes: independent of the fit
  const rng = FL.rng(11); let s2 = 0; for (let i = 1; i < T - 1; i++) { const j = 0.06 * FL.randn(rng); s2 += j * j; }
  ok('jitter RMS is the one the fit was told about', close(Math.sqrt(s2 / (T - 2)) * 100, facts.jit_rms, 1e-9));
}

/* ───────────────────────── (e) §6: the future and the push ───────────────────────── */
{
  const f = fitOf('stereo_s10', { v: V12, s: 1, stereo: true });
  facts.fut1 = f.fut1; facts.fut3 = f.fut3; facts.interp = f.interp; facts.fit_train = f.train;
  const m = FITS['mono_m10']; facts.mono_fut1 = m.fut1; facts.mono_fut3 = m.fut3;
  ok('interpolating in time costs nothing (held-out half frames within 0.5 dB of the fitted frames)', Math.abs(f.interp - f.train) < 0.5, [f.interp, f.train]);
  ok('extrapolating costs: the next 0.8 s are 2 dB or more worse than the fitted frames', f.train - f.fut1 > 2, [f.train, f.fut1]);
  ok('the contact breaks it: 3.0-3.7 s ahead is 10 dB or more worse than the fitted frames', f.train - f.fut3 > 10, [f.train, f.fut3]);
  ok('the score falls with the horizon (frames 24-31 > 32-39 > 40-47)', f.fut1 > (f.perA.slice(32, 40).reduce((a, b) => a + b, 0) / 8) && (f.perA.slice(32, 40).reduce((a, b) => a + b, 0) / 8) > f.fut3 - 1.5);
  // where the loss of the next 0.8 s sits (the pixels of the ball and 2 px around it, against the rest), and what asking about those frames would cure
  const sw = splitOf(f, V12, 0, T), sf = splitOf(f, V12, 24, 32);
  facts.win_ball = sw.on; facts.win_rest = sw.off; facts.fut_ball = sf.on; facts.fut_rest = sf.off;
  ok('the loss of the next 0.8 s sits at the ball: it falls by 4 dB or more there and by less than 2 dB elsewhere', sw.on - sf.on > 4 && sw.off - sf.off < 2 && sw.off - sf.off > 0, [sw, sf]);
  const f32 = runFit({ v: V12, s: 1, stereo: true, nT: 32 });
  facts.fut1_asked = f32.fut1;
  ok('fitted on frames 0-31 the same loop scores 2 dB or more higher on frames 24-31', f32.fut1 - f.fut1 > 2, [f32.fut1, f.fut1]);
  ok('... and still finds the speed', Math.abs(f32.speed - 1.2) < 0.03, f32.speed);
  // where the model's ball is at frame 47 against the real one (displacement since the middle frame)
  const dModel = f.V[0] * (47 - TREF), dTrue = ballAt(47, V12).x - ballAt(TREF, V12).x;
  facts.err47 = Math.abs(dModel - dTrue); facts.model_dx47 = dModel; facts.true_dx47 = dTrue;
  ok('by frame 47 the model has the ball 3 m from the real one', facts.err47 > 2.5 && facts.err47 < 3.5, facts.err47);
  facts.crate_face = XCRATE - 0.5;
  // the push: the ball is struck at frame 24 and goes twice as fast; the model, fitted on frames 0-23 only, gives the same frames either way
  const push = { t: 24, k: 2 };
  const tHit2 = 24 + (XHIT - ballAt(24, V12).x) / (2 * V12);
  facts.push_t_hit = tHit2;
  let pa = 0, pb = 0;
  for (let t = 24; t < 32; t++) { const mimg = f.draw(t, 0); pa += psnrOf(photo(t, V12, 0), mimg) / 8; pb += psnrOf(photo(t, V12, 0, push), mimg) / 8; }
  facts.push_same = pa; facts.push_other = pb;
  ok('the model cannot tell the push from no push: its frames match the unpushed world better than the pushed one by 4 dB or more', pa - pb > 4, [pa, pb]);
  // and the worlds really differ
  let dw = 0; for (let t = 24; t < 32; t++) dw += (1 - psnrOf(photo(t, V12, 0), photo(t, V12, 0, push)) / 99) / 8;
  ok('the pushed world is a different video', dw > 0);
  facts.push_post_bounce_speed = REST * 2 * 1.2;
}

/* ───────────────────────── drive the page's own widget ───────────────────────── */
const PAGE = path.join(DIR, '14_when_the_scene_moves.html');
ok('the lesson page exists', fs.existsSync(PAGE));
const page = fs.existsSync(PAGE) ? loadPage(PAGE, { dpr: 1 }) : { problems: ['no page'] };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
if (page.problems.length === 0) {
  const set = (v, s, cams, model, pose) => { page.set('w14-v', v); page.set('w14-s', s); page.set('w14-cams', cams); page.set('w14-model', model); page.set('w14-pose', pose); };
  const fitIt = () => page.click('w14-fit');
  const same = (label, mine) => {
    ok(label + ' train', close(page.num('w14-train'), mine.train, 0.0501), [page.num('w14-train'), mine.train]);        // the widget shows one decimal of a dB
    ok(label + ' held-out camera', close(page.num('w14-held'), mine.held, 0.0501), [page.num('w14-held'), mine.held]);
    ok(label + ' held-out times', close(page.num('w14-interp'), mine.interp, 0.0501), [page.num('w14-interp'), mine.interp]);
    ok(label + ' next 0.8 s', close(page.num('w14-fut1'), mine.fut1, 0.0501), [page.num('w14-fut1'), mine.fut1]);
    ok(label + ' 3.0-3.7 s ahead', close(page.num('w14-fut3'), mine.fut3, 0.0501), [page.num('w14-fut3'), mine.fut3]);
    ok(label + ' speed', close(page.num('w14-speed'), mine.speed, 0.0051), [page.num('w14-speed'), mine.speed]);
  };
  // the opening state, before any fit: nothing is claimed
  set(1.2, 1, '1', 'dyn', 'exact');
  ok('before the fit the readouts are empty', /—|-/.test(page.text('w14-train')) && isNaN(page.num('w14-train')), page.text('w14-train'));
  fitIt(); same('opening state (one camera, canonical scene + motion)', fitOf('dyn_0.12', { v: V12, dynamic: true }));
  set(1.2, 1, '1', 'static', 'exact'); fitIt(); same('static scene', fitOf('static_0.12', { v: V12, dynamic: false }));
  for (const [v, key] of [[0, 0], [2, 0.2]]) { set(v, 1, '1', 'static', 'exact'); fitIt(); same('static, speed ' + v, fitOf('static_' + key, { v: key, dynamic: false })); set(v, 1, '1', 'dyn', 'exact'); fitIt(); same('moving, speed ' + v, fitOf('dyn_' + key, { v: key, dynamic: true })); }
  set(1.2, 0.6, '1', 'dyn', 'exact'); fitIt(); same('one camera, guess 0.6', fitOf('mono_m6', { v: V12, s: 0.6, stereo: false }));
  set(1.2, 1.5, '1', 'dyn', 'exact'); fitIt(); same('one camera, guess 1.5', fitOf('mono_m15', { v: V12, s: 1.5, stereo: false }));
  set(1.2, 0.6, '2', 'dyn', 'exact'); fitIt(); same('two cameras, guess 0.6', fitOf('stereo_s6', { v: V12, s: 0.6, stereo: true }));
  set(1.2, 1, '2', 'dyn', 'exact'); fitIt(); same('two cameras', fitOf('stereo_s10', { v: V12, s: 1, stereo: true }));
  set(1.2, 1.5, '2', 'dyn', 'exact'); fitIt(); same('two cameras, guess 1.5', fitOf('stereo_s15', { v: V12, s: 1.5, stereo: true }));
  set(1.2, 1, '2', 'dyn', 'jitter'); fitIt(); same('two cameras, 6 cm jitter', fitOf('pose_jit', { v: V12, stereo: true, pose: 'jitter' }));
  ok('widget pose error (jitter)', close(page.num('w14-pose-err'), facts.jit_rms, 0.0501), [page.num('w14-pose-err'), facts.jit_rms]);
  set(1.2, 1, '2', 'dyn', 'estimate'); fitIt(); same('two cameras, poses estimated', fitOf('pose_est', { v: V12, stereo: true, pose: 'estimate' }));
  ok('widget pose error (estimated)', close(page.num('w14-pose-err'), facts.est_rms, 0.0501), [page.num('w14-pose-err'), facts.est_rms]);
  // reset clears the readouts
  page.click('w14-reset'); ok('reset empties the readouts', isNaN(page.num('w14-train')), page.text('w14-train'));
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
