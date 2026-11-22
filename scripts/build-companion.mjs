import {spawn} from 'node:child_process';
import {copyFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function hostBuildOptions(env,argv){
 const release=argv.includes('--release')||!argv.includes('--debug')&&(env.TAURI_ENV_DEBUG==='false'||Boolean(env.TAURI_ENV_TARGET_TRIPLE)&&env.TAURI_ENV_DEBUG!=='true');
 // Bootstrap this same-package host without requiring its own already-built sidecar.
 const config=JSON.parse(env.TAURI_CONFIG||'{}');config.bundle={...config.bundle,externalBin:[],resources:[]};
 return {release,env:{...env,TAURI_CONFIG:JSON.stringify(config)}};
}
export async function build(env=process.env,argv=process.argv.slice(2)){
 const options=hostBuildOptions(env,argv),args=['build','--manifest-path','src-tauri/Cargo.toml','--bin','clipclipgo-native-host'];
 if(options.release)args.push('--release');
 await new Promise((resolve,reject)=>{const child=spawn('cargo',args,{env:options.env,shell:false,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Native-host compilation failed.')));});
 await mkdir('src-tauri/binaries',{recursive:true});await copyFile(`src-tauri/target/${options.release?'release':'debug'}/clipclipgo-native-host.exe`,'src-tauri/binaries/clipclipgo-native-host-x86_64-pc-windows-msvc.exe');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){try{await build();}catch(e){console.error(e.message);process.exitCode=1;}}
