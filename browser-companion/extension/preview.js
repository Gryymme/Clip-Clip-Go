import {safeSnapshot} from './model.js';
// Popup-only, credential-free bounded assets. No site player or remote preview service.
export function safeAsset(value){if(typeof value!=='string'||value.length>8192||/[\u0000-\u0020\u007f]/.test(value))return null;try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}}
export function wireCandidate(c){const {posterUrl,previewUrl,snapshotUrl,domObserved,...wire}=c;return wire;}
export async function boundedAsset(url,kind,signal,fetcher=fetch){
 if(kind!=='image'||!safeAsset(url))throw Error('Unavailable');const cap=256*1024;
 const r=await fetcher(url,{signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:'image/*'}});
 const type=r.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||'';
 if(!r.ok||!r.body||!/^image\/(jpeg|png|webp|avif|gif)$/.test(type)){await r.body?.cancel();throw Error('Unavailable');}
 if(Number(r.headers.get('content-length'))>cap){await r.body.cancel();throw Error('Unavailable');}
 const reader=r.body.getReader(),chunks=[];let bytes=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>cap)throw Error('Unavailable');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return new Blob(chunks,{type});
}
export function createCandidateAssets(doc=document,api=chrome){
 const cleanups=[];let closed=false;const allowed=async url=>api.permissions.contains({origins:[new URL(url).origin+'/*']});
 let images=0;const queue=[];
 const next=()=>{if(images>=2||!queue.length)return;images++;void queue.shift()().catch(()=>{}).finally(()=>{images--;next();});};
 function attach(host,c){if(closed)return;
  let disposed=false,objectUrl=null;const abort=new AbortController(),nodes=new Set();
  const snapshot=safeSnapshot(c.snapshotUrl);
  const show=(src,onError)=>{if(closed||disposed)return;const img=doc.createElement('img');img.alt='';img.src=src;nodes.add(img);img.addEventListener('error',()=>{img.remove();nodes.delete(img);onError?.();},{once:true});host.append(img);};
  const fallback=()=>{if(snapshot)show(snapshot);};
  const poster=safeAsset(c.posterUrl);let observer;
  if(!poster)fallback();else{
   const load=async()=>{if(disposed||closed)return;const timer=setTimeout(()=>abort.abort(),2500);try{if(!await allowed(poster)){fallback();return;}if(disposed||closed)return;const blob=await boundedAsset(poster,'image',abort.signal);if(disposed||closed)return;objectUrl=URL.createObjectURL(blob);show(objectUrl,fallback);}catch{fallback();}finally{clearTimeout(timer);}};
   observer=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();queue.push(load);next();}}):null;
   if(observer)observer.observe(host);else{queue.push(load);next();}
  }
  cleanups.push(()=>{disposed=true;abort.abort();observer?.disconnect();for(const img of nodes){img.removeAttribute?.('src');img.remove();}nodes.clear();if(objectUrl)URL.revokeObjectURL(objectUrl);});
 }

 return {attach,dispose(){closed=true;queue.length=0;for(const clean of cleanups)clean();cleanups.length=0;}};
}
