#!/usr/bin/env node
/* Oracle for 3D lesson 05, "Pose by agreement II: images alone".
 *
 * What is independent here.  The scene, the pinhole, the noise contract (FL.rng / FL.randn streams), the essential matrix,
 * the eight-point solve (own design matrix, null vector by an eigen-decomposition that is checked by its residual, own
 * projection onto (mu, mu, 0)), the decomposition (cofactor identity R = [t]x^T E + cof(E), not the SVD route of the engine),
 * the cheirality test (midpoint triangulation, not the engine's DLT), the Sampson distance, RANSAC (own loop, own random
 * streams), the trial-count formula (brute force) and its simulation, the reprojection residual with a finite-difference
 * Jacobian, a Levenberg-Marquardt loop written from the lesson's rules, the gauge (invariance, null vectors, spectrum), and
 * the held-out numbers.  The page's widget is then driven into every state its "What to try" paragraph describes and must
 * print what these independent computations say.  Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const G3 = require(path.join(DIR, 'geom3.js'));
const BA = require(path.join(DIR, 'ba3.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const PI = Math.PI, deg = 180 / PI;

/* ── small linear algebra, written here so the checks do not lean on the engine's helpers ── */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sca = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const nrm = a => Math.sqrt(dot(a, a));
const scm = (A, s) => A.map(v => v * s), addm = (A, B) => A.map((v, i) => v + B[i]), subm = (A, B) => A.map((v, i) => v - B[i]);
const unit = a => sca(a, 1 / nrm(a));
const mul = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; };
const trn = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const skew = t => [0, -t[2], t[1], t[2], 0, -t[0], -t[1], t[0], 0];
const det3 = A => A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
const cof = A => [A[4] * A[8] - A[5] * A[7], -(A[3] * A[8] - A[5] * A[6]), A[3] * A[7] - A[4] * A[6], -(A[1] * A[8] - A[2] * A[7]), A[0] * A[8] - A[2] * A[6], -(A[0] * A[7] - A[1] * A[6]), A[1] * A[5] - A[2] * A[4], -(A[0] * A[5] - A[2] * A[3]), A[0] * A[4] - A[1] * A[3]];
const eye = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const fro = A => Math.sqrt(A.reduce((s, v) => s + v * v, 0));
const rodr = w => { const th = nrm(w), K = skew(w), K2 = mul(K, K); const a = th < 1e-8 ? 1 - th * th / 6 : Math.sin(th) / th, b = th < 1e-8 ? 0.5 - th * th / 24 : (1 - Math.cos(th)) / (th * th); return eye().map((v, i) => v + a * K[i] + b * K2[i]); };
const angOf = R => Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)));
const orth = R => { const E = mul(trn(R), R); for (let i = 0; i < 3; i++) E[4 * i] -= 1; return fro(E); };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
function eigsym(A, n) {     // eigenvalues/eigenvectors by G3.eigSym, with the residual checked here
  const e = G3.eigSym(A, n); let worst = 0;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += A[i * n + j] * e.vecs[k][j]; worst = Math.max(worst, Math.abs(s - e.vals[k] * e.vecs[k][i])); }
  const scale = Math.max(1e-300, Math.abs(e.vals[0]), Math.abs(e.vals[n - 1]));
  ok('eigen-decomposition residual', worst < 1e-9 * Math.max(1, scale), worst);
  return e;
}

/* ── the scene, rebuilt from its definition ── */
const F = 520, W = 640, H = 480, CX = 320, CY = 240, D = 7, NP = 80, NU = 20, NC = 5, ARC = 28, NPX = W * H;
const hal = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const PTS = []; for (let k = 1; k <= NP; k++) PTS.push([(hal(k, 2) - 0.5) * 6, (hal(k, 3) - 0.5) * 3.6, D + (hal(k, 5) - 0.5) * 4]);
function camPose(dg) { const p = dg / deg, c = Math.cos(p), s = Math.sin(p), R = [c, 0, s, 0, 1, 0, -s, 0, c], C = [D * s, 0, D - D * c]; return { R, C, t: sca(mv(R, C), -1) }; }
const CAMS = []; for (let i = 0; i < NC; i++) CAMS.push(camPose(-ARC + 2 * ARC * i / (NC - 1)));
const HELD = camPose(21);
function proj(cam, X) { const q = add(mv(cam.R, X), cam.t); return [CX + F * q[0] / q[2], CY + F * q[1] / q[2], q[2]]; }
const norm2 = u => [(u[0] - CX) / F, (u[1] - CY) / F];
{
  const sc = BA.scene({ nCam: NC, nPts: NP });
  let worst = 0;
  for (let k = 0; k < NP; k++) for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(sc.X[k][a] - PTS[k][a]));
  for (let i = 0; i < NC; i++) { for (let a = 0; a < 9; a++) worst = Math.max(worst, Math.abs(sc.cams[i].R[a] - CAMS[i].R[a])); for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(sc.cams[i].t[a] - CAMS[i].t[a])); }
  const h2 = BA.camAt(sc, 21); for (let a = 0; a < 9; a++) worst = Math.max(worst, Math.abs(h2.R[a] - HELD.R[a]));
  ok('engine scene == scene rebuilt from its definition', worst < 1e-12, worst);
  // every point is inside every image
  let inside = true; for (const c of CAMS.concat([HELD])) for (const p of PTS) { const q = proj(c, p); if (q[2] <= 0 || q[0] < 20 || q[0] > W - 20 || q[1] < 20 || q[1] > H - 20) inside = false; }
  ok('all points visible in all cameras', inside);
  ok('G3.project agrees with the pinhole written here', Math.abs(G3.project(sc.cams[1], PTS[7])[0] - proj(CAMS[1], PTS[7])[0]) < 1e-9);
}
// the relative pose of camera 2 with respect to camera 0:  x2 = R12 x0 + t12
const R12 = mul(CAMS[2].R, trn(CAMS[0].R)), t12 = sub(CAMS[2].t, mv(R12, CAMS[0].t)), t12u = unit(t12);
ok('cameras 0 and 2 are 28 degrees apart', close(angOf(R12) * deg, 28, 1e-9), angOf(R12) * deg);
facts.base_deg = angOf(R12) * deg;
// "ask that the matched pixels coincide": how far apart are the two pixels of a true match (cameras 0 and 2, all 80 points)?
{ let sd = 0; for (const p of PTS) { const a = proj(CAMS[0], p), b = proj(CAMS[2], p); sd += Math.hypot(a[0] - b[0], a[1] - b[1]); } facts.coincide_px = sd / NP; ok('matched pixels do not coincide: mean displacement far above the 0.5 px noise', facts.coincide_px > 20, facts.coincide_px); }

/* the noise contract: z = FL.randn stream of FL.rng(seed); a match uses 4 normals (u1, v1, u2, v2) */
const stream = (n, seed) => { const rng = FL.rng(seed), z = []; for (let i = 0; i < n; i++) z.push(FL.randn(rng)); return z; };
function plan(n, seed) { const rng = FL.rng(seed), perm = [], pos = []; for (let i = 0; i < n; i++) perm.push(i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; } for (let i = 0; i < n; i++) pos.push([0.15 + 0.7 * rng(), 0.15 + 0.7 * rng()]); return { perm, pos }; }
const PLAN = plan(NP, 777);
function makeMatches(sigma, seed, frac, n) {
  n = n || NP; const z = stream(4 * n, seed), u1 = [], u2 = [], bad = new Array(n).fill(false);
  for (let k = 0; k < n; k++) { const a = proj(CAMS[0], PTS[k]), b = proj(CAMS[2], PTS[k]); u1.push([a[0] + sigma * z[4 * k], a[1] + sigma * z[4 * k + 1]]); u2.push([b[0] + sigma * z[4 * k + 2], b[1] + sigma * z[4 * k + 3]]); }
  const nb = Math.round(frac * n); for (let k = 0; k < nb; k++) { const id = PLAN.perm[k]; bad[id] = true; u2[id] = [W * PLAN.pos[id][0], H * PLAN.pos[id][1]]; }
  return { u1, u2, x1: u1.map(norm2), x2: u2.map(norm2), bad };
}

