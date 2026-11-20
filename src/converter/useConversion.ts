import {initialSize,sizeError,sizePayload,type PageSize} from './pageSize';
import { isDocumentRoute } from './formats';
import { appendDroppedImages, addImages, moveImage, pageRangeError } from './pdf';
import { useImagePreviews } from './useImagePreviews';
import { useFilePreview } from './useFilePreview';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { NativeFile, SelectionAction, SelectionState } from './selection';
import { claimDrop, cancelConversion, configureEngines, conversionStatus, probeMedia, probeImage, probePdf, selectImages, startImagesPdf, startConversion } from './native';
import { isEngineFormat, isImageFormat, isTextFormat, isImageFile, isMediaFile, jobIsBusy, mergeJob, nativeError } from './conversion';
import type { ConversionJob, EngineReport, MediaInfo, ImageInfo, PdfInfo } from './conversion';

export function useConversion(selection: SelectionState, dispatch: Dispatch<SelectionAction>, imagesPage = false, externalBusy = false) {
  const [engine, setEngine] = useState<EngineReport | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [probe, setProbe] = useState<{ path: string; media: MediaInfo } | null>(null);
  const [pdfProbe, setPdfProbe] = useState<{path: string; info: PdfInfo} | null>(null);
  const [pdfPages, setPdfPages] = useState('');
  const [images, setImages] = useState<NativeFile[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [customSize,setCustomSize] = useState(initialSize);
  const pageSizeError = pageSize==='custom'?sizeError(customSize):null;
  const [adding, setAdding] = useState(false);
  const [imageProbe, setImageProbe] = useState<{ path: string; info: ImageInfo } | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const initialRequest = useRef<Promise<[EngineReport | null, ConversionJob | null]> | null>(null);
  const operation = useRef(false);
  const ownBusy = starting || jobIsBusy(job);
  const busy = ownBusy || externalBusy;

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
    if (!ownBusy) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const current = await conversionStatus(); if (live) { setJob(previous => mergeJob(previous, current)); setError(null); } }
      catch (cause) { if (live) setError(nativeError(cause)); }
      if (live) timer = setTimeout(refresh, 400);
    }
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [ownBusy]);

  const path = selection.file?.path;
  const mediaInput = isMediaFile(selection.file);
  const imageInput = isImageFile(selection.file);
  const pdfInput = selection.file?.format === 'pdf';
  useEffect(() => {
    let live = true;
    if (busy) { setProbing(false); return; }
    setProbe(null); setImageProbe(null); setPdfProbe(null); setProbeError(null);
    if (!path || (!mediaInput && !imageInput && !pdfInput) || (mediaInput && !engine?.ready) || engineLoading) { setProbing(false); return; }
    setProbing(true);
    const request = pdfInput ? probePdf(path).then(info => { if (live) setPdfProbe({ path, info }); }) : imageInput
      ? probeImage(path).then(info => { if (live) setImageProbe({ path, info }); })
      : probeMedia(path).then(media => { if (live) setProbe({ path, media }); });
    request
      .catch(cause => { if (live) setProbeError(nativeError(cause)); })
      .finally(() => { if (live) setProbing(false); });
    return () => { live = false; };
  }, [path, selection.file, mediaInput, imageInput, pdfInput, engine, engineLoading, busy]);

  const configure = useCallback(async (source: 'bundled') => {
    if (operation.current || busy || selection.selecting || probing) return;
    operation.current = true; setEngineLoading(true); setError(null);
    try { setEngine(await configureEngines(source)); }
    catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setEngineLoading(false); }
  }, [busy, selection.selecting, probing]);

  const media = probe && probe.path === path ? probe.media : null;
  const image = imageProbe && imageProbe.path === path ? imageProbe.info : null;
  const pdf = pdfProbe && pdfProbe.path === path ? pdfProbe.info : null;
  const preview = useFilePreview(selection.file, Boolean(imageInput ? image : mediaInput ? media : false), busy || imagesPage, Boolean(probeError) || Boolean(selection.file?.category === 'video' && !engineLoading && !engine?.ready));
  const imagePreviews = useImagePreviews(images, busy || !imagesPage || engineLoading || probing);
  const rangeError = pdf && (selection.output === 'png' || selection.output === 'jpg') ? pageRangeError(pdfPages, pdf.pages) : null;
  const formats = media?.formats ?? engine?.formats ?? [];
  const availability = formats.find(item => item.format === selection.output);
  const textReady = selection.file && isDocumentRoute(selection.file.format,selection.output) && (!pdfInput || (pdf && !rangeError && (pdf.hasText || isImageFormat(selection.output))));
  const canConvert = Boolean(((textReady) || (mediaInput && engine?.ready && media && availability?.available && isEngineFormat(selection.output)) || (imageInput && image && isImageFormat(selection.output))) && !busy && !adding && !engineLoading && !probing && !selection.selecting);

  async function start() {
    if (operation.current || !canConvert || !selection.file || (!isEngineFormat(selection.output) && !isImageFormat(selection.output) && !isTextFormat(selection.output) && selection.output !== 'pdf')) return;
    operation.current = true; setStarting(true); setError(null); dispatch({ type: 'lock', locked: true });
    try { const next = await startConversion(selection.file.path, selection.output, pdfPages); setJob(previous => mergeJob(previous, next)); }
    catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setStarting(false); }
  }
  async function chooseImages(paths?:string[]) {
    if (operation.current || busy || probing || engineLoading || selection.selecting) return;
    operation.current = true; setAdding(true); setError(null);
    try {
      if(paths){const result=await claimDrop(paths,true);const appended=appendDroppedImages(images,result.files);setImages(appended.files);const rejected=[...result.rejected,...appended.rejected];if(rejected.length)setError(rejected.join(' '));}
      else {const added=await selectImages();if(added)setImages(previous=>addImages(previous,added));}
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : nativeError(cause)); }
    finally { operation.current = false; setAdding(false); }
  }
  async function startImagePdf() {
    if (operation.current || busy || adding || !images.length || pageSizeError || probing || engineLoading || selection.selecting) return;
    operation.current = true; setStarting(true); setError(null); dispatch({ type: 'lock', locked: true });
    try { const next = await startImagesPdf(images.map(f => f.path), sizePayload(pageSize,customSize)); setJob(previous => mergeJob(previous, next)); }
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
  return { customSize,setCustomSize,pageSizeError,selectionError:setError, imagePreviews: imagePreviews.states, failImagePreview: imagePreviews.fail, engine, engineLoading, media, image, pdf, preview, pdfPages, setPdfPages, rangeError, outputIsFolder: pdfInput && (selection.output === 'png' || selection.output === 'jpg'), images, pageSize, setPageSize, adding, chooseImages, startImagePdf,
    removeImage: (index: number) => { if (!busy && !adding) setImages(previous => previous.filter((_,i) => i !== index)); },
    moveImage: (index: number, direction: -1 | 1) => { if (!busy && !adding) setImages(previous => moveImage(previous,index,direction)); },
    probing, probeError, error, job, busy, starting, cancelling, formats, availability, canConvert, configure, start, cancel };
}
export type ConversionController = ReturnType<typeof useConversion>;
