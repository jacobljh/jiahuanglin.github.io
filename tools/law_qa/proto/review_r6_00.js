// r6 independent check of lesson 00 widget: logistic benefit distribution, next c = F(pS + nu_eff*c); crowd-out nu_eff = nu*(1-k*(1-exp(-pS/5)))
function F(x){return 1/(1+Math.exp(-(x-50)/8));}
function run(p,S,nu,k){var ps=p*S, ne=nu*(1-k*(1-Math.exp(-ps/5)));
  function settle(c){for(var i=0;i<5000;i++)c=F(ps+ne*c);return c;}
  // fixed points by scanning
  var fps=[],prev=null;for(var i=0;i<=100000;i++){var c=i/100000,g=F(ps+ne*c)-c;if(prev!==null&&prev*g<0)fps.push(+c.toFixed(4));prev=g;}
  return {ps:ps,ne:ne,hi:settle(0.99),lo:settle(0.01),fps:fps};}
function show(l,r){console.log(l,'ps='+r.ps.toFixed(1),'ne='+r.ne.toFixed(1),'hi='+(r.hi*100).toFixed(1)+'%','lo='+(r.lo*100).toFixed(1)+'%','fixed pts',JSON.stringify(r.fps));}
show('p0 no enforcement  ',run(0,0,60,0));
show('p1 just enough     ',run(.2,100,60,0));
show('p2 often/light     ',run(.8,25,60,0));
show('p3 crowd-out k=.6  ',run(.2,100,60,.6));
show('nu=80 p=0          ',run(0,100,80,0));
show('nu=80 p=.2 k=.6    ',run(.2,100,80,.6));
show('p=.5,S=100         ',run(.5,100,60,0));
show('p=.1,S=100         ',run(.1,100,60,0));
console.log('nu_eff nu=60,k=.6,ps=20:',(60*(1-.6*(1-Math.exp(-4)))).toFixed(2),' nu=80:',(80*(1-.6*(1-Math.exp(-4)))).toFixed(2));
