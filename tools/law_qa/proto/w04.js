// w04 prototype: three title regimes, per-transaction expected cost vs chain length n.
// node tools/law_qa/proto/w04.js
'use strict';
var S = 1;                                  // tracing cost per link (示意)
var REG = { look: 1.5, prev: 1.0, err: 0.002 };   // 登记簿: 看一次, 在先权利人去登记, 登记簿出错率
var POS = { look: 0.5, prev: 0.3, err: 0.005 };   // 占有: 看一眼, 原主防范, 占有信号出错率

function q(n, f){ return 1 - Math.pow(1 - f, n); }
function costI(n, f, P){ var trace = S*n, gamble = q(n,f)*P; return trace <= gamble ? {c: trace, mode:'trace', trace:trace, loss:0} : {c: gamble, mode:'gamble', trace:0, loss:gamble}; }
function costPub(R, P, err){ return {c: R.look + R.prev + err*P, look:R.look, prev:R.prev, loss: err*P}; }

console.log('--- spec defaults f=.02 P=100 ---');
[1,2,3,5,10,15,30].forEach(function(n){
  var a = costI(n,.02,100), b = costPub(REG,100,REG.err), c = costPub(POS,100,POS.err);
  console.log('n='+n, 'I='+a.c.toFixed(2)+'('+a.mode+')', 'II='+b.c.toFixed(2), 'III='+c.c.toFixed(2),
    'qP='+(q(n,.02)*100).toFixed(2));
});
// crossings (continuous, fine grid)
function cross(f, P, R, err){
  var n; for(n = 1; n <= 30.0001; n += 0.01){ if(costI(n,f,P).c >= costPub(R,P,err).c) return n; } return null;
}
console.log('cross I vs II :', cross(.02,100,REG,REG.err).toFixed(2));
console.log('cross I vs III:', cross(.02,100,POS,POS.err).toFixed(2));
// where the gamble branch binds: f*P < S  <=> P < 50 at f=.02
[20,30,40,60,100,300].forEach(function(P){
  var a = costI(10,.02,P); console.log('P='+P, 'n=10 I='+a.c.toFixed(2), a.mode, 'cross II=', (cross(.02,P,REG,REG.err)||0).toFixed(2));
});
// register error sweep
[0,.002,.01,.02,.05].forEach(function(e){ console.log('eps='+e, 'II@P100=', costPub(REG,100,e).c.toFixed(2), 'cross=', (cross(.02,100,REG,e)||NaN).toFixed ? (cross(.02,100,REG,e)||NaN).toFixed(2) : cross(.02,100,REG,e)); });
// f sweep
[.005,.01,.02,.05,.1].forEach(function(f){ console.log('f='+f, 'n=10 I=', costI(10,f,100).c.toFixed(2), 'q=', q(10,f).toFixed(3), 'cross II=', (cross(f,100,REG,REG.err)||NaN)); });
// sacrificed per 1000
console.log('sacrificed per 1000: II', 1000*REG.err, 'III', 1000*POS.err, ' I gamble n=10 P=30:', (1000*q(10,.02)).toFixed(0));
