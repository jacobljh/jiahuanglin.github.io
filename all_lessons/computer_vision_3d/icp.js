/* icp.js — the private engine of 3D lesson 04, "Pose by agreement I: aligning scans".
 *
 * Planar scan registration in Flatland.  A scan is a set of points in its sensor's own frame; a pose is {a, x, z}
 * (FL.se2: p_out = R(a)·p + (x, z)).  T maps the SOURCE scan (scan 2) into the frame of the MODEL scan (scan 1).
 *
 *   ICP.crossCov(P, Q)         centroids, spreads and the cross-covariance H = Σ p̃ q̃ᵀ of paired point lists
 *   ICP.align(P, Q)            closed-form rigid alignment of paired points: translation at the centroids, the angle by atan2
 *   ICP.svd2(H)                SVD of a 2×2 matrix, H = U diag(s) Vᵀ, s ≥ 0 (U, V orthogonal; they may be reflections)
 *   ICP.kabsch(P, Q, guard)    the SVD route R = V diag(1, det(VUᵀ)) Uᵀ;  guard = false gives plain R = V Uᵀ, which can be a mirror
 *   ICP.scanPoints(scan, o)    FL.lidar output → {n, x, z (sensor frame), beam, id};  o.bearing = r0 keeps only the beam directions
 *   ICP.model(pts, o)          scan → searchable model: a grid for exact nearest neighbours + a local line normal at each point
 *   ICP.nearest(m, x, z)       exact nearest neighbour {j, d2}
 *   ICP.match / ICP.step / ICP.run   the ICP loop (point-to-point 'p2p' or point-to-line 'p2l', optional trimming)
 *   ICP.normalMatrix(...)      the 3×3 Gauss-Newton matrix of the point-to-line error and its eigenvalues (how well the scene pins the pose)
 *   ICP.purity(src, mod, mt)   share of matches that land on the surface the point really came from (a diagnostic: needs ground truth)
 *   ICP.poseErr(T, S)          translation error (m) and rotation error (rad) of T against the truth S
 *   ICP.world(kind, sigma)     the lesson's two scans of the room: kind = room | person | corridor | bearing (see below), cached
 *   ICP.startPose / ICP.isOk   a starting guess at a given rotation and position error from the truth / "within 10 cm and 1.5 degrees"
 *   ICP.sweep(W, metric, keep, tr)   ICP from 61 starting rotation errors (6 degrees apart): where each ends, the share of right-wall first matches, the basin
 *   ICP.paint(cv, S)           the widget's picture (scans and matches, RMS per iteration, the basin plots); drawing only, S is the state the page computes
 *
 * Deterministic: no Math.random, no Date.  Depends on FL (flatland.js) only for FL.se2.wrap.
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require !== 'undefined' ? require('./flatland.js') : null);
var ICP = {};
var atan2 = Math.atan2, cos = Math.cos, sin = Math.sin, sqrt = Math.sqrt, abs = Math.abs;

/* ───────────────────────────── closed form for paired points ───────────────────────────── */
/* P[i], Q[i] are {x, z}.  Returns centroids pc, qc; centred sums; and H = Σ p̃ q̃ᵀ as [h11, h12, h21, h22] (row-major).
 * A = H11 + H22 = Σ p̃·q̃ (dot) and B = H12 − H21 = Σ p̃×q̃ (cross) are what the angle needs.                              */
ICP.crossCov = function (P, Q) {
  var n = P.length, px = 0, pz = 0, qx = 0, qz = 0, i;
  for (i = 0; i < n; i++) { px += P[i].x; pz += P[i].z; qx += Q[i].x; qz += Q[i].z; }
  px /= n; pz /= n; qx /= n; qz /= n;
  var h11 = 0, h12 = 0, h21 = 0, h22 = 0, spp = 0, sqq = 0;
  for (i = 0; i < n; i++) {
    var ax = P[i].x - px, az = P[i].z - pz, bx = Q[i].x - qx, bz = Q[i].z - qz;
    h11 += ax * bx; h12 += ax * bz; h21 += az * bx; h22 += az * bz; spp += ax * ax + az * az; sqq += bx * bx + bz * bz;
  }
  return { n: n, pc: { x: px, z: pz }, qc: { x: qx, z: qz }, H: [h11, h12, h21, h22], spp: spp, sqq: sqq, A: h11 + h22, B: h12 - h21 };
};
/* minimise E(T) = Σ ‖R(a) p_i + t − q_i‖²:  a = atan2(B, A),  t = q̄ − R(a) p̄ ;  E at the minimum = Σ‖p̃‖² + Σ‖q̃‖² − 2 √(A² + B²) */
ICP.align = function (P, Q) {
  var c = ICP.crossCov(P, Q), a = atan2(c.B, c.A), ca = cos(a), sa = sin(a);
  return { a: a, x: c.qc.x - (ca * c.pc.x - sa * c.pc.z), z: c.qc.z - (sa * c.pc.x + ca * c.pc.z), E: c.spp + c.sqq - 2 * sqrt(c.A * c.A + c.B * c.B) };
};
/* E(T) for paired points */
ICP.sumSq = function (P, Q, T) {
  var e = 0, c = cos(T.a), s = sin(T.a);
  for (var i = 0; i < P.length; i++) {
    var dx = c * P[i].x - s * P[i].z + T.x - Q[i].x, dz = s * P[i].x + c * P[i].z + T.z - Q[i].z;
    e += dx * dx + dz * dz;
  }
  return e;
};
/* SVD of a 2×2 matrix [h11, h12, h21, h22] = U diag(s1, s2) Vᵀ with s1 ≥ s2 ≥ 0, U and V orthogonal (columns = singular vectors).
 * Written as H = R(φ) diag(s1, s2') R(θ) with a signed s2'; a negative s2' is moved into the last row of Vᵀ (that makes V a reflection). */
