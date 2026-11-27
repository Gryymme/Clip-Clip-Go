// Extension-only DOM/markup stress checks. Produces dev-only manual visual fixtures;
// it never opens or controls a browser, and makes no pixel-measurement claims.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {renderCandidates} from './extension/popup-view.js';
import {discoveryLabel,connectionView} from './extension/popup-state.js';
import {grantDescription} from './extension/popup-settings.js';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.text='';this.attributes={};}
 set textContent(value){this.text=String(value);this.children=[];}append(...els){this.children.push(...els);}replaceChildren(){this.children=[];this.text='';}addEventListener(){}setAttribute(k,v){this.attributes[k]=v;}
 html(){const attrs={...this.attributes};for(const key of ['id','className','type','name','value','dir','htmlFor'])if(this[key])attrs[key==='className'?'class':key==='htmlFor'?'for':key]=this[key];if(this.checked)attrs.checked='';if(this.disabled)attrs.disabled='';const open=`<${this.tag}${Object.entries(attrs).map(([k,v])=>` ${k}="${escape(v)}"`).join('')}>`;return this.tag==='input'?open:open+escape(this.text)+this.children.map(c=>c.html()).join('')+`</${this.tag}>`;}
}
const doc={createElement:tag=>new Element(tag)},base=new URL('./extension/',import.meta.url);
const html=await readFile(new URL('popup.html',base),'utf8'),rawCss=await readFile(new URL('popup.css',base),'utf8');
assert.match(rawCss,/html,body\{width:440px/);assert.match(rawCss,/html\{height:540px/);assert.match(rawCss,/#settings-dialog\{[^}]*overflow:hidden/);assert.match(rawCss,/\.settings-content\{[^}]*overflow-y:auto;overflow-x:hidden/);assert.match(rawCss,/body.settings-open\{overflow:hidden/);assert.match(rawCss,/minmax\(0,1fr\)/);
assert.deepEqual([...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(m=>m[1]),['Review Site Permission','Access and Troubleshooting','Settings and Privacy']);assert.ok(!html.includes('Stop this tab'));assert.ok(!html.includes('Activate this tab'));assert.ok(!html.includes('thumbnail-access'));assert.ok(html.indexOf('id="disconnect"')>html.indexOf('<dialog'));assert.match(rawCss,/#send\{position:static/);
const css=rawCss.replaceAll("url('./fonts/","url('../../browser-companion/extension/fonts/");
const candidate={id:'one',mediaType:'direct',mediaUrl:'https://cdn.example.test/video?signature=DO_NOT_RENDER',pageUrl:'https://page.test/',title:null,width:null,height:null,expiresAt:Date.now()+600_000};
const long={...candidate,title:'2026 committee proceedings — final revised recording · 王秀英 / Đặng Thị Ngọc Hân · <script>not HTML</script> '.repeat(12).slice(0,1024),mediaUrl:'https://regional-planning-committee-public-proceedings-archive.media.example.test/video?signature=DO_NOT_RENDER'};
const states=[['Empty',[]],['One missing metadata',[candidate]],['Worst case',[long,{...candidate,id:'short',title:'J'},{...candidate,id:'rtl',title:'نور الهدى عبد الرحمن'}]],['Page for inspection',[{...candidate,mediaType:'page',mediaUrl:'',extractorPageUrl:'https://www.youtube.com/watch?v=irVNGjRFZGk'}]],['50 candidates',Array.from({length:50},(_,i)=>({...long,id:String(i)}))]];
const fixtures=[];
for(const theme of ['light','dark'])for(const [name,candidates]of states){
 const root=new Element('div');renderCandidates(root,candidates,candidates[0]?.id,()=>{},doc);const rows=root.children.map(c=>c.html()).join('');assert.equal(root.children.length,candidates.length);assert.ok(!rows.includes('DO_NOT_RENDER'));assert.ok(!rows.includes('<script>'));
 let body=html.match(/<body>([\s\S]*)<script type="module"/)[1].replace('<div id="list" role="radiogroup" aria-label="Choose detected source"></div>',`<div id="list" role="radiogroup" aria-label="Choose detected source">${rows}</div>`).replace('No Media Detected',discoveryLabel(candidates)).replace('Checking tab…','regional-planning-committee-public-proceedings-archive.example.test').replace('Checking website access…','Start playback, or rescan an already loaded player.');
 if(candidates.length)body=body.replace('aria-label="Detected media" hidden','aria-label="Detected media"');
 const controls=connectionView({ok:theme==='light',code:theme==='light'?'connected':'disconnected'});if(controls.connectHidden)body=body.replace('data-connected="false">Not Connected','data-connected="true">Connected');if(controls.connectHidden)body=body.replace('id="connect"','id="connect" hidden');if(!controls.disconnectHidden)body=body.replace('id="disconnect" class="secondary" hidden','id="disconnect" class="secondary"');
 const finish=(body,settings=false)=>`<!doctype html><html lang="en" data-theme="${theme}"><meta charset="utf-8"><style>${css}</style><body${settings?' class="settings-open"':''}>${body}<script>const dialog=document.getElementById('settings-dialog');document.getElementById('settings-open').onclick=()=>dialog.showModal();document.getElementById('settings-close').onclick=()=>dialog.close();document.getElementById('theme').value='${theme}';document.getElementById('theme').onchange=e=>document.documentElement.dataset.theme=e.target.value;</script></body></html>`;
 fixtures.push([`${theme} · ${name}`,finish(body)]);
 if(name==='Empty'||name==='Worst case'){
  const grants=name==='Empty'?'<p>No website access granted.</p>':['*://*.example.test/*','https://regional-planning-committee-public-proceedings-archive.media.example.test/*','<all_urls>'].map(p=>`<div class="site-grant"><span>${escape(grantDescription(p))}</span><button class="secondary">Revoke</button></div>`).join('');
  body=body.replace('<div id="site-grants" aria-live="polite"></div>',`<div id="site-grants" aria-live="polite">${grants}</div>`).replace('<dialog id="settings-dialog"','<dialog open id="settings-dialog"');fixtures.push([`${theme} · Settings ${name}`,finish(body,true)]);
 }
}
const output=new URL('../.engine-cache/ui-check/',import.meta.url);await mkdir(output,{recursive:true});
const page=`<!doctype html><meta charset="utf-8"><title>Extension-only layout fixtures</title><style>body{font:14px system-ui;background:#888;padding:12px}iframe{width:442px;height:542px;border:1px solid #333;display:block;margin-top:12px}label{margin-inline-end:16px}</style><label>Demo data / Worst case <select id="case">${fixtures.map(([name],i)=>`<option value="${i}">${escape(name)}</option>`).join('')}</select></label><label><input id="scale" type="checkbox">200% text</label><iframe title="ClipClipGO popup fixture"></iframe><script>const fixtures=${JSON.stringify(fixtures).replaceAll('<','\\u003c')},select=document.querySelector('select'),frame=document.querySelector('iframe'),params=new URLSearchParams(location.search);select.value=params.get('case')||'0';function apply(){let html=fixtures[Number(select.value)][1];if(document.querySelector('#scale').checked)html=html.replace('</style>','html{font-size:28px}</style>');frame.srcdoc=html;history.replaceState(null,'','?case='+select.value)}select.onchange=apply;document.querySelector('#scale').onchange=apply;apply();</script>`;
await writeFile(new URL('extension.html',output),page);
console.log(`${fixtures.length} extension DOM/CSS fixtures passed (0/1/50 candidates, multilingual/schema-limit titles, broad/empty grants, both themes). No browser pixels measured. Fixtures: .engine-cache/ui-check/extension.html`);
