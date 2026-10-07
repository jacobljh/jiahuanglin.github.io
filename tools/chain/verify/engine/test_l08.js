#!/usr/bin/env node
'use strict';
/* Regression tests of all_lessons/synthetic_vision/l08_blender.js (Lesson 8): the decoders of what Blender recorded, the closed forms, the filter estimator, the description of a Street scene.
 * No Blender needed. Exit code 1 on any failure. */
const path = require('path');
const DIR = path.resolve(__dirname, '../../../../all_lessons/synthetic_vision');
const SV = require(path.join(DIR, 'street.js'));
require(path.join(DIR, 'tables.js'));
const L = require(path.join(DIR, 'l08_blender.js'));
let bad = 0;
const check = (c, m) => { if (!c) { bad++; console.error('FAIL ' + m); } };
const W = SV.CAM.W, H = SV.CAM.H, HW = W * H, F = SV.CAM.f;

/* base64 and the 12-bit frames */
{
  const b = Buffer.from(Array.from({ length: 101 }, (_, i) => (i * 37 + 11) & 255)), d = L.b64bytes(b.toString('base64'));
  check(d.length === b.length && d.every((v, i) => v === b[i]), 'b64bytes equals Buffer.from(..., "base64") on 101 bytes');
  const f = new Float32Array([0, 1, 0.5, 0.18, 0.02, 0.95]), n = f.length, bytes = Buffer.alloc(Math.ceil(n * 1.5)), code = (v) => Math.round(Math.pow(v, 1 / 2.2) * 4095);
  for (let i = 0; i < n; i += 2) { const x = code(f[i]), y = code(f[i + 1]), o = i * 1.5; bytes[o] = x >> 4; bytes[o + 1] = ((x & 15) << 4) | (y >> 8); bytes[o + 2] = y & 255; }
  const u = L.unpack12(L.b64bytes(bytes.toString('base64')), n);
  check(f.every((v, i) => Math.abs(u[i] - v) < 6e-4), 'unpack12 returns the radiance within 6e-4 (' + Array.from(u).map((v) => v.toFixed(4)).join(' ') + ')');
  const g = new Float32Array([1.5, -2.25, 1e10]), fb = Buffer.alloc(12); g.forEach((v, i) => fb.writeFloatLE(v, 4 * i));
  check(Array.from(L.b64f32(fb.toString('base64'))).every((v, i) => v === g[i]), 'b64f32 reads little-endian float32');
}

/* the silhouette of a post: the hull of its corners, against a scan of rays */
{
  const x = 2, z = 10, h = 0.15; let lo = Infinity, hi = -Infinity;
  for (let u = 55; u < 75; u += 0.001) { const t = (u - W / 2) / F; /* the ray x = t z hits the square if some z in [z-h, z+h] has |t z - x| <= h */ let hit = false; for (let k = 0; k <= 40 && !hit; k++) { const zz = z - h + 2 * h * k / 40; if (Math.abs(t * zz - x) <= h) hit = true; } if (hit) { lo = Math.min(lo, u); hi = Math.max(hi, u); } }
  check(Math.abs((lo + hi) / 2 - L.boxCentre(x, z, h, h)) < 0.02, 'boxCentre equals the middle of the scanned silhouette (' + ((lo + hi) / 2).toFixed(3) + ' vs ' + L.boxCentre(x, z, h, h).toFixed(3) + ')');
}

/* the edge-spread estimator: a box of width 1 has sigma 1/sqrt(12), a gaussian its own sigma */
{
  const mk = (cdf) => Array.from({ length: 16 }, (_, k) => Array.from({ length: 13 }, (_, j) => cdf(j - 5.5 - k / 16)));
  const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  const box = L.esf(mk((x) => Math.min(1, Math.max(0, x + 0.5)))), gs = L.esf(mk((x) => 0.5 * (1 + erf(x / (0.4 * Math.SQRT2)))));
  check(Math.abs(box.sigma - 1 / Math.sqrt(12)) < 1e-3 && Math.abs(box.mass - 1) < 1e-9, 'esf of a box: sigma ' + box.sigma.toFixed(4));
  check(Math.abs(gs.sigma - 0.4) < 2e-3, 'esf of a gaussian of sigma 0.4: ' + gs.sigma.toFixed(4));
  check(box.leak === 0 && gs.leak > 0.05 && gs.leak < 0.2, 'leak is the edge pixel read at the pixel boundary');
}

/* the focal length from two slabs, the measure of the fails rule */
{
  const e = 1.5 * F / 10, red = Array.from({ length: W }, (_, u) => Math.min(1, Math.max(0, W / 2 - e - u))), green = Array.from({ length: W }, (_, u) => Math.min(1, Math.max(0, u + 1 - (W / 2 + e))));
  const m = L.measures.lens({ default: { red, green }, set: { red, green }, portrait_auto: { red, green }, portrait_horizontal: { red, green } });
  check(Math.abs(m.fSet - F) < 1e-6 && m.s < 1e-9, 'M.lens recovers f from the two edges (' + m.fSet.toFixed(4) + ')');
  check(L.fails({ d: null, tol: 1 }) && L.fails({ d: 2, tol: 1 }) && !L.fails({ d: 0.5, tol: 1 }), 'fails(): not in view or above the tolerance');
}

/* the error maps */
{
  const a = new Float32Array(3 * HW).fill(0.5), b = new Float32Array(3 * HW).fill(0.5); b[0] = 0.8; b[HW] = 0.5; b[2 * HW] = 0.2;
  const e = L.errMap(a, b), s = L.stats([e]);
  check(Math.abs(e[0] - 0.2) < 1e-6 && e[1] === 0 && Math.abs(s.mean - 0.2 / HW) < 1e-9 && s.over === 1 / HW, 'errMap and stats: one pixel, two channels off by 0.3');
  check(L.changed(a, a) === 0 && L.changed(a, b) === 1 / HW, 'changed(): share of pixels that moved by more than 0.1%');
}

/* a description of a scene is faithful: the Street renders what it drew */
{
  for (const seed of [18000000, 18000003]) {
    const pipe = L.program(), sc = SV.drawScene(pipe.scene, SV.stream(seed, 'scene')), lk = SV.drawLook(pipe.look, sc, SV.stream(seed, 'look'));
    const a = SV.render(sc, lk, { SSh: 2, SSv: 2 }), d = L.describe(seed), b = L.streetRender(d, 2);
    let same = true; for (let i = 0; i < a.rad.length; i++) if (a.rad[i] !== b.rad[i]) { same = false; break; }
    check(same, 'describe() then streetRender() reproduces the Street\'s own frame of seed ' + seed);
    check(JSON.stringify(JSON.parse(JSON.stringify(d))) === JSON.stringify(d), 'a description survives a JSON round trip');
  }
}
if (bad) { console.error(bad + ' failure(s)'); process.exit(1); }
console.log('test_l08 ok');
