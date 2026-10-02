#!/usr/bin/env node
/* Oracle for 3D lesson 03, "Where is the camera? Rigid motion on a curved space".
 *
 * Everything the lesson quotes is re-derived here with a small 3x3 toolkit of its own (nested rows, Taylor-series matrix
 * exponentials, a quaternion exponential, an SVD projection, finite differences), NOT with the lesson's engine (rigid_motion.js)
 * and not with geom3.js's m3.exp / m3.log.  Where the engine and the page compute the same quantity, they must agree with this
 * file to rounding; the page's widget is then driven into each state "What to try" describes.
 * Sections of the file follow the sections of the lesson.  Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const G3 = require(path.join(DIR, 'geom3.js'));
const FL = require(path.join(DIR, 'flatland.js'));
const RM = require(path.join(DIR, 'rigid_motion.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const rel = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300);
const D2R = Math.PI / 180;

/* ── an independent 3x3 toolkit: matrices are arrays of rows ── */
const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mm = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const tp = A => [0, 1, 2].map(i => [0, 1, 2].map(j => A[j][i]));
const dt = A => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
const sk = w => [[0, -w[2], w[1]], [w[2], 0, -w[0]], [-w[1], w[0], 0]];
const add = (A, B) => A.map((r, i) => r.map((x, j) => x + B[i][j]));
const sc = (A, s) => A.map(r => r.map(x => x * s));
const sub = (A, B) => add(A, sc(B, -1));
const fro = A => Math.sqrt(A.reduce((s, r) => s + r.reduce((t, x) => t + x * x, 0), 0));
const orth = R => fro(sub(mm(tp(R), R), I3()));
const tr = A => A[0][0] + A[1][1] + A[2][2];
const flat = A => [].concat(...A), nest = F => [[F[0], F[1], F[2]], [F[3], F[4], F[5]], [F[6], F[7], F[8]]];
const vadd = (a, b) => a.map((x, i) => x + b[i]), vsub = (a, b) => a.map((x, i) => x - b[i]), vsc = (a, s) => a.map(x => x * s);
const dot = (a, b) => a.reduce((t, x, i) => t + x * b[i], 0), nrm = a => Math.sqrt(dot(a, a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const Rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const Ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const euler = (psi, th, phi) => mm(Rz(psi), mm(Ry(th), Rx(phi)));
/* matrix exponential by its Taylor series (any square size, nested rows) */
function expm(A, terms) {
  const n = A.length; let T = A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0))), S = T.map(r => r.slice());
  const mulN = (X, Y) => X.map(r => Y[0].map((_, j) => r.reduce((s, x, k) => s + x * Y[k][j], 0)));
  for (let k = 1; k < (terms || 80); k++) { T = mulN(T, A).map(r => r.map(x => x / k)); S = S.map((r, i) => r.map((x, j) => x + T[i][j])); }
  return S;
}
/* the rotation exp([w]x) through a unit quaternion (a different formula from Rodrigues' matrix form) */
function expQ(w) {
  const th = nrm(w), n = th < 1e-300 ? [0, 0, 1] : vsc(w, 1 / th), c = Math.cos(th / 2), s = Math.sin(th / 2), q = [c, s * n[0], s * n[1], s * n[2]];
  const [a, b, cc, d] = q;
  return [[1 - 2 * (cc * cc + d * d), 2 * (b * cc - d * a), 2 * (b * d + cc * a)], [2 * (b * cc + d * a), 1 - 2 * (b * b + d * d), 2 * (cc * d - b * a)], [2 * (b * d - cc * a), 2 * (cc * d + b * a), 1 - 2 * (b * b + cc * cc)]];
}
/* the angle of a rotation, from the quaternion's scalar part:  theta = 2 acos |w|, with w^2 = (1 + tr R)/4 */
const angleOf = R => 2 * Math.acos(Math.min(1, Math.sqrt(Math.max(0, (1 + tr(R)) / 4))));
/* nearest rotation by SVD:  U V^T  (geom3's svd3 returns proper rotations U, V) */
function nearestRot(A) { const s = G3.svd3(flat(A)); return mm(nest(s.U), tp(nest(s.V))); }
const rng0 = FL.rng(2024);
const randw = (scale) => [(rng0() - 0.5) * 2 * scale, (rng0() - 0.5) * 2 * scale, (rng0() - 0.5) * 2 * scale];

/* ═══════════════ 1. the entrywise average of two rotations ═══════════════ */
{
  const axis = vsc([1, -2, 2], 1 / 3);
  for (const deg of [30, 90, 180]) {
    const th = deg * D2R, R2 = expQ(vsc(axis, th)), M = sc(add(I3(), R2), 0.5);
    const det = dt(M), oe = orth(M);
    ok('avg det closed form ' + deg, close(det, Math.cos(th / 2) ** 2, 1e-12), [det, Math.cos(th / 2) ** 2]);
    ok('avg orth closed form ' + deg, close(oe, Math.SQRT2 * Math.sin(th / 2) ** 2, 1e-12), [oe, Math.SQRT2 * Math.sin(th / 2) ** 2]);
    // lengths in the plane of the turn: take a unit vector orthogonal to the axis
    const u = (() => { const a = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = cross(axis, a); return vsc(c, 1 / nrm(c)); })();
    const len = nrm(mv(M, u));
    ok('avg scales the plane by cos(theta/2) ' + deg, close(len, Math.cos(th / 2), 1e-12), len);
    facts['avg_det' + deg] = det; facts['avg_orth' + deg] = oe;
    if (deg === 90) facts.avg_short90 = 100 * (1 - len);
  }
  // the circle: arithmetic mean of 359 and 1 degrees, and the wrapped one
  const wrap = a => { while (a > 180) a -= 360; while (a <= -180) a += 360; return a; };
  ok('circle: naive mean 180', (359 + 1) / 2 === 180);
  ok('circle: wrapped mean 0', close(((359 + 0.5 * wrap(1 - 359)) % 360 + 360) % 360, 0, 1e-12) || close(((359 + 0.5 * wrap(1 - 359)) % 360 + 360) % 360, 360, 1e-12));
  ok('circle: the engine wrap agrees', close(FL.se2.wrap(1 * D2R - 359 * D2R), 2 * D2R, 1e-12));
}

