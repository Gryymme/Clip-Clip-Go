// Developer/build preparation only; the application never downloads assets.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, lstat, copyFile, rename, rm, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, requireTarget, sha256, peImports } from './engine-tools.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse((await readFile(inside(root,'scripts/pdf-manifest.json'),'utf8')).replace(/^\uFEFF/,''));
const host=spawnSync('rustc',['--print','host-tuple'],{encoding:'utf8',windowsHide:true});
requireTarget(process.env.TAURI_ENV_TARGET_TRIPLE??process.env.CARGO_BUILD_TARGET??host.stdout?.trim());
if(process.platform!=='win32'||process.arch!=='x64')throw Error('PDF preparation requires Windows x64.');
const cache=inside(root,'.engine-cache/pdf-setup');const output=inside(root,'src-tauri/resources/pdf');
for(const dir of [cache,output]){await mkdir(dir,{recursive:true});if((await lstat(dir)).isSymbolicLink())throw Error('Refusing symlink: '+dir);}
for(const file of await readdir(output))if(!['pdfium.dll','NotoSans-Regular.ttf'].includes(file))throw Error('Unexpected PDF resource; remove or review it before bundling: '+file);
async function valid(file,hash){try{if((await lstat(file)).isSymbolicLink())throw Error('Refusing symlink.');return await sha256(file)===hash;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function asset(file,url,hash){
 try{await lstat(file);}catch(e){if(e.code!=='ENOENT')throw e;const temp=file+`.download-${process.pid}`;try{const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok||!r.body)throw Error('Asset download failed: '+r.status);await pipeline(Readable.fromWeb(r.body),createWriteStream(temp,{flags:'wx'}));if(!await valid(temp,hash))throw Error('Asset SHA-256 mismatch; extraction refused.');await rename(temp,file);}finally{await rm(temp,{force:true});}}
 if(!await valid(file,hash))throw Error('Cached asset checksum mismatch: '+file);
}
for(const [file,hash]of Object.entries(manifest.noticeFiles))if(!await valid(inside(root,'third-party/pdf',file),hash))throw Error('Required PDF notice changed/missing: '+file);
const dll=inside(output,'pdfium.dll');
if(!await valid(dll,manifest.pdfium.dllSha256)){
 const archive=inside(cache,'pdfium-win-x64.tgz');await asset(archive,manifest.pdfium.url,manifest.pdfium.sha256);
 const stage=inside(cache,`extract-${process.pid}`);await mkdir(stage);
 try{const result=spawnSync(path.join(process.env.SystemRoot??'C:\\Windows','System32/tar.exe'),['-xzf',archive,'-C',stage,'bin/pdfium.dll'],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw Error('PDFium extraction failed: '+result.stderr);const binary=inside(stage,'bin/pdfium.dll');if(!await valid(binary,manifest.pdfium.dllSha256))throw Error('PDFium DLL checksum mismatch.');await copyFile(binary,dll);}finally{await rm(stage,{recursive:true,force:true});}
}
const font=inside(cache,'NotoSans-Regular.ttf');await asset(font,manifest.font.url,manifest.font.sha256);
const fontOutput=inside(output,'NotoSans-Regular.ttf');if(!await valid(fontOutput,manifest.font.sha256))await copyFile(font,fontOutput);
const imports=await peImports(dll);if(imports.some(x=>!['ADVAPI32.dll','GDI32.dll','KERNEL32.dll','USER32.dll'].includes(x)))throw Error('Unexpected PDFium DLL dependencies: '+imports);
console.log('Verified application-local PDFium 158.0.8125.0 (no V8/XFA), Noto Sans and required notices. No download at runtime.');
