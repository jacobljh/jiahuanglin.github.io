// w07.js — prototype for 课 07 「赔不起的人」 (run: node tools/law_qa/proto/w07.js)
// Model: N potential offenders, gain g_i = gmax*(i+.5)/N, gmax = 0.8h. Offend iff g >= s,
//   s = p * ( min(f, w) + D(y) ),  D(y) = sum_{t=1..y} d0*0.8^(t-1).
// Social cost = sum_{offenders}(h - g) + (#offenders)*p*y*c_s   [+ optional: (#offenders)*p*D(y)*k  offenders' own pain]
var h = 100, N = 1000, d0 = 30, adapt = 0.8, cs = 25;
function D(y) { var s = 0, t; for (t = 1; t <= y; t++) s += d0 * Math.pow(adapt, t - 1); return s; }
function sim(p, w, f, y, painWeight) {
  var eff = Math.min(f, w), sanc = p * (eff + D(y)), n = 0, harm = 0, i, g, gmax = 0.8 * h;
  for (i = 0; i < N; i++) { g = gmax * (i + 0.5) / N; if (g >= sanc) { n++; harm += h - g; } }
  var state = n * p * y * cs, pain = n * p * D(y) * (painWeight || 0);
  return { eff: eff, sanc: sanc, n: n, det: 1 - n / N, harm: harm, state: state, pain: pain, cost: harm + state + pain };
}
function line(s) { console.log(s); }
line('--- spec table: p=.2 w=20 f=500');
for (var y = 0; y <= 12; y++) { var r = sim(0.2, 20, 500, y); line(' y=' + y + ' sanc=' + r.sanc.toFixed(2) + ' det=' + (r.det * 100).toFixed(1) + '% cost=' + r.cost.toFixed(0) + ' (harm ' + r.harm.toFixed(0) + ' + state ' + r.state.toFixed(0) + ')'); }
line('--- w=inf (f=500 = h/p)');
var r0 = sim(0.2, 1e9, 500, 0); line(' det=' + (r0.det * 100).toFixed(1) + '% cost=' + r0.cost.toFixed(0));
line('--- fine sweep with w=20 (y=0): f=50..1000');
[50, 100, 200, 500, 1000].forEach(function (f) { var r = sim(0.2, 20, f, 0); line(' f=' + f + ' eff=' + r.eff + ' det=' + (r.det * 100).toFixed(1) + '% cost=' + r.cost.toFixed(0)); });
line('--- w sweep (f=500,y=0)');
[0, 10, 20, 50, 100, 250, 500, 1000].forEach(function (w) { var r = sim(0.2, w, 500, 0); line(' w=' + w + ' det=' + (r.det * 100).toFixed(1) + '% cost=' + r.cost.toFixed(0)); });
line('--- f=h/p across p (w=20, y=0) and w=inf');
[0.05, 0.1, 0.2, 0.5, 1].forEach(function (p) { var f = h / p, r = sim(p, 20, f, 0), r2 = sim(p, 1e9, f, 0); line(' p=' + p + ' f=h/p=' + f + ' det(w=20)=' + (r.det * 100).toFixed(1) + '% cost=' + r.cost.toFixed(0) + ' | w=inf det=' + (r2.det * 100).toFixed(1) + '% cost=' + r2.cost.toFixed(0)); });
line('--- optimum scan per p (w=20,f=h/p) with state cost only');
[0.05, 0.1, 0.2, 0.5, 1].forEach(function (p) { var best = 0, bv = 1e18, y, r; for (y = 0; y <= 12; y++) { r = sim(p, 20, h / p, y); if (r.cost < bv - 1e-9) { bv = r.cost; best = y; } } line(' p=' + p + ' best y=' + best + ' cost=' + bv.toFixed(0)); });
line('--- offenders\' own pain counted (weight 1): w=20,p=.2');
for (y = 0; y <= 12; y++) { r = sim(0.2, 20, 500, y, 1); line(' y=' + y + ' det=' + (r.det * 100).toFixed(1) + '% cost=' + r.cost.toFixed(0) + ' (pain ' + r.pain.toFixed(0) + ')'); }
line('--- max sanction from prison: p*D(inf)=' + (0.2 * 150) + ', plus fine 4 => ' + (0.2 * 170));
