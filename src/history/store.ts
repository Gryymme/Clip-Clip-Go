import {invoke,isTauri} from '@tauri-apps/api/core';
import {useSyncExternalStore} from 'react';
import type {HistoryRecord} from './model';
export interface HistoryState {records:HistoryRecord[];enabled:boolean;loading:boolean;error?:string}
export class HistoryStore {
 private state:HistoryState={records:[],enabled:true,loading:true};
 private listeners=new Set<()=>void>(); private tail=Promise.resolve();
 private transport:(change:unknown)=>Promise<{records:HistoryRecord[];enabled:boolean}>;
 constructor(transport:(change:unknown)=>Promise<{records:HistoryRecord[];enabled:boolean}>){this.transport=transport;}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
 getSnapshot=()=>this.state;
 drain=()=>this.tail;
 change(change:unknown){
  this.tail=this.tail.then(async()=>{try{const saved=await this.transport(change);this.state={records:saved.records,enabled:saved.enabled,loading:false};}
   catch{this.state={...this.state,loading:false,error:'History is unavailable. Check app-data permissions/disk space or repair history-v1.json, then Retry. Unreadable files are preserved.'};}
   this.listeners.forEach(fn=>fn());});return this.tail;
 }
}
export const history=new HistoryStore(change=>invoke('history_change',{change}));
if(isTauri())void history.change({action:'load'});
export const useHistory=()=>useSyncExternalStore(history.subscribe,history.getSnapshot,history.getSnapshot);
