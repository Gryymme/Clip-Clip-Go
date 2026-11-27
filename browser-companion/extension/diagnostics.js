// Temporary, allowlisted evidence only. Never serialize a session/candidate/engine error.
import {grantedOrigin} from './site-access.js';
export const count=value=>Number.isFinite(value)?Math.max(0,Math.min(99999,Math.floor(value))):0;
export function pattern(value){
 if(value==='<all_urls>')return value;
 if(typeof value!=='string'||value.length>512||! /^(https?|\*):\/\/[\w.*:[\]-]+\/\*$/.test(value))return null;
 return value;
}
export function patterns(values){return Array.isArray(values)?values.map(pattern).filter(Boolean).slice(0,32):[];}
export function operation(value,now=Date.now()){
 if(!['request','remove','added','removed'].includes(value?.action)||!['started','true','false','threw','event','covered','not_covered','resumed','resume_failed','followup_failed'].includes(value?.result))return null;
 return {at:now,action:value.action,result:value.result,origins:patterns(value.origins).slice(0,4)};
}
export function journal(values,entry,now=Date.now()){
 const kept=(Array.isArray(values)?values:[]).filter(v=>v&&Number.isFinite(v.at)&&now-v.at>=0&&now-v.at<600000).map(v=>operation(v,v.at)).filter(Boolean);
 if(entry){const safe=operation(entry,now);if(safe)kept.push(safe);}return kept.slice(-20);
}
export function errorCode(error){const text=String(error?.message||'');return /permission|access.*host/i.test(text)?'host_access_denied':/frame|document|removed|closed/i.test(text)?'document_unavailable':/chrome:\/\/|restricted|cannot access/i.test(text)?'restricted_page':'execution_failed';}
const id=value=>typeof value==='string'&&/^[\w-]{0,128}$/.test(value)?value:'';
export function report({version,tab,session:s,grants,contains,manifest,operations,frames=[],permissionRead='ok',containsRead='ok',tabRead='ok'}){
 let origin=null;try{const url=new URL(tab?.url);if(/^https?:$/.test(url.protocol))origin=url.origin.length<=512?url.origin:null;}catch{}
 const counters={};for(const key of ['observedRequests','networkMedia','networkFiltered','staleNetwork','domMessages','pageMessages','blobMessages','duplicateCandidates','createdCandidates','rejectedCandidates','popupReads','popupCandidates','observerPings'])counters[key]=count(s?.[key]);
 const rejections={};for(const key of ['stale_sender','document_mismatch','page_or_frame_access','media_origin_access','unsupported_page','not_media_or_segment','network_identity'])rejections[key]=count(s?.rejectionReasons?.[key]);
 const result={version:typeof version==='string'&&version.length<=32&&/^\d+(\.\d+){1,3}$/.test(version)?version:'unknown',requiredHosts:patterns(manifest?.host_permissions),optionalHosts:patterns(manifest?.optional_host_permissions),grants:patterns(grants),grantCount:Array.isArray(grants)?grants.length:0,grantsTruncated:Array.isArray(grants)&&grants.length>32,
 permissionRead:permissionRead==='failed'?'failed':'ok',containsRead:containsRead==='failed'?'failed':'ok',tabRead:tabRead==='failed'?'failed':'ok',page:{tabId:count(tab?.id),origin,chromeContains:contains===true,coveringGrants:origin?patterns((Array.isArray(grants)?grants:[]).filter(p=>grantedOrigin(origin,[p]))):[],sessionExists:!!s,navigating:s?.navigating===true},
 frames:frames.slice(0,32).map(f=>({frameId:count(f.frameId),documentId:id(f.documentId),origin:pattern(f.origin),access:f.access===true,attempted:f.attempted===true,completed:f.completed===true,error:['host_access_denied','document_unavailable','restricted_page','execution_failed','frame_enumeration_failed'].includes(f.error)?f.error:null,heartbeatAgeMs:Number.isFinite(s?.scanHeartbeats?.[f.frameId])?Math.min(600000,Math.max(0,Date.now()-s.scanHeartbeats[f.frameId])):null,scan:s?.scans?.[f.frameId]?{reports:count(s.scans[f.frameId].reports),mediaElements:count(s.scans[f.frameId].mediaElements),resources:count(s.scans[f.frameId].resources)}:null})),
 frameCount:count(s?.enumeratedFrames),framesTruncated:count(s?.enumeratedFrames)>32,injectionErrors:count(s?.injectionErrors),missingOrigins:patterns((s?.missingOrigins||[]).map(o=>o+'/*')),candidates:count(s?.candidates?.length),rejectedCandidate:s?.rejectedCandidate===true,expiredCandidate:s?.expiredCandidate===true,counters,rejections,playback:{blob:s?.blob===true,mediaStream:s?.stream===true,protectedEvidence:s?.protected===true},operations:journal(operations)};
 for(const key of ['operations','frames','missingOrigins','grants','optionalHosts','requiredHosts'])while(JSON.stringify(result).length>48000&&result[key].length){result[key].pop();result.truncated=true;}
 return result;
}

export function reject(s,reason){s.rejectionReasons??={};s.rejectionReasons[reason]=count((s.rejectionReasons[reason]||0)+1);}
