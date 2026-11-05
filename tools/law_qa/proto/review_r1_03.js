// r1 review: lesson 03 — brute-force K* and the net values quoted in the prose
var R=1000,V=50,kap=4,c=0.02;
function ns(K,T,cc,VV){return R*(VV||V)*(1-Math.exp(-K/kap))-T*(cc||c)*K;}
function best(T,cc,VV){var b=1,bv=-1e18;for(var k=1;k<=60;k++){var v=ns(k,T,cc,VV);if(v>bv){bv=v;b=k;}}return b;}
[1,10,1e3,1e5,1e6].forEach(function(T){
  var kc=Math.max(1,kap*Math.log(R*V/(kap*T*c)));
  var kb=best(T);
  console.log('T',T,'K* closed',kc.toFixed(2),'brute int',kb,'NS(K*)',Math.round(ns(kb,T)),'NS(60)',Math.round(ns(60,T)),'loss',Math.round(ns(kb,T)-ns(60,T)));
});
console.log('c=0.01,T=1e5: K*',best(1e5,0.01),'closed',(kap*Math.log(R*V/(kap*1e5*0.01))).toFixed(2));
// number of Honore subsets
console.log('2^11 =',Math.pow(2,11));
// first-order condition check: marginal benefit at K* ~ T*c
[1,1e5].forEach(function(T){var k=Math.max(1,kap*Math.log(R*V/(kap*T*c)));console.log('T',T,'marg benefit',(R*V/kap*Math.exp(-k/kap)).toFixed(3),'marg cost',(T*c).toFixed(3));});