ICP.svd2 = function (H) {
  var E = (H[0] + H[3]) / 2, F = (H[0] - H[3]) / 2, G = (H[2] + H[1]) / 2, Hh = (H[2] - H[1]) / 2;
  var Qn = sqrt(E * E + Hh * Hh), Rn = sqrt(F * F + G * G), s1 = Qn + Rn, s2 = Qn - Rn, a1 = atan2(G, F), a2 = atan2(Hh, E);
  var phi = (a2 + a1) / 2, th = (a2 - a1) / 2;
  var U = [cos(phi), -sin(phi), sin(phi), cos(phi)];
  var Vt = [cos(th), -sin(th), sin(th), cos(th)];
  if (s2 < 0) { s2 = -s2; Vt = [Vt[0], Vt[1], -Vt[2], -Vt[3]]; }
  return { U: U, s: [s1, s2], V: [Vt[0], Vt[2], Vt[1], Vt[3]] };
};
/* the SVD route:  H = U S Vᵀ,  R = V diag(1, δ) Uᵀ with δ = det(V Uᵀ) (guard) or δ = 1 (no guard: may be a reflection). */
ICP.kabsch = function (P, Q, guard) {
  var c = ICP.crossCov(P, Q), s = ICP.svd2(c.H), U = s.U, V = s.V;
  var VU = [V[0] * U[0] + V[1] * U[1], V[0] * U[2] + V[1] * U[3], V[2] * U[0] + V[3] * U[1], V[2] * U[2] + V[3] * U[3]];
  var det = VU[0] * VU[3] - VU[1] * VU[2], d = guard === false ? 1 : (det < 0 ? -1 : 1);
  var R = [V[0] * U[0] + d * V[1] * U[1], V[0] * U[2] + d * V[1] * U[3], V[2] * U[0] + d * V[3] * U[1], V[2] * U[2] + d * V[3] * U[3]];
  var tx = c.qc.x - (R[0] * c.pc.x + R[1] * c.pc.z), tz = c.qc.z - (R[2] * c.pc.x + R[3] * c.pc.z), e = 0;
  for (var i = 0; i < P.length; i++) {
    var dx = R[0] * P[i].x + R[1] * P[i].z + tx - Q[i].x, dz = R[2] * P[i].x + R[3] * P[i].z + tz - Q[i].z; e += dx * dx + dz * dz;
  }
  return { R: R, det: R[0] * R[3] - R[1] * R[2], a: atan2(R[2], R[0]), x: tx, z: tz, E: e, detH: c.H[0] * c.H[3] - c.H[1] * c.H[2], s: s.s };
};

/* ───────────────────────────── scans and models ───────────────────────────── */
ICP.scanPoints = function (scan, o) {
  o = o || {};
  var xs = [], zs = [], bm = [], id = [];
  for (var j = 0; j < scan.length; j++) if (scan[j].ok) {
    var x = scan[j].lx, z = scan[j].lz;
    if (o.bearing) { var r = Math.hypot(x, z) || 1; x *= o.bearing / r; z *= o.bearing / r; }    // keep the direction of the beam, guess the range
    xs.push(x); zs.push(z); bm.push(j); id.push(scan[j].id);
  }
  return { n: xs.length, x: Float64Array.from(xs), z: Float64Array.from(zs), beam: Int32Array.from(bm), id: Int16Array.from(id), nb: scan.length };
};
/* A searchable model.  o: cell (grid size, m), win (neighbours on each side along the scan for the line fit), rad (largest distance of a neighbour, m),
 * sigma (range noise, m: a normal is trusted when the line-fit RMS is below 0.01 + 1.5 σ).  Normals: PCA of the neighbours along the scan. */
