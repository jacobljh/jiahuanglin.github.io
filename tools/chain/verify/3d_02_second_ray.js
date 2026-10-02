#!/usr/bin/env node
/* Oracle for 3D lesson 02, "A second ray pins the point".
 *
 * Every number the lesson quotes is re-derived here by a path that does not use the widget's code:
 *   - the pin: the rectified closed form Z = f b / d, X = (u_A - W/2) Z / f and the 2x2 system [[1, -kA], [1, -kB]] (X, Z) = (0, b),
 *     checked against FL.triangulate; the determinant is d/f; the condition number cot(theta/2) from an independent 2x2 SVD;
 *   - the error law: a finite-difference Jacobian of the closed form, the covariance J J^T, its eigenvalues from the
 *     characteristic polynomial, and Monte-Carlo clouds drawn with the closed form (Welford statistics) rather than FL.triangulate;
 *     plus an exact quadrature of Var(f b / d) so that the first-order law and the simulation are each checked against a third thing;
 *   - the baseline trade-off: overlap and matching re-implemented with a different loop order and closed-form projection;
 *   - the matcher's own error on a constant-depth face (whole-pixel vs parabola) over a sweep of baselines;
 *   - the sensor comparison: crossover by derivation and by bisection, c/(2f) and c t/2;
 *   - the exit: back-projection, mean nearest-point distance by brute force, and the SE(2) placement of one cloud into the other's frame.
 * Then the page's own widget is driven into each state quoted in "What to try" and must print the independent number.
 * Prints {"facts": {...}} as its last line; the validator checks every <span data-n="key"> in the page against it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const TL = require(path.join(DIR, 'triangulation_lab.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const deg = r => r * 180 / Math.PI;
const cot = x => 1 / Math.tan(x);

const F = 44, W = 120, SS = 4, ZMAX = 60, ZMIN = 2;
const SC = FL.scenes.street();
const A = FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: F, W: W });
const SU = 0.1, N = 20000, SEED = 20;          // the widget's defaults: pixel error, trials, seed of the shared normals

/* ───────────────────────── independent building blocks ───────────────────────── */
/* the rectified pin, by hand */
function pinClosed(f, b, uA, uB) { const d = uA - uB, Z = f * b / d; return { X: (uA - W / 2) * Z / f, Z, d }; }
/* the same pin as the 2x2 linear system of the lesson, solved by Cramer's rule */
function pinSystem(f, b, uA, uB) {
  const kA = (uA - W / 2) / f, kB = (uB - W / 2) / f;
  const M = [[1, -kA], [1, -kB]], rhs = [0, b], det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  return { X: (rhs[0] * M[1][1] - M[0][1] * rhs[1]) / det, Z: (M[0][0] * rhs[1] - rhs[0] * M[1][0]) / det, det };
}
/* singular values of a 2x2 matrix from its Frobenius norm and determinant: s1^2 + s2^2 = ||M||_F^2, s1 s2 = |det| */
function svd2(M) {
  const S = M[0][0] ** 2 + M[0][1] ** 2 + M[1][0] ** 2 + M[1][1] ** 2, D = Math.abs(M[0][0] * M[1][1] - M[0][1] * M[1][0]), r = Math.sqrt(Math.max(0, S * S - 4 * D * D));
  return [Math.sqrt((S + r) / 2), Math.sqrt((S - r) / 2)];
}
/* eigenvalues of [[a, c], [c, d]] from the characteristic polynomial */
function eigs(a, c, d) { const m = (a + d) / 2, r = Math.sqrt(m * m - (a * d - c * c)); return [m + r, m - r]; }
/* Monte Carlo with the closed form and Welford's streaming moments; same normals, same order as the widget */
function mcClosed(f, b, Z, su, n, seed) {
  const rng = FL.rng(seed), uA0 = W / 2, uB0 = W / 2 - f * b / Z;
  let k = 0, lost = 0, mx = 0, mz = 0, Sxx = 0, Szz = 0, Sxz = 0;
  for (let i = 0; i < n; i++) {
    const g1 = FL.randn(rng), g2 = FL.randn(rng), p = pinClosed(f, b, uA0 + su * g1, uB0 + su * g2);
    if (!(p.d > 0) || p.Z > ZMAX) { lost++; continue; }
    k++;
    const dx = p.X - mx, dz = p.Z - mz;
    mx += dx / k; mz += dz / k;
    Sxx += dx * (p.X - mx); Szz += dz * (p.Z - mz); Sxz += dx * (p.Z - mz);
  }
  const vxx = Sxx / k, vzz = Szz / k, vxz = Sxz / k, e = eigs(vxx, vxz, vzz);
  return { n: k, lost, mx, mz, sx: Math.sqrt(vxx), sz: Math.sqrt(vzz), cxz: vxz, ratio: Math.sqrt(e[0] / e[1]) };
}
/* exact standard deviation of Z = f b / d for d ~ N(d0, sd^2) restricted to the draws the widget keeps (0 < Z <= ZMAX), by quadrature */
function exactSzTrunc(f, b, d0, sd) {
  const dmin = f * b / ZMAX, lo = Math.max(dmin, d0 - 9 * sd), hi = d0 + 9 * sd, M = 200000, h = (hi - lo) / M;
  let w0 = 0, w1 = 0, w2 = 0;
  for (let i = 0; i <= M; i++) {
    const d = lo + i * h, w = Math.exp(-0.5 * ((d - d0) / sd) ** 2) * (i === 0 || i === M ? 0.5 : 1), z = f * b / d;
    w0 += w; w1 += w * z; w2 += w * z * z;
  }
  const m = w1 / w0; return Math.sqrt(w2 / w0 - m * m);
}
function photo(cam) {                               // supersampled photograph, same definition as the lesson text
  const img = FL.render(SC, cam);
  for (let i = 0; i < cam.W; i++) {
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < SS; k++) {
      const ray = FL.pixelRay(cam, i + (k + 0.5) / SS), h = FL.raycast(SC, ray.ox, ray.oz, ray.dx, ray.dz, SC.far);
      const c = h.hit ? FL.shade(SC, h, ray, {}) : SC.bg;
      r += c[0]; g += c[1]; b += c[2];
    }
    img.r[i] = r / SS; img.g[i] = g / SS; img.b[i] = b / SS;
  }
  return img;
}
const IA = photo(A);
const objPix = []; for (let i = 0; i < W; i++) if (IA.id[i] >= 0) objPix.push(i);
/* SSD costs for ALL shifts and ALL surface pixels, shift-major loop order; NaN where a window leaves an image */
function costTable(IB, h, dmax) {
  const tab = []; for (let d = 0; d <= dmax; d++) tab.push(new Map());
  for (let d = 0; d <= dmax; d++) for (const i of objPix) {
    let s = 0, bad = false;
    for (let k = -h; k <= h && !bad; k++) {
      const a = i + k, b2 = a - d;
      if (a < 0 || a >= W || b2 < 0 || b2 >= W) { bad = true; break; }
      for (const ch of ['r', 'g', 'b']) { const e = IA[ch][a] - IB[ch][b2]; s += e * e; }
    }
    tab[d].set(i, bad ? NaN : s);
  }
  return tab;
}
function costOf(IB, i, h, dmax) {                 // one pixel, any pixel (also the sky)
  const out = [];
  for (let d = 0; d <= dmax; d++) {
    let s = 0, bad = false;
    for (let k = -h; k <= h; k++) {
      const a = i + k, b2 = a - d;
      if (a < 0 || a >= W || b2 < 0 || b2 >= W) { bad = true; break; }
      for (const ch of ['r', 'g', 'b']) { const e = IA[ch][a] - IB[ch][b2]; s += e * e; }
    }
    out.push(bad ? NaN : s);
  }
  return out;
}
const argminFirst = c => { let best = -1; c.forEach((v, d) => { if (Number.isFinite(v) && (best < 0 || v < c[best])) best = d; }); return best; };
function parabola(c, d) { if (d <= 0 || d >= c.length - 1 || !Number.isFinite(c[d - 1]) || !Number.isFinite(c[d + 1])) return d; const den = c[d - 1] - 2 * c[d] + c[d + 1]; return den > 1e-12 ? d + (c[d - 1] - c[d + 1]) / (2 * den) : d; }
/* the baseline experiment, from closed forms: B is A slid by b, so a surface point (hx, hz) lands at u_B = W/2 + f (hx - b) / hz at depth hz */
function baselineExp(b, h) {
  const B = FL.moved(A, b, 0, 0), IB = photo(B), RB = FL.render(SC, B), dmax = Math.ceil(F * b / ZMIN), tab = costTable(IB, h, dmax);
  let nVis = 0, nRight = 0;
  for (const i of objPix) {
    const uB = W / 2 + F * (IA.hx[i] - b) / IA.hz[i], j = Math.floor(uB);
    const vis = uB >= 0 && uB < W && RB.id[j] === IA.id[i] && Math.abs(RB.depth[j] - IA.hz[i]) < 0.25;
    if (!vis) continue;
    nVis++;
    const col = []; for (let d = 0; d <= dmax; d++) col.push(tab[d].get(i));
    const d = argminFirst(col);
    if (d >= 0 && Math.abs(d - F * b / IA.depth[i]) <= 1) nRight++;
  }
  return { nObj: objPix.length, nVis, nRight, overlap: 100 * nVis / objPix.length, right: 100 * nRight / nVis, yield: 100 * nRight / objPix.length, dmax, IB, B };
}

