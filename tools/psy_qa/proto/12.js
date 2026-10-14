// proto/12.js — lesson 12 widget maths: other people's unanimous answers as EVIDENCE (a lens inspired by Asch 1955; a toy, not the authors' model).
// All quantities in units of the SD of your own percept. The correct line is A. Your percept x ~ N(+d', 1); LLR_self(x) = 2 d' x (equal-variance Gaussians).
// k others all say B (wrong). Two hypotheses about them: H_ind — each saw the lines as well as you did and errs independently with probability eps;
//   H_col — their answers were fixed in advance (carry no information about the lines), prior π.
//   P(all say B | B correct) = (1-π)(1-eps)^k + π ;  P(all say B | A correct) = (1-π) eps^k + π ;  L(k) = ln of their ratio.
// A truthful partner (honest, independent, says A) multiplies the first by eps and the second by (1-eps) in the H_ind and H_col branches alike (the partner is not part of the bloc).
// You say B iff L > LLR_self(x), i.e. x < L/(2 d')  →  P(conform) = Φ(L/(2 d') − d').
var ASCH = [[1, 3.6], [2, 13.6], [3, 31.8], [4, 35.1], [6, 35.2], [7, 37.1], [9, 35.1], [15, 31.2]];   // Asch 1955 caption, % of critical trials echoing the wrong majority
function erf(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
function L(k, eps, pi, partner) {
  var n = (1 - pi) * Math.pow(1 - eps, k) + pi, d = (1 - pi) * Math.pow(eps, k) + pi;
  if (partner) { n = (1 - pi) * Math.pow(1 - eps, k) * eps + pi * eps; d = (1 - pi) * Math.pow(eps, k) * (1 - eps) + pi * (1 - eps); }
  return Math.log(n / d);
}
function pConform(k, dp, eps, pi, partner) { return k === 0 ? phi(-dp) : phi(L(k, eps, pi, partner) / (2 * dp) - dp); }
function rmse(dp, eps, pi) { var s = 0; ASCH.forEach(function (r) { var e = 100 * pConform(r[0], dp, eps, pi, false) - r[1]; s += e * e; }); return Math.sqrt(s / ASCH.length); }
if (require.main === module) {
  var best = { r: 1e9 }, dp, eps, lp, i;
  for (dp = 2.34; dp <= 3.4; dp += 0.02) for (eps = 0.002; eps <= 0.06; eps *= 1.06) for (lp = -9; lp <= -1.5; lp += 0.1) { var r = rmse(dp, eps, Math.pow(10, lp)); if (r < best.r) best = { r: r, dp: dp, eps: eps, lp: lp }; }
  console.log('best fit (d>=2.34 so that error alone < 1%):', JSON.stringify(best));
  var b = best;
  console.log('k   model%   Asch%');
  ASCH.forEach(function (r) { console.log(String(r[0]).padStart(2), (100 * pConform(r[0], b.dp, b.eps, Math.pow(10, b.lp), false)).toFixed(1).padStart(7), String(r[1]).padStart(7)); });
  console.log('alone: model', (100 * pConform(0, b.dp)).toFixed(2), '% (Asch: < 1%)');
  console.log('partner (honest A):'); [3, 6, 9, 15].forEach(function (k) { console.log('  k', k, 'model', (100 * pConform(k, b.dp, b.eps, Math.pow(10, b.lp), true)).toFixed(1), '% vs without partner', (100 * pConform(k, b.dp, b.eps, Math.pow(10, b.lp), false)).toFixed(1), '%  ratio', (pConform(k, b.dp, b.eps, Math.pow(10, b.lp), true) / pConform(k, b.dp, b.eps, Math.pow(10, b.lp), false)).toFixed(2)); });
  console.log('pure-independent (π=1e-9): k=1..15'); [1, 2, 3, 4, 6, 9, 15].forEach(function (k) { console.log('  k', k, (100 * pConform(k, b.dp, b.eps, 1e-9, false)).toFixed(1)); });
  console.log('fit landscape: rmse by log10 π at best d,eps'); for (lp = -8; lp <= -2; lp += 1) console.log('  logπ', lp, rmse(b.dp, b.eps, Math.pow(10, lp)).toFixed(2));
  console.log('rmse by d at best eps,π:'); [2.4, 2.6, 2.8, 3.0, 3.2].forEach(function (d) { console.log('  d', d, rmse(d, b.eps, Math.pow(10, b.lp)).toFixed(2)); });
  console.log('demo default candidates:'); [[2.6, 0.015, -5], [2.6, 0.012, -5], [2.7, 0.01, -5], [2.5, 0.015, -5]].forEach(function (p) { console.log('  d', p[0], 'eps', p[1], 'logπ', p[2], 'rmse', rmse(p[0], p[1], Math.pow(10, p[2])).toFixed(2), 'curve', ASCH.map(function (r) { return (100 * pConform(r[0], p[0], p[1], Math.pow(10, p[2]), false)).toFixed(0); }).join(' ')); });
}
if (typeof module !== 'undefined') module.exports = { pConform: pConform, L: L, rmse: rmse, ASCH: ASCH, phi: phi };
