// r4 独立重推：08 抢劫与灭口。逐人暴力枚举（不用闭式阈值），与页面公式对照。
function brute(S1, S2, P) {
  var N = 1000, p1 = P / 100, p2 = p1 * 2 / 3, m = 3, n0 = 0, n1 = 0, n2 = 0;
  for (var i = 0; i < N; i++) {
    var g = 60 * (i + 0.5) / N;
    var u1 = g - p1 * S1, u2 = g - p2 * S2 - m;
    var best = 0, ch = 0;
    if (u1 > best + 1e-12) { best = u1; ch = 1; }
    if (u2 > best + 1e-12 && u2 > u1 + 1e-12) { best = u2; ch = 2; }
    if (ch === 0) n0++; else if (ch === 1) n1++; else n2++;
  }
  return { n0: n0, n1: n1, n2: n2, harm: n1 * 30 + n2 * 230 };
}
function page(S1, S2, P) {
  var N = 1000, GMAX = 60, M = 3;
  var kill = P * (3 * S1 - 2 * S2) > 900;
  var T = kill ? P * S2 / 150 + M : P * S1 / 100;
  var n0 = Math.max(0, Math.min(N, Math.floor(T * N / GMAX + 0.5 + 1e-9)));
  var act = N - n0;
  return { n0: n0, n1: kill ? 0 : act, n2: kill ? act : 0, harm: act * (kill ? 230 : 30) };
}
var bad = 0, cnt = 0;
for (var S1 = 0; S1 <= 200; S1 += 1) for (var S2 = 0; S2 <= 200; S2 += 1) for (var P = 5; P <= 90; P += 5) {
  var a = brute(S1, S2, P), b = page(S1, S2, P); cnt++;
  if (a.n0 !== b.n0 || a.n1 !== b.n1 || a.n2 !== b.n2 || a.harm !== b.harm) { bad++; if (bad < 8) console.log('MISMATCH', S1, S2, P, a, b); }
}
console.log('grid', cnt, 'mismatch', bad);
[[5,60,30],[20,100,30],[40,40,30],[40,100,30],[20,40,60],[76,100,30],[77,100,30]].forEach(function (q) { console.log(q.join(','), JSON.stringify(brute(q[0], q[1], q[2]))); });
// 临界与门槛
console.log('crit S2=100,P=30:', 2 * 100 / 3 + 300 / 30, ' crit S2=40:', 2 * 40 / 3 + 300 / 30);
console.log('S1=40: min S2 no-kill (P=30):', 1.5 * 40 - 450 / 30);
// 等同罚门槛：S1=S2=S 时 (p1-p2)S>m -> S>30
for (var S = 28; S <= 32; S++) console.log('equal S=' + S, JSON.stringify(brute(S, S, 30)));
// S1=40 S2=41 灭口？
console.log('S1=40,S2=41', JSON.stringify(brute(40, 41, 30)), ' S1=40,S2=45', JSON.stringify(brute(40, 45, 30)));
// 预期代价
console.log('p2S2+m', [40, 100].map(function (s) { return 0.2 * s + 3; }), 'p2*40+m @p1=.6', 0.4 * 40 + 3);