/* ── 1. the counting argument, and "the rays meet" ── */
{
  // Flatland: any two rays of two random cameras meet (non-parallel lines in a plane always cross)
  const rng = FL.rng(3); let all = true;
  for (let n = 0; n < 3000; n++) {
    const A = FL.camera({ x: -3 + 6 * rng(), z: 6 * rng(), a: 0.8 + 1.4 * rng(), f: 44, W: 120 }), B = FL.camera({ x: -3 + 6 * rng(), z: 6 * rng(), a: 0.8 + 1.4 * rng(), f: 44, W: 120 });
    const ra = FL.pixelRay(A, 120 * rng()), rb = FL.pixelRay(B, 120 * rng()), it = FL.intersect(ra.ox, ra.oz, ra.dx, ra.dz, rb.ox, rb.oz, rb.dx, rb.dz);
    if (Math.abs(ra.dx * rb.dz - ra.dz * rb.dx) > 1e-6 && !(it.ok && isFinite(it.x))) all = false;
  }
  ok('in a plane, rays of random pixels always meet (no constraint per match)', all);
  // space: the rays of random pixel pairs under a random pose generically miss each other
  let miss = 0, tot = 0; const rng2 = FL.rng(9);
  const gap = (o1, d1, o2, d2) => { const n = crs(d1, d2); return Math.abs(dot(sub(o2, o1), n)) / nrm(n); };
  for (let n = 0; n < 2000; n++) {
    const p1 = [(rng2() - 0.5) * 0.8, (rng2() - 0.5) * 0.6, 1], p2 = [(rng2() - 0.5) * 0.8, (rng2() - 0.5) * 0.6, 1];
    const c2 = camPose(-20 + 40 * rng2()).C, R = rodr([0.1 * (rng2() - .5), 0.5 * (rng2() - .5), 0.1 * (rng2() - .5)]);
    if (gap([0, 0, 0], p1, c2, mv(trn(R), p2)) > 1e-3) miss++; tot++;
  }
  ok('in space, random pixel pairs almost never give meeting rays', miss / tot > 0.99, miss / tot);
  // and the rays of a true match do meet, while those of a match under a 1 degree rotation error do not
  let g0 = 0, g1 = 0; const Rerr = rodr([0, 1 / deg, 0]);
  for (let k = 0; k < NP; k++) {
    const p1 = [...norm2(proj(CAMS[0], PTS[k])), 1], p2 = [...norm2(proj(CAMS[2], PTS[k])), 1], c2 = sca(mv(trn(R12), t12), -1);
    g0 = Math.max(g0, gap([0, 0, 0], p1, c2, mv(trn(R12), p2)));
    g1 = Math.max(g1, gap([0, 0, 0], p1, c2, mv(trn(mul(Rerr, R12)), p2)));
  }
  ok('true matches: rays meet', g0 < 1e-12, g0); ok('1 degree of rotation error: rays miss', g1 > 1e-3, g1);
}

/* ── 2. the epipolar constraint, E, its structure and its degrees of freedom ── */
const Etrue = mul(skew(t12u), R12);
{
  let worst = 0, worstDepth = 0;
  for (let k = 0; k < NP; k++) {
    const a = proj(CAMS[0], PTS[k]), b = proj(CAMS[2], PTS[k]), p1 = [...norm2(a), 1], p2 = [...norm2(b), 1];
    worst = Math.max(worst, Math.abs(dot(p2, mv(Etrue, p1))));
    // lambda2 p2 = lambda1 R p1 + t, with lambda the depths
    const lhs = sca(p2, b[2]), rhs = add(sca(mv(R12, p1), a[2]), t12);
    worstDepth = Math.max(worstDepth, nrm(sub(lhs, rhs)));
  }
  ok('p2^T E p1 = 0 for exact matches', worst < 1e-12, worst);
  ok('lambda2 p2 = lambda1 R p1 + t', worstDepth < 1e-12, worstDepth);
  const EEt = mul(Etrue, trn(Etrue)), want = eye().map((v, i) => v - t12u[Math.floor(i / 3)] * t12u[i % 3]);
  ok('E E^T = |t|^2 I - t t^T', fro(EEt.map((v, i) => v - want[i])) < 1e-12);
  const ev = eigsym(EEt, 3).vals; ok('singular values of E are (|t|, |t|, 0)', close(ev[0], 1, 1e-12) && close(ev[1], 1, 1e-12) && Math.abs(ev[2]) < 1e-12, ev);
  ok('left null vector of E is t', nrm(mv(trn(Etrue), t12u)) < 1e-12);
  ok('degrees of freedom: 3 + 3 - 1 = 9 - 1 - 3 = 5', 3 + 3 - 1 === 5 && 9 - 1 - 3 === 5);
  ok('one linear row per match, 9 unknowns up to scale: 8 matches', 9 - 1 === 8);
}

/* own eight-point: the design matrix, the null vector, the projection onto (mu, mu, 0) */
function designATA(x1, x2) {
  const A = new Float64Array(81);
  for (let i = 0; i < x1.length; i++) { const p = [x1[i][0], x1[i][1], 1], q = [x2[i][0], x2[i][1], 1], row = []; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) row.push(q[a] * p[b]); for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) A[a * 9 + b] += row[a] * row[b]; }
  return A;
}
function myEight(x1, x2) {
  const e = eigsym(designATA(x1, x2), 9), E = e.vecs[8];                       // smallest eigenvalue's vector
  const EtE = mul(trn(E), E), s = eigsym(EtE, 3), s1 = Math.sqrt(s.vals[0]), s2 = Math.sqrt(s.vals[1]);
  const v1 = s.vecs[0], v2 = s.vecs[1], u1 = sca(mv(E, v1), 1 / s1), u2 = sca(mv(E, v2), 1 / s2), sig = (s1 + s2) / 2, out = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[3 * i + j] = sig * (u1[i] * v1[j] + u2[i] * v2[j]);
  return out;
}
const sameUpToSign = (A, B) => { const a = scm(A, 1 / fro(A)), b = scm(B, 1 / fro(B)); return Math.min(fro(a.map((v, i) => v - b[i])), fro(a.map((v, i) => v + b[i]))); };
{
  const m = makeMatches(0, 1, 0), E = myEight(m.x1, m.x2);
  ok('eight-point on exact matches returns the true E (up to sign and scale)', sameUpToSign(E, Etrue) < 1e-9, sameUpToSign(E, Etrue));
  ok('engine eight-point agrees with the one written here', sameUpToSign(BA.eight(m.x1, m.x2), E) < 1e-9);
  const lam = eigsym(designATA(m.x1, m.x2), 9).vals;
  ok('exactly one null direction for a scene with depth', Math.abs(lam[8]) < 1e-12 && lam[7] > 1e-4, [lam[7], lam[8]]);
  facts.lg_norm = Math.log10(lam[0] / lam[7]);
  // the same with raw pixel coordinates (design rows built from pixels)
  const rawA = designATA(m.u1.map(u => [u[0], u[1]]), m.u2.map(u => [u[0], u[1]])), lamR = eigsym(rawA, 9).vals;
  facts.lg_raw = Math.log10(lamR[0] / lamR[7]);
  // a minimiser check: no random unit vector beats the null vector
  const rng = FL.rng(4); let best = Infinity; for (let n = 0; n < 2000; n++) { const v = Array.from({ length: 9 }, () => rng() - 0.5), nv = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); let q = 0; for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) q += v[a] * designATA(m.x1, m.x2)[a * 9 + b] * v[b] / nv / nv; best = Math.min(best, q); }
  ok('the null vector minimises |Ae|', best >= lam[8] - 1e-12);
  // planar scene: the null space is not one-dimensional
  const rp = FL.rng(6), pl = []; for (let k = 0; k < 40; k++) pl.push([(rp() - 0.5) * 6, (rp() - 0.5) * 3.6, D]);
  const lp = eigsym(designATA(pl.map(p => norm2(proj(CAMS[0], p))), pl.map(p => norm2(proj(CAMS[2], p)))), 9).vals;
  facts.plane_null = lp.filter(v => Math.abs(v) < 1e-12).length;
  ok('a plane leaves a null space of dimension 3 (not 1)', facts.plane_null === 3 && lp[5] > 1e-6, lp.slice(4));
}

