import { invoke, isTauri } from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { Scheduler, type Progress, type TaskType, type Entry } from './scheduler';
import {executeNative} from './runner';
import type { ConversionJob } from '../converter/conversion';
import type { DownloadJob, DownloadSettings } from '../downloader/model';

export const queue = new Scheduler();
export function useQueue() { return useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot); }
export const outputBusy = () => queue.getSnapshot().some(e => e.status === 'running' || e.status === 'cancelling');
// Counts are read directly from the authoritative scheduler at close time.
function counts() {
  const entries = queue.getSnapshot();
  return {waiting:entries.filter(e => e.status === 'waiting').length, running:entries.filter(e => ['running','cancelling'].includes(e.status)).length};
}
// Registered once with the session, independent of StrictMode and page mounts.
if (isTauri()) {
  void Promise.all([
    listen('queue-close-requested', () => { void invoke('confirm_queue_close', counts()); }),
    listen('queue-shutdown', () => queue.shutdown()),
  ]).then(() => invoke('queue_counts', counts())).catch(() => {});
}
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 250));
export async function runNative(
  kind: 'conversion' | 'download', start: () => Promise<ConversionJob | DownloadJob>,
  signal: AbortSignal, update: (p: Progress) => void,
) {
  return executeNative({start,
    status:id => invoke<ConversionJob | DownloadJob | null>(kind === 'conversion' ? 'get_conversion_status' : 'download_status', kind === 'download' ? {id} : {}),
    cancel:id => invoke<void>(kind === 'conversion' ? 'cancel_conversion' : 'cancel_download', {id}),
    wait:delay,
  }, signal, update);
}
export function submitConversion<T>(type: Exclude<TaskType, 'Downloader'>, title: string, source: string, destination: string, payload: T, start: (snapshot:T) => Promise<ConversionJob>, thumbnail?:Entry['thumbnail']) {
  const metadata = {type, title, source, destination};
  return queue.submitSnapshot({...metadata, thumbnail}, payload, (snapshot, signal, update) => runNative('conversion', () => start(snapshot), signal, update), JSON.stringify([metadata, payload]));
}
export async function submitDownload(inspectionId: number, settings: DownloadSettings, name: string, title: string, source: string) {
  const snapshot = structuredClone({inspectionId, settings, name});
  const prepared = await invoke<{ticket:number; destination:string}>('prepare_download', snapshot);
  try {
    const id = queue.submit({type:'Downloader', title, source, destination:prepared.destination, thumbnail:{category:settings.mode==='audio'?'audio':'video',state:{status:'idle',path:''}}}, {
      run:(signal, update) => runNative('download', () => invoke<DownloadJob>('start_download', {ticket:prepared.ticket}), signal, update),
      dispose:() => invoke('discard_download', {ticket:prepared.ticket}),
    }, JSON.stringify(['download', snapshot, prepared.destination]));
    return id;
  } catch (cause) { await invoke('discard_download', {ticket:prepared.ticket}); throw cause; }
}
