// r2 independent re-derivation of lesson 06 numbers
var p0=0.5,L=100,b=20;
var p=function(x){return p0/(1+x)}, u=function(x){return x+p(x)*L};
var xs=Math.sqrt(p0*L)-1, us=u(xs);
var W=function(a,x){return b*a-a*a/2-a*u(x)};
var aS=Math.max(0,b-us);
console.log('x*',xs.toFixed(3),'u*',us.toFixed(3),'a*',aS.toFixed(3),'W*',W(aS,xs).toFixed(2),'acc*',(aS*p(xs)).toFixed(3));
var aN=b-xs; console.log('negl(x*) a',aN.toFixed(3),'acc',(aN*p(xs)).toFixed(3),'W',W(aN,xs).toFixed(2),'victim',(aN*p(xs)*L).toFixed(1));
console.log('W*-Wneg',(W(aS,xs)-W(aN,xs)).toFixed(3),'p0L/2',p0*L/2);
var a0=b; console.log('none W',W(a0,0),'acc',a0*p(0));
[0.5,1.5].forEach(function(r){var xd=r*xs, a=b-xd; console.log('r',r,'xd',xd.toFixed(3),'a',a.toFixed(3),'W',W(a,xd).toFixed(2),'acc',(a*p(xd)).toFixed(3))});
console.log('u*/x*',(us/xs).toFixed(3));
[100,50,10,2].forEach(function(w){console.log('w',w,'x',Math.max(0,Math.sqrt(p0*w)-1).toFixed(2))});
// brute-force check of x* by grid
var best=1e9,bx=0; for(var x=0;x<30;x+=0.0001){var v=u(x); if(v<best){best=v;bx=x}} console.log('grid x*',bx.toFixed(3),best.toFixed(3));
// b=40
b=40; var aS2=b-us,aN2=b-xs; console.log('b40 W*',W(aS2,xs).toFixed(1),'Wneg',W(aN2,xs).toFixed(1),'diff',(W(aS2,xs)-W(aN2,xs)).toFixed(2));
