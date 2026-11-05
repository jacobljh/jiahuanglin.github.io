// r2 independent re-derivation of lesson 07 widget (1000 offenders, g uniform (0,80], h=100)
function run(p,w,f,y,pain){
  var D=0; for(var t=1;t<=y;t++) D+=30*Math.pow(0.8,t-1);
  var s=p*(Math.min(f,w)+D), n=0, harm=0;
  for(var i=0;i<1000;i++){ var g=80*(i+0.5)/1000; if(g>=s){n++; harm+=100-g;} }
  var state=n*p*y*25, pc=pain? n*p*D:0;
  return {s:s,det:(1-n/1000),cost:harm+state+pc,harm:harm,state:state};
}
[0,1,2,3,4,5,8,12].forEach(function(y){var r=run(0.2,20,500,y,false);console.log('y',y,(r.det*100).toFixed(1)+'%',Math.round(r.cost));});
console.log('pain', [0,1,2,3,4].map(function(y){return Math.round(run(0.2,20,500,y,true).cost)}).join(' '));
console.log('p=1', run(1,20,500,0,false).det, Math.round(run(1,20,500,0,false).cost));
console.log('rich', run(0.2,1e9,500,0,false));
// closed form for y=0: sanc=4 -> offenders = g>=4: 80-4 =76/80=95%
// analytic: cost = N*(1/80)*integral_{s}^{80}(100-g)dg
function analytic(s){ if(s>=80) return 0; return 1000/80*((100*(80-s))-(80*80-s*s)/2); }
console.log('analytic y=0', analytic(4), 'y=3', analytic(0.2*(20+73.2))+ 1000*(80-0.2*(93.2))/80*0.2*3*25, '(approx; discretization)');
