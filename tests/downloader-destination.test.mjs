import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDownloadOutput} from '../src/downloader/destination.ts';
import {initialSettings,defaultName} from '../src/downloader/model.ts';

const input=()=>({inspectionId:42,settings:{...initialSettings},title:'Film: final / approved?',source:'fixture',name:defaultName('Film: final / approved?')});
test('Save cancellation preserves the current media/settings and produces no submission',async()=>{
 const current=input(),before=structuredClone(current);
 const result=await selectDownloadOutput(current,async(name,format)=>{
  assert.equal(name,current.name);assert.equal(format,'mp4');return null;
 });
 assert.equal(result,null);assert.deepEqual(current,before);
});
test('Save result uses the chosen name/location and snapshots settings before the dialog',async()=>{
 const current=input();let resolve;
 const pending=selectDownloadOutput(current,()=>new Promise(r=>{resolve=r;}));
 current.settings.format='mkv';current.inspectionId=99;current.title='Later media';
 resolve({folder:'C:\\Users\\User\\Downloads',name:'Chosen film'});
 const selected=await pending;
 assert.equal(selected.settings.format,'mp4');assert.equal(selected.inspectionId,42);assert.equal(selected.title,'Film: final / approved?');assert.equal(selected.name,'Chosen film');assert.equal(selected.folder,'C:\\Users\\User\\Downloads');
 // A subsequent Save uses the new format with the previous chosen basename.
 const next=await selectDownloadOutput({...current,name:selected.name},async(name,format)=>{
  assert.equal(name,'Chosen film');assert.equal(format,'mkv');return {folder:selected.folder,name};
 });
 assert.equal(next.settings.format,'mkv');assert.equal(selected.settings.format,'mp4');
});
test('Save failure remains actionable and does not mutate the current configuration',async()=>{
 const current=input(),before=structuredClone(current);
 await assert.rejects(selectDownloadOutput(current,async()=>{throw Error('Existing output is protected');}),/protected/);
 assert.deepEqual(current,before);
});