/* the decomposition by the cofactor identity, and cheirality by midpoint triangulation */
function candidates(E) {
  const En = scm(E, Math.SQRT2 / fro(E));                                        // scale so that |t| = 1: E = [t]x R  =>  |E|_F = sqrt(2)
  const col = k => [En[k], En[3 + k], En[6 + k]];
  const t = unit([crs(col(0), col(1)), crs(col(0), col(2)), crs(col(1), col(2))].sort((a, b) => nrm(b) - nrm(a))[0]);   // every column of E is perpendicular to t
  const RA = addm(mul(trn(skew(t)), En), cof(En)), RB = subm(cof(En), mul(trn(skew(t)), En));
  return [{ R: RA, t }, { R: RA, t: sca(t, -1) }, { R: RB, t }, { R: RB, t: sca(t, -1) }];
}
function midpoint(p1, p2, R, t) {
  const c2 = sca(mv(trn(R), t), -1), d1 = p1, d2 = mv(trn(R), p2);
  const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2), dd = dot(d1, c2), e = dot(d2, c2), den = a * c - b * b;
  const s = (c * dd - b * e) / den, u = (b * dd - a * e) / den, P1 = sca(d1, s), P2 = add(c2, sca(d2, u));
  return sca(add(P1, P2), 0.5);
}
function myPose(E, x1, x2) {
  const cs = candidates(E);
  cs.forEach(c => { c.front = 0; c.valid = Math.abs(det3(c.R) - 1) < 1e-6 && orth(c.R) < 1e-6; for (let i = 0; i < x1.length; i++) { const X = midpoint([...x1[i], 1], [...x2[i], 1], c.R, c.t); if (X[2] > 0 && add(mv(c.R, X), c.t)[2] > 0) c.front++; } });
  let best = cs[0]; cs.forEach(c => { if (c.valid && c.front > best.front || !best.valid) best = c; });
  return { R: best.R, t: best.t, cands: cs };
}
const relErr = (R, t, Rt, tt) => ({ rot: angOf(mul(trn(R), Rt)) * deg, dir: Math.acos(Math.max(-1, Math.min(1, dot(unit(t), unit(tt))))) * deg });
{
  const m = makeMatches(0, 1, 0), E = myEight(m.x1, m.x2), P = myPose(E, m.x1, m.x2), cs = P.cands;
  ok('all four candidates are rotations', cs.every(c => c.valid), cs.map(c => c.valid));
  // each candidate reproduces E up to sign
  ok('every candidate satisfies [t]x R = +-E', cs.every(c => sameUpToSign(mul(skew(c.t), c.R), E) < 1e-9));
  // the twisted pair: R_B = (half turn about t) R_A
  const Rpi = eye().map((v, i) => 2 * cs[0].t[Math.floor(i / 3)] * cs[0].t[i % 3] - v);
  ok('the two rotations differ by a half turn about the baseline', fro(mul(Rpi, cs[0].R).map((v, i) => v - cs[2].R[i])) < 1e-9);
  const counts = cs.map(c => c.front).sort((a, b) => b - a);
  ok('exactly one candidate puts every point in front (exact data)', counts[0] === NP && counts[1] === 0 && counts[2] === 0 && counts[3] === 0, counts);
  const e = relErr(P.R, P.t, R12, t12u); ok('pose from exact matches equals the truth', e.rot < 1e-6 && e.dir < 1e-6, e);
  // against the engine's own SVD route
  const q = BA.recoverPose(BA.eight(m.x1, m.x2), m.x1, m.x2), e2 = relErr(q.R, q.t, R12, t12u); ok('engine pose from exact matches equals the truth', e2.rot < 1e-6 && e2.dir < 1e-6, e2);
  ok('the engine decomposition never returns a non-rotation', (() => { const rng = FL.rng(11); for (let i = 0; i < 400; i++) { const w = [(rng() - .5) * 1.2, (rng() - .5) * 1.2, (rng() - .5) * 1.2], t = unit([rng() - .5, rng() - .5, rng() - .5]); for (const c of BA.decomposeE(mul(skew(t), rodr(w)))) if (orth(c.R) > 1e-9 || Math.abs(det3(c.R) - 1) > 1e-9) return false; } return true; })());
  // geom3's own decomposeE fails on rank-2 input (reported to the lead; the lesson works around it)
  let badG3 = 0; { const rng = FL.rng(11); for (let i = 0; i < 400; i++) { const w = [(rng() - .5) * 1.2, (rng() - .5) * 1.2, (rng() - .5) * 1.2], t = unit([rng() - .5, rng() - .5, rng() - .5]); if (G3.decomposeE(mul(skew(t), rodr(w))).some(c => orth(c.R) > 1e-6)) badG3++; } }
  console.error('note: G3.decomposeE returned a non-rotation for ' + badG3 + ' of 400 exact essential matrices');
  // scale: the whole scene and the baseline multiplied by s change no pixel
  let worst = 0;
  for (const s of [3.7, 0.2]) for (let k = 0; k < NP; k += 3) for (const i of [0, 2]) {
    const a = proj(CAMS[i], PTS[k]), Xs = sca(PTS[k], s), Cs = sca(CAMS[i].C, s), q = mv(CAMS[i].R, sub(Xs, Cs)), u = [CX + F * q[0] / q[2], CY + F * q[1] / q[2]];
    worst = Math.max(worst, Math.abs(u[0] - a[0]), Math.abs(u[1] - a[1]));
  }
  ok('scene and baseline scaled by s: no pixel moves', worst < 1e-9, worst);
  facts.gauge_dof = 3 + 3 + 1;
  facts.ch1 = counts[0]; facts.ch2 = counts[1]; facts.ch3 = counts[2]; facts.ch4 = counts[3];
}

/* ── 3. accuracy of the eight-point vs noise: 100 draws, independent pipeline ── */
function sampsonOwn(E, a, b) { const Ea = mv(E, [a[0], a[1], 1]), Etb = mv(trn(E), [b[0], b[1], 1]); return F * Math.abs(b[0] * Ea[0] + b[1] * Ea[1] + Ea[2]) / Math.sqrt(Ea[0] * Ea[0] + Ea[1] * Ea[1] + Etb[0] * Etb[0] + Etb[1] * Etb[1]); }
const rmsOver = (E, m, idx) => Math.sqrt(mean(idx.map(j => sampsonOwn(E, m.x1[j], m.x2[j]) ** 2)));
const ALL = Array.from({ length: NP }, (_, k) => k);
function eightStats(sigma, draws) {
  const r = [], d = [], s = [], st = [];
  for (let seed = 1; seed <= draws; seed++) {
    const m = makeMatches(sigma, seed, 0), E = myEight(m.x1, m.x2), P = myPose(E, m.x1, m.x2), e = relErr(P.R, P.t, R12, t12u);
    r.push(e.rot); d.push(e.dir); s.push(rmsOver(E, m, ALL)); st.push(rmsOver(Etrue, m, ALL));
  }
  return { rot: mean(r), dir: mean(d), samp: mean(s), sampTrue: mean(st) };
}
{
  const s25 = eightStats(0.25, 100), s50 = eightStats(0.5, 100), s100 = eightStats(1, 100);
  facts.r25 = s25.rot; facts.r50 = s50.rot; facts.r100 = s100.rot; facts.d25 = s25.dir; facts.d50 = s50.dir; facts.d100 = s100.dir;
  facts.s25 = s25.samp; facts.s50 = s50.samp; facts.s100 = s100.samp; facts.strue50 = s50.sampTrue;
  ok('error is proportional to the noise (rotation)', close(s100.rot / s50.rot, 2, 0.15) && close(s50.rot / s25.rot, 2, 0.15), [s25.rot, s50.rot, s100.rot]);
  ok('the true pose leaves the noise itself: epipolar RMS = sigma', close(s50.sampTrue, 0.5, 0.03), s50.sampTrue);
  ok('the eight-point pose leaves a larger epipolar error than the true pose', s50.samp > 1.8 * s50.sampTrue, [s50.samp, s50.sampTrue]);
  facts.shift_px = F * Math.tan(s50.rot / deg);
  // engine pipeline gives the same numbers as the one written here, draw by draw
  let worst = 0; for (const seed of [1, 2, 3, 40, 99]) { const m = makeMatches(0.5, seed, 0), mine = relErr(myPose(myEight(m.x1, m.x2), m.x1, m.x2).R, myPose(myEight(m.x1, m.x2), m.x1, m.x2).t, R12, t12u); const sc = BA.scene({ nCam: NC, nPts: NP }); const e = BA.twoView(sc, { I: 0, J: 2, sig: 0.5, z: BA.noiseField(4 * NP, seed), frac: 0, plan: BA.outlierPlan(NP, 777), robust: false }).err; worst = Math.max(worst, Math.abs(e.rot - mine.rot), Math.abs(e.dir - mine.dir)); }
  ok('engine two-view pipeline == independent pipeline', worst < 1e-6, worst);
}

