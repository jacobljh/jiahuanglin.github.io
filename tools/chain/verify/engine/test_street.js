'use strict';
// regression tests for all_lessons/synthetic_vision_new/street.js  (run: node test_street.js)
// The Street is the lab of the Synthetic Vision Data series: a renderer with exact labels, a pipeline of stages, a fixed detector and an exam.
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new/street.js')) ? 'synthetic_vision_new' : 'synthetic_vision';
const file = path.join(root, dir, 'street.js');
const SV = require(file);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, t) => Math.abs(a - b) <= t;
const C = SV.CAM, W = C.W, H = C.H, HW = W * H;
const hash = (arr) => { let h = 2166136261 >>> 0; for (let i = 0; i < arr.length; i++) { h ^= Math.round(arr[i] * 1e6) & 0xffffff; h = Math.imul(h, 16777619) >>> 0; } return h; };

// ── source hygiene: deterministic by construction
{ const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); ok(!/Math\.random\(|Date\.now\(|new Date\(/.test(src), 'street.js has no Math.random / Date'); }

// ── random streams
{ const a = SV.rng(7), b = SV.rng(7); ok(a() === b() && a() === b(), 'rng is deterministic');
  const s1 = SV.stream(3, 'scene'), s2 = SV.stream(3, 'scene'), s3 = SV.stream(3, 'look'); ok(s1() === s2() && s1() !== s3(), 'streams: same name same numbers, other name other numbers');
  const r = SV.rng(9); let m = 0, v = 0; const n = 20000; for (let i = 0; i < n; i++) { const z = SV.randn(r); m += z; v += z * z; } ok(near(m / n, 0, 0.03) && near(v / n, 1, 0.04), 'randn has mean 0 and variance 1');
  const rp = SV.rng(4); let mp = 0; for (let i = 0; i < n; i++) mp += SV.poisson(rp, 2.5); ok(near(mp / n, 2.5, 0.06), 'poisson mean'); }

// ── a bare world: the geometry conventions, checked against the pinhole formulas
function bare(parts, cls) {
  const sc = { parts: [], insts: [], ped: null, van: null };
  parts.forEach((p, i) => { p.id = i; p.pid = i; p.cls = cls || 'van'; sc.parts.push(p); sc.insts.push({ id: i, cls: p.cls, parts: [p] }); });
  return sc;
}
const flat = (sc) => { const L = { l: [0, 1, 0], amb: 0.4, lum: 1, col: {}, stripe: {}, ph: {}, ground: 0.3, skyH: [0.6, 0.7, 0.9], skyZ: [0.3, 0.4, 0.8], win: 0, winPhase: 0 }; sc.parts.forEach(p => { L.col[p.pid] = [0.5, 0.5, 0.5]; L.stripe[p.pid] = 0; L.ph[p.pid] = 0; }); return L; };
{ // ground: depth = f*hc/(v+.5-V0) and range = depth*sqrt(1+tan^2+rho^2) at every pixel centre below the horizon
  const sc = bare([]), r = SV.render(sc, flat(sc)); let worst = 0, worstR = 0;
  for (let j = C.V0 + 1; j < H; j++) for (let i = 0; i < W; i += 7) {
    const q = j * W + i, rho = (C.V0 - (j + 0.5)) / C.f, tp = (i + 0.5 - W / 2) / C.f, z = -C.hc / rho;
    worst = Math.max(worst, Math.abs(r.depth[q] - z)); worstR = Math.max(worstR, Math.abs(r.range[q] - z * Math.sqrt(1 + tp * tp + rho * rho)));
  }
  ok(worst < 1e-3 && worstR < 1e-3, 'ground depth = f*hc/(v-V0) and range = depth*sqrt(1+tan^2+rho^2) at pixel centres (worst ' + worst.toExponential(1) + ', ' + worstR.toExponential(1) + ')');
  let skyOk = true; for (let j = 0; j < C.V0; j++) for (let i = 0; i < W; i++) if (r.depth[j * W + i] !== 0 || r.id[j * W + i] !== -1) skyOk = false; ok(skyOk, 'above the horizon there is only sky (depth 0, id -1) in a bare world'); }
{ // a pole: its id columns and rows follow the pinhole formulas
  const z0 = 10, pr = 0.1, y1 = 2.0, sc = bare([{ kind: 'circle', x: 0, z: z0, r: pr, y0: 0, y1: y1 }], 'pole'), r = SV.render(sc, flat(sc));
  const cols = [], rows = []; for (let i = 0; i < W; i++) if (r.id[(H - 1 - 4) * W + i] === 0) cols.push(i); for (let j = 0; j < H; j++) if (r.id[j * W + 48] === 0) rows.push(j);
  // centre ray of column i hits the cylinder when |lateral offset at z0| < r
  const wantCols = []; for (let i = 0; i < W; i++) { const tp = (i + 0.5 - W / 2) / C.f; if (Math.abs(tp) * z0 < pr) wantCols.push(i); }
  ok(JSON.stringify(cols) === JSON.stringify(wantCols), 'a pole 10 m away: its columns are ' + JSON.stringify(wantCols));
  const top = Math.ceil(C.V0 - C.f * (y1 - C.hc) / (z0 - Math.sqrt(pr * pr - Math.pow((48.5 - W / 2) / C.f * z0, 2))) - 0.5);
  ok(rows[0] === top, 'a pole 2 m tall starts on row ' + top + ' (got ' + rows[0] + ')'); }
{ // a box (the van): the columns of its silhouette are set by its far-left and near-right vertical edges
  const sc = bare([{ kind: 'box', x: 2.5, z: 10, hx: 1, hz: 2, y0: 0, y1: 2.3 }]), r = SV.render(sc, flat(sc)); const cols = []; for (let i = 0; i < W; i++) { let any = false; for (let j = 0; j < H; j++) if (r.id[j * W + i] === 0) any = true; if (any) cols.push(i); }
  const uL = W / 2 + C.f * 1.5 / 12, uR = W / 2 + C.f * 3.5 / 8, first = Math.ceil(uL - 0.5), last = Math.floor(uR - 0.5);
  ok(cols[0] === first && cols[cols.length - 1] === last && cols.length === last - first + 1, 'the van box covers columns ' + first + '..' + last + ' (u from ' + uL.toFixed(2) + ' to ' + uR.toFixed(2) + '); got ' + cols[0] + '..' + cols[cols.length - 1]); }

// ── a pedestrian beside the occluding van: visible area < amodal area; labels follow the convention
{ let found = null; for (let sd = 1; sd < 400 && !found; sd++) { const smp = SV.sample(SV.REAL, sd, { ped: true, mode: 'emerge', vis: 2 }); if (smp.mode === 'emerge' && smp.full > 30) found = smp; }
  ok(found && found.area > 0 && found.area < found.full * 0.9, 'an emerging pedestrian: visible area ' + (found && found.area.toFixed(1)) + ' < amodal area ' + (found && found.full.toFixed(1)));
  const open = SV.sample(SV.SIM0, 3, { ped: true }); ok(near(open.area, open.full, 1e-3), 'a pedestrian in the open: visible = amodal'); }
{ // label convention: kvis and rel
  const cov = new Float32Array(HW); cov[5] = 1; cov[6] = 0.5;
  ok(SV.labels(cov, { kvis: 1 }).present === 1 && SV.labels(cov, { kvis: 2 }).present === 0, 'label: present when the visible area reaches kvis pixels (1.5 px vs 1 and 2)'); }

// ── determinism and independence of the three random streams
{ const a = SV.sample(SV.REAL, 11), b = SV.sample(SV.REAL, 11); ok(hash(a.x) === hash(b.x) && hash(a.cov) === hash(b.cov) && a.y === b.y, 'a sample is a pure function of (pipeline, seed)');
  const m = SV.makeSet(SV.REAL, 3, 20); ok(hash(m[2].x) === hash(SV.sample(SV.REAL, 22).x), 'makeSet(pipe, n, s0)[i] = sample(pipe, s0 + i)');
  const hyb = SV.hybrid(SV.REAL, SV.SIM0, { scene: 'a', look: 'a', sensor: 'b', label: 'a' }); ok(hyb.sensor.ideal === true && hyb.look.lum[0] === 0.12, 'hybrid takes each stage from the named pipeline');
  const ra = SV.stream(5, 'scene'), rb = SV.stream(5, 'scene'); const s1 = SV.drawScene(SV.REAL.scene, ra), s2 = SV.drawScene(SV.REAL.scene, rb); ok(s1.parts.length === s2.parts.length, 'drawScene is deterministic'); }
{ // the same scene and look through two sensors: the labels do not move
  const base = SV.sample(SV.REAL, 31, { ped: true }), pipe2 = SV.hybrid(SV.REAL, SV.SIM0, { scene: 'a', look: 'a', sensor: 'b', label: 'a' }), alt = SV.sample(pipe2, 31, { ped: true });
  ok(hash(base.cov) === hash(alt.cov) && base.y === alt.y, 'swapping the sensor stage leaves the mask and label unchanged'); }

// ── the sensor
{ const rad = new Float32Array(3 * HW).fill(0.5), cfg = { ideal: false, ev: 600, fw: 4000, read: 3, blur: 0, gamma: 1, bits: 16 }, out = SV.sense(rad, cfg, SV.rng(5));
  let m = 0, v = 0; for (let i = 0; i < out.length; i++) m += out[i]; m /= out.length; for (let i = 0; i < out.length; i++) v += (out[i] - m) * (out[i] - m); v /= out.length;
  const e = 600 * 0.5, wantM = e / 4000, wantV = (e + 9) / (4000 * 4000);
  ok(near(m, wantM, wantM * 0.01) && near(v, wantV, wantV * 0.06), 'flat field: mean = ev*L/fw (' + m.toFixed(5) + ' vs ' + wantM.toFixed(5) + '), variance = (shot + read^2)/fw^2 (' + (v * 1e6).toFixed(3) + 'e-6 vs ' + (wantV * 1e6).toFixed(3) + 'e-6)');
  const id = SV.sense(rad, { ideal: true, ev: 600, fw: 4000, read: 0, blur: 0, gamma: 2.2, bits: 8 }, SV.rng(1)), want = Math.round(Math.pow(0.075, 1 / 2.2) * 255) / 255; ok(near(id[0], want, 1e-6) && near(id[HW], want, 1e-6), 'ideal sensor: DN = round(255*(ev*L/fw)^(1/gamma))/255');
  const dark = new Float32Array(3 * HW).fill(0.01), ae = SV.sense(dark, { ideal: false, ev: 600, fw: 4000, read: 0, blur: 0, gamma: 1, bits: 16, ae: { target: 0.12, maxGain: 8 } }, SV.rng(2)); let ma = 0; for (let i = 0; i < ae.length; i++) ma += ae[i]; ma /= ae.length;
  ok(near(ma, 8 * 0.01 * 600 / 4000, 0.003), 'auto-exposure: a very dark frame is lifted by the maximum gain (8)');
  const mid = new Float32Array(3 * HW).fill(0.2), aem = SV.sense(mid, { ideal: false, ev: 600, fw: 4000, read: 0, blur: 0, gamma: 1, bits: 16, ae: { target: 0.12, maxGain: 8 } }, SV.rng(2)); let mm = 0; for (let i = 0; i < aem.length; i++) mm += aem[i]; mm /= aem.length;
  ok(near(mm, 0.12, 0.004), 'auto-exposure: a mid-dark frame is brought to the target mean (' + mm.toFixed(4) + ' vs 0.12)'); }
{ const imp = new Float32Array(3 * HW); for (let j = 0; j < H; j++) imp[j * W + 40] = 1; const out = SV.sense(imp, { ideal: false, ev: 4000, fw: 4000, read: 0, blur: 1, gamma: 1, bits: 16 }, SV.rng(3)); // a bright vertical line, blurred horizontally
  ok(out[10 * W + 40] < 0.6 && out[10 * W + 39] > 0.1, 'PSF blur spreads a one-pixel line over its neighbours'); }

// ── the metrics
{ const set = [], sc = []; for (let i = 0; i < 100; i++) { set.push({ y: 0, area: 0 }); sc.push(i); } for (let i = 0; i < 10; i++) { set.push({ y: 1, area: 10 + i }); sc.push(i * 11); }
  ok(near(SV.thrAtFPR(sc.slice(0, 100), 0.1), 90, 0), 'thrAtFPR picks the score above which a tenth of the negatives lie');
  const e = SV.exam(set, sc), hits = [0, 11, 22, 33, 44, 55, 66, 77, 88, 99].filter(v => v > 90).length; ok(near(e.miss, 1 - hits / 10, 1e-12) && e.n === 10, 'exam: miss = 1 - hits/n over the positives with area >= 6 (' + e.miss + ')');
  ok(near(SV.auc([1, 2], [0, 3]), 0.5, 1e-12) && near(SV.auc([5, 6], [1, 2]), 1, 1e-12) && near(SV.auc([1, 1], [1, 1]), 0.5, 1e-12), 'auc: 0.5 on a split, 1 when separated, 0.5 on ties'); }

// ── the detector: a fixed bank of filters learns the easy world
{ const tr = SV.makeSet(SV.SIM0, 160, 1), te = SV.makeSet(SV.SIM0, 300, SV.SEEDS.simVal), m = SV.train(tr, { seed: 1 }), sc = SV.scoreSet(m, te);
  const auc = SV.auc(sc.filter((_, i) => te[i].y), sc.filter((_, i) => !te[i].y)); ok(auc > 0.95, 'detector trained on 160 SIM0 frames separates SIM0 pedestrians (AUC ' + auc.toFixed(3) + ')');
  const again = SV.scoreSet(SV.train(tr, { seed: 1 }), te.slice(0, 5)); ok(again.every((v, i) => v === sc[i]), 'training is deterministic');
  const lg = SV.logits(m, te.find(s => s.y).x); ok(lg.z.length === lg.nu * lg.nv && lg.nu === 48 && lg.nv === 12, 'logit map has one value per stride-2 cell (48 x 12)');
  ok(SV.DIM === 110 && SV.NFILT === 54, 'feature dimension 110 = 2 x 54 filters + the row prior'); }

if (fails) { console.error(fails + ' test(s) failed'); process.exit(1); }
console.log('all street tests passed');
