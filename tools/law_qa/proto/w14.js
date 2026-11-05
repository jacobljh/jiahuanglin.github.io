// w14 prototype: 有限责任与风险转移 (lesson 14).
// Model: firm owes face value D. Two projects, each with 2 equally likely end-values.
//   S: 105 for sure.  R: m_R +/- delta, m_R = 105 - gap (default 100 +/- 50 => 150 / 50).
// Shareholders get max(X-D,0) under limited liability; if the firm cannot pay (X<D), with probability q
// the creditor reaches the shareholder's personal assets for the shortfall (veil piercing; q=1 ~ unlimited liability).
//   U_X(q)   = E[(X-D)+] - q*E[(D-X)+]
//   Rec_X(q) = E[min(X,D)] + q*E[(D-X)+]
//   identity: U_X + Rec_X = E[X]   (the personal-asset payment is a transfer, not a loss)
// Shareholders pick argmax U (ties -> S). Creditors, knowing that, lend B = Rec_chosen (risk-free rate 0, illustrative),
// implied rate premium = D/B - 1.
function ev(hi, lo, D, q) {
  var xs = [hi, lo], sh = 0, rec = 0, A = 0, Bq = 0, i;
  for (i = 0; i < 2; i++) {
    var v = xs[i];
    A += 0.5 * Math.max(v - D, 0);
    Bq += 0.5 * Math.max(D - v, 0);
    rec += 0.5 * Math.min(v, D);
  }
  return { sh: A - q * Bq, rec: rec + q * Bq, val: (hi + lo) / 2, A: A, B: Bq };
}
function model(p) {
  var mR = 105 - p.gap, S = ev(105, 105, p.D, p.q), R = ev(mR + p.delta, mR - p.delta, p.D, p.q);
  var pickR = R.sh > S.sh + 1e-9, ch = pickR ? R : S;
  var qstar = null;
  if (pickR && R.B - S.B > 1e-9) qstar = (R.A - S.A) / (R.B - S.B);
  return { S: S, R: R, pickR: pickR, loss: S.val - ch.val, rate: ch.rec / p.D, prem: p.D / ch.rec - 1, borrow: ch.rec, qstar: qstar };
}
function dstar(p) {
  var d, first = null;
  for (d = 1; d <= 150.0001; d += 0.05) {
    var m = model({ D: d, gap: p.gap, delta: p.delta, q: p.q });
    if (m.pickR) { first = d; break; }
  }
  return first;
}
function show(label, p) {
  var m = model(p);
  console.log(label, JSON.stringify(p), '\n   U_S=' + m.S.sh.toFixed(2), 'U_R=' + m.R.sh.toFixed(2), 'pick=' + (m.pickR ? 'R' : 'S'),
    'loss=' + m.loss.toFixed(2), 'rec=' + m.borrow.toFixed(2), 'rate=' + (100 * m.rate).toFixed(1) + '%', 'prem=' + (100 * m.prem).toFixed(1) + '%',
    'q*=' + (m.qstar === null ? '-' : m.qstar.toFixed(3)), 'D*=' + dstar(p),
    'check U+Rec: S ' + (m.S.sh + m.S.rec).toFixed(3) + ' R ' + (m.R.sh + m.R.rec).toFixed(3));
}
// spec numbers
show('default D=80', { D: 80, gap: 5, delta: 50, q: 0 });
show('D=30', { D: 30, gap: 5, delta: 50, q: 0 });
show('q=0.5', { D: 80, gap: 5, delta: 50, q: 0.5 });
show('q=1', { D: 80, gap: 5, delta: 50, q: 1 });
// unlimited-liability sanity: q=1 => U_X = E[X]-D
(function () {
  var m = model({ D: 80, gap: 5, delta: 50, q: 1 });
  console.log('unlimited: U_S', m.S.sh, 'expected', 105 - 80, '| U_R', m.R.sh, 'expected', 100 - 80);
})();
// owner's total ex ante: commit-to-S vs. R-with-rational-creditors
(function () {
  var m = model({ D: 80, gap: 5, delta: 50, q: 0 });
  console.log('owner total if creditors believe S: ', 80 + m.S.sh, ' ; if they price R:', m.R.rec + m.R.sh);
})();
// grid: confirm D* analytic = 60 for default (U_R = 75-0.5D, U_S = 105-D for 50<=D<=105)
console.log('analytic D* for defaults = 60 ->', dstar({ gap: 5, delta: 50, q: 0 }).toFixed(2));
// other settings
show('delta=0 (R is just a worse safe project)', { D: 80, gap: 5, delta: 0, q: 0 });
show('gap=0 (pure transfer)', { D: 80, gap: 0, delta: 50, q: 0 });
show('gap=30, delta=70', { D: 80, gap: 30, delta: 70, q: 0 });
show('D=140, q=0', { D: 140, gap: 5, delta: 50, q: 0 });
show('D=140, q=1', { D: 140, gap: 5, delta: 50, q: 1 });
show('D=10', { D: 10, gap: 5, delta: 50, q: 0 });
// monotonicity of premium in D (when R chosen), range sweep
var s = [], D;
for (D = 10; D <= 140; D += 10) { var m = model({ D: D, gap: 5, delta: 50, q: 0 }); s.push(D + ':' + (m.pickR ? 'R' : 'S') + ' rate ' + (100 * m.rate).toFixed(0) + '%'); }
console.log(s.join('  '));
// brute-force check of D* vs q: threshold in q for D=80
(function () {
  var q, lastR = null;
  for (q = 0; q <= 1.0001; q += 0.001) { if (model({ D: 80, gap: 5, delta: 50, q: q }).pickR) lastR = q; }
  console.log('largest q where shareholders still pick R at D=80:', lastR.toFixed(3), '(analytic 2/3 =', (2 / 3).toFixed(3), ')');
})();