/* ═══════════════════════════ 0. what lesson 1 left ═══════════════════════════ */
{
  const zOf = d => F * 0.5 / d, dC = F * 0.5 / 2.5, dT = F * 0.5 / 10;
  facts.e_c_w = zOf(dC - 0.5) - zOf(dC + 0.5); facts.e_t_w = zOf(dT - 0.5) - zOf(dT + 0.5); facts.e_ratio = facts.e_t_w / facts.e_c_w;
  ok('the half-pixel interval grows about as Z^2 (17 vs 16)', facts.e_ratio > 15 && facts.e_ratio < 18, facts.e_ratio);
}

/* ═══════════════════════════ 1. the pin is a 2x2 system ═══════════════════════════ */
{
  const rng = FL.rng(11);
  let wTri = 0, wSys = 0, wDet = 0, wKap = 0, wAng = 0, wPin = 0;
  for (let n = 0; n < 400; n++) {
    const b = 0.1 + 1.9 * rng(), P = { x: -3 + 6 * rng(), z: 1.5 + 12.5 * rng() }, B = FL.moved(A, b, 0, 0);
    const uA = FL.project(A, P.x, P.z).u, uB = FL.project(B, P.x, P.z).u;
    const c = pinClosed(F, b, uA, uB), s = pinSystem(F, b, uA, uB), t = FL.triangulate(A, uA, B, uB), e = TL.pin(A, uA, B, uB), r = TL.rectified(F, b, W, uA, uB);
    wTri = Math.max(wTri, Math.abs(c.Z - P.z), Math.abs(c.X - P.x), Math.abs(t.x - P.x), Math.abs(t.z - P.z));      // noise-free pixels recover the point exactly
    wSys = Math.max(wSys, Math.abs(s.X - c.X), Math.abs(s.Z - c.Z), Math.abs(r.X - c.X), Math.abs(r.Z - c.Z));
    wDet = Math.max(wDet, Math.abs(s.det - (uA - uB) / F), Math.abs(r.det - (uA - uB) / F));                          // the determinant IS d/f
    wPin = Math.max(wPin, Math.abs(e.zc - c.Z), Math.abs(e.xc - c.X));
    // condition number: singular values of [dA, -dB] with unit directions, against cot(theta/2); theta from the geometry
    const rA = FL.pixelRay(A, uA), rB = FL.pixelRay(B, uB), M = [[rA.dx, -rB.dx], [rA.dz, -rB.dz]];
    const sv = svd2(M), th = Math.acos(rA.dx * rB.dx + rA.dz * rB.dz);
    wKap = Math.max(wKap, Math.abs(sv[0] / sv[1] - cot(th / 2)) / cot(th / 2), Math.abs(sv[1] * sv[1] - (1 - Math.cos(th))), Math.abs(Math.abs(rA.dx * rB.dz - rA.dz * rB.dx) - Math.sin(th)));
    wAng = Math.max(wAng, Math.abs(e.kappa - cot(th / 2)) / cot(th / 2), Math.abs(e.theta - th));
  }
  ok('noise-free pixels give back the point (closed form and FL.triangulate)', wTri < 1e-9, wTri);
  ok('the 2x2 system by Cramer == closed form == TL.rectified', wSys < 1e-9, wSys);
  ok('determinant of the rectified system is d/f', wDet < 1e-12, wDet);
  ok('TL.pin == closed form', wPin < 1e-9, wPin);
  ok('kappa = cot(theta/2); singular values sqrt(1 +- cos theta); det = sin theta', wKap < 1e-9, wKap);
  ok('TL.pin condition number', wAng < 1e-9, wAng);
  // the table: b = 0.5, point on A's axis
  const b = 0.5;
  for (const [key, Z] of [['25', 2.5], ['5', 5], ['10', 10], ['40', 40]]) {
    const th = Math.atan(b / Z), kap = cot(th / 2);
    facts['d_' + key] = F * b / Z; facts['th_' + key] = deg(th); facts['k_' + key] = kap;
    ok('kappa ~ 2Z/b at Z=' + Z, rel(kap, 2 * Z / b) < 0.01, [kap, 2 * Z / b]);
    // the engine's angle between the two rays from the same geometry
    const Bc = FL.moved(A, b, 0, 0), uB = FL.project(Bc, 0, Z).u, e = TL.pin(A, W / 2, Bc, uB);
    ok('engine angle at Z=' + Z, close(e.theta, th, 1e-9) && close(e.kappa, kap, 1e-7), [e.theta, th]);
  }
}

