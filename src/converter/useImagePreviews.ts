import {useEffect,useRef,useState} from 'react';
import {previewRequests,type PreviewState} from './preview';
import {generatePreview,cancelPreview} from './native';
import type {NativeFile} from './selection';
// Serial work, retained above navigation; prune only removed selections.
export function useImagePreviews(files:NativeFile[],paused:boolean) {
 const cache=useRef<Record<string,PreviewState>>({});
 const [states,setStates]=useState<Record<string,PreviewState>>({});
 useEffect(()=>{
  const paths=new Set(files.map(f=>f.path));
  cache.current=Object.fromEntries(Object.entries(cache.current).filter(([p])=>paths.has(p)));
  setStates({...cache.current});
  if(paused)return;
  let live=true;const requests=previewRequests(generatePreview,cancelPreview);
  async function run(){for(const file of files){
   if(!live)return;if(cache.current[file.path])continue;
   await new Promise<void>(resolve=>{requests.start(file.path,state=>{
    if(!live)return;
    if(state.status==='ready'||state.status==='fallback'){cache.current[file.path]=state;resolve();}
    setStates(previous=>({...previous,[file.path]:state}));
   });});
  }}
  void run();return()=>{live=false;requests.stop();};
 },[files,paused]);
 return {states,fail:(path:string)=>{const state:PreviewState={status:'fallback',path};cache.current[path]=state;setStates(previous=>({...previous,[path]:state}));}};
}
