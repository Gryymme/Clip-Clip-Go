import type { ConversionController } from './useConversion';
import { displayDuration, isMediaFile, jobIsBusy } from './conversion';
import type { SelectedFile } from './selection';

export function EngineSetup({ controller: c, selecting }: { controller: ConversionController; selecting: boolean }) {
  const disabled = selecting || c.busy || c.engineLoading || c.probing;
  if (c.engineLoading) return <p className="field-help" role="status">Checking bundled conversion engines…</p>;
  if (!c.engine?.ready) return <section className="converter-section" aria-labelledby="engine-heading">
    <h2 id="engine-heading">Conversion engines unavailable</h2>
    <p className="selection-error" role="alert">{c.engine?.message ?? 'Repair or reinstall Clip-Clip-Go to restore its bundled engines.'}</p>
    <button className="button" type="button" disabled={disabled} onClick={() => void c.configure('bundled')}>Check bundled engines again</button>
  </section>;
  return <details className="supported-inputs field-help">
    <summary>Bundled engine versions</summary>
    <p className="engine-version">{c.engine.ffmpegVersion}</p>
    <p className="engine-version">{c.engine.ffprobeVersion}</p>
  </details>;
}

export function ConversionActions({ controller: c, file }: { controller: ConversionController; file: SelectedFile | null }) {
  const mediaInput = isMediaFile(file);
  const reason = !file ? 'Select an audio or video file to convert.' : !mediaInput ? 'Image and document conversion is not available yet.'
    : c.engineLoading ? 'Checking the conversion engines…' : !c.engine?.ready ? 'Restore the bundled engines to enable audio/video conversion.'
    : c.probing ? 'Inspecting media with FFprobe…' : c.probeError ? 'Select another file to continue.' : c.availability?.reason ? 'Choose an available output format.' : 'Choose a destination filename. The original and existing files will be preserved.';
  return <>
    {mediaInput && c.media && <p className="field-help media-summary">
      Media checked with FFprobe. {c.media.video ? `Video: ${c.media.video.codec}. ` : 'No actual video stream. '}
      {c.media.audio ? `Audio: ${c.media.audio.codec}. ` : 'No audio stream. '}
      Duration: {displayDuration(c.media.duration)}.
    </p>}
    {c.error && <p className="selection-error" role="alert">{c.error}</p>}
    {mediaInput && c.probeError && <p className="selection-error" role="alert">{c.probeError}</p>}
    <div className="conversion-action">
      <button className="button button-primary" type="button" disabled={!c.canConvert} aria-describedby="conversion-limitation" onClick={() => void c.start()}>{c.starting ? 'Preparing…' : 'Convert'}</button>
      <p className="field-help" id="conversion-limitation">{c.busy ? 'One conversion at a time. File and format controls are locked until this job finishes.' : reason}</p>
    </div>
    {c.job && <section className="conversion-job" aria-labelledby="job-heading">
      <h2 id="job-heading">{jobIsBusy(c.job) ? 'Conversion progress' : 'Last conversion'}</h2>
      <p className="job-message" data-phase={c.job.phase} role={c.job.phase === 'failed' ? 'alert' : 'status'}>{c.job.message}</p>
      {(jobIsBusy(c.job) || c.job.phase === 'succeeded') && <>
        <progress aria-label="Conversion progress" max={100} value={c.job.phase === 'succeeded' ? 100 : c.job.phase === 'running' ? c.job.percent ?? undefined : undefined} />
        <p className="field-help numeric-value">{c.job.phase === 'running' ? `${c.job.percent === null ? 'Duration unavailable · ' : `${Math.floor(c.job.percent)}% · `}${displayDuration(c.job.seconds)} processed` : c.job.phase === 'succeeded' ? '100% · Output validated' : 'Waiting for the current native operation…'}</p>
      </>}
      <dl className="file-details">
        <div><dt>Input</dt><dd className="file-path" dir="auto">{c.job.inputPath}</dd></div>
        {c.job.destination && <div><dt>{c.job.phase === 'succeeded' ? 'Saved output' : 'Destination'}</dt><dd className="file-path" dir="auto">{c.job.destination}</dd></div>}
      </dl>
      {jobIsBusy(c.job) && <button className="button" type="button" disabled={c.cancelling || c.job.phase === 'cancelling'} onClick={() => void c.cancel()}>{c.cancelling || c.job.phase === 'cancelling' ? 'Cancelling…' : 'Cancel conversion'}</button>}
    </section>}
  </>;
}
