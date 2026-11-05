// r8 review of lesson 20 widget (纠纷漏斗): independent re-derivation written from the PROSE (station table, the two ascii formulas,
// the outcome definitions), NOT from the widget's code. Then compared with the widget over a grid, plus checks on every number quoted in prose.
const h = require('./review_r5_harness.js')('all_lessons/law/lessons/20_finale.html');

// --- independent standard-normal quantiles: Acklam-style rational approx replaced by Newton on erf-based CDF (own implementation)
function erf(x){ // Abramowitz-Stegun 7.1.26 is too coarse; use series/continued fraction via high-precision numerical integration (Simpson) instead
  var n = 2000, a = 0, b = Math.abs(x), s = 0, dx = (b - a)/n, i;
  function f(t){ return Math.exp(-t*t); }
  s = f(a) + f(b);
  for(i = 1; i < n; i++) s += f(a + i*dx) * (i % 2 ? 4 : 2);
  var v = 2/Math.sqrt(Math.PI) * s * dx/3; return x < 0 ? -v : v;
}
function Phi(z){ return 0.5*(1 + erf(z/Math.SQRT2)); }
function qn(p){ var z = 0, i; for(i = 0; i < 80; i++){ var d = (Phi(z) - p)/(Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)); z -= d; if(Math.abs(d) < 1e-12) break; } return z; }
var Z = []; for(var i = 0; i < 15; i++) Z.push(qn((i + 0.5)/15));
console.log('quantiles', Z.map(function(z){ return z.toFixed(4); }).join(' '));
var WZ = [-1.8339,-1.2816,-0.9674,-0.7279,-0.5244,-0.3407,-0.1679,0,0.1679,0.3407,0.5244,0.7279,0.9674,1.2816,1.8339];
console.log('max |quantile - widget table| =', Math.max.apply(null, Z.map(function(z, j){ return Math.abs(z - WZ[j]); })).toExponential(2));

// --- the model, from the lesson's prose
var fixed = [210,170,60,90,140,180,300], prop = [0,0,0,0.02,0.03,0.04,0.08];
function logistic(z){ return 1/(1 + Math.exp(-z)); }
function cohortOutcome(S, f, trust, add){
  // station costs (固定 + 随标的) * level + added amount
  var c = fixed.map(function(F, k){ return f*(F + prop[k]*S) + ((add && add[k]) || 0); });
  // share who settle before trial: logistic(1.2 ln(trial cost / (0.06 S))), trial cost = stations 5 and 6
  var H = logistic(1.2*Math.log((c[4] + c[5])/(0.06*S)));
  // equal per-station settlement chance at stations 3,4,5 such that cumulative = H  (1-(1-lam)^3 = H)
  var lam = 1 - Math.cbrt(1 - H);
  var alive = 1, dropped = 0, settled = 0, atStation = [];
  for(var k = 0; k < 6; k++){ // stations 1..6 ; 7 is after judgment
    var go = logistic((S - c[k])/(0.4*c[k] + 1) + trust);
    var stay = alive*go; dropped += alive - stay;
    var left = stay;
    if(k >= 2 && k <= 4){ settled += stay*lam; left = stay*(1 - lam); }
    atStation.push(left); alive = left;
  }
  return {judged: alive, settled: settled, dropped: dropped, at: atStation};
}
function funnel(Smed, f, trust, add){
  var J = 0, St = 0, D = 0, at = [0,0,0,0,0,0], lnsum = 0;
  for(var i = 0; i < 15; i++){
    var S = Smed*Math.exp(Z[i]);
    var o = cohortOutcome(S, f, trust, add);
    J += o.judged; St += o.settled; D += o.dropped;
    for(var k = 0; k < 6; k++) at[k] += o.at[k];
    lnsum += o.judged*Math.log(S/Smed);
  }
  var s = 1000/15;
  return {J: J*s, S: St*s, D: D*s, at: at.map(function(x){ return x*s; }), sel: Math.exp(lnsum/J)};
}
function round3(a, b, c){ var v = [a,b,c], fl = v.map(Math.floor), rem = 1000 - fl[0] - fl[1] - fl[2];
  var idx = [0,1,2].sort(function(x, y){ return (v[y] - fl[y]) - (v[x] - fl[x]); });
  for(var t = 0; t < rem; t++) fl[idx[t]]++; return fl; }
function r3(o){ return round3(o.J, o.S, o.D); }

// --- invariants
var bad = 0, STAKES = [100,150,200,300,500,700,1000,1500,2000,3000,5000,7000,10000], FEES = [0.2,0.3,0.5,0.7,1,1.5,2,3,5];
STAKES.forEach(function(S){ FEES.forEach(function(f){ [-2,-1.5,-1,-0.5,0,0.5,1,1.5,2].forEach(function(t){ [0,20,100,300].forEach(function(d){
  [null, {4: d}, {0: d/2, 1: d/2}].forEach(function(add){
    var o = funnel(S, f, t, add); var sum = o.J + o.S + o.D;
    if(!isFinite(sum) || Math.abs(sum - 1000) > 1e-6) bad++;
    for(var k = 1; k < 6; k++) if(o.at[k] > o.at[k-1] + 1e-9) bad++;
  }); }); }); }); });
