import {readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {inside,verifyHash} from './engine-tools.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse((await readFile(inside(root,'scripts/pdf-manifest.json'),'utf8')).replace(/^\uFEFF/,''));
const build=inside(root,'src-tauri/target/debug');
for(const [file,hash]of [['pdfium.dll',manifest.pdfium.dllSha256],['NotoSans-Regular.ttf',manifest.font.sha256]])await verifyHash(inside(build,'pdf',file),hash);
for(const [file,hash]of Object.entries(manifest.noticeFiles))await verifyHash(inside(build,'notices/pdf',file),hash);
for(const path of ['office','notices/libreoffice']){
 try{await lstat(inside(build,path));throw Error('Abandoned Office resource remains: '+path);}catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const path of ['notices/ffmpeg/NOTICE.md','notices/text/NOTICE.md'])await readFile(inside(build,path));
console.log(`Verified both PDF assets and all ${Object.keys(manifest.noticeFiles).length} PDF notices in the debug resource tree; retained core notices present and Office resources absent.`);