/* ── 4. wrong matches and RANSAC ── */
function myRansac(x1, x2, seed, thr, p, maxIter) {
  const n = x1.length, rng = FL.rng(seed); let bestE = null, bestInl = [], N = maxIter, it = 0;
  const cons = E => { const o = []; for (let j = 0; j < n; j++) if (sampsonOwn(E, x1[j], x2[j]) < thr) o.push(j); return o; };
  const fit = idx => myEight(idx.map(j => x1[j]), idx.map(j => x2[j]));
  while (it < N && it < maxIter) {
    it++; const idx = []; while (idx.length < 8) { const j = Math.floor(rng() * n); if (!idx.includes(j)) idx.push(j); }
    let E = fit(idx), inl = cons(E);
    if (inl.length > bestInl.length) {
      for (let r = 0; r < 8 && inl.length >= 8; r++) { const E2 = fit(inl), i2 = cons(E2); if (i2.length <= inl.length) { if (i2.length === inl.length) { E = E2; inl = i2; } break; } E = E2; inl = i2; }
      bestE = E; bestInl = inl; const w = inl.length / n; N = Math.min(maxIter, Math.ceil(Math.log(1 - p) / Math.log(1 - Math.pow(w, 8))));
    }
  }
  return { E: bestE, inl: bestInl, iters: it, N };
}
{
  // the formula, by brute force, and the table
  const Nbrute = (w, s, p) => { const q = Math.pow(w, s); let n = 1; while (Math.pow(1 - q, n) > 1 - p) n++; return n; };
  const tab = [[0.75, 8, 'q75', 'N75'], [0.5, 8, 'q50', 'N50'], [0.5, 5, 'q50s5', 'N50s5'], [0.3, 8, 'q30', 'N30']];
  for (const [w, s, kq, kn] of tab) { const N = Math.ceil(Math.log(0.01) / Math.log(1 - Math.pow(w, s))); ok('formula == brute force, w=' + w + ' s=' + s, N === Nbrute(w, s, 0.99) && N === BA.trials(w, s, 0.99), [N, Nbrute(w, s, 0.99)]); facts[kq] = Math.pow(w, s); facts[kn] = N; }
  facts.N60 = BA.trials(0.6, 8, 0.95); facts.N60s5 = BA.trials(0.6, 5, 0.95); facts.q60 = Math.pow(0.6, 8); facts.q60s5 = Math.pow(0.6, 5);
  ok('N for w = 0.6, p = 0.95 by brute force', facts.N60 === Nbrute(0.6, 8, 0.95) && facts.N60s5 === Nbrute(0.6, 5, 0.95), [facts.N60, facts.N60s5]);
  // simulation: at least one clean draw in N trials, draws without replacement from n matches
  function sim(n, w, s, N, runs, seed) {
    const rng = FL.rng(seed), k = Math.round(w * n), idx = new Int32Array(s); let hit = 0;
    for (let r = 0; r < runs; r++) {
      let clean = false;
      for (let t = 0; t < N && !clean; t++) { let all = true; for (let a = 0; a < s; a++) { let j, dup; do { j = Math.floor(rng() * n); dup = false; for (let b = 0; b < a; b++) if (idx[b] === j) dup = true; } while (dup); idx[a] = j; if (j >= k) all = false; } if (all) clean = true; }
      if (clean) hit++;
    }
    return hit / runs;
  }
  const s75 = sim(500, 0.75, 8, 44, 20000, 31), s50 = sim(500, 0.5, 8, 1177, 6000, 32), s5 = sim(500, 0.5, 5, 146, 20000, 33);
  facts.sim75 = s75; facts.sim50 = s50; facts.sim50s5 = s5;
  for (const [v, nm] of [[s75, 'w=.75'], [s50, 'w=.5 s=8'], [s5, 'w=.5 s=5']]) ok('simulated success near 0.99 (' + nm + ')', Math.abs(v - 0.99) < 0.006, v);
  facts.sim80 = sim(80, 0.5, 8, 1177, 6000, 34);
  // the exact value for a short list: hypergeometric
  { let q = 1; for (let i = 0; i < 8; i++) q *= (40 - i) / (80 - i); const ex = 1 - Math.pow(1 - q, 1177); ok('n = 80: simulation matches the hypergeometric value', Math.abs(facts.sim80 - ex) < 0.01, [facts.sim80, ex]); }
  // plain eight-point with wrong matches (this lesson's widget draw: seed 215)
  const mk = (frac, seed) => makeMatches(0.5, seed, frac);
  const plain = (frac, seed) => { const m = mk(frac, seed), E = myEight(m.x1, m.x2), P = myPose(E, m.x1, m.x2); return relErr(P.R, P.t, R12, t12u); };
  const w0 = plain(0, 215), w5 = plain(0.05, 215), w25 = plain(0.25, 215);
  facts.w_rot0 = w0.rot; facts.w_dir0 = w0.dir; facts.bad5_rot = w5.rot; facts.bad25_rot = w25.rot; facts.bad25_dir = w25.dir;
  ok('plain eight-point is wrecked by 4 wrong matches of 80', w5.rot > 10, w5.rot);
  // RANSAC statistics over 100 noise draws (independent implementation, independent random streams)
  let okR = 0, okP = 0, trials = [], rotsR = [], caught = 0, kept = 0, nb = Math.round(0.25 * NP);
  for (let seed = 1; seed <= 100; seed++) {
    const m = mk(0.25, seed), rs = myRansac(m.x1, m.x2, 7000 + seed, 4, 0.99, 1500), P = myPose(rs.E, rs.inl.map(j => m.x1[j]), rs.inl.map(j => m.x2[j])), e = relErr(P.R, P.t, R12, t12u);
    if (e.rot < 2) okR++; rotsR.push(e.rot); trials.push(rs.iters); caught += m.bad.filter((b, j) => b && !rs.inl.includes(j)).length; kept += rs.inl.filter(j => !m.bad[j]).length;
    const Pp = myPose(myEight(m.x1, m.x2), m.x1, m.x2); if (relErr(Pp.R, Pp.t, R12, t12u).rot < 2) okP++;
  }
  facts.rs25_ok = okR; facts.plain25_ok = okP; facts.rs25_trials = mean(trials);
  ok('RANSAC recovers the pose within 2 degrees in >= 90 of 100 draws (25 % wrong)', okR >= 90, okR); ok('plain eight-point never does', okP === 0, okP);
  console.error('RANSAC (own) 25% wrong: success ' + okR + '/100, mean rot ' + mean(rotsR).toFixed(2) + ', mean trials ' + mean(trials).toFixed(0) + ', wrong rejected ' + (caught / (100 * nb)).toFixed(3) + ', right kept ' + (kept / (100 * (NP - nb))).toFixed(3));
  // the engine's RANSAC on the widget's draw
  const sc = BA.scene({ nCam: NC, nPts: NP }), eng = BA.twoView(sc, { I: 0, J: 2, sig: 0.5, z: BA.noiseField(4 * NP, 215), frac: 0.25, plan: BA.outlierPlan(NP, 777), robust: true, thr: 4, seed: 1 });
  const bad = eng.m.bad, rejected = bad.filter((b, j) => b && !eng.inl.includes(j)).length, keptRight = eng.inl.filter(j => !bad[j]).length;
  ok('consensus set = matches within 4 px of the returned E', (() => { const set = new Set(eng.inl); for (let j = 0; j < NP; j++) if ((sampsonOwn(eng.E, eng.m.x1[j], eng.m.x2[j]) < 4) !== set.has(j)) return false; return true; })());
  ok('the loop stopped at N(w-hat)', eng.rs.iters >= eng.rs.N && eng.rs.N === BA.trials(eng.inl.length / NP, 8, 0.99), [eng.rs.iters, eng.rs.N]);
  facts.inl25 = keptRight; facts.rej25 = rejected; facts.rs25_rot = eng.err.rot; facts.rs25_iters = eng.rs.iters; facts.rs25_N = eng.rs.N; facts.rs25_dir = eng.err.dir;
  ok('RANSAC keeps every right match and rejects every wrong one on the widget draw', keptRight === NP - nb && rejected === nb, [keptRight, rejected]);
}

