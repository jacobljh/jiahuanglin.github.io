// r4 独立重推：13 法典 vs 判例。长期平均年损失：解析式 vs 蒙特卡洛（自己的 RNG，不用页面的 LCG）。
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
var rnd = mulberry(20261105);
function gauss() { var u = Math.max(rnd(), 1e-12), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
var K = 10, U = 0.3;
function analytic(s, T, lam, se) {
  var code = s * s * (T - 1) / 2 + K / T;
  var cas = (1 - lam) * (1 - lam) * s * s / (lam * (2 - lam)) + lam * se * se / (2 - lam) + U;
  return { code: code, cas: cas };
}
function sim(s, T, lam, se, years, burn) {
  var th = 0, rc = 0, rb = 0, lc = 0, lb = 0, n = 0, t;
  for (t = 1; t <= years; t++) {
    th += s * gauss();
    var upd = (t % T === 0);
    if (upd) rc = th;
    rb += lam * (th + se * gauss() - rb);
    if (t > burn) { lc += (th - rc) * (th - rc) + (upd ? K : 0); lb += (th - rb) * (th - rb) + U; n++; }
  }
  // 法典：修法费按「每 T 年一次」摊到每年
  return { code: lc / n, cas: lb / n };
}
var cases = [[0.05, 20, 0.2, 2], [0.6, 20, 0.2, 2], [0.2, 20, 0.2, 3], [0.6, 5, 0.05, 2], [0.1, 20, 0.2, 2], [0.4, 20, 0.2, 2], [0.8, 20, 0.2, 2], [0.02, 20, 0.2, 2]];
cases.forEach(function (c) {
  var a = analytic.apply(null, c), acc = { code: 0, cas: 0 }, R = 40;
  for (var r = 0; r < R; r++) { var m = sim(c[0], c[1], c[2], c[3], 50000, 2000); acc.code += m.code / R; acc.cas += m.cas / R; }
  console.log('σ=' + c[0] + ' T=' + c[1] + ' λ=' + c[2] + ' ση=' + c[3] +
    ' | 解析 法典 ' + a.code.toFixed(3) + ' 判例 ' + a.cas.toFixed(3) + ' | 模拟 法典 ' + acc.code.toFixed(3) + ' 判例 ' + acc.cas.toFixed(3));
});
// 交叉点
function star(T, lam, se) {
  var a = (T - 1) / 2, c = (1 - lam) * (1 - lam) / (lam * (2 - lam)), e = lam * se * se / (2 - lam) + U, d0 = K / T - e;
  return Math.sqrt(-d0 / (a - c));
}
console.log('σ* default', star(20, 0.2, 2).toFixed(3), ' ση=3:', star(20, 0.2, 3).toFixed(3), ' T=5,λ=.05:', star(5, 0.05, 2).toFixed(3));
// 默认两行系数
var lam = 0.2; console.log('code a', 19 / 2, 'case c', ((1 - lam) * (1 - lam) / (lam * (2 - lam))).toFixed(4), 'nz', (lam * 4 / (2 - lam)).toFixed(4));
// 是否存在「一条路在整个参数范围永远占优」的设定（滑块范围内）
var found = [];
for (var T = 5; T <= 40; T += 5) for (var L = 5; L <= 50; L += 15) for (var E = 5; E <= 40; E += 15) {
  var l = L / 100, e = E / 10, a = (T - 1) / 2, c = (1 - l) * (1 - l) / (l * (2 - l)), d0 = K / T - (l * e * e / (2 - l) + U);
  var s = (a - c), st = (Math.abs(s) > 1e-9 && -d0 / s > 0) ? Math.sqrt(-d0 / s) : null;
  if (st === null || st > 0.8) found.push([T, l, e, st === null ? '不相交' : st.toFixed(2)]);
}
console.log('无交叉或交叉在 σ>0.8 的设定数', found.length, JSON.stringify(found.slice(0, 6)));