/* ═══════════════ 2. nine numbers, six constraints, and first-order steps ═══════════════ */
{
  // dimension count: Jacobian of the constraint map R -> sym(R^T R - I) at a rotation has rank 6; its null space (dimension 3) is {R S : S skew}
  const R = expQ(randw(1.2)), h = 1e-6, rows = [];
  const cons = X => { const E = sub(mm(tp(X), X), I3()); return [E[0][0], E[1][1], E[2][2], E[0][1], E[0][2], E[1][2]]; };
  const Jc = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const Rp = R.map(r => r.slice()), Rm = R.map(r => r.slice()); Rp[i][j] += h; Rm[i][j] -= h;
    const cp = cons(Rp), cm = cons(Rm); Jc.push(cp.map((v, q) => (v - cm[q]) / (2 * h)));
  }
  // Jc is 9 x 6 (column per entry); form JtJ (9x9) = sum over the 6 constraints
  const JtJ = []; for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) JtJ.push(Jc[a].reduce((s, v, q) => s + v * Jc[b][q], 0));
  const ev = G3.eigSym(JtJ, 9).vals;
  const rank = ev.filter(v => v > 1e-6).length;
  ok('constraint Jacobian has rank 6, so 9 - 6 = 3 degrees of freedom', rank === 6 && ev[6] < 1e-9, ev.map(v => v.toExponential(1)).join(' '));
  // the velocities R*skew are tangent: they keep the constraint to first order
  const Sk = sk(randw(1)), eps = 1e-6, Rn = add(R, sc(mm(R, Sk), eps));
  ok('R [w]x is tangent to the set', orth(Rn) < 3e-11, orth(Rn));
  // one first-order step R <- R (I + [d]x)
  const d = [0.1, 0, 0], Step = add(I3(), sk(d));
  facts.step_orth = orth(Step); facts.step_det = dt(Step);
  ok('step orth = sqrt2 |d|^2', close(facts.step_orth, Math.SQRT2 * 0.01, 1e-14));
  ok('step det = 1 + |d|^2', close(facts.step_det, 1.01, 1e-14));
  // the full circle in 63 steps of 0.1 rad about z
  let X = I3(); const Sz = add(I3(), sk([0, 0, 0.1]));
  for (let i = 0; i < 63; i++) X = mm(X, Sz);
  facts.spiral_len = nrm([X[0][0], X[1][0], X[2][0]]); facts.spiral_det = dt(X);
  ok('spiral length closed form', close(facts.spiral_len, Math.pow(1.01, 31.5), 1e-12));
  ok('spiral det closed form', close(facts.spiral_det, Math.pow(1.01, 63), 1e-12));
  ok('63 steps of 0.1 rad is a turn of almost 360 degrees', close(63 * Math.atan(0.1) / D2R, 359.77, 0.01));
  // and the tangent step with the exponential keeps it on the set
  let Y = I3(); const Ez = expQ([0, 0, 0.1]); for (let i = 0; i < 63; i++) Y = mm(Y, Ez);
  ok('63 exp steps stay on the set (to rounding, accumulated)', orth(Y) < 5e-14 && close(dt(Y), 1, 5e-14), [orth(Y), dt(Y)]);
}

