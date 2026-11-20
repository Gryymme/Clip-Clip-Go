import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSize,unitFactor,displayDimension,changeUnit,changeDpi,editDimension,sizePayload,sizeError} from '../src/converter/pageSize.ts';
import {insideDrop,dropError} from '../src/converter/drop.ts';
import {appendDroppedImages} from '../src/converter/pdf.ts';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('custom units use correct physical conversions and repeated switches never drift',()=>{
 near(unitFactor('in',96),72);near(unitFactor('cm',96),72/2.54);near(unitFactor('px',96),.75);
 let s=editDimension(initialSize,'width','8.5');near(s.width,612);
 for(let i=0;i<500;i++)for(const unit of ['cm','px','in'])s=changeUnit(s,unit);
 assert.equal(s.width,612);assert.equal(displayDimension(s.width,'px',96),'816');
 s=changeDpi(changeUnit(s,'px'),'300');assert.equal(s.width,612);assert.equal(displayDimension(s.width,'px',300),'2550');
 near(editDimension(changeUnit(initialSize,'cm'),'width','21.59').width,612);
 near(editDimension(changeUnit(initialSize,'px'),'width','816').width,612);
 assert.deepEqual(sizePayload('custom',s),{custom:{width:612,height:initialSize.height}});
 for(const preset of ['a4','letter','legal','image'])assert.equal(sizePayload(preset,s),preset);
});
test('custom dimensions validate finite bounds, DPI, positive area inside margins and incomplete input',()=>{
 for(const n of [0,-1,NaN,Infinity,71,14401])assert.ok(sizeError({...initialSize,width:n}));
 assert.match(sizeError({...initialSize,width:72}),/margins/);
 for(const dpi of ['','0','-2','Infinity','2401'])assert.ok(sizeError({...initialSize,unit:'px',dpi}));
 assert.equal(sizeError({...initialSize,unit:'px',dpi:'96'}),null);
 assert.equal(sizeError({...initialSize,width:14400,height:73}),null);
 assert.throws(()=>sizePayload('custom',editDimension(initialSize,'height','')),/finite/);
});
test('drop coordinates account for display scaling and select only the container under the pointer',()=>{
 const a={left:10,right:100,top:20,bottom:100},b={left:110,right:200,top:20,bottom:100};
 assert.equal(insideDrop({x:100,y:80},a,2),true);assert.equal(insideDrop({x:100,y:80},b,2),false);
 assert.equal(insideDrop({x:200,y:80},a,2),false);assert.equal(insideDrop({x:10,y:10},a,0),false);
 assert.match(dropError(['a','b'],false,false),/Choose one/);assert.match(dropError(['a'],false,true),/current operation/);assert.match(dropError([],false,false),/URLs/);assert.equal(dropError(['a','b'],true,false),null);
});
test('dropped images append in delivered order, deduplicate, report rejected/overflow files and obey active-job locks',()=>{
 const f=n=>({name:`${n}.png`,path:`C:/${n}.png`,sizeBytes:'1'}),a=f(1),b=f(2);
 assert.deepEqual(appendDroppedImages([a],[b,a]).files,[a,b]);
 const mixed=appendDroppedImages([a],[{...b,name:'file.docx'},b]);assert.deepEqual(mixed.files,[a,b]);assert.equal(mixed.rejected.length,1);
 const full=appendDroppedImages(Array.from({length:99},(_,i)=>f(i)),[f(100),f(101)]);assert.equal(full.files.length,100);assert.equal(full.rejected.length,1);
 assert.deepEqual(appendDroppedImages([a],[b],true).files,[a]);
});
