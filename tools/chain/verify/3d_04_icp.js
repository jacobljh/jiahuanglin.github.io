#!/usr/bin/env node
/* Oracle for 3D lesson 04, "Pose by agreement I: aligning scans".
 *
 * Independent re-derivations (nothing below calls ICP.step / ICP.run / ICP.nearest to produce a quoted number without a second path):
 *   A  closed-form alignment: the exact transform is recovered to 1e-12; E(theta) = S_pp + S_qq - 2(A cos + B sin); the atan2 angle equals a brute-force
 *      angle search and the SVD route with the determinant guard; the mirror example; collinear fits; the same recipe in 3-D (geom3.js).
 *   B  the entry numbers (same-beam pairing, nearest-neighbour distances at the true pose), computed with a brute-force nearest neighbour.
 *   C  a reference ICP (brute-force neighbours, SVD-route solve): the engine's iterates equal it; E never increases over hundreds of seeded starts.
 *   D  the basin sweep, the right-wall share, the fixed points.
 *   E  point-to-line: reference Gauss-Newton (geom3's Jacobi eigen-solver, truncated), iteration counts over 171 seeded starts, the tangential share of the point-to-point error.
 *   F  the corridor (eigenvalues of the point-to-line normal matrix, drift), G the person and trimming, H bearings only, I the search-count arithmetic.
 * Then the page's widget is driven into each state the prose quotes and must print what the reference computes.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const ICP = require(path.join(DIR, 'icp.js'));
const G3 = require(path.join(DIR, 'geom3.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
let nChecks = 0;
function ok(name, cond, extra) { nChecks++; if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const DEG = Math.PI / 180;
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const rotp = (a, p) => ({ x: Math.cos(a) * p.x - Math.sin(a) * p.z, z: Math.sin(a) * p.x + Math.cos(a) * p.z });
const sum = (xs, f) => xs.reduce((s, x, i) => s + f(x, i), 0);
function pairsE(P, Q, a, t) { return sum(P, (p, i) => { const r = rotp(a, p); return (r.x + t.x - Q[i].x) ** 2 + (r.z + t.z - Q[i].z) ** 2; }); }
const centroid = P => ({ x: sum(P, p => p.x) / P.length, z: sum(P, p => p.z) / P.length });

/* ───────────────────────────── A. the closed form ───────────────────────────── */
const rngA = FL.rng(2024);
const rnd = (lo, hi) => lo + (hi - lo) * rngA();
const gauss = () => FL.randn(rngA);
{
  let worst = 0, worstK = 0;
  for (let trial = 0; trial < 300; trial++) {
    const n = 3 + Math.floor(rngA() * 38), a = rnd(-Math.PI, Math.PI), t = { x: rnd(-5, 5), z: rnd(-5, 5) };
    const P = [], Q = [];
    for (let i = 0; i < n; i++) { const p = { x: rnd(-5, 5), z: rnd(-5, 5) }; P.push(p); const r = rotp(a, p); Q.push({ x: r.x + t.x, z: r.z + t.z }); }
    const T = ICP.align(P, Q), K = ICP.kabsch(P, Q, true);
    worst = Math.max(worst, Math.abs(wrap(T.a - a)), Math.abs(T.x - t.x), Math.abs(T.z - t.z));
    worstK = Math.max(worstK, Math.abs(wrap(K.a - a)), Math.abs(K.x - t.x), Math.abs(K.z - t.z), Math.abs(K.det - 1));
  }
  ok('closed form recovers an exact random transform (atan2 route)', worst < 1e-12, worst);
  ok('closed form recovers an exact random transform (SVD route with the determinant guard)', worstK < 1e-12, worstK);
  facts.exact_digits = Math.floor(-Math.log10(Math.max(worst, 1e-16)));
}
{
  /* E(theta) with the optimal translation equals S_pp + S_qq - 2 (A cos theta + B sin theta);  the minimum of that is E_min;  atan2 is the argmin (brute force) */
  let worstId = 0, worstArg = 0, worstSvd = 0, worstRec = 0;
  for (let trial = 0; trial < 40; trial++) {
    const n = 5 + Math.floor(rngA() * 30), a0 = rnd(-3, 3), P = [], Q = [];
    for (let i = 0; i < n; i++) { const p = { x: rnd(-4, 4), z: rnd(-4, 4) }; P.push(p); const r = rotp(a0, p); Q.push({ x: r.x + 1.3 + 0.15 * gauss(), z: r.z - 0.7 + 0.15 * gauss() }); }
    const pc = centroid(P), qc = centroid(Q), Pt = P.map(p => ({ x: p.x - pc.x, z: p.z - pc.z })), Qt = Q.map(q => ({ x: q.x - qc.x, z: q.z - qc.z }));
    const spp = sum(Pt, p => p.x * p.x + p.z * p.z), sqq = sum(Qt, q => q.x * q.x + q.z * q.z);
    const A = sum(Pt, (p, i) => p.x * Qt[i].x + p.z * Qt[i].z), B = sum(Pt, (p, i) => p.x * Qt[i].z - p.z * Qt[i].x);
    const Eof = th => { const r = rotp(th, pc); return pairsE(P, Q, th, { x: qc.x - r.x, z: qc.z - r.z }); };   // translation optimal for this angle: t = q_bar - R p_bar
    for (const th of [-2.5, -0.3, 0.9, 2.2]) worstId = Math.max(worstId, Math.abs(Eof(th) - (spp + sqq - 2 * (A * Math.cos(th) + B * Math.sin(th)))));
    /* brute-force angle search on the direct sum, then ternary refinement */
    let best = 0, bv = Infinity;
    for (let k = 0; k < 3600; k++) { const th = -Math.PI + 2 * Math.PI * k / 3600, v = Eof(th); if (v < bv) { bv = v; best = th; } }
    let lo = best - 2 * Math.PI / 3600, hi = best + 2 * Math.PI / 3600;
    for (let it = 0; it < 80; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (Eof(m1) < Eof(m2)) hi = m2; else lo = m1; }
    const T = ICP.align(P, Q), K = ICP.kabsch(P, Q, true);
    worstArg = Math.max(worstArg, Math.abs(wrap(T.a - (lo + hi) / 2)));
    worstSvd = Math.max(worstSvd, Math.abs(wrap(K.a - T.a)), Math.abs(K.E - T.E), Math.abs(K.det - 1));
    worstRec = Math.max(worstRec, Math.abs(T.E - (spp + sqq - 2 * Math.hypot(A, B))), Math.abs(T.E - pairsE(P, Q, T.a, { x: T.x, z: T.z })));
  }
  ok('E(theta) identity', worstId < 1e-8, worstId);
  ok('atan2 = brute-force angle search', worstArg < 1e-6, worstArg);
  ok('atan2 = SVD route with the guard', worstSvd < 1e-9, worstSvd);
  ok('E_min formula', worstRec < 1e-8, worstRec);
}
{
  /* svd2: reconstruction and orthogonality on random 2x2 matrices of both determinant signs */
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const H = [rnd(-3, 3), rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)], s = ICP.svd2(H), U = s.U, V = s.V;
    const rec = [0, 1, 2, 3].map(q => { const i = q >> 1, j = q & 1; return U[i * 2] * s.s[0] * V[j * 2] + U[i * 2 + 1] * s.s[1] * V[j * 2 + 1]; });
    worst = Math.max(worst, ...rec.map((v, q) => Math.abs(v - H[q])), Math.abs(U[0] * U[0] + U[2] * U[2] - 1), Math.abs(V[0] * V[0] + V[2] * V[2] - 1), Math.abs(U[0] * U[1] + U[2] * U[3]), Math.abs(V[0] * V[1] + V[2] * V[3]));
    if (!(s.s[0] >= s.s[1] && s.s[1] >= 0)) worst = 1;
  }
  ok('svd2 reconstructs H with orthogonal factors', worst < 1e-12, worst);
}
/* the mirror example */
{
  const P = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 1 }], Q = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: -1 }];
  const c = ICP.crossCov(P, Q), det = c.H[0] * c.H[3] - c.H[1] * c.H[2];
  const raw = ICP.kabsch(P, Q, false), gu = ICP.kabsch(P, Q, true), al = ICP.align(P, Q);
  ok('mirror example: det H < 0', det < 0, det);
  ok('mirror example: the unguarded SVD returns a reflection that fits perfectly', raw.det < 0 && raw.E < 1e-12, [raw.det, raw.E]);
  ok('mirror example: the guarded answer is a rotation, equal to atan2', close(gu.det, 1, 1e-12) && close(gu.a, al.a, 1e-12) && close(gu.E, al.E, 1e-12));
  /* no rotation fits better: brute force over the angle with the optimal translation */
  let bv = Infinity; for (let k = 0; k < 36000; k++) { const th = -Math.PI + 2 * Math.PI * k / 36000, r = rotp(th, centroid(P)), qc = centroid(Q); bv = Math.min(bv, pairsE(P, Q, th, { x: qc.x - r.x, z: qc.z - r.z })); }
  ok('mirror example: best rotation by brute force', close(bv, al.E, 1e-6), [bv, al.E]);
  facts.mir_h11 = c.H[0]; facts.mir_h12 = c.H[1]; facts.mir_h21 = c.H[2]; facts.mir_h22 = c.H[3];
  facts.mir_detH = det; facts.mir_A = c.A; facts.mir_B = c.B; facts.mir_angle = al.a / DEG; facts.mir_E_rot = al.E; facts.mir_E_refl = raw.E;
}
/* a straight wall: the sign of det(H) is decided by noise */
{
  const rngW = FL.rng(77), g = () => FL.randn(rngW); let neg = 0, raws = 0, refl = 0, worstAng = 0;
  const N = 1000, a0 = 20 * DEG;
  for (let k = 0; k < N; k++) {
    const P = [], Q = [];
    for (let i = 0; i < 7; i++) {
      const x = -1.5 + 0.5 * i, r = rotp(a0, { x, z: 0 });
      P.push({ x: x + 0.01 * g(), z: 0.01 * g() }); Q.push({ x: r.x + 1 + 0.01 * g(), z: r.z + 0.5 + 0.01 * g() });
    }
    const c = ICP.crossCov(P, Q), det = c.H[0] * c.H[3] - c.H[1] * c.H[2];
    if (det < 0) neg++;
    const raw = ICP.kabsch(P, Q, false), gu = ICP.kabsch(P, Q, true);
    if (raw.det < 0) refl++;
    if (raw.det < 0 !== det < 0) raws++;
    worstAng = Math.max(worstAng, Math.abs(wrap(gu.a - a0)));
    if (!close(gu.det, 1, 1e-12)) fails++;
  }
  ok('unguarded SVD returns a reflection exactly when det H < 0', raws === 0 && refl === neg, [raws, refl, neg]);
  ok('the guarded rotation stays within 2 degrees of the truth on a noisy wall', worstAng < 2 * DEG, worstAng / DEG);
  facts.col_neg = neg; facts.col_n = N;
  ok('about half of the noisy wall fits are mirror images', neg > 0.4 * N && neg < 0.6 * N, neg);
}
/* the same recipe in 3-D (geom3.js): R = V U^T with proper-rotation factors, recovered to 1e-12 */
{
  const m3 = G3.m3, rngT = FL.rng(5); let worst = 0;
  for (let trial = 0; trial < 100; trial++) {
    const R = m3.exp([ (rngT() - 0.5) * 5, (rngT() - 0.5) * 5, (rngT() - 0.5) * 5 ]), t = [rngT() * 4 - 2, rngT() * 4 - 2, rngT() * 4 - 2];
    const P = [], Q = []; for (let i = 0; i < 12; i++) { const p = [rngT() * 6 - 3, rngT() * 6 - 3, rngT() * 6 - 3]; P.push(p); const r = m3.mulv(R, p); Q.push([r[0] + t[0], r[1] + t[1], r[2] + t[2]]); }
    const pc = [0, 1, 2].map(k => sum(P, p => p[k]) / 12), qc = [0, 1, 2].map(k => sum(Q, q => q[k]) / 12), H = new Array(9).fill(0);
    for (let i = 0; i < 12; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a * 3 + b] += (P[i][a] - pc[a]) * (Q[i][b] - qc[b]);
    const s = G3.svd3(H), Re = m3.mul(s.V, m3.T(s.U)), te = [0, 1, 2].map(k => qc[k] - m3.mulv(Re, pc)[k]);
    for (let k = 0; k < 9; k++) worst = Math.max(worst, Math.abs(Re[k] - R[k]));
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(te[k] - t[k]));
    worst = Math.max(worst, Math.abs(m3.det(Re) - 1));
  }
  ok('3-D: R = V U^T from the SVD of the cross-covariance recovers an exact SE(3) transform', worst < 1e-12, worst);
}
/* the 3-D recipe on the data that make it hard, with a SVD and an optimum written here (G3.svd3 forms the eigenproblem of H^T H, which squares the
 * condition number: on a flat patch, whose smallest singular value is only noise, its U loses orthogonality, so it is NOT used below).
 *   one-sided Jacobi (Hestenes) SVD of a 3x3: orthogonal U, V and S >= 0 to machine precision at every scale;
 *   the optimum over proper rotations from Horn's 4x4 eigenproblem (unit quaternions can only be rotations).
 * Claims checked: R = V diag(1, 1, det(V U^T)) U^T is a rotation and equals Horn's optimum; the unguarded V U^T has det = sign(det H) and is a
 * mirror image exactly when det H < 0; a mirror fits at least as well as any rotation; a noisy flat patch gives det H < 0 about half the time;
 * and the same formula gives lesson 3's "best rotation" of three noisy markers, which tangent-space descent needs 22 steps to reach. */
{
  const RMe = require(path.join(DIR, 'rigid_motion.js')), m3 = G3.m3;
  const mmul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const tr3 = A => [0, 1, 2].map(i => [0, 1, 2].map(j => A[j][i]));
  const det3 = A => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  function jacobiSVD(A) {
    const W = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 60; sweep++) {
      let rotated = 0;
      for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
        let al = 0, be = 0, ga = 0;
        for (let i = 0; i < 3; i++) { al += W[i][p] * W[i][p]; be += W[i][q] * W[i][q]; ga += W[i][p] * W[i][q]; }
        if (Math.abs(ga) <= 1e-16 * Math.sqrt(al * be)) continue;
        rotated++;
        const zeta = (be - al) / (2 * ga), t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta)), c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < 3; i++) {
          const wp = W[i][p], wq = W[i][q], vp = V[i][p], vq = V[i][q];
          W[i][p] = c * wp - s * wq; W[i][q] = s * wp + c * wq; V[i][p] = c * vp - s * vq; V[i][q] = s * vp + c * vq;
        }
      }
      if (!rotated) break;
    }
    const S = [0, 1, 2].map(j => Math.hypot(W[0][j], W[1][j], W[2][j])), order = [0, 1, 2].sort((a, b) => S[b] - S[a]);
    const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Vs = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    order.forEach((j, k) => { for (let i = 0; i < 3; i++) { U[i][k] = W[i][j] / S[j]; Vs[i][k] = V[i][j]; } });
    return { U, S: order.map(j => S[j]), V: Vs };
  }
  function hornRotation(H) {                         // H[a][b] = sum p_a q_b ; the rotation that maximises tr(R H), i.e. maps p onto q best
    const N = [[H[0][0] + H[1][1] + H[2][2], H[1][2] - H[2][1], H[2][0] - H[0][2], H[0][1] - H[1][0]],
      [H[1][2] - H[2][1], H[0][0] - H[1][1] - H[2][2], H[0][1] + H[1][0], H[2][0] + H[0][2]],
      [H[2][0] - H[0][2], H[0][1] + H[1][0], -H[0][0] + H[1][1] - H[2][2], H[1][2] + H[2][1]],
      [H[0][1] - H[1][0], H[2][0] + H[0][2], H[1][2] + H[2][1], -H[0][0] - H[1][1] + H[2][2]]];
    const e = G3.eigSym([].concat(...N), 4), [w, x, y, z] = e.vecs[0];
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  }
  const Efit = (R, H, spp, sqq) => spp + sqq - 2 * (R[0][0] * H[0][0] + R[0][1] * H[1][0] + R[0][2] * H[2][0] + R[1][0] * H[0][1] + R[1][1] * H[1][1] + R[1][2] * H[2][1] + R[2][0] * H[0][2] + R[2][1] * H[1][2] + R[2][2] * H[2][2]);   // sum |R p - q|^2 = spp + sqq - 2 tr(R H)
  const guarded = (U, V) => { const VU = mmul(V, tr3(U)), d = det3(VU); return { R: mmul(mmul(V, [[1, 0, 0], [0, 1, 0], [0, 0, d]]), tr3(U)), VU, d }; };
  /* the SVD itself */
  { let w = 0; const r = FL.rng(31), g = () => FL.randn(r);
    for (let k = 0; k < 300; k++) {
      const A = [[g(), g(), g()], [g(), g(), g()], [g(), g(), 1e-7 * g()]], s = jacobiSVD(A), D = [[s.S[0], 0, 0], [0, s.S[1], 0], [0, 0, s.S[2]]], rec = mmul(mmul(s.U, D), tr3(s.V)), UtU = mmul(tr3(s.U), s.U), VtV = mmul(tr3(s.V), s.V);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) w = Math.max(w, Math.abs(rec[i][j] - A[i][j]), Math.abs(UtU[i][j] - (i === j ? 1 : 0)), Math.abs(VtV[i][j] - (i === j ? 1 : 0)));
      if (!(s.S[0] >= s.S[1] && s.S[1] >= s.S[2] && s.S[2] >= 0)) w = 1;
    }
    ok('Jacobi SVD: A = U S V^T with orthogonal factors, also when the smallest singular value is 1e-7', w < 1e-12, w); }
  /* a flat patch: 3 x 3 points 0.5 m apart in a plane, 1 cm of noise on every coordinate of both sets, a random rigid motion */
  {
    const rng = FL.rng(77), g = () => FL.randn(rng), N = 1000, pts = []; let neg = 0, wRot = 0, wHorn = 0, wDet = 0, nMirrorBetter = 0, nMirror = 0, mismatch = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) pts.push([0.5 * i, 0.5 * j, 0]);
    const Rt = m3.exp([1 / 3 * 20 * DEG, 2 / 3 * 20 * DEG, 2 / 3 * 20 * DEG]), tt = [1, 0.5, -0.3];
    for (let k = 0; k < N; k++) {
      const P = [], Q = [];
      for (const p of pts) { P.push([p[0] + 0.01 * g(), p[1] + 0.01 * g(), p[2] + 0.01 * g()]); const r = m3.mulv(Rt, p); Q.push([r[0] + tt[0] + 0.01 * g(), r[1] + tt[1] + 0.01 * g(), r[2] + tt[2] + 0.01 * g()]); }
      const n = P.length, pc = [0, 1, 2].map(a => sum(P, p => p[a]) / n), qc = [0, 1, 2].map(a => sum(Q, q => q[a]) / n);
      const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let spp = 0, sqq = 0;
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { spp += (P[i][a] - pc[a]) ** 2; sqq += (Q[i][a] - qc[a]) ** 2; for (let b = 0; b < 3; b++) H[a][b] += (P[i][a] - pc[a]) * (Q[i][b] - qc[b]); }
      const dH = det3(H), s = jacobiSVD(H), un = mmul(s.V, tr3(s.U)), gd = guarded(s.U, s.V), hr = hornRotation(H);
      if (dH < 0) neg++;
      if ((det3(un) < 0) !== (dH < 0)) mismatch++;
      wRot = Math.max(wRot, Math.abs(det3(gd.R) - 1)); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) wHorn = Math.max(wHorn, Math.abs(gd.R[i][j] - hr[i][j]));
      if (dH < 0) { nMirror++; if (Efit(un, H, spp, sqq) <= Efit(gd.R, H, spp, sqq) + 1e-12) nMirrorBetter++; }
      wDet = Math.max(wDet, Math.abs(Efit(gd.R, H, spp, sqq) - Efit(hr, H, spp, sqq)));
    }
    ok('flat patch: the unguarded V U^T has det = sign(det H)', mismatch === 0, mismatch);
    ok('flat patch: V diag(1, 1, det(V U^T)) U^T is always a rotation', wRot < 1e-12, wRot);
    ok("flat patch: ... and equals Horn's optimum over rotations", wHorn < 1e-9 && wDet < 1e-9, [wHorn, wDet]);
    ok('flat patch: where det H < 0 the mirror image fits at least as well as the best rotation', nMirrorBetter === nMirror && nMirror === neg, [nMirrorBetter, nMirror, neg]);
    ok('flat patch: about half the fits have det H < 0', neg > 0.4 * N && neg < 0.6 * N, neg);
    facts.col3_neg = neg; facts.col3_n = N;
  }
  /* lesson 3's widget: the 'best rotation' of three noisy markers is this formula, and the tangent-space descent needs 22 steps for it */
  {
    const S = RMe.problem(100, 20, true), H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a][b] += RMe.P[k][a] * S.Q[k][b];
    const s = jacobiSVD(H), gd = guarded(s.U, s.V), hr = hornRotation(H); let w = 0, w2 = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { w = Math.max(w, Math.abs(gd.R[i][j] - S.Rc[3 * i + j])); w2 = Math.max(w2, Math.abs(hr[i][j] - S.Rc[3 * i + j])); }
    ok("lesson 3's best rotation of the noisy markers = the SVD formula = Horn's optimum", w < 1e-9 && w2 < 1e-9 && gd.d > 0, [w, w2, gd.d]);
    const r = RMe.run(S, 'exp'); facts.l3_it = r.conv;
    ok('tangent-space descent reaches that rotation in 22 steps (lesson 3)', r.conv === 22, r.conv);
  }
}
/* the checkpoint triangle: rotate by 90 degrees about the origin, then translate by (3, 1) */
{
  const P = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 1 }], a0 = 90 * DEG, t0 = { x: 3, z: 1 };
  const Q = P.map(p => { const r = rotp(a0, p); return { x: r.x + t0.x, z: r.z + t0.z }; });
  const c = ICP.crossCov(P, Q), al = ICP.align(P, Q);
  ok('checkpoint triangle recovered', close(al.a, a0, 1e-12) && close(al.x, 3, 1e-12) && close(al.z, 1, 1e-12) && al.E < 1e-12);
  facts.ck_pcx = c.pc.x; facts.ck_pcz = c.pc.z; facts.ck_qcx = c.qc.x; facts.ck_qcz = c.qc.z; facts.ck_A = c.A; facts.ck_B = c.B; facts.ck_angle = al.a / DEG; facts.ck_tx = al.x; facts.ck_tz = al.z;
}


