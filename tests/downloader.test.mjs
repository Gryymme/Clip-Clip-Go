import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {contract,initialSettings,sourceChoices,bestVideo,settingsError,bitrateError,urlError,active,mergeJob,sourceLabel,bytes} from '../src/downloader/model.ts';
const f=(id,height,fps,extra={})=>({id,ext:'mp4',video:true,audio:false,uncertain:false,vcodec:'h264',acodec:null,width:height*16/9,height,fps,bitrate:1000,size:null,approximateSize:true,sampleRate:null,channels:null,...extra});
const media={title:'Fixture',source:'Local',thumbnail:null,duration:null,formats:[f('1080-30',1080,30),f('1080-60',1080,60),f('duplicate',1080,60,{bitrate:1200}),f('720',720,30),f('audio',null,null,{video:false,audio:true,acodec:'aac'})]};
const encoders=contract.encoders.map(e=>e.id);
test('source choices group duplicate resolutions while preserving distinct frame rates',()=>{
 assert.equal(sourceChoices(media).length,3);assert.equal(sourceChoices(media)[0].id,'duplicate');assert.equal(bestVideo(media,initialSettings).id,'duplicate');assert.equal(bestVideo(media,{...initialSettings,videoSource:'720'}).height,720);assert.match(sourceLabel(media.formats[0]),/video only/);assert.match(sourceLabel({...media.formats[0],uncertain:true}),/audio unknown/);
});
test('frontend consumes the exact authoritative native contract',async()=>{
 assert.deepEqual(contract,JSON.parse(await readFile('src-tauri/src/downloader/compatibility.json','utf8')));
 assert.deepEqual(contract.containers.map(x=>x.id),['mp4','mkv','webm','mp3','m4a','wav','flac','ogg','opus']);
 for(const c of contract.containers)for(const id of [...c.audio,...c.video])assert.ok(encoders.includes(id));
 assert.match(await readFile('src-tauri/src/downloader/plan.rs','utf8'),/include_str!\("compatibility.json"\)/);
});
test('settings reject upscaling, unsupported encoders, invalid bitrate and sample rate',()=>{
 assert.equal(settingsError(initialSettings,media,encoders),null);
 for(const patch of [{resolution:2160},{fps:120},{videoEncoder:'shell'},{format:'webm',videoEncoder:'libx264'},{quality:'bitrate',videoKbps:0},{quality:'bitrate',videoKbps:NaN},{audioKbps:513},{sampleRate:12345}])assert.ok(settingsError({...initialSettings,...patch},media,encoders),JSON.stringify(patch));
 assert.equal(settingsError({...initialSettings,resolution:720,fps:60},media,encoders),null);
 for(const [codec,n,valid]of [['aac',16,true],['aac',15,false],['libmp3lame',320,true],['libmp3lame',320.5,false],['libopus',511,false],['flac',128,false],['pcm_s16le',128,false]])assert.equal(!bitrateError(codec,n),valid);
});
test('one-item URL validation and stale response protection',()=>{
 for(const value of ['file:///C:/input.mp4','https://user:pass@example.test/item','ftp://example.test/file','https://example.test/\n','x'.repeat(8193)])assert.ok(urlError(value));
 assert.equal(urlError('https://example.test/watch?v=one&list=ignored'),null);
 for(const url of ['https://www.youtube.com/watch?v=AbCdEfGhI12&t=37s&list=PL_example&index=3','https://youtu.be/AbCdEfGhI12?si=share-value&t=37#chapter'])assert.equal(urlError(url),null);
 const done={id:2,revision:9,stage:'succeeded'};assert.equal(mergeJob(done,{id:2,revision:3,stage:'downloading'}),done);assert.equal(mergeJob(done,{id:1,revision:100,stage:'inspecting'}),done);assert.equal(mergeJob(done,null),done);
 for(const stage of ['inspecting','downloading','merging','converting','finalizing','cancelling'])assert.equal(active({stage}),true);for(const stage of ['ready','succeeded','failed','cancelled'])assert.equal(active({stage}),false);
 assert.equal(bytes(null),'Unknown size');assert.equal(bytes(NaN),'Unknown size');assert.equal(bytes(0),'0 B');
});
test('pinned Downloader hashes agree with official publisher checksums and packaged resources',async()=>{
 const m=JSON.parse(await readFile('scripts/downloader-manifest.json','utf8'));
 assert.ok(!m.ytDlp.url.includes('latest'));assert.ok(!m.deno.url.includes('latest'));
 for(const hash of [m.ytDlp.sha256,m.deno.sha256,m.deno.archiveSha256])assert.match(hash,/^[a-f0-9]{64}$/);
 assert.ok((await readFile('third-party/downloader/yt-dlp-SHA2-256SUMS.txt','utf8')).includes(m.ytDlp.sha256+'  yt-dlp.exe'));
 assert.ok((await readFile('third-party/downloader/deno-SHA256SUM.txt','utf8')).toLowerCase().includes(m.deno.archiveSha256));
 const {createHash}=await import('node:crypto');for(const[name,hash]of Object.entries(m.noticeFiles)){assert.equal(createHash('sha256').update(await readFile('third-party/downloader/'+name)).digest('hex'),hash,name);}
 const config=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));assert.ok(config.bundle.resources['../third-party/downloader/']);
 assert.equal(m.ytDlp.size+m.deno.size,121657312);
});
