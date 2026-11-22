// Presentation-only Chromium checks. Never loads an extension or a user's browser profile.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=process.env.POPUP_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.resolve('.engine-cache/popup-browser');await mkdir(root,{recursive:true});
const profile=await mkdtemp(path.join(root,'profile-'));
const roots={source:path.resolve('browser-companion/extension'),packaged:path.resolve('src-tauri/target/debug/extension')};
const fixture=`import {renderCandidates} from './popup-view.js';
window.fixtureDone=(async()=>{
const state=new URL(location.href).searchParams.get('state');
document.querySelector('#connection').textContent=state==='connected'?'Connected to ClipClipGO.':'Disconnected. Open ClipClipGO and connect.';
document.querySelector('#disconnect').hidden=state!=='connected';
document.querySelector('#hint').textContent=state==='activation'?'Website access is needed. Activate this tab and approve its origin.':'Listening in this tab. Play the video.';
if(state==='error')document.querySelector('#result').textContent='Bridge unavailable. Open ClipClipGO and check setup.';
const count=state==='many'?50:state==='multiple'?3:0;
const candidates=Array.from({length:count},(_,i)=>({id:String(i),mediaUrl:'https://regional-planning-committee-public-proceedings-archive.media.example.test/file?signature=never-render',title:i===1?null:'Assemblée publique — 王秀英 · '+('Annual regional proceedings — '.repeat(30)),mediaType:i%2?'direct':'hls',width:null,height:null}));
renderCandidates(document.querySelector('#list'),candidates,'0',()=>{});document.querySelector('#send').disabled=!count;
await document.fonts.load('600 14px Montserrat');await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const els=[document.documentElement,document.body,...document.querySelectorAll('button,input,summary,p,h1')];
return {width:document.documentElement.getBoundingClientRect().width,bodyWidth:document.body.getBoundingClientRect().width,height:document.body.getBoundingClientRect().height,viewport:innerWidth,overflow:document.body.scrollWidth>document.body.clientWidth||document.documentElement.scrollWidth>innerWidth,fontLoaded:[...document.fonts].some(f=>f.family==='Montserrat'&&f.status==='loaded'),families:els.map(e=>getComputedStyle(e).fontFamily),nestedScroll:[...document.querySelectorAll('main,section,form,#list')].some(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)),vertical:document.body.scrollHeight>document.body.clientHeight,sensitive:document.body.innerText.includes('signature=never-render')};})();`;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),[,kind,...parts]=u.pathname.split('/'),dir=roots[kind];if(!dir)throw Error();const name=parts.join('/')||'popup.html';if(name==='fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return;}const file=path.resolve(dir,name);if(!file.startsWith(dir+path.sep))throw Error();let body=await readFile(file);if(name==='popup.html')body=body.toString().replace('src="popup.js"','src="fixture.mjs"');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.ttf')?'font/ttf':'text/html');res.end(body);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const child=spawn(browser,['--headless=new','--disable-gpu','--disable-extensions','--no-proxy-server','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;const results=[];
try{
 let port;for(let n=0;n<100;n++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(port,'Headless Chrome did not start');const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 function cdp(method,params={},sessionId){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timed out'));},30000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params,sessionId}));});}
 for(const kind of Object.keys(roots))for(const state of ['connected','disconnected','activation','empty','error','multiple','many']){
  const {targetId}=await cdp('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  await cdp('Emulation.setDeviceMetricsOverride',{width:440,height:540,deviceScaleFactor:1,mobile:false},sessionId);
  await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/${kind}/popup.html?state=${state}`},sessionId);
  const measured=await cdp('Runtime.evaluate',{expression:'new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.fixtureDone){clearInterval(t);resolve(window.fixtureDone);}else if(++n>100){clearInterval(t);reject("fixture timeout");}},50);})',awaitPromise:true,returnByValue:true},sessionId);
  assert.ok(!measured.exceptionDetails,JSON.stringify(measured.exceptionDetails));const m=measured.result.value;assert.equal(m.width,440);assert.equal(m.bodyWidth,440);assert.equal(m.height,540);assert.equal(m.overflow,false);assert.equal(m.fontLoaded,true);assert.ok(m.families.every(f=>f.startsWith('Montserrat')));assert.equal(m.nestedScroll,false);assert.equal(m.sensitive,false);if(state==='many')assert.equal(m.vertical,true);results.push({kind,state,...m});await cdp('Target.closeTarget',{targetId});
 }
 await writeFile(path.join(root,'report.json'),JSON.stringify({method:'Isolated headless Chrome, HTTP-served actual popup assets; presentation fixture replaces Chrome API script; no extension installation/profile access',results},null,2));
 console.log(`${results.length} rendered source/packaged popup states passed: 440×540, loaded Montserrat on text/controls, no horizontal/nested scroll overflow.`);
 await cdp('Browser.close');
}finally{ws?.close();child.kill();await new Promise(r=>server.close(r));}
