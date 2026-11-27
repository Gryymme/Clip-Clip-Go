import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const source=path.resolve('browser-companion/extension');

test('theme logo variants preserve master geometry without changing toolbar assets',async()=>{
 const master=await readFile('src-tauri/icons/app.svg','utf8'),dark=await readFile(path.join(source,'icons/logo-dark.svg'),'utf8'),light=await readFile(path.join(source,'icons/logo-light.svg'),'utf8');
 assert.equal(dark,master);assert.equal(light,master.replaceAll('#FFFFFF','#000000').replaceAll('#ffffff','#000000').replaceAll('fill="white"','fill="#000000"'));
 const html=await readFile(path.join(source,'popup.html'),'utf8');assert.ok(!html.includes('id="connection"'));assert.ok(html.indexOf('id="connect"')<html.indexOf('id="settings-open"'));assert.ok(html.indexOf('ClipClipGO App &amp; Extension Connection')<html.indexOf('id="disconnect"'));
});
test('actual popup document establishes fixed size and local variable font for controls',async()=>{
 const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'))),html=await readFile(path.join(source,manifest.action.default_popup),'utf8');
 const stylesheet=html.match(/rel="stylesheet" href="([^"]+)"/)[1],css=await readFile(path.resolve(source,stylesheet),'utf8');
 assert.match(css,/html,body\{width:440px;min-width:440px;margin:0;padding:0\}/);assert.match(css,/html\{height:540px/);assert.doesNotMatch(css,/100vw|max-height:300px/);
 assert.match(css,/button,input,select,textarea\{[^}]*font-family:Montserrat/);assert.match(css,/font-weight:100 900/);
 const font=css.match(/src:url\('([^']+)'\)/)[1];assert.ok((await readFile(path.resolve(source,font))).length>700000);assert.match(html,/rel="preload"[^>]+as="font"/);
 assert.match(await readFile(path.join(source,'fonts/OFL.txt'),'utf8'),/SIL OPEN FONT LICENSE/);
});
// Opt in after a desktop build; ordinary tests do not require generated native artifacts.
test('normal build packaged the exact popup, font and other extension assets',{skip:process.env.POPUP_VERIFY_PACKAGED!=='1'},async()=>{
 let count=0;async function check(relative=''){for(const entry of await readdir(path.join(source,relative),{withFileTypes:true})){const name=path.join(relative,entry.name);if(entry.isDirectory())await check(name);else{assert.deepEqual(await readFile(path.join(source,name)),await readFile(path.resolve('src-tauri/target/debug/extension',name)),name);count++;}}}await check();assert.ok(count>0);
});