/* ── 5. bundle adjustment: residuals, finite-difference Jacobian, an LM loop written from the lesson's rules ── */
const se3exp = xi => { const w = xi.slice(3), th = nrm(w), K = skew(w), K2 = mul(K, K), b = th < 1e-8 ? 0.5 : (1 - Math.cos(th)) / (th * th), c = th < 1e-8 ? 1 / 6 : (th - Math.sin(th)) / (th * th * th); const V = eye().map((v, i) => v + b * K[i] + c * K2[i]); return { R: rodr(w), t: mv(V, xi.slice(0, 3)) }; };
{
  // the engine's twist exponential against the one written here
  const rng = FL.rng(2); let worst = 0; for (let i = 0; i < 100; i++) { const xi = Array.from({ length: 6 }, () => (rng() - .5) * 2), a = G3.se3.exp(xi), b = se3exp(xi); worst = Math.max(worst, fro(a.R.map((v, k) => v - b.R[k])), nrm(sub(a.t, b.t))); }
  ok('twist exponential: engine == written here', worst < 1e-12, worst);
}
const compose = (A, B) => ({ R: mul(A.R, B.R), t: add(mv(A.R, B.t), A.t) });
function state0() { return { cams: CAMS.map(c => ({ R: c.R.slice(), t: c.t.slice() })), X: PTS.slice(0, NU).map(p => p.slice()) }; }
function perturbOwn(st, eps, zp) {
  const cams = st.cams.map((T, i) => { const z = zp.slice(6 * i, 6 * i + 6); return compose(se3exp([eps * 0.12 * z[0], eps * 0.12 * z[1], eps * 0.12 * z[2], eps * 0.02 * z[3], eps * 0.02 * z[4], eps * 0.02 * z[5]]), T); });
  const X = st.X.map((p, j) => { const o = 6 * NC + 3 * j; return [p[0] + eps * 0.12 * zp[o], p[1] + eps * 0.12 * zp[o + 1], p[2] + eps * 0.12 * zp[o + 2]]; });
  return { cams, X };
}
function observeOwn(sigma, zb) { const obs = []; let c = 0; for (let i = 0; i < NC; i++) { const row = []; for (let j = 0; j < NU; j++) { const q = proj(CAMS[i], PTS[j]); row.push([q[0] + sigma * zb[c], q[1] + sigma * zb[c + 1]]); c += 2; } obs.push(row); } return obs; }
function resOwn(st, obs) { const r = []; for (let i = 0; i < NC; i++) for (let j = 0; j < NU; j++) { const q = proj(st.cams[i], st.X[j]); r.push(q[0] - obs[i][j][0], q[1] - obs[i][j][1]); } return r; }
const rmsOf = r => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length);
function stepOwn(st, d) { return { cams: st.cams.map((T, i) => compose(se3exp(Array.from(d.slice(6 * i, 6 * i + 6))), T)), X: st.X.map((p, j) => { const o = 6 * NC + 3 * j; return [p[0] + d[o], p[1] + d[o + 1], p[2] + d[o + 2]]; }) }; }
const NUNK = 6 * NC + 3 * NU;
function jacOwn(st, obs) {          // central differences in the tangent coordinates of the current iterate
  const nres = 2 * NC * NU, J = new Float64Array(nres * NUNK), h = 1e-6;
  for (let k = 0; k < NUNK; k++) { const dp = new Float64Array(NUNK), dm = new Float64Array(NUNK); dp[k] = h; dm[k] = -h; const rp = resOwn(stepOwn(st, dp), obs), rm = resOwn(stepOwn(st, dm), obs); for (let r = 0; r < nres; r++) J[r * NUNK + k] = (rp[r] - rm[r]) / (2 * h); }
  return J;
}
function normalOwn(J, r, n) { const nres = r.length, H = new Float64Array(n * n), g = new Float64Array(n); for (let k = 0; k < nres; k++) for (let a = 0; a < n; a++) { const ja = J[k * n + a]; if (ja === 0) continue; g[a] += ja * r[k]; for (let b = 0; b < n; b++) H[a * n + b] += ja * J[k * n + b]; } return { H, g }; }
function cholSolve(A, b, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]; if (i === j) { if (s <= 1e-18) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j]; }
  const y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}