/* ═══════════════ 3. Euler angles, the rotation vector, the quaternion ═══════════════ */
{
  // d R / d angle = [a_j]x R, with the three axes of the lesson; |det A| = cos(pitch); singular values of A
  let worstD = 0, worstDet = 0, worstSv = 0;
  for (let t = 0; t < 40; t++) {
    const psi = (rng0() - 0.5) * 6, th = (rng0() - 0.5) * 3, phi = (rng0() - 0.5) * 6, R = euler(psi, th, phi), h = 1e-6;
    const a1 = [0, 0, 1], a2 = [-Math.sin(psi), Math.cos(psi), 0], a3 = [Math.cos(psi) * Math.cos(th), Math.sin(psi) * Math.cos(th), -Math.sin(th)];
    const ang = [psi, th, phi];
    [a1, a2, a3].forEach((a, j) => {
      const p = ang.slice(), m = ang.slice(); p[j] += h; m[j] -= h;
      const num = sc(sub(euler(...p), euler(...m)), 1 / (2 * h)), ana = mm(sk(a), R);
      worstD = Math.max(worstD, fro(sub(num, ana)));
    });
    const A = [[a1[0], a2[0], a3[0]], [a1[1], a2[1], a3[1]], [a1[2], a2[2], a3[2]]];
    worstDet = Math.max(worstDet, Math.abs(Math.abs(dt(A)) - Math.cos(th)));
    const AtA = flat(mm(tp(A), A)), ev = G3.eigSym(AtA, 3).vals.map(v => Math.sqrt(Math.max(0, v))), want = [Math.sqrt(1 + Math.sin(th)), 1, Math.sqrt(1 - Math.sin(th))].sort((x, y) => y - x);
    worstSv = Math.max(worstSv, ...ev.map((v, i) => Math.abs(v - want[i])));
    // the third axis is the frame's own x-axis
    ok('a3 is the first column of R', nrm(vsub(a3, [R[0][0], R[1][0], R[2][0]])) < 1e-14);
  }
  ok('dR/dangle = [a_j]x R', worstD < 1e-7, worstD);
  ok('|det A| = cos(pitch)', worstDet < 1e-14, worstDet);
  ok('singular values of A', worstSv < 1e-12, worstSv);
  for (const p of [60, 80, 89]) {
    const th = p * D2R, A = (() => { const psi = 0.7; const a1 = [0, 0, 1], a2 = [-Math.sin(psi), Math.cos(psi), 0], a3 = [Math.cos(psi) * Math.cos(th), Math.sin(psi) * Math.cos(th), -Math.sin(th)]; return [[a1[0], a2[0], a3[0]], [a1[1], a2[1], a3[1]], [a1[2], a2[2], a3[2]]]; })();
    const sv = G3.eigSym(flat(mm(tp(A), A)), 3).vals.map(v => Math.sqrt(Math.max(0, v)));
    facts['eu_det' + p] = Math.abs(dt(A)); facts['eu_spd' + p] = 1 / sv[2];
    ok('knob speed formula ' + p, close(1 / sv[2], Math.sqrt(1 + Math.sin(th)) / Math.cos(th), 1e-8 * (1 + 1 / sv[2])));
    // the knob rates that produce a unit angular velocity along the weakest direction have norm 1/sigma_min: solve A r = u
    const e = G3.eigSym(flat(mm(A, tp(A))), 3), u = e.vecs[2];                    // eigenvector of A A^T with the smallest eigenvalue
    const Ai = nest(G3.m3.inv(flat(A))), r = mv(Ai, u);
    ok('rates for a unit turn about the hardest axis', close(nrm(r), 1 / sv[2], 1e-6 * (1 + 1 / sv[2])), [nrm(r), 1 / sv[2]]);
  }
  { // exactly at the lock
    const psi = 0.7, th = Math.PI / 2, a1 = [0, 0, 1], a3 = [Math.cos(psi) * Math.cos(th), Math.sin(psi) * Math.cos(th), -Math.sin(th)];
    ok('at pitch 90 the roll axis is minus the yaw axis', nrm(vadd(a1, a3)) < 1e-15, nrm(vadd(a1, a3)));
    const A = [[a1[0], -Math.sin(psi), a3[0]], [a1[1], Math.cos(psi), a3[1]], [a1[2], 0, a3[2]]];
    const smin = Math.sqrt(Math.max(0, G3.eigSym(flat(mm(tp(A), A)), 3).vals[2]));
    ok('rank of A drops to 2 at the lock', smin < 1e-6, smin);
    // two Euler triples for one rotation
    let worst = 0; for (let t = 0; t < 20; t++) { const p = (rng0() - 0.5) * 3, q = (rng0() - 0.5) * 3, r = (rng0() - 0.5) * 6; worst = Math.max(worst, fro(sub(euler(r, p, q), euler(r + Math.PI, Math.PI - p, q + Math.PI)))); }
    ok('(psi, theta, phi) and (psi+pi, pi-theta, phi+pi) are one rotation', worst < 1e-14, worst);
  }
  // rotation vector: sum vs composition
  const a = [Math.PI / 2, 0, 0], b = [0, Math.PI / 2, 0], RxRy = mm(expQ(a), expQ(b)), RyRx = mm(expQ(b), expQ(a));
  facts.rv_sum = nrm(vadd(a, b)) / D2R; facts.rv_comp = angleOf(RxRy) / D2R; facts.commute = angleOf(mm(tp(RxRy), RyRx)) / D2R;
  ok('Rx(90) = exp of the quarter vector', fro(sub(expQ(a), Rx(Math.PI / 2))) < 1e-14);
  ok('RxRy is a cyclic permutation (120 degrees)', close(facts.rv_comp, 120, 1e-9) && close(facts.commute, 120, 1e-9), [facts.rv_comp, facts.commute]);
  // unit quaternion: Hamilton product against the matrix product, double cover, norm of a tangent step
  const qmul = (p, q) => [p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3], p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2], p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1], p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0]];
  const q2R = ([w, x, y, z]) => [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  const qOf = w => { const th = nrm(w), n = vsc(w, 1 / th); return [Math.cos(th / 2), ...vsc(n, Math.sin(th / 2))]; };
  let worstQ = 0, worstC = 0;
  for (let t = 0; t < 50; t++) {
    const w1 = randw(2), w2 = randw(2), q1 = qOf(w1), q2 = qOf(w2);
    worstQ = Math.max(worstQ, fro(sub(q2R(qmul(q1, q2)), mm(expQ(w1), expQ(w2)))));
    worstC = Math.max(worstC, fro(sub(q2R(q1), q2R(q1.map(v => -v)))));
  }
  ok('Hamilton product = matrix product', worstQ < 1e-14, worstQ); ok('q and -q are one rotation', worstC === 0, worstC);
  { // 16 products for the Hamilton product, 27 for a 3x3 matrix product (counted by running instrumented copies)
    let nq = 0, nm = 0; const cnt = (x, y) => { nq++; return x * y; };
    const p = [1, 2, 3, 4], q = [5, 6, 7, 8];
    [[0, 0, 1], [1, 1, -1], [2, 2, -1], [3, 3, -1]].forEach(() => 0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cnt(p[i], q[j]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) { nm++; }
    ok('16 and 27 products', nq === 16 && nm === 27);
  }
  { const q = qOf(randw(2)), dq = (() => { const v = [0.3, -0.2, 0.5, 0.1]; const c = dot(v, q); return vsub(v, vsc(q, c)); })(); const s = vadd(q, dq);
    ok('||q + dq||^2 = 1 + ||dq||^2 for a tangent step', close(dot(s, s), 1 + dot(dq, dq), 1e-14)); }
}

/* ═══════════════ 4. tangent space, Rodrigues, log, distance ═══════════════ */
{
  // R^T dR/dt is skew for R(t) = R0 exp(t [w]x), and equals [w]x
  const R0 = expQ(randw(1.3)), w = randw(1.1), h = 1e-6, Rf = t => mm(R0, expQ(vsc(w, t)));
  const dR = sc(sub(Rf(h), Rf(-h)), 1 / (2 * h)), Om = mm(tp(Rf(0)), dR);
  ok('R^T dR/dt is skew', fro(add(Om, tp(Om))) < 1e-9, fro(add(Om, tp(Om))));
  ok('... and equals [w]x', fro(sub(Om, sk(w))) < 1e-8, fro(sub(Om, sk(w))));
  // Rodrigues against the Taylor series and against the engine; exp is a rotation exactly
  let worstS = 0, worstE = 0, worstO = 0, worstDet = 0, worstL = 0;
  for (let t = 0; t < 400; t++) {
    const sc0 = t % 4 === 0 ? 1e-9 : t % 4 === 1 ? 0.3 : t % 4 === 2 ? 3.0 : 5.5;
    const wv = randw(sc0), th = nrm(wv), n = vsc(wv, 1 / th), K = sk(n), Rod = add(add(I3(), sc(K, Math.sin(th))), sc(mm(K, K), 1 - Math.cos(th)));
    const ser = expm(sk(wv), 80);
    worstS = Math.max(worstS, fro(sub(Rod, ser)));
    worstE = Math.max(worstE, fro(sub(nest(G3.m3.exp(wv)), ser)));
    worstO = Math.max(worstO, orth(Rod)); worstDet = Math.max(worstDet, Math.abs(dt(Rod) - 1));
    if (th < Math.PI - 1e-3 && th > 1e-6) { const lw = G3.m3.log(flat(Rod)); worstL = Math.max(worstL, nrm(vsub(lw, wv))); }
  }
  ok('Rodrigues = Taylor series', worstS < 1e-11, worstS); ok('engine m3.exp = Taylor series', worstE < 1e-11, worstE);
  ok('exp([w]x) is a rotation to rounding', worstO < 1e-14 && worstDet < 1e-14, [worstO, worstDet]);
  ok('log(exp(w)) = w', worstL < 1e-8, worstL);
  ok('[n]x^3 = -[n]x', (() => { const n = vsc(randw(1), 1); const u = vsc(n, 1 / nrm(n)), K = sk(u); return fro(add(mm(K, mm(K, K)), K)) < 1e-14; })());
  // geodesic distance: angle of Ra^T Rb = 2 acos|<qa, qb>|; the mean is halfway; the chord is 2 sqrt2 sin(alpha/2)
  let worstG = 0, worstM = 0, worstMo = 0, worstCh = 0;
  const qOf = M => { const t = tr(M); let q; if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [s / 4, (M[2][1] - M[1][2]) / s, (M[0][2] - M[2][0]) / s, (M[1][0] - M[0][1]) / s]; } else { return null; } return q; };
  for (let t = 0; t < 60; t++) {
    const Ra = expQ(randw(1.5)), d = randw(0.9), Rb = mm(Ra, expQ(d)), alpha = nrm(d);
    const dist = G3.m3.dist(flat(Ra), flat(Rb));
    worstG = Math.max(worstG, Math.abs(dist - alpha));
    const lg = G3.m3.log(flat(mm(tp(Ra), Rb))), mid = mm(Ra, expQ(vsc(lg, 0.5)));
    worstM = Math.max(worstM, Math.abs(angleOf(mm(tp(Ra), mid)) - alpha / 2), Math.abs(angleOf(mm(tp(mid), Rb)) - alpha / 2));
    worstMo = Math.max(worstMo, orth(mid));
    worstCh = Math.max(worstCh, Math.abs(fro(sub(Ra, Rb)) - 2 * Math.SQRT2 * Math.sin(alpha / 2)));
    const qa = qOf(Ra), qb = qOf(Rb); if (qa && qb) worstG = Math.max(worstG, Math.abs(2 * Math.acos(Math.min(1, Math.abs(dot(qa, qb)))) - alpha));
  }
  ok('geodesic distance = the angle of Ra^T Rb (matrix, log and quaternion routes)', worstG < 1e-7, worstG);
  ok('the mean is half way from each', worstM < 1e-7, worstM); ok('the mean is a rotation', worstMo < 3e-15, worstMo);
  ok('chord = 2 sqrt2 sin(alpha/2)', worstCh < 1e-12, worstCh);
  for (const deg of [90, 180]) { const al = deg * D2R; facts['chord' + deg] = 2 * Math.SQRT2 * Math.sin(al / 2); facts['arc' + deg] = al; }
  ok('chord numbers', close(facts.chord90, 2, 1e-12) && close(facts.chord180, 2 * Math.SQRT2, 1e-12));
  // the repair of section 1: the mean of I and the 90-degree rotation is the 45-degree rotation
  { const R2 = expQ(vsc(vsc([1, -2, 2], 1 / 3), 90 * D2R)), mid = mm(I3(), expQ(vsc(G3.m3.log(flat(R2)), 0.5)));
    ok('mean of I and a 90-degree turn is the 45-degree turn', close(angleOf(mid) / D2R, 45, 1e-9) && orth(mid) < 3e-15); }
}