ICP.model = function (pts, o) {
  o = o || {};
  var n = pts.n, cell = o.cell || 0.5, win = o.win === undefined ? 3 : o.win, rad = o.rad || 1.0, tol = o.tol === undefined ? 0.01 + 1.5 * (o.sigma || 0) : o.tol, i, k;
  var xmin = 1e9, xmax = -1e9, zmin = 1e9, zmax = -1e9;
  for (i = 0; i < n; i++) { xmin = Math.min(xmin, pts.x[i]); xmax = Math.max(xmax, pts.x[i]); zmin = Math.min(zmin, pts.z[i]); zmax = Math.max(zmax, pts.z[i]); }
  var m = { n: n, x: pts.x, z: pts.z, id: pts.id, nx: new Float64Array(n), nz: new Float64Array(n), ok: new Uint8Array(n), cell: cell,
            x0: xmin - cell, z0: zmin - cell, gx: Math.ceil((xmax - xmin) / cell) + 3, gz: Math.ceil((zmax - zmin) / cell) + 3 };
  var cnt = new Int32Array(m.gx * m.gz + 1), cid = new Int32Array(n);
  for (i = 0; i < n; i++) { cid[i] = Math.floor((pts.z[i] - m.z0) / cell) * m.gx + Math.floor((pts.x[i] - m.x0) / cell); cnt[cid[i] + 1]++; }
  for (i = 0; i < m.gx * m.gz; i++) cnt[i + 1] += cnt[i];
  var fill = Int32Array.from(cnt.subarray(0, m.gx * m.gz)), items = new Int32Array(n);
  for (i = 0; i < n; i++) items[fill[cid[i]]++] = i;
  m.start = cnt; m.items = items;
  var nb = pts.nb || n, byBeam = new Int32Array(nb).fill(-1);
  for (i = 0; i < n; i++) byBeam[pts.beam[i]] = i;
  for (i = 0; i < n; i++) {
    var sx = 0, sz = 0, c = 0, list = [];
    for (k = -win; k <= win; k++) {
      var j = byBeam[((pts.beam[i] + k) % nb + nb) % nb];
      if (j < 0) continue;
      if ((pts.x[j] - pts.x[i]) * (pts.x[j] - pts.x[i]) + (pts.z[j] - pts.z[i]) * (pts.z[j] - pts.z[i]) > rad * rad) continue;
      list.push(j); sx += pts.x[j]; sz += pts.z[j]; c++;
    }
    if (c < 4) continue;
    sx /= c; sz /= c;
    var cxx = 0, cxz = 0, czz = 0;
    for (k = 0; k < list.length; k++) { var dx = pts.x[list[k]] - sx, dz = pts.z[list[k]] - sz; cxx += dx * dx; cxz += dx * dz; czz += dz * dz; }
    cxx /= c; cxz /= c; czz /= c;
    var df = cxx - czz, l2 = (cxx + czz) / 2 - sqrt(df * df / 4 + cxz * cxz), ang = 0.5 * atan2(2 * cxz, df);    // l2 = variance across the best line
    if (sqrt(Math.max(l2, 0)) <= tol) { m.nx[i] = -sin(ang); m.nz[i] = cos(ang); m.ok[i] = 1; }
  }
  return m;
};
/* exact nearest neighbour by growing square rings of grid cells */
ICP.nearest = function (m, x, z) {
  var cx = Math.floor((x - m.x0) / m.cell), cz = Math.floor((z - m.z0) / m.cell), best = -1, bd = Infinity, r, ix, iz, k, j;
  if (cx < 0 || cz < 0 || cx >= m.gx || cz >= m.gz) {                       // outside the grid: brute force (rare)
    for (j = 0; j < m.n; j++) { var d0 = (m.x[j] - x) * (m.x[j] - x) + (m.z[j] - z) * (m.z[j] - z); if (d0 < bd) { bd = d0; best = j; } }
    return { j: best, d2: bd };
  }
  var rmax = Math.max(m.gx, m.gz);
  for (r = 0; r <= rmax; r++) {
    for (iz = cz - r; iz <= cz + r; iz++) {
      if (iz < 0 || iz >= m.gz) continue;
      var step = (iz === cz - r || iz === cz + r || r === 0) ? 1 : 2 * r;
      for (ix = cx - r; ix <= cx + r; ix += step) {
        if (ix < 0 || ix >= m.gx) continue;
        var cell = iz * m.gx + ix;
        for (k = m.start[cell]; k < m.start[cell + 1]; k++) {
          j = m.items[k];
          var d = (m.x[j] - x) * (m.x[j] - x) + (m.z[j] - z) * (m.z[j] - z);
          if (d < bd) { bd = d; best = j; }
        }
      }
    }
    if (best >= 0 && bd <= (r * m.cell) * (r * m.cell)) break;
  }
  return { j: best, d2: bd };
};

/* ───────────────────────────── the ICP loop ───────────────────────────── */
/* Transform the source by T and match every point to its nearest model point.  qx, qz: the transformed source;  j: matched model index;
 * d2: squared distance to it;  r: signed distance along the model normal at the match (NaN where the model has no usable normal). */
ICP.match = function (src, mod, T) {
  var n = src.n, c = cos(T.a), s = sin(T.a), qx = new Float64Array(n), qz = new Float64Array(n), jj = new Int32Array(n), d2 = new Float64Array(n), r = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    qx[i] = c * src.x[i] - s * src.z[i] + T.x; qz[i] = s * src.x[i] + c * src.z[i] + T.z;
    var nn = ICP.nearest(mod, qx[i], qz[i]);
    jj[i] = nn.j; d2[i] = nn.d2;
    r[i] = mod.ok[nn.j] ? mod.nx[nn.j] * (qx[i] - mod.x[nn.j]) + mod.nz[nn.j] * (qz[i] - mod.z[nn.j]) : NaN;
  }
  return { qx: qx, qz: qz, j: jj, d2: d2, r: r };
};
/* which pairs take part: all, or the `keep` fraction with the smallest residual (trimmed ICP).  Without a usable normal a pair is dropped
 * from the point-to-line error.  Returns the list of source indices. */
