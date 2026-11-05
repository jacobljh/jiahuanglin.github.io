// w05.js — prototype of the lesson-05 widget model (contract remedies). Same maths as the widget in
// all_lessons/law/lessons/05_contract.html.   node tools/law_qa/proto/w05.js
//
// Model. Price p (paid on delivery). Buyer's reliance r (chosen first, knowing the rule) makes the good
// worth v(r) = 80 + G(1 - e^{-r/10}). Seller's cost c ~ U[0, C] is learnt later; seller performs or breaches.
// Welfare W = P(perform)·v - E[c; perform] - r  (price is a transfer).  Social optimum: perform iff c <= v.
// Rules: none (D=0), reliance (D=r), expectation (D=v-p), specific performance (always perform).
'use strict';
var BASE = 80, SCALE = 10, RMAX = 80;
function vOf(r, g){ return BASE + g*(1 - Math.exp(-r/SCALE)); }
function Pc(x, cm){ return x <= 0 ? 0 : (x >= cm ? 1 : x/cm); }
function Ec(x, cm){ var y = Math.max(0, Math.min(x, cm)); return y*y/(2*cm); }
function thrOf(k, r, p, g){ if(k === 0) return p; if(k === 1) return p + r; if(k === 2) return vOf(r, g); return Infinity; }
function buyerU(k, r, p, cm, g){
  var v = vOf(r, g);
  if(k === 0) return Pc(p, cm)*(v - p) - r;
  if(k === 1) return Pc(p + r, cm)*(v - p - r);
  return (v - p) - r;
}
function wOf(r, thr, g, cm){ return Pc(thr, cm)*vOf(r, g) - Ec(thr, cm) - r; }
function argmax(f){
  var best = -1e18, br = 0, i, r, x;
  for(i = 0; i <= RMAX/0.02; i++){ r = i*0.02; x = f(r); if(x > best + 1e-12){ best = x; br = r; } }
  var lo = Math.max(0, br - 0.03), c = br;
  for(i = 0; i <= 600; i++){ r = lo + i*0.0001; if(r > RMAX) break; x = f(r); if(x > best + 1e-12){ best = x; c = r; } }
  return c;
}
function solve(p, cm, g){
  function mk(r, thr){
    var v = vOf(r, g), eff = Math.min(thr, cm), ve = Math.min(v, cm);
    return {r: r, thr: thr, v: v, perf: Pc(thr, cm), W: wOf(r, thr, g, cm), mis: Math.abs(eff - ve)/cm};
  }
  var rs = argmax(function(r){ return wOf(r, vOf(r, g), g, cm); });
  var out = {soc: mk(rs, vOf(rs, g)), rules: [], p: p, cm: cm, g: g}, k;
  for(k = 0; k < 4; k++){ (function(kk){
    var r = argmax(function(r){ return buyerU(kk, r, p, cm, g); });
    out.rules.push(mk(r, thrOf(kk, r, p, g)));
  })(k); }
  return out;
}
module.exports = {solve: solve, vOf: vOf};
if(require.main === module){
  var NAMES = ['none', 'reliance', 'expectation', 'specific'];
  function show(tag, o){
    console.log(tag);
    var s = o.soc; console.log('  social     r=' + s.r.toFixed(2) + ' v=' + s.v.toFixed(2) + ' perf=' + (s.perf*100).toFixed(1) + '% W=' + s.W.toFixed(2));
    o.rules.forEach(function(x, i){ console.log('  ' + NAMES[i].padEnd(11) + ' r=' + x.r.toFixed(2) + ' thr=' + (x.thr === Infinity ? 'inf' : x.thr.toFixed(1)) + ' v=' + x.v.toFixed(1) + ' perf=' + (x.perf*100).toFixed(1) + '% W=' + x.W.toFixed(2) + ' mis=' + (x.mis*100).toFixed(1) + '%'); });
  }
  show('default p=60 C=150 G=40', solve(60, 150, 40));
  show('p=80', solve(80, 150, 40));
  show('C=100', solve(60, 100, 40));
  // re-derivation checks (closed forms)
  var E = (48 - Math.sqrt(48*48 - 4*16*15))/32;
  console.log('closed forms: r*=' + (-10*Math.log(E)).toFixed(4) + ' (W*=' + ((120 - 40*E)*(120 - 40*E)/300 + 10*Math.log(E)).toFixed(4) + ')  none r=10ln1.6=' + (10*Math.log(1.6)).toFixed(4) + '  expectation r=10ln4=' + (10*Math.log(4)).toFixed(4));
  console.log('expectation W = 110^2/300 - r = ' + (110*110/300 - 10*Math.log(4)).toFixed(4) + '; specific W = 110 - 75 - r = ' + (110 - 75 - 10*Math.log(4)).toFixed(4));
}
