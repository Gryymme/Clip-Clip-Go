import test from 'node:test';
import assert from 'node:assert/strict';
import {executeNative} from '../src/queue/runner.ts';
import {Scheduler} from '../src/queue/scheduler.ts';
const job=(phase,revision=0)=>({id:7,revision,phase,message:phase,percent:40,destination:'C:\\fixture.flac'});
const wait=()=>new Promise(r=>setImmediate(r));

test('native adapter never restarts a job after polling errors, missing or stale snapshots',async()=>{
 let starts=0,polls=0;const seen=[];
 const statuses=[Error('IPC unavailable'),null,{...job('running',1),id:99},job('running',0),job('verifying',2),job('succeeded',3)];
 await executeNative({start:async()=>{starts++;return job('running',1);},status:async()=>{polls++;const next=statuses.shift();if(next instanceof Error)throw next;return next;},cancel:async()=>assert.fail('unexpected cancel'),wait},new AbortController().signal,p=>seen.push(p));
 assert.equal(starts,1);assert.equal(polls,6);assert.ok(seen.some(p=>p.stage.includes('still owns')));assert.ok(seen.some(p=>p.stage==='verifying'&&p.percent===null));assert.ok(seen.filter(p=>p.conversion).every(p=>p.conversion.id===7));
});
test('cancel during start handshake cancels the returned native ID and waits for terminal cleanup',async()=>{
 const abort=new AbortController(),seen=[],cancelled=[];let polls=0;
 await assert.rejects(()=>executeNative({start:async()=>{abort.abort();return job('running');},status:async()=>job(++polls===1?'cancelling':'cancelled',polls),cancel:async id=>{cancelled.push(id);},wait},abort.signal,p=>seen.push(p)),/Cancelled/);
 assert.deepEqual(cancelled,[7]);assert.equal(polls,2);assert.equal(seen.at(-1).conversion.phase,'cancelled');
});
test('transient cancel IPC failure retries without releasing the scheduler slot',async()=>{
 const q=new Scheduler(),abortSeen=[];let attempts=0,polls=0,nextStarted=false;
 const meta={type:'Converter',title:'Fixture',source:'source.wav',destination:'out.flac'};
 const id=q.submit(meta,{run:(signal,update)=>executeNative({start:async()=>job('running'),status:async()=>job(++polls>2?'cancelled':'running',polls),cancel:async()=>{attempts++;if(attempts===1)throw Error('IPC');abortSeen.push('cancel');},wait},signal,update)});
 q.submit({...meta,type:'Merge PDF'},{run:async()=>{assert.equal(polls,3);nextStarted=true;}});q.cancel(id);
 for(let i=0;i<50&&!nextStarted;i++)await wait();assert.equal(nextStarted,true);assert.equal(attempts,2);assert.deepEqual(abortSeen,['cancel']);assert.equal(q.getSnapshot()[0].status,'cancelled');
});
test('native start failure and native terminal failure both hand off to the next task',async()=>{
 const q=new Scheduler();let next=false;const meta={type:'Downloader',title:'Fixture',source:'Fixture site',destination:'out.mp4'};
 q.submit(meta,{run:(signal,update)=>executeNative({start:async()=>{throw 'Queued source expired. Inspect it again.';},status:async()=>assert.fail(),cancel:async()=>assert.fail(),wait},signal,update)});
 q.submit(meta,{run:(signal,update)=>executeNative({start:async()=>({...job('failed'),message:'Destination already exists.'}),status:async()=>assert.fail(),cancel:async()=>assert.fail(),wait},signal,update)});
 q.submit({...meta,type:'Converter'},{run:async()=>{next=true;}});
 for(let i=0;i<50&&!next;i++)await wait();assert.equal(next,true);assert.deepEqual(q.getSnapshot().slice(0,2).map(e=>e.status),['failed','failed']);
});
test('native download source percentages reset across streams and finalize indeterminately',async()=>{
 const seen=[],stages=[{stream:2,percent:0,stage:'downloading'},{stream:2,percent:100,stage:'finalizing'},{stream:2,percent:null,stage:'succeeded'}];let revision=0;
 const base={id:7,revision:0,stage:'downloading',message:'Downloading',percent:100,stream:1,streams:2,destination:null};
 await executeNative({start:async()=>base,status:async()=>({...base,...stages.shift(),revision:++revision}),cancel:async()=>{},wait},new AbortController().signal,p=>seen.push(p));
 assert.deepEqual(seen.map(p=>p.percent),[100,0,null,null]);assert.deepEqual(seen.slice(0,2).map(p=>p.download.stream),[1,2]);
});