/* ═══════════════════════════ 2. noise through the pin ═══════════════════════════ */
{
  const b = 0.5;
  // Jacobian of the closed form by central differences against the analytic entries
  for (const Z of [2.5, 5, 10]) {
    const uA = W / 2, uB = W / 2 - F * b / Z, h = 1e-6, J = [[0, 0], [0, 0]];
    const f = (a, c) => { const p = pinClosed(F, b, a, c); return [p.X, p.Z]; };
    const pa = f(uA + h, uB), ma = f(uA - h, uB), pb = f(uA, uB + h), mb = f(uA, uB - h);
    for (let r = 0; r < 2; r++) { J[r][0] = (pa[r] - ma[r]) / (2 * h); J[r][1] = (pb[r] - mb[r]) / (2 * h); }
    const ana = [[Z / F, 0], [-Z * Z / (F * b), Z * Z / (F * b)]];
    let w = 0; for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) w = Math.max(w, Math.abs(J[r][c] - ana[r][c]) / (Math.abs(ana[r][c]) + 1e-3));
    ok('Jacobian of (X, Z) at Z=' + Z, w < 1e-5, w);
    const cov = [[0, 0], [0, 0]]; for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) for (let k = 0; k < 2; k++) cov[r][c] += J[r][k] * J[c][k] * SU * SU;
    const law = TL.law(F, b, Z, SU);
    ok('law sigma_Z = sqrt2 Z^2 su/(f b)', close(Math.sqrt(cov[1][1]), Math.SQRT2 * Z * Z * SU / (F * b), 1e-6) && close(law.sz, Math.sqrt(cov[1][1]), 1e-6));
    ok('law sigma_X = Z su / f', close(Math.sqrt(cov[0][0]), Z * SU / F, 1e-6) && close(law.sx, Z * SU / F, 1e-12));
    ok('law covariance = -Z^3 su^2/(f^2 b)', close(cov[0][1], -(Z ** 3) * SU * SU / (F * F * b), 1e-8) && close(law.cxz, cov[0][1], 1e-8));
    const e = eigs(cov[0][0], cov[0][1], cov[1][1]), ratio = Math.sqrt(e[0] / e[1]);
    ok('law axis ratio == independent eigenvalues', close(law.ratio, ratio, 1e-5), [law.ratio, ratio]);
    const th = Math.atan(b / Z), kap = cot(th / 2);
    ok('axis ratio of the error ellipse ~ cot(theta/2) (the condition number)', rel(ratio, kap) < 0.01, [ratio, kap]);
    ok('axis ratio ~ 2Z/b (2%)', rel(ratio, 2 * Z / b) < 0.02, [ratio, 2 * Z / b]);
    ok('sigma_Z / sigma_X = sqrt2 Z / b', close(law.sz / law.sx, Math.SQRT2 * Z / b, 1e-9));
  }
  // the geometric identity behind it: with equal ray distances the covariance is proportional to a a^T + b b^T = M M^T,
  // whose eigenvalues are 1 +- cos(theta): axis ratio exactly cot(theta/2)
  for (const th of [0.05, 0.2, 0.7, 1.2]) {
    const a = [Math.cos(0), Math.sin(0)], c = [Math.cos(th), Math.sin(th)];
    const m11 = a[0] * a[0] + c[0] * c[0], m12 = a[0] * a[1] + c[0] * c[1], m22 = a[1] * a[1] + c[1] * c[1], e = eigs(m11, m12, m22);
    ok('a a^T + b b^T has axis ratio cot(theta/2)', close(Math.sqrt(e[0] / e[1]), cot(th / 2), 1e-9), [Math.sqrt(e[0] / e[1]), cot(th / 2)]);
  }
  // the lozenge: two pixel-wide wedges (tiny pixels: f -> huge) cross in a rhombus whose diagonals have ratio cot(theta/2)
  {
    const fb = 1e5, Wb = 200, Ab = FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: fb, W: Wb }), Bb = FL.camera({ x: 0.5, z: 0, a: Math.PI / 2, f: fb, W: Wb });
    const Z = 5, uA = Wb / 2, uB = FL.project(Bb, 0, Z).u, V = {};
    for (const sa of [-0.5, 0.5]) for (const sb of [-0.5, 0.5]) { const r = FL.triangulate(Ab, uA + sa, Bb, uB + sb); V[sa + ',' + sb] = r; }
    const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
    const longD = dist(V['0.5,-0.5'], V['-0.5,0.5']), shortD = dist(V['0.5,0.5'], V['-0.5,-0.5']), th = Math.atan(0.5 / Z);
    ok('lozenge of two thin wedges: long/short diagonal = cot(theta/2)', rel(longD / shortD, cot(th / 2)) < 0.01, [longD / shortD, cot(th / 2)]);
  }
  // Monte Carlo as the widget runs it (same normals, closed form instead of FL.triangulate) for the three depths of the table
  const G = TL.normals(N, SEED);
  for (const [key, Z] of [['25', 2.5], ['5', 5], ['10', 10]]) {
    const m = mcClosed(F, b, Z, SU, N, SEED), law = TL.law(F, b, Z, SU), Bc = FL.moved(A, b, 0, 0);
    const cl = TL.cloud(A, Bc, { x: 0, z: Z }, SU, G, N), st = TL.stats(cl);
    ok('MC (closed form, Welford) == TL.cloud/TL.stats draw for draw, Z=' + Z, cl.n === m.n && close(st.sz, m.sz, 1e-8) && close(st.sx, m.sx, 1e-8) && close(st.cxz, m.cxz, 1e-9) && close(st.ratio, m.ratio, 1e-5), [st.sz, m.sz, st.sx, m.sx, st.ratio, m.ratio]);
    facts['szf_' + key] = law.sz; facts['szm_' + key] = m.sz; facts['sxm_' + key] = 100 * m.sx; facts['arm_' + key] = m.ratio; facts['rat_' + key] = m.sz / law.sz;
    ok('measured sigma_Z within 3% of first order, Z=' + Z, rel(m.sz, law.sz) < 0.03, [m.sz, law.sz]);
    ok('measured sigma_X within 3% of Z su/f', rel(m.sx, law.sx) < 0.03, [m.sx, law.sx]);
    ok('measured covariance has the predicted sign (negative)', m.cxz < 0);
    const s2 = (Math.SQRT2 * SU * Z / (F * b)) ** 2;                    // (sigma_d / d)^2
    ok('the cloud is centred a little FAR of P: E[Z] = Z (1 + (sd/d)^2) to second order', Math.abs(m.mz - Z * (1 + s2)) < 4 * m.sz / Math.sqrt(m.n), [m.mz, Z * (1 + s2)]);
  }
  facts.grow_z = facts.szm_5 / facts.szm_25; facts.grow_x = facts.sxm_5 / facts.sxm_25;
  ok('doubling Z multiplies sigma_Z by ~4 and sigma_X by ~2', close(facts.grow_z, 4, 0.1) && close(facts.grow_x, 2, 0.06), [facts.grow_z, facts.grow_x]);
  // converged simulation (200 000 draws, five seeds) and the exact quadrature: the first-order law vs the truth
  for (const [key, Z] of [['25', 2.5], ['5', 5], ['10', 10]]) {
    const law = TL.law(F, b, Z, SU), rs = [];
    for (const sd of [101, 102, 103, 104, 105]) rs.push(mcClosed(F, b, Z, SU, 200000, sd).sz / law.sz);
    const mean = rs.reduce((a, c) => a + c, 0) / rs.length, d0 = F * b / Z, sd = Math.SQRT2 * SU, exact = exactSzTrunc(F, b, d0, sd) / law.sz, s2 = (sd / d0) ** 2;
    facts['conv_' + key] = mean; facts['exact_' + key] = exact; facts['exc_' + key] = 100 * (exact - 1);
    ok('converged MC agrees with the exact quadrature (<0.7%), Z=' + Z, rel(mean, exact) < 0.007, [mean, exact]);
    ok('exact / first-order ~ 1 + 4 (sd/d)^2 (second order, <0.4%)', rel(exact, 1 + 4 * s2) < 0.004, [exact, 1 + 4 * s2]);
  }
  facts.z_valid = F * b / (10 * Math.SQRT2 * SU);            // where sigma_d / d = 0.1
  {
    const Z = 14, su = 0.2, m = mcClosed(F, b, Z, su, N, SEED), law = TL.law(F, b, Z, su), ex = exactSzTrunc(F, b, F * b / Z, Math.SQRT2 * su) / law.sz;
    facts.far_m = m.sz; facts.far_f = law.sz; facts.far_r = m.sz / law.sz; facts.far_lost = m.lost; facts.far_exact = ex;
    ok('at Z=14, su=0.2 the first-order law underestimates the spread by >10%', facts.far_r > 1.10 && ex > 1.10, [facts.far_r, ex]);
    ok('and the simulation agrees with the exact quadrature to 5%', rel(facts.far_r, ex) < 0.05, [facts.far_r, ex]);
  }
  {
    const Z = 10, su = 0.2, m = mcClosed(F, b, Z, su, N, SEED), law = TL.law(F, b, Z, su);
    facts.su2_m = m.sz; facts.su2_f = law.sz;
  }
  // doubling the baseline halves sigma_Z (formula and simulation)
  {
    const Z = 10, m1 = mcClosed(F, 1, Z, SU, N, SEED), m05 = mcClosed(F, 0.5, Z, SU, N, SEED);
    facts.b1_sz = m1.sz; facts.b1_ratio = m05.sz / m1.sz;
    ok('doubling b halves sigma_Z', close(facts.b1_ratio, 2, 0.1), facts.b1_ratio);
  }
}