function lmOwn(st, obs, iters, fixed) {      // the rules of the lesson: damp with lam*diag, accept if the error fell, lam/3 else lam*4
  const free = []; for (let k = 0; k < NUNK; k++) if (!fixed.includes(k)) free.push(k);
  let lam = 1e-3, cur = st, r = resOwn(cur, obs), trace = [rmsOf(r)], m = free.length;
  for (let it = 0; it < iters; it++) {
    const J = jacOwn(cur, obs), { H, g } = normalOwn(J, r, NUNK); let done = false;
    for (let tries = 0; tries < 16 && !done; tries++) {
      const A = new Float64Array(m * m), b = new Float64Array(m);
      for (let a = 0; a < m; a++) { b[a] = -g[free[a]]; for (let c = 0; c < m; c++) A[a * m + c] = H[free[a] * NUNK + free[c]]; A[a * m + a] += lam * (H[free[a] * NUNK + free[a]] + 1e-12); }
      const d = cholSolve(A, b, m);
      if (d) { const full = new Float64Array(NUNK); free.forEach((k, a) => { full[k] = d[a]; }); const nx = stepOwn(cur, full), nr = resOwn(nx, obs); if (nr.reduce((s, v) => s + v * v, 0) < r.reduce((s, v) => s + v * v, 0)) { cur = nx; r = nr; lam = Math.max(lam / 3, 1e-12); trace.push(rmsOf(r)); done = true; } }
      if (!done) lam *= 4;
    }
    if (!done) break;
  }
  return { st: cur, trace };
}
const FIXED = [0, 1, 2, 3, 4, 5, 6];
const ZP = stream(NUNK, 9), ZB = stream(2 * NC * NU, 2);
// the engine's default bundle problem
const sc = BA.scene({ nCam: NC, nPts: NP }), HELDE = BA.camAt(sc, 21);
const bundle = (sig, start, gauge, k, zb, zp) => BA.bundle(sc, { nUse: NU, sig, zb: zb || BA.noiseField(2 * NC * NU, 2), start, zp: zp || BA.noiseField(NUNK, 9), gauge, k, held: HELDE });
{
  const obs = observeOwn(0.5, ZB), st = perturbOwn(state0(), 1.5, ZP);
  // 5a. analytic normal equations == finite-difference normal equations, at three states
  const eb = bundle(0.5, 1.5, 'fixed', 0);
  ok('start RMS: engine == written here', close(eb.trace[0], rmsOf(resOwn(st, obs)), 1e-9), [eb.trace[0], rmsOf(resOwn(st, obs))]);
  let worstH = 0, worstG = 0;
  for (const s of [st, lmOwn(st, obs, 2, FIXED).st, lmOwn(st, obs, 8, FIXED).st]) {
    const J = jacOwn(s, obs), r = resOwn(s, obs), nn = normalOwn(J, r, NUNK), eg = BA.linearize(sc, { cams: s.cams, X: s.X }, obs);
    let sH = 0, sg = 0, mH = 0, mg = 0; for (let k = 0; k < NUNK * NUNK; k++) { sH = Math.max(sH, Math.abs(nn.H[k] - eg.H[k])); mH = Math.max(mH, Math.abs(nn.H[k])); } for (let k = 0; k < NUNK; k++) { sg = Math.max(sg, Math.abs(nn.g[k] - eg.g[k])); mg = Math.max(mg, Math.abs(nn.g[k])); }
    worstH = Math.max(worstH, sH / mH); worstG = Math.max(worstG, sg / Math.max(mg, 1));
  }
  ok('analytic J^T J == finite-difference J^T J', worstH < 1e-6, worstH); ok('analytic J^T r == finite-difference J^T r', worstG < 1e-6, worstG);
  // 5b. the loop: iteration-by-iteration RMS, engine vs written here (same rules)
  const mine = lmOwn(st, obs, 8, FIXED), e8 = bundle(0.5, 1.5, 'fixed', 8);
  let worst = 0; for (let k = 0; k < Math.min(mine.trace.length, e8.trace.length); k++) worst = Math.max(worst, Math.abs(mine.trace[k] - e8.trace[k]) / (1e-3 + mine.trace[k]));
  ok('LM trace: engine == written here, iteration by iteration', worst < 1e-5 && mine.trace.length === e8.trace.length, [worst, mine.trace.length, e8.trace.length]);
  facts.rms0 = mine.trace[0]; facts.rms1 = mine.trace[1]; facts.rms2 = mine.trace[2];
  // 5c. noise-free: machine precision in a handful of iterations
  const obs0 = observeOwn(0, ZB), m0 = lmOwn(st, obs0, 20, FIXED);
  let itn = 0; while (itn < m0.trace.length && m0.trace[itn] > 1e-10) itn++;
  facts.it_1e10 = itn; facts.rms_machine = Math.min(...m0.trace);
  ok('noise-free LM reaches 1e-12 px', Math.min(...m0.trace) < 1e-12, Math.min(...m0.trace)); ok('... in at most 15 iterations', itn <= 15, itn);
  const eb0 = bundle(0, 1.5, 'fixed', 20); let it2 = 0; while (it2 < eb0.trace.length && eb0.trace[it2] > 1e-10) it2++;
  ok('engine noise-free iteration count == written here', it2 === itn, [it2, itn]);
  // 5d. convergence from a wide range of starts
  let okc = 0, tot = 0; for (const eps of [1, 2, 4, 6]) for (let seed = 1; seed <= 6; seed++) { const s0 = perturbOwn(state0(), eps, stream(NUNK, seed * 13)), r = lmOwn(s0, obs0, 40, FIXED); tot++; if (Math.min(...r.trace) < 1e-8) okc++; }
  ok('LM converges from start errors up to x6 (24 starts)', okc === tot, okc + '/' + tot);
}
{
  // 5e. the floor law over 200 noise draws: sigma * sqrt((200 - 83) / 200)
  const dof = 2 * NC * NU - (NUNK - 7), floor = 0.5 * Math.sqrt(dof / (2 * NC * NU)), fin = [], rotB = [], dirB = [], rot8 = [], dir8 = [];
  for (let seed = 1; seed <= 200; seed++) { const zb = stream(2 * NC * NU, seed), b = bundle(0.5, 1.5, 'fixed', 14, zb); fin.push(b.trace[b.trace.length - 1]); if (seed <= 100) { rotB.push(b.rel.rot); dirB.push(b.rel.dir); } }
  facts.unk = NUNK; facts.nres = 2 * NC * NU; facts.free = NUNK - 7; facts.dof = dof; facts.floor = floor; facts.floor_mc = mean(fin);
  ok('RMS floor = sigma sqrt((N - free) / N) (Monte Carlo, 200 draws)', close(mean(fin), floor, 0.006), [mean(fin), floor]);
  ok('floor by the engine helper', close(BA.floor(0.5, NC, NU), floor, 1e-12));
  // eight-point on the same pair and the same 20 points, same noise, against bundle adjustment
  for (let seed = 1; seed <= 100; seed++) { const m = makeMatches(0.5, seed, 0, NU), P = myPose(myEight(m.x1, m.x2), m.x1, m.x2), e = relErr(P.R, P.t, R12, t12u); rot8.push(e.rot); dir8.push(e.dir); }
  facts.ba_rot = mean(rotB); facts.ba_dir = mean(dirB); facts.p8_rot = mean(rot8); facts.p8_dir = mean(dir8);
  ok('bundle adjustment is more accurate than the eight-point on the same 20 points', mean(rotB) < 0.5 * mean(rot8) && mean(dirB) < 0.5 * mean(dir8), [mean(rotB), mean(rot8), mean(dirB), mean(dir8)]);
  facts.ba_gain = mean(rot8) / mean(rotB);
  // at the truth the RMS is sigma; after the fit it is lower: the fit explains part of the noise
  const b0 = bundle(0.5, 0, 'fixed', 14); facts.rms_at_truth = b0.trace[0]; ok('start at the truth: RMS = sigma (one draw)', close(b0.trace[0], 0.5, 0.06), b0.trace[0]);
}

/* ── 6. the gauge ── */
{
  const st = perturbOwn(state0(), 1.5, ZP), obs = observeOwn(0.5, ZB), rng = FL.rng(5);
  // invariance under a similarity: X' = s Q X + c, R' = R Q^T, t' = s t - R Q^T c
  const simil = (s0, Q, s, c) => ({ cams: s0.cams.map(T => { const Rn = mul(T.R, trn(Q)); return { R: Rn, t: sub(sca(T.t, s), mv(Rn, c)) }; }), X: s0.X.map(X => add(sca(mv(Q, X), s), c)) });
  let worst = 0;
  for (let n = 0; n < 20; n++) { const Q = rodr([(rng() - .5) * 3, (rng() - .5) * 3, (rng() - .5) * 3]), s = 0.3 + 3 * rng(), c = [(rng() - .5) * 10, (rng() - .5) * 10, (rng() - .5) * 10], r1 = resOwn(st, obs), r2 = resOwn(simil(st, Q, s, c), obs); for (let k = 0; k < r1.length; k++) worst = Math.max(worst, Math.abs(r1[k] - r2[k])); }
  ok('residuals are unchanged by any similarity of the whole scene', worst < 1e-9, worst); facts.gauge_inv = worst;
  // seven null vectors of J: central differences of the group action, in the tangent coordinates of the current iterate
  const J = jacOwn(st, obs), n = NUNK, h = 1e-5, acts = [];
  for (let a = 0; a < 3; a++) { const w = [0, 0, 0]; w[a] = h; acts.push(w); }
  const gen = (kind, a, sg) => { const Q = kind === 'rot' ? rodr(sca([a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0], sg * h)) : eye(), c = kind === 'trn' ? sca([a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0], sg * h) : [0, 0, 0], s = kind === 'scl' ? 1 + sg * h : 1; return simil(st, Q, s, c); };
  const nullv = [];
  for (const [kind, a] of [['rot', 0], ['rot', 1], ['rot', 2], ['trn', 0], ['trn', 1], ['trn', 2], ['scl', 0]]) {
    const sp = gen(kind, a, 1), sm = gen(kind, a, -1), v = new Float64Array(n);
    for (let i = 0; i < NC; i++) { const dp = compose(sp.cams[i], inv(st.cams[i])), dm = compose(sm.cams[i], inv(st.cams[i])); const lp = se3log(dp), lm = se3log(dm); for (let q = 0; q < 6; q++) v[6 * i + q] = (lp[q] - lm[q]) / (2 * h); }
    for (let j = 0; j < NU; j++) for (let q = 0; q < 3; q++) v[6 * NC + 3 * j + q] = (sp.X[j][q] - sm.X[j][q]) / (2 * h);
    nullv.push(v);
  }
  let worstN = 0; nullv.forEach(v => { let jn = 0, vn = 0; for (let r = 0; r < J.length / n; r++) { let s = 0; for (let k = 0; k < n; k++) s += J[r * n + k] * v[k]; jn += s * s; } for (let k = 0; k < n; k++) vn += v[k] * v[k]; worstN = Math.max(worstN, Math.sqrt(jn / vn)); });
  ok('J maps the 7 generators of the gauge to zero', worstN < 1e-3, worstN); facts.null_jn = worstN;
  // spectrum: exactly 7 zero eigenvalues, free; none, fixed
  for (const [label, s0] of [['truth', state0()], ['start', st], ['converged', lmOwn(st, obs, 12, FIXED).st]]) {
    const L = BA.linearize(sc, { cams: s0.cams, X: s0.X }, obs), ev = eigsym(L.H, NUNK).vals, big = ev[0];
    const nz = ev.filter(v => Math.abs(v) < 1e-9 * big).length;
    ok('exactly 7 zero eigenvalues of J^T J at the ' + label, nz === 7 && ev[NUNK - 8] > 1e-6 * big, [nz, ev[NUNK - 8] / big]);
    const fr = []; for (let k = 7; k < NUNK; k++) fr.push(k); const Hf = new Float64Array(fr.length * fr.length); fr.forEach((a, i) => fr.forEach((b, j) => { Hf[i * fr.length + j] = L.H[a * NUNK + b]; }));
    const evf = eigsym(Hf, fr.length).vals; ok('no zero eigenvalue once the gauge is fixed (' + label + ')', evf[evf.length - 1] > 1e-9 * evf[0], evf[evf.length - 1] / evf[0]);
  }
  facts.gauge_free_zeros = 7;
}
function inv(T) { const Rt = trn(T.R); return { R: Rt, t: sca(mv(Rt, T.t), -1) }; }
function se3log(T) {      // log of a rigid motion: omega from the rotation, rho = V^-1 t
  const th = angOf(T.R); let w;
  if (th < 1e-9) w = [(T.R[7] - T.R[5]) / 2, (T.R[2] - T.R[6]) / 2, (T.R[3] - T.R[1]) / 2];
  else w = sca([T.R[7] - T.R[5], T.R[2] - T.R[6], T.R[3] - T.R[1]], th / (2 * Math.sin(th)));
  const K = skew(w), K2 = mul(K, K), t2 = nrm(w), a = t2 < 1e-9 ? 1 / 12 : (1 - t2 * Math.sin(t2) / (2 * (1 - Math.cos(t2)))) / (t2 * t2);
  const Vi = eye().map((v, i) => v - 0.5 * K[i] + a * K2[i]);
  return [...mv(Vi, T.t), ...w];
}