/* ───────────────────────────── worlds, written here from the lesson's own specification ───────────────────────────── */
const ROOM = FL.scenes.room();
const P1 = FL.se2.make(0, -0.5, 4.2), REL = FL.se2.make(0.30, 0.7, 0.3);
function corridorScene() {
  const L = 60, W = 2.4, wall = [0.4, 0.4, 0.45];
  return { name: 'corridor', shapes: [FL.box(0, -0.15, L / 2, 0.15, wall, { name: 'south' }), FL.box(0, W + 0.15, L / 2, 0.15, wall, { name: 'north' })], light: [0, 1], amb: 0.4, bg: [1, 1, 1], far: 60, stepScale: 0.9 };
}
function addPerson(sc, pose, r, deg, dist) {
  const x = pose.x + dist * Math.cos(pose.a + deg * DEG), z = pose.z + dist * Math.sin(pose.a + deg * DEG);
  return { name: sc.name, shapes: sc.shapes.concat([FL.circle(x, z, r, [0.9, 0.2, 0.2], { name: 'person' })]), light: sc.light, amb: sc.amb, bg: sc.bg, far: sc.far, stepScale: sc.stepScale };
}
/* kind: room | person | corridor | bearing.  Returns plain arrays of {x, z, id, beam}; Ts = the true pose of sensor 2 in the frame of sensor 1 */
function world(kind, sigma) {
  let sc1 = ROOM, sc2 = ROOM, p1 = P1, rel = REL, r0 = 0;
  if (kind === 'corridor') { sc1 = sc2 = corridorScene(); p1 = FL.se2.make(0, 0, 1.2); rel = FL.se2.make(0.08, 1.0, 0.1); }
  if (kind === 'person') sc2 = addPerson(ROOM, FL.se2.compose(P1, REL), 0.25, 120, 1.5);
  if (kind === 'bearing') r0 = 5;
  const p2 = FL.se2.compose(p1, rel), Ts = FL.se2.compose(FL.se2.inv(p1), p2);
  const pts = (sc, pose, seed) => FL.lidar(sc, pose, { n: 180, sigma, range: 14, rng: FL.rng(seed) }).map((b, j) => {
    if (!b.ok) return null;
    let x = b.lx, z = b.lz; if (r0) { const r = Math.hypot(x, z); x *= r0 / r; z *= r0 / r; }
    return { x, z, id: b.id, beam: j };
  }).filter(Boolean);
  return { kind, sigma, P: pts(sc2, p2, 12), Q: pts(sc1, p1, 11), Ts, p1, p2, sc1, sc2 };
}
function nnB(M, x, z) { let bj = -1, bd = Infinity; for (let j = 0; j < M.length; j++) { const d = (M[j].x - x) ** 2 + (M[j].z - z) ** 2; if (d < bd) { bd = d; bj = j; } } return { j: bj, d2: bd }; }
const applyT = (T, p) => { const c = Math.cos(T.a), s = Math.sin(T.a); return { x: c * p.x - s * p.z + T.x, z: s * p.x + c * p.z + T.z }; };
const poseErr = (T, S) => ({ dt: Math.hypot(T.x - S.x, T.z - S.z), da: Math.abs(wrap(T.a - S.a)) });
const startPose = (W, dth, dt, phi) => ({ a: W.Ts.a + dth * DEG, x: W.Ts.x + dt * Math.cos(phi * DEG), z: W.Ts.z + dt * Math.sin(phi * DEG) });
const good = e => e.dt < 0.10 && e.da < 1.5 * DEG;
const med = xs => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
const quant = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };

