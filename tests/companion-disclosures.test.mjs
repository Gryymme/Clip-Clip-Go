import test from 'node:test';
import assert from 'node:assert/strict';
import {disclosure} from '../browser-companion/extension/disclosures.js';
test('disclosures cancel/retarget rapid toggles, hide controls immediately on closing, and leave no collapsed space',async()=>{
 const original=globalThis.matchMedia;let reduced=false,focused=false;globalThis.matchMedia=()=>({matches:reduced});
 const runs=[],attributes={},button={setAttribute:(k,v)=>attributes[k]=v,addEventListener(){},removeEventListener(){},focus:()=>focused=true};
 const panel={hidden:false,inert:false,style:{},scrollHeight:80,getBoundingClientRect:()=>({height:30}),contains:()=>true,ownerDocument:{activeElement:{}},animate(frames){let resolve,reject;const finished=new Promise((a,b)=>{resolve=a;reject=b;});const run={finished,frames,resolve,cancel(){reject(Error('cancelled'));}};runs.push(run);return run;}};
 try{const c=disclosure(button,panel,{labels:true});assert.equal(panel.hidden,true);assert.equal(attributes['aria-expanded'],'false');
  c.set(true);assert.equal(button.textContent,'See less');assert.equal(panel.inert,true);c.set(false);assert.equal(panel.inert,true);assert.equal(focused,true);c.set(true);runs.at(-1).resolve();await Promise.resolve();assert.equal(panel.hidden,false);assert.equal(panel.inert,false);assert.equal(panel.style.height,'');
  c.set(false);runs.at(-1).resolve();await Promise.resolve();assert.equal(panel.hidden,true);assert.equal(panel.style.height,'');assert.equal(button.textContent,'Learn more');
  reduced=true;const count=runs.length;c.set(true);assert.equal(runs.length,count);assert.equal(panel.hidden,false);c.dispose();
 }finally{globalThis.matchMedia=original;}
});
