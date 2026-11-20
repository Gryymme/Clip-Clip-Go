import {useEffect,useRef,useState,type ReactNode} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWebview} from '@tauri-apps/api/webview';
import Icon from '../components/Icon';
import {insideDrop,dropError} from './drop';
export function EmptySelectionCard({title,description,actions}:{title:string;description:string;actions:ReactNode}) {
 return <div className="file-summary file-empty"><div className="file-preview"><Icon name="document" /></div><div className="file-summary-content"><h3>{title}</h3><p className="field-help">{description}</p></div><div className="file-summary-actions">{actions}</div></div>;
}
export function DropSelection({children,multiple,locked,onDrop,onError}:{children:ReactNode;multiple:boolean;locked:boolean;onDrop:(paths:string[])=>Promise<void>;onError:(message:string)=>void}) {
 const ref=useRef<HTMLDivElement>(null),current=useRef({locked,onDrop,onError});current.current={locked,onDrop,onError};
 const [over,setOver]=useState(false);
 useEffect(()=>{
  if(!isTauri())return;
  let live=true,unlisten:(()=>void)|undefined;
  void getCurrentWebview().onDragDropEvent(({payload})=>{
   if(!live)return;
   if(payload.type==='leave'){setOver(false);return;}
   const rect=ref.current?.getBoundingClientRect();
   const hit=Boolean(rect&&insideDrop(payload.position,rect,window.devicePixelRatio));
   if(payload.type!=='drop'){setOver(hit&&!current.current.locked);return;}
   setOver(false);if(!hit)return;
   const error=dropError(payload.paths,multiple,current.current.locked);
   if(error)current.current.onError(error);else void current.current.onDrop(payload.paths);
  }).then(stop=>{if(live)unlisten=stop;else stop();}).catch(()=>{if(live)current.current.onError('Drag and drop is unavailable. Use the Choose button.');});
  return()=>{live=false;unlisten?.();};
 },[multiple]);
 useEffect(()=>{if(locked)setOver(false);},[locked]);
 return <div ref={ref} className="selection-drop" data-drag-over={over||undefined} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const types=Array.from(e.dataTransfer.types);if(!types.includes('Files')&&(types.includes('text/uri-list')||types.includes('text/plain')))current.current.onError('Drop supported local files, not URLs.');}}>{children}<span className="sr-only" role="status">{over?'Drop files here':''}</span></div>;
}
