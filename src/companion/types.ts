export interface BrowserCandidate {id:string;pageUrl:string;frameUrl:string;mediaUrl:string;extractorPageUrl?:string;mediaType:'direct'|'hls'|'dash'|'page';title:string|null;width:number|null;height:number|null;drm?:boolean|null;frameId:number;documentId:string;navigationId:string;observedAt:number;expiresAt:number;context:{referer:string|null}}
export interface CompanionStatus {phase:'id-needed'|'development'|'unknown'|'ready'|'waiting'|'connected'|'unavailable';message:string;candidate:BrowserCandidate|null;published:boolean;browserChoice:{recommended:string|null;browsers:string[];explanation:string};extensionId:string|null;bridgePresent?:boolean;extensionFolder?:{path:string;source:'installation'|'development'}|null}
export type CompanionAction='openExtensions'|'openFolder'|'copyAddress'|'copyFolder';
export function extensionIdError(value:string){return /^[a-p]{32}$/.test(value.trim())?null:'Enter the 32 lowercase letters (a–p) shown as the extension ID in Chrome.';}
export const initialCompanion:CompanionStatus={phase:'unknown',message:'Checking browser companion…',candidate:null,published:false,browserChoice:{recommended:null,browsers:[],explanation:''},extensionId:null};
export function sourceHost(url:string){try{return new URL(url).host;}catch{return 'Unknown source';}}
export function candidateLink(value:string){
 if(value.length>8192||/[\u0000-\u0020\u007f]/u.test(value))return null;
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
 return {value,compact:url.host};}catch{return null;}
}
export function receivedBrowserSource(pending:BrowserCandidate|null|undefined,current:BrowserCandidate|null|undefined){return pending??current??null;}
