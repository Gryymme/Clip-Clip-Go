import {createServer} from 'vite';
import {createElement as h} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {readFile,readdir,access} from 'node:fs/promises';
import assert from 'node:assert/strict';

const readme=await readFile('README.md','utf8');
const references=[...readme.matchAll(/!\[[^\]]*\]\(<([^>]+)>\)/g)].map(m=>decodeURIComponent(m[1]));
const screenshots=await readdir('demo-images');
assert.equal(references.length,screenshots.length);
assert.equal(new Set(references).size,references.length);
for(const path of references){assert.ok(path.startsWith('demo-images/'));await access(path);}
for(const name of screenshots)assert.ok(references.includes(`demo-images/${name}`));

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {JobStatus,ConversionActions}=await server.ssrLoadModule('/src/converter/ConversionControls.tsx');
 const {DownloadStatus,default:Downloader}=await server.ssrLoadModule('/src/downloader/Downloader.tsx');
 const {QueueView,QueueNotice}=await server.ssrLoadModule('/src/queue/Queue.tsx');
 const {initialSettings}=await server.ssrLoadModule('/src/downloader/model.ts');
 const noop=()=>{};
 const entry={id:'session-1',type:'Converter',title:'Fixture job',source:'source.wav',destination:'output.mp3',status:'completed',stage:'Finished',percent:null};
 for(const [phase,status] of [['succeeded','completed'],['failed','failed'],['cancelled','cancelled']]){
  const lastEntry={...entry,status,error:status==='failed'?'Queued fixture failure':undefined,download:status==='failed'?{diagnostics:[{stage:'merging',engine:'FFmpeg',exitCode:42,selectedIds:[],detail:'Useful queued diagnostic'}]}:undefined};
  assert.equal(render(h(JobStatus,{controller:{job:{phase,format:'mp3',message:'Old result'},lastEntry}})), '');
  assert.equal(render(h(DownloadStatus,{controller:{job:{stage:phase,message:'Old result'}}})), '');
  assert.equal(render(h(QueueNotice,{entry:lastEntry})), '');
  const queue=render(h(QueueView,{entries:[lastEntry],cancel:noop,move:noop,remove:noop,clear:noop,open:noop}));
  assert.match(queue,new RegExp(status==='failed'?'Queued fixture failure':status==='completed'?'Completed':'Cancelled'));
  if(status==='failed'){assert.match(queue,/Technical diagnostics/);assert.match(queue,/Useful queued diagnostic/);}
  if(status==='completed')assert.match(queue,/Open output/);
 }
 const conversion=render(h(JobStatus,{controller:{job:{phase:'running',format:'mp3',message:'Encoding fixture',percent:25,seconds:1,inputPath:'source.wav'},cancel:noop}}));
 assert.match(conversion,/Encoding fixture/);assert.match(conversion,/Cancel conversion/);assert.match(conversion,/<progress/);
 const download=render(h(DownloadStatus,{controller:{job:{stage:'downloading',message:'Transferring fixture',percent:null,bytes:null,total:null,speed:null},cancel:noop}}));
 assert.match(download,/Transferring fixture/);assert.match(download,/<progress/);assert.match(download,/>Cancel</);
 const validation=render(h(ConversionActions,{file:null,controller:{canConvert:false,error:'Selection validation fixture',probeError:'Input inspection fixture',job:null}}));
 assert.match(validation,/Selection validation fixture/);assert.match(validation,/Input inspection fixture/);
 const inspection=render(h(Downloader,{controller:{settings:initialSettings,url:'',inspection:null,job:null,error:'URL validation fixture',inspectionError:'Link inspection fixture',inspect:noop}}));
 assert.match(inspection,/URL validation fixture/);assert.match(inspection,/Link inspection fixture/);
 console.log(`${references.length} unique README images resolve; terminal results remain in Queue, active progress and inline errors remain on feature pages (SSR).`);
} finally {await server.close();}
