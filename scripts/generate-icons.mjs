// The SVG is the single master. Use the already-installed Tauri rasterizer;
// package PNG frames into a Windows multi-resolution ICO without extra libraries.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(resolve(root,'node_modules/@tauri-apps/cli/package.json'),'utf8'));
const cli=resolve(root,'node_modules/@tauri-apps/cli',typeof pkg.bin==='string'?pkg.bin:pkg.bin.tauri);
const sizes=[16,24,32,48,64,128,256,512];
const cache=resolve(root,'.engine-cache/branding/png');
const result=spawnSync(process.execPath,[cli,'icon','src-tauri/icons/app.svg','--output',cache,...sizes.flatMap(s=>['--png',String(s)])],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
if(result.status!==0)throw Error('Icon rasterization failed.');
await copyFile(resolve(cache,'512x512.png'),resolve(root,'src-tauri/icons/icon.png'));
const frames=await Promise.all(sizes.filter(s=>s<=256).map(async size=>({size,png:await readFile(resolve(cache,`${size}x${size}.png`))})));
const directory=Buffer.alloc(6+frames.length*16);directory.writeUInt16LE(1,2);directory.writeUInt16LE(frames.length,4);
let offset=directory.length;
for(const [i,{size,png}] of frames.entries()) {
  const p=6+i*16;
  directory[p]=directory[p+1]=size===256?0:size;
  directory.writeUInt16LE(1,p+4);directory.writeUInt16LE(32,p+6);
  directory.writeUInt32LE(png.length,p+8);directory.writeUInt32LE(offset,p+12);offset+=png.length;
}
await writeFile(resolve(root,'src-tauri/icons/icon.ico'),Buffer.concat([directory,...frames.map(f=>f.png)]));
const extension=resolve(root,'browser-companion/extension/icons');await mkdir(extension,{recursive:true});
for(const size of [16,24,32,48,64,128])await copyFile(resolve(cache,`${size}x${size}.png`),resolve(extension,`icon-${size}.png`));
console.log('Generated shared app/extension icons from src-tauri/icons/app.svg.');
