import {filterHistory} from './model';
import {useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {QueueView} from '../queue/JobList';
import type {Entry} from '../queue/scheduler';
import {history,useHistory} from './store';
export default function History(){
 const state=useHistory(),[query,setQuery]=useState(''),[task,setTask]=useState(''),[status,setStatus]=useState(''),[confirm,setConfirm]=useState(false),[error,setError]=useState('');
 const records=filterHistory(state.records,query,task,status);
 const entries:Entry[]=records.map(r=>({id:r.id,type:r.task,title:r.title,source:r.source,destination:r.output??'',status:r.status,stage:r.failure??(r.status==='completed'?'Output saved and validated.':r.status==='cancelled'?'Cancelled.':'Failed.'),percent:null,startedAt:r.startedAt,finishedAt:r.finishedAt,summary:r.summary,thumbnail:r.task==='Images to PDF'||r.task==='Merge PDF'?undefined:{category:r.category,state:{status:'idle',path:''}}}));
 const support=<>
 <div className="history-filters"><label>Search<input className="text-input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Title or filename"/></label><label>Task<select value={task} onChange={e=>setTask(e.target.value)}><option value="">All tasks</option>{['Converter','Images to PDF','Merge PDF','Downloader'].map(t=><option key={t}>{t}</option>)}</select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['completed','failed','cancelled'].map(t=><option key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</option>)}</select></label></div>
 {state.error&&<div className="selection-error" role="alert">{state.error}<button className="button button-secondary" onClick={()=>void history.change({action:'load'})}>Retry</button></div>}
 {!state.enabled&&<p className="field-help">Saving job history is off in Settings. Existing records are retained.</p>}
 {confirm&&<section className="workflow-section" role="alertdialog" aria-label="Clear history"><p>Clear all saved job records? Output files remain untouched.</p><div className="queue-actions"><button autoFocus className="button button-secondary" onClick={()=>setConfirm(false)}>Keep history</button><button className="button button-secondary button-destructive" onClick={()=>{setConfirm(false);void history.change({action:'clear'});}}>Clear history</button></div></section>}
 </>;
 return <QueueView support={support} canClear={state.records.length>0} resetKey={`${query}-${task}-${status}`} emptyTitle={state.loading?'Loading History…':state.error&&!state.records.length?'History unavailable':state.records.length?'No matching saved jobs':'No saved jobs yet'} historyMode entries={entries} cancel={()=>{}} move={()=>{}} remove={id=>void history.change({action:'remove',id})} clear={()=>setConfirm(true)} actionError={error} open={(entry,folder)=>{setError('');void invoke('history_open',{id:entry.id,folder}).catch(()=>setError('The saved output has been moved, removed, or cannot be opened. Its historical status is unchanged.'));}}/>
}