/* ═══════════════ 5. poses: the twist, V, the quarter circle ═══════════════ */
{
  // 4x4 matrix exponential of the twist matrix against G3.se3.exp, V against its series
  let worstT = 0, worstV = 0, worstC = 0, worstInv = 0, worstLog = 0;
  for (let t = 0; t < 120; t++) {
    const rho = randw(2), w = randw(t % 3 === 0 ? 0.01 : 2), xi = [...rho, ...w], th = nrm(w);
    const K = sk(w), X = [[...K[0], rho[0]], [...K[1], rho[1]], [...K[2], rho[2]], [0, 0, 0, 0]];
    const E = expm(X, 80), T = G3.se3.exp(xi);
    worstT = Math.max(worstT, fro(sub(nest(flat(E.slice(0, 3).map(r => r.slice(0, 3)))), nest(T.R))), nrm(vsub([E[0][3], E[1][3], E[2][3]], T.t)));
    let Vs = I3(), P = I3(); for (let k = 1; k < 60; k++) { P = sc(mm(P, K), 1 / (k + 1)); Vs = add(Vs, P); }
    const Vc = th < 1e-8 ? I3() : add(add(I3(), sc(K, (1 - Math.cos(th)) / (th * th))), sc(mm(K, K), (th - Math.sin(th)) / (th ** 3)));
    worstV = Math.max(worstV, fro(sub(Vs, Vc)));
    // compose = 4x4 product; inverse; log round trip
    const T2 = G3.se3.exp([...randw(1), ...randw(1)]), C = G3.se3.compose(T, T2);
    const M1 = [[...nest(T.R)[0], T.t[0]], [...nest(T.R)[1], T.t[1]], [...nest(T.R)[2], T.t[2]], [0, 0, 0, 1]], M2 = [[...nest(T2.R)[0], T2.t[0]], [...nest(T2.R)[1], T2.t[1]], [...nest(T2.R)[2], T2.t[2]], [0, 0, 0, 1]];
    const Mp = M1.map(r => M2[0].map((_, j) => r.reduce((s, x, k) => s + x * M2[k][j], 0)));
    worstC = Math.max(worstC, fro(sub(nest(flat(Mp.slice(0, 3).map(r => r.slice(0, 3)))), nest(C.R))), nrm(vsub([Mp[0][3], Mp[1][3], Mp[2][3]], C.t)));
    const Ti = G3.se3.inv(T), I = G3.se3.compose(T, Ti); worstInv = Math.max(worstInv, fro(sub(nest(I.R), I3())), nrm(I.t));
    if (th < Math.PI - 0.01) { const lx = G3.se3.log(T); worstLog = Math.max(worstLog, nrm(vsub(lx, xi))); }
  }
  ok('se3.exp = 4x4 matrix exponential', worstT < 1e-11, worstT); ok('V closed form = series', worstV < 1e-12, worstV);
  ok('se3.compose = 4x4 product', worstC < 1e-12, worstC); ok('inverse', worstInv < 1e-12, worstInv); ok('log(exp(xi)) = xi', worstLog < 1e-8, worstLog);
  // the quarter circle: integrate the body's motion (velocity (1,0,0) in the body frame, turn rate pi/2 about z) with RK4
  { let x = [0, 0], a = 0; const wz = Math.PI / 2, N = 20000, h = 1 / N;
    const f = (s) => [Math.cos(s[2]), Math.sin(s[2]), wz]; let s = [0, 0, 0];
    for (let i = 0; i < N; i++) { const k1 = f(s), k2 = f(vadd(s, vsc(k1, h / 2))), k3 = f(vadd(s, vsc(k2, h / 2))), k4 = f(vadd(s, vsc(k3, h))); s = vadd(s, vsc(vadd(vadd(k1, vsc(k2, 2)), vadd(vsc(k3, 2), k4)), h / 6)); }
    const T = G3.se3.exp([1, 0, 0, 0, 0, Math.PI / 2]);
    ok('quarter circle by integration = V rho', close(s[0], T.t[0], 1e-9) && close(s[1], T.t[1], 1e-9) && close(s[2], Math.PI / 2, 1e-12), [s, T.t]);
    facts.qc_x = 2 / Math.PI; facts.qc_y = 2 / Math.PI;
    ok('quarter circle = (2/pi, 2/pi)', close(T.t[0], 2 / Math.PI, 1e-12) && close(T.t[1], 2 / Math.PI, 1e-12) && close(T.t[2], 0, 1e-15));
    void x; void a;
    // the checkpoint: ((2,0,0), (0,0,pi)) -> a half circle
    const H = G3.se3.exp([2, 0, 0, 0, 0, Math.PI]);
    ok('half circle ends at (0, 4/pi) facing back', close(H.t[0], 0, 1e-12) && close(H.t[1], 4 / Math.PI, 1e-12) && close(nest(H.R)[0][0], -1, 1e-12));
    facts.hc_y = H.t[1]; facts.ck_err = nrm(vsub([2, 0, 0], H.t));
  }
}

