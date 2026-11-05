// r3 review of lesson 12: independent fine-grid integration of the selection model
function erf(x){var t=1/(1+0.3275911*Math.abs(x));var y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x>=0?y:-y;}
function Phi(x){return 0.5*(1+erf(x/Math.SQRT2));}
function phi(x){return Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);}
function run(mu,sig,k,N){
 var L=-6,H=6,h=(H-L)/N,es=[],ws=[],i,j,l;
 for(i=0;i<=N;i++){var e=L+i*h;es.push(e);ws.push(phi(e)*h*((i===0||i===N)?0.5:1));}
 var mL=mu-6,mH=mu+6,hm=(mH-mL)/N,T=0,wT=0,mT=0,wAll=0,tot=0;
 for(l=0;l<=N;l++){var m=mL+l*hm,wm=phi(m-mu)*hm*((l===0||l===N)?0.5:1),pt=Phi(m);
  var est=es.map(function(e){return Phi(m+sig*e);});
  var pr=0;
  for(i=0;i<=N;i++)for(j=0;j<=N;j++){ if(est[i]-est[j]>k) pr+=ws[i]*ws[j]; }
  T+=wm*pr; wT+=wm*pr*pt; mT+=wm*pr*m; wAll+=wm*pt; tot+=wm;
 }
 return {trial:T/tot, all:wAll/tot, tried:wT/T, mTried:mT/T};
}
[[0.8,0.6,0.4],[0.8,0.4,0.4],[0.8,1.0,0.1],[0,0.6,0.4],[-0.8,0.6,0.4],[0.8,0.6,0.1],[0.8,0.2,0.4],[0.8,2.0,0.5]].forEach(function(a){
 var r=run(a[0],a[1],a[2],160);
 console.log('mu',a[0],'sig',a[1],'c/J',a[2],'trial',(r.trial*100).toFixed(2),'all',(r.all*100).toFixed(2),'tried',(r.tried*100).toFixed(2),'gap',((r.tried-r.all)*100).toFixed(2),'mTried',r.mTried.toFixed(3));
});
console.log('analytic all mu=.8',(Phi(0.8/Math.SQRT2)*100).toFixed(2));
// worked example in section 7
var J=100,c=10; var pP=0.68,pD=0.5;
console.log('American: P floor',pP*J-c,'D ceiling',pD*J+c);
console.log('loser pays all: P EV',J*pP-20*(1-pP),'D EV',pD*(J+20));
// section 1
console.log('sec1', 100*.6-10, 100*.6+10, 'diff', (0.6-0.3)*100);
