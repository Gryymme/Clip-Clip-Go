import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCandidates} from '../browser-companion/extension/popup-view.js';
test('candidate presentation retains native radio/label semantics and pointer selection',()=>{
 const make=tag=>({tag,children:[],events:{},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.events[name]=fn;},setAttribute(){},focus(){this.focused=true;},click(){this.checked=true;this.events.change?.();}});
 const root=make('div'),doc={createElement:make};let selected=null;
 renderCandidates(root,[{id:'one',mediaType:'direct',mediaUrl:'https://cdn.test/a.mp4',title:'First'},{id:'two',mediaType:'direct',mediaUrl:'https://cdn.test/b.mp4',title:'Second'}],'one',id=>selected=id,doc);
 const [a,b]=root.children,radio=b.children[0];assert.equal(radio.type,'radio');assert.equal(radio.name,a.children[0].name);assert.equal(b.children[2].htmlFor,radio.id);assert.equal(a.children[0].checked,true);assert.equal(radio.className,'candidate-radio');
 b.events.click({target:{closest:()=>null}});assert.equal(selected,'two');assert.equal(radio.focused,true);radio.events.change();assert.equal(selected,'two');
});
