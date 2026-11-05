// r5 generic headless harness: load a lesson's inline <script> with DOM stubs, then drive it programmatically.
// usage (as module): const h = require('./review_r5_harness.js')(file); h.set(id,val); h.click(id); h.txt(id); h.ids()
const fs=require('fs'),vm=require('vm');
module.exports=function(file){
const html=fs.readFileSync(file,'utf8');
const scripts=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const attrsById={};
for(const m of html.matchAll(/<(\w+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g)){const a={};for(const x of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g))a[x[1]]=x[2]===undefined?'':x[2];if(a.id)attrsById[a.id]={tag:m[1],a};}
const H=[];const els={};
function ctx2d(){return new Proxy({},{get(o,k){if(k in o)return o[k];if(k==='measureText')return s=>({width:String(s).length*7});if(/Gradient|Pattern/.test(k))return()=>({addColorStop(){}});if(typeof k==='symbol')return undefined;return()=>{}},set(o,k,v){o[k]=v;return true}})}
function mk(id){const info=attrsById[id]||{tag:'div',a:{}};const a=info.a;const cls=new Set((a.class||'').split(/\s+/).filter(Boolean));let _c=null,_t='';const el={id,tagName:info.tag.toUpperCase(),value:a.value||'',min:a.min,max:a.max,checked:'checked' in a,style:{},dataset:{},clientWidth:680,clientHeight:330,width:0,height:0,classList:{add:c=>cls.add(c),remove:c=>cls.delete(c),toggle:(c,f)=>{const on=f===undefined?!cls.has(c):!!f;on?cls.add(c):cls.delete(c);return on},contains:c=>cls.has(c)},getAttribute:k=>a[k]??null,setAttribute(){},addEventListener:(e,fn)=>H.push({el,e,fn}),getContext:()=>_c||(_c=ctx2d()),getBoundingClientRect:()=>({left:0,top:0,width:680,height:330}),appendChild:c=>c,querySelectorAll:()=>[],children:[]};Object.defineProperty(el,'textContent',{get:()=>_t,set:v=>{_t=String(v)}});Object.defineProperty(el,'innerHTML',{get:()=>_t,set:v=>{_t=String(v).replace(/<[^>]+>/g,'')}});return el}
const document={getElementById:id=>els[id]||(els[id]=mk(id)),querySelectorAll:()=>[],createElement:()=>mk('x'),addEventListener(){}};
const win={devicePixelRatio:2,addEventListener(){},requestAnimationFrame:()=>0,setTimeout:()=>0,setInterval:()=>0,clearInterval(){},cancelAnimationFrame(){},getComputedStyle:()=>({getPropertyValue:()=>''}),Math,console,document};
win.window=win;const c=vm.createContext(win);
for(const s of scripts)vm.runInContext(s,c,{timeout:60000});
return {
  set(id,v){const el=document.getElementById(id);el.value=String(v);H.filter(h=>h.el.id===id&&(h.e==='input'||h.e==='change')).forEach(h=>h.fn({target:el}))},
  click(id){H.filter(h=>h.el.id===id&&h.e==='click').forEach(h=>h.fn({target:document.getElementById(id)}))},
  chk(id){const el=document.getElementById(id);el.checked=!el.checked;H.filter(h=>h.el.id===id&&(h.e==='change'||h.e==='input'||h.e==='click')).forEach(h=>h.fn({target:el}))},
  txt(id){return document.getElementById(id).textContent},
  ids(){return Object.keys(els)}
};
};
