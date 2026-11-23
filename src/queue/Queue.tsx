import type {Entry as QueueEntry} from './scheduler';
import {Thumbnail} from '../converter/FileSummary';
import Icon from '../components/Icon';
import {displayPath, displayPathText} from '../pathDisplay';
import {useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {queue, useQueue} from './session';
import {finished, type Entry, type Status} from './scheduler';
import {bytes} from '../downloader/model';

function JobThumbnail({entry}:{entry:QueueEntry}) {
  const [failed,setFailed]=useState(false);
  if(entry.thumbnail) return <Thumbnail file={{category:entry.thumbnail.category}} state={failed?{status:'fallback',path:''}:entry.thumbnail.state} onError={()=>setFailed(true)}/>;
  return <figure className="file-preview" aria-label={entry.type+' file'}><Icon name={entry.type==='Images to PDF'?'images':entry.type==='Downloader'?'video':'document'}/></figure>;
}
const labels: Record<Status, string> = {waiting:'Waiting', running:'Running', cancelling:'Cancelling', completed:'Completed', failed:'Failed', cancelled:'Cancelled'};
export function QueueNotice({entry}:{entry:Entry}) {
  if (finished(entry.status)) return null;
  return <p className="field-help queue-notice" role="status">{entry.type} · {entry.title} · {labels[entry.status]}. {entry.status === 'waiting' ? 'Added to Queue. You can keep configuring tasks.' : 'See Queue for session results and actions.'}</p>;
}
export interface QueueViewProps {
  entries: readonly Entry[];
  cancel:(id:string)=>void; move:(id:string, direction:-1|1)=>void; remove:(id:string)=>void; clear:()=>void; open?:(entry:Entry, folder:boolean)=>void; actionError?:string;
}
// Data-only boundary also supports isolated adversarial SSR fixtures; no demo jobs enter the app.
export function QueueView({entries, cancel, move, remove, clear, open, actionError}:QueueViewProps) {
  const [page, setPage] = useState(0);
  const pageSize = 40, pages = Math.max(1, Math.ceil(entries.length / pageSize)), currentPage = Math.min(page, pages - 1);
  const waiting = entries.filter(e => e.status === 'waiting');
  const running = entries.filter(e => ['running','cancelling'].includes(e.status)).length;
  return <div className="session-queue">
    <div className="section-heading-row"><h2>Session jobs</h2><button className="button button-secondary" type="button" disabled={!entries.some(e => finished(e.status))} onClick={clear}>Clear finished</button></div>
    <p className="field-help numeric-value" role="status">{running.toLocaleString()} processing · {waiting.length.toLocaleString()} waiting · {entries.filter(e => finished(e.status)).length.toLocaleString()} finished</p>
    {actionError && <p className="selection-error" role="alert">{actionError}</p>}
    {!entries.length ? <div className="empty-image-list"><h2>No jobs in this session</h2><p>Configure a task in Converter, Images to PDF, Merge PDF or Downloader, then use its primary action.</p></div>
      : <ol className="queue-list" start={currentPage * pageSize + 1}>{entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(entry => {
        const active = entry.status === 'running' || entry.status === 'cancelling', index = waiting.findIndex(e => e.id === entry.id);
        const percent = entry.percent !== null && Number.isFinite(entry.percent) ? Math.max(0, Math.min(100, entry.percent)) : undefined;
        const download = entry.download;
        const measured = download?.stage === 'downloading' ? [download.stream && download.streams ? `Source ${download.stream} of ${download.streams}` : null, download.bytes !== null ? bytes(download.bytes) : null, download.speed !== null ? `${bytes(download.speed)}/s` : null].filter(Boolean).join(' · ') : null;
        const progressUnit = download?.progressKind === 'fragments' ? 'fragments' : download?.stage === 'downloading' ? 'current source' : entry.conversion?.pagesTotal ? 'pages processed' : 'current stage';
        return <li className="queue-card" key={entry.id}><JobThumbnail entry={entry}/><div className="queue-card-content">
          <div className="queue-card-heading"><div><p className="field-help">{entry.type}</p><h3 dir="auto">{entry.title || 'Untitled task'}</h3></div><span className="queue-state" data-status={entry.status}>{labels[entry.status]}</span></div>
          <details className="file-location"><summary>Source details</summary><p className="queue-source" dir="auto" role="region" aria-label="Source paths" tabIndex={0}>{displayPathText(entry.source) || 'Source details unavailable'}</p></details>
          <p className="field-help queue-destination" dir="auto">Destination: {displayPath(entry.destination)}</p>
          <p className="job-message" data-phase={entry.status} role={entry.status === 'failed' ? 'alert' : undefined}>{displayPathText(entry.error || entry.stage)}</p>
          {Boolean(download?.diagnostics?.length) && <details className="download-diagnostics field-help"><summary>Technical diagnostics</summary><ol>{download!.diagnostics!.map((d,i)=><li key={i}><p>{d.stage} · {d.engine} · {d.exitCode===null?'no exit status':'exit '+d.exitCode}{d.selectedIds.length?' · formats '+d.selectedIds.join(', '):''}</p>{d.detail&&<pre>{displayPathText(d.detail)}</pre>}</li>)}</ol></details>}
          {entry.status === 'waiting' && <p className="field-help numeric-value">Waiting position {(index + 1).toLocaleString()} of {waiting.length.toLocaleString()}</p>}
          {active && <><progress max={100} value={percent} aria-label={`${entry.title} progress`} aria-valuetext={percent === undefined ? 'Progress unavailable for this stage' : `${download?.progressKind === 'estimated' ? 'About ' : ''}${Math.floor(percent)} percent of ${progressUnit}`}/>{percent !== undefined && <p className="field-help numeric-value">{download?.progressKind === 'estimated' ? 'About ' : ''}{Math.floor(percent)}% of {progressUnit}</p>}{measured && <p className="field-help numeric-value">{measured}</p>}</>}
          <div className="queue-actions" role="group" aria-label={`Actions for ${entry.title}`}>
            {entry.status === 'completed' && open && <><button className="button button-secondary" type="button" onClick={() => open(entry, false)}>Open output</button><button className="button button-secondary" type="button" onClick={() => open(entry, true)}>Open folder</button></>}
            {(active || entry.status === 'waiting') && <button className="button button-secondary" type="button" disabled={entry.status === 'cancelling'} onClick={() => cancel(entry.id)}>{entry.status === 'cancelling' ? 'Cancelling…' : 'Cancel'}</button>}
            {entry.status === 'waiting' && <><button className="button button-secondary" type="button" disabled={index === 0} onClick={() => move(entry.id, -1)}>Move up<span className="sr-only"> in waiting jobs</span></button><button className="button button-secondary" type="button" disabled={index === waiting.length - 1} onClick={() => move(entry.id, 1)}>Move down<span className="sr-only"> in waiting jobs</span></button></>}
            {!active && <button className="button button-secondary button-destructive" type="button" onClick={() => remove(entry.id)}>Remove</button>}
          </div>
        </div></li>;
      })}</ol>}
    {pages > 1 && <nav className="queue-pagination" aria-label="Queue pages"><button className="button button-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span className="numeric-value">Page {currentPage + 1} of {pages}</span><button className="button button-secondary" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
  </div>;
}
export default function Queue() {
  const entries = useQueue();
  const [actionError, setActionError] = useState<string>();
  function open(entry:Entry, folder:boolean) {
    setActionError(undefined);
    void invoke('open_queue_output', {path:entry.destination, folder}).catch(() => setActionError('The saved output or its Windows file association is unavailable. Check the destination path.'));
  }
  return <QueueView entries={entries} cancel={id => queue.cancel(id)} move={(id, direction) => queue.move(id, direction)} remove={id => queue.remove(id)} clear={() => queue.clearFinished()} open={open} actionError={actionError}/>;
}
