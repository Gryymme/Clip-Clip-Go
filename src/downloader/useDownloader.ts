import {useQueue, queue, submitDownload} from '../queue/session';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {nativeError} from '../converter/conversion';
import {selectDownloadOutput,type DownloadDestination} from './destination';
import {active,mergeJob,initialSettings,settingsError,urlError,contract,effectiveAudio,lossy,defaultName,type DownloadSettings,type DownloadJob,type DownloadMedia,type DownloadPlan,type Capabilities} from './model';

export function useDownloader(engineReady:boolean){
 const [url,setUrl]=useState(''),[job,setJob]=useState<DownloadJob|null>(null),[inspection,setInspection]=useState<{id:number;media:DownloadMedia}|null>(null);
 const [settings,setSettings]=useState(initialSettings),[capabilities,setCapabilities]=useState<Capabilities|null>(null),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false),[folder,setFolder]=useState<string|null>(null),[name,setName]=useState('media'),[plan,setPlan]=useState<DownloadPlan|null>(null),[planning,setPlanning]=useState(false),[planError,setPlanError]=useState<string|null>(null);
 const lock=useRef(false),initial=useRef<Promise<DownloadJob|null>|null>(null),capRequest=useRef<Promise<Capabilities>|null>(null),revision=useRef(0);
 const [plannedKey,setPlannedKey]=useState<string|null>(null);
 const planKey=inspection?JSON.stringify([inspection.id,settings]):null;
 const visiblePlan=planKey===plannedKey?plan:null;
 const busy=pending||active(job);
 const [submittedId,setSubmittedId]=useState<string>();
 const entries=useQueue(), lastEntry=entries.find(e=>e.id===submittedId)??[...entries].reverse().find(e=>e.type==='Downloader');
 const queueBusy=entries.some(e=>['running','cancelling'].includes(e.status));
 const otherBusy=false;
 const outputEntry=entries.find(e=>e.download&&['running','cancelling'].includes(e.status))??[...entries].reverse().find(e=>e.download);
 const outputJob=outputEntry?.status==='cancelling'&&outputEntry.download?{...outputEntry.download,stage:'cancelling',message:'Cancelling and cleaning up…',percent:null}:outputEntry?.download;
 const visibleJob=active(job)?job:outputJob??job;
 useEffect(()=>{let live=true;initial.current??=invoke<DownloadJob|null>('download_status');initial.current.then(j=>{if(live)setJob(old=>mergeJob(old,j));}).catch(()=>{});return()=>{live=false;};},[]);
 useEffect(()=>{if(!engineReady)return;let live=true;capRequest.current??=invoke<Capabilities>('download_capabilities');capRequest.current.then(c=>{if(live){if(JSON.stringify(c.contract)!==JSON.stringify(contract)){// Object key ordering differs across the IPC serializer; compare canonical data.
 const canonical=(x:unknown):string=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
 if(canonical(c.contract)!==canonical(contract)){setError('Downloader settings do not match this app version. Repair ClipClipGO.');return;}}
 setCapabilities(c);}}).catch(cause=>{if(live)setError(nativeError(cause));});return()=>{live=false;};},[engineReady]);
 useEffect(()=>{if(!active(job))return;let live=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const next=await invoke<DownloadJob|null>('download_status');if(live){setJob(old=>mergeJob(old,next));setError(null);}}catch(cause){if(live)setError(nativeError(cause));}if(live)timer=setTimeout(poll,350);}void poll();return()=>{live=false;clearTimeout(timer);};},[job?.id,active(job)]);
 useEffect(()=>{const source=job?.browserSource;if(!source||active(job))return;let live=true;const timer=setTimeout(()=>{if(!live)return;setInspection(null);setPlan(null);setError('Browser source expired. Detect and send it again.');setJob(old=>old?.browserSource?.id===source.id?{...old,browserSource:null}:old);void invoke<DownloadJob|null>('download_status').then(next=>{if(live)setJob(old=>mergeJob(old,next));}).catch(()=>{});},Math.max(0,source.expiresAt-Date.now()));return()=>{live=false;clearTimeout(timer);};},[job?.id,job?.stage,job?.browserSource?.expiresAt]);
 useEffect(()=>{if(job?.stage==='ready'&&job.media){setInspection({id:job.id,media:job.media});setName(defaultName(job.media.title));setSettings({...initialSettings,mode:job.media.formats.some(f=>f.video)?'video':'audio',format:job.media.formats.some(f=>f.video)?'mp4':'mp3',keepAudio:job.media.formats.some(f=>f.audio||f.uncertain)});}},[job?.id,job?.stage]);
 const localError=inspection&&capabilities?settingsError(settings,inspection.media,capabilities.encoders):null;
 useEffect(()=>{const current=++revision.current;setPlan(null);setPlanError(null);if(!inspection||!capabilities||localError||busy)return;setPlanning(true);let live=true;const timer=setTimeout(()=>{invoke<DownloadPlan>('plan_download',{inspectionId:inspection.id,settings}).then(p=>{if(live&&current===revision.current){setPlan(p);setPlannedKey(planKey);}}).catch(cause=>{if(live&&current===revision.current)setPlanError(nativeError(cause));}).finally(()=>{if(live&&current===revision.current)setPlanning(false);});},120);return()=>{live=false;clearTimeout(timer);};},[inspection,settings,capabilities,localError,busy]);
 async function inspect(){if(lock.current||busy||otherBusy||!capabilities)return;const invalid=urlError(url);if(invalid){setError(invalid);return;}lock.current=true;setPending(true);setError(null);setInspection(null);setPlan(null);try{const next=await invoke<DownloadJob>('inspect_download',{url:url.trim()});setJob(old=>mergeJob(old,next));}catch(cause){setError(nativeError(cause));}finally{lock.current=false;setPending(false);}}
 async function inspectBrowser(id:string){if(lock.current||busy||otherBusy||!capabilities)return;lock.current=true;setPending(true);setError(null);setInspection(null);setPlan(null);try{const next=await invoke<DownloadJob>('inspect_browser_download',{id});setJob(old=>mergeJob(old,next));}catch(cause){setError(nativeError(cause));}finally{lock.current=false;setPending(false);}}
 function change(patch:Partial<DownloadSettings>){if(busy)return;setSettings(s=>{
  let next={...s,...patch};
  if(patch.mode&&patch.mode!==s.mode)next={...initialSettings,mode:patch.mode,format:patch.mode==='video'?'mp4':'mp3',videoSource:s.videoSource,keepAudio:s.keepAudio};
  if(patch.format){next={...next,videoEncoder:'auto',audioEncoder:'auto',audioKbps:null,sampleRate:null,channels:null};}
  if(patch.keepAudio===false)next={...next,audioEncoder:'auto',audioKbps:null,sampleRate:null,channels:null};
  if(patch.videoSource!==undefined)next={...next,resolution:null,fps:null};
  if(patch.quality&&patch.quality!=='bitrate')next.videoKbps=null;
  const e=effectiveAudio(next,capabilities?.encoders??[]);if(!lossy(e))next.audioKbps=null;
  if(e==='libopus'&&(patch.format||patch.audioEncoder))next.sampleRate=48000;
  return next;
 });}
 async function start(){
  if(lock.current||busy||!inspection||!visiblePlan||localError)return;
  const input={inspectionId:inspection.id,settings,title:inspection.media.title,source:inspection.media.source,name};
  lock.current=true;setPending(true);setError(null);
  try{
   const selected=await selectDownloadOutput(input,(suggested,format)=>invoke<DownloadDestination|null>('choose_download_folder',{suggested,format}));
   if(!selected)return;
   setFolder(selected.folder);setName(selected.name);
   setSubmittedId(await submitDownload(selected.inspectionId,selected.settings,selected.name,selected.title,selected.source));
  }catch(cause){setError(nativeError(cause));}finally{lock.current=false;setPending(false);}
 }
 async function cancel(){
  if(active(job)){try{await invoke('cancel_download',{id:job!.id});}catch(cause){setError(nativeError(cause));}}
  else if(outputEntry)queue.cancel(outputEntry.id);
 }
 return {inspectionError:job?.stage==='failed'?job.message:null,browserSource:job?.browserSource,queueBusy,lastEntry,url,setUrl,job:visibleJob,inspection,settings,change,capabilities,error,pending,busy,otherBusy,folder,name,plan:visiblePlan,planning,planError:localError??planError,inspect,inspectBrowser,start,cancel};
}
export type DownloaderController=ReturnType<typeof useDownloader>;
