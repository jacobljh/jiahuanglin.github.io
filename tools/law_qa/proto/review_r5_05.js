// r5 independent re-derivation for lesson 05 (contract damages model). No shared code with the widget.
// Model: c ~ U[0,C]; v(r)=80+G(1-exp(-r/10)); price p paid on delivery.
// Social: perform iff c<=v. Rules a/b/c/d as in the lesson.
function v(r, G){ return 80 + G*(1 - Math.exp(-r/10)); }
function P(x, C){ return Math.min(Math.max(x/C, 0), 1); }          // P(c<=x)
function E(x, C){ var y = Math.min(Math.max(x, 0), C); return y*y/(2*C); } // E[c 1(c<=x)]
function Wsoc(r, thr, G, C){ return P(thr, C)*v(r, G) - E(thr, C) - r; }
function argmax(f, lo, hi, n){ var best=-1e18, br=lo; for (var i=0;i<=n;i++){ var r=lo+(hi-lo)*i/n, x=f(r); if(x>best){best=x;br=r;} } return br; }
function golden(f, a, b){ var g=(Math.sqrt(5)-1)/2, c=b-g*(b-a), d=a+g*(b-a); for (var i=0;i<200;i++){ if (f(c)>f(d)) b=d; else a=c; c=b-g*(b-a); d=a+g*(b-a);} return (a+b)/2; }

function run(p, C, G){
  var out = {};
  // social optimum r*: maximise v^2/(2C) - r when v<=C ; general via numeric
  var rs = golden(function(r){ return Wsoc(r, v(r,G), G, C); }, 0, 80);
  out.soc = {r: rs, W: Wsoc(rs, v(rs,G), G, C), thr: v(rs,G)};
  var U = [
    function(r){ return P(p, C)*(v(r,G)-p) - r; },
    function(r){ return P(p+r, C)*(v(r,G)-p-r); },
    function(r){ return (v(r,G)-p) - r; },
    function(r){ return (v(r,G)-p) - r; }
  ];
  var thr = [function(r){return p;}, function(r){return p+r;}, function(r){return v(r,G);}, function(r){return 1e9;}];
  out.rules = U.map(function(f,k){
    // coarse grid then golden refine (U may be non-concave for (b): use fine grid)
    var r0 = argmax(f, 0, 80, 80000);
    var r = golden(f, Math.max(0,r0-0.01), Math.min(80,r0+0.01));
    var t = thr[k](r);
    return {r: r, thr: t, perf: P(t, C), W: Wsoc(r, t, G, C)};
  });
  return out;
}
function show(label, o){
  console.log('== ' + label);
  console.log(' soc  r=' + o.soc.r.toFixed(2) + ' W=' + o.soc.W.toFixed(2) + ' v=' + o.soc.thr.toFixed(2));
  ['none','reliance','expect','forced'].forEach(function(n,k){
    var x = o.rules[k];
    console.log(' ' + n + ' r=' + x.r.toFixed(2) + ' perf=' + (x.perf*100).toFixed(1) + '% W=' + x.W.toFixed(2) + ' thr=' + (x.thr>1e8?'inf':x.thr.toFixed(1)));
  });
}
show('default p=60 C=150 G=40', run(60,150,40));
show('p=80', run(80,150,40));
show('C=100', run(60,100,40));
show('p=30', run(30,150,40));
show('G=10', run(60,150,10));
show('G=80', run(60,150,80));
show('C=200', run(60,200,40));
// closed forms
console.log('closed: r*=', -10*Math.log((48-Math.sqrt(48*48-4*16*15))/32), ' r_exp=', 10*Math.log(4));
console.log('closed none r=', 10*Math.log(60*40/(10*150)));
// misclass share for expectation under C=100: v>=80..; check mis
// spot check: reliance misallocation at default
var d = run(60,150,40); var rr = d.rules[1];
console.log('reliance: thr', rr.thr.toFixed(2), 'v', v(rr.r,40).toFixed(2), 'abandoned', ((v(rr.r,40)-rr.thr)/150*100).toFixed(1)+'%');
var rn = d.rules[0]; console.log('none: thr', rn.thr, 'v', v(rn.r,40).toFixed(2), 'wrong', ((v(rn.r,40)-rn.thr)/150*100).toFixed(1)+'%');
console.log('forced: mean c above 110 =', (110+150)/2, ' share', ((150-110)/150*100).toFixed(1)+'%');
