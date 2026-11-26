import {useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {queue,useQueue} from './session';
import {finished,type Entry,type Status} from './scheduler';
import {QueueView} from './JobList';
export {QueueView} from './JobList';
const labels:Record<Status,string>={waiting:'Waiting',running:'Running',cancelling:'Cancelling',completed:'Completed',failed:'Failed',cancelled:'Cancelled'};
export function QueueNotice({entry}:{entry:Entry}) {
  if (finished(entry.status)) return null;
  return <p className="field-help queue-notice" role="status">{entry.type} · {entry.title} · {labels[entry.status]}. {entry.status === 'waiting' ? 'Added to Queue. You can keep configuring tasks.' : 'See Queue for session results and actions.'}</p>;
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