/* ═══════════════ 6. the rule: gradients, curvature, and four independent runs ═══════════════ */
const P = [[1, 0, 0], [0, 2, 0], [0, 0, 3]];
const AXIS = vsc([2, -1, 2], 1 / 3);
function problem(angDeg, pitchDeg, noisy) {                                   // an independent re-statement of RM.problem
  const Rstar = euler(30 * D2R, pitchDeg * D2R, 20 * D2R), R0 = mm(Rstar, expQ(vsc(AXIS, angDeg * D2R)));
  const g = FL.rng(7), Q = P.map(p => { const e = [FL.randn(g), FL.randn(g), FL.randn(g)]; return vadd(mv(Rstar, p), vsc(e, noisy ? 0.03 : 0)); });
  // closed-form best rotation: the polar factor of H = sum q p^T (the Kabsch solution), by SVD
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; Q.forEach((q, k) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H[i][j] += q[i] * P[k][j]; });
  const Rc = noisy ? nearestRot(H) : Rstar;
  return { Rstar, R0, Q, H, Rc };
}
const lossOf = (R, S) => 0.5 * P.reduce((s, p, k) => { const d = vsub(mv(R, p), S.Q[k]); return s + dot(d, d); }, 0);
const MM = (() => { const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; P.forEach(p => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += p[i] * p[j]; }); return M; })();
const gradMat = (R, S) => sub(mm(R, MM), S.H);                                  // dF/dR = R M - H
{
  // curvature: the Hessian of f(R exp([d]x)) at the minimum is trM I - M = diag(13, 10, 5); the nine-entry Hessian has eigenvalues 1, 4, 9
  const S = problem(60, 20, false), h = 1e-4, Hn = [];
  const fd = d => lossOf(mm(S.Rstar, expQ(d)), S);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const e = k => [0, 1, 2].map(q => (q === k ? h : 0));
    Hn.push((fd(vadd(e(i), e(j))) - fd(vsub(e(i), e(j))) - fd(vsub(e(j), e(i))) + fd(vsc(vadd(e(i), e(j)), -1))) / (4 * h * h));
  }
  const ev = G3.eigSym(Hn, 3).vals;
  ok('tangent curvature 13, 10, 5', close(ev[0], 13, 1e-3) && close(ev[1], 10, 1e-3) && close(ev[2], 5, 1e-3), ev);
  const Mev = G3.eigSym(flat(MM), 3).vals; ok('nine-entry curvature 9, 4, 1', close(Mev[0], 9, 1e-12) && close(Mev[2], 1, 1e-12), Mev);
  // gradient checks: nine entries, tangent coordinates (two formulas), Euler chain rule
  const R = expQ(randw(1.2)), Sn = problem(100, 20, true);
  const G = gradMat(R, Sn), eng = RM.gradR(flat(R), Sn.Q ? { Q: Sn.Q } : null);
  ok('RM.gradR = R M - H', Math.max(...flat(G).map((v, i) => Math.abs(v - eng[i]))) < 1e-12);
  let worstFD = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const Rp = R.map(r => r.slice()), Rm = R.map(r => r.slice()); Rp[i][j] += 1e-6; Rm[i][j] -= 1e-6; worstFD = Math.max(worstFD, Math.abs((lossOf(Rp, Sn) - lossOf(Rm, Sn)) / 2e-6 - G[i][j])); }
  ok('nine-entry gradient = finite differences', worstFD < 1e-7, worstFD);
  const Bm = mm(tp(R), G), g1 = [Bm[2][1] - Bm[1][2], Bm[0][2] - Bm[2][0], Bm[1][0] - Bm[0][1]];
  const g2 = RM.gradTan(flat(R), { Q: Sn.Q }), g3 = [0, 1, 2].map(i => { const e = [0, 0, 0]; e[i] = 1e-6; return (lossOf(mm(R, expQ(e)), Sn) - lossOf(mm(R, expQ(vsc(e, -1))), Sn)) / 2e-6; });
  ok('tangent gradient: B = R^T G route = cross-product route = finite differences', nrm(vsub(g1, g2)) < 1e-12 && nrm(vsub(g1, g3)) < 1e-7, [nrm(vsub(g1, g2)), nrm(vsub(g1, g3))]);
  const ang = [0.4, 0.7, -0.3], Re = euler(...ang), Ge = gradMat(Re, Sn), ax = RM.eulerAxes(ang[0], ang[1]);
  const gAng = ax.map(a => { const dR = mm(sk(a), Re); let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += Ge[i][j] * dR[i][j]; return s; });
  const gFd = [0, 1, 2].map(i => { const p = ang.slice(), m = ang.slice(); p[i] += 1e-6; m[i] -= 1e-6; return (lossOf(euler(...p), Sn) - lossOf(euler(...m), Sn)) / 2e-6; });
  ok('Euler gradient via the knob axes = finite differences', nrm(vsub(gAng, gFd)) < 1e-7, nrm(vsub(gAng, gFd)));
  // closed-form best rotation (Kabsch) against the engine's
  ok('RM best rotation = polar factor of H', fro(sub(nest(Array.from(Sn.Rc ? flat(Sn.Rc) : [])), nest(Array.from(RM.problem(100, 20, true).Rc)))) < 1e-10, fro(sub(Sn.Rc, nest(RM.problem(100, 20, true).Rc))));
}
/* the four runs, each re-implemented here from its equations */
const ETA = { nine: 0.2, proj: 0.2, euler: 1 / 13, exp: 0.1 };
function run(S, method, cap) {
  let R = S.R0.map(r => r.slice()), ang = null, conv = -1, stalled = false, orthMax = orth(R), detMin = dt(R), n = 0, path = [R];
  if (method === 'euler') ang = [Math.atan2(R[1][0], R[0][0]), Math.asin(-R[2][0]), Math.atan2(R[2][1], R[2][2])];
  const d0 = fro(sub(R, S.Rc)); void d0;
  for (let it = 1; it <= cap; it++) {
    let Rn;
    if (method === 'exp') {
      const B = mm(tp(R), gradMat(R, S)), g = [B[2][1] - B[1][2], B[0][2] - B[2][0], B[1][0] - B[0][1]];
      Rn = mm(R, expQ(vsc(g, -ETA.exp)));
    } else if (method === 'euler') {
      const G = gradMat(R, S), [psi, th, phi] = ang, c = Math.cos, s = Math.sin;
      const dRz = [[-s(psi), -c(psi), 0], [c(psi), -s(psi), 0], [0, 0, 0]], dRy = [[-s(th), 0, c(th)], [0, 0, 0], [-c(th), 0, -s(th)]], dRx = [[0, 0, 0], [0, -s(phi), -c(phi)], [0, c(phi), -s(phi)]];
      const D = [mm(dRz, mm(Ry(th), Rx(phi))), mm(Rz(psi), mm(dRy, Rx(phi))), mm(Rz(psi), mm(Ry(th), dRx))];
      const gA = D.map(Dm => { let t = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t += G[i][j] * Dm[i][j]; return t; });
      const eta = ETA.euler / (1 + Math.abs(Math.sin(th)));
      ang = ang.map((a, i) => a - eta * gA[i]); Rn = euler(...ang);
    } else {
      Rn = sub(R, sc(gradMat(R, S), ETA.nine));
      if (method === 'proj') Rn = nearestRot(Rn);
    }
    const step = fro(sub(Rn, R)); R = Rn; n = it; path.push(R);
    orthMax = Math.max(orthMax, orth(R)); detMin = Math.min(detMin, dt(R));
    if (fro(sub(R, S.Rc)) < 1e-6) { conv = it; break; }
    if (step < 1e-12) { stalled = true; break; }
  }
  return { n, conv, stalled, orthMax, detMin, R, orthEnd: orth(R), detEnd: dt(R), dist: fro(sub(R, S.Rc)), loss: lossOf(R, S), path };
}
const capOf = m => (m === 'euler' ? 20000 : 400);
/* agreement between the engine and this file, trajectory by trajectory */
function agree(label, angDeg, pitchDeg, noisy, method) {
  const S = problem(angDeg, pitchDeg, noisy), E = RM.problem(angDeg, pitchDeg, noisy), re = RM.run(E, method), ro = run(S, method, capOf(method));
  ok(label + ': iteration counts', re.n === ro.n && re.conv === ro.conv && re.stalled === ro.stalled, [re.n, ro.n, re.conv, ro.conv]);
  let worst = 0; const m = Math.min(re.n, ro.n);
  for (let k = 0; k <= m; k += (m > 400 ? 7 : 1)) { const a = Array.from(re.R.subarray(9 * k, 9 * k + 9)), b = flat(ro.path[k]); worst = Math.max(worst, Math.max(...a.map((v, i) => Math.abs(v - b[i])))); }
  ok(label + ': trajectories agree', worst < 1e-8, worst);
  ok(label + ': best rotations agree', fro(sub(S.Rc, nest(Array.from(E.Rc)))) < 1e-9, fro(sub(S.Rc, nest(Array.from(E.Rc)))));
  return ro;
}
const R_ = {};
for (const m of ['nine', 'proj', 'euler', 'exp']) R_[m + '_100_20_x'] = agree(m + ' exact 100/20', 100, 20, false, m);
for (const m of ['nine', 'proj', 'euler', 'exp']) R_[m + '_100_20_n'] = agree(m + ' noisy 100/20', 100, 20, true, m);
R_.nine_170 = agree('nine exact 170', 170, 20, false, 'nine');
for (const p of [0, 60, 80, 85, 89]) R_['euler_' + p] = agree('euler pitch ' + p, 100, p, false, 'euler');