/* ═══════════════════════════ 3. spend the baseline ═══════════════════════════ */
const WIN = 2;
{
  /* the other knob in the denominator: a larger focal length (in pixels) halves sigma_Z and narrows the field of view of the same 120 pixels */
  const fov = f => 2 * Math.atan(W / 2 / f) / (Math.PI / 180);
  facts.fov44 = fov(44); facts.fov88 = fov(88);
  ok('the field of view from the closed form equals FL.hfov', close(facts.fov44, FL.hfov(FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: 44, W: W })) * 180 / Math.PI, 1e-9) && close(facts.fov88, FL.hfov(FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: 88, W: W })) * 180 / Math.PI, 1e-9));
  ok('doubling f halves sigma_Z (closed form)', close(TL.law(88, 0.5, 5, SU).sz * 2, TL.law(44, 0.5, 5, SU).sz, 1e-12));
}
{
  const rows = [];
  for (const [key, b] of [['025', 0.25], ['05', 0.5], ['1', 1], ['2', 2]]) {
    const e = baselineExp(b, WIN), th = Math.atan(b / 10);
    const eng = TL.matchAll(IA, e.IB, e.B, F, b, WIN, e.dmax);
    ok('baseline experiment == TL.matchAll (counts), b=' + b, eng.nObj === e.nObj && eng.nVis === e.nVis && eng.nRight === e.nRight, [eng.nObj, e.nObj, eng.nVis, e.nVis, eng.nRight, e.nRight]);
    facts['bl_s_' + key] = TL.law(F, b, 10, SU).sz; facts['bl_dm_' + key] = e.dmax; facts['bl_ov_' + key] = e.overlap; facts['bl_ok_' + key] = e.right; facts['bl_y_' + key] = e.yield; facts['bl_n_' + key] = e.nRight;
    rows.push(e);
  }
  facts.n_obj = rows[0].nObj;
  ok('51 of the 120 pixels of A see a surface', facts.n_obj === 51, facts.n_obj);
  ok('overlap falls with the baseline', rows[0].overlap >= rows[1].overlap && rows[1].overlap > rows[2].overlap && rows[2].overlap > rows[3].overlap);
  ok('matching worsens with the baseline', rows[0].right >= rows[1].right && rows[1].right > rows[2].right && rows[2].right > rows[3].right);
  ok('usable share falls with the baseline', rows[0].yield > rows[1].yield && rows[1].yield > rows[2].yield && rows[2].yield > rows[3].yield);
  ok('sigma_Z at 10 m is proportional to 1/b', close(facts.bl_s_025 / facts.bl_s_2, 8, 1e-9));
  // the pixel-grid luck of the crate's front face at b = 0.5: f b / Z is almost an integer
  const i14 = 14; facts.luck_d = F * 0.5 / IA.depth[i14];
}

