import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {setupSettings,grantDescription} from '../browser-companion/extension/popup-settings.js';
import {grantedOrigin} from '../browser-companion/extension/site-access.js';
import {discoveryLabel} from '../browser-companion/extension/popup-state.js';
function event(){const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit:()=>{for(const f of listeners)f();},listeners};}
class Element{
 constructor(){this.children=[];this.dataset={};this.listeners={};this.classList={add(){},remove(){}};}
 append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}
 setAttribute(name,value){this[name]=value;}addEventListener(name,fn){this.listeners[name]=fn;}
 scrollIntoView(){this.scrolled=true;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close();}focus(){this.focused=true;}
}
function settingsFixture(origins=[]){
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const before=new Element(),doc={getElementById:$,createElement:()=>new Element(),documentElement:{dataset:{theme:'light'}},body:new Element(),activeElement:before};
 const stored={},opened=[],grants=new Set(origins),api={runtime:{id:'abcdefghijklmnopabcdefghijklmnop'},permissions:{getAll:async()=>({origins:[...grants]}),remove:async({origins})=>{for(const o of origins)grants.delete(o);return true;},onAdded:event(),onRemoved:event()},tabs:{create:async args=>opened.push(args)},storage:{local:{set:async data=>Object.assign(stored,data)}}};
 let changed=0,closed=0;const settings=setupSettings({doc,api,onChange:async()=>changed++,onClose:()=>closed++});return {$,doc,before,stored,opened,grants,api,settings,get changed(){return changed;},get closed(){return closed;}};
}
test('origin grants respect scheme, wildcard boundaries, root-page gating and HTTP only',()=>{
 assert.ok(grantedOrigin('https://video.example.test/a',['*://*.example.test/*']));assert.ok(grantedOrigin('http://example.test/',['*://*.example.test/*']));
 assert.equal(grantedOrigin('https://example.test.evil.test/',['https://*.example.test/*']),false);
 assert.equal(grantedOrigin('http://example.test/',['https://example.test/*']),false);
 assert.equal(grantedOrigin('https://page.test/',['https://cdn.test/*']),false);
 assert.equal(grantedOrigin('file:///private',['<all_urls>']),false);
 assert.equal(grantDescription('<all_urls>'),'All websites (broad access)');assert.match(grantDescription('*://*.example.test/*'),/wildcard.*multiple sites/);
});
test('discovery labels include current extractor pages without claiming they are downloads',()=>{
 const base={expiresAt:Date.now()+60_000,mediaType:'direct',mediaUrl:'https://cdn.test/video.mp4'};
 assert.equal(discoveryLabel([]),'No Media Detected');assert.equal(discoveryLabel([base]),'Media Detected');
 assert.equal(discoveryLabel([{...base,mediaType:'page',mediaUrl:'',extractorPageUrl:'https://www.youtube.com/watch?v=irVNGjRFZGk'}]),'Media Detected');
 for(const c of [{...base,expiresAt:Date.now()-1},{...base,mediaUrl:'blob:local'},{...base,mediaType:'page',extractorPageUrl:'https://www.youtube.com/'}])assert.equal(discoveryLabel([c]),'No Media Detected');
});
test('settings use live grants, revoke exact patterns, offer browser controls and restore focus',async()=>{
 const f=settingsFixture(['*://*.example.test/*','https://cdn.test/*']);f.settings.open();await f.settings.update();await new Promise(r=>setImmediate(r));
 assert.equal(f.$('settings-dialog').open,true);assert.equal(f.$('grants-disclosure').open,false);assert.equal(f.$('grants-count').textContent,'Granted websites (2)');assert.equal(f.$('site-grants').children.length,2);
 const [label,button]=f.$('site-grants').children[0].children;assert.match(label.textContent,/\*:\/\/\*\.example.test\/\*/);
 await button.onclick();assert.ok(!f.grants.has('*://*.example.test/*'));assert.equal(f.changed,1);assert.equal(f.$('site-grants').children.length,1);
 f.api.permissions.remove=async()=>false;await f.$('site-grants').children[0].children[1].onclick();assert.match(f.$('settings-result').textContent,/Chrome did not remove/);
 f.$('browser-permissions').onclick();assert.deepEqual(f.opened,[{url:'chrome://extensions/?id=abcdefghijklmnopabcdefghijklmnop'}]);
 f.$('settings-close').onclick();assert.equal(f.closed,1);assert.equal(f.before.focused,true);
 f.grants.clear();f.api.permissions.onRemoved.emit();await new Promise(r=>setImmediate(r));assert.match(f.$('site-grants').children[0].textContent,/No website access/);
 f.$('grants-disclosure').open=true;f.settings.open();assert.equal(f.$('grants-disclosure').open,false);f.settings.dispose();assert.equal(f.api.permissions.onAdded.listeners.size,0);assert.equal(f.api.permissions.onRemoved.listeners.size,0);
});
test('theme applies only valid local preferences and preserves them when reopening settings',async()=>{
 const f=settingsFixture();assert.equal(f.$('theme').value,'light');f.$('theme').value='dark';await f.$('theme').onchange();assert.deepEqual(f.stored,{theme:'dark'});assert.equal(f.doc.documentElement.dataset.theme,'dark');
 f.$('theme').value='javascript:bad';await f.$('theme').onchange();assert.deepEqual(f.stored,{theme:'dark'});f.settings.dispose();
 const source=await readFile('browser-companion/extension/theme.js','utf8');
 for(const [saved,systemLight,expected]of [['light',false,'light'],['dark',true,'dark'],[undefined,true,'light'],[undefined,false,'dark']]){
  const root={dataset:{themePending:''}},context={document:{documentElement:root},matchMedia:()=>({matches:systemLight}),chrome:{storage:{local:{get:async key=>{assert.equal(key,'theme');return {theme:saved};}}}},setTimeout,clearTimeout};
  vm.runInNewContext(source,context);await context.clipclipgoThemeReady;assert.equal(root.dataset.theme,expected);assert.equal(root.dataset.themePending,undefined);
 }
});

