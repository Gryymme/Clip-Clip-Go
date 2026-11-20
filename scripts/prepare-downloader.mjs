import {spawnSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {copyFile,lstat,mkdir,mkdtemp,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inside,sha256,sidecarName,peImports} from './engine-tools.mjs';
const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const manifest=JSON.parse(await readFile(inside(root,'scripts/downloader-manifest.json'),'utf8'));
const verify=process.argv.includes('--verify-only');
if(process.argv.slice(2).some(x=>x!=='--verify-only'))throw Error('Unknown preparation option');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Downloader preparation requires Windows x64.');
async function folder(p){const f=inside(root,p);await mkdir(f,{recursive:true});if((await lstat(f)).isSymbolicLink()||!(await realpath(f)).toLowerCase().startsWith(root.toLowerCase()+path.sep))throw Error('Unsafe generated directory');return f;}
const cache=await folder('.engine-cache/downloader'),bin=await folder('src-tauri/binaries');
async function valid(f,h){try{if((await lstat(f)).isSymbolicLink())throw Error('Refusing engine symlink: '+f);return await sha256(f)===h;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function download(url,file,hash){if(await valid(file,hash))return;if(verify)throw Error('Downloader assets missing/damaged. Run npm run downloader:prepare.');const part=file+'.incoming-'+process.pid;try{const r=await fetch(url,{signal:AbortSignal.timeout(300000)});if(!r.ok||!r.body)throw Error('Download failed: '+r.status);await pipeline(Readable.fromWeb(r.body),createWriteStream(part,{flags:'wx'}));if(!await valid(part,hash))throw Error('SHA-256 mismatch; refusing engine');await rename(part,file);}finally{await rm(part,{force:true});}}
const yt=inside(bin,sidecarName('yt-dlp',manifest.target)),deno=inside(bin,sidecarName('deno',manifest.target));
await download(manifest.ytDlp.url,yt,manifest.ytDlp.sha256);
if(!manifest.deno.sha256||!await valid(deno,manifest.deno.sha256)){
 const zip=inside(cache,'deno-'+manifest.deno.version+'.zip');await download(manifest.deno.url,zip,manifest.deno.archiveSha256);
 if(verify)throw Error('Prepared Deno missing');
 const stage=await mkdtemp(inside(cache,'extract-'));
 try{const ps=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const r=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',inside(root,'scripts/extract-downloader.ps1'),'-Archive',zip,'-Destination',stage],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);
 const exe=inside(stage,'deno.exe'),hash=await sha256(exe);if(manifest.deno.sha256&&hash!==manifest.deno.sha256)throw Error('Deno binary checksum mismatch');
 if(!manifest.deno.sha256)throw Error('Pin Deno binary SHA-256 before preparing: '+hash);
 await copyFile(exe,deno);
 }finally{inside(cache,path.relative(cache,stage));await rm(stage,{recursive:true,force:true});}
}
for(const [file,hash] of Object.entries(manifest.noticeFiles)){if(!await valid(inside(root,'third-party/downloader',file),hash))throw Error('Required notice changed: '+file);}
for(const [name,file,version]of [['yt-dlp',yt,manifest.ytDlp.version],['deno',deno,manifest.deno.version]]){await peImports(file);const args=name==='yt-dlp'?['--ignore-config','--no-plugin-dirs','--no-update','--version']:['--version'];const r=spawnSync(file,args,{windowsHide:true,encoding:'utf8',timeout:30000,env:{...process.env,TEMP:cache,TMP:cache,DENO_NO_UPDATE_CHECK:'1'}});if(r.status!==0||!r.stdout.includes(version))throw Error('Invalid '+name+' version');console.log(name+' '+version+' hash and x64 executable verified');}
await writeFile(inside(cache,'prepared.json'),JSON.stringify({ytDlp:manifest.ytDlp,deno:manifest.deno},null,2)+'\n');