console.log('invariant violations (sum=1000, funnel non-increasing):', bad);

// --- compare with the widget over a full grid
var mism = 0, cnt = 0, nan = 0;
function parseNums(s){ return s.match(/\d+/g).map(Number); }
for(var si = 0; si <= 12; si++) for(var fi = 0; fi <= 8; fi++) for(var ti = -4; ti <= 4; ti += 2) for (var di of [20,100,300]) {
  h.set('w20-s', si); h.set('w20-f', fi); h.set('w20-t', ti); h.set('w20-d', di); h.click('w20-v0');
  var tr = ti/2, base = funnel(STAKES[si], FEES[fi], tr, null);
  var b = r3(base), bf = r3(funnel(STAKES[si], FEES[fi], tr, {4: di})), bfr = r3(funnel(STAKES[si], FEES[fi], tr, {0: di/2, 1: di/2}));
  var wj = parseNums(h.txt('w20-judged'))[0], ws = parseNums(h.txt('w20-settled'))[0], wd = parseNums(h.txt('w20-dropped'))[0];
  cnt++;
  if(wj !== b[0] || ws !== b[1] || wd !== b[2]){ mism++; if(mism < 8) console.log('MISMATCH base', STAKES[si], FEES[fi], tr, 'widget', wj, ws, wd, 'indep', b.join(',')); }
  function dlt(a, bb){ return '判决 ' + sg(a[0] - bb[0]) + ' · 庭外了结 ' + sg(a[1] - bb[1]) + ' · 不了了之 ' + sg(a[2] - bb[2]); }
  function sg(x){ return x > 0 ? '+' + x : (x < 0 ? '−' + (-x) : '0'); }
  if(h.txt('w20-dfile') !== dlt(bf, b) || h.txt('w20-dfront') !== dlt(bfr, b)){ mism++; if(mism < 8) console.log('MISMATCH delta', STAKES[si], FEES[fi], tr, di, h.txt('w20-dfile'), dlt(bf, b), '|', h.txt('w20-dfront'), dlt(bfr, b)); }
  ['w20-judged','w20-settled','w20-dropped','w20-dfile','w20-dfront','w20-note','w20-sval','w20-fval','w20-tval','w20-dval'].forEach(function(id){ if(/NaN|undefined|Infinity/.test(h.txt(id))) nan++; });
}
console.log('grid points', cnt, 'mismatches', mism, 'NaN-ish', nan);

// --- numbers quoted in prose
function show(label, Smed, f, tr, d){
  d = d || 100;
  var b = funnel(Smed, f, tr, null), fb = funnel(Smed, f, tr, {4: d}), fr = funnel(Smed, f, tr, {0: d/2, 1: d/2});
  var rb = r3(b), rf = r3(fb), rr = r3(fr);
  console.log(label, 'base J/S/D', rb.join('/'), ' stations ①..⑥ remaining', b.at.map(Math.round).join(' '), ' sel×', b.sel.toFixed(2),
    '\n    filing+' + d + ' delta', rf.map(function(x, i){ return x - rb[i]; }).join('/'), '  front+' + d + ' delta', rr.map(function(x, i){ return x - rb[i]; }).join('/'));
}
show('默认 S300 f1 tr0   ', 300, 1, 0);
show('小额 S100          ', 100, 1, 0);
show('大额 S3000         ', 3000, 1, 0);
show('不信任 S300 tr-2   ', 300, 1, -2);
// presets, widget vs prose
['p0','p1','p2','p3'].forEach(function(p){ h.click('w20-' + p); console.log(p, h.txt('w20-judged'), '|', h.txt('w20-settled'), '|', h.txt('w20-dropped')); });

// --- is the direction robust? sweep stake x fee x trust; "front adds more drop than filing" and "filing shifts judged->settled"
console.log('\nrobustness of the headline contrast (+100 on filing vs +100 on front):');
var rows = [];
STAKES.forEach(function(S){
  var b = r3(funnel(S, 1, 0, null)), f = r3(funnel(S, 1, 0, {4: 100})), r = r3(funnel(S, 1, 0, {0: 50, 1: 50}));
  rows.push([S, b.join('/'), 'filing', f.map(function(x, i){ return x - b[i]; }).join('/'), 'front', r.map(function(x, i){ return x - b[i]; }).join('/')]);
});
rows.forEach(function(x){ console.log(x.join('  ')); });
console.log('\nsame at fee x0.5 / x2:');
[0.5, 2].forEach(function(F){ STAKES.forEach(function(S){
  var b = r3(funnel(S, F, 0, null)), f = r3(funnel(S, F, 0, {4: 100})), r = r3(funnel(S, F, 0, {0: 50, 1: 50}));
  console.log('f', F, 'S', S, b.join('/'), 'filing', f.map(function(x, i){ return x - b[i]; }).join('/'), 'front', r.map(function(x, i){ return x - b[i]; }).join('/'));
}); });
