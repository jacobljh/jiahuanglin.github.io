/* l07_labels.js — Lesson 7 (what the label means): the clauses of a label as functions, the labels a detector can be taught, and the tests that check them.  Load after street.js (and streetview.js).  Namespace SV.l07.
 *
 * A label is a definition.  The renderer hands over coverage (what fraction of a pixel the pedestrian covers), a centre-ray depth and range, and an id; the label stage decides, from those, which pixels are the
 * pedestrian (modal: the visible ones; amodal: the whole silhouette), how much of the silhouette must show for the pedestrian to count, how far away the pedestrian is, where the mask sits on the pixel grid and how finely the area was counted.
 *   L.cover(scene, o)         pedestrian coverage by casting o.SSh x o.SSv rays per pixel, optionally for the pedestrian alone (o.only = 'ped': the silhouette), with the ray grid displaced by (o.dx, o.dy) pixels
 *   L.counts(row, rule)       does a pedestrian with this visible area and silhouette count under a scoring rule?
 *   L.strip(frame, arm)       the frame as a detector is taught it under a label variant (modal, amodal, shifted, finely counted); SV.train reads x, cov and y only
 *   L.rangeOf / L.rangeFactor depth (along the axis) against range (along the ray)
 *   L.sliverScene / L.testCoverage / L.testDepth   the two conformance tests of the contract
 * Deterministic: no Math.random, no Date.  Nothing in SV is changed. */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l07 = L;