/* generic 2x2 SVD (eigen-decomposition of H^T H) and the Kabsch step with the determinant guard — a path different from ICP.svd2 / atan2 */
function svd2generic(H) {
  const a = H[0] * H[0] + H[2] * H[2], b = H[0] * H[1] + H[2] * H[3], d = H[1] * H[1] + H[3] * H[3];
  const phi = 0.5 * Math.atan2(2 * b, a - d), c = Math.cos(phi), s = Math.sin(phi);
  const v1 = [c, s], v2 = [-s, c], h1 = [H[0] * v1[0] + H[1] * v1[1], H[2] * v1[0] + H[3] * v1[1]], h2 = [H[0] * v2[0] + H[1] * v2[1], H[2] * v2[0] + H[3] * v2[1]];
  const s1 = Math.hypot(h1[0], h1[1]), s2 = Math.hypot(h2[0], h2[1]);
  const u1 = s1 > 1e-300 ? [h1[0] / s1, h1[1] / s1] : [1, 0], u2 = s2 > 1e-12 * Math.max(s1, 1e-300) ? [h2[0] / s2, h2[1] / s2] : [-u1[1], u1[0]];
  return { U: [u1[0], u2[0], u1[1], u2[1]], V: [v1[0], v2[0], v1[1], v2[1]], s: [s1, s2] };
}
function kabschRef(P, Q) {
  const pc = centroid(P), qc = centroid(Q), H = [0, 0, 0, 0];
  for (let i = 0; i < P.length; i++) { const ax = P[i].x - pc.x, az = P[i].z - pc.z, bx = Q[i].x - qc.x, bz = Q[i].z - qc.z; H[0] += ax * bx; H[1] += ax * bz; H[2] += az * bx; H[3] += az * bz; }
  const f = svd2generic(H), U = f.U, V = f.V;
  const VU = [V[0] * U[0] + V[1] * U[1], V[0] * U[2] + V[1] * U[3], V[2] * U[0] + V[3] * U[1], V[2] * U[2] + V[3] * U[3]], dl = VU[0] * VU[3] - VU[1] * VU[2] < 0 ? -1 : 1;
  const R = [V[0] * U[0] + dl * V[1] * U[1], V[0] * U[2] + dl * V[1] * U[3], V[2] * U[0] + dl * V[3] * U[1], V[2] * U[2] + dl * V[3] * U[3]];
  const a = Math.atan2(R[2], R[0]);
  return { a, x: qc.x - (R[0] * pc.x + R[1] * pc.z), z: qc.z - (R[2] * pc.x + R[3] * pc.z) };
}

/* ───────────────────────────── B. the entry numbers ───────────────────────────── */
const WR = world('room', 0.01);
{
  /* same-beam pairing, at the true pose */
  const byBeam = new Map(WR.Q.map(q => [q.beam, q])), d = [];
  for (const p of WR.P) { const q = byBeam.get(p.beam); if (q) { const t = applyT(WR.Ts, p); d.push(Math.hypot(t.x - q.x, t.z - q.z)); } }
  facts.samebeam_rms = Math.sqrt(sum(d, x => x * x) / d.length);
  facts.pose_t = Math.hypot(WR.Ts.x, WR.Ts.z); facts.pose_a = WR.Ts.a / DEG;
  /* nearest-neighbour distances at the identity and at the true pose */
  const nnd = T => WR.P.map(p => { const q = applyT(T, p); return Math.sqrt(nnB(WR.Q, q.x, q.z).d2); });
  const d0 = nnd({ a: 0, x: 0, z: 0 }), d1 = nnd(WR.Ts);
  facts.id_med = 100 * med(d0); facts.id_rms = 100 * Math.sqrt(sum(d0, x => x * x) / d0.length);
  facts.tr_med = 100 * med(d1); facts.tr_p90 = 100 * quant(d1, 0.9); facts.tr_rms = 100 * Math.sqrt(sum(d1, x => x * x) / d1.length);
  facts.tr_gt30 = 100 * d1.filter(x => x > 0.3).length / d1.length; facts.tr_zero = d1.filter(x => x < 1e-9).length;
  const sp = []; for (let k = 1; k < WR.Q.length; k++) if (WR.Q[k].beam === WR.Q[k - 1].beam + 1) sp.push(Math.hypot(WR.Q[k].x - WR.Q[k - 1].x, WR.Q[k].z - WR.Q[k - 1].z));
  facts.spacing_med = 100 * med(sp);
  facts.n_beams = WR.P.length;
  ok('no scan-2 point lands exactly on a scan-1 point at the true pose', facts.tr_zero === 0);
}

