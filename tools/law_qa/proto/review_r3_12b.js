// convergence of a weighted-trapezoid 3D grid vs the exact inner-integral formula
function erf(x){var t=1/(1+0.3275911*Math.abs(x));var y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x>=0?y:-y;}
function Phi(x){return 0.5*(1+erf(x/Math.SQRT2));}
function phi(x){return Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);}
function invPhi(p){var lo=-9,hi=9,mid;for(var i=0;i<80;i++){mid=(lo+hi)/2;if(Phi(mid)<p)lo=mid;else hi=mid;}return (lo+hi)/2;}
function grid(N,R){var z=[],w=[],h=2*R/(N-1),s=0,i;for(i=0;i<N;i++){z.push(-R+i*h);var ww=phi(-R+i*h);w.push(ww);s+=ww;}for(i=0;i<N;i++)w[i]/=s;return {z:z,w:w};}
function trap(mu,sig,k,N,R){var G=grid(N,R),a,b,c,T=0,wT=0,mT=0,wA=0;
 for(a=0;a<N;a++){var m=mu+G.z[a],pt=Phi(m),est=[];for(b=0;b<N;b++)est.push(Phi(m+sig*G.z[b]));wA+=G.w[a]*pt;
  for(b=0;b<N;b++)for(c=0;c<N;c++)if(est[b]-est[c]>k){var w=G.w[a]*G.w[b]*G.w[c];T+=w;wT+=w*pt;mT+=w*m;}}
 return {trial:T,all:wA,tried:wT/T,m:mT/T};}
// semi-exact: integrate over m and eP with exact eD integral
function semi(mu,sig,k,N,R){var G=grid(N,R),a,b,T=0,wT=0,mT=0;
 for(a=0;a<N;a++){var m=mu+G.z[a],pt=Phi(m);var pr=0;
  for(b=0;b<N;b++){var pP=Phi(m+sig*G.z[b]);if(pP>k){pr+=G.w[b]*Phi((invPhi(pP-k)-m)/sig);}}
  T+=G.w[a]*pr;wT+=G.w[a]*pr*pt;mT+=G.w[a]*pr*m;}
 return {trial:T,tried:wT/T,m:mT/T};}
var cases=[[0.8,0.6,0.4],[0.8,0.4,0.4],[0.8,1.0,0.1]];
cases.forEach(function(c){
 var s=semi(c[0],c[1],c[2],401,7);
 console.log('case',c.join(','),'semi401 trial',(s.trial*100).toFixed(3),'tried',(s.tried*100).toFixed(3),'m',s.m.toFixed(3));
 [41,61,81,101].forEach(function(N){var r=trap(c[0],c[1],c[2],N,5.5);console.log('   trap N',N,'trial',(r.trial*100).toFixed(3),'tried',(r.tried*100).toFixed(3),'m',r.m.toFixed(3));});
});
