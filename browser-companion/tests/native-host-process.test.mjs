// Actual host executable/stdio tests; no Chrome, desktop UI or registry writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdir,mkdtemp,copyFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const ID='abcdefghijklmnopabcdefghijklmnop',HOST='com.clipclipgo.companion';
await mkdir('.engine-cache',{recursive:true});const root=await mkdtemp(path.join(process.cwd(),'.engine-cache/native-host-test-'));
const host=path.join(root,'clipclipgo-native-host.exe'),app=path.join(root,'clip-clip-go.exe');
// Exercise the exact staged sidecar used for distribution, which may be linked separately
// from Cargo's additional debug binary during the subsequent desktop build.
await copyFile('src-tauri/binaries/clipclipgo-native-host-x86_64-pc-windows-msvc.exe',host);await writeFile(app,'MZ nonexecuted app-path fixture');
await writeFile(path.join(root,'host-config.json'),JSON.stringify({owner:HOST,version:1,extensionId:ID,desktopPath:app,hostSha256:createHash('sha256').update(await readFile(host)).digest('hex')}));
await writeFile(path.join(root,HOST+'.json'),JSON.stringify({name:HOST,description:'Isolated native-host protocol test',path:host,type:'stdio',allowed_origins:[`chrome-extension://${ID}/`]}));
function frame(value){const bytes=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);}
async function run(args,input){return new Promise((resolve,reject)=>{const child=spawn(host,args,{cwd:root,env:{...process.env,PATH:''},shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});const out=[],err=[];const timer=setTimeout(()=>{child.kill();reject(Error('Native host timeout'));},10000);child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,out:Buffer.concat(out),error:Buffer.concat(err).toString()});});child.stdin.on('error',()=>{});for(let i=0;i<input.length;i+=3)child.stdin.write(input.subarray(i,i+3));child.stdin.end();});}
function replies(buffer){const out=[];while(buffer.length){assert.ok(buffer.length>=4);const n=buffer.readUInt32LE();assert.ok(n<=48*1024&&buffer.length>=n+4);out.push(JSON.parse(buffer.subarray(4,n+4)));buffer=buffer.subarray(n+4);}return out;}
test('real native host frames multiple requests, version rejection, and app-closed acknowledgement',async()=>{
 const r=await run([`chrome-extension://${ID}/`,'--parent-window=0'],Buffer.concat([frame({v:1,type:'hello',requestId:'one'}),frame({v:2,type:'hello',requestId:'two'})]));assert.equal(r.code,0,r.error);const a=replies(r.out);assert.equal(a.length,2);assert.equal(a[0].code,'app_not_running');assert.equal(a[1].code,'rejected');assert.equal(a[1].requestId,'two');
});
test('real host rejects sender, unknown fields and oversized frames with no nonprotocol stdout',async()=>{
 for(const [args,input] of [
  [['https://example.test/'],frame({v:1,type:'hello',requestId:'one'})],
  [[`chrome-extension://${'p'.repeat(32)}/`],frame({v:1,type:'hello',requestId:'one'})],
  [[`chrome-extension://${ID}/`],frame({v:1,type:'hello',requestId:'one',command:'not-allowed'})],
  [[`chrome-extension://${ID}/`],Buffer.from([255,255,255,127])],
 ]){const r=await run(args,input);assert.equal(r.code,1);assert.equal(r.out.length,0);assert.ok(!r.error.includes('not-allowed'));}
});
