import type {ConversionJob} from '../converter/conversion.ts';
import type {DownloadJob} from '../downloader/model.ts';
import type {Progress} from './scheduler.ts';
type NativeJob = ConversionJob | DownloadJob;
export interface NativeTransport {
  start:()=>Promise<NativeJob>;
  status:(id:number)=>Promise<NativeJob|null>;
  cancel:(id:number)=>Promise<void>;
  wait:()=>Promise<void>;
}
// A transient IPC failure does not release ownership of a still-running native worker.
export async function executeNative(transport:NativeTransport, signal:AbortSignal, update:(progress:Progress)=>void) {
  if (signal.aborted) throw Error('Cancelled.');
  let job = await transport.start(), cancelSent = false;
  for (;;) {
    const stage = 'phase' in job ? job.phase : job.stage;
    if (signal.aborted && !cancelSent && !['succeeded','failed','cancelled'].includes(stage)) {
      try { await transport.cancel(job.id); cancelSent = true; } catch { /* retry while retaining ownership */ }
    }
    const percent = Number.isFinite(job.percent) ? job.percent : null;
    update({stage:job.message, percent:stage === 'verifying' || stage === 'finalizing' ? null : percent,
      ...(job.destination ? {destination:job.destination} : {}),
      ...('phase' in job ? {conversion:job} : {download:job})});
    if (stage === 'succeeded') return;
    if (stage === 'cancelled') throw Error('Cancelled.');
    if (stage === 'failed') throw job.message;
    await transport.wait();
    try {
      const current = await transport.status(job.id);
      if (current?.id === job.id && current.revision >= job.revision) job = current;
    } catch { update({stage:'Waiting for native status; this job still owns the processing slot.', percent:null}); }
  }
}
