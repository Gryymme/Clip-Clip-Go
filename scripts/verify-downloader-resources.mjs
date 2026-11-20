import {readFile,lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {sha256,peImports} from './engine-tools.mjs';
const manifest=JSON.parse(await readFile('scripts/downloader-manifest.json','utf8'));
const folder=path.resolve('src-tauri/target/debug');
for(const[name,key]of [['yt-dlp','ytDlp'],['deno','deno']]){
 const file=path.join(folder,name+'.exe');
 if((await lstat(file)).isSymbolicLink()||await sha256(file)!==manifest[key].sha256)throw Error('Missing/damaged packaged '+name);
 const args=name==='yt-dlp'?['--ignore-config','--no-plugin-dirs','--no-update','--version']:['--version'];
 const r=spawnSync(file,args,{cwd:folder,env:{...process.env,PATH:'',TEMP:path.resolve('.engine-cache/tmp'),TMP:path.resolve('.engine-cache/tmp'),DENO_NO_UPDATE_CHECK:'1'},encoding:'utf8',windowsHide:true,timeout:30000});
 if(r.status!==0||!r.stdout.includes(manifest[key].version))throw Error('Packaged engine failed without PATH: '+name);
 console.log(`${name} ${manifest[key].version}: packaged path and SHA-256 verified; ran with empty PATH; ${(await peImports(file)).length} Windows system DLL imports`);
}
for(const[name,hash]of Object.entries(manifest.noticeFiles))if(await sha256(path.join(folder,'notices/downloader',name))!==hash)throw Error('Packaged notice mismatch: '+name);
console.log(`${Object.keys(manifest.noticeFiles).length} packaged Downloader notices/provenance files verified.`);