/* ───────────── a coverage caster: the renderer's ray logic, reduced to "is the first thing hit a pedestrian?" ───────────── */
var P = { tin: 0, tout: 0 };
function pathCircle(dx, dz, cx, cz, r) {
  var b = -(cx * dx + cz * dz), c = cx * cx + cz * cz - r * r, disc = b * b - c;
  if (disc <= 0) return false;
  var s = Math.sqrt(disc), t1 = -b - s, t2 = -b + s;
  if (t2 <= 1e-6 || t1 <= 1e-6) return false;
  P.tin = t1; P.tout = t2;
  return true;
}
function pathBox(dx, dz, cx, cz, hx, hz) {
  var tmin = -Infinity, tmax = Infinity, t1, t2, q;
  if (Math.abs(dx) < 1e-12) { if (-cx < -hx || -cx > hx) return false; }
  else { t1 = (cx - hx) / dx; t2 = (cx + hx) / dx; if (t1 > t2) { q = t1; t1 = t2; t2 = q; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; }
  if (Math.abs(dz) < 1e-12) { if (-cz < -hz || -cz > hz) return false; }
  else { t1 = (cz - hz) / dz; t2 = (cz + hz) / dz; if (t1 > t2) { q = t1; t1 = t2; t2 = q; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; }
  if (tmin > tmax || tmax <= 1e-6 || tmin <= 1e-6) return false;
  P.tin = tmin; P.tout = tmax;
  return true;
}
/* o: {SSh, SSv: rays per pixel along u and v (default 2 x 2, the program's); only: 'ped' casts the pedestrian alone, so the coverage is the whole silhouette; dx, dy: the ray grid is displaced by (dx, dy) pixels,
 * which is what a mask built with the other pixel-centre convention looks like}.  With no option it reproduces SV.render(...).cov to the last bit (the oracle checks).  Returns Float32Array(W*H). */
L.cover = function (scene, o) {
  o = o || {};
  var C = SV.CAM, W = C.W, H = C.H, f = C.f, V0 = C.V0, hc = C.hc, SSh = o.SSh || 2, SSv = o.SSv || 2, ox = o.dx || 0, oy = o.dy || 0;
  var parts = o.only ? scene.parts.filter(function (q) { return q.cls === o.only; }) : scene.parts, np = parts.length;
  var cov = new Float32Array(W * H), acc = new Float64Array(H), tin = new Float64Array(np), tout = new Float64Array(np), ok = new Uint8Array(np), inv = 1 / (SSh * SSv), i, j, a, b, k;
  for (i = 0; i < W; i++) {
    acc.fill(0);
    for (a = 0; a < SSh; a++) {
      var tp = (i + ox + (a + 0.5) / SSh - W / 2) / f, cph = 1 / Math.sqrt(1 + tp * tp), dx = tp * cph, dz = cph;
      for (k = 0; k < np; k++) {
        var p = parts[k], hit = p.kind === 'circle' ? pathCircle(dx, dz, p.x, p.z, p.r) : pathBox(dx, dz, p.x, p.z, p.hx, p.hz);
        ok[k] = hit ? 1 : 0;
        if (hit) { tin[k] = P.tin; tout[k] = P.tout; }
      }
      for (j = 0; j < H; j++) {
        for (b = 0; b < SSv; b++) {
          var rho = (V0 - (j + oy + (b + 0.5) / SSv)) / f, s = rho * cph, best = Infinity, bk = -1;
          if (s < 0) { best = -hc / s; bk = -2; }                           // the ground
          for (k = 0; k < np; k++) {
            if (!ok[k]) continue;
            var pk = parts[k], h1 = hc + s * tin[k];
            if (tin[k] < best && h1 >= pk.y0 && h1 <= pk.y1) { best = tin[k]; bk = k; }
            else if (s > 0 && h1 < pk.y0) { var tu = (pk.y0 - hc) / s; if (tu <= tout[k] && tu < best) { best = tu; bk = k; } }
            else if (s < 0 && h1 > pk.y1) { var tt = (pk.y1 - hc) / s; if (tt <= tout[k] && tt < best) { best = tt; bk = k; } }
          }
          if (bk >= 0 && parts[bk].cls === 'ped') acc[j] += 1;
        }
      }
    }
    for (j = 0; j < H; j++) cov[j * W + i] = acc[j] * inv;
  }
  return cov;
};
L.areaOf = function (cov) { var s = 0, i; for (i = 0; i < cov.length; i++) s += cov[i]; return s; };
/* pixels at or above a coverage level (a hard mask: the pedestrian's outline) */
L.countAbove = function (cov, level) { var n = 0, i; for (i = 0; i < cov.length; i++) if (cov[i] >= level) n++; return n; };

/* ───────────── scoring rules: who counts ───────────── */
/* a row needs {area: visible px², full: silhouette px²}.  pixel: any pixel (the program's own label); k6: at least 6 px² visible; frac15: the street's label (at least 15% of the silhouette); exam: the series' rule
 * (the street's label and 6 px²); half: at least half of the silhouette; reason: at most 35% hidden (the visibility clause of Caltech's reasonable subset); amodal: every pedestrian whose whole silhouette is 6 px² or more. */
L.RULES = ['pixel', 'k6', 'frac15', 'exam', 'half', 'reason', 'amodal'];
L.counts = function (r, rule) {
  switch (rule) {
    case 'pixel': return r.area >= 1;
    case 'k6': return r.area >= 6;
    case 'frac15': return r.area >= 1 && r.area >= 0.15 * r.full;
    case 'exam': return r.area >= 6 && r.area >= 0.15 * r.full;
    case 'half': return r.area > 0 && r.area >= 0.5 * r.full;
    case 'reason': return r.area > 0 && r.area >= 0.65 * r.full;
    case 'amodal': return r.full >= 6;
    default: return false;
  }
};
/* a label rule as the label stage applies it: the frame holds a pedestrian when the labelled area reaches kvis pixels and rel times the silhouette */
L.present = function (area, full, rule) { var need = Math.max(rule.kvis || 0, (rule.rel || 0) * full); return area >= need && area > 0 ? 1 : 0; };
/* the miss rate over the pedestrians a rule counts: rows {area, full}, scores one per row, found = score above thr */
L.miss = function (rows, scores, thr, rule) {
  var n = 0, hit = 0, i;
  for (i = 0; i < rows.length; i++) if (L.counts(rows[i], rule)) { n++; if (scores[i] > thr) hit++; }
  return { n: n, miss: n ? 1 - hit / n : null };
};

/* ───────────── the labels a detector can be taught ───────────── */
/* arm: {} or null = modal (the frame as drawn: the visible mask, counted with 2 x 2 rays);  {amodal: true} = the whole silhouette, hidden part included;  {dx, dy} = the mask displaced by (dx, dy) pixels;
 * {ss: 8} = the visible mask counted with ss x ss rays.  The label of the frame (is a pedestrian there?) follows the same mask under the program's own rule (any pixel).  Frames without a pedestrian are unchanged. */
L.strip = function (fr, arm) {
  if (!arm || !fr.scene.ped) return fr;
  var o = arm.amodal ? { only: 'ped' } : {}, cov;
  if (arm.dx) o.dx = arm.dx; if (arm.dy) o.dy = arm.dy; if (arm.ss) { o.SSh = arm.ss; o.SSv = arm.ss; }
  cov = L.cover(fr.scene, o);
  if (arm.blur) cov = L.blur(cov, arm.blur);
  var a = L.areaOf(cov);
  return { x: fr.x, cov: cov, y: L.present(a, a, { kvis: 1 }), area: a };
};
L.ARMS = {
  modal: null,
  amodal: { amodal: true },
  shift05: { dx: 0.5, dy: 0.5 },
  shift10: { dx: 1, dy: 1 },
  fine: { ss: 8 },
  ray: { ss: 1 },                                     // one ray through each pixel centre: what an object-index pass delivers
  soft: { blur: 0 }                                   // the mask softened by a pixel filter wider than the program's; the width is set below, once the filter is known
};

/* the cells of one image that a detector is taught as pedestrian: the training code's own rule (a cell of the stride-2 grid is positive when the pixel at its centre, or the one above it, is at least half pedestrian and the
 * frame counts as holding one).  A mirror of the rule SV.train applies to the cov and y it is given. */
L.cellLabels = function (s) {
  var C = SV.CAM, W = C.W, H = C.H, st = SV.STEP, nu = Math.ceil(W / st), nv = Math.ceil(H / st), lab = new Uint8Array(nu * nv), iu, jv;
  for (jv = 0; jv < nv; jv++) for (iu = 0; iu < nu; iu++) {
    var u = Math.min(W - 1, iu * st + 1), v = Math.min(H - 1, jv * st + 1), c = Math.max(s.cov[v * W + u], s.cov[Math.max(0, v - 1) * W + u]);
    lab[jv * nu + iu] = (c >= 0.5 && s.y) ? 1 : 0;
  }
  return { lab: lab, nu: nu, nv: nv };
};
/* the pixel a cell looks at */
L.cellPixel = function (c, nu) { var st = SV.STEP, C = SV.CAM; return { u: Math.min(C.W - 1, (c % nu) * st + 1), v: Math.min(C.H - 1, Math.floor(c / nu) * st + 1) }; };
/* is the cell within one pixel of a mask pixel (coverage at least `level`)? */
L.cellOn = function (cov, c, nu, level) {
  var C = SV.CAM, p = L.cellPixel(c, nu), a, b;
  for (a = -1; a <= 1; a++) for (b = -1; b <= 1; b++) { var u = p.u + a, v = p.v + b; if (u >= 0 && u < C.W && v >= 0 && v < C.H && cov[v * C.W + u] >= level) return true; }
  return false;
};

/* ───────────── the rare slice of Lesson 6, and the packed columns of l07_data.js ───────────── */
/* a frame of the street in case R (a pedestrian steps out from behind the van closer than 12 m): the scene law with the step-out forced and the draw kept when the pedestrian is closer than 12 m, as Lesson 6 samples it.
 * A lab privilege: a project cannot sample a case on demand. */
L.rareFrame = function (seed) {
  var cfg = SV.REAL, rs = SV.stream(seed, 'scene'), rl = SV.stream(seed, 'look'), rn = SV.stream(seed, 'sensor'), sc;
  for (;;) { sc = SV.drawScene(cfg.scene, rs, { ped: true, mode: 'emerge' }); if (sc.ped.parts[0].z < 12) break; }
  var look = SV.drawLook(cfg.look, sc, rl), ren = SV.render(sc, look), x = SV.sense(ren.rad, cfg.sensor, rn), lab = SV.labels(ren.cov, cfg.label, sc, look);
  return { x: x, cov: ren.cov, area: lab.area, full: lab.full, y: lab.present, scene: sc, look: look, seed: seed };
};
/* a column stored as fixed-width base-36 integers: value = (integer - off) / scale */
L.unpack = function (str, spec) {
  var w = spec[1], scale = spec[0], off = spec[2] || 0, out = new Array(str.length / w), i;
  for (i = 0; i < out.length; i++) out[i] = (parseInt(str.substr(i * w, w), 36) - off) / scale;
  return out;
};
/* decisions stored five to a character (base 32): found[k] = 1 when the detector's score is above its threshold */
L.unbits = function (str, n) {
  var out = new Array(n), i, v;
  for (i = 0; i < n; i++) { v = parseInt(str.charAt(Math.floor(i / 5)), 32); out[i] = (v >> (4 - i % 5)) & 1; }
  return out;
};

/* ───────────── how far: depth along the axis, range along the ray ───────────── */
/* a ray through the pixel with tan(phi) = tanPhi horizontally and tan(rho) = rho vertically meets a surface at depth z at range z * rangeFactor */
L.rangeFactor = function (tanPhi, rho) { return Math.sqrt(1 + tanPhi * tanPhi + rho * rho); };
/* a point at (x, y, z) in metres (camera at the origin, y up measured from the camera, +z forward): its depth is z, its range the Euclidean distance */
L.rangeOf = function (x, y, z) { return Math.sqrt(x * x + y * y + z * z); };
/* the foot of a pedestrian standing at (x, z) on the road, camera 1.4 m above it */
L.footRange = function (x, z) { return L.rangeOf(x, -SV.CAM.hc, z); };
L.BINS = [12, 16, 20];                                                             // distance bins: [8, 12), [12, 16), [16, 20), [20, ...)
L.binOf = function (d) { var b = 0; while (b < L.BINS.length && d >= L.BINS[b]) b++; return b; };

/* ───────────── the contract's two tests ───────────── */
/* a frontal plane at depth z, w metres wide and h metres tall, seen through a pinhole of focal length f, covers f^2 w h / z^2 pixels exactly: a sliver of known area */
L.sliverArea = function (z, w, h) { return SV.CAM.f * SV.CAM.f * w * h / (z * z); };
/* the plane as a one-part scene (a box a millimetre thick): its front face is at depth z; (u0, v0) is its top-left corner in pixels and (wp, hp) its size in pixels */
L.sliverScene = function (z, u0, v0, wp, hp) {
  var C = SV.CAM, w = wp * z / C.f, h = hp * z / C.f, xl = (u0 - C.W / 2) * z / C.f, yt = C.hc + (C.V0 - v0) * z / C.f;
  return { parts: [{ kind: 'box', x: xl + w / 2, z: z + 0.001, hx: w / 2, hz: 0.001, y0: yt - h, y1: yt, cls: 'ped' }] };
};
/* test of the coverage clause: the same sliver placed at 16 sub-pixel offsets; returns the mean error (bias) and the worst error of the counted area against the analytic area */
L.testCoverage = function (ss, wp, hp) {
  var z = 12, A = wp * hp, worst = 0, sum = 0, k;
  for (k = 0; k < 16; k++) {
    var du = (k % 4) / 4 + 0.06, dv = Math.floor(k / 4) / 4 + 0.11, a = L.areaOf(L.cover(L.sliverScene(z, 40 + du, 8 + dv, wp, hp), { SSh: ss, SSv: ss }));
    sum += a - A; worst = Math.max(worst, Math.abs(a - A));
  }
  return { area: A, bias: sum / 16, worst: worst };
};
/* test of the distance clause: below the horizon a depth pass must obey the ground-plane law z = f hc / (v + 0.5 - V0) at every pixel that sees the ground (id -1); returns the largest relative deviation.
 * A range pass fails it by up to range factor - 1 (0.16 at the edge of the image). */
L.testDepth = function (map, id) {
  var C = SV.CAM, W = C.W, H = C.H, worst = 0, n = 0, i, j, q;
  for (j = Math.ceil(C.V0); j < H; j++) for (i = 0; i < W; i++) {
    q = j * W + i;
    if (id[q] !== -1 || !map[q]) continue;
    worst = Math.max(worst, Math.abs(map[q] / (C.f * C.hc / (j + 0.5 - C.V0)) - 1)); n++;
  }
  return { worst: worst, n: n };
};

/* ───────────── a pixel filter: the edge of a mask softened by the renderer's reconstruction filter ───────────── */
/* the Gaussian that leaks a fraction `leak` of a step into the next pixel when the edge lies on a pixel boundary and the pixel's value is read at its centre, half a pixel from the edge:  Phi(-0.5 / sigma) = leak */
L.normCdf = function (x) {
  var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
L.sigmaFromLeak = function (leak) { var lo = 0.01, hi = 3, k, mid; for (k = 0; k < 60; k++) { mid = (lo + hi) / 2; if (L.normCdf(-0.5 / mid) < leak) lo = mid; else hi = mid; } return (lo + hi) / 2; };
/* a coverage map blurred by a Gaussian of standard deviation sigma pixels (separable, edges clamped) */
L.blur = function (cov, sigma) {
  var C = SV.CAM, W = C.W, H = C.H, kh = Math.ceil(3 * sigma), k = new Float64Array(2 * kh + 1), s = 0, u, i, j, t, tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (u = -kh; u <= kh; u++) { k[u + kh] = Math.exp(-u * u / (2 * sigma * sigma)); s += k[u + kh]; }
  for (u = 0; u < k.length; u++) k[u] /= s;
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) { t = 0; for (u = -kh; u <= kh; u++) t += k[u + kh] * cov[j * W + Math.min(W - 1, Math.max(0, i + u))]; tmp[j * W + i] = t; }
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) { t = 0; for (u = -kh; u <= kh; u++) t += k[u + kh] * tmp[Math.min(H - 1, Math.max(0, j + u)) * W + i]; out[j * W + i] = t; }
  return out;
};

/* the default reconstruction filter of Blender 5.2 LTS leaks 12% of a step into the next pixel when the edge lies on a pixel boundary (measured by running it).  As a Gaussian read at the pixel centre that is
 * L.SIG_F = Phi^-1 solved above; the lab's own coverage is a box filter of standard deviation 1/sqrt(12), so the filter adds L.SIG_X on top of the lab's box. */
L.LEAK = 0.12;
L.SIG_F = L.sigmaFromLeak(L.LEAK);
L.SIG_X = Math.sqrt(Math.max(0, L.SIG_F * L.SIG_F - 1 / 12));
L.ARMS.soft.blur = L.SIG_X;

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
