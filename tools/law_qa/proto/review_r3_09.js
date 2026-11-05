// r3 review of lesson 09: re-derive widget numbers from scratch
var R=[0.30,0.35,0.30,0.30,0.30], C=[20,200,600,300,900], N=['通知','听证','律师','交叉','上诉'];
function pk(m,e0,L){var e=e0,c=0;for(var i=0;i<5;i++)if((m>>i)&1){e*=1-R[i];c+=C[i];}return {m:m,e:e,c:c,tot:e*L+c};}
function best(e0,L){var b=null;for(var m=0;m<32;m++){var p=pk(m,e0,L);if(!b||p.tot<b.tot-1e-9)b=p;}return b;}
function nm(m){var o=[];for(var i=0;i<5;i++)if((m>>i)&1)o.push(N[i]);return o.join('+')||'none';}
[[0.2,1e3],[0.2,1e4],[0.2,1e5],[0.05,1e5]].forEach(function(a){
 var b=best(a[0],a[1]),z=pk(0,a[0],a[1]),f=pk(31,a[0],a[1]);
 console.log('e0',a[0],'L',a[1],'best',nm(b.m),'err%',(b.e*100).toFixed(2),'tot',b.tot.toFixed(1),'zero',z.tot.toFixed(1),'all',f.tot.toFixed(1),'progcost all',f.c,'ratio all/best',(f.tot/b.tot).toFixed(2),'all err%',(f.e*100).toFixed(2));
});
// thresholds e0=0.2
var prev=-1;
for(var lg=3;lg<=7.0001;lg+=0.0005){var L=Math.pow(10,lg);var b=best(0.2,L);if(b.m!==prev){console.log('L=',L.toFixed(0),'->',nm(b.m));prev=b.m;}}
// single-add rule check: marginal e*L*r > c  (add i when others fixed)
