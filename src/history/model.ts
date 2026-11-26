import type {Entry,TaskType} from '../queue/scheduler.ts';
export interface HistoryRecord {id:string;task:TaskType;title:string;status:'completed'|'failed'|'cancelled';startedAt:number;finishedAt:number;summary:string;source:string;output:string|null;failure:string|null;category:'image'|'audio'|'video'|'document'}
export function clean(value:string){return /https?:|data:|token|signature|authorization|cookie|password|secret|referer|[?=]/i.test(value)?'[redacted]':value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,300);}
export function recordFrom(entry:Entry):HistoryRecord|null {
 if(!entry.attemptId||!entry.startedAt||!entry.finishedAt||!['completed','failed','cancelled'].includes(entry.status))return null;
 const error=entry.error??'';
 const failure=entry.status!=='failed'?null:/destination|output|filename/i.test(error)?'Output unavailable or already exists. Choose a new destination.':/expir|network|http|site/i.test(error)?'Media unavailable or expired. Inspect it again.':/input|source|missing/i.test(error)?'Input unavailable. Select or inspect the source again.':'The job failed. Check the source, output settings and destination.';
 return {id:entry.attemptId,task:entry.type,title:clean(entry.title),status:entry.status as HistoryRecord['status'],startedAt:entry.startedAt,finishedAt:entry.finishedAt,
 summary:clean(entry.summary??entry.conversion?.format.toUpperCase()??'Configured output'),source:clean(entry.type==='Downloader'?entry.sourceHost??'Online media':entry.source.split(/\r?\n/).map(p=>p.split(/[\\/]/).pop()).join(', ')),
 output:entry.status==='completed'?entry.destination:null,failure,category:entry.thumbnail?.category??'document'};
}

export function filterHistory(records:HistoryRecord[],query:string,task:string,status:string){return records.filter(r=>(!task||r.task===task)&&(!status||r.status===status)&&`${r.title} ${r.output??''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));}