/* ── 7. the held-out camera, and what 20 points can say ── */
function alignOwn(P, Q) {    // s, R, t with Q ~ s R P + t, by the SVD of the cross-covariance (G3.svd3 is fine for a full-rank 3x3)
  const n = P.length, mp = [0, 0, 0], mq = [0, 0, 0]; for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) { mp[a] += P[k][a] / n; mq[a] += Q[k][a] / n; }
  const C = new Array(9).fill(0); let vp = 0; for (let k = 0; k < n; k++) { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[3 * a + b] += (Q[k][a] - mq[a]) * (P[k][b] - mp[b]) / n; vp += nrm(sub(P[k], mp)) ** 2 / n; }
  const s = G3.svd3(C), R = mul(s.U, mul([1, 0, 0, 0, 1, 0, 0, 0, s.S[2] < 0 ? -1 : 1], trn(s.V))), c = (s.S[0] + s.S[1] + s.S[2]) / vp;
  return { s: c, R, t: sub(mq, sca(mv(R, mp), c)) };
}
function heldOwn(st) {
  const A = alignOwn(st.X, PTS.slice(0, NU)); let se = 0;
  for (let j = 0; j < NU; j++) { const X = add(sca(mv(A.R, st.X[j]), A.s), A.t), a = proj(HELD, X), b = proj(HELD, PTS[j]); se += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }
  return { rms: Math.sqrt(se / NU), s: A.s };
}
{
  facts.npx = NPX; facts.cover_pct = 100 * NU / NPX; facts.cover5_pct = 100 * NU * 25 / NPX;
  const obs = observeOwn(0.5, ZB), r = lmOwn(perturbOwn(state0(), 1.5, ZP), obs, 10, FIXED), h = heldOwn(r.st);
  facts.held_rms = h.rms; facts.scale_s = h.s; ok('held-out points land within 1 px of the truth after the fit', h.rms < 1, h.rms);
  const r0 = heldOwn(perturbOwn(state0(), 1.5, ZP)); facts.held_rms0 = r0.rms; ok('before the fit the held-out error is large', r0.rms > 5, r0.rms);
  const e = bundle(0.5, 1.5, 'fixed', 10); ok('engine held-out RMS == written here', close(e.heldRms, h.rms, 1e-6), [e.heldRms, h.rms]);
}

/* ── 8. the checkpoint ── */
{
  // the exercise uses a different rig from the widget: 4 cameras, 15 points, sigma = 1 px
  const nc = 4, np = 15, sg = 1, unk = 6 * nc + 3 * np, res = 2 * nc * np, free = unk - 7, dof = res - free, fl = sg * Math.sqrt(dof / res);
  facts.ck_unk = unk; facts.ck_res = res; facts.ck_free = free; facts.ck_dof = dof; facts.ck_floor = fl;
  const sc4 = BA.scene({ nCam: nc, nPts: NP }), fin = [], start4 = BA.perturb(BA.state(sc4, np), 1.5, stream(unk, 9));
  for (let seed = 1; seed <= 40; seed++) { const r = BA.run(sc4, start4, BA.observe(sc4, sg, stream(res, seed), np), 14, 'fixed'); fin.push(r.trace[r.trace.length - 1]); }
  facts.ck_floor_mc = mean(fin);
  ok('exercise rig: 69 unknowns, 120 residuals, 62 free', unk === 69 && res === 120 && free === 62 && dof === 58, [unk, res, free, dof]);
  ok('exercise rig: RMS floor 1 px * sqrt(58 / 120) (Monte Carlo, 40 draws)', close(mean(fin), fl, 0.03), [mean(fin), fl]);
}