/* ───────────────────────────── C. a reference ICP, and the monotone descent ───────────────────────────── */
function engineOf(W) {
  const mk = A => ({ n: A.length, x: Float64Array.from(A.map(a => a.x)), z: Float64Array.from(A.map(a => a.z)), beam: Int32Array.from(A.map(a => a.beam)), id: Int16Array.from(A.map(a => a.id)), nb: 180 });
  const src = mk(W.P), pq = mk(W.Q);
  return { src, mod: ICP.model(pq, { sigma: W.sigma }) };
}
/* the trimmed point-to-point error at pose T, from brute-force neighbours */
function fRef(W, T, keep) {
  const d = W.P.map(p => { const q = applyT(T, p); return nnB(W.Q, q.x, q.z).d2; }).sort((a, b) => a - b);
  const h = keep < 1 ? Math.max(3, Math.round(keep * d.length)) : d.length;
  return sum(d.slice(0, h), x => x);
}
function icpRefP2P(W, T0, keep, maxIter) {
  const P = W.P, Q = W.Q, path = []; let T = T0, converged = false, iters = maxIter;
  for (let k = 0; k < maxIter; k++) {
    const rows = P.map((p, i) => { const q = applyT(T, p), nn = nnB(Q, q.x, q.z); return { i, j: nn.j, d2: nn.d2 }; });
    let sel = rows;
    if (keep < 1) sel = rows.slice().sort((a, b) => a.d2 - b.d2 || a.i - b.i).slice(0, Math.max(3, Math.round(keep * rows.length)));
    path.push({ T, E: sum(sel, r => r.d2), used: sel.length });
    const K = kabschRef(sel.map(r => P[r.i]), sel.map(r => Q[r.j])), Tn = { a: K.a, x: K.x, z: K.z };
    const dT = Math.hypot(Tn.x - T.x, Tn.z - T.z), dA = Math.abs(wrap(Tn.a - T.a));
    T = Tn;
    if (dT < 1e-3 && dA < 1e-3) { converged = true; iters = k + 1; break; }
  }
  path.push({ T, E: fRef(W, T, keep), used: keep < 1 ? Math.max(3, Math.round(keep * P.length)) : P.length });
  return { path, T, converged, iters };
}
const poseEq = (A, B, tol) => Math.abs(wrap(A.a - B.a)) < tol && Math.abs(A.x - B.x) < tol && Math.abs(A.z - B.z) < tol;
const E_ROOM = engineOf(WR);
{
  /* the engine equals the reference, iterate by iterate, from the default start and from 24 other starts */
  const cases = [[25, 0.5, 40, 1]];
  const rngC = FL.rng(404);
  for (let k = 0; k < 24; k++) cases.push([-170 + 340 * rngC(), 2.5 * rngC(), 360 * rngC(), k % 3 === 0 ? 0.9 : 1]);
  let nBad = 0, worst = 0;
  for (const [d, t, ph, keep] of cases) {
    const T0 = startPose(WR, d, t, ph), ref = icpRefP2P(WR, T0, keep, 60), eng = ICP.run(E_ROOM.src, E_ROOM.mod, T0, { metric: 'p2p', keep, maxIter: 60 });
    if (ref.path.length !== eng.path.length || ref.converged !== eng.converged) { nBad++; console.error('path mismatch', d, t, ph, keep, ref.path.length, eng.path.length); continue; }
    for (let k = 0; k < ref.path.length; k++) {
      worst = Math.max(worst, Math.abs(wrap(ref.path[k].T.a - eng.path[k].T.a)), Math.abs(ref.path[k].T.x - eng.path[k].T.x), Math.abs(ref.path[k].T.z - eng.path[k].T.z), Math.abs(ref.path[k].E - eng.path[k].E));
    }
  }
  ok('engine ICP (grid neighbours, atan2 solve) == reference ICP (brute force, SVD route): same iterates', nBad === 0 && worst < 1e-8, [nBad, worst]);
}
{
  /* E never increases: 600 seeded starts over four kinds of data, three noise levels, trimming 1 / 0.9 / 0.75; E re-evaluated with brute-force neighbours */
  const rngM = FL.rng(909), worlds = {}, kinds = ['room', 'person', 'corridor', 'bearing'], sigmas = [0, 0.01, 0.03], keeps = [1, 0.9, 0.75];
  let runs = 0, steps = 0, maxRise = 0, converged = 0, rises = 0;
  for (let r = 0; r < 600; r++) {
    const kind = kinds[r % 4], sg = sigmas[Math.floor(r / 4) % 3], keep = keeps[Math.floor(r / 12) % 3], key = kind + sg;
    if (!worlds[key]) { const W = world(kind, sg); worlds[key] = { W, E: engineOf(W) }; }
    const { W, E } = worlds[key], T0 = startPose(W, -180 + 360 * rngM(), 3 * rngM(), 360 * rngM());
    const eng = ICP.run(E.src, E.mod, T0, { metric: 'p2p', keep, maxIter: 60 });
    let prev = Infinity;
    for (const st of eng.path) {
      const f = fRef(W, st.T, keep);
      if (f > prev + 1e-9 * Math.max(1, prev)) rises++;
      maxRise = Math.max(maxRise, f - prev); prev = f; steps++;
    }
    runs++; if (eng.converged) converged++;
  }
  ok('E (nearest-neighbour error) never increases along ICP', rises === 0, [rises, maxRise]);
  facts.mono_runs = runs; facts.mono_steps = steps; facts.mono_conv = converged;
  console.error('monotone: runs', runs, 'steps', steps, 'converged', converged);
}
{
  /* the table of one run: default start, point-to-point */
  const T0 = startPose(WR, 25, 0.5, 40), ref = icpRefP2P(WR, T0, 1, 60);
  facts.p2p_iters = ref.iters;
  const rows = [0, 1, 3, 10, ref.path.length - 1];
  rows.forEach((k, r) => {
    const e = poseErr(ref.path[k].T, WR.Ts);
    facts['it' + r + '_k'] = k; facts['it' + r + '_rms'] = 100 * Math.sqrt(ref.path[k].E / ref.path[k].used); facts['it' + r + '_dt'] = 100 * e.dt; facts['it' + r + '_da'] = e.da / DEG;
  });
  let nonmono = 0; for (let k = 1; k < ref.path.length; k++) if (poseErr(ref.path[k].T, WR.Ts).dt > poseErr(ref.path[k - 1].T, WR.Ts).dt + 1e-12) nonmono++;
  ok('the pose error of point-to-point ICP is not monotone although E is', nonmono > 0, nonmono);
  let best = Infinity, kb = 0; ref.path.forEach((st, k) => { const dt = poseErr(st.T, WR.Ts).dt; if (dt < best) { best = dt; kb = k; } });
  facts.p2p_best_dt = 100 * best; facts.p2p_best_k = kb;
  /* ICP has stopped at a fixed point: one more match+solve moves the pose by less than the tolerance */
  const more = icpRefP2P(WR, ref.T, 1, 3);
  ok('fixed point', Math.hypot(more.path[1].T.x - ref.T.x, more.path[1].T.z - ref.T.z) < 2e-3, more.path[1].T);
}

/* ───────────────────────────── E. point to line: reference normals and Gauss-Newton ───────────────────────────── */
/* line-fit normals, written separately from ICP.model: neighbours within +-3 beams and 1 m, RMS across the line below 0.01 + 1.5 sigma */
function normalsRef(Q, sigma) {
  const byBeam = new Map(Q.map((q, i) => [q.beam, i]));
  return Q.map(q => {
    const nbrs = [];
    for (let k = -3; k <= 3; k++) {
      const j = byBeam.get((((q.beam + k) % 180) + 180) % 180);
      if (j !== undefined && Math.hypot(Q[j].x - q.x, Q[j].z - q.z) <= 1.0) nbrs.push(Q[j]);
    }
    if (nbrs.length < 4) return null;
    const c = centroid(nbrs); let cxx = 0, cxz = 0, czz = 0;
    for (const p of nbrs) { cxx += (p.x - c.x) ** 2; cxz += (p.x - c.x) * (p.z - c.z); czz += (p.z - c.z) ** 2; }
    cxx /= nbrs.length; cxz /= nbrs.length; czz /= nbrs.length;
    const l2 = ((cxx + czz) - Math.sqrt((cxx - czz) ** 2 + 4 * cxz * cxz)) / 2;
    if (Math.sqrt(Math.max(l2, 0)) > 0.01 + 1.5 * sigma) return null;
    let nx = cxz, nz = l2 - cxx; if (Math.hypot(nx, nz) < 1e-12) { nx = l2 - czz; nz = cxz; }
    const len = Math.hypot(nx, nz); return { x: nx / len, z: nz / len };
  });
}

