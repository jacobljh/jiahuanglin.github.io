/* triangulation_lab.js — private engine of 3D lesson 02, "A second ray pins the point".
 *
 * Built on flatland.js (FL); deterministic (seeded) and small enough to run on every slider move.
 *
 *   The pin         TL.pin, TL.rectified      two pixel rays → one point; the 2×2 system, its determinant, angle and condition number
 *   The error law   TL.law, TL.eig2           first-order σ_Z = √2·Z²·σ_u/(f·b), σ_X = Z·σ_u/f, their covariance and its ellipse
 *                   TL.normals, TL.cloud,     Monte-Carlo triangulation of noisy pixels (the same normals are reused on every call,
 *                   TL.stats                  so the cloud moves smoothly with the sliders) and the measured covariance
 *   The baseline    TL.photo, TL.visible      a supersampled photograph; which surface pixels of A does B also see
 *   The partner     TL.cost, TL.pick,         SSD block matching along the row (the epipolar line of a plane is the whole row),
 *                   TL.refine, TL.matchAll    whole-pixel and parabola-refined; share of correct matches
 *   Range sensors   TL.cross                  depth at which triangulation stops beating a range sensor of standard deviation sR
 *   Point clouds    TL.cloudOf, TL.nn,        back-project a depth map; mean nearest-point distance; the two scans of the exit
 *                   TL.scans
 *   The picture     TL.paint                  the widget's three views (pin / match / cloud), drawing only; the page computes the state it draws
 *
 * Conventions follow flatland.js: x to the right, z up; a camera at the origin with heading π/2 has its own X = x, Z = z.
 * A triangulation that lands behind the cameras or beyond ZMAX is counted as "lost", not as a very large depth.
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require === 'function' ? require('./flatland.js') : null);
var TL = {};
var ZMAX = 60;
TL.ZMAX = ZMAX;
function sq(x) { return x * x; }

/* ───────────────────────────── the pin ───────────────────────────── */
/* Two pixel rays  o_A + t_A d_A = o_B + t_B d_B  are the linear system  [d_A  −d_B] (t_A, t_B)ᵀ = o_B − o_A.
 * For unit directions its determinant is ± sin θ (θ = angle between the rays) and its singular values are √2·cos(θ/2) and
 * √2·sin(θ/2): the condition number is cot(θ/2), about 2/θ.  Returns the point in the world and in A's own frame (xc, zc). */
TL.pin = function (camA, uA, camB, uB) {
  var r = FL.triangulate(camA, uA, camB, uB);
  if (!r.ok) return { ok: false };
  var rA = FL.pixelRay(camA, uA), rB = FL.pixelRay(camB, uB), c = FL.toCam(camA, r.x, r.z);
  return { ok: true, x: r.x, z: r.z, xc: c.xc, zc: c.zc, det: rA.dx * rB.dz - rA.dz * rB.dx, theta: r.angle, kappa: 1 / Math.tan(r.angle / 2) };
};
/* The same pin for a rectified pair (B = A slid by b, same heading), by hand:  X − k_A Z = 0,  X − k_B Z = b,  k = (u − W/2)/f.
 * The determinant of this 2×2 system is k_A − k_B = d/f, so it is singular exactly when the disparity d = u_A − u_B is zero. */
TL.rectified = function (f, b, W, uA, uB) {
  var kA = (uA - W / 2) / f, kB = (uB - W / 2) / f, det = kA - kB, Z = b / det;
  return { X: kA * Z, Z: Z, det: det };
};