/* ═══════════════════════════ 4. the partner ═══════════════════════════ */
{
  // matching error on a constant-depth face over a sweep of baselines: whole pixel vs parabola, rms of the correct matches
  const idx = []; for (let i = 0; i < W; i++) if (IA.id[i] === 0 && Math.abs(IA.depth[i] - 2.45) < 2e-3) idx.push(i);
  let sI = 0, sP = 0, n = 0, bad = 0, nb = 0;
  for (let k = 0; k <= 80; k++) {
    const b = 0.30 + 0.005 * k, B = FL.moved(A, b, 0, 0), IB = photo(B), dmax = Math.ceil(F * b / ZMIN);
    nb++;
    for (const i of idx) {
      if (i - WIN < idx[0] || i + WIN > idx[idx.length - 1]) continue;
      const dt = F * b / IA.depth[i];
      if (i - dt - WIN < 0) continue;
      const c = costOf(IB, i, WIN, dmax), d = argminFirst(c);
      if (Math.abs(d - dt) > 1) { bad++; continue; }
      const dp = parabola(c, d);
      sI += (d - dt) ** 2; sP += (dp - dt) ** 2; n++;
    }
  }
  facts.q_int = Math.sqrt(sI / n); facts.q_sub = Math.sqrt(sP / n); facts.q_unif = 1 / Math.sqrt(12); facts.q_int_u = facts.q_int / Math.SQRT2; facts.q_sub_u = facts.q_sub / Math.SQRT2; facts.q_nb = nb;
  ok('whole-pixel matcher rms ~ 1/sqrt(12) (within 8%)', rel(facts.q_int, facts.q_unif) < 0.08, [facts.q_int, facts.q_unif]);
  ok('parabola refinement at least halves the error', facts.q_sub < 0.55 * facts.q_int, [facts.q_sub, facts.q_int]);
  ok('81 baselines', nb === 81);
  // the cost curves quoted: a textured pixel, the sky, a stripe ambiguity, a pixel whose partner is outside B
  const ex = (b, i) => {
    const B = FL.moved(A, b, 0, 0), IB = photo(B), dmax = Math.ceil(F * b / ZMIN), c = costOf(IB, i, WIN, dmax), d = argminFirst(c), dt = IA.id[i] >= 0 ? F * b / IA.depth[i] : 0;
    return { c, d, dt, ds: parabola(c, d), dmax, cmin: c[d], cTrue: c[Math.round(dt)], cmax: Math.max(...c.filter(Number.isFinite)) };
  };
  const e64 = ex(0.5, 64), e100 = ex(0.5, 100), e60 = ex(2, 60), e14 = ex(2, 14);
  Object.assign(facts, { p64_dt: e64.dt, p64_di: e64.d, p64_ds: e64.ds, p100_zero: e100.c.every(v => v === 0) ? 1 : 0, p100_n: e100.c.length, p60_dt: e60.dt, p60_di: e60.d, p14_dt: e14.dt, p14_di: e14.d });
  ok('textured pixel: single deep valley at the whole-pixel truth', Math.abs(e64.d - e64.dt) <= 0.5 && e64.cmin < 0.01 * e64.cmax, [e64.d, e64.dt, e64.cmin, e64.cmax]);
  ok('sky pixel: cost is exactly zero for every shift', e100.c.every(v => v === 0));
  ok('stripe ambiguity: cheapest shift is wrong by more than 5 px', Math.abs(e60.d - e60.dt) > 5, [e60.d, e60.dt]);
  ok('the wrong stripe is cheaper than the true one', e60.cmin < e60.cTrue, [e60.cmin, e60.cTrue]);
  ok('pixel 14 at b=2 has its partner outside B (14.5 - d < 0) and still gets a confident-looking match (cost < 1% of the cost range)', 14.5 - e14.dt < 0 && e14.cmin < 0.01 * e14.cmax, [e14.dt, e14.cmin, e14.cmax]);
}

