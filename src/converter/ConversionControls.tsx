import {displayPath, displayPathText} from '../pathDisplay';
import {QueueNotice} from '../queue/Queue';
import type { ConversionController } from './useConversion';
import { displayDuration, isImageFormat, isTextFormat, jobIsBusy } from './conversion';
import type { SelectedFile } from './selection';

export function EngineSetup({ controller: c, selecting }: { controller: ConversionController; selecting: boolean }) {
  const disabled = selecting || c.busy || c.engineLoading || c.probing;
  if (c.engineLoading) return <p className="field-help" role="status">Checking audio/video engines…</p>;
  if (!c.engine?.ready) return <div className="selection-error" role="alert"><p>{displayPathText(c.engine?.message ?? 'Repair ClipClipGO to restore its audio/video engines.')}</p><button className="button" type="button" disabled={disabled} onClick={() => void c.configure('bundled')}>Check engines again</button></div>;
  return <details className="supported-inputs field-help engine-details"><summary>Audio/video engine details</summary><p className="engine-version">{c.engine.ffmpegVersion}</p><p className="engine-version">{c.engine.ffprobeVersion}</p></details>;
}
export function JobStatus({ controller: c }: { controller: ConversionController }) {
  if (!c.job || !jobIsBusy(c.job)) return c.lastEntry ? <QueueNotice entry={c.lastEntry} /> : null;
  const job = c.job;
  const pageOrStillJob = isImageFormat(job.format) || isTextFormat(job.format) || job.format === 'pdf' || Boolean(job.pagesTotal);
  return <section className="conversion-job workflow-section" aria-labelledby="job-heading">
    {c.lastEntry && <QueueNotice entry={c.lastEntry} />}
    <h2 id="job-heading">Conversion status</h2>
    <p className="job-message" data-phase={job.phase} role="status">{displayPathText(job.message)}</p>
    <>
      <progress aria-label="Conversion progress" max={100} value={job.phase === 'running' ? job.percent ?? undefined : undefined} />
      {job.pagesTotal != null ? <p className="field-help numeric-value">{job.pagesDone ?? 0} of {job.pagesTotal} pages processed</p> : !pageOrStillJob && job.phase === 'running' && <p className="field-help numeric-value">{job.format==='gif' && job.percent===null ? 'Progress is indeterminate for this stage.' : <>{job.percent === null ? 'Duration unavailable · ' : `${Math.floor(job.percent)}% · `}{displayDuration(job.seconds)} processed</>}</p>}
    </>
    <details className="file-location job-paths"><summary>Job file details</summary><dl><div><dt>Input</dt><dd dir="auto">{displayPathText(job.inputPath)}</dd></div>{job.destination && <div><dt>Destination</dt><dd dir="auto">{displayPath(job.destination)}</dd></div>}</dl></details>
    <button className="button button-secondary" type="button" disabled={c.cancelling || job.phase === 'cancelling'} onClick={() => void c.cancel()}>{c.cancelling || job.phase === 'cancelling' ? 'Cancelling…' : 'Cancel conversion'}</button>
  </section>;
}
export function ConversionActions({ controller: c, file, imagesMode = false }: { controller: ConversionController; file: SelectedFile | null; imagesMode?: boolean }) {
  const folder = !imagesMode && file?.format === 'pdf' && c.outputIsFolder;
  const disabled = imagesMode ? !c.images.length || Boolean(c.pageSizeError) || c.busy || c.adding || c.engineLoading || c.probing : !c.canConvert;
  return <>
    {!imagesMode && c.probeError && <p className="selection-error" role="alert">{displayPathText(c.probeError)}</p>}
    {c.error && <p className="selection-error" role="alert">{displayPathText(c.error)}</p>}
    <section className="destination-section workflow-section" aria-labelledby="destination-heading">
      <h2 id="destination-heading">Destination</h2>
      <div className="destination-row"><p className="field-help" id="destination-help">{c.queueBusy ? 'Choose a destination to add this configured task to the queue.' : folder ? 'Name a new output folder in the Save dialog. Existing folders are protected.' : 'Choose a new filename in the Save dialog. Originals and existing files are protected.'}</p>
        <button className="button button-primary" type="button" disabled={disabled} aria-describedby="destination-help" onClick={() => void (imagesMode ? c.startImagePdf() : c.start())}>{c.starting ? 'Preparing…' : c.queueBusy ? 'Add to queue' : imagesMode ? 'Create PDF' : 'Convert file'}</button>
      </div>
    </section>
    <JobStatus controller={c} />
  </>;
}