function select(mt, n, metric, keep) {
  var idx = [], i, key = metric === 'p2p' ? mt.d2 : null;
  for (i = 0; i < n; i++) if (metric === 'p2p' || !isNaN(mt.r[i])) idx.push(i);
  if (keep < 1) {
    var res = function (i) { return key ? key[i] : mt.r[i] * mt.r[i]; };
    idx.sort(function (a, b) { return res(a) - res(b) || a - b; });
    idx = idx.slice(0, Math.max(3, Math.round(keep * idx.length)));
  }
  return idx;
}
/* one iteration at pose T: match, choose pairs, measure the error E (this is the value that never increases for 'p2p'), solve for the new pose */
ICP.step = function (src, mod, T, o) {
  o = o || {};
  var metric = o.metric || 'p2p', keep = o.keep === undefined ? 1 : o.keep, mt = ICP.match(src, mod, T), idx = select(mt, src.n, metric, keep), k, i;
  var E = 0;
  for (k = 0; k < idx.length; k++) E += metric === 'p2p' ? mt.d2[idx[k]] : mt.r[idx[k]] * mt.r[idx[k]];
  var res = { E: E, rms: sqrt(E / Math.max(1, idx.length)), used: idx.length, match: mt, idx: idx, T: T };
  if (idx.length < 3) return res;
  if (metric === 'p2p') {
    var P = [], Q = [];
    for (k = 0; k < idx.length; k++) { i = idx[k]; P.push({ x: src.x[i], z: src.z[i] }); Q.push({ x: mod.x[mt.j[i]], z: mod.z[mt.j[i]] }); }
    var al = ICP.align(P, Q);
    res.Tnew = { a: al.a, x: al.x, z: al.z };
  } else {
    /* Gauss-Newton on the point-to-line error, unknowns ξ = (dx, dz, dθ):  r_i(ξ) ≈ r_i + n·d + (q×n) dθ ;  then q ← R(dθ) q + d */
    var Hm = new Float64Array(9), g = new Float64Array(3), jr = new Float64Array(3);
    for (k = 0; k < idx.length; k++) {
      i = idx[k]; var j = mt.j[i], nx = mod.nx[j], nz = mod.nz[j];
      jr[0] = nx; jr[1] = nz; jr[2] = mt.qx[i] * nz - mt.qz[i] * nx;
      for (var a = 0; a < 3; a++) { g[a] -= jr[a] * mt.r[i]; for (var b = 0; b < 3; b++) Hm[a * 3 + b] += jr[a] * jr[b]; }
    }
    var xi = solveTrunc(Hm, g);                                                // directions the data do not constrain are not moved
    var sc = Math.min(1, 1 / Math.max(1e-12, abs(xi[0]), abs(xi[1]), abs(xi[2]) * 1.5));   // a single linearised step is capped at 1 m or 0.67 rad
    var dth = xi[2] * sc, cd = cos(dth), sd = sin(dth);
    res.Tnew = { a: T.a + dth, x: cd * T.x - sd * T.z + xi[0] * sc, z: sd * T.x + cd * T.z + xi[1] * sc };
  }
  return res;
};
/* solve H ξ = g by the eigen-decomposition of H, dropping eigen-directions whose eigenvalue is below 1e-3 of the largest */
function solveTrunc(H, g) {
  var e = ICP.eig3(H), out = [0, 0, 0], lmax = e.vals[2];
  for (var k = 0; k < 3; k++) {
    if (e.vals[k] <= 1e-3 * lmax) continue;
    var c = (e.vecs[k][0] * g[0] + e.vecs[k][1] * g[1] + e.vecs[k][2] * g[2]) / e.vals[k];
    out[0] += c * e.vecs[k][0]; out[1] += c * e.vecs[k][1]; out[2] += c * e.vecs[k][2];
  }
  return out;
}
/* iterate.  o: metric, keep, maxIter, tolT (m), tolA (rad).  path[k] = state at the START of iteration k (the pose and the error measured there);
 * the last entry is the final pose.  iters = number of updates applied. */
ICP.run = function (src, mod, T0, o) {
  o = o || {};
  var maxIter = o.maxIter || 60, tolT = o.tolT === undefined ? 1e-3 : o.tolT, tolA = o.tolA === undefined ? 1e-3 : o.tolA, path = [], T = T0, converged = false, k;
  for (k = 0; k < maxIter; k++) {
    var st = ICP.step(src, mod, T, o);
    path.push({ T: T, E: st.E, rms: st.rms, used: st.used });
    if (!st.Tnew) break;
    var dT = Math.hypot(st.Tnew.x - T.x, st.Tnew.z - T.z), dA = abs(FL.se2.wrap(st.Tnew.a - T.a));
    T = st.Tnew;
    if (dT < tolT && dA < tolA) { converged = true; k++; break; }
  }
  var last = ICP.step(src, mod, T, o);
  path.push({ T: T, E: last.E, rms: last.rms, used: last.used });
  return { path: path, T: T, iters: k, converged: converged };
};
ICP.poseErr = function (T, S) {
  return { dt: Math.hypot(T.x - S.x, T.z - S.z), da: abs(FL.se2.wrap(T.a - S.a)) };
};
/* share of the matches that land on the surface (shape id) the point was really measured on — needs ground truth, so it is a diagnostic only */
ICP.purity = function (src, mod, mt) {
  var ok = 0;
  for (var i = 0; i < src.n; i++) if (mod.id[mt.j[i]] === src.id[i]) ok++;
  return ok / src.n;
};