/* the step solve of the reference: eigen-decomposition by geom3's Jacobi routine, eigen-directions below 1e-3 of the largest eigenvalue are not moved */
function solveTruncRef(H, g, trunc) {
  const e = G3.eigSym(Array.from(H), 3), out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    if (trunc !== false && e.vals[k] <= 1e-3 * e.vals[0]) continue;
    const c = (e.vecs[k][0] * g[0] + e.vecs[k][1] * g[1] + e.vecs[k][2] * g[2]) / e.vals[k];
    for (let q = 0; q < 3; q++) out[q] += c * e.vecs[k][q];
  }
  return out;
}
function icpRefP2L(W, normals, T0, keep, maxIter, trunc) {
  const P = W.P, Q = W.Q, path = []; let T = T0, converged = false, iters = maxIter;
  const measure = T => P.map((p, i) => { const q = applyT(T, p), nn = nnB(Q, q.x, q.z), n = normals[nn.j]; return { i, j: nn.j, q, r: n ? n.x * (q.x - Q[nn.j].x) + n.z * (q.z - Q[nn.j].z) : NaN }; }).filter(x => !isNaN(x.r));
  const choose = rows => keep < 1 ? rows.slice().sort((a, b) => a.r * a.r - b.r * b.r || a.i - b.i).slice(0, Math.max(3, Math.round(keep * rows.length))) : rows;
  for (let k = 0; k < maxIter; k++) {
    const sel = choose(measure(T)), H = new Float64Array(9), g = new Float64Array(3);
    for (const x of sel) { const n = normals[x.j], J = [n.x, n.z, x.q.x * n.z - x.q.z * n.x]; for (let a = 0; a < 3; a++) { g[a] -= J[a] * x.r; for (let b = 0; b < 3; b++) H[a * 3 + b] += J[a] * J[b]; } }
    path.push({ T, E: sum(sel, x => x.r * x.r), used: sel.length });
    const xi = solveTruncRef(H, g, trunc), sc = Math.min(1, 1 / Math.max(1e-12, Math.abs(xi[0]), Math.abs(xi[1]), Math.abs(xi[2]) * 1.5)), dth = xi[2] * sc;
    const Tn = { a: T.a + dth, x: Math.cos(dth) * T.x - Math.sin(dth) * T.z + xi[0] * sc, z: Math.sin(dth) * T.x + Math.cos(dth) * T.z + xi[1] * sc };
    const dT = Math.hypot(Tn.x - T.x, Tn.z - T.z), dA = Math.abs(wrap(Tn.a - T.a));
    T = Tn;
    if (dT < 1e-3 && dA < 1e-3) { converged = true; iters = k + 1; break; }
  }
  const last = choose(measure(T)); path.push({ T, E: sum(last, x => x.r * x.r), used: last.length });
  return { path, T, converged, iters };
}
const NR_ROOM = normalsRef(WR.Q, WR.sigma);
{
  /* the engine's normals equal the reference normals; both are close to the true surface normals */
  let dif = 0, nv = 0, errs = [];
  for (let i = 0; i < WR.Q.length; i++) {
    ok('normal validity agrees', !!NR_ROOM[i] === !!E_ROOM.mod.ok[i], i);
    if (NR_ROOM[i]) {
      nv++; dif = Math.max(dif, Math.abs(Math.abs(NR_ROOM[i].x * E_ROOM.mod.nx[i] + NR_ROOM[i].z * E_ROOM.mod.nz[i]) - 1));
      const w = applyT(P1, WR.Q[i]), tn = FL.normal(ROOM, w.x, w.z); errs.push(Math.acos(Math.min(1, Math.abs(tn.x * NR_ROOM[i].x + tn.z * NR_ROOM[i].z))) / DEG);
    }
  }
  ok('engine normals == reference normals', dif < 1e-9, dif);
  facts.nrm_valid = nv; facts.nrm_med_err = med(errs);
  ok('normals are within a degree of the true ones (median)', facts.nrm_med_err < 1, facts.nrm_med_err);
}
{
  let nBad = 0, worst = 0;
  const cases = [[25, 0.5, 40, 1], [-40, 1.0, 200, 1], [60, 0.3, 100, 1], [10, 2.0, 300, 0.9]];
  for (const [d, t, ph, keep] of cases) {
    const T0 = startPose(WR, d, t, ph), ref = icpRefP2L(WR, NR_ROOM, T0, keep, 60), eng = ICP.run(E_ROOM.src, E_ROOM.mod, T0, { metric: 'p2l', keep, maxIter: 60 });
    if (ref.path.length !== eng.path.length) { nBad++; console.error('p2l path mismatch', d, t, ph, ref.path.length, eng.path.length); continue; }
    for (let k = 0; k < ref.path.length; k++) worst = Math.max(worst, Math.abs(wrap(ref.path[k].T.a - eng.path[k].T.a)), Math.abs(ref.path[k].T.x - eng.path[k].T.x), Math.abs(ref.path[k].T.z - eng.path[k].T.z));
  }
  ok('engine point-to-line ICP == reference Gauss-Newton ICP', nBad === 0 && worst < 1e-7, [nBad, worst]);
}

/* ───────────────────────────── D. the basin: 61 starting rotation errors, 6 degrees apart ───────────────────────────── */
function purityRef(W, T) { let hit = 0; for (const p of W.P) { const q = applyT(T, p); if (W.Q[nnB(W.Q, q.x, q.z).j].id === p.id) hit++; } return hit / W.P.length; }
function sweepRef(W, normals, metric, dt, keep) {
  const rows = [];
  for (let d = -180; d <= 180; d += 6) {
    const T0 = startPose(W, d, dt, 40), r = metric === 'p2p' ? icpRefP2P(W, T0, keep, 60) : icpRefP2L(W, normals, T0, keep, 60), e = poseErr(r.T, W.Ts);
    rows.push({ d, ok: good(e), dt: e.dt, da: e.da, rms: Math.sqrt(r.path[r.path.length - 1].E / r.path[r.path.length - 1].used), conv: r.converged, iters: r.iters, pur: purityRef(W, T0) });
  }
  return rows;
}
function sweepEng(E, W, metric, dt, keep) {
  return Array.from({ length: 61 }, (_, q) => {
    const d = -180 + 6 * q, T0 = startPose(W, d, dt, 40), r = ICP.run(E.src, E.mod, T0, { metric, keep, maxIter: 60 }), e = poseErr(r.T, W.Ts);
    return { d, ok: good(e), dt: e.dt, da: e.da, conv: r.converged, iters: r.iters };
  });
}
const interval = rows => { let i0 = rows.findIndex(r => r.d === 0), lo = i0, hi = i0; if (!rows[i0].ok) return null; while (lo > 0 && rows[lo - 1].ok) lo--; while (hi < rows.length - 1 && rows[hi + 1].ok) hi++; return [rows[lo].d, rows[hi].d]; };
const SW = {};
for (const metric of ['p2p', 'p2l']) {
  SW[metric] = sweepRef(WR, NR_ROOM, metric, 0.5, 1);
  const eng = sweepEng(E_ROOM, WR, metric, 0.5, 1);
  let bad = 0; SW[metric].forEach((r, q) => { if (r.ok !== eng[q].ok || r.conv !== eng[q].conv || r.iters !== eng[q].iters) bad++; });
  ok('basin sweep: engine classification == reference (' + metric + ')', bad === 0, bad);
  const iv = interval(SW[metric]), good_ = SW[metric].filter(r => r.ok), half = SW[metric].filter(r => !r.ok && r.da > 165 * DEG);
  facts['b_' + metric + '_lo'] = iv[0]; facts['b_' + metric + '_hi'] = iv[1]; facts['b_' + metric + '_ok'] = good_.length; facts['b_' + metric + '_half'] = half.length; facts['b_' + metric + '_rest'] = 61 - good_.length - half.length;
  facts['b_' + metric + '_rms_ok'] = 100 * med(good_.map(r => r.rms)); facts['b_' + metric + '_rms_half'] = 100 * med(half.map(r => r.rms));
  facts['b_' + metric + '_notconv'] = SW[metric].filter(r => !r.conv).length;
  const rest = SW[metric].filter(r => !r.ok && !(r.da > 165 * DEG));
  facts['b_' + metric + '_rest_rms'] = 100 * med(rest.map(r => r.rms)); facts['b_' + metric + '_rest_rms_min'] = 100 * Math.min(...rest.map(r => r.rms));
  ok('basin interval is contiguous and every success lies inside it (' + metric + ')', SW[metric].filter(r => r.ok && (r.d < iv[0] || r.d > iv[1])).length === 0);
}
{
  /* the widget's own sweep (ICP.sweep, with the right-wall diagnostic it plots) equals the reference rows */
  const Wd = ICP.world('room', 0.01);
  for (const metric of ['p2p', 'p2l']) {
    const sw = ICP.sweep(Wd, metric, 1, 0.5);
    let bad = 0, worstDt = 0, worstPur = 0;
    SW[metric].forEach((r, q) => { const e = sw.rows[q]; if (e.d !== r.d || e.ok !== r.ok) bad++; worstDt = Math.max(worstDt, Math.abs(e.dt - r.dt)); worstPur = Math.max(worstPur, Math.abs(e.pur - r.pur)); });
    ok('the widget sweep equals the reference rows (' + metric + ')', bad === 0 && worstDt < 1e-7 && worstPur < 1e-12, [bad, worstDt, worstPur]);
  }
}
{
  /* the right-wall share: table rows and edge values */
  const row = (m, d) => SW[m].find(r => r.d === d);
  [0, 30, 60, 90, 180].forEach((d, q) => { const r = row('p2p', d); facts['bt' + q + '_d'] = d; facts['bt' + q + '_pur'] = 100 * r.pur; facts['bt' + q + '_dt'] = 100 * r.dt; facts['bt' + q + '_da'] = r.da / DEG; facts['bt' + q + '_rms'] = 100 * r.rms; });
  facts.pur_default = 100 * purityRef(WR, startPose(WR, 25, 0.5, 40));                 // the widget's opening state (25 degrees, 0.5 m)
  const inside = SW.p2p.filter(r => r.ok), outside = SW.p2p.filter(r => !r.ok);
  facts.pur_in_min = 100 * Math.min(...inside.map(r => r.pur)); facts.pur_out_max = 100 * Math.max(...outside.map(r => r.pur));
  ok('right-wall share: the weakest start inside the point-to-point basin beats the best outside', facts.pur_in_min > facts.pur_out_max, [facts.pur_in_min, facts.pur_out_max]);
  facts.pur_at_edge_lo = 100 * row('p2p', facts.b_p2p_lo).pur; facts.pur_at_edge_hi = 100 * row('p2p', facts.b_p2p_hi).pur;
  ok('the half-turn answer has a larger residual than the true one', facts.b_p2p_rms_half > 2 * facts.b_p2p_rms_ok, [facts.b_p2p_rms_half, facts.b_p2p_rms_ok]);
}
{
  /* the basin shrinks as the position error grows (engine sweeps, spot-checked against the reference) */
  for (const dt of [0, 1, 2]) {
    for (const metric of ['p2p', 'p2l']) {
      const eng = sweepEng(E_ROOM, WR, metric, dt, 1), iv = interval(eng);
      facts['bdt' + dt + '_' + metric + '_lo'] = iv ? iv[0] : 0; facts['bdt' + dt + '_' + metric + '_hi'] = iv ? iv[1] : 0;
      for (const d of [-60, 0, 36, 66, 120]) {
        const T0 = startPose(WR, d, dt, 40), r = metric === 'p2p' ? icpRefP2P(WR, T0, 1, 60) : icpRefP2L(WR, NR_ROOM, T0, 1, 60), q = eng.find(x => x.d === d);
        ok(`engine == reference at start (${d} deg, ${dt} m, ${metric})`, good(poseErr(r.T, WR.Ts)) === q.ok, [d, dt, metric]);
      }
    }
  }
}