/* ── 9. drive the page's widget into each state "What to try" describes ── */
const page = loadPage(path.join(DIR, '05_pose_from_images_ba.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
const txt = id => page.text(id), nums = id => (txt(id).match(/[-−+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) || []).map(s => parseFloat(s.replace('−', '-')));
function two(sig, bad, robust) {
  page.set('w05-stage', robust ? 'ransac' : 'eight'); page.set('w05-bad', bad); page.set('w05-sig', sig);
  return { rot: page.num('w05-m1'), dir: page.num('w05-m2'), samp: page.num('w05-m3'), sampTrue: page.num('w05-m4'), agree: txt('w05-m5'), trials: txt('w05-m6'), front: nums('w05-m7') };
}
{
  const draw = (sig, frac) => { const m = makeMatches(sig, 215, frac), E = myEight(m.x1, m.x2), P = myPose(E, m.x1, m.x2), e = relErr(P.R, P.t, R12, t12u), right = ALL.filter(j => !m.bad[j]); return { e, samp: rmsOver(E, m, right), sampTrue: rmsOver(Etrue, m, right), front: P.cands.map(c => c.front).sort((a, b) => b - a) }; };
  const cmp = (label, w, mine) => {
    ok(label + ': rotation error', close(w.rot, mine.e.rot, 0.0051), [w.rot, mine.e.rot]); ok(label + ': direction error', close(w.dir, mine.e.dir, 0.0051), [w.dir, mine.e.dir]);
    ok(label + ': epipolar RMS', close(w.samp, mine.samp, 0.0051), [w.samp, mine.samp]); ok(label + ': epipolar RMS of the true pose', close(w.sampTrue, mine.sampTrue, 0.0051), [w.sampTrue, mine.sampTrue]);
  };
  const a = two(0.5, 0, false), ma = draw(0.5, 0); cmp('default two-view', a, ma);
  ok('default: cheirality counts', JSON.stringify(a.front) === JSON.stringify(ma.front), [a.front, ma.front]); ok('default: all 80 matches used', /all 80/.test(a.agree) && /—/.test(a.trials));
  facts.w_samp = ma.samp; facts.w_samp_true = ma.sampTrue; facts.w_front1 = ma.front[0];
  const z = two(0, 0, false); ok('sigma = 0: exact pose', z.rot < 0.005 && z.dir < 0.005 && z.samp < 0.005, z); facts.zero_err = 0;
  const hi = two(1.5, 0, false), mh = draw(1.5, 0); cmp('sigma 1.5', hi, mh); facts.hi_rot = mh.e.rot; facts.hi_dir = mh.e.dir;
  ok('error at sigma 1.5 is about three times the error at 0.5', close(mh.e.rot / ma.e.rot, 3, 0.8) && close(mh.e.dir / ma.e.dir, 3, 0.8), [mh.e.rot / ma.e.rot, mh.e.dir / ma.e.dir]);
  facts.ratio_hi = mh.e.rot / ma.e.rot;
  const b = two(0.5, 25, false), mb = draw(0.5, 0.25); cmp('25 % wrong, plain', b, mb);
  const rr = two(0.5, 25, true);
  ok('25 % wrong, RANSAC: rotation error', close(rr.rot, facts.rs25_rot, 0.0051), [rr.rot, facts.rs25_rot]); ok('RANSAC: direction error', close(rr.dir, facts.rs25_dir, 0.0051), [rr.dir, facts.rs25_dir]);
  ok('RANSAC: agree readout', nums('w05-m5')[0] === 60 && nums('w05-m5')[1] === 80, txt('w05-m5')); ok('RANSAC: trials readout', nums('w05-m6')[0] === facts.rs25_iters && nums('w05-m6')[1] === facts.rs25_N, txt('w05-m6'));
  ok('slider label shows the count of wrong matches', /20 of 80/.test(txt('w05-bad-v')), txt('w05-bad-v'));
  // wrong matches at 5 % through the widget
  const w5 = two(0.5, 5, false); ok('5 % wrong: rotation error', close(w5.rot, facts.bad5_rot, 0.0051), [w5.rot, facts.bad5_rot]);
  facts.w_agree_total = 80;
}
{
  // bundle adjustment through the widget
  page.set('w05-stage', 'ba'); page.set('w05-sig', 0.5); page.set('w05-start', 1.5); page.set('w05-gauge', 'fixed');
  const fm = id => nums(id);
  const read = () => ({ rms: parseFloat(txt('w05-m1')), it: page.num('w05-m2'), pose: fm('w05-m3'), moved: page.num('w05-m4'), eig: txt('w05-m5'), held: page.num('w05-m6'), scale: page.num('w05-m7') });
  let w = read();
  ok('BA at iteration 0: RMS', close(w.rms, facts.rms0, 0.0051), [w.rms, facts.rms0]);
  page.click('w05-step'); w = read(); ok('after 1 LM step: RMS', close(w.rms, facts.rms1, 0.0051) && w.it === 1, [w.rms, facts.rms1, w.it]);
  page.click('w05-step'); w = read(); ok('after 2 LM steps: RMS', close(w.rms, facts.rms2, 0.0051) && w.it === 2, [w.rms, facts.rms2, w.it]);
  page.click('w05-run'); w = read();      // K = 12
  const e12 = bundle(0.5, 1.5, 'fixed', 12), o12 = lmOwn(perturbOwn(state0(), 1.5, ZP), observeOwn(0.5, ZB), 12, FIXED);
  ok('K = 12: RMS (floor)', close(w.rms, o12.trace[o12.trace.length - 1], 0.0051), [w.rms, o12.trace[o12.trace.length - 1]]);
  ok('K = 12: relative pose error matches the engine', close(w.pose[0], e12.rel.rot, 0.0051) && close(w.pose[1], e12.rel.dir, 0.0051), [w.pose, e12.rel]);
  // pose error computed here, from the estimate
  const relOwn = s => { const R = mul(s.cams[2].R, trn(s.cams[0].R)), t = sub(s.cams[2].t, mv(R, s.cams[0].t)); return relErr(R, t, R12, t12); };
  const rO = relOwn(o12.st); ok('K = 12: relative pose error, independent', close(w.pose[0], rO.rot, 0.0051) && close(w.pose[1], rO.dir, 0.0051), [w.pose, rO]);
  facts.w_ba_rms = o12.trace[o12.trace.length - 1]; facts.w_ba_rot = rO.rot; facts.w_ba_dir = rO.dir; facts.w_ba_its = o12.trace.length - 1;
  const hO = heldOwn(o12.st); ok('K = 12: held-out error', close(w.held, hO.rms, 0.0051), [w.held, hO.rms]); ok('K = 12: scale to metres', close(w.scale, hO.s, 0.0051), [w.scale, hO.s]);
  facts.w_held = hO.rms; facts.w_scale = hO.s;
  ok('gauge fixed: camera 0 did not move, zero eigenvalues = 0', w.moved < 0.005 && /^0 /.test(w.eig), [w.moved, w.eig]);
  const evF = BA.spectrum(sc, o12.st, observeOwn(0.5, ZB), 'fixed'); facts.eig_min_fixed = evF[evF.length - 1]; facts.cond_fixed_log = Math.log10(evF[0] / evF[evF.length - 1]);
  ok('gauge fixed: smallest eigenvalue readout', Math.abs(parseFloat(w.eig.match(/\((.*)\)/)[1]) / evF[evF.length - 1] - 1) < 0.06, [w.eig, evF[evF.length - 1]]);
  // free gauge
  page.set('w05-gauge', 'free'); const wf = read();
  const obs = observeOwn(0.5, ZB), freeRun = lmOwn(perturbOwn(state0(), 1.5, ZP), obs, 12, []);
  ok('gauge free: seven zero eigenvalues', /^7 /.test(wf.eig), wf.eig); ok('gauge free: camera 0 drifts', wf.moved > 0.01, wf.moved); ok('gauge free: the fit is as good', close(wf.rms, freeRun.trace[freeRun.trace.length - 1], 0.0051), [wf.rms, freeRun.trace[freeRun.trace.length - 1]]);
  const Lf = BA.linearize(sc, freeRun.st, obs), evFree = eigsym(Lf.H, NUNK).vals; facts.eig_next_free = evFree[NUNK - 8]; facts.eig_zero_free = Math.max(...evFree.slice(NUNK - 7).map(Math.abs)) / evFree[0];
  ok('gauge free: the next eigenvalue readout', Math.abs(parseFloat(wf.eig.match(/\((.*)\)/)[1]) / evFree[NUNK - 8] - 1) < 0.06, [wf.eig, evFree[NUNK - 8]]);
  const c0 = T => sca(mv(trn(T.R), T.t), -1), movedOwn = nrm(sub(c0(freeRun.st.cams[0]), c0(perturbOwn(state0(), 1.5, ZP).cams[0])));
  ok('gauge free: camera 0 displacement readout', close(wf.moved, movedOwn, 0.0051), [wf.moved, movedOwn]); facts.moved_free = movedOwn;
  page.set('w05-gauge', 'fixed');
  // noise-free
  page.set('w05-sig', 0); page.click('w05-run'); const w0 = read();
  ok('sigma = 0: machine precision', w0.rms < 1e-12, w0.rms);
  page.set('w05-sig', 0.5);
  // start error 0: the fit does better than the truth
  page.set('w05-start', 0); const ws = read(); ok('start error 0: RMS below the noise level, at the same minimum as the x1.5 start', ws.rms < 0.5 && close(ws.rms, facts.w_ba_rms, 0.0051), [ws.rms, facts.w_ba_rms]);
  page.set('w05-start', 1.5);
}
{
  // the page at a narrow width must not throw
  page.el('w05-canvas').clientWidth = 360; page.set('w05-sig', 0.7); page.set('w05-stage', 'eight'); page.set('w05-stage', 'ba'); page.set('w05-sig', 0.5);
  ok('narrow layout draws without errors', page.problems.length === 0, page.problems.join(' | '));
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