/* ───────────────────────────── how well the scene pins the pose ───────────────────────────── */
/* H = Σ JᵀJ with J = [n_x, n_z, q×n] over the pairs of the point-to-line error at pose T (unknowns: dx, dz in metres, dθ in radians).
 * Returns the matrix and its eigenvalues (ascending) with eigenvectors (vecs[k] belongs to vals[k]).                                */
ICP.normalMatrix = function (src, mod, T) {
  var mt = ICP.match(src, mod, T), H = new Float64Array(9), n = 0, jr = new Float64Array(3);
  for (var i = 0; i < src.n; i++) {
    if (isNaN(mt.r[i])) continue;
    var j = mt.j[i], nx = mod.nx[j], nz = mod.nz[j];
    jr[0] = nx; jr[1] = nz; jr[2] = mt.qx[i] * nz - mt.qz[i] * nx;
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) H[a * 3 + b] += jr[a] * jr[b];
    n++;
  }
  var e = ICP.eig3(H);
  return { H: H, n: n, vals: e.vals, vecs: e.vecs };
};
/* Jacobi eigen-decomposition of a symmetric 3×3 (row-major).  vals ascending; vecs[k] is the eigenvector (3 numbers) of vals[k]. */
ICP.eig3 = function (A0) {
  var A = Float64Array.from(A0), V = new Float64Array(9), i, k, p, q;
  for (i = 0; i < 3; i++) V[i * 3 + i] = 1;
  for (var sweep = 0; sweep < 60; sweep++) {
    if (A[1] * A[1] + A[2] * A[2] + A[5] * A[5] < 1e-30) break;
    for (p = 0; p < 2; p++) for (q = p + 1; q < 3; q++) {
      var apq = A[p * 3 + q];
      if (abs(apq) < 1e-300) continue;
      var theta = (A[q * 3 + q] - A[p * 3 + p]) / (2 * apq), t = (theta >= 0 ? 1 : -1) / (abs(theta) + sqrt(theta * theta + 1)), c = 1 / sqrt(t * t + 1), s = t * c;
      for (k = 0; k < 3; k++) { var akp = A[k * 3 + p], akq = A[k * 3 + q]; A[k * 3 + p] = c * akp - s * akq; A[k * 3 + q] = s * akp + c * akq; }
      for (k = 0; k < 3; k++) { var apk = A[p * 3 + k], aqk = A[q * 3 + k]; A[p * 3 + k] = c * apk - s * aqk; A[q * 3 + k] = s * apk + c * aqk; }
      for (k = 0; k < 3; k++) { var vkp = V[k * 3 + p], vkq = V[k * 3 + q]; V[k * 3 + p] = c * vkp - s * vkq; V[k * 3 + q] = s * vkp + c * vkq; }
    }
  }
  var idx = [0, 1, 2].sort(function (a, b) { return A[a * 3 + a] - A[b * 3 + b]; });
  return { vals: idx.map(function (id) { return A[id * 3 + id]; }), vecs: idx.map(function (id) { return [V[id], V[3 + id], V[6 + id]]; }) };
};


/* ───────────────────────────── the data of the lesson, and the basin sweep ───────────────────────────── */
/* Two scans of 180 beams (range 14 m, noise sigma), seeds 11 and 12.  room: FL.scenes.room(), sensor 1 at (x, z) = (-0.5, 4.2) heading 0, sensor 2 moved by
 * (turn 0.30 rad, x 0.7, z 0.3) in sensor 1's frame.  person: a 0.25 m radius disc stands 1.5 m from sensor 2 (120 degrees to its left) in scan 2 only.
 * corridor: two parallel walls 2.4 m apart (60 m long, far beyond the range), sensor 2 moved by (0.08 rad, 1.0, 0.1).  bearing: the room, but every beam's
 * point is put at a guessed range of 5 m along the beam (all a camera row gives is the direction).  W.Ts is the true pose of sensor 2 in sensor 1's frame. */