/* ═══════════════════════════ 5. time the light ═══════════════════════════ */
{
  const f = 1000, b = 0.5, sd = 0.1, sR = 0.025, sZ = Z => Z * Z * sd / (f * b);
  facts.x_star = Math.sqrt(sR * f * b / sd);
  let lo = 1, hi = 100; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (sZ(mid) < sR) lo = mid; else hi = mid; }
  ok('crossover by derivation == by bisection', close(facts.x_star, lo, 1e-9), [facts.x_star, lo]);
  ok('engine crossover', close(TL.cross(f, b, sd, sR), facts.x_star, 1e-12) && close(FL.stereo.sigmaZ(f, b, 10, sd), sZ(10), 1e-12));
  for (const Z of [10, 20, 50, 100]) facts['st_' + Z] = 100 * sZ(Z);
  ok('x4 per doubling', close(sZ(20) / sZ(10), 4, 1e-12) && close(sZ(100) / sZ(50), 4, 1e-12));
  const c = 299792458;
  for (const [fm, key] of [[10e6, '10'], [20e6, '20'], [50e6, '50'], [100e6, '100']]) facts['amb_' + key] = c / (2 * fm);
  // indirect ToF: d = c phi / (4 pi f); the phase wraps at 2 pi, so the distance wraps at c / (2 f)
  ok('phase wraps at c/(2f)', close(c * (2 * Math.PI) / (4 * Math.PI * 10e6), facts.amb_10, 1e-6));
  facts.t_1ns = 100 * c * 1e-9 / 2; facts.t_100ps = 100 * c * 100e-12 / 2;
  // the toy camera of the widget (f = 44) against the same 2.5 cm range sensor
  facts.x_toy = TL.cross(F, 0.5, Math.SQRT2 * SU, sR); facts.x_toy2 = TL.cross(F, 2, Math.SQRT2 * SU, sR);
  let lo2 = 0.5, hi2 = 50; for (let i = 0; i < 80; i++) { const mid = (lo2 + hi2) / 2; if (TL.law(F, 0.5, mid, SU).sz < sR) lo2 = mid; else hi2 = mid; }
  ok('toy-camera crossover by bisection on the law', close(facts.x_toy, lo2, 1e-6), [facts.x_toy, lo2]);
  // the checkpoint rig: f = 800 px, b = 0.12 m, sd = 0.1 px
  const f2 = 800, b2 = 0.12, sd2 = 0.1;
  facts.ck_s5 = 100 * 5 * 5 * sd2 / (f2 * b2); facts.ck_z10 = Math.sqrt(0.10 * f2 * b2 / sd2); facts.ck_b = 20 * 20 * sd2 / (f2 * 0.05); facts.ck_sx20 = 1000 * 20 * (sd2 / Math.SQRT2) / f2;
}

