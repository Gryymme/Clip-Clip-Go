import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('action label contrast records the approved base-color limitation and AA interaction states',async(t)=>{
 const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
 const luminance=hex=>hex.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
 for(const token of ['color-accent','color-action-hover','color-pressed']){
  const hex=css.match(new RegExp('--'+token+':\\s*(#[0-9a-f]{6})','i'))[1];
  const ratio=1.05/(luminance(hex)+0.05);
  if(token==='color-accent'){t.diagnostic(`Approved base blue/white contrast: ${ratio.toFixed(2)}:1; below 4.5:1 for normal text.`);assert.ok(ratio>=3,'base retains large-text contrast threshold');}
  else assert.ok(ratio>=4.5,`${token} white contrast`);
 }
});