var WORLDS = {}, SWEEPS = {}, UDIR = 40 * Math.PI / 180, KEEP = 0.9;
ICP.DEG = Math.PI / 180; ICP.KEEP = KEEP; ICP.MAXIT = 60;
ICP.world = function (kind, sg) {
  var key = kind + '|' + sg;
  if (WORLDS[key]) return WORLDS[key];
  var room = FL.scenes.room(), P1 = FL.se2.make(0, -0.5, 4.2), P2R = FL.se2.compose(P1, FL.se2.make(0.30, 0.7, 0.3));
  var sc1 = room, sc2 = room, p1 = P1, rel = FL.se2.make(0.30, 0.7, 0.3), r0 = 0, person = null, view = [-7.2, 7.2, -1.1, 9.3];
  if (kind === 'corridor') {
    var wall = [0.4, 0.4, 0.45];
    sc1 = sc2 = { shapes: [FL.box(0, -0.15, 30, 0.15, wall), FL.box(0, 2.55, 30, 0.15, wall)], light: [0, 1], amb: 0.4, bg: [1, 1, 1], far: 60, stepScale: 0.9 };
    p1 = FL.se2.make(0, 0, 1.2); rel = FL.se2.make(0.08, 1.0, 0.1); view = [-9, 9, -1.8, 4.2];
  }
  if (kind === 'person') {
    person = { x: P2R.x + 1.5 * Math.cos(P2R.a + 120 * ICP.DEG), z: P2R.z + 1.5 * Math.sin(P2R.a + 120 * ICP.DEG), r: 0.25 };
    sc2 = { shapes: room.shapes.concat([FL.circle(person.x, person.z, person.r, [0.9, 0.2, 0.2])]), light: room.light, amb: room.amb, bg: room.bg, far: room.far, stepScale: room.stepScale };
  }
  if (kind === 'bearing') r0 = 5;
  var p2 = FL.se2.compose(p1, rel), s1 = FL.lidar(sc1, p1, { n: 180, sigma: sg, range: 14, rng: FL.rng(11) }), s2 = FL.lidar(sc2, p2, { n: 180, sigma: sg, range: 14, rng: FL.rng(12) });
  return (WORLDS[key] = { key: key, kind: kind, src: ICP.scanPoints(s2, { bearing: r0 }), mod: ICP.model(ICP.scanPoints(s1, { bearing: r0 }), { sigma: sg }),
                          p1: p1, p2: p2, Ts: FL.se2.compose(FL.se2.inv(p1), p2), sc: sc1, person: person, view: view });
};
ICP.startPose = function (W, rot, tr) { return { a: W.Ts.a + rot * ICP.DEG, x: W.Ts.x + tr * Math.cos(UDIR), z: W.Ts.z + tr * Math.sin(UDIR) }; };
ICP.isOk = function (e) { return e.dt < 0.10 && e.da < 1.5 * ICP.DEG; };
ICP.sweep = function (W, metric, keep, tr) {
  var key = W.key + '|' + metric + '|' + keep + '|' + tr;
  if (SWEEPS[key]) return SWEEPS[key];
  var rows = [], q, d, T0, r, e;
  for (q = 0; q < 61; q++) {
    d = -180 + 6 * q; T0 = ICP.startPose(W, d, tr);
    r = ICP.run(W.src, W.mod, T0, { metric: metric, keep: keep, maxIter: ICP.MAXIT }); e = ICP.poseErr(r.T, W.Ts);
    rows.push({ d: d, dt: e.dt, ok: ICP.isOk(e), pur: ICP.purity(W.src, W.mod, ICP.match(W.src, W.mod, T0)) });
  }
  var lo = 30, hi = 30;                                                      // the contiguous run of successes around a zero start
  if (rows[30].ok) { while (lo > 0 && rows[lo - 1].ok) lo--; while (hi < 60 && rows[hi + 1].ok) hi++; } else lo = hi = -1;
  return (SWEEPS[key] = { rows: rows, lo: lo < 0 ? null : rows[lo].d, hi: hi < 0 ? null : rows[hi].d });
};

/* ───────────────────────────── the picture ───────────────────────────── */
/* ICP.paint(cv, S) draws the widget of the lesson on canvas cv (its CSS height is set by the page).  S is the state the page computes from its controls:
 * S.W the world (ICP.world), S.run the displayed run and S.runs both runs, S.k the displayed iteration, S.metric, S.keep, S.rot (the start rotation error, degrees),
 * S.sw the basin sweep.  Left: both scans and the matches; lower left: the RMS distance of the matches per iteration; right: where ICP ends from 61 starts. */
