import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {hostBuildOptions} from '../scripts/build-companion.mjs';
import {detectionView,connectionView} from '../browser-companion/extension/popup-state.js';
import {extensionIdError} from '../src/companion/types.ts';
test('connection controls require a current handshake and disable repeated attempts',()=>{
 assert.equal(connectionView({ok:true,code:'connected'}).connectHidden,true);
 assert.equal(connectionView({ok:true,code:'connected'}).disconnectHidden,false);
 for(const state of [null,{extensionId:'saved'},{ok:false,code:'disconnected'},{ok:false,code:'rejected'},{ok:true,code:'unknown'}]){assert.equal(connectionView(state).connectHidden,false);assert.equal(connectionView(state).disconnectHidden,true);}
 assert.deepEqual(connectionView({ok:true,code:'connected'},true),{connectHidden:false,disconnectHidden:true,disabled:true,label:'Connecting…'});
});
test('ID input and actionable detection states distinguish authorization from connection',()=>{
 for(const id of ['', 'not-an-id','abcdefghijklmnopabcdefghijklmnop;cmd','ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP','qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'])assert.ok(extensionIdError(id));
 assert.equal(extensionIdError(' abcdefghijklmnopabcdefghijklmnop '),null);
 for(const detection of ['permission-needed','inactive','expired','origin-changed','navigating','partial','active']){const view=detectionView({ok:true,detection,session:detection==='active'?{candidates:[]}:null});assert.ok(view.message);assert.equal(view.disabled,detection==='navigating');}
 assert.match(detectionView({ok:true,detection:'active',session:{candidates:[{}]}}).message,/1 source detected/);
 assert.equal(detectionView({ok:false}).disabled,true);
});
test('complete offline unpacked package and host sidecar are mapped into the app installation',async()=>{
 const folder=new URL('../browser-companion/extension/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',folder)));
 const names=await readdir(folder);assert.ok(!names.some(s=>/session|cache|config/i.test(s)));
 const files=['manifest.json',manifest.background.service_worker,manifest.action.default_popup,'model.js','detect.js','popup.js','popup-view.js','popup-state.js','popup.css','fonts/Montserrat-Variable.ttf','fonts/OFL.txt'];
 for(const file of files)assert.ok((await readFile(new URL(file,folder))).length>0,file);
 assert.deepEqual(await readFile(new URL('fonts/Montserrat-Variable.ttf',folder)),await readFile('public/fonts/montserrat/Montserrat-Variable.ttf'));
 assert.match(await readFile(new URL('fonts/OFL.txt',folder),'utf8'),/SIL OPEN FONT LICENSE/);
 const config=JSON.parse(await readFile('src-tauri/tauri.conf.json'));assert.equal(config.bundle.resources['../browser-companion/extension/'],'extension/');assert.ok(config.bundle.externalBin.includes('binaries/clipclipgo-native-host'));assert.equal(config.identifier,'com.clipclipgo.app');
});
test('sidecar bootstrap preserves parent configuration and matches Tauri debug/release profile',()=>{
 const env={TAURI_ENV_DEBUG:'false',TAURI_CONFIG:JSON.stringify({identifier:'com.clipclipgo.app',bundle:{externalBin:['original'],resources:{original:'original'},active:true}})};
 const options=hostBuildOptions(env,[]);assert.equal(options.release,true);assert.equal(hostBuildOptions(env,['--debug']).release,false);assert.equal(hostBuildOptions({},[]).release,false);assert.equal(hostBuildOptions({},['--release']).release,true);
 assert.equal(hostBuildOptions({TAURI_ENV_TARGET_TRIPLE:'x86_64-pc-windows-msvc'},[]).release,true);assert.equal(hostBuildOptions({TAURI_ENV_TARGET_TRIPLE:'x86_64-pc-windows-msvc',TAURI_ENV_DEBUG:'true'},[]).release,false);
 const config=JSON.parse(options.env.TAURI_CONFIG);assert.equal(config.identifier,'com.clipclipgo.app');assert.equal(config.bundle.active,true);assert.deepEqual(config.bundle.externalBin,[]);assert.deepEqual(config.bundle.resources,[]);assert.deepEqual(JSON.parse(env.TAURI_CONFIG).bundle.externalBin,['original']);
});