/* ───────────────────────────── E (continued). iteration counts over 171 seeded starts; the tangential share ───────────────────────────── */
{
  const rows = [];
  for (let d = -45; d <= 45; d += 5) for (const dt of [0.3, 0.6, 1.0]) for (const ph of [40, 160, 280]) {
    const T0 = startPose(WR, d, dt, ph), a = icpRefP2P(WR, T0, 1, 100), b = icpRefP2L(WR, NR_ROOM, T0, 1, 100);
    const ea = ICP.run(E_ROOM.src, E_ROOM.mod, T0, { metric: 'p2p', maxIter: 100 }), eb = ICP.run(E_ROOM.src, E_ROOM.mod, T0, { metric: 'p2l', maxIter: 100 });
    ok('stat starts: engine iteration counts == reference', a.iters === ea.iters && b.iters === eb.iters, [d, dt, ph, a.iters, ea.iters, b.iters, eb.iters]);
    rows.push({ a, b, ea: poseErr(a.T, WR.Ts), eb: poseErr(b.T, WR.Ts) });
  }
  const both = rows.filter(r => good(r.ea) && good(r.eb));
  facts.st_n = rows.length; facts.st_both = both.length; facts.st_p2p_fail = rows.length - rows.filter(r => good(r.ea)).length; facts.st_p2l_fail = rows.length - rows.filter(r => good(r.eb)).length;
  facts.st_p2p_it = sum(both, r => r.a.iters) / both.length; facts.st_p2l_it = sum(both, r => r.b.iters) / both.length;
  facts.st_p2p_med = med(both.map(r => r.a.iters)); facts.st_p2l_med = med(both.map(r => r.b.iters));
  facts.st_p2p_max = Math.max(...both.map(r => r.a.iters)); facts.st_p2l_max = Math.max(...both.map(r => r.b.iters));
  facts.st_fewer = both.filter(r => r.b.iters < r.a.iters).length;
  facts.st_ratio_med = med(both.map(r => r.a.iters / r.b.iters));
  facts.st_p2p_err = 100 * sum(both, r => r.ea.dt) / both.length; facts.st_p2l_err = 100 * sum(both, r => r.eb.dt) / both.length;
  facts.st_p2p_rot = sum(both, r => r.ea.da) / both.length / DEG; facts.st_p2l_rot = sum(both, r => r.eb.da) / both.length / DEG;
  ok('point-to-line needs fewer iterations in every paired start', facts.st_fewer === both.length, [facts.st_fewer, both.length]);
  ok('point-to-line is the more accurate in every paired start', both.every(r => r.eb.dt < r.ea.dt), 'accuracy');
}
{
  /* the tangential share of the point-to-point error: split each residual along the model normal and along the wall */
  const split = T => {
    let en = 0, et = 0, c = 0; const tans = [];
    for (const p of WR.P) { const q = applyT(T, p), nn = nnB(WR.Q, q.x, q.z), n = NR_ROOM[nn.j]; if (!n) continue; const rx = q.x - WR.Q[nn.j].x, rz = q.z - WR.Q[nn.j].z, rn = n.x * rx + n.z * rz, rt = -n.z * rx + n.x * rz; en += rn * rn; et += rt * rt; c++; tans.push(Math.abs(rt)); }
    return { share: et / (en + et), rmsn: Math.sqrt(en / c), rmst: Math.sqrt(et / c), medt: med(tans) };
  };
  const t0 = split(WR.Ts), ref = icpRefP2P(WR, startPose(WR, 25, 0.5, 40), 1, 60), t1 = split(ref.T), t2 = split(startPose(WR, 25, 0.5, 40));
  facts.tan_truth = 100 * t0.share; facts.tan_rmsn = 100 * t0.rmsn; facts.tan_rmst = 100 * t0.rmst; facts.tan_medt = 100 * t0.medt; facts.tan_end = 100 * t1.share; facts.tan_start = 100 * t2.share;
  /* a scene without the pillars and the shelf: no shadows, only the sampling */
  const WW = world('room', 0.01); const wallsOnly = { name: 'walls', shapes: ROOM.shapes.slice(0, 4), light: ROOM.light, amb: ROOM.amb, bg: ROOM.bg, far: ROOM.far, stepScale: ROOM.stepScale };
  const mkW = sc => { const mk = (pose, seed) => FL.lidar(sc, pose, { n: 180, sigma: 0.01, range: 14, rng: FL.rng(seed) }).map((b, j) => b.ok ? { x: b.lx, z: b.lz, id: b.id, beam: j } : null).filter(Boolean); return Object.assign({}, WW, { P: mk(WW.p2, 12), Q: mk(WW.p1, 11) }); };
  const W2 = mkW(wallsOnly), N2 = normalsRef(W2.Q, 0.01), T0 = startPose(W2, 25, 0.5, 40);
  const a = icpRefP2P(W2, T0, 1, 100), b = icpRefP2L(W2, N2, T0, 1, 100);
  facts.walls_p2p_it = a.iters; facts.walls_p2l_it = b.iters; facts.walls_p2p_err = 100 * poseErr(a.T, W2.Ts).dt; facts.walls_p2l_err = 100 * poseErr(b.T, W2.Ts).dt;
  ok('without shadows point-to-point is still biased and still slower', facts.walls_p2p_err > 3 * facts.walls_p2l_err && a.iters > 3 * b.iters, [facts.walls_p2p_err, facts.walls_p2l_err, a.iters, b.iters]);
  const rp = icpRefP2L(WR, NR_ROOM, startPose(WR, 25, 0.5, 40), 1, 60), ep = poseErr(rp.T, WR.Ts);
  facts.p2l_iters = rp.iters; facts.p2l_err = 100 * ep.dt; facts.p2l_rot = ep.da / DEG; facts.p2p_err = 100 * poseErr(ref.T, WR.Ts).dt; facts.p2p_rot = poseErr(ref.T, WR.Ts).da / DEG;
  facts.p2p_rms_end = 100 * Math.sqrt(ref.path[ref.path.length - 1].E / ref.path[ref.path.length - 1].used); facts.p2l_rms_end = 100 * Math.sqrt(rp.path[rp.path.length - 1].E / rp.path[rp.path.length - 1].used);
  facts.p2l_rms0 = 100 * Math.sqrt(rp.path[0].E / rp.path[0].used);
}

