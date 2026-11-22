import test from 'node:test';
import assert from 'node:assert/strict';
import {gifDimensions,defaultGifOptions} from '../src/converter/gif.ts';
import {initialSelection,selectionReducer} from '../src/converter/selection.ts';
import {isCompatible,outputHelp} from '../src/converter/formats.ts';

test('GIF dimensions fit oriented display geometry, retain aspect and avoid enlargement',()=>{
  assert.deepEqual(defaultGifOptions,{maxEdge:480,fps:10});
  for(const [source,expected] of [
    [{width:1920,height:1080},{width:480,height:270}],
    [{width:1080,height:1920},{width:270,height:480}],
    [{width:80,height:45},{width:80,height:45}],
    [{width:16384,height:1},{width:480,height:1}],
  ]) assert.deepEqual(gifDimensions(source,defaultGifOptions),expected);
  for(const source of [null,{width:0,height:10},{width:NaN,height:1},{width:10,height:Infinity}]) assert.equal(gifDimensions(source,defaultGifOptions),null);
  assert.equal(gifDimensions({width:1920,height:1080},{maxEdge:480,fps:60}),null);
});

test('GIF is video-only and stays selected through compatible replacements and job locks',()=>{
  const choose=(state,name)=>selectionReducer(selectionReducer(state,{type:'start'}),{type:'selected',file:{name,path:`C:\\Media\\${name}`,sizeBytes:'1024'}});
  let state=choose(initialSelection,'source.mp4');
  state=selectionReducer(state,{type:'output',format:'gif'});
  assert.equal(state.output,'gif');
  const locked=selectionReducer(state,{type:'lock',locked:true});
  assert.equal(selectionReducer(locked,{type:'output',format:'mp4'}),locked);
  assert.equal(choose(state,'source.mov').output,'gif');
  assert.equal(choose(state,'source.mp3').output,'mp3');
  assert.equal(isCompatible('png','gif'),false);assert.equal(isCompatible('mp3','gif'),false);
  assert.match(outputHelp('mp4','gif'),/Loops continuously/);assert.match(outputHelp('mp4','gif'),/no audio/);assert.match(outputHelp('mp4','gif'),/large files/);
});