/* ═══════════════════════════ 6. a depth map is a cloud, in the sensor's own frame ═══════════════════════════ */
{
  const turn = 15 * Math.PI / 180, own = FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: F, W: W });
  function scansIndep(b) {
    const C = FL.moved(A, b, 0, turn), mk = (cam, seed) => FL.noisyDepth(cam, FL.render(SC, cam), { kind: 'tof', sigma: 0.02 }, FL.rng(seed));
    const dA = mk(A, 5), dC = mk(C, 6);
    // back-projection by hand: X = (u + 1/2 - W/2) Z / f in the sensor's frame
    const bp = (d) => { const P = []; for (let i = 0; i < W; i++) if (d[i] > 0) P.push({ x: (i + 0.5 - W / 2) * d[i] / F, z: d[i] }); return P; };
    const PA = bp(dA), PC = bp(dC);
    // the true pose as an SE(2) element: rotation by (heading - pi/2), then translation to the sensor position
    const T = { a: C.a - Math.PI / 2, x: C.x, z: C.z }, PCw = PC.map(p => FL.se2.apply(T, p)), PAw = PA;     // A's pose is the identity
    const dist = (S, U) => { let s = 0; for (const p of S) { let m = Infinity; for (const q of U) m = Math.min(m, Math.hypot(p.x - q.x, p.z - q.z)); s += m; } return s / S.length; };
    const sym = (S, U) => (dist(S, U) + dist(U, S)) / 2;
    return { PA, PC, PCw, delivered: sym(PA, PC), placed: sym(PAw, PCw), C, dA, dC };
  }
  const s = scansIndep(0.5), e = TL.scans(SC, A, 0.5, turn, 0.02);
  ok('TL.scans delivered == brute force', close(e.delivered, s.delivered, 1e-9), [e.delivered, s.delivered]);
  ok('TL.scans placed == brute force (SE(2) placement == FL.backproject with the true pose)', close(e.placed, s.placed, 1e-9), [e.placed, s.placed]);
  // back-projection identity: project the cloud back into its camera and recover the pixels
  { let w = 0; s.PC.forEach(() => 0); const px = []; for (let i = 0; i < W; i++) if (s.dC[i] > 0) px.push(i);
    px.forEach((i, k) => { const q = FL.project(own, s.PC[k].x, s.PC[k].z); w = Math.max(w, Math.abs(q.u - (i + 0.5)), Math.abs(q.zc - s.dC[i])); });
    ok('back-projection is the inverse of projection', w < 1e-4, w); }
  facts.cl_na = s.PA.length; facts.cl_nc = s.PC.length; facts.nn_deliv = s.delivered; facts.nn_placed = s.placed;
  const dl = [], pl = [];
  for (let b = 0.1; b <= 2.0001; b += 0.05) { const q = scansIndep(b); dl.push(q.delivered); pl.push(q.placed); }
  facts.nn_deliv_min = Math.min(...dl); facts.nn_deliv_max = Math.max(...dl); facts.nn_placed_max = Math.max(...pl);
  ok('placed clouds agree to within sampling and noise for every baseline', facts.nn_placed_max < 0.11, facts.nn_placed_max);
  ok('delivered clouds never agree', facts.nn_deliv_min > 4 * facts.nn_placed_max / 1.2, [facts.nn_deliv_min, facts.nn_placed_max]);
  ok('the floor of the delivered distance is 5x the placed one at the default baseline', s.delivered > 5 * s.placed, [s.delivered, s.placed]);
  // a pure turn (no slide): still disagreeing
  facts.nn_turn_only = scansIndep(0).delivered;
}