/* ───────────────────────────── F. the corridor ───────────────────────────── */
function normalMatrixRef(W, normals, T) {
  const H = new Array(9).fill(0); let n = 0;
  for (const p of W.P) { const q = applyT(T, p), nn = nnB(W.Q, q.x, q.z), nr = normals[nn.j]; if (!nr) continue; const J = [nr.x, nr.z, q.x * nr.z - q.z * nr.x]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a * 3 + b] += J[a] * J[b]; n++; }
  const e = G3.eigSym(H, 3); return { n, vals: e.vals.slice().reverse(), vecs: e.vecs.slice().reverse() };      // ascending
}
const WC = world('corridor', 0.01), NR_COR = normalsRef(WC.Q, 0.01), E_COR = engineOf(WC);
{
  const room = normalMatrixRef(WR, NR_ROOM, WR.Ts), cor = normalMatrixRef(WC, NR_COR, WC.Ts);
  const engR = ICP.normalMatrix(E_ROOM.src, E_ROOM.mod, WR.Ts), engC = ICP.normalMatrix(E_COR.src, E_COR.mod, WC.Ts);
  for (let k = 0; k < 3; k++) { ok('normal-matrix eigenvalue (room) engine == reference', close(engR.vals[k], room.vals[k], 1e-6 * room.vals[2]), [engR.vals[k], room.vals[k]]); ok('normal-matrix eigenvalue (corridor) engine == reference', close(engC.vals[k], cor.vals[k], 1e-6 * cor.vals[2]), [engC.vals[k], cor.vals[k]]); }
  facts.room_l0 = room.vals[0]; facts.room_l1 = room.vals[1]; facts.room_l2 = room.vals[2]; facts.cor_l0 = cor.vals[0]; facts.cor_l1 = cor.vals[1]; facts.cor_l2 = cor.vals[2];
  facts.cor_axis = Math.abs(cor.vecs[0][0]); facts.room_pairs = room.n; facts.cor_pairs = cor.n;
  ok('the weakest direction of the corridor is a slide along its axis', facts.cor_axis > 0.999, facts.cor_axis);
  ok('the room is well constrained, the corridor is not', facts.room_l0 > 100 * facts.cor_l0, [facts.room_l0, facts.cor_l0]);
  /* noise-free: exactly singular */
  const W0 = world('corridor', 0), E0 = engineOf(W0), m0 = ICP.normalMatrix(E0.src, E0.mod, W0.Ts);
  ok('noise-free corridor: smallest eigenvalue is zero (to 1e-3, against a largest of hundreds)', Math.abs(m0.vals[0]) < 1e-3 && m0.vals[2] > 100, m0.vals);
  facts.cor_l0_clean = Math.abs(m0.vals[0]);
  /* the hand example: two walls 2 m apart, 5 points each, then an end wall of 3 points */
  const rows = []; for (let x = -2; x <= 2; x++) { rows.push([0, 1, x]); rows.push([0, -1, -x]); }
  const hh = rs => { const H = new Array(9).fill(0); for (const J of rs) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a * 3 + b] += J[a] * J[b]; return H; };
  const e1 = ICP.eig3(hh(rows)), end = []; for (const z of [-1, 0, 1]) end.push([-1, 0, z]);
  const e2 = ICP.eig3(hh(rows.concat(end))), g1 = G3.eigSym(hh(rows), 3), g2 = G3.eigSym(hh(rows.concat(end)), 3);
  ok('hand example eigenvalues', close(e1.vals[0], 0, 1e-12) && close(e1.vals[1], 10, 1e-12) && close(e1.vals[2], 20, 1e-12) && close(e2.vals[0], 3, 1e-12) && close(e2.vals[1], 10, 1e-12) && close(e2.vals[2], 22, 1e-12) && close(g2.vals[2], 3, 1e-12), [e1.vals, e2.vals]);
  facts.hx_a0 = e1.vals[0]; facts.hx_a1 = e1.vals[1]; facts.hx_a2 = e1.vals[2]; facts.hx_b0 = e2.vals[0]; facts.hx_b1 = e2.vals[1]; facts.hx_b2 = e2.vals[2]; facts.hx_sd = 1 / Math.sqrt(e2.vals[0]);
  void g1;
}
{
  /* ICP in the corridor: start 0.5 m away in direction 40 degrees (0.38 m along the axis), 3 degrees off */
  const T0 = startPose(WC, 3, 0.5, 40), along0 = T0.x - WC.Ts.x;
  const a = icpRefP2P(WC, T0, 1, 60), b = icpRefP2L(WC, NR_COR, T0, 1, 60), ea = ICP.run(E_COR.src, E_COR.mod, T0, { metric: 'p2p', maxIter: 60 }), eb = ICP.run(E_COR.src, E_COR.mod, T0, { metric: 'p2l', maxIter: 60 });
  ok('corridor: engine == reference (p2p)', poseEq(a.T, ea.T, 1e-7) && a.iters === ea.iters, [a.T, ea.T]);
  ok('corridor: engine == reference (p2l, truncated solve)', poseEq(b.T, eb.T, 1e-7) && b.iters === eb.iters, [b.T, eb.T]);
  const pa = poseErr(a.T, WC.Ts), pb = poseErr(b.T, WC.Ts);
  facts.cor_start_along = 100 * Math.abs(along0); facts.cor_p2l_err = 100 * pb.dt; facts.cor_p2p_err = 100 * pa.dt; facts.cor_p2l_it = b.iters; facts.cor_p2p_it = a.iters;
  facts.cor_p2l_rms = 100 * Math.sqrt(b.path[b.path.length - 1].E / b.path[b.path.length - 1].used); facts.cor_p2p_rms = 100 * Math.sqrt(a.path[a.path.length - 1].E / a.path[a.path.length - 1].used);
  facts.cor_p2l_across = 100 * Math.abs(b.T.z - WC.Ts.z); facts.cor_p2l_rot = pb.da / DEG;
  ok('corridor: point-to-line fixes the cross-corridor offset and the angle but not the slide', Math.abs(100 * pb.dt - facts.cor_start_along) < 5 && facts.cor_p2l_across < 1.5 && facts.cor_p2l_rot < 0.5, [pb.dt, along0, facts.cor_p2l_across, facts.cor_p2l_rot]);
  ok('corridor: point-to-point does not fix the slide either', pa.dt > 0.8 * Math.abs(along0), [pa.dt, along0]);
  /* without the rule that leaves weak eigen-directions unmoved, noise sets the step along the slide and the run never settles */
  const bf = icpRefP2L(WC, NR_COR, T0, 1, 60, false), errs = bf.path.map(st => 100 * poseErr(st.T, WC.Ts).dt).slice(1);
  facts.cor_full_conv = bf.converged ? 1 : 0; facts.cor_full_it = bf.iters; facts.cor_full_lo = Math.min(...errs); facts.cor_full_hi = Math.max(...errs);
  ok('corridor: with the full solve the point-to-line run does not settle in 60 iterations', !bf.converged && bf.iters === 60, [bf.converged, bf.iters]);
  ok('corridor: the full-solve run wanders along the slide (error spread of a few cm), the truncated run does not', facts.cor_full_hi - facts.cor_full_lo > 1 && Math.abs(100 * pb.dt - facts.cor_start_along) < 5, [facts.cor_full_lo, facts.cor_full_hi]);
  ok('corridor: point-to-line reports a near-perfect fit at the wrong pose', facts.cor_p2l_rms < 2 && facts.cor_p2l_err > 30, [facts.cor_p2l_rms, facts.cor_p2l_err]);
}

/* ───────────────────────────── G. a person walks through scan 2; trimming ───────────────────────────── */
const WP = world('person', 0.01), NR_PER = normalsRef(WP.Q, 0.01), E_PER = engineOf(WP);
{
  const onPerson = WP.P.filter(p => p.id === 7).length;
  facts.per_beams = onPerson; facts.per_share = 100 * onPerson / WP.P.length;
  const T0 = startPose(WP, 25, 0.5, 40), out = {};
  for (const [metric, keep] of [['p2p', 1], ['p2p', 0.9], ['p2l', 1], ['p2l', 0.9]]) {
    const r = metric === 'p2p' ? icpRefP2P(WP, T0, keep, 60) : icpRefP2L(WP, NR_PER, T0, keep, 60), e = ICP.run(E_PER.src, E_PER.mod, T0, { metric, keep, maxIter: 60 });
    ok(`person ${metric}/${keep}: engine == reference`, poseEq(r.T, e.T, 1e-7) && r.iters === e.iters, [r.T, e.T]);
    const pe = poseErr(r.T, WP.Ts), k = metric + (keep < 1 ? 't' : '');
    facts['per_' + k + '_err'] = 100 * pe.dt; facts['per_' + k + '_rot'] = pe.da / DEG; facts['per_' + k + '_it'] = r.iters; out[k] = pe;
  }
  ok('a person pulls both error measures off by more than 10 cm', out.p2p.dt > 0.10 && out.p2l.dt > 0.10, [out.p2p.dt, out.p2l.dt]);
  ok('dropping the worst 10 % of pairs puts both back within 2 cm', out.p2pt.dt < 0.02 && out.p2lt.dt < 0.02, [out.p2pt.dt, out.p2lt.dt]);
  /* the room alone: trimming also removes most of the shadow bias of point-to-point */
  const r = icpRefP2P(WR, startPose(WR, 25, 0.5, 40), 0.9, 60); facts.trim_room_p2p_err = 100 * poseErr(r.T, WR.Ts).dt; facts.trim_room_p2p_it = r.iters;
  /* the price: a narrower basin (engine sweeps) */
  for (const metric of ['p2p', 'p2l']) { const iv = interval(sweepEng(E_ROOM, WR, metric, 0.5, 0.9)); facts['trim_' + metric + '_lo'] = iv ? iv[0] : 0; facts['trim_' + metric + '_hi'] = iv ? iv[1] : 0; }
  ok('trimming narrows the point-to-line basin', facts.trim_p2l_lo > facts.b_p2l_lo || facts.trim_p2l_hi < facts.b_p2l_hi, [facts.trim_p2l_lo, facts.trim_p2l_hi]);
}

/* ───────────────────────────── H. bearings only (what a camera row gives) ───────────────────────────── */
const WB = world('bearing', 0.01), E_BEA = engineOf(WB), NR_BEA = normalsRef(WB.Q, 0.01);
{
  const T0 = startPose(WB, 25, 0.5, 40), a = icpRefP2P(WB, T0, 1, 60), b = icpRefP2L(WB, NR_BEA, T0, 1, 60);
  const ea = ICP.run(E_BEA.src, E_BEA.mod, T0, { metric: 'p2p', maxIter: 60 }), eb = ICP.run(E_BEA.src, E_BEA.mod, T0, { metric: 'p2l', maxIter: 60 });
  ok('bearings: engine == reference', poseEq(a.T, ea.T, 1e-7) && poseEq(b.T, eb.T, 1e-7), [a.T, ea.T, b.T, eb.T]);
  facts.bear_p2p_err = 100 * poseErr(a.T, WB.Ts).dt; facts.bear_p2l_err = 100 * poseErr(b.T, WB.Ts).dt; facts.bear_t = 100 * facts.pose_t;
  facts.bear_p2p_rms = 100 * Math.sqrt(a.path[a.path.length - 1].E / a.path[a.path.length - 1].used); facts.bear_p2l_rms = 100 * Math.sqrt(b.path[b.path.length - 1].E / b.path[b.path.length - 1].used);
  facts.bear_p2p_it = a.iters; facts.bear_p2l_it = b.iters; facts.bear_p2p_cx = 100 * Math.hypot(a.T.x, a.T.z); facts.bear_p2l_cx = 100 * Math.hypot(b.T.x, b.T.z);
  ok('bearings only: a (near-)perfect fit at a pose as far from the truth as the sensor moved', facts.bear_p2p_rms < 1 && Math.abs(facts.bear_p2p_err - facts.bear_t) < 1 && Math.abs(facts.bear_p2l_err - facts.bear_t) < 1, [facts.bear_p2p_rms, facts.bear_p2p_err, facts.bear_t]);
  ok('bearings only: ICP puts the two sensors at the same place', facts.bear_p2p_cx < 1 && facts.bear_p2l_cx < 1, [facts.bear_p2p_cx, facts.bear_p2l_cx]);
  /* the same ICP with ranges */
  facts.rng_err = facts.p2l_err; facts.rng_rms = facts.p2l_rms_end;
}

/* ───────────────────────────── I. counting a search over poses ───────────────────────────── */
{
  const nt = 301, na = 361;                                   // +-1.5 m at 1 cm in each of x and z, +-45 degrees at 0.25 degrees
  facts.grid_nt = nt; facts.grid_poses_m = nt * nt * na / 1e6; facts.grid_lookups_bn = nt * nt * na * WR.P.length / 1e9; facts.grid_iters = facts.p2p_iters;
}

/* ───────────────────────────── noise: does 6 cm change the story? ───────────────────────────── */
{
  const W6 = world('room', 0.06), N6 = normalsRef(W6.Q, 0.06), T0 = startPose(W6, 25, 0.5, 40), a = icpRefP2P(W6, T0, 1, 60), b = icpRefP2L(W6, N6, T0, 1, 60);
  facts.nz6_p2p_it = a.iters; facts.nz6_p2l_it = b.iters; facts.nz6_p2p_err = 100 * poseErr(a.T, W6.Ts).dt; facts.nz6_p2l_err = 100 * poseErr(b.T, W6.Ts).dt; facts.nz6_p2l_rot = poseErr(b.T, W6.Ts).da / DEG;
  ok('6 cm of range noise leaves both runs in the right place', good(poseErr(a.T, W6.Ts)) && good(poseErr(b.T, W6.Ts)), [facts.nz6_p2p_err, facts.nz6_p2l_err]);
  ok('6 cm of range noise: point-to-line still needs far fewer iterations and stays more accurate', b.iters * 3 < a.iters && facts.nz6_p2l_err < facts.nz6_p2p_err, [a.iters, b.iters]);
}

