import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { SelectionAction, SelectionState } from './selection';
import { cancelConversion, configureEngines, conversionStatus, probeMedia, startConversion } from './native';
import { isEngineFormat, isMediaFile, jobIsBusy, mergeJob, nativeError } from './conversion';
import type { ConversionJob, EngineReport, MediaInfo } from './conversion';

export function useConversion(selection: SelectionState, dispatch: Dispatch<SelectionAction>) {
  const [engine, setEngine] = useState<EngineReport | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [probe, setProbe] = useState<{ path: string; media: MediaInfo } | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const initialRequest = useRef<Promise<[EngineReport | null, ConversionJob | null]> | null>(null);
  const operation = useRef(false);
  const busy = starting || jobIsBusy(job);

  useEffect(() => {
    let live = true;
    if (!initialRequest.current) initialRequest.current = Promise.all([
      configureEngines('current').catch(cause => ({ ready: false, formats: [], folder: null, ffmpegVersion: null, ffprobeVersion: null, message: nativeError(cause) })),
      conversionStatus().catch(() => null),
    ]);
    initialRequest.current.then(([report, current]) => { if (live) { setEngine(report); setJob(current); setEngineLoading(false); } });
    return () => { live = false; };
  }, []);

  useEffect(() => { dispatch({ type: 'lock', locked: busy }); }, [busy, dispatch]);

  useEffect(() => {
    if (!busy) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const current = await conversionStatus(); if (live) { setJob(previous => mergeJob(previous, current)); setError(null); } }
      catch (cause) { if (live) setError(nativeError(cause)); }
      if (live) timer = setTimeout(refresh, 400);
    }
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [busy]);

  const path = selection.file?.path;
  const mediaInput = isMediaFile(selection.file);
  useEffect(() => {
    let live = true;
    setProbe(null); setProbeError(null);
    if (!path || !mediaInput || !engine?.ready || engineLoading || busy) { setProbing(false); return; }
    setProbing(true);
    probeMedia(path).then(media => { if (live) setProbe({ path, media }); })
      .catch(cause => { if (live) setProbeError(nativeError(cause)); })
      .finally(() => { if (live) setProbing(false); });
    return () => { live = false; };
  }, [path, mediaInput, engine, engineLoading, busy]);

  const configure = useCallback(async (source: 'bundled') => {
    if (operation.current || busy || selection.selecting || probing) return;
    operation.current = true; setEngineLoading(true); setError(null);
    try { setEngine(await configureEngines(source)); }
    catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setEngineLoading(false); }
  }, [busy, selection.selecting, probing]);

  const media = probe && probe.path === path ? probe.media : null;
  const formats = media?.formats ?? engine?.formats ?? [];
  const availability = formats.find(item => item.format === selection.output);
  const canConvert = Boolean(mediaInput && engine?.ready && media && availability?.available && !busy && !engineLoading && !probing && !selection.selecting);

  async function start() {
    if (operation.current || !canConvert || !selection.file || !isEngineFormat(selection.output)) return;
    operation.current = true; setStarting(true); setError(null); dispatch({ type: 'lock', locked: true });
    try { const next = await startConversion(selection.file.path, selection.output); setJob(previous => mergeJob(previous, next)); }
    catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setStarting(false); }
  }
  async function cancel() {
    if (!job || !jobIsBusy(job) || cancelling) return;
    setCancelling(true); setError(null);
    try { await cancelConversion(job.id); }
    catch (cause) { setError(nativeError(cause)); }
    finally { setCancelling(false); }
  }
  return { engine, engineLoading, media, probing, probeError, error, job, busy, starting, cancelling, formats, availability, canConvert, configure, start, cancel };
}
export type ConversionController = ReturnType<typeof useConversion>;