/* ───────────────────────────── the error law ───────────────────────────── */
/* principal std devs a ≥ b of a 2×2 covariance [[sxx, sxz],[sxz, szz]] and the angle of the major axis from +x */
TL.eig2 = function (sxx, sxz, szz) {
  var m = (sxx + szz) / 2, d = Math.sqrt(sq((sxx - szz) / 2) + sxz * sxz);
  return { a: Math.sqrt(m + d), b: Math.sqrt(Math.max(m - d, 1e-300)), ang: 0.5 * Math.atan2(2 * sxz, sxx - szz) };
};
/* first order, point on A's axis: Z = f b / d with d = u_A − u_B, X = (u_A − W/2) Z / f, independent pixel errors σ_u */
TL.law = function (f, b, Z, su) {
  var sx = Z * su / f, sz = Math.SQRT2 * Z * Z * su / (f * b), cxz = -Z * Z * Z * su * su / (f * f * b), e = TL.eig2(sx * sx, cxz, sz * sz);
  return { sx: sx, sz: sz, cxz: cxz, a: e.a, b: e.b, ang: e.ang, ratio: e.a / e.b };
};
TL.normals = function (n, seed) {
  var rng = FL.rng(seed), g = new Float64Array(2 * n);
  for (var i = 0; i < 2 * n; i++) g[i] = FL.randn(rng);
  return g;
};
/* n noisy triangulations of the point P: both pixels get an independent error su·g */
TL.cloud = function (camA, camB, P, su, g, n) {
  var uA0 = FL.project(camA, P.x, P.z).u, uB0 = FL.project(camB, P.x, P.z).u, out = { n: 0, lost: 0, x: new Float64Array(n), z: new Float64Array(n) };
  for (var k = 0; k < n; k++) {
    var r = FL.triangulate(camA, uA0 + su * g[2 * k], camB, uB0 + su * g[2 * k + 1]);
    if (!r.ok || r.zc <= 0 || r.zc > ZMAX) { out.lost++; continue; }
    var c = FL.toCam(camA, r.x, r.z);
    out.x[out.n] = c.xc; out.z[out.n] = c.zc; out.n++;
  }
  return out;
};
/* measured mean, std devs, covariance and principal axes of a cloud (in A's frame: x sideways, z depth) */
TL.stats = function (c) {
  var n = c.n, mx = 0, mz = 0, sxx = 0, szz = 0, sxz = 0, k;
  for (k = 0; k < n; k++) { mx += c.x[k]; mz += c.z[k]; }
  mx /= n; mz /= n;
  for (k = 0; k < n; k++) { var dx = c.x[k] - mx, dz = c.z[k] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  sxx /= n; szz /= n; sxz /= n;
  var e = TL.eig2(sxx, sxz, szz);
  return { n: n, mx: mx, mz: mz, sx: Math.sqrt(sxx), sz: Math.sqrt(szz), cxz: sxz, a: e.a, b: e.b, ang: e.ang, ratio: e.a / e.b };
};
/* polyline of the k-sigma ellipse centred at (cx, cz) with std devs a, b and major axis at angle ang */
TL.ellipse = function (cx, cz, a, b, ang, k, n) {
  var pts = [], c = Math.cos(ang), s = Math.sin(ang);
  for (var i = 0; i <= n; i++) { var t = 2 * Math.PI * i / n, u = k * a * Math.cos(t), v = k * b * Math.sin(t); pts.push([cx + c * u - s * v, cz + s * u + c * v]); }
  return pts;
};

/* ───────────────────────────── the baseline: photographs and overlap ───────────────────────────── */
/* a photograph averages ss rays per pixel; depth / id / hx / hz are those of the pixel-centre ray */
TL.photo = function (scene, cam, ss) {
  var img = FL.render(scene, cam), i, k;
  for (i = 0; i < cam.W; i++) {
    var r = 0, g = 0, b = 0;
    for (k = 0; k < ss; k++) {
      var ray = FL.pixelRay(cam, i + (k + 0.5) / ss), h = FL.raycast(scene, ray.ox, ray.oz, ray.dx, ray.dz, scene.far), c = h.hit ? FL.shade(scene, h, ray, {}) : scene.bg;
      r += c[0]; g += c[1]; b += c[2];
    }
    img.r[i] = r / ss; img.g[i] = g / ss; img.b[i] = b / ss;
  }
  return img;
};
/* which surface pixels of A does B also see?  A's surface point must land inside B's image, where B's own depth buffer must agree */
TL.visible = function (imgA, camB, imgB, tol) {
  var vis = new Uint8Array(imgA.W), i;
  for (i = 0; i < imgA.W; i++) {
    if (imgA.id[i] < 0) continue;
    var q = FL.project(camB, imgA.hx[i], imgA.hz[i]), j = Math.floor(q.u);
    if (q.u >= 0 && q.u < camB.W && imgB.id[j] === imgA.id[i] && Math.abs(imgB.depth[j] - q.zc) < (tol || 0.25)) vis[i] = 1;
  }
  return vis;
};

/* ───────────────────────────── the partner: block matching along the row ───────────────────────────── */
/* SSD cost of matching A's window (half-width h) around pixel i with B's window shifted left by d = 0..dmax; NaN where a window leaves an image */
TL.cost = function (imgA, imgB, i, h, dmax) {
  var cst = new Float64Array(dmax + 1), d, k;
  for (d = 0; d <= dmax; d++) {
    var c = 0;
    for (k = -h; k <= h; k++) {
      var ia = i + k, ib = ia - d;
      if (ia < 0 || ia >= imgA.W || ib < 0 || ib >= imgB.W) { c = NaN; break; }
      c += sq(imgA.r[ia] - imgB.r[ib]) + sq(imgA.g[ia] - imgB.g[ib]) + sq(imgA.b[ia] - imgB.b[ib]);
    }
    cst[d] = c;
  }
  return cst;
};
/* the whole-pixel disparity with the lowest finite cost (the first, when costs tie); -1 if none is defined */
TL.pick = function (cst) {
  var best = -1, d;
  for (d = 0; d < cst.length; d++) if (isFinite(cst[d]) && (best < 0 || cst[d] < cst[best])) best = d;
  return best;
};
/* sub-pixel refinement: the vertex of the parabola through the costs at d−1, d, d+1 */
TL.refine = function (cst, d) {
  if (d <= 0 || d >= cst.length - 1 || !isFinite(cst[d - 1]) || !isFinite(cst[d + 1])) return d;
  var den = cst[d - 1] - 2 * cst[d] + cst[d + 1];
  return den > 1e-12 ? d + 0.5 * (cst[d - 1] - cst[d + 1]) / den : d;
};
/* match every surface pixel of A: dTrue = f b / Z from A's depth buffer, dInt = TL.pick, dSub = TL.refine.
 * A match is "right" when B sees the point and |dInt − dTrue| ≤ 1 px. */
TL.matchAll = function (imgA, imgB, camB, f, b, h, dmax) {
  var W = imgA.W, vis = TL.visible(imgA, camB, imgB), o = { dTrue: new Float64Array(W), dInt: new Float64Array(W).fill(-1), dSub: new Float64Array(W).fill(-1),
    vis: vis, right: new Uint8Array(W), nObj: 0, nVis: 0, nRight: 0 }, i;
  for (i = 0; i < W; i++) {
    if (imgA.id[i] < 0) continue;
    var cst = TL.cost(imgA, imgB, i, h, dmax), d = TL.pick(cst);
    o.nObj++; o.dTrue[i] = f * b / imgA.depth[i]; o.dInt[i] = d; o.dSub[i] = d >= 0 ? TL.refine(cst, d) : -1;
    if (vis[i]) { o.nVis++; if (d >= 0 && Math.abs(d - o.dTrue[i]) <= 1) { o.right[i] = 1; o.nRight++; } }
  }
  return o;
};

/* ───────────────────────────── range sensors ───────────────────────────── */
/* stereo's σ_Z = Z² σ_d / (f b) equals a range sensor's sR at this depth */
TL.cross = function (f, b, sd, sR) { return Math.sqrt(sR * f * b / sd); };

/* ───────────────────────────── point clouds ───────────────────────────── */
/* back-project every valid pixel of a depth map with the pose of `cam`: P = FL.backproject(cam, u + ½, Z).  With a camera at the origin
 * heading π/2 the points are in the sensor's OWN frame; with the camera's true pose they are in the world. */
TL.cloudOf = function (cam, depth) {
  var P = [];
  for (var i = 0; i < depth.length; i++) if (depth[i] > 0) P.push(FL.backproject(cam, i + 0.5, depth[i]));
  return P;
};
/* mean nearest-point distance between two clouds: the average of the two directed means (P → Q and Q → P) */
TL.nn = function (P, Q) {
  function directed(S, T) {
    var s = 0, i, j;
    for (i = 0; i < S.length; i++) { var m = Infinity; for (j = 0; j < T.length; j++) { var d = Math.sqrt(sq(S[i].x - T[j].x) + sq(S[i].z - T[j].z)); if (d < m) m = d; } s += m; }
    return s / S.length;
  }
  return 0.5 * (directed(P, Q) + directed(Q, P));
};
/* the exit: sensor A at camA, sensor C = A slid by b and turned by `turn`; both return a range-camera depth map (std sigma).
 * own = back-projected in each sensor's own frame, drawn on the same axes; world = back-projected with the true poses. */
TL.scans = function (scene, camA, b, turn, sigma) {
  var camC = FL.moved(camA, b, 0, turn), own = FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: camA.f, W: camA.W });
  var dA = FL.noisyDepth(camA, FL.render(scene, camA), { kind: 'tof', sigma: sigma }, FL.rng(5)), dC = FL.noisyDepth(camC, FL.render(scene, camC), { kind: 'tof', sigma: sigma }, FL.rng(6));
  var s = { camC: camC, ownA: TL.cloudOf(own, dA), ownC: TL.cloudOf(own, dC), worldA: TL.cloudOf(camA, dA), worldC: TL.cloudOf(camC, dC) };
  s.delivered = TL.nn(s.ownA, s.ownC); s.placed = TL.nn(s.worldA, s.worldC);
  return s;
};