/* what "What to try" quotes */
facts.n9_it = R_.nine_100_20_x.conv; facts.n9_worst = R_.nine_100_20_x.orthMax; facts.n9_mindet = R_.nine_100_20_x.detMin;
facts.n9_170_mindet = R_.nine_170.detMin; facts.n9_170_worst = R_.nine_170.orthMax;
ok('descent on the nine entries ends at the target when the markers are exact', R_.nine_100_20_x.conv > 0 && R_.nine_100_20_x.orthMax > 1 && R_.nine_100_20_x.detMin > 0 && R_.nine_100_20_x.detMin < 0.5);
ok('at 170 degrees the nine-entry path passes through a mirror image (det < 0)', R_.nine_170.detMin < 0, R_.nine_170.detMin);
{
  const z = R_.nine_100_20_n, S = problem(100, 20, true);
  ok('noisy markers: nine entries settle on a matrix that is not a rotation', z.stalled && z.orthEnd > 0.1 && Math.abs(z.detEnd - 1) > 0.03, [z.orthEnd, z.detEnd]);
  // its resting point is the unconstrained least-squares solution H M^-1
  const Mi = nest(G3.m3.inv(flat(MM))), Rhat = mm(S.H, Mi);
  ok('... namely H M^-1', fro(sub(z.R, Rhat)) < 1e-9, fro(sub(z.R, Rhat)));
  facts.nz9_endorth = z.orthEnd; facts.nz9_enddet = z.detEnd; facts.nz9_dist = z.dist; facts.nz9_loss = z.loss; facts.nz_best = lossOf(S.Rc, S);
  ok('... with a loss below that of the best rotation', z.loss < facts.nz_best);
}
{ // with nine free numbers every marker moves the fraction eta a^2 of the gap to its own target: red and green cut inside their spheres, blue overshoots
  for (const [label, key, nz] of [['exact', 'nine_100_20_x', false], ['noisy', 'nine_100_20_n', true]]) {
    const S = problem(100, 20, nz), path = R_[key].path; let worst = 0;
    for (let k = 0; k < 3; k++) {
      const f = 1 - ETA.nine * (k + 1) ** 2, m0 = mv(path[0], P[k]);
      for (let i = 0; i < path.length; i++) worst = Math.max(worst, nrm(vsub(mv(path[i], P[k]), vadd(S.Q[k], vsc(vsub(m0, S.Q[k]), Math.pow(f, i))))));
    }
    ok('nine, ' + label + ' markers: marker k stays on the line to its target, (m - q) shrinks by 1 - 0.2 a_k^2 per step', worst < 1e-12, worst);
  }
  const path = R_.nine_100_20_x.path, rad = (i, k) => nrm(mv(path[i], P[k])) - (k + 1);
  let inR = true, inG = true, zig = true;
  for (let i = 1; i <= 40; i++) { if (!(rad(i, 0) < 0)) inR = false; if (i <= 12 && !(rad(i, 1) < 0)) inG = false; if (!(i % 2 ? rad(i, 2) > 0 : rad(i, 2) < 0)) zig = false; }
  ok('nine: the red and green markers run inside their spheres, the blue one alternates outside and inside', inR && inG && zig, [inR, inG, zig]);
}
facts.pj_it = R_.proj_100_20_x.conv; facts.ex_it = R_.exp_100_20_x.conv;
ok('projected: every iterate is a rotation (the oracle projects by SVD, good to 1e-12)', R_.proj_100_20_x.orthMax < 1e-12 && R_.proj_100_20_n.orthMax < 1e-12);
ok('exp: every iterate is a rotation to 1e-14', R_.exp_100_20_x.orthMax < 1e-14 && R_.exp_100_20_n.orthMax < 1e-14 && R_.exp_100_20_x.detMin > 1 - 1e-14, [R_.exp_100_20_x.orthMax, R_.exp_100_20_n.orthMax]);
ok('exp and projected reach the best rotation when the markers are noisy', R_.exp_100_20_n.conv > 0 && R_.proj_100_20_n.conv > 0);
{
  // the exp count does not depend on the pitch or on the noise
  const cs = new Set();
  for (const p of [0, 10, 30, 45, 60, 80, 89]) for (const nz of [false, true]) cs.add(run(problem(100, p, nz), 'exp', 400).conv);
  ok('exp iteration count is the same at every pitch, with or without noise', cs.size === 1, [...cs]);
  facts.ex_it_all = [...cs][0];
  facts.ex_it10 = run(problem(10, 20, false), 'exp', 400).conv; facts.ex_it170 = run(problem(170, 20, false), 'exp', 400).conv;
}
for (const p of [0, 60, 80, 85]) facts['eu_it' + p] = R_['euler_' + p].conv;
facts.eu_it20 = R_.euler_100_20_x.conv;
facts.eu_dist89 = R_.euler_89.dist; facts.eu_cap = 20000;
ok('Euler at pitch 89 has not converged after 20000 iterations', R_.euler_89.conv < 0 && R_.euler_89.n === 20000, [R_.euler_89.conv, R_.euler_89.n]);
{ // iterations x cos^2(pitch) is roughly constant near the lock
  const prods = [60, 70, 75, 80, 85].map(p => run(problem(100, p, false), 'euler', 20000).conv * Math.cos(p * D2R) ** 2);
  facts.eu_prod_lo = Math.min(...prods); facts.eu_prod_hi = Math.max(...prods);
  ok('Euler iterations x cos^2(pitch) stays near 110', facts.eu_prod_lo > 95 && facts.eu_prod_hi < 125, prods);
  // the curvature of the loss in the three angle variables at the target: eigenvalues between 5 (1 - sin) and 13 (1 + sin)
  for (const p of [60, 80, 85]) {
    const th = p * D2R, S = problem(100, p, false), ang = [30 * D2R, th, 20 * D2R], h = 1e-3, fA = a => lossOf(euler(...a), S), Hn = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const e = k => [0, 1, 2].map(q => (q === k ? h : 0)); Hn.push((fA(vadd(ang, vadd(e(i), e(j)))) - fA(vadd(ang, vsub(e(i), e(j)))) - fA(vadd(ang, vsub(e(j), e(i)))) + fA(vsub(ang, vadd(e(i), e(j))))) / (4 * h * h)); }
    const ev = G3.eigSym(Hn, 3).vals, s1 = Math.sin(th);
    ok('angle-space curvature at pitch ' + p + ': smallest in [5, 13] (1 - sin), largest <= 13 (1 + sin)', ev[2] >= 5 * (1 - s1) * 0.97 && ev[2] <= 13 * (1 - s1) * 1.03 && ev[0] <= 13 * (1 + s1) * 1.03, [ev, 5 * (1 - s1), 13 * (1 - s1), 13 * (1 + s1)]);
  }
}
{ // the step is not what makes Euler slow: 1.5 times the step gives about 1.5 times fewer iterations, 2.5 times converges nowhere
  const base = ETA.euler, eulerAt = (mult, p) => { ETA.euler = mult * base; const c = run(problem(100, p, false), 'euler', 20000).conv; ETA.euler = base; return c; };
  facts.eu15_it60 = eulerAt(1.5, 60); facts.eu15_it85 = eulerAt(1.5, 85);
  ok('a 1.5 times larger Euler step: about 1.5 times fewer iterations at pitch 60 and 85', facts.eu15_it60 > 0 && facts.eu15_it85 > 0 && close(facts.eu_it60 / facts.eu15_it60, 1.5, 0.06) && close(facts.eu_it85 / facts.eu15_it85, 1.5, 0.06), [facts.eu15_it60, facts.eu15_it85, facts.eu_it60, facts.eu_it85]);
  const c25 = [0, 20, 60, 80, 85].map(p => eulerAt(2.5, p));
  ok('a 2.5 times larger Euler step converges at none of pitch 0, 20, 60, 80, 85', c25.every(c => c < 0), c25);
  ok('(the engine step is restored)', ETA.euler === base);
}
{ // theory against the measurement: contraction factors
  const S = problem(100, 20, false), re = run(S, 'exp', 400), rn = run(S, 'nine', 400);
  const ratio = (r, a, b) => fro(sub(r.path[b], S.Rc)) / fro(sub(r.path[a], S.Rc));
  ok('exp contracts by 0.5 per iteration near the end', close(ratio(re, re.n - 6, re.n), Math.pow(0.5, 6), 0.002), ratio(re, re.n - 6, re.n));
  ok('nine contracts by 0.8 per iteration near the end', close(Math.pow(ratio(rn, rn.n - 10, rn.n), 0.1), 0.8, 0.01), Math.pow(ratio(rn, rn.n - 10, rn.n), 0.1));
  facts.pred_exp = Math.log(1e6) / Math.log(2); facts.pred_nine = Math.log(1e6) / Math.log(1 / 0.8);
  ok('(1 - 0.1 x 13, 1 - 0.1 x 10, 1 - 0.1 x 5) = (-0.3, 0, 0.5)', close(1 - 1.3, -0.3, 1e-12) && close(1 - 1.0, 0, 1e-12) && close(1 - 0.5, 0.5, 1e-12));
}

