// prototype of the replacement integrator for lesson 12 (weighted trapezoid + exact inner integral)
function Phi(x){var t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2);var p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p;}
function phi(x){return 0.3989423*Math.exp(-x*x/2);}
var IA=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.3577518672690,-30.66479806614716,2.506628277459239],
    IB=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],
    IC=[-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],
    ID=[0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
function invPhi(p){var q,r;
 if(p<0.02425){q=Math.sqrt(-2*Math.log(p));return (((((IC[0]*q+IC[1])*q+IC[2])*q+IC[3])*q+IC[4])*q+IC[5])/((((ID[0]*q+ID[1])*q+ID[2])*q+ID[3])*q+1);}
 if(p>0.97575){q=Math.sqrt(-2*Math.log(1-p));return -(((((IC[0]*q+IC[1])*q+IC[2])*q+IC[3])*q+IC[4])*q+IC[5])/((((ID[0]*q+ID[1])*q+ID[2])*q+ID[3])*q+1);}
 q=p-0.5;r=q*q;return (((((IA[0]*r+IA[1])*r+IA[2])*r+IA[3])*r+IA[4])*r+IA[5])*q/(((((IB[0]*r+IB[1])*r+IB[2])*r+IB[3])*r+IB[4])*r+1);}
// check invPhi vs Phi
var mx=0;for(var p=0.0005;p<0.9995;p+=0.0005){mx=Math.max(mx,Math.abs(Phi(invPhi(p))-p));}console.log('invPhi round-trip max err',mx);
function grid(N,R){var z=[],w=[],h=2*R/(N-1),s=0,i;for(i=0;i<N;i++){z.push(-R+i*h);var ww=phi(-R+i*h);w.push(ww);s+=ww;}for(i=0;i<N;i++)w[i]/=s;return {z:z,w:w};}
var GM=grid(121,6),GE=grid(241,6);
function trialAt(m,sig,k){var pr=0,b,pP;for(b=0;b<GE.z.length;b++){pP=Phi(m+sig*GE.z[b]);if(pP>k)pr+=GE.w[b]*Phi((invPhi(pP-k)-m)/sig);}return pr;}
function stats(mu,sig,k){var a,m,pt,t,T=0,wT=0,mT=0;
 for(a=0;a<GM.z.length;a++){m=mu+GM.z[a];pt=Phi(m);t=trialAt(m,sig,k);T+=GM.w[a]*t;wT+=GM.w[a]*t*pt;mT+=GM.w[a]*t*m;}
 return {trial:T,winAll:Phi(mu/Math.SQRT2),winTried:T>0?wT/T:0,mTried:T>0?mT/T:0};}
var t0=Date.now();
[[0.8,0.6,0.4],[0.8,0.4,0.4],[0.8,1.0,0.1],[0,0.6,0.4],[-0.8,0.6,0.4],[0.8,0.6,0.1],[0.8,0.2,0.4],[0.8,2.0,0.5],[0.8,0.2,0.5],[1.5,0.2,0.5],[0.8,2,0.02]].forEach(function(a){
 var r=stats(a[0],a[1],a[2]);console.log(a.join(','),'trial',(r.trial*100).toFixed(3),'all',(r.winAll*100).toFixed(2),'tried',(r.winTried*100).toFixed(3),'gap',((r.winTried-r.winAll)*100).toFixed(2),'m',r.mTried.toFixed(3));});
console.log('ms',Date.now()-t0);
