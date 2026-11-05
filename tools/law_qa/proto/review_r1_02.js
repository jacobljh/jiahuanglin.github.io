// r1 review: lesson 02 — brute-force crossover N* and H_crit, independent of the page code
var KR=60,KS=5;
function tcR(N,H){return KR+N*(H*H+0.1);}
function tcS(N,s,c){return KS+N*(s*s+c);}
function crossoverBrute(H,s,c){ for(var N=1;N<=100000;N++){ if(tcR(N,H)<=tcS(N,s,c)) return N; } return null; }
[[0.8,0.7,1],[0.4,0.7,1],[1.6,0.7,1],[1.2,0.7,1],[1.1,0.7,1]].forEach(function(a){
  var H=a[0],s=a[1],c=a[2], sr=H*H+0.1, ss=s*s+c;
  var closed = sr<ss ? (KR-KS)/(ss-sr) : null;
  console.log('H',H,'closed-form N*',closed&&closed.toFixed(1),'brute first N where rule<=std',crossoverBrute(H,s,c));
});
console.log('H_crit =',Math.sqrt(0.7*0.7+1-0.1).toFixed(3));
[8,100,1000].forEach(function(N){console.log('N',N,'default TC_R',tcR(N,0.8).toFixed(1),'TC_S',tcS(N,0.7,1).toFixed(1))});
console.log('hwy N=1000,H=.4',tcR(1000,0.4).toFixed(1),tcS(1000,0.7,1).toFixed(1),'N*',((55)/(1.49-0.26)).toFixed(1));
// standardised-quantile check: mean square of the 100 "safe speeds" equals H^2 by construction
function Phi(x){var t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2);var p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p;}
function inv(p){var lo=-8,hi=8;for(var i=0;i<60;i++){var m=(lo+hi)/2;if(Phi(m)<p)lo=m;else hi=m;}return (lo+hi)/2;}
var Z=[];for(var i=0;i<100;i++)Z.push(inv((i+.5)/100));
var mu=Z.reduce(function(a,b){return a+b},0)/100, va=Z.reduce(function(a,b){return a+(b-mu)*(b-mu)},0)/100;
var Zs=Z.map(function(z){return (z-mu)/Math.sqrt(va)});
console.log('mean sq of standardised z =',(Zs.reduce(function(a,b){return a+b*b},0)/100).toFixed(6));
