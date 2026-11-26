// Isolated SSR data/state checks and a local fixture switch. No desktop/browser control.
import {createServer} from 'vite';
import {createElement as h} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {QueueView}=await server.ssrLoadModule('/src/queue/JobList.tsx');
 const {default:Shell}=await server.ssrLoadModule('/src/components/AppShell.tsx');
 const noop=()=>{};
 const base={id:'1',type:'Converter',title:'Meeting notes → PDF',source:'C:\\Projects\\notes.md',destination:'C:\\Projects\\notes.pdf',status:'waiting',stage:'Waiting',percent:null};
 const statuses=['waiting','running','cancelling','completed','failed','cancelled'];
 const worst=statuses.map((status,i)=>({...base,id:String(i),status,type:['Converter','Images to PDF','Merge PDF','Downloader'][i%4],title:i===1?'J':i===2?'王秀英 · Đặng Thị Ngọc Hân · 🦊':`2026 Annual review — FINAL (revised after board approval) v12 <script>alert(1)</script>`,source:i%2?'C:\\Projects\\RegionalPlanningCommitteePublicProceedingsArchive\\2026\\Approved deliverables\\IMG_20260914_183022_HDR_portrait_edited_edited.png':'',destination:base.destination.replace('notes.pdf','RegionalPlanningCommitteePublicProceedingsArchive_FinalApprovedBoardReview2026_v12.pdf'),stage:status==='failed'?'The queued source is missing or inaccessible. Inspect or select it again.':status==='running'?'Verifying the output before protected publication…':status,percent:status==='running'?null:142,error:status==='failed'?'The queued source is missing or inaccessible. Inspect or select it again.':undefined}));
 const fixtures=[['Demo data',[base]],['Worst case',worst],['Empty',[]],['One',[{...base,status:'running',percent:0,stage:'Converting…'}]],['1,000 jobs',Array.from({length:1000},(_,i)=>({...base,id:String(i)}))]];
 fixtures.push(['Cached previews', ['image','video','audio','document'].map((category,i)=>({...base,id:String(i),thumbnail:{category,state:i<2?{status:'ready',path:base.source,image:{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',width:88,height:80}}:{status:'fallback',path:base.source}},destination:String.raw`\\?\C:\Projects\very-long-output-name-without-spaces-final-version.pdf`}))]);
 const documents=fixtures.map(([name,entries])=>{
  const content=render(h(Shell,{activePage:'Queue',onNavigate:noop},h(QueueView,{entries,cancel:noop,move:noop,remove:noop,clear:noop,open:noop})));
  assert.equal((content.match(/<h1/g)||[]).length,1);assert.doesNotMatch(content,/>undefined<|>NaN</);
  assert.ok((content.match(/class="queue-card"/g)||[]).length<=40);
  assert.equal((content.match(/class="file-preview"/g)||[]).length,Math.min(entries.length,40));
  const processing=entries.filter(e=>['running','cancelling'].includes(e.status)).length;
  assert.ok(content.includes(`${processing.toLocaleString()} processing · ${entries.filter(e=>e.status==='waiting').length.toLocaleString()} waiting · ${entries.filter(e=>['completed','failed','cancelled'].includes(e.status)).length.toLocaleString()} finished`));
  assert.ok(!content.includes('One output job runs at a time.'));
  if(name==='Cached previews'){assert.equal((content.match(/<img /g)||[]).length,2);assert.ok(!content.includes(String.raw`\\?\C:`));}
  if(name==='Empty')assert.match(content,/No jobs in this session/);
  if(name==='Worst case'){
   assert.doesNotMatch(content,/<script>alert/);assert.match(content,/&lt;script&gt;/);assert.match(content,/Open output/);assert.match(content,/Move up/);
   assert.match(content,/<progress(?![^>]*value=)[^>]*>/);assert.match(content,/Cancelling/);assert.match(content,/role="alert"/);
  }
  if(name==='One')assert.match(content,/value="0"/);
  if(entries.length===1000){assert.equal((content.match(/class="queue-card"/g)||[]).length,40);assert.match(content,/Page 1 of 25/);}
  return {name,content};
 });
 for(const entries of [[],worst.filter(e=>['completed','failed','cancelled'].includes(e.status)),Array.from({length:500},(_,i)=>({...base,id:String(i),status:'completed',finishedAt:Date.now(),summary:'PDF'}))]){
  const html=render(h(QueueView,{historyMode:true,entries,cancel:noop,move:noop,remove:noop,clear:noop,open:noop}));
  documents.push({name:`History ${entries.length} jobs`,content:render(h(Shell,{activePage:'History',onNavigate:noop},h(QueueView,{historyMode:true,entries,cancel:noop,move:noop,remove:noop,clear:noop,open:noop})))});
  assert.match(html,/Saved jobs/);assert.ok(!html.includes('Move up'));assert.ok(!html.includes(' processing · '));assert.ok((html.match(/class="queue-card"/g)||[]).length<=40);
 }
 const css=await readFile('src/styles.css','utf8');
 assert.match(css,/\.queue-card h3[^}]*overflow-wrap: anywhere/);assert.match(css,/\.queue-card-heading[^}]*flex-wrap: wrap/);
 const escaped=JSON.stringify(documents).replace(/</g,'\\u003c');
 await mkdir('.engine-cache/ui-check',{recursive:true});
 await writeFile('.engine-cache/ui-check/queue.html',`<!doctype html><html lang="en"><meta charset="utf-8"><title>Queue state fixtures</title><style>${css}\n#fixture-controls{position:fixed;bottom:0;left:0;right:0;padding:8px;background:#eee;color:#111;z-index:999;font:14px system-ui;display:flex;gap:8px;flex-wrap:wrap}</style><div id="fixture"></div><div id="fixture-controls"><label>Data <select id="data"></select></label><label>Theme <select id="theme"><option>dark</option><option>light</option></select></label><label>Width <select id="width"><option>320px</option><option>640px</option><option>1100px</option><option>2560px</option></select></label><label>Text <select id="text"><option>100%</option><option>200%</option></select></label></div><script>const docs=${escaped};const names=['data','theme','width','text'];const els=Object.fromEntries(names.map(n=>[n,document.getElementById(n)]));docs.forEach((d,i)=>els.data.add(new Option(d.name,i)));const params=new URLSearchParams(location.search);for(const n of names){if(params.has(n))els[n].value=params.get(n);els[n].onchange=()=>{params.set(n,els[n].value);history.replaceState(null,'','?'+params);draw();};}function draw(){document.getElementById('fixture').innerHTML=docs[Number(els.data.value)].content;document.documentElement.dataset.theme=els.theme.value;document.documentElement.style.fontSize=els.text.value;document.body.style.width=els.width.value;}draw();</script>`);
 await writeFile('.engine-cache/ui-check/queue-report.json',JSON.stringify({method:'SSR assertions and CSS inference; no visual or desktop verification',fields:[['Type/status','typed enums'],['Title/source/destination/error','no UI length limit; wrap long text, source disclosure scrolls'],['Percentage','optional; finite values clamped 0–100'],['Collection','40 rendered per page'],['Actions','status-dependent; keyboard-native buttons']],states:fixtures.map(([name])=>name),widths:[320,640,1100,2560],themes:['dark','light'],text:['100%','200%'],findings:[{field:'Long filenames and paths',resolution:'min-inline-size:0, flex wrapping and overflow-wrap:anywhere'},{field:'1,000 session entries',resolution:'40-entry pages keep result rendering bounded'},{field:'Unavailable stage totals',resolution:'indeterminate progress without fabricated percentages'}]},null,2));
 console.log(`${documents.length} Queue SSR fixtures passed; CSS resilience inferred. Local switch: .engine-cache/ui-check/queue.html`);
}finally{await server.close();}
