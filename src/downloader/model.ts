import type {BrowserCandidate} from '../companion/types';
import compatibility from '../../src-tauri/src/downloader/compatibility.json' with {type:'json'};
export const contract = compatibility;
export interface SourceFormat { id:string; ext:string; video:boolean; audio:boolean; uncertain:boolean; vcodec:string|null; acodec:string|null; width:number|null; height:number|null; fps:number|null; bitrate:number|null; size:number|null; approximateSize:boolean; sampleRate:number|null; channels:number|null }
export interface DownloadMedia {title:string; source:string; thumbnail:string|null; duration:number|null; formats:SourceFormat[]}
export interface DownloadSettings {mode:'video'|'audio'; format:string; videoSource:string; audioSource:string; resolution:number|null; fps:number|null; videoEncoder:string; quality:string; videoKbps:number|null; keepAudio:boolean; audioEncoder:string; audioKbps:number|null; sampleRate:number|null; channels:number|null}
export interface DownloadPlan {sources:string[]; videoSource:string|null; audioSource:string|null; videoEncoder:string|null; audioEncoder:string|null; copyVideo:boolean; copyAudio:boolean; conversion:boolean; merge:boolean; uncertain:boolean; summary:string}
export interface DownloadDiagnostic {stage:string; engine:string; exitCode:number|null; selectedIds:string[]; detail:string}
export interface DownloadJob {id:number; revision:number; stage:string; message:string; percent:number|null; bytes:number|null; total:number|null; speed:number|null; eta:number|null; stream:number|null; streams:number|null; progressKind?:string|null; diagnostics?:DownloadDiagnostic[]; browserSource?:BrowserCandidate|null; media:DownloadMedia|null; destination:string|null}
export interface Capabilities {encoders:string[]; ytDlp:string; deno:string; contract:typeof contract}
export const initialSettings:DownloadSettings={mode:'video',format:'mp4',videoSource:'best',audioSource:'auto',resolution:null,fps:null,videoEncoder:'auto',quality:'preserve',videoKbps:null,keepAudio:true,audioEncoder:'auto',audioKbps:null,sampleRate:null,channels:null};
export function defaultName(title:string){let value='';for(const char of title){if(value.length+char.length>100)break;value+=char;}return value;}
export function active(job:DownloadJob|null){return Boolean(job&&!['ready','succeeded','failed','cancelled'].includes(job.stage));}
export function mergeJob(old:DownloadJob|null,next:DownloadJob|null){return next&&(!old||next.id>old.id||next.id===old.id&&next.revision>=old.revision)?next:old;}
export function urlError(value:string):string|null{try{const u=new URL(value.trim());if(value.length>8192||/[\u0000-\u001f\u007f]/u.test(value)||!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();return null;}catch{return 'Enter one HTTP or HTTPS media URL without embedded credentials.';}}
export function bestVideo(media:DownloadMedia,s:DownloadSettings){return s.videoSource==='best'?[...media.formats].filter(f=>f.video).sort((a,b)=>(b.height??0)-(a.height??0)||(b.fps??0)-(a.fps??0)||(b.bitrate??0)-(a.bitrate??0))[0]:media.formats.find(f=>f.id===s.videoSource&&f.video);}
export function sourceChoices(media:DownloadMedia){
 const groups=new Map<string,SourceFormat>();
 for(const f of media.formats.filter(f=>f.video)){
  const key=`${f.height??'unknown'}:${f.fps??'unknown'}`;
  const previous=groups.get(key);if(!previous||(f.bitrate??0)>(previous.bitrate??0))groups.set(key,f);
 }
 return [...groups.values()].sort((a,b)=>(b.height??0)-(a.height??0)||(b.fps??0)-(a.fps??0));
}
export function sourceLabel(f:SourceFormat){return `${f.video?f.height?`${f.height}p`:'Video':'Audio only'}${f.fps?` · ${new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(f.fps)} fps`:''}${f.uncertain?' · audio unknown':f.video&&!f.audio?' · video only':''}`;}
export function bytes(value:number|null){if(value===null||!Number.isFinite(value))return 'Unknown size';if(value<1024)return `${value} B`;const unit=value<1024**2?'KiB':value<1024**3?'MiB':'GiB';const div=unit==='KiB'?1024:unit==='MiB'?1024**2:1024**3;return `${new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(value/div)} ${unit}`;}
export function formatRule(format:string){return contract.containers.find(c=>c.id===format);}
export function effectiveAudio(s:DownloadSettings,encoders:string[]){return s.audioEncoder==='auto'?formatRule(s.format)?.audio.find(e=>encoders.includes(e)):s.audioEncoder;}
export function lossy(encoder:string|undefined){return !['flac','pcm_s16le'].includes(encoder??'');}
export function bitrateError(encoder:string|undefined,n:number|null){if(n===null)return null;const range:Record<string,[number,number]>={aac:[16,512],libmp3lame:[8,320],libopus:[6,510],libvorbis:[45,500]};const bounds=range[encoder??''];return !bounds?'Bitrate does not apply to this audio codec.':!Number.isInteger(n)||n<bounds[0]||n>bounds[1]?`Choose ${bounds[0]}–${bounds[1]} kb/s.`:null;}
export function settingsError(s:DownloadSettings,media:DownloadMedia,encoders:string[]):string|null{
 const rule=formatRule(s.format);if(!rule||s.mode==='video'!==Boolean(rule.video.length))return 'Choose a format for the selected mode.';
 const v=bestVideo(media,s);if(s.mode==='video'&&!v)return 'No video source is available.';
 if(s.resolution!==null&&(!contract.resolutions.includes(s.resolution)||!v?.height||s.resolution>v.height))return 'Choose Same as source or a smaller resolution.';
 if(s.fps!==null&&!contract.frameRates.includes(s.fps))return 'Choose a supported frame rate.';
 if(s.videoEncoder!=='auto'&&(!rule.video.includes(s.videoEncoder)||!encoders.includes(s.videoEncoder)))return 'That video encoder is incompatible or unavailable.';
 if(s.quality==='bitrate'&&(!Number.isInteger(s.videoKbps)||s.videoKbps!<100||s.videoKbps!>100000))return 'Video bitrate must be 100–100000 kb/s.';
 if((s.mode==='audio'||s.keepAudio)&&s.audioEncoder!=='auto'&&(!rule.audio.includes(s.audioEncoder)||!encoders.includes(s.audioEncoder)))return 'That audio encoder is incompatible or unavailable.';
 if(s.mode==='audio'||s.keepAudio){const e=effectiveAudio(s,encoders);const err=bitrateError(e,s.audioKbps);if(err)return err;if(s.sampleRate!==null&&(!contract.sampleRates.includes(s.sampleRate)||e==='libopus'&&s.sampleRate!==48000||e==='libmp3lame'&&s.sampleRate>48000))return 'Choose a sample rate supported by the audio codec.';}
 return null;
}
