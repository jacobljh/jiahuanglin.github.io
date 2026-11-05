// proto for lesson 19: compliance without police. comply iff g <= d*b*m*S(delta,T), S = sum_{t=1..T} delta^t
function S(delta,T){ var s=0,t; for(t=1;t<=T;t++) s+=Math.pow(delta,t); return s; }
function closed(delta,T){ return delta*(1-Math.pow(delta,T))/(1-delta); }
var b=2;
function row(label,g,d,T,delta,m){
  var s=S(delta,T), loss=d*b*m*s, crit_g=loss, crit_d=g/(b*m*s);
  console.log(label.padEnd(28),'g='+g,'d='+d,'T='+T,'delta='+delta,'m='+m,' S='+s.toFixed(3),'closed='+closed(delta,T).toFixed(3),' loss='+loss.toFixed(2),' comply='+(g<=loss),' crit_g='+crit_g.toFixed(2),' crit_d='+(crit_d>1?'>1 ('+crit_d.toFixed(2)+')':crit_d.toFixed(3)));
}
// candidate defaults
[[10,0.7,5,0.9,1],[8,0.7,5,0.9,1],[6,0.7,5,0.9,1],[7,0.7,5,0.9,1],[6,0.7,5,0.9,2],[6,0.7,5,0.9,4],[6,0.7,5,0.3,4],[6,0.1,5,0.9,4]].forEach(function(a,i){row('cand'+i,a[0],a[1],a[2],a[3],a[4]);});
console.log('--- m sweep, g=6 d=.7 T=5 delta=.9');
for(var m=1;m<=6;m++) row('m='+m,6,0.7,5,0.9,m);
console.log('--- T sweep (delta=.9 and .5), m=1');
for(var T=1;T<=10;T++) console.log('T='+T,'S(.9)='+S(0.9,T).toFixed(3),'S(.5)='+S(0.5,T).toFixed(3),'S(.3)='+S(0.3,T).toFixed(3), 'S(.99)='+S(0.99,T).toFixed(3));
console.log('limit T->inf: .9 ->',(0.9/0.1).toFixed(2),' .5 ->',1,' .99 ->',(0.99/0.01).toFixed(1));
