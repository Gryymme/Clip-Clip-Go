// Extension-only validation/package refresh. No native build, registry or browser actions.
import {readdir,readFile,mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source=fileURLToPath(new URL('./extension/',import.meta.url));
const destination=fileURLToPath(new URL('../src-tauri/target/debug/extension/',import.meta.url));
const check=process.argv.includes('--check');
if(process.argv.slice(2).some(arg=>arg!=='--check'))throw Error('Only --check is supported.');
const files=[];
async function walk(relative=''){
 for(const entry of await readdir(path.join(source,relative),{withFileTypes:true})){
  const name=path.join(relative,entry.name);if(entry.isSymbolicLink())throw Error('Extension assets must be regular files.');
  if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name);
 }
}
await walk();
const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));
const popup=await readFile(path.join(source,manifest.action.default_popup),'utf8');
for(const file of files){
 const full=path.join(source,file);
 if(file.endsWith('.js')){
  execFileSync(process.execPath,['--check',full],{stdio:'pipe',windowsHide:true});
  const script=await readFile(full,'utf8');
  for(const match of script.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g))await readFile(path.resolve(path.dirname(full),match[1]));
 }
}
for(const match of popup.matchAll(/(?:src|href)="(\.\/)?([^"#:]+)"/g))await readFile(path.join(source,match[2]));
for(const file of [manifest.background.service_worker,...Object.values(manifest.icons),'fonts/OFL.txt'])await readFile(path.join(source,file));
if(!check){
 for(const file of files){const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(source,file),target);}
 for(const file of files)if(!(await readFile(path.join(source,file))).equals(await readFile(path.join(destination,file))))throw Error('Packaged extension differs from source.');
}
console.log(`Extension ${manifest.version}: ${files.length} assets validated${check?'':` and copied to ${destination}`}.`);
