// w08.js — prototype of the 抢劫与灭口 model (lesson 08). run: node tools/law_qa/proto/w08.js
'use strict';
var N = 1000, GMAX = 60, M = 3, H1 = 30, H2 = 200;
// P = p1 in percent (integer); p1 = P/100, p2 = (2/3)p1 = P/150  (killing the witness cuts the capture probability to 2/3)
function brute(S1, S2, P){
  var p1 = P/100, p2 = P/150, n0 = 0, n1 = 0, n2 = 0, i, g, u1, u2;
  for(i = 0; i < N; i++){
    g = GMAX*(i + 0.5)/N; u1 = g - p1*S1; u2 = g - p2*S2 - M;
    if(u1 <= 1e-12 && u2 <= 1e-12) n0++; else if(u1 >= u2) n1++; else n2++;
  }
  return {n0:n0, n1:n1, n2:n2, harm:n1*H1 + n2*(H1 + H2)};
}
function closed(S1, S2, P){
  var kill = P*(3*S1 - 2*S2) > 900;            // p1*S1 - p2*S2 > m  <=>  P(3 S1 - 2 S2) > 900  (exact integer test)
  var T = kill ? P*S2/150 + M : P*S1/100;      // threshold on g below which nobody offends
  var n0 = Math.max(0, Math.min(N, Math.floor(T*N/GMAX + 0.5 + 1e-9)));
  var act = N - n0;
  return {n0:n0, n1:kill ? 0 : act, n2:kill ? act : 0, harm:(kill ? act*(H1 + H2) : act*H1), kill:kill, T:T,
          s1c:2*S2/3 + 300/P};
}
var cases = [[5,60,30],[20,100,30],[40,40,30],[40,100,30],[60,40,60],[20,40,60],[20,20,30],[30,30,30],[31,31,30],[80,100,30],[76,100,30],[77,100,30],[10,40,60],[0,0,30],[200,200,30],[200,0,90]];
var bad = 0;
cases.forEach(function(c){
  var a = brute(c[0], c[1], c[2]), b = closed(c[0], c[1], c[2]);
  var same = a.n0 === b.n0 && a.n1 === b.n1 && a.n2 === b.n2 && a.harm === b.harm;
  if(!same) bad++;
  console.log('S1=' + c[0] + ' S2=' + c[1] + ' p1=' + c[2] + '%  none ' + a.n0 + ' rob ' + a.n1 + ' kill ' + a.n2 + ' harm ' + a.harm + '  S1*=' + b.s1c.toFixed(1) + (same ? '' : '   MISMATCH closed=' + JSON.stringify(b)));
});
// exhaustive agreement of brute force and closed form on a grid
var cnt = 0;
for(var P = 5; P <= 90; P += 5) for(var s1 = 0; s1 <= 200; s1 += 1) for(var s2 = 0; s2 <= 200; s2 += 4){
  var a = brute(s1, s2, P), b = closed(s1, s2, P); cnt++;
  if(a.n0 !== b.n0 || a.n1 !== b.n1 || a.n2 !== b.n2){ bad++; if(bad < 8) console.log('MISMATCH', s1, s2, P, a, b); }
}
console.log('grid cases', cnt, 'mismatches', bad);
// user-supplied checks
var want = [[5,60,30,975,0,29250],[20,100,30,900,0,27000],[40,40,30,0,817,187910],[40,100,30,800,0,24000]];
want.forEach(function(w){ var r = closed(w[0], w[1], w[2]); console.log('check', w.slice(0,3).join(','), r.n1 === w[3] && r.n2 === w[4] && r.harm === w[5] ? 'OK' : 'FAIL ' + JSON.stringify(r)); });
// slice at S2=100, p1=30: harm vs S1
var out = []; [0,20,50,76,77,80,100,150,200].forEach(function(s){ var r = closed(s, 100, 30); out.push('S1=' + s + ':' + r.harm + (r.kill ? 'K' : '')); }); console.log(out.join('  '));
// kill when S1=S2: threshold m/(p1-p2) = 30
console.log('S1=S2 threshold (p1-p2)S1>m:', 3/(0.3-0.2));
// the only brute/closed disagreements must be exact ties P(3 S1 - 2 S2) = 900 (float noise in the brute force)
var nonTie = 0;
for(var P2 = 5; P2 <= 90; P2 += 5) for(var t1 = 0; t1 <= 200; t1 += 1) for(var t2 = 0; t2 <= 200; t2 += 4){
  var a2 = brute(t1, t2, P2), b2 = closed(t1, t2, P2);
  if((a2.n0 !== b2.n0 || a2.n1 !== b2.n1 || a2.n2 !== b2.n2) && P2*(3*t1 - 2*t2) !== 900) nonTie++;
}
console.log('mismatches that are NOT exact ties:', nonTie);
