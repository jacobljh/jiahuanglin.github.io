// r6 independent re-derivation of lesson 15 (IP term widget). Uses numeric quadrature over K (no closed form), precise normal CDF.
function erf(x){ // high-precision via series/continued fraction (Numerical Recipes erfc Chebyshev)
  var z=Math.abs(x),t=1/(1+0.5*z);
  var r=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277)))))))));
  return x>=0?1-r:r-1;
}
function Phi(x){return 0.5*(1+erf(x/Math.SQRT2));}
// numeric: integrate over u=ln K ~ N(ln Kmed, s^2)
function model(T,d,Kmed,s,phi){
  var a=(1-Math.exp(-d*T))/d;
  var N=200000, lo=-8, hi=8, h=(hi-lo)/N, F=0, EK=0;
  for(var i=0;i<N;i++){
    var z=lo+(i+0.5)*h, dens=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI);
    var K=Kmed*Math.exp(s*z);
    if(K<=a){ F+=dens*h; EK+=K*dens*h; }
  }
  var per=(1.5-phi)*a+2*Math.exp(-d*T)/d;
  return {a:a,F:F,W:F*per-EK};
}
function peak(d,Kmed,s,phi){var bw=-1e9,bt=0;for(var t=0.5;t<=60.0001;t+=0.5){var m=model(t,d,Kmed,s,phi);if(m.W>bw){bw=m.W;bt=t;}}return bt;}
var base=[0.08,6,0.6,0.3];
console.log('--- baseline curve (d=.08,Kmed=6,s=.6,phi=.3)');
[5,10,15,20,25,30,40,60].forEach(function(T){var m=model(T,base[0],base[1],base[2],base[3]);console.log('T='+T+' F='+(m.F*100).toFixed(2)+'% W='+m.W.toFixed(3));});
var m5=model(5,...base).F,m10=model(10,...base).F,m20=model(20,...base).F,m40=model(40,...base).F,m30=model(30,...base).F,m60=model(60,...base).F;
console.log('doubling gains pp: 5->10',((m10-m5)*100).toFixed(2),' 10->20',((m20-m10)*100).toFixed(2),' 20->40',((m40-m20)*100).toFixed(2),' 30->60',((m60-m30)*100).toFixed(2));
console.log('W(20)-W(40)=',(model(20,...base).W-model(40,...base).W).toFixed(3));
console.log('peak base',peak(...base),' phi=0',peak(0.08,6,0.6,0),' phi=.6',peak(0.08,6,0.6,0.6),' d=.03',peak(0.03,6,0.6,0.3));
console.log('A(20)/A(inf)=',(1-Math.exp(-1.6)).toFixed(4),' 40:',(1-Math.exp(-3.2)).toFixed(4),' 60:',(1-Math.exp(-4.8)).toFixed(4),' e^-4=',Math.exp(-4).toFixed(4),' A(inf)=',(1/0.08));
[['drug',0.08,14],['software',0.18,2],['fashion',0.08,0.3]].forEach(function(p){
  var m20=model(20,p[1],p[2],0.6,0.3),m40=model(40,p[1],p[2],0.6,0.3);
  console.log(p[0],'F(20)='+(m20.F*100).toFixed(1)+'% peak T='+peak(p[1],p[2],0.6,0.3)+' dF(20->40)='+((m40.F-m20.F)*100).toFixed(2)+'pp dW='+(m40.W-m20.W).toFixed(3)+' W20='+m20.W.toFixed(3)+' W40='+m40.W.toFixed(3));
});
// social-surplus split check: linear demand P=1-Q, zero cost
var Qm=0.5,Pm=0.5,profit=Qm*Pm,cs=0.5*Qm*(1-Pm),total=0.5,dwl=total-profit-cs;
console.log('linear demand: profit',profit,'cs',cs,'dwl',dwl,'total',total,'ratio profit:cs:dwl =',profit/total,cs/total,dwl/total);
// sanity: monotone F, W(0+)=0
console.log('F small T',model(0.01,...base).F.toExponential(2));