/* ═══════════════════════════ 7. the page's widget prints what the independent computations give ═══════════════════════════ */
const PAGE = path.join(DIR, '02_a_second_ray.html');
if (fs.existsSync(PAGE)) {
  const page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const get = id => page.num(id);
  const all = id => (page.text(id).match(/\d+(?:\.\d+)?/g) || []).map(Number);      // every number in a merged readout
  const setAll = (o) => { for (const [k, v] of Object.entries(o)) page.set('w02-' + k, v); };
  const relOk = (name, w, v, tol) => ok(name, rel(w, v) <= (tol === undefined ? 0.0065 : tol), `widget ${w} vs oracle ${v}`);
  function pinState(b, Z, su) {
    setAll({ view: 'pin', b, z: Z, su });
    const m = mcClosed(F, b, Z, su, N, SEED), law = TL.law(F, b, Z, su), th = Math.atan(b / Z);
    relOk(`pin b=${b} Z=${Z} su=${su}: sigma_Z measured`, all('w02-sz')[0], m.sz);
    relOk(`pin b=${b} Z=${Z} su=${su}: sigma_Z formula`, all('w02-sz')[1], law.sz);
    relOk(`pin b=${b} Z=${Z} su=${su}: sigma_X measured (cm)`, get('w02-sx'), 100 * m.sx);
    relOk(`pin b=${b} Z=${Z} su=${su}: ellipse axis ratio`, get('w02-ar'), m.ratio);
    relOk(`pin b=${b} Z=${Z} su=${su}: condition number`, get('w02-kap'), cot(th / 2));
    ok(`pin b=${b} Z=${Z}: theta in the readout`, /θ/.test(page.text('w02-kap')) && close(+/θ\s*([\d.]+)/.exec(page.text('w02-kap'))[1], deg(th), 0.0051), page.text('w02-kap'));
    return m;
  }
  const d0 = pinState(0.5, 5, SU);
  ok('opening state: sigma_Z measured is within 1% of the formula', rel(d0.sz, TL.law(F, 0.5, 5, SU).sz) < 0.01);
  pinState(0.5, 2.5, SU); pinState(0.5, 10, SU);
  pinState(1, 10, SU);
  { const m = pinState(0.5, 10, 0.2); void m; }
  pinState(0.5, 14, 0.2);
  // overlap readout and the crossover readout in the pin view
  for (const b of [0.25, 0.5, 1, 2]) {
    setAll({ view: 'pin', b, z: 5, su: SU });
    const e = baselineExp(b, WIN);
    ok('overlap readout, b=' + b, close(get('w02-ov'), e.overlap, 0.051), [get('w02-ov'), e.overlap]);
  }
  setAll({ view: 'pin', b: 0.5, z: 5, su: SU }); relOk('crossover readout (toy camera, b=0.5)', get('w02-xs'), facts.x_toy, 0.006);
  setAll({ view: 'pin', b: 2 }); relOk('crossover readout (toy camera, b=2)', get('w02-xs'), facts.x_toy2, 0.006);
  // the match view
  function matchState(b, pix, h) {
    setAll({ view: 'match', b, pix, win: h });
    const e = baselineExp(b, h), IB = e.IB, c = costOf(IB, pix, h, e.dmax), d = argminFirst(c), dt = IA.id[pix] >= 0 ? F * b / IA.depth[pix] : 0;
    ok(`match b=${b} pix=${pix}: true d`, close(get('w02-dt'), dt, 0.0051), [get('w02-dt'), dt]);
    ok(`match b=${b} pix=${pix}: whole-pixel d`, close(all('w02-di')[0], d, 0.0051), [all('w02-di')[0], d]);
    ok(`match b=${b} pix=${pix}: refined d`, close(all('w02-di')[1], parabola(c, d), 0.0051), [all('w02-di')[1], parabola(c, d)]);
    ok(`match b=${b}: matched right`, close(get('w02-ok'), e.right, 0.051), [get('w02-ok'), e.right]);
    ok(`match b=${b}: overlap`, close(get('w02-ov'), e.overlap, 0.051), [get('w02-ov'), e.overlap]);
  }
  matchState(0.5, 64, WIN); matchState(0.5, 100, WIN); matchState(2, 60, WIN); matchState(2, 14, WIN); matchState(1, 64, 4);
  // the cloud view
  for (const b of [0.5, 0.1, 2]) {
    setAll({ view: 'cloud', b });
    const turn = 15 * Math.PI / 180, e = TL.scans(SC, A, b, turn, 0.02);
    ok('clouds b=' + b + ': delivered', close(all('w02-nn')[0], e.delivered, 0.00051), [all('w02-nn')[0], e.delivered]);
    ok('clouds b=' + b + ': placed', close(all('w02-nn')[1], e.placed, 0.00051), [all('w02-nn')[1], e.placed]);
  }
  ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
}

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
