import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement as h} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';

test('Downloader Save action and History switch render their real enabled/disabled states',async()=>{
 const server=await createServer({server:{middlewareMode:true},appType:'custom'});
 try{
  const {default:Downloader}=await server.ssrLoadModule('/src/downloader/Downloader.tsx');
  const {initialSettings,contract}=await server.ssrLoadModule('/src/downloader/model.ts');
  const noop=()=>{};
  const media={title:'2026 Annual Review — FINAL (revised after board approval) 王秀英',source:'Fixture',duration:null,thumbnail:null,formats:[{id:'combined',ext:'mp4',video:true,audio:true,uncertain:true}]};
  const base={inspection:{id:1,media},settings:initialSettings,capabilities:{encoders:contract.encoders.map(e=>e.id)},url:'',folder:null,name:'Review',plan:{summary:'Output: MP4',uncertain:true},change:noop,setUrl:noop,inspect:noop,start:noop,cancel:noop};
  const view=c=>render(h(Downloader,{controller:c,onBrowserSetup:noop}));
  const html=view(base);
  assert.ok(html.includes('Save dialog'));assert.doesNotMatch(html,/Choose folder|id="download-name"|id="download-filename"/);
  assert.match(html,/<button[^>]*class="button button-primary"(?![^>]*disabled)[^>]*>Download MP4<\/button>/);
  const long={...base,folder:'C:\\Projects\\Annual review\\Approved deliverables\\Regional planning committee\\Published media',name:'2026 Annual Review — FINAL (revised after board approval) 王秀英'};
  for(const format of ['mp4','mkv','opus']){
   const markup=view({...long,settings:{...initialSettings,format}});
   assert.ok(markup.includes(`${long.name}.${format}`));assert.ok(!markup.includes(`${long.name}.undefined`));
  }
  assert.match(view({...base,pending:true,busy:true}),/<button[^>]*disabled=""[^>]*>Preparing…<\/button>/);
  const {default:HistorySetting}=await server.ssrLoadModule('/src/history/HistorySetting.tsx');
  const {history}=await server.ssrLoadModule('/src/history/store.ts');
  for(const [enabled,loading]of [[true,false],[false,false],[true,true]]){
   history.getSnapshot=()=>({records:[],enabled,loading});
   const markup=render(h(HistorySetting));
   assert.match(markup,/<label class="history-switch"><input type="checkbox" role="switch"/);
   assert.equal(markup.includes('checked=""'),enabled);assert.equal(markup.includes('disabled=""'),loading);
   assert.ok(markup.includes('Save job history'));assert.ok(markup.includes('aria-hidden="true"'));
  }
 }finally{await server.close();}
});