/* ───────────────────────────── the picture ───────────────────────────── */
/* TL.paint(view, ctx, w, h, narrow, T, E) draws one of the widget's three views: 'pin', 'match' or 'cloud'.  T is the state the page computes from its
 * controls (compute() in the lesson); E = {SC, A, IA, F, W, SR, ZD}: the street, camera A, A's photograph, the focal length (px), the image width (px),
 * the range sensor's error (m) and the depths of the measured dots on the sigma_Z plot.  Drawing only: every number it shows is in T. */
TL.paint = function (view, ctx, w, h, narrow, T, E) {
  var D = FL.draw, C = FL.C, SC = E.SC, A = E.A, IA = E.IA, F = E.F, W = E.W, SR = E.SR, ZD = E.ZD;
    /* camera A's letter goes on its left and the other camera's (D.camera's default) on its right, so two close cameras never overprint them */
    function labelLeft(ctx, v, cam, s, col) { var a = FL.camAxes(cam); D.text(ctx, s, v.X(cam.x) - 7 * a.fx - 9 * a.rx, v.Y(cam.z) + 7 * a.fz + 9 * a.rz + 2, col, 11, 'center', 600); }
    function drawPin(ctx, w, h, narrow) {
      var wb = narrow ? [8, 8, w - 16, h * 0.34] : [8, 8, w * 0.33, h - 16], rx = narrow ? 8 : wb[2] + 24, rw = w - rx - 8, st = T.st, Z = T.Z, k, n = Math.min(300, T.cl.n);
      var zy = narrow ? wb[3] + 30 : 24, zh = narrow ? h * 0.28 : (h - 76) * 0.57, py = zy + zh + 40, ph = h - py - 28, v = D.view(wb[0], wb[1], wb[2], wb[3], -3.6, 4.6, -1, 14.6);
      D.frame(ctx, wb[0], wb[1], wb[2], wb[3], C.panel); D.grid(ctx, v, 2); D.scene(ctx, SC, v, { fillAlpha: 0.1, lineWidth: 2 });
      D.wline(ctx, v, 0, 0, 0, Z, 'rgba(37,99,235,0.55)', 1); D.wline(ctx, v, T.B.x, 0, 0, Z, 'rgba(217,119,6,0.75)', 1);
      var dot = function (x, y, r, col, bx, by, bw, bh) { if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) D.dot(ctx, x, y, r, col); };
      for (k = 0; k < n; k++) dot(v.X(T.cl.x[k]), v.Y(T.cl.z[k]), 1.2, 'rgba(31,36,48,0.4)', wb[0], wb[1], wb[2], wb[3]);
      D.camera(ctx, A, v, { color: C.blue, len: 1.8 }); labelLeft(ctx, v, A, 'A', C.blue); D.camera(ctx, T.B, v, { color: C.amber, label: 'B', len: 1.8 });
      D.label(ctx, 'P, Z = ' + Z.toFixed(1) + ' m', v.X(0) + 8, v.Y(Z) - 10, C.ink, 10); D.mono(ctx, 'world, to scale', wb[0] + 6, wb[1] + 10, C.mute, 10);
      var s = Math.min(zh / 2 / (3.4 * st.sz), rw / 2 / (3.4 * st.sx)), cx = rx + rw / 2, cy = zy + zh / 2;
      var X = function (x) { return cx + x * s; }, Y = function (z) { return cy - (z - Z) * s; }, mp = function (e) { return e.map(function (p) { return [X(p[0]), Y(p[1])]; }); };
      D.frame(ctx, rx, zy, rw, zh, C.white);
      for (k = 0; k < n; k++) dot(X(T.cl.x[k]), Y(T.cl.z[k]), 1.5, 'rgba(37,99,235,0.3)', rx, zy, rw, zh);
      D.path(ctx, mp(TL.ellipse(0, Z, T.law.a, T.law.b, T.law.ang, 1, 60)), C.amber, 1.6, [5, 4]); D.path(ctx, mp(TL.ellipse(st.mx, st.mz, st.a, st.b, st.ang, 1, 60)), C.ink, 1.6);
      D.line(ctx, cx - 6, cy, cx + 6, cy, C.red, 1.5); D.line(ctx, cx, cy - 6, cx, cy + 6, C.red, 1.5);
      D.mono(ctx, 'zoom on P (cross), equal scale, box height ' + (zh / s).toPrecision(2) + ' m' + (T.cl.lost ? ', ' + T.cl.lost + ' trials lost' : ''), rx + 4, zy - 9, C.mute, 10);
      var lx = Math.log(1.5), lw = Math.log(14) - lx, ly = Math.log(0.004), lh = Math.log(8) - ly;
      var PX = function (z) { return rx + 4 + (Math.log(z) - lx) / lw * (rw - 8); }, PY = function (q) { return py + ph - (Math.log(q) - ly) / lh * ph; }, cu = [];
      D.frame(ctx, rx, py, rw, ph, C.white);
      for (k = 0; k <= 40; k++) { var zz = 1.5 * Math.pow(14 / 1.5, k / 40); cu.push([PX(zz), PY(TL.law(F, T.b, zz, T.su).sz)]); }
      D.path(ctx, cu, C.blue, 1.6); D.line(ctx, rx, PY(SR), rx + rw, PY(SR), C.green, 1.3, [5, 4]); D.mono(ctx, 'range sensor 2.5 cm', rx + rw - 4, PY(SR) - 7, C.green, 9, 'right');
      ZD.forEach(function (z, j) { D.dot(ctx, PX(z), PY(T.dots[j]), 2.6, C.ink); }); D.dot(ctx, PX(Z), PY(st.sz), 4.5, C.amber, C.white);
      [2, 5, 10].forEach(function (z) { D.mono(ctx, z + ' m', PX(z), py + ph + 10, C.mute, 9, 'center'); }); [0.01, 0.1, 1].forEach(function (q) { D.mono(ctx, q + ' m', rx + 4, PY(q) - 6, C.mute, 9); });
      D.mono(ctx, 'sigma_Z against Z (log-log): law, trials, this P (amber)', rx + 4, py - 9, C.mute, 10);
    }

    function drawMatch(ctx, w, h) {
      var sx = 8, sw = w - 16, sh = 24, y1 = 26, y2 = y1 + sh + 40, cw = sw / W, i = T.pix, hh = T.h, d = T.di, m = T.m, k;
      D.strip(ctx, IA, sx, y1, sw, sh, { label: 'A: window around pixel ' + i + '; below, each surface pixel: matched right (green), wrong (red), unseen by B (grey)' }); D.strip(ctx, T.IB, sx, y2, sw, sh, { label: 'B: window at the cheapest shift (blue), at the true partner (dashed)' });
      for (k = 0; k < W; k++) if (IA.id[k] >= 0) { ctx.fillStyle = m.right[k] ? C.green : m.vis[k] ? C.red : C.dim; ctx.fillRect(sx + k * cw, y1 + sh + 3, cw, 6); }
      ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = C.amber; ctx.strokeRect(sx + (i - hh) * cw, y1 - 2, (2 * hh + 1) * cw, sh + 4);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = C.green; ctx.strokeRect(sx + (i - T.dt - hh) * cw, y2 - 2, (2 * hh + 1) * cw, sh + 4); ctx.setLineDash([]);
      if (d >= 0) { ctx.strokeStyle = C.blue; ctx.strokeRect(sx + (i - d - hh) * cw, y2 - 2, (2 * hh + 1) * cw, sh + 4); D.line(ctx, sx + (i + 0.5) * cw, y1 + sh + 10, sx + (i - d + 0.5) * cw, y2 - 2, C.blue, 1.2); }
      ctx.restore();
      var py = y2 + sh + 40, ph = h - py - 12, cmax = 0, bw = Math.max(1.5, (sw - 12) / (T.dmax + 1) - 1), CX = function (q) { return sx + 6 + (q + 0.5) / (T.dmax + 1) * (sw - 12); };
      T.cst.forEach(function (c) { if (isFinite(c)) cmax = Math.max(cmax, c); });
      var flat = cmax < 1e-9; cmax = Math.max(cmax, 1e-9);
      D.frame(ctx, sx, py, sw, ph, C.white);
      var BH = function (c) { return (Math.log10(c + 1e-4) + 4) / (Math.log10(cmax + 1e-4) + 4) * (ph - 14); };
      for (k = 0; k <= T.dmax; k++) if (isFinite(T.cst[k])) { ctx.fillStyle = k === d ? C.amber : 'rgba(148,163,184,0.75)'; ctx.fillRect(CX(k) - bw / 2, py + ph - 4 - BH(T.cst[k]), bw, BH(T.cst[k]) + 1); }
      D.line(ctx, CX(T.dt), py + 2, CX(T.dt), py + ph - 2, C.green, 1.3, [4, 3]);
      D.mono(ctx, flat ? 'cost is zero at every shift: nothing to match' : 'cost C(d), log scale, of each shift d = 0 .. ' + T.dmax + ' (amber: cheapest, green: true)', sx + 4, py - 9, C.mute, 10);
    }

    function drawClouds(ctx, w, h, narrow) {
      var bw = narrow ? w - 16 : (w - 24) / 2, bh = narrow ? (h - 78) / 2 : h - 44, sc = T.sc, e = [-4.8, 6.2, -0.6, 11.6], k;
      for (k = 0; k < 2; k++) {
        var x0 = narrow ? 8 : 8 + k * (bw + 8), y0 = narrow ? 24 + k * (bh + 34) : 24, v = D.view(x0, y0, bw, bh, e[0], e[1], e[2], e[3]), P = k ? [sc.worldA, sc.worldC] : [sc.ownA, sc.ownC];
        D.frame(ctx, x0, y0, bw, bh, C.panel); D.grid(ctx, v, 2); if (k) D.scene(ctx, SC, v, { fillAlpha: 0.1, lineWidth: 2 });
        P.forEach(function (S, j) { S.forEach(function (p) { D.dot(ctx, v.X(p.x), v.Y(p.z), 2.4, j ? C.amber : C.blue); }); });
        D.camera(ctx, A, v, { color: C.blue, len: 1.2 }); labelLeft(ctx, v, A, 'A', C.blue); if (k) D.camera(ctx, sc.camC, v, { color: C.amber, label: 'C', len: 1.2 });
        D.mono(ctx, k ? 'with the true pose of C applied' : 'as delivered: each cloud in its own sensor frame', x0 + 4, y0 - 9, C.mute, 10);
        D.label(ctx, 'nearest-point distance ' + (k ? sc.placed.toFixed(3) : sc.delivered.toFixed(2)) + ' m', x0 + 8, y0 + 14, k ? C.green : C.red, 11);
      }
    }
  if (view === 'pin') drawPin(ctx, w, h, narrow); else if (view === 'match') drawMatch(ctx, w, h); else drawClouds(ctx, w, h, narrow);
};

root.TL = TL;
if (typeof module !== 'undefined' && module.exports) module.exports = TL;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