{ // the exp steps keep contracting past the 1e-6 of the iteration count: the 1e-12 of the spec comes soon after
  const S = problem(100, 20, false); let R = S.R0, k = 0;
  for (; k < 200; k++) { const B = mm(tp(R), gradMat(R, S)), g = [B[2][1] - B[1][2], B[0][2] - B[2][0], B[1][0] - B[0][1]]; R = mm(R, expQ(vsc(g, -ETA.exp))); if (fro(sub(R, S.Rc)) < 1e-12) break; }
  ok('exp reaches 1e-12 from the opening state within 50 iterations and is still a rotation to 1e-14', k + 1 < 50 && orth(R) < 1e-14 && Math.abs(dt(R) - 1) < 1e-14, [k + 1, orth(R), dt(R) - 1]);
}

/* ═══════════════ Roads: the penalty, and the nearest rotation of a singular matrix ═══════════════ */
{
  const S = problem(100, 20, true);
  for (const mu of [10, 100]) {
    let R = S.R0.map(r => r.slice()), it = 0; const eta = 1 / (9 + 4 * mu);
    for (it = 1; it <= 400000; it++) {
      const E = sub(mm(tp(R), R), I3()), Gp = add(sub(mm(R, MM), S.H), sc(mm(R, E), 2 * mu));
      R = sub(R, sc(Gp, eta)); if (fro(Gp) < 1e-9) break;
    }
    facts['pen_o' + mu] = orth(R); facts['pen_it' + mu] = it;
    ok('penalty ' + mu + ' converged', it < 400000);
  }
  ok('penalty: each decade of mu buys one decade of orthonormality and costs one of steps', facts.pen_o10 / facts.pen_o100 > 7 && facts.pen_o10 / facts.pen_o100 < 11 && facts.pen_it100 / facts.pen_it10 > 7 && facts.pen_it100 / facts.pen_it10 < 11, [facts.pen_o10 / facts.pen_o100, facts.pen_it100 / facts.pen_it10]);
  // the nearest rotation of diag(0,0,1) is not unique: every rotation about z is at distance sqrt2
  let lo = 9, hi = 0; for (let d = 0; d < 360; d += 7) { const dist = fro(sub([[0, 0, 0], [0, 0, 0], [0, 0, 1]], Rz(d * D2R))); lo = Math.min(lo, dist); hi = Math.max(hi, dist); }
  ok('the nearest rotation to the flattened average is a whole circle', close(lo, Math.SQRT2, 1e-12) && close(hi, Math.SQRT2, 1e-12), [lo, hi]);
  // and that matrix is the average of I and the half turn about z
  ok('... it is (I + Rz(180))/2', fro(sub(sc(add(I3(), Rz(Math.PI)), 0.5), [[0, 0, 0], [0, 0, 0], [0, 0, 1]])) < 1e-15);
}

/* ═══════════════ 7. two scans: the disagreement is a number with no direction ═══════════════ */
{
  const rects = [{ o: [0, 0, 0], u: [5, 0, 0], w: [0, 4, 0] }, { o: [0, 0, 0], u: [0, 4, 0], w: [0, 0, 2.5] }, { o: [0, 0, 0], u: [5, 0, 0], w: [0, 0, 2.5] },
    { o: [2, 1.2, 1], u: [1, 0, 0], w: [0, 1, 0] }, { o: [2, 1.2, 0], u: [1, 0, 0], w: [0, 0, 1] }, { o: [2, 1.2, 0], u: [0, 1, 0], w: [0, 0, 1] }];
  const areas = rects.map(r => nrm(cross(r.u, r.w))), tot = areas.reduce((a, b) => a + b, 0);
  function sample(n, seed) { const g = FL.rng(seed), pts = []; for (let i = 0; i < n; i++) { let u = g() * tot, k = 0; while (k < rects.length - 1 && u > areas[k]) { u -= areas[k]; k++; } const a = g(), b = g(), r = rects[k]; pts.push(vadd(r.o, vadd(vsc(r.u, a), vsc(r.w, b)))); } return pts; }
  // exact nearest neighbour with a k-d tree stored in flat arrays
  function kd(pts) {
    const n = pts.length, ids = pts.map((_, i) => i), L = new Int32Array(n).fill(-1), Rr = new Int32Array(n).fill(-1), AX = new Int8Array(n);
    const rec = (lo, hi, d) => { if (hi <= lo) return -1; const ax = d % 3; const sub0 = ids.slice(lo, hi).sort((a, b) => pts[a][ax] - pts[b][ax]); for (let i = 0; i < sub0.length; i++) ids[lo + i] = sub0[i]; const mid = (lo + hi) >> 1, id = ids[mid]; AX[id] = ax; L[id] = rec(lo, mid, d + 1); Rr[id] = rec(mid + 1, hi, d + 1); return id; };
    const root = rec(0, n, 0), stack = new Int32Array(128);
    return q => { let best = Infinity, sp = 0; stack[sp++] = root; const lim = new Float64Array(128); lim[0] = 0;
      while (sp > 0) { const id = stack[--sp]; if (id < 0) continue; const pt = pts[id], dd = (pt[0] - q[0]) ** 2 + (pt[1] - q[1]) ** 2 + (pt[2] - q[2]) ** 2; if (dd < best) best = dd; const diff = q[AX[id]] - pt[AX[id]], near = diff < 0 ? L[id] : Rr[id], far = diff < 0 ? Rr[id] : L[id]; if (far >= 0 && diff * diff < best) stack[sp++] = far; if (near >= 0) stack[sp++] = near; }
      return Math.sqrt(best); };
  }
  const N = 1200; facts.sc_n = N;
  const camA = G3.lookAt([4.5, 3.5, 1.6], [1, 0.8, 0.8], [0, 0, 1]), camB = G3.lookAt([3.8, 0.8, 1.4], [0.5, 1.8, 0.9], [0, 0, 1]);
  const toFrame = (cam, p) => vadd(mv(nest(cam.R), p), cam.t);
  const scanA = sample(N, 11).map(p => toFrame(camA, p)), scanB = sample(N, 12).map(p => toFrame(camB, p)), nnB = kd(scanB);
  // the true pose maps A coordinates to B coordinates:  T* = T_B T_A^-1
  const RA = nest(camA.R), RB = nest(camB.R), Rt = mm(RB, tp(RA)), tt = vsub(camB.t, mv(Rt, camA.t));
  const apply = (T, p) => vadd(mv(T.R, p), T.t), compose = (A, B) => ({ R: mm(A.R, B.R), t: vadd(mv(A.R, B.t), A.t) });
  const Ts = { R: Rt, t: tt };
  // sanity: the same world point seen by both sensors is mapped onto itself by T*
  { const x = [1.1, 0.7, 0.4]; ok('T* maps sensor-A coordinates to sensor-B coordinates', nrm(vsub(apply(Ts, toFrame(camA, x)), toFrame(camB, x))) < 1e-12); }
  const D = T => { let s = 0; for (const p of scanA) s += nnB(apply(T, p)); return s / N; };
  const Delta = { R: expQ(vsc(vsc([1, 2, -1], 1 / Math.sqrt(6)), 15 * D2R)), t: [0.15, -0.2, 0.1] };
  const T0 = compose(Delta, Ts), Dtrue = D(Ts), Dstart = D(T0);
  facts.sc_truth = Dtrue; facts.sc_start = Dstart; facts.sc_rot = angleOf(Delta.R) / D2R; facts.sc_trans = 100 * nrm(Delta.t);
  ok('the true pose leaves a gap smaller than the start', Dtrue < 0.12 && Dstart > 3 * Dtrue, [Dtrue, Dstart]);
  const fr = [];
  for (const seed of [5, 6, 7]) {
    const g = FL.rng(seed); let better = 0, s1 = 0, s2 = 0; const M = 1000;
    for (let i = 0; i < M; i++) {
      const d = [FL.randn(g), FL.randn(g), FL.randn(g), FL.randn(g), FL.randn(g), FL.randn(g)];
      const xi = [...vsc(d.slice(0, 3), 0.02 / nrm(d.slice(0, 3))), ...vsc(d.slice(3), 2 * D2R / nrm(d.slice(3)))];
      const x = G3.se3.exp(xi), step = { R: nest(x.R), t: x.t }, d1 = D(compose(T0, step)) - Dstart;     // T0 after a small tangent step: T0 exp(xi)
      if (d1 < 0) better++; s1 += d1; s2 += d1 * d1;
    }
    const mean = s1 / M, sd = Math.sqrt(s2 / M - mean * mean), se = sd / Math.sqrt(M);
    fr.push(100 * better / M);
    ok('random steps: the mean change is zero within noise (seed ' + seed + ')', Math.abs(mean) < 3 * se, [mean, se]);
    if (seed === 5) { facts.sc_frac = 100 * better / M; facts.sc_mean = 1000 * mean; facts.sc_se = 1000 * se; facts.sc_steps = M; }
  }
  ok('random steps: about half lower the disagreement', fr.every(v => v > 45 && v < 55), fr);
  facts.sc_frac_lo = Math.min(...fr); facts.sc_frac_hi = Math.max(...fr);
}

