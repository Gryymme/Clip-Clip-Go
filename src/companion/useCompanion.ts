import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {nativeError} from '../converter/conversion';
import {initialCompanion,extensionIdError,type CompanionStatus,type CompanionAction} from './types';
export function useCompanion(){
 const [status,setStatus]=useState(initialCompanion),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
 const lock=useRef(false);
 useEffect(()=>{let live=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const s=await invoke<CompanionStatus>('companion_status');if(live)setStatus(s);}catch{if(live)setStatus(s=>({...s,phase:'unavailable',message:'Browser bridge unavailable. Restart ClipClipGO or repair setup.'}));}if(live)timer=setTimeout(poll,2000);}void poll();return()=>{live=false;clearTimeout(timer);};},[]);
 async function setup(browser:string){if(lock.current)return;lock.current=true;setPending(true);setError(null);try{setStatus(await invoke<CompanionStatus>('setup_browser_companion',{browser}));}catch(e){setError(nativeError(e));}finally{lock.current=false;setPending(false);}}
 async function connect(extensionId:string){const invalid=extensionIdError(extensionId);if(invalid){setError(invalid);return;}if(lock.current)return;lock.current=true;setPending(true);setError(null);try{setStatus(await invoke<CompanionStatus>('connect_browser_companion',{extensionId:extensionId.trim()}));}catch(e){setError(nativeError(e));}finally{lock.current=false;setPending(false);}}
 async function action(action:CompanionAction){setError(null);try{await invoke('browser_companion_action',{action});return true;}catch(e){setError(nativeError(e));return false;}}
 async function remove(){if(lock.current)return;lock.current=true;setPending(true);setError(null);try{await invoke('remove_browser_bridge');setStatus(s=>({...s,phase:'id-needed',extensionId:null,bridgePresent:false,candidate:null,message:'Desktop bridge removed. The browser extension can be removed in Chrome.'}));}catch(e){setError(nativeError(e));}finally{lock.current=false;setPending(false);}}
 async function dismiss(id:string){try{await invoke('dismiss_browser_source',{id});setStatus(s=>s.candidate?.id===id?{...s,candidate:null}:s);}catch(e){setError(nativeError(e));}}
 return {status,error,pending,setup,connect,action,remove,dismiss};
}
export type CompanionController=ReturnType<typeof useCompanion>;
