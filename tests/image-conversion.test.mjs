import test from 'node:test';
import assert from 'node:assert/strict';
import { imageOutputHelp, isImageFile, isImageFormat, isEngineFormat, jobIsBusy, mergeJob } from '../src/converter/conversion.ts';
import { outputGroups, outputHelp, normalizeExtension, outputFormats } from '../src/converter/formats.ts';
import { initialSelection, selectionReducer } from '../src/converter/selection.ts';

test('image formats are distinct from media engines and document plans', () => {
  for (const format of ['jpg','png','webp','bmp','tiff']) {
    assert.equal(isImageFormat(format),true); assert.equal(isEngineFormat(format),false);
    assert.deepEqual(outputGroups(format),[{label:'Image',formats:outputFormats(format)}]);
    assert.ok(!outputHelp(format,'png').includes('planned'));
  }
  for (const format of ['pdf','txt','mp4','mp3','']) assert.equal(isImageFormat(format),false);
  for (const category of ['document','video','audio']) assert.equal(isImageFile({category}),false);
  assert.equal(isImageFile({category:'image'}),true);
  assert.equal(normalizeExtension('JPEG'),'jpg');assert.equal(normalizeExtension('TIF'),'tiff');
});
test('white compositing is explained for JPEG and alpha-preserving routes stay distinct', () => {
  const info={width:2,height:3,format:'png',hasAlpha:true,orientationApplied:false};
  assert.match(imageOutputHelp(info,'jpg'),/composited onto white/);
  assert.match(imageOutputHelp(info,'jpg'),/quality 90/);
  for(const format of ['png','webp','bmp','tiff']) assert.match(imageOutputHelp(info,format),/Transparency is preserved/);
  assert.doesNotMatch(imageOutputHelp({...info,hasAlpha:false},'jpg'),/Transparent areas/);
  assert.match(imageOutputHelp(null,'png'),/decode successfully/);
});
test('image selection and job state use the same lock and navigation-safe snapshots', () => {
  let state=selectionReducer(initialSelection,{type:'start'});
  state=selectionReducer(state,{type:'selected',file:{name:'camera.TIF',path:'C:\\Images\\camera.TIF',sizeBytes:'100'}});
  state=selectionReducer(state,{type:'output',format:'webp'});
  assert.equal(state.output,'webp');assert.equal(state.file.format,'tiff');
  state=selectionReducer(state,{type:'lock',locked:true});
  for(const action of [{type:'remove'},{type:'output',format:'jpg'},{type:'start'}]) assert.equal(selectionReducer(state,action),state);
  const running={id:3,revision:1,phase:'running',format:'webp',percent:null,seconds:0};
  assert.equal(jobIsBusy(running),true);assert.equal(mergeJob(running,null),running);
  const completed={...running,revision:2,phase:'succeeded'};
  assert.equal(mergeJob(completed,running),completed);assert.equal(jobIsBusy(completed),false);
});
