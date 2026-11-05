// r7 review of lesson 10 widget: independent re-derivation (exact normal CDF via continued erf) vs the widget; grid sweep for NaN/Infinity.
const h = require('./review_r5_harness.js')('all_lessons/law/lessons/10_proof_standards.html');
// exact Phi via erfc series (Numerical Recipes erfc Chebyshev, ~1e-16)
function erfc(x){const z=Math.abs(x),t=1/(1+0.5*z);const r=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277)))))))));return x>=0?r:2-r;}
function Phi(x){return 0.5*erfc(-x/Math.SQRT2);}
function errs(pi,d,t){const x=(Math.log(t*(1-pi)/((1-t)*pi))+d*d/2)/d;return {x,fc:1000*(1-pi)*(1-Phi(x)),fa:1000*pi*Phi(x-d)};}
// brute-force check of the decision rule: numerically integrate and verify q(x)>=t <=> x>=x_t
function qOf(pi,d,x){const lr=Math.exp(d*x-d*d/2);return pi*lr/(pi*lr+1-pi);}
let bad=0;
for(const pi of [0.05,0.2,0.5,0.8,0.95])for(const d of [0.5,1,2,3.5,4])for(const t of [0.5,0.75,0.91,0.99]){
  const e=errs(pi,d,t); const q=qOf(pi,d,e.x); if(Math.abs(q-t)>1e-9){bad++;console.log('q(x_t)!=t',pi,d,t,q);}
}
console.log('decision-boundary mismatches:',bad);
// text figures
const f=(pi,d,t,r)=>{const e=errs(pi,d,t);return {fc:e.fc.toFixed(1),fa:e.fa.toFixed(1),ratio:(e.fa/e.fc).toFixed(1),loss:(r*e.fc+e.fa).toFixed(0)};};
console.log('default t=.91',f(.5,2,.91,10));
console.log('t=.50',f(.5,2,.5,10));
console.log('t=.75',f(.5,2,.75,10));
console.log('t=10/11',f(.5,2,10/11,10));
console.log('pi=.2 t=.91',f(.2,2,.91,10),' t=10/11',f(.2,2,10/11,10));
console.log('pi=.8 t=.91',f(.8,2,.91,10),' t=10/11',f(.8,2,10/11,10));
console.log('d=3.5 t=.91',f(.5,3.5,.91,10));
// optimal t by dense scan for r in {1,2,5,10,20,50,100}
for(const r of [1,2,5,10,20,50,100]){let bt=0,bl=1e18;for(let t=0.5;t<=0.995;t+=0.0005){const e=errs(.5,2,t);const l=r*e.fc+e.fa;if(l<bl){bl=l;bt=t;}}console.log('r',r,'scan-opt t',bt.toFixed(4),'t*',(r/(1+r)).toFixed(4));}
// widget vs independent over grid + NaN scan
let maxdiff=0,nan=0,cnt=0;
const ids=['w10-fc','w10-fa','w10-ratio','w10-loss','w10-tstar','w10-pival','w10-dval','w10-tval','w10-rval','w10-note'];
for(const pi of [5,20,50,80,95])for(const d of [0.5,1,2,3.5,4])for(const t of [50,75,91,99])for(const r of [1,10,100]){
  h.set('w10-pi',pi);h.set('w10-d',d);h.set('w10-t',t);h.set('w10-r',r);
  cnt++;
  for(const id of ids){const s=h.txt(id);if(/NaN|undefined|Infinity/.test(s)){nan++;console.log('BAD',id,s,pi,d,t,r);}}
  const e=errs(pi/100,d,t/100);
  const wfc=parseFloat(h.txt('w10-fc')),wfa=parseFloat(h.txt('w10-fa'));
  maxdiff=Math.max(maxdiff,Math.abs(wfc-e.fc),Math.abs(wfa-e.fa));
}
console.log('grid points',cnt,'NaN-ish',nan,'max |widget-independent| (rounded to .1 so <=0.05):',maxdiff.toFixed(3));
// preset + opt button sweep
for(const p of ['w10-p0','w10-p1','w10-p2','w10-p3','w10-opt']){h.click(p);console.log(p,ids.slice(0,5).map(i=>h.txt(i)).join(' | '));}
// opt button at different r
for(const r of [1,2,5,10,20,50,100]){h.set('w10-r',r);h.click('w10-opt');console.log('opt r',r,'t slider',h.txt('w10-tval'),'tstar',h.txt('w10-tstar'));}
