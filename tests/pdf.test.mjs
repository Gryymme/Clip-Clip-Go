import test from 'node:test';
import assert from 'node:assert/strict';
import {addImages,moveImage,pageRangeError} from '../src/converter/pdf.ts';
import {isDocumentRoute,outputFormats,normalizeExtension} from '../src/converter/formats.ts';
import {readFile} from 'node:fs/promises';
const image=n=>({name:`image-${n}.png`,path:`C:\\Images\\image-${n}.png`,sizeBytes:'1024'});
test('document matrix contains exactly the implemented text/PDF routes and aliases',()=>{
 const matrix={txt:['md','html','pdf'],md:['html','txt','pdf'],html:['md','txt','pdf'],pdf:['txt','md','html','png','jpg']};
 for(const [input,outputs]of Object.entries(matrix)){
  assert.deepEqual(outputFormats(input),outputs);
  for(const output of ['txt','md','html','pdf','png','jpg','docx','odt'])assert.equal(isDocumentRoute(input,output),outputs.includes(output));
 }
 assert.equal(normalizeExtension('MARKDOWN'),'md');assert.equal(normalizeExtension('HTM'),'html');
});
test('image pages add without losing order, reject excess/unsupported input and move deterministically',()=>{
 const a=image(1),b=image(2),c=image(3);
 assert.deepEqual(addImages([a,b],[a,c]),[a,b,c]);assert.deepEqual(moveImage([a,b,c],2,-1),[a,c,b]);assert.deepEqual(moveImage([a,b,c],0,1),[b,a,c]);
 assert.deepEqual(moveImage([a],0,-1),[a]);assert.deepEqual(moveImage([],0,1),[]);
 assert.throws(()=>addImages([], [{...a,name:'office.docx'}]),/still images/);
 assert.throws(()=>addImages(Array.from({length:100},(_,i)=>image(i)),[image(101)]),/100 images/);
 assert.deepEqual(addImages([a],[{...a,path:a.path.toUpperCase()}]),[a]);
});
test('page ranges accept all/overlapping ranges and reject out-of-range, reversed and malformed values',()=>{
 for(const value of ['','1','1-3, 5','3, 1-2, 2'])assert.equal(pageRangeError(value,5),null,value);
 for(const value of ['0','6','3-1','1-','1,,2','1.5','-1','1–3','9999999999999999999999'])assert.ok(pageRangeError(value,5),value);
});
test('resource config includes only retained components and pinned local PDF assets',async()=>{
 const json=async p=>JSON.parse((await readFile(new URL(p,import.meta.url),'utf8')).replace(/^\uFEFF/,''));
 const config=await json('../src-tauri/tauri.conf.json');const pkg=await json('../package.json');const manifest=await json('../scripts/pdf-manifest.json');
 assert.ok(config.bundle.resources['resources/pdf/']);assert.ok(config.bundle.resources['../third-party/pdf/']);
 assert.ok(!JSON.stringify(config).toLowerCase().includes('libreoffice'));assert.ok(!Object.keys(pkg.scripts).some(k=>k.includes('office')));assert.equal(pkg.scripts.tauri,'tauri');
 assert.match(manifest.pdfium.sha256,/^[a-f0-9]{64}$/);assert.equal(manifest.pdfium.v8,false);assert.equal(manifest.pdfium.xfa,false);assert.ok(!manifest.font.url.includes('/main/'));
});
