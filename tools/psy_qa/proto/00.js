// proto/00.js — lesson 00 widget maths: "same pixels, different assumed light" (示意 toy colour-constancy model)
// run: node tools/psy_qa/proto/00.js
// Model:  sensor signal s = reflectance r ⊙ light L  (per channel).  The viewer cannot see r or L, only s.
//         The viewer assumes a light L̂(t) on a warm(−1) … cool(+1) axis and "discounts" it:  r̂ = s ⊘ L̂(t).
//         Cool = bluish shade (dim), warm = yellowish indoor light (bright): the assumed light has a colour AND a brightness.
//         t̂ (the assumed light) = precision-weighted mix of the viewer's habit t0 (prior) and the scene cue t1:
//         t̂ = (1−w)·t0 + w·t1   with  w = k1/(k0+k1)  (w = trust in the scene cue).
//         The "photo" is two fixed pixel colours S1, S2 whose values were TUNED so that the picture sits near a category boundary.
var A = 0.32, G = 0.16, C = 0.35;
function L(t) {
  var I = 1 - C * t;                           // assumed brightness: shade (cool) is dimmer
  return [(1 - A * t) * I, (1 - G * t) * I, (1 + A * t) * I];
}
var S1 = [0.464, 0.553, 0.796], S2 = [0.436, 0.368, 0.184];
function discount(s, t) { var l = L(t); return s.map(function (v, i) { return Math.min(1, v / l[i]); }); }
var REF1 = { '蓝': [0.30, 0.42, 0.84], '白': [0.86, 0.86, 0.88] };
var REF2 = { '金': [0.80, 0.62, 0.22], '棕': [0.45, 0.36, 0.20], '黑': [0.26, 0.24, 0.19] };
function nearest(c, refs) { var best = null, bd = 9; for (var k in refs) { var d = 0; for (var i = 0; i < 3; i++) d += Math.pow(c[i] - refs[k][i], 2); if (d < bd) { bd = d; best = k; } } return best; }
function name(t) { return nearest(discount(S1, t), REF1) + '/' + nearest(discount(S2, t), REF2); }
function phi(x) { // standard normal CDF (Abramowitz–Stegun 7.1.26 via erf)
  var s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}
function thresholds() { // t̂ values where the label pair changes (scan)
  var th = [], prev = name(-1.5); for (var t = -1.5; t <= 1.5; t += 0.002) { var n = name(t); if (n !== prev) { th.push([t, prev, n]); prev = n; } } return th;
}
// population share per label when habits t0 ~ N(mu, sd) and the scene cue is (t1, w)
function shares(mu, sd, t1, w) {
  var th = thresholds(), out = {}, lo = -Infinity, labels = [name(-1.5)];
  th.forEach(function (x) { labels.push(x[2]); });
  var cuts = th.map(function (x) { return (x[0] - w * t1) / (1 - w); }); // in t0 units
  labels.forEach(function (lab, i) {
    var a = i === 0 ? 0 : phi((cuts[i - 1] - mu) / sd), b = i === cuts.length ? 1 : phi((cuts[i] - mu) / sd);
    out[lab] = b - a;
  });
  return out;
}
if (require.main === module) {
  for (var t = -1; t <= 1.0001; t += 0.2) console.log('t̂=' + t.toFixed(1).padStart(5), name(t));
  console.log('thresholds', thresholds().map(function (x) { return x[1] + '→' + x[2] + '@' + x[0].toFixed(2); }).join('  '));
  [[0, 0.25, 0, 0], [0, 0.25, -1, 0.6], [0, 0.25, 1, 0.6], [0, 0.6, 0, 0], [0, 0.6, -1, 0.6], [0, 0.6, 1, 0.6], [0, 0.1, 0, 0]].forEach(function (a) {
    var s = shares.apply(null, a); console.log('mu,sd,t1,w =', a.join(','), '→', Object.keys(s).map(function (k) { return k + ' ' + (100 * s[k]).toFixed(0) + '%'; }).join('  '));
  });
}
module.exports = { L: L, S1: S1, S2: S2, discount: discount, name: name, shares: shares, thresholds: thresholds };