var LOG0 = 0.1;
function logY(v, lo, hi, y0, hh) { return y0 + hh - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * hh; }
ICP.paint = function (cv, S) {
  var D = FL.draw, C = FL.C;
  var X = D.setup(cv), ctx = X.ctx, w = X.w, h = X.h, narrow = w < 600, Wd = S.W, k = S.k, st = S.run.path[k], T = st.T, i, q;
  var wbw = narrow ? w - 16 : Math.round(w * 0.56), wb = [8, 8, wbw, Math.round(wbw / 1.375)], wy = wb[1] + wb[3] + 34;
  var P = narrow ? { ix: 48, iw: w - 56, iy: wy, ih: 120, bx: 48 } : { ix: 54, iw: wbw - 46, iy: wy, ih: h - wy - 26, bx: wbw + 70 };
  P.bw = w - 8 - P.bx; P.b1y = narrow ? wy + 160 : 30; P.b1h = narrow ? 170 : Math.round((h - 88) * 0.66); P.b2y = P.b1y + P.b1h + 34; P.b2h = narrow ? 90 : h - P.b2y - 24;
  /* world view: scan 1 (blue), scan 2 moved by the pose of the displayed iteration (amber), the matches (grey; red when a pair is left out of the solve) */
  var v = D.view(wb[0], wb[1], wb[2], wb[3], Wd.view[0], Wd.view[1], Wd.view[2], Wd.view[3]);
  D.frame(ctx, wb[0], wb[1], wb[2], wb[3], C.white);
  ctx.save(); ctx.beginPath(); ctx.rect(wb[0], wb[1], wb[2], wb[3]); ctx.clip();
  D.grid(ctx, v, 2);
  if (Wd.kind === 'corridor') { D.wline(ctx, v, -30, 0, 30, 0, C.dim, 3); D.wline(ctx, v, -30, 2.4, 30, 2.4, C.dim, 3); }
  else {
    [[-6, 0, 6, 0], [-6, 8, 6, 8], [-6, 0, -6, 8], [6, 0, 6, 8]].forEach(function (L) { D.wline(ctx, v, L[0], L[1], L[2], L[3], C.dim, 3); });
    D.scene(ctx, { shapes: Wd.sc.shapes.slice(4) }, v, { fillAlpha: 0.08, lineWidth: 2 });
  }
  if (Wd.person) D.wdot(ctx, v, Wd.person.x, Wd.person.z, Wd.person.r * v.s, 'rgba(220,38,38,0.25)', C.red);
  var Tw = FL.se2.compose(Wd.p1, T), sp = ICP.step(Wd.src, Wd.mod, T, { metric: S.metric, keep: S.keep }), mt = sp.match, used = new Uint8Array(Wd.src.n);
  sp.idx.forEach(function (j) { used[j] = 1; });
  for (i = 0; i < Wd.src.n; i++) {
    var j = mt.j[i], a = FL.se2.apply(Wd.p1, { x: mt.qx[i], z: mt.qz[i] }), foot = S.metric === 'p2l' && !isNaN(mt.r[i]);
    var b = FL.se2.apply(Wd.p1, { x: foot ? mt.qx[i] - mt.r[i] * Wd.mod.nx[j] : Wd.mod.x[j], z: foot ? mt.qz[i] - mt.r[i] * Wd.mod.nz[j] : Wd.mod.z[j] });
    D.wline(ctx, v, a.x, a.z, b.x, b.z, used[i] ? 'rgba(91,101,115,0.45)' : 'rgba(220,38,38,0.55)', 1);
  }
  for (i = 0; i < Wd.mod.n; i++) { var m = FL.se2.apply(Wd.p1, { x: Wd.mod.x[i], z: Wd.mod.z[i] }); D.wdot(ctx, v, m.x, m.z, 2.3, C.blue); }
  for (i = 0; i < Wd.src.n; i++) { var s = FL.se2.apply(Tw, { x: Wd.src.x[i], z: Wd.src.z[i] }); D.wdot(ctx, v, s.x, s.z, 2.3, C.amber); }
  for (q = 0; q <= k; q++) { var tp = FL.se2.apply(Wd.p1, S.run.path[q].T); D.wdot(ctx, v, tp.x, tp.z, 1.8, C.green); }
  var e2 = FL.se2.apply(Wd.p1, T);
  D.wline(ctx, v, e2.x, e2.z, Wd.p2.x, Wd.p2.z, C.green, 1.2, [3, 3]);
  D.wdot(ctx, v, Wd.p1.x, Wd.p1.z, 5, C.blue, C.white); D.wdot(ctx, v, e2.x, e2.z, 5, C.amber, C.white);
  ctx.beginPath(); ctx.arc(v.X(Wd.p2.x), v.Y(Wd.p2.z), 8, 0, 2 * Math.PI); ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.stroke();
  /* three point labels, each at its usual offset unless that runs out of the (clipping) panel or onto a label already placed; then the mirrored and doubled offsets are tried */
  var taken = [], tag = function (s, x, y, col, dx, dy) {
    var wd = 5.5 * s.length, c = [[dx, dy], [dx, -dy], [-dx, dy], [-dx, -dy], [dx, 2 * dy], [dx, -2 * dy], [-dx, 2 * dy], [-dx, -2 * dy]], k, b, pick = null;
    for (k = 0; k < 8 && !pick; k++) {
      var lx = x + c[k][0] - (c[k][0] < 0 ? wd : 0), ly = y + c[k][1];
      b = [lx, ly - 5, lx + wd, ly + 5];
      if (b[0] < wb[0] + 2 || b[2] > wb[0] + wb[2] - 2 || b[1] < wb[1] + 2 || b[3] > wb[1] + wb[3] - 2) continue;
      if (taken.some(function (t) { return b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]; })) continue;
      pick = { b: b, x: x + c[k][0], y: ly, left: c[k][0] < 0 };
    }
    if (!pick) pick = { b: [x + dx, y + dy - 5, x + dx + wd, y + dy + 5], x: x + dx, y: y + dy, left: false };
    taken.push(pick.b); D.label(ctx, s, pick.x, pick.y, col, 9, pick.left ? 'right' : 'left');
  };
  tag('truth', v.X(Wd.p2.x), v.Y(Wd.p2.z), C.green, 11, 4); tag('sensor 1', v.X(Wd.p1.x), v.Y(Wd.p1.z), C.blue, 8, 12); tag('sensor 2: estimate', v.X(e2.x), v.Y(e2.z), C.amber, 8, -12);
  ctx.restore();
  D.mono(ctx, 'blue: scan 1 · amber: scan 2 at iteration ' + k + ' · grey: matches', wb[0] + 6, wb[1] + wb[3] - 8, C.mute, 9);
  /* RMS distance of the matches per iteration, both error measures */
  D.frame(ctx, P.ix, P.iy, P.iw, P.ih, C.white);
  var kmax = Math.max(S.runs.p2p.iters, S.runs.p2l.iters, 8), gx = function (u) { return P.ix + 6 + u / kmax * (P.iw - 12); }, gy = function (cm) { return logY(cm, LOG0, 300, P.iy, P.ih); };
  [0.1, 1, 10, 100].forEach(function (g) { D.line(ctx, P.ix, gy(g), P.ix + P.iw, gy(g), C.grid, 1); D.mono(ctx, g + ' cm', P.ix - 4, gy(g), C.dim, 9, 'right'); });
  ['p2p', 'p2l'].forEach(function (m) { D.path(ctx, S.runs[m].path.map(function (p, u) { return [gx(u), gy(100 * p.rms)]; }), m === 'p2p' ? C.mute : C.amber, m === S.metric ? 2.6 : 1.2); });
  D.line(ctx, gx(k), P.iy, gx(k), P.iy + P.ih, C.blue, 1, [3, 3]);
  D.dot(ctx, gx(k), gy(100 * st.rms), 4, S.metric === 'p2p' ? C.mute : C.amber, C.white);
  D.mono(ctx, 'RMS distance of the matches, per iteration', P.ix - 46, P.iy - 11, C.mute, 9.5);
  D.mono(ctx, 'grey: point-to-point · orange: point-to-line', P.ix + P.iw - 4, P.iy + P.ih - 9, C.mute, 9, 'right');
  D.mono(ctx, '0', P.ix + 3, P.iy + P.ih + 9, C.mute, 9); D.mono(ctx, kmax + ' iterations', P.ix + P.iw - 3, P.iy + P.ih + 9, C.mute, 9, 'right');
  /* the basin: where ICP ends (position error) and the share of the first matches on the right wall, for 61 starting rotation errors */
  var rows = S.sw.rows, bx = function (d) { return P.bx + (d + 180) / 360 * P.bw; }, byv = function (cm) { return logY(cm, LOG0, 1000, P.b1y, P.b1h); };
  D.frame(ctx, P.bx, P.b1y, P.bw, P.b1h, C.white);
  ctx.fillStyle = 'rgba(22,163,74,0.10)'; ctx.fillRect(P.bx, byv(10), P.bw, P.b1y + P.b1h - byv(10));
  [1, 10, 100].forEach(function (g) { D.line(ctx, P.bx, byv(g), P.bx + P.bw, byv(g), C.grid, 1); D.mono(ctx, g + ' cm', P.bx - 4, byv(g), C.dim, 9, 'right'); });
  D.path(ctx, rows.map(function (r) { return [bx(r.d), byv(100 * r.dt)]; }), C.amber, 1.8);
  rows.forEach(function (r) { D.dot(ctx, bx(r.d), byv(100 * r.dt), 2.6, r.ok ? C.green : C.red); });
  D.line(ctx, bx(S.rot), P.b1y, bx(S.rot), P.b1y + P.b1h, C.ink, 1, [3, 3]);
  D.mono(ctx, 'where ICP ends: position error (log)', P.bx - 46, P.b1y - 11, C.mute, 9.5);
  D.mono(ctx, 'green band: under 10 cm', P.bx + 5, P.b1y + P.b1h - 8, C.green, 9);
  D.frame(ctx, P.bx, P.b2y, P.bw, P.b2h, C.white);
  [0, 50, 100].forEach(function (g) { var y = P.b2y + P.b2h - g / 100 * P.b2h; D.line(ctx, P.bx, y, P.bx + P.bw, y, C.grid, 1); D.mono(ctx, g + ' %', P.bx - 4, y, C.dim, 9, 'right'); });
  if (Wd.kind !== 'bearing') {
    D.path(ctx, rows.map(function (r) { return [bx(r.d), P.b2y + P.b2h - r.pur * P.b2h]; }), C.blue, 1.5);
    rows.forEach(function (r) { D.dot(ctx, bx(r.d), P.b2y + P.b2h - r.pur * P.b2h, 2.4, r.ok ? C.green : C.red); });
  }
  D.line(ctx, bx(S.rot), P.b2y, bx(S.rot), P.b2y + P.b2h, C.ink, 1, [3, 3]);
  D.mono(ctx, 'share of the first matches on the right wall', P.bx - 46, P.b2y - 11, C.mute, 9.5);
  D.mono(ctx, 'start rotation error', P.bx + P.bw / 2, P.b2y + P.b2h + 22, C.mute, 9, 'center');
  [-180, -90, 0, 90, 180].forEach(function (d) { D.mono(ctx, d + '°', Math.min(Math.max(bx(d), P.bx + 10), P.bx + P.bw - 10), P.b2y + P.b2h + 10, C.mute, 9, 'center'); });
};

root.ICP = ICP;
if (typeof module !== 'undefined' && module.exports) module.exports = ICP;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
