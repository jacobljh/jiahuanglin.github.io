const path = require('path'), fs = require('fs');
const _R = path.resolve(__dirname, '../../../../all_lessons');
const _dir = n => fs.existsSync(path.join(_R, n + '_new')) ? path.join(_R, n + '_new') : path.join(_R, n);
const FL = require(path.join(_dir('computer_vision_3d'), 'flatland.js'));
let fails = 0;
function ok(name, cond, extra) { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : extra); } else console.log('ok  ', name, extra === undefined ? '' : extra); }
const close = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-9);

// camera round trip
const cam = FL.camera({ x: 1, z: -2, a: 1.2, f: 80, W: 96 });
const P = { x: 0.7, z: 3.1 };
const pr = FL.project(cam, P.x, P.z);
const bp = FL.backproject(cam, pr.u, pr.zc);
ok('project/backproject round trip', close(bp.x, P.x, 1e-9) && close(bp.z, P.z, 1e-9), `${bp.x.toFixed(6)},${bp.z.toFixed(6)}`);
// pixelRay passes through the point
const ry = FL.pixelRay(cam, pr.u);
const t = (P.x - ry.ox) * ry.dx + (P.z - ry.oz) * ry.dz;
ok('pixelRay passes through point', close(ry.ox + t * ry.dx, P.x, 1e-9) && close(ry.oz + t * ry.dz, P.z, 1e-9));
// camera looking +z (a=PI/2): right = +x
const c0 = FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: 100, W: 100 });
const p0 = FL.project(c0, 1, 10);
ok('a=PI/2 looks up with +x on the right', p0.u > 50 && close(p0.u, 50 + 100 * 0.1, 1e-9) && close(p0.zc, 10, 1e-9), p0.u);
// raycast circle
const sc = { shapes: [FL.circle(0, 5, 1, [1, 0, 0])], light: [0, 1], amb: 0.3, bg: [1, 1, 1], far: 30, stepScale: 0.9 };
const h = FL.raycast(sc, 0, 0, 0, 1, 30);
ok('raycast hits circle at z=4', h.hit && close(h.t, 4, 2e-3), h.t);
// triangulation
const A = FL.camera({ x: -0.5, z: 0, a: Math.PI / 2, f: 80, W: 96 }), B = FL.camera({ x: 0.5, z: 0, a: Math.PI / 2, f: 80, W: 96 });
const X = { x: 0.3, z: 6 };
const uA = FL.project(A, X.x, X.z).u, uB = FL.project(B, X.x, X.z).u;
const tri = FL.triangulate(A, uA, B, uB);
ok('triangulate exact', tri.ok && close(tri.x, X.x, 1e-9) && close(tri.z, X.z, 1e-9), `${tri.x},${tri.z}`);
// disparity law: uA - uB = f b / Z
ok('disparity = f b / Z', close(uA - uB, 80 * 1.0 / 6, 1e-9), uA - uB);
// stereo error law Monte-Carlo
{
  const rng = FL.rng(11); const f = 80, b = 1.0, sd = 0.25;
  for (const Z of [2, 5, 10]) {
    let s = 0, s2 = 0, n = 20000;
    for (let i = 0; i < n; i++) { const d = f * b / Z + sd * FL.randn(rng); const z = f * b / d; s += z; s2 += z * z; }
    const mean = s / n, sdev = Math.sqrt(s2 / n - mean * mean);
    const pred = FL.stereo.sigmaZ(f, b, Z, sd);
    ok(`stereo sigmaZ law Z=${Z}`, Math.abs(sdev / pred - 1) < 0.08, `MC ${sdev.toFixed(4)} vs Z^2 sd/(f b) ${pred.toFixed(4)}`);
  }
}
// render the street
{
  const st = FL.scenes.street(); const cm = FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: 80, W: 96 });
  const r = FL.render(st, cm);
  const ids = Array.from(new Set(Array.from(r.id))).sort();
  ok('street render sees all 3 objects', ids.filter(i => i >= 0).length === 3, ids.join(','));
  const ma = FL.render(st, FL.moved(cm, 0.5, 0));
  ok('render deterministic', FL.mse(r, FL.render(st, cm)) === 0);
  ok('moved camera changes image', FL.mse(r, ma) > 1e-4, FL.mse(r, ma).toFixed(5));
}
// lidar
{
  const rm = FL.scenes.room(); const sc2 = FL.lidar(rm, { a: 0, x: 0, z: 4 }, { n: 180, range: 14 });
  const okc = sc2.filter(s => s.ok).length;
  ok('lidar returns most beams in the room', okc > 150, okc);
}
// SPD solve
{
  const A3 = [4, 1, 0, 1, 3, 1, 0, 1, 2], b3 = [1, 2, 3];
  const x = FL.solveSPD(A3, b3, 3), y = FL.solve(A3, b3, 3);
  ok('solveSPD == solve', close(x[0], y[0], 1e-10) && close(x[1], y[1], 1e-10) && close(x[2], y[2], 1e-10), Array.from(x).join(','));
  const r0 = 4 * x[0] + 1 * x[1], r1 = 1 * x[0] + 3 * x[1] + x[2], r2 = x[1] + 2 * x[2];
  ok('solve residual ~0', close(r0, 1, 1e-10) && close(r1, 2, 1e-10) && close(r2, 3, 1e-10));
}
// composite gradient check
{
  const rng = FL.rng(2), n = 12, sig = [], col = [], delta = [];
  for (let i = 0; i < n; i++) { sig.push(rng() * 6); col.push([rng(), rng(), rng()]); delta.push(0.1 + 0.05 * rng()); }
  const bg = [0.3, 0.6, 0.9], gt = [0.2, 0.8, 0.5];
  const loss = () => { const f = FL.vol.composite(sig, col, delta, bg); return (f.C[0] - gt[0]) ** 2 + (f.C[1] - gt[1]) ** 2 + (f.C[2] - gt[2]) ** 2; };
  const f = FL.vol.composite(sig, col, delta, bg);
  const g = FL.vol.compositeGrad(sig, col, delta, bg, [2 * (f.C[0] - gt[0]), 2 * (f.C[1] - gt[1]), 2 * (f.C[2] - gt[2])], f);
  let worst = 0;
  for (let k = 0; k < n; k++) {
    const h = 1e-6, s0 = sig[k]; sig[k] = s0 + h; const lp = loss(); sig[k] = s0 - h; const lm = loss(); sig[k] = s0;
    worst = Math.max(worst, Math.abs((lp - lm) / (2 * h) - g.dsig[k]) / (1e-6 + Math.abs(g.dsig[k])));
    for (let ch = 0; ch < 3; ch++) { const c0 = col[k][ch]; col[k][ch] = c0 + h; const lp2 = loss(); col[k][ch] = c0 - h; const lm2 = loss(); col[k][ch] = c0;
      worst = Math.max(worst, Math.abs((lp2 - lm2) / (2 * h) - g.dcol[k][ch]) / (1e-6 + Math.abs(g.dcol[k][ch]))); }
  }
  ok('composite gradient == finite differences', worst < 1e-5, 'worst rel err ' + worst.toExponential(2));
  // weights sum to 1 - T_end
  const sw = Array.from(f.w).reduce((a, b) => a + b, 0);
  ok('weights sum to 1 - T_end', close(sw, 1 - f.Ts[n], 1e-12), sw);
}
console.log(fails ? `\n${fails} FAILED` : '\nall core tests passed');
process.exit(fails ? 1 : 0);
