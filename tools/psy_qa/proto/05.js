// proto/05.js — lesson 05 widget maths: DRM-style false recognition as signal detection (示意 toy)
// run: node tools/psy_qa/proto/05.js
// A studied list of M words, all associates of a word that is NOT on the list (the lure).
// Familiarity ("have I seen it?") of a test item = direct exposure + activation spread from the studied words + noise N(0,σ²):
//   studied item : μ_s = D + SPREAD·M·a      (it was shown, and the other studied words nudge it too)
//   lure         : μ_l = M·a                  (never shown, but all M studied words point at it)
//   unrelated new: μ_n = 0
// You say "seen" when familiarity > criterion c.  P(yes) = 1 − Φ((c − μ)/σ).
// "Check the details" strategy (recall-to-reject, 示意): studied items leave a detail trace with probability R; if you demand a detail whenever
//   familiarity is not extreme, you answer "seen" only if (f > c AND detail) OR f > c_hi.  Lures leave no detail trace.
function phi(x) { var s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return 0.5 * (1 + s * y); }
var D = 1.0, SPREAD = 0.2, SIG = 0.6, R = 0.5, CHI = 2.0;
function rates(M, a, c, check) {
  var ms = D + SPREAD * M * a, ml = M * a, mn = 0;
  function yes(mu, hasDetail) { // P(yes) for an item type
    var pHigh = 1 - phi((CHI - mu) / SIG), pC = 1 - phi((c - mu) / SIG);
    if (!check) return pC;
    // demand a detail unless extremely familiar
    return hasDetail ? pC * R + (1 - R) * pHigh + 0 : pHigh;   // simplified: studied items with detail (prob R) pass on f>c; without detail only f>CHI passes
  }
  return { studied: yes(ms, true), lure: yes(ml, false), unrelated: yes(mn, false), mu: { s: ms, l: ml, n: mn } };
}
if (require.main === module) {
  [[15, 0.06, 0.55, false], [15, 0.06, 0.9, false], [15, 0.06, 0.2, false], [15, 0.03, 0.55, false], [15, 0.10, 0.55, false], [6, 0.06, 0.55, false], [15, 0.06, 0.55, true]].forEach(function (c) {
    var r = rates.apply(null, c);
    console.log('M=' + c[0], 'a=' + c[1], 'c=' + c[2], c[3] ? 'check' : 'plain', '→ studied ' + (100 * r.studied).toFixed(0) + '%  lure ' + (100 * r.lure).toFixed(0) + '%  unrelated ' + (100 * r.unrelated).toFixed(0) + '%   μ=' + r.mu.s.toFixed(2) + '/' + r.mu.l.toFixed(2) + '/0');
  });
}
module.exports = { rates: rates, phi: phi };
