import test from 'node:test';
import assert from 'node:assert/strict';
import {trackNavigationHighlight} from '../src/components/navigationHighlight.ts';
test('highlight starts in place, follows measured group/scroll geometry, retargets and respects reduced motion',()=>{
 const saved={ResizeObserver:globalThis.ResizeObserver,MutationObserver:globalThis.MutationObserver,matchMedia:globalThis.matchMedia};let resize,mutation,reduced=false,disconnected=0,cancelled=0;
 globalThis.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){disconnected++;}};
 globalThis.MutationObserver=class{constructor(fn){mutation=fn;}observe(){}disconnect(){disconnected++;}};
 globalThis.matchMedia=()=>({matches:reduced});
 let target={top:30,left:12,width:180,height:46};const item={getBoundingClientRect:()=>target},animations=[];
 const nav={scrollTop:20,getBoundingClientRect:()=>({top:10,left:0}),querySelector:()=>item,querySelectorAll:()=>[item]};
 const bar={style:{},getBoundingClientRect:()=>({left:12,top:30,width:180,height:46}),getAnimations:()=>[{cancel(){cancelled++;}}],animate:(frames,options)=>animations.push({frames,options})};
 try{const stop=trackNavigationHighlight(nav,bar);assert.equal(bar.style.top,'40px');assert.equal(animations.length,0);
  target={top:250,left:12,width:180,height:72};mutation();assert.equal(bar.style.top,'260px');assert.equal(bar.style.height,'72px');assert.equal(animations.length,1);
  target={top:120,left:12,width:180,height:46};mutation();assert.equal(bar.style.top,'130px');assert.equal(animations.length,2);assert.ok(cancelled>=3);
  nav.scrollTop=80;target.top=60;resize();assert.equal(bar.style.top,'130px');assert.equal(animations.length,2);
  reduced=true;target.top=200;mutation();assert.equal(bar.style.top,'270px');assert.equal(animations.length,2);stop();assert.equal(disconnected,2);
 }finally{Object.assign(globalThis,saved);}
});
