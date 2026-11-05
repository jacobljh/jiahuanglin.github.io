// r5 structural self-check for law lessons: tag balance, callouts, widget/canvas counts, pronouns, LaTeX, misconception count
const fs=require('fs');
for(const f of process.argv.slice(2)){
  const s=fs.readFileSync(f,'utf8');
  const body=s.replace(/<script[\s\S]*?<\/script>/g,'');
  const out=[];
  for(const t of ['p','strong','em','div','table','tr','ul','li','span','h2','sub','sup']){
    const o=(body.match(new RegExp('<'+t+'(\\s[^>]*)?>','g'))||[]).length, c=(body.match(new RegExp('</'+t+'>','g'))||[]).length;
    if(o!==c) out.push('UNBALANCED <'+t+'> open='+o+' close='+c);
  }
  out.push('widgets='+(body.match(/class="widget"/g)||[]).length+' canvas='+(body.match(/<canvas/g)||[]).length);
  const ul=body.match(/<h2>常见误解<\/h2>\s*<ul class="prompt-list">([\s\S]*?)<\/ul>/);
  out.push('misconceptions='+(ul?(ul[1].match(/<li>/g)||[]).length:'NONE'));
  out.push('warn='+(/callout warn"><div class="label">模型的边界/.test(body))+' source-note='+(/callout source-note"><div class="label">出处小注/.test(body)));
  const pron=(body.replace(/<[^>]+>/g,'').match(/[他她]/g)||[]).length; out.push('pronoun他她='+pron);
  const text=body.replace(/<[^>]+>/g,'');
  const m=text.match(/[^。\n]{0,12}[他她][^。\n]{0,12}/g); if(m) out.push('PRON CTX: '+m.join(' | '));
  out.push('latex='+(/\\\(|\\\[|\$\$|\\frac|\\sum/.test(body)));
  out.push('reviewed markers='+(s.match(/<!-- reviewed:v\d -->/g)||[]).join(','));
  const sizeKB=(Buffer.byteLength(s)/1024).toFixed(1); out.push('size='+sizeKB+'KB');
  console.log(f.split('/').pop()+': '+out.join(' ; '));
}