/* ───────────────────────────── J. drive the page's own widget into every state the prose quotes ───────────────────────────── */
const PAGE = path.join(DIR, '04_pose_by_agreement_icp.html');
const nBeforeJ = nChecks;
if (!fs.existsSync(PAGE)) console.error('page not built yet: part J (the widget) skipped');
else {
const page = loadPage(path.join(DIR, '04_pose_by_agreement_icp.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function setAll(s) { page.set('w04-data', s.data); page.set('w04-metric', s.metric); page.check('w04-trim', !!s.trim); page.set('w04-sig', s.sig); page.set('w04-tr', s.tr); page.set('w04-rot', s.rot); }
const readPair = id => { const m = /([\d.]+) cm · ([\d.]+)°/.exec(page.text(id)); return m ? { dt: +m[1], da: +m[2] } : null; };
const readBasin = () => { const t = page.text('w04-m-basin'); if (t === 'none') return null; const m = /([−+-]?\d+)° … ([−+-]?\d+)°/.exec(t); return m ? [+m[1].replace('−', '-'), +m[2].replace('−', '-')] : undefined; };
const rmsOf = st => 100 * Math.sqrt(st.E / st.used);
const WCACHE = {};
function reference(s) {
  const key = s.data + s.sig; if (!WCACHE[key]) { const W = world(s.data, s.sig / 100); WCACHE[key] = { W, N: normalsRef(W.Q, s.sig / 100) }; }
  const { W, N } = WCACHE[key], T0 = startPose(W, s.rot, s.tr, 40), keep = s.trim ? 0.9 : 1;
  const run = (metric, from) => metric === 'p2p' ? icpRefP2P(W, T0, keep, 60) : icpRefP2L(W, N, T0, keep, 60);
  return { W, N, T0, keep, r: run(s.metric) };
}
const REF_SWEEPS = {};
function driveCheck(label, s, o) {
  o = o || {};
  setAll(s);
  const R = reference(s), pe = poseErr(R.r.T, R.W.Ts), p0 = R.r.path[0], pl = R.r.path[R.r.path.length - 1], e0 = readPair('w04-m-err'), en = readPair('w04-m-end');
  ok(label + ': iteration readout', page.text('w04-m-it') === `0 / ${R.r.iters}`, [page.text('w04-m-it'), R.r.iters]);
  ok(label + ': RMS at iteration 0', close(page.num('w04-m-rms'), rmsOf(p0), 0.051), [page.num('w04-m-rms'), rmsOf(p0)]);
  ok(label + ': pose error at iteration 0', e0 && close(e0.dt, 100 * poseErr(R.T0, R.W.Ts).dt, 0.051) && close(e0.da, poseErr(R.T0, R.W.Ts).da / DEG, 0.0051), e0);
  ok(label + ': pose error at the end', en && close(en.dt, 100 * pe.dt, 0.051) && close(en.da, pe.da / DEG, 0.0051), [en, 100 * pe.dt, pe.da / DEG]);
  ok(label + ': iterations to stop', page.num('w04-m-out') === R.r.iters, [page.text('w04-m-out'), R.r.iters]);
  const verdict = R.r.converged ? (good(pe) ? 'right place' : 'wrong place') : 'not converged';
  ok(label + ': verdict', page.text('w04-m-out').endsWith(verdict), [page.text('w04-m-out'), verdict]);
  const lam = normalMatrixRef(R.W, R.N, R.r.T).vals[0];
  ok(label + ': weakest direction', close(page.num('w04-m-lam'), lam, 0.0051 + 1e-3 * Math.abs(lam)), [page.num('w04-m-lam'), lam]);
  const sk = `${s.data}|${s.sig}|${s.metric}|${s.tr}|${R.keep}`;
  if (!REF_SWEEPS[sk]) REF_SWEEPS[sk] = interval(sweepRef(R.W, R.N, s.metric, s.tr, R.keep));
  const bw = readBasin(), br = REF_SWEEPS[sk];
  ok(label + ': basin', (br === null && bw === null) || (br && bw && br[0] === bw[0] && br[1] === bw[1]), [bw, br]);
  page.click('w04-step'); ok(label + ': step button', page.text('w04-m-it') === `${Math.min(1, R.r.iters)} / ${R.r.iters}`, page.text('w04-m-it'));
  page.click('w04-run'); const pn = readPair('w04-m-err');
  ok(label + ': run button', page.text('w04-m-it') === `${R.r.iters} / ${R.r.iters}` && close(page.num('w04-m-rms'), rmsOf(pl), 0.051) && pn && close(pn.dt, 100 * pe.dt, 0.051), [page.text('w04-m-it'), page.num('w04-m-rms'), rmsOf(pl)]);
  page.click('w04-reset'); ok(label + ': reset button', page.text('w04-m-it') === `0 / ${R.r.iters}`);
  return { R, pe, lam, basin: br };
}
const base = { data: 'room', metric: 'p2p', trim: false, sig: 1, tr: 0.5, rot: 25 };
const st = (o) => Object.assign({}, base, o);
{
  const a = driveCheck('default point-to-point', base);
  ok('default state quotes', close(100 * Math.sqrt(a.R.r.path[0].E / a.R.r.path[0].used), facts.it0_rms, 1e-6) && a.R.r.iters === facts.p2p_iters && close(100 * a.pe.dt, facts.p2p_err, 1e-9) && close(a.pe.da / DEG, facts.p2p_rot, 1e-9) && close(rmsOf(a.R.r.path[a.R.r.path.length - 1]), facts.p2p_rms_end, 1e-9));
  facts.w_room_lam = a.lam;
  ok('default basin quotes', a.basin[0] === facts.b_p2p_lo && a.basin[1] === facts.b_p2p_hi, [a.basin, facts.b_p2p_lo, facts.b_p2p_hi]);
  const b = driveCheck('default point-to-line', st({ metric: 'p2l' }));
  ok('point-to-line quotes', b.R.r.iters === facts.p2l_iters && close(100 * b.pe.dt, facts.p2l_err, 1e-9) && b.basin[0] === facts.b_p2l_lo && b.basin[1] === facts.b_p2l_hi, [b.R.r.iters, b.basin]);
}
for (const metric of ['p2p', 'p2l']) {
  const a = driveCheck('position error 2 m ' + metric, st({ metric, tr: 2 }));
  ok('position error 2 m basin quotes (' + metric + ')', a.basin[0] === facts['bdt2_' + metric + '_lo'] && a.basin[1] === facts['bdt2_' + metric + '_hi'], [a.basin]);
}
{
  const a = driveCheck('180 degrees', st({ rot: 180 }));
  ok('180-degree start quotes', close(100 * a.pe.dt, facts.bt4_dt, 1e-9) && close(rmsOf(a.R.r.path[a.R.r.path.length - 1]), facts.bt4_rms, 1e-9));
  driveCheck('noise 6 cm point-to-point', st({ sig: 6 })); driveCheck('noise 6 cm point-to-line', st({ sig: 6, metric: 'p2l' }));
}
{
  const a = driveCheck('trim, room, point-to-point', st({ trim: true }));
  ok('trim quotes', a.R.r.iters === facts.trim_room_p2p_it && close(100 * a.pe.dt, facts.trim_room_p2p_err, 1e-9) && a.basin[0] === facts.trim_p2p_lo && a.basin[1] === facts.trim_p2p_hi, [a.R.r.iters, a.basin]);
  const b = driveCheck('trim, room, point-to-line', st({ trim: true, metric: 'p2l' }));
  ok('trim quotes (point-to-line)', b.basin[0] === facts.trim_p2l_lo && b.basin[1] === facts.trim_p2l_hi, [b.basin]);
}
for (const [metric, trim, key] of [['p2p', false, 'p2p'], ['p2p', true, 'p2pt'], ['p2l', false, 'p2l'], ['p2l', true, 'p2lt']]) {
  const a = driveCheck(`person ${metric} trim=${trim}`, st({ data: 'person', metric, trim }));
  ok(`person quotes (${key})`, close(100 * a.pe.dt, facts['per_' + key + '_err'], 1e-9) && a.R.r.iters === facts['per_' + key + '_it'], [100 * a.pe.dt, facts['per_' + key + '_err']]);
}
for (const metric of ['p2p', 'p2l']) {
  const a = driveCheck('corridor ' + metric, st({ data: 'corridor', metric, rot: 3 }));
  ok('corridor quotes (' + metric + ')', close(100 * a.pe.dt, facts['cor_' + metric + '_err'], 1e-9) && a.R.r.iters === facts['cor_' + metric + '_it'], [100 * a.pe.dt, facts['cor_' + metric + '_err']]);
  ok('corridor basin reads none', a.basin === null, a.basin);
  if (metric === 'p2l') { facts.w_cor_lam = a.lam; ok('corridor: the widget weakest direction is tiny', a.lam < 0.5, a.lam); }
}
for (const metric of ['p2p', 'p2l']) {
  const a = driveCheck('bearings ' + metric, st({ data: 'bearing', metric }));
  ok('bearings quotes (' + metric + ')', close(100 * a.pe.dt, facts['bear_' + metric + '_err'], 1e-9) && a.R.r.iters === facts['bear_' + metric + '_it'] && a.basin === null, [100 * a.pe.dt]);
}
/* controls must restart the display; a slider move during a run goes back to iteration 0 */
setAll(base); page.click('w04-run'); page.set('w04-rot', 26); ok('moving a slider restarts at iteration 0', /^0 \//.test(page.text('w04-m-it')));
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));

  console.error(`part J (the page's own widget): ${nChecks - nBeforeJ} assertions`);
}

console.error(fails ? `${fails} check(s) FAILED` : `all ${nChecks} checks passed`);
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