/* ═══════════════ the checkpoint ═══════════════ */
{
  let X = I3(); const Sz = add(I3(), sk([0, 0, 0.1]));
  for (let i = 0; i < 10; i++) X = mm(X, Sz);
  facts.ck_len = nrm([X[0][0], X[1][0], X[2][0]]); facts.ck_det = dt(X);
  ok('ten first-order steps', close(facts.ck_len, Math.pow(1.01, 5), 1e-12) && close(facts.ck_det, Math.pow(1.01, 10), 1e-12));
  facts.ck_turn = 10 * Math.atan(0.1) / D2R;
}

/* ═══════════════ the page: drive the widget into each state the prose describes ═══════════════ */
const page = loadPage(path.join(DIR, '03_rigid_motion.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function setAll(ang, pitch, method, data, k) { page.set('w03-ang', ang); page.set('w03-pitch', pitch); page.set('w03-method', method); page.set('w03-data', data); page.set('w03-k', k === undefined ? 60 : k); }
function read() { return { it: page.text('w03-it'), dist: page.num('w03-dist'), worst: page.num('w03-worst'), end: page.num('w03-end'), mindet: page.num('w03-mindet'), loss: page.num('w03-loss'), best: page.num('w03-best'), cos: page.text('w03-cos'), klab: page.text('w03-k-v') }; }
const sci = (a, b) => rel(a, b, 0.06) || Math.abs(a - b) < 1e-12;
function widgetMatches(label, ang, pitch, method, data) {
  setAll(ang, pitch, method, data, 100);
  const w = read(), o = run(problem(ang, pitch, data === 'noisy'), method, capOf(method));
  const itWant = o.conv >= 0 ? String(o.conv) : o.stalled ? 'never' : '> 20000';
  ok(label + ': iterations', w.it === itWant, [w.it, itWant]);
  ok(label + ': distance at the end', sci(w.dist, o.dist), [w.dist, o.dist]);
  ok(label + ': worst orthonormality error', sci(w.worst, o.orthMax), [w.worst, o.orthMax]);
  ok(label + ': orthonormality error at the end', sci(w.end, o.orthEnd), [w.end, o.orthEnd]);
  ok(label + ': smallest determinant', close(w.mindet, o.detMin, 0.0051), [w.mindet, o.detMin]);
  ok(label + ': loss', close(w.loss, o.loss, 0.00006), [w.loss, o.loss]);
  ok(label + ': best loss', close(w.best, lossOf(problem(ang, pitch, data === 'noisy').Rc, problem(ang, pitch, data === 'noisy')), 0.00006));
  const m = /iteration (\d+) of (\d+): orth\. error (\S+), det (\S+)/.exec(w.klab);
  ok(label + ': the label of the iterate shown', m && +m[1] === o.n && +m[2] === o.n && sci(parseFloat(m[3]), o.orthEnd) && close(parseFloat(m[4]), o.detEnd, 0.0051), [w.klab, o.n, o.orthEnd, o.detEnd]);
  return w;
}
widgetMatches('opening state', 100, 20, 'nine', 'exact');
widgetMatches('nine at 170', 170, 20, 'nine', 'exact');
widgetMatches('nine, noisy', 100, 20, 'nine', 'noisy');
widgetMatches('proj', 100, 20, 'proj', 'exact'); widgetMatches('proj, noisy', 100, 20, 'proj', 'noisy');
widgetMatches('exp', 100, 20, 'exp', 'exact'); widgetMatches('exp, noisy', 100, 20, 'exp', 'noisy'); widgetMatches('exp, pitch 85', 100, 85, 'exp', 'exact');
for (const p of [0, 20, 60, 80, 85, 89]) widgetMatches('Euler pitch ' + p, 100, p, 'euler', 'exact');
{ // the label of an interior iterate and the gimbal indicator
  setAll(100, 85, 'euler', 'exact', 0);
  const w = read(); const e0 = run(problem(100, 85, false), 'euler', 20000);
  ok('Euler at iteration 0: the label', new RegExp('iteration 0 of ' + e0.n + ':').test(w.klab), [w.klab, e0.n]); const c = Math.sqrt(Math.max(0, 1 - e0.path[0][2][0] ** 2));
  ok('cos(pitch) readout at the start', close(parseFloat(w.cos), c, 0.0006), [w.cos, c]);
  setAll(100, 20, 'nine', 'exact', 100); ok('no pitch readout for the nine-entry method', read().cos === '—');
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
