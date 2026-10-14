// proto/03.js — lesson 03 widget maths: "bump or dent?"  Two scenes make the SAME picture; evidence adds up in log-odds.
// run: node tools/psy_qa/proto/03.js
// Fact of geometry: a dome lit from direction ψ and a bowl lit from ψ+180° give pixel-identical shading (the image alone cannot decide).
// Prior over light direction: von Mises  f(φ) ∝ exp(κ cos(φ−μ)), φ measured from "straight up", μ = the viewer's habitual light direction.
//   log-odds(convex) from the prior = log f(ψ) − log f(ψ+π) = 2κ cos(ψ−μ)
// Optional second cue: touch says "bump" (+λ) or "dent" (−λ); λ = log-likelihood ratio, i.e. how much you trust the touch (reliability).
//   total log-odds = 2κ cos(ψ−μ) + touch ;  P(convex) = 1/(1+e^{−total})
// Learning (Adams-style, 示意): n0 pseudo-observations of "light comes from μ"; each training trial adds one observation of the true direction θ:
//   μ ← atan2(n·sin μ + sin θ, n·cos μ + cos θ),  n ← n+1   (a running circular mean; κ unchanged)
var D = Math.PI / 180;
function logit(psiDeg, muDeg, kappa, touch) { return 2 * kappa * Math.cos((psiDeg - muDeg) * D) + (touch || 0); }
function pConvex(psiDeg, muDeg, kappa, touch) { return 1 / (1 + Math.exp(-logit(psiDeg, muDeg, kappa, touch))); }
function train(muDeg, n, thetaDeg, trials) {
  var m = muDeg;
  for (var i = 0; i < trials; i++) {
    var x = n * Math.sin(m * D) + Math.sin(thetaDeg * D), y = n * Math.cos(m * D) + Math.cos(thetaDeg * D);
    m = Math.atan2(x, y) / D; n += 1;
  }
  return { mu: m, n: n };
}
// pixel brightness of the dome image at (x,y) in the unit disc (elevation 45°): I = max(0, n·l), light at angle ψ from up (clockwise)
function shade(x, y, psiDeg) {
  var r2 = x * x + y * y; if (r2 > 1) return null;
  var z = Math.sqrt(1 - r2), el = 45 * D, lx = Math.sin(psiDeg * D) * Math.cos(el), ly = -Math.cos(psiDeg * D) * Math.cos(el), lz = Math.sin(el);
  return Math.max(0, x * lx + y * ly + z * lz);
}
if (require.main === module) {
  console.log('P(convex) vs rotation ψ (κ=1.5, μ=0°, no touch):');
  [0, 45, 90, 135, 180, 225, 270, 315].forEach(function (p) { console.log('  ψ=' + String(p).padStart(3), (100 * pConvex(p, 0, 1.5, 0)).toFixed(1) + '%'); });
  console.log('κ=0.5:', [0, 45, 90, 135, 180].map(function (p) { return (100 * pConvex(p, 0, 0.5, 0)).toFixed(0); }).join(' / '), '   κ=3:', [0, 45, 90, 135, 180].map(function (p) { return (100 * pConvex(p, 0, 3, 0)).toFixed(0); }).join(' / '));
  console.log('touch λ=+2 at ψ=180 (κ=1.5):', (100 * pConvex(180, 0, 1.5, 2)).toFixed(1) + '%', ' λ=−2 at ψ=0:', (100 * pConvex(0, 0, 1.5, -2)).toFixed(1) + '%');
  var t = train(0, 20, 30, 10); console.log('after 10 trials with light at +30° (n0=20): μ=' + t.mu.toFixed(1) + '°, n=' + t.n);
  t = train(0, 20, 30, 30); console.log('after 30 trials: μ=' + t.mu.toFixed(1) + '°');
  t = train(0, 20, 30, 100); console.log('after 100 trials: μ=' + t.mu.toFixed(1) + '°');
  // flip points (where P=50%): ψ = μ ± 90°
  console.log('shade symmetry check: dome@ψ vs bowl@ψ+180 identical:', shade(0.3, -0.4, 20).toFixed(4), (function () { var x = 0.3, y = -0.4, z = Math.sqrt(1 - x * x - y * y), el = 45 * D, l = [Math.sin(200 * D) * Math.cos(el), -Math.cos(200 * D) * Math.cos(el), Math.sin(el)]; return Math.max(0, -x * l[0] + -y * l[1] + z * l[2]).toFixed(4); })());
}
module.exports = { pConvex: pConvex, logit: logit, train: train, shade: shade };
