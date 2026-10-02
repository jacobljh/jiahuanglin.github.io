const path = require('path'), fs = require('fs');
const _R = path.resolve(__dirname, '../../../../all_lessons');
const _dir = n => fs.existsSync(path.join(_R, n + '_new')) ? path.join(_R, n + '_new') : path.join(_R, n);
const G3 = require(path.join(_dir('computer_vision_3d'), 'geom3.js'));
const FL = require(path.join(_dir('computer_vision_3d'), 'flatland.js'));
const { m3, v3, se3 } = G3;
let fails = 0;
function ok(name, cond, extra) { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : extra); } else console.log('ok  ', name, extra === undefined ? '' : extra); }
const rng = FL.rng(4);
const rv = (s) => [(rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s];
// exp/log
{
  let worst = 0, worstO = 0;
  for (let i = 0; i < 400; i++) {
    const w = rv(i % 5 === 0 ? 3.1 : 1.5); const th = v3.norm(w); if (th > Math.PI - 1e-3) continue;
    const R = m3.exp(w), w2 = m3.log(R);
    worst = Math.max(worst, v3.norm(v3.sub(w, w2))); worstO = Math.max(worstO, m3.orthErr(R), Math.abs(m3.det(R) - 1));
  }
  ok('log(exp(w)) == w', worst < 1e-9, worst.toExponential(2));
  ok('exp(w) is a rotation', worstO < 1e-12, worstO.toExponential(2));
  const Rpi = m3.exp([Math.PI, 0, 0]); const wpi = m3.log(Rpi);
  ok('log near theta=pi', Math.abs(v3.norm(wpi) - Math.PI) < 1e-6, wpi.join(','));
}
// non-commutativity and averaging
{
  const A = m3.Rx(Math.PI / 2), B = m3.Ry(Math.PI / 2);
  const AB = m3.mul(A, B), BA = m3.mul(B, A);
  const e = m3.fro(m3.add(AB, m3.scale(BA, -1)));
  ok('rotations do not commute (Rx90·Ry90 ≠ Ry90·Rx90)', e > 1, e.toFixed(4));
  const mean = m3.scale(m3.add(A, B), 0.5);
  ok('average of two rotation matrices is not a rotation', m3.orthErr(mean) > 0.2, 'orthErr ' + m3.orthErr(mean).toFixed(4) + ', det ' + m3.det(mean).toFixed(4));
  const Rn = m3.nearestRotation(mean); ok('nearestRotation projects back', m3.orthErr(Rn) < 1e-9 && Math.abs(m3.det(Rn) - 1) < 1e-9);
}
// Euler
{
  const R = m3.eulerZYX(0.4, -0.3, 1.1), e = m3.toEulerZYX(R);
  ok('Euler round trip', Math.abs(e.yaw - 0.4) < 1e-12 && Math.abs(e.pitch + 0.3) < 1e-12 && Math.abs(e.roll - 1.1) < 1e-12 && !e.locked);
  const Rl = m3.eulerZYX(0.5, Math.PI / 2, 0.2), Rl2 = m3.eulerZYX(0.9, Math.PI / 2, 0.6);   // yaw+? roll equal difference → same R at the lock
  // at pitch=90°, R depends only on (yaw − roll)... compare:
  const A1 = m3.eulerZYX(0.5, Math.PI / 2, 0.2), A2 = m3.eulerZYX(0.9, Math.PI / 2, 0.6);
  ok('gimbal lock: at pitch=90° yaw and roll are interchangeable (one DOF lost)', m3.fro(m3.add(A1, m3.scale(A2, -1))) < 1e-12, m3.fro(m3.add(A1, m3.scale(A2, -1))).toExponential(2));
  // Jacobian rank of the map (yaw,pitch,roll) -> R via numeric difference
  const J = (yaw, pitch, roll) => { const cols = []; const h = 1e-6; const base = [yaw, pitch, roll];
    for (let k = 0; k < 3; k++) { const p = base.slice(), m = base.slice(); p[k] += h; m[k] -= h; const Rp = m3.eulerZYX(...p), Rm = m3.eulerZYX(...m); cols.push(Rp.map((v, i) => (v - Rm[i]) / (2 * h))); } return cols; };
  const gram = (cols) => { const G = []; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) G.push(cols[a].reduce((s, v, i) => s + v * cols[b][i], 0)); return G; };
  const eg = (cols) => G3.eigSym(gram(cols), 3).vals;
  const gen = eg(J(0.3, 0.4, 0.2)), lock = eg(J(0.3, Math.PI / 2, 0.2));
  ok('Euler Jacobian is full rank away from the lock and rank 2 at it', gen[2] > 0.5 && lock[2] < 1e-6, `smallest eig ${gen[2].toFixed(3)} vs ${lock[2].toExponential(2)}`);
}
// quaternion
{
  let worst = 0;
  for (let i = 0; i < 200; i++) { const R = m3.exp(rv(3)), q = m3.toQuat(R), R2 = m3.fromQuat(q); worst = Math.max(worst, m3.fro(m3.add(R, m3.scale(R2, -1)))); }
  ok('quaternion round trip', worst < 1e-12, worst.toExponential(2));
  const qa = m3.toQuat(m3.id()), qb = m3.toQuat(m3.Rz(1.0)), qm = m3.slerp(qa, qb, 0.5);
  ok('slerp halves the angle', Math.abs(m3.angle(m3.fromQuat(qm)) - 0.5) < 1e-12);
}
// se3
{
  let worst = 0;
  for (let i = 0; i < 200; i++) { const xi = [...rv(2), ...rv(1.5)]; const T = se3.exp(xi), x2 = se3.log(T); worst = Math.max(worst, Math.hypot(...xi.map((v, k) => v - x2[k]))); }
  ok('se3 log(exp(xi)) == xi', worst < 1e-9, worst.toExponential(2));
  const T = se3.exp([0.3, -0.2, 0.5, 0.2, 0.4, -0.1]), Ti = se3.inv(T), I = se3.compose(T, Ti);
  ok('T∘T⁻¹ = I', m3.fro(m3.add(I.R, m3.scale(m3.id(), -1))) < 1e-12 && v3.norm(I.t) < 1e-12);
}
// eig/svd
{
  const A = [4, 1, 2, 1, 3, 0.5, 2, 0.5, 5], e = G3.eigSym(A, 3);
  let rec = new Array(9).fill(0);
  for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rec[3 * i + j] += e.vals[k] * e.vecs[k][i] * e.vecs[k][j];
  ok('eigSym reconstructs A', Math.max(...rec.map((v, i) => Math.abs(v - A[i]))) < 1e-12);
  const M = [1, 2, 3, -1, 0.5, 2, 0.3, -2, 1], s = G3.svd3(M);
  const D = [s.S[0], 0, 0, 0, s.S[1], 0, 0, 0, s.S[2]], rec2 = m3.mul(s.U, m3.mul(D, m3.T(s.V)));
  ok('svd3 reconstructs M', Math.max(...rec2.map((v, i) => Math.abs(v - M[i]))) < 1e-10 && Math.abs(m3.det(s.U) - 1) < 1e-10 && Math.abs(m3.det(s.V) - 1) < 1e-10, s.S.map(v => v.toFixed(4)).join(','));
}
// two-view: 8-point
{
  const Rg = m3.exp([0.1, -0.25, 0.05]), tg = v3.normalize([0.9, 0.1, 0.2]);
  const pts = []; for (let i = 0; i < 24; i++) pts.push([(rng() - 0.5) * 4, (rng() - 0.5) * 3, 4 + rng() * 5]);
  const x1 = pts.map(p => [p[0] / p[2], p[1] / p[2]]);
  const x2 = pts.map(p => { const q = se3.apply({ R: Rg, t: tg }, p); return [q[0] / q[2], q[1] / q[2]]; });
  const E = G3.eightPoint(x1, x2);
  let maxres = 0; for (let i = 0; i < x1.length; i++) { const a = [x1[i][0], x1[i][1], 1], b = [x2[i][0], x2[i][1], 1]; maxres = Math.max(maxres, Math.abs(v3.dot(b, m3.mulv(E, a)))); }
  ok('8-point E satisfies the epipolar constraint', maxres < 1e-9, maxres.toExponential(2));
  const pose = G3.recoverPose(E, x1, x2);
  ok('recovered R matches truth', m3.dist(pose.R, Rg) < 1e-6, m3.dist(pose.R, Rg).toExponential(2));
  ok('recovered t matches truth direction (scale lost)', v3.norm(v3.sub(pose.t, tg)) < 1e-6 && pose.inFront === 24, v3.norm(v3.sub(pose.t, tg)).toExponential(2));
  // scale ambiguity: scaling world and baseline gives identical images
  const s = 3.7, x2s = pts.map(p => { const q = se3.apply({ R: Rg, t: v3.scale(tg, s) }, v3.scale(p, s)); return [q[0] / q[2], q[1] / q[2]]; });
  ok('scale ambiguity: scene×s with baseline×s gives identical images', Math.max(...x2.map((v, i) => Math.hypot(v[0] - x2s[i][0], v[1] - x2s[i][1]))) < 1e-12);
}
// LM bundle adjustment toy
{
  const f = 600, cx = 320, cy = 240;
  const P = []; for (let i = 0; i < 16; i++) P.push([(rng() - 0.5) * 3, (rng() - 0.5) * 2, 5 + rng() * 2]);
  const T = [se3.id(), se3.exp([-0.8, 0, 0, 0, 0.12, 0]), se3.exp([0.7, 0.05, 0.1, 0.02, -0.1, 0.03])];
  const obs = T.map(t => P.map(p => { const q = se3.apply(t, p); return [cx + f * q[0] / q[2], cy + f * q[1] / q[2]]; }));
  // unknowns: cam1 (6, but |translation| fixed → keep 6 and fix scale by holding t1.x), cam2 (6), points 3*16
  const xtrue = [...se3.log(T[1]), ...se3.log(T[2]), ...P.flat()];
  const x0 = xtrue.map((v, i) => v + (rng() - 0.5) * (i < 12 ? 0.08 : 0.25));
  const res = (x) => {
    const c1 = se3.exp(x.slice(0, 6)), c2 = se3.exp(x.slice(6, 12)), r = [];
    for (let i = 0; i < 16; i++) {
      const p = [x[12 + 3 * i], x[13 + 3 * i], x[14 + 3 * i]];
      [[se3.id(), 0], [c1, 1], [c2, 2]].forEach(([t, k]) => { const q = se3.apply(t, p), u = cx + f * q[0] / q[2], v = cy + f * q[1] / q[2]; r.push(u - obs[k][i][0], v - obs[k][i][1]); });
    }
    return r;
  };
  const rms = (x) => { const r = res(x); return Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length); };
  const t0 = Date.now();
  const out = G3.lm(res, x0, { maxIter: 25, fixed: [0] });   // hold the baseline's x-component: fixes the gauge scale
  ok('LM bundle adjustment converges', rms(out.x) < 1e-3 && rms(x0) > 5, `RMS ${rms(x0).toFixed(2)} px → ${rms(out.x).toExponential(2)} px in ${out.history.length - 1} iters, ${Date.now() - t0} ms`);
  console.log('   costs:', out.history.map(h => h.cost.toExponential(1)).join(' '));
}
console.log(fails ? `\n${fails} FAILED` : '\nall geom3 tests passed');
process.exit(fails ? 1 : 0);