test('actual popup uses one Allow/Rescan action, verified pill and collapsed rescan diagnostics',async()=>{
 const names=['chrome','document','window','setInterval','clearInterval'],saved=Object.fromEntries(names.map(k=>[k,globalThis[k]]));
 const f=settingsFixture(),calls=[];let refresh;
 const state={ok:true,detection:'permission-needed',session:null,connection:{ok:false,code:'unknown'},tab:{id:1,host:'page.test',origin:'https://page.test'}};
 f.doc.addEventListener=()=>{};const api=f.api;api.tabs.query=async()=>[{id:1,url:'https://page.test/'}];api.runtime.getManifest=()=>({version:'0.5.0'});
 api.permissions.request=async args=>{calls.push(args);return true;};api.webNavigation={onBeforeNavigate:event(),onHistoryStateUpdated:event()};
 api.runtime.sendMessage=async message=>{calls.push(message);if(message.type==='state')return structuredClone(state);if(message.type==='start'){state.detection='active';state.session={candidates:[]};}return {ok:true};};
 Object.assign(globalThis,{chrome:api,document:f.doc,window:{addEventListener(){}},setInterval:fn=>{refresh=fn;return 1;},clearInterval(){}});
 try{await import('../browser-companion/extension/popup.js?acceptance');assert.equal(f.$('discovery-action').textContent,'Allow');await f.$('discovery-action').onclick();assert.ok(calls.some(c=>c.type==='start'));assert.equal(f.$('discovery-action').textContent,'Rescan');assert.doesNotMatch(f.$('hint').textContent,/Allow this site/);
  await f.$('discovery-action').onclick();assert.ok(calls.some(c=>c.type==='scan'));assert.match(f.$('rescan-note').textContent,/Rescanned permitted frames/);assert.ok(!f.$('result').textContent?.includes('Rescanned'));
  state.connection={ok:true,code:'unknown',extensionId:'saved'};await refresh();assert.equal(f.$('connection').textContent,'Not Connected');
  state.connection={ok:true,code:'connected'};await refresh();assert.equal(f.$('connection').textContent,'Connected');assert.equal(f.$('disconnect').hidden,false);assert.equal(f.$('connect').hidden,true);
 }finally{Object.assign(globalThis,saved);}
});
