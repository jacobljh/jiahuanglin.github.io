// r3 review of lesson 11: independent re-derivation of the precedent model
function halton(i,b){var f=1,r=0;while(i>0){f/=b;r+=f*(i%b);i=Math.floor(i/b);}return r;}
function g(a){return 0.45+0.25*Math.sin(3*a);}
function truth(a,b){return b>=g(a)?1:0;}
// analytic area above curve
var N=200000,above=0;for(var i=0;i<N;i++){var a=(i+.5)/N;above+=1-Math.min(1,g(a));}
console.log('area above curve (forbid share)',(above/N).toFixed(4),'=> allow-all acc',(1-above/N).toFixed(4));
// text rule accuracy analytic: forbid iff a>=.5 vs truth
var agree=0;for(i=0;i<N;i++){a=(i+.5)/N;var t=1-g(a); // P(truth=1|a)
 agree+= (a>=.5)? t : (1-t);}
console.log('text rule acc analytic',(agree/N).toFixed(4));
// first 8 halton precedents
for(var j=1;j<=8;j++){var a1=halton(j,2),b1=halton(j,3);console.log(j,a1.toFixed(3),b1.toFixed(3),'g',g(a1).toFixed(3),'truth',truth(a1,b1));}
// accuracy on batch 0 of tests, k=3 nearest, independent implementation
function acc(n,q,bt){var P=[];for(var j=1;j<=n;j++){var a=halton(j,2),b=halton(j,3),y=truth(a,b);var w=((j*7919)%1000)<q*10;P.push([a,b,w?1-y:y]);}
 var ok=0,NT=1500,off=3000+NT*bt,dis=0,dr=0;
 for(var t=1;t<=NT;t++){var a2=halton(off+t,2),b2=halton(off+t,3),tr=truth(a2,b2),tx=a2>=.5?1:0,p;
  if(n===0)p=tx;else{var d=P.map(function(pp){return [(pp[0]-a2)*(pp[0]-a2)+(pp[1]-b2)*(pp[1]-b2),pp[2]];}).sort(function(x,y){return x[0]-y[0];});
   var kk=Math.min(3,n),s=0;for(var z=0;z<kk;z++)s+=d[z][1];p=s*2>kk?1:0;}
  if(p===tr)ok++; if(p!==tx){dis++;if(p===tr)dr++;}}
 return [ok/NT,dis/NT,dr/Math.max(dis,1)];}
[[0],[3],[5],[7],[40],[320]].forEach(function(a){var r=acc(a[0],0,0);console.log('n',a[0],'acc',(r[0]*100).toFixed(1),'dis',(r[1]*100).toFixed(1),'disRight',(r[2]*100).toFixed(1));});
[[40,10],[320,10]].forEach(function(a){var r=acc(a[0],a[1],0);console.log('n',a[0],'noise',a[1],'acc',(r[0]*100).toFixed(1));});
