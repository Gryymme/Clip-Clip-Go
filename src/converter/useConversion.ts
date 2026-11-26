import {useCallback, useEffect, useRef, useState, type Dispatch} from 'react';
import {gifDimensions, defaultGifOptions, type GifOptions} from './gif';
import {initialPageSize, initialSize, sizeError, sizePayload, type PageSize} from './pageSize';
import {isDocumentRoute} from './formats';
import {appendDroppedImages, addImages, moveImage, pageRangeError} from './pdf';
import {useImagePreviews} from './useImagePreviews';
import {useFilePreview} from './useFilePreview';
import type {NativeFile, SelectionAction, SelectionState} from './selection';
import {chooseQueueDestination, selectPdfs, startMergePdf, claimPdfDrop, claimDrop, configureEngines, probeMedia, probeImage, probePdf, selectImages, startImagesPdf, startConversion} from './native';
import {isEngineFormat, isImageFormat, isTextFormat, isImageFile, isMediaFile, nativeError} from './conversion';
import type {EngineReport, MediaInfo, ImageInfo, PdfInfo} from './conversion';
import {useQueue, queue, submitConversion} from '../queue/session';

export function useConversion(selection: SelectionState, dispatch: Dispatch<SelectionAction>, imagesPage = false) {
  const [engine, setEngine] = useState<EngineReport | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [probe, setProbe] = useState<{path:string; media:MediaInfo} | null>(null);
  const [pdfProbe, setPdfProbe] = useState<{path:string; info:PdfInfo} | null>(null);
  const [imageProbe, setImageProbe] = useState<{path:string; info:ImageInfo} | null>(null);
  const [gifOptions, setGifOptions] = useState<GifOptions>(defaultGifOptions);
  const [pdfPages, setPdfPages] = useState('');
  const [mergeFiles, setMergeFiles] = useState<(NativeFile & {pages?:number; issue?:string})[]>([]);
  const [images, setImages] = useState<NativeFile[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize);
  const [customSize, setCustomSize] = useState(initialSize);
  const pageSizeError = pageSize === 'custom' ? sizeError(customSize) : null;
  const [adding, setAdding] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const initialRequest = useRef<Promise<EngineReport> | null>(null);
  const operation = useRef(false);
  const entries = useQueue();
  const [submittedId, setSubmittedId] = useState<string>();
  const lastEntry = entries.find(e => e.id === submittedId) ?? [...entries].reverse().find(e => e.type !== 'Downloader');
  const job = (entries.find(e => e.conversion && ['running','cancelling'].includes(e.status)) ?? [...entries].reverse().find(e => e.conversion))?.conversion ?? null;
  const cancelling = entries.some(e => e.conversion?.id === job?.id && e.status === 'cancelling');
  const queueBusy = entries.some(e => ['running','cancelling'].includes(e.status));
  const busy = starting;

  useEffect(() => {
    let live = true;
    initialRequest.current ??= configureEngines('current').catch(cause => ({ready:false, formats:[], folder:null, ffmpegVersion:null, ffprobeVersion:null, message:nativeError(cause)}));
    initialRequest.current.then(report => { if (live) { setEngine(report); setEngineLoading(false); } });
    return () => { live = false; };
  }, []);
  useEffect(() => { dispatch({type:'lock', locked:busy}); }, [busy, dispatch]);
  const path = selection.file?.path, mediaInput = isMediaFile(selection.file), imageInput = isImageFile(selection.file), pdfInput = selection.file?.format === 'pdf';
  useEffect(() => {
    let live = true;
    if (busy) { setProbing(false); return; }
    setProbe(null); setImageProbe(null); setPdfProbe(null); setProbeError(null);
    if (!path || (!mediaInput && !imageInput && !pdfInput) || (mediaInput && !engine?.ready) || engineLoading) { setProbing(false); return; }
    setProbing(true);
    const request = pdfInput ? probePdf(path).then(info => { if (live) setPdfProbe({path, info}); }) : imageInput
      ? probeImage(path).then(info => { if (live) setImageProbe({path, info}); })
      : probeMedia(path).then(media => { if (live) setProbe({path, media}); });
    request.catch(cause => { if (live) setProbeError(nativeError(cause)); }).finally(() => { if (live) setProbing(false); });
    return () => { live = false; };
  }, [path, selection.file, mediaInput, imageInput, pdfInput, engine, engineLoading, busy]);
  const configure = useCallback(async (source:'bundled') => {
    if (operation.current || busy || selection.selecting || probing) return;
    operation.current = true; setEngineLoading(true); setError(null);
    try { setEngine(await configureEngines(source)); } catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setEngineLoading(false); }
  }, [busy, selection.selecting, probing]);
  const media = probe?.path === path ? probe?.media ?? null : null;
  const image = imageProbe?.path === path ? imageProbe?.info ?? null : null;
  const pdf = pdfProbe?.path === path ? pdfProbe?.info ?? null : null;
  const preview = useFilePreview(selection.file, Boolean(imageInput ? image : mediaInput ? media : false), queueBusy || busy || imagesPage, Boolean(probeError) || Boolean(selection.file?.category === 'video' && !engineLoading && !engine?.ready));
  const imagePreviews = useImagePreviews(images, queueBusy || busy || !imagesPage || engineLoading || probing);
  const rangeError = pdf && (selection.output === 'png' || selection.output === 'jpg') ? pageRangeError(pdfPages, pdf.pages) : null;
  const gifSize = gifDimensions(media?.videoGeometry, gifOptions);
  const formats = media?.formats ?? engine?.formats ?? [];
  const availability = formats.find(item => item.format === selection.output);
  const textReady = selection.file && isDocumentRoute(selection.file.format, selection.output) && (!pdfInput || (pdf && !rangeError && (pdf.hasText || isImageFormat(selection.output))));
  const canConvert = Boolean((textReady || (mediaInput && engine?.ready && media && availability?.available && isEngineFormat(selection.output) && (selection.output !== 'gif' || gifSize)) || (imageInput && image && isImageFormat(selection.output))) && !busy && !adding && !engineLoading && !probing && !selection.selecting);
  async function start() {
    if (operation.current || !canConvert || !selection.file || (!isEngineFormat(selection.output) && !isImageFormat(selection.output) && !isTextFormat(selection.output) && selection.output !== 'pdf')) return;
    operation.current = true; setStarting(true); setError(null); dispatch({type:'lock', locked:true});
    try {
      const snapshot = structuredClone({file:selection.file, format:selection.output, pages:pdfPages, gif:gifOptions});
      const thumbnail = {category:snapshot.file.category, state:preview.state.status==='ready'?preview.state:{status:'idle' as const,path:snapshot.file.path}};
      const folderOutput = snapshot.file.format === 'pdf' && isImageFormat(snapshot.format);
      const destination = await chooseQueueDestination(`${snapshot.file.name.replace(/\.[^.]+$/, '')}${folderOutput ? '-pages' : '_converted.' + snapshot.format}`, snapshot.format, folderOutput);
      if (destination) setSubmittedId(submitConversion('Converter', `${snapshot.file.name} → ${snapshot.format.toUpperCase()}`, snapshot.file.path, destination, snapshot,
        s => startConversion(s.file.path, s.format, destination, s.pages, s.gif), thumbnail));
    } catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setStarting(false); }
  }
  async function chooseImages(paths?:string[]) {
    if (operation.current || busy || probing || engineLoading || selection.selecting) return;
    operation.current = true; setAdding(true); setError(null);
    try {
      if (paths) { const result = await claimDrop(paths, true); const appended = appendDroppedImages(images, result.files); setImages(appended.files); const rejected = [...result.rejected, ...appended.rejected]; if (rejected.length) setError(rejected.join(' ')); }
      else { const added = await selectImages(); if (added) setImages(previous => addImages(previous, added)); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : nativeError(cause)); }
    finally { operation.current = false; setAdding(false); }
  }
  async function startImagePdf() {
    if (operation.current || busy || adding || !images.length || pageSizeError || probing || engineLoading || selection.selecting) return;
    operation.current = true; setStarting(true); setError(null); dispatch({type:'lock', locked:true});
    try {
      const snapshot = structuredClone({paths:images.map(f => f.path), size:sizePayload(pageSize, customSize)});
      const destination = await chooseQueueDestination('images.pdf', 'pdf');
      if (destination) setSubmittedId(submitConversion('Images to PDF', `${snapshot.paths.length} images → PDF`, snapshot.paths.join('\n'), destination, snapshot,
        s => startImagesPdf(s.paths, s.size, destination)));
    } catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setStarting(false); }
  }
  async function chooseMergeFiles(paths?:string[]) {
    if (operation.current || busy || adding || probing || engineLoading || selection.selecting) return;
    operation.current = true; setAdding(true); setError(null);
    try {
      const picked = paths ? await claimPdfDrop(paths) : {files:await selectPdfs() ?? [], rejected:[]};
      const next = [...mergeFiles], rejected = [...picked.rejected];
      for (const file of picked.files) {
        if (next.some(f => f.path.toLowerCase() === file.path.toLowerCase())) continue;
        if (next.length >= 100) { rejected.push(`${file.name}: the 100-PDF limit has been reached.`); continue; }
        try { const info = await probePdf(file.path); next.push({...file, pages:info.pages}); }
        catch (cause) { next.push({...file, issue:nativeError(cause)}); }
      }
      setMergeFiles(next); if (rejected.length) setError(rejected.join(' '));
    } catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setAdding(false); }
  }
  const mergePages = mergeFiles.reduce((n, f) => n + (f.pages ?? 0), 0);
  const mergeSize = mergeFiles.reduce((n, f) => n + Number(f.sizeBytes), 0);
  const mergeLimitError = mergePages > 500 ? 'Merged PDF must contain at most 500 pages.' : mergeSize > 128*1024*1024 ? 'Selected PDFs exceed the 128 MiB combined input limit.' : null;
  const canMerge = mergeFiles.length >= 2 && mergeFiles.every(f => f.pages && !f.issue) && !mergeLimitError && !busy && !adding && !probing && !engineLoading && !selection.selecting;
  async function startMerge() {
    if (operation.current || !canMerge) return;
    operation.current = true; setStarting(true); setError(null); dispatch({type:'lock', locked:true});
    try {
      const paths = mergeFiles.map(f => f.path);
      const destination = await chooseQueueDestination('merged.pdf', 'pdf');
      if (destination) setSubmittedId(submitConversion('Merge PDF', `${paths.length} PDFs → merged PDF`, paths.join('\n'), destination, paths, s => startMergePdf(s, destination)));
    } catch (cause) { setError(nativeError(cause)); }
    finally { operation.current = false; setStarting(false); }
  }
  async function cancel() {
    const entry = entries.find(e => e.conversion?.id === job?.id && ['running','cancelling'].includes(e.status));
    if (entry) queue.cancel(entry.id);
  }
  return {queueBusy, lastEntry, gifOptions, setGifOptions, gifSize, mergeFiles, mergePages, mergeLimitError, canMerge, chooseMergeFiles, startMerge,
    removeMergeFile:(index:number) => { if (!busy && !adding) setMergeFiles(previous => previous.filter((_,i) => i !== index)); },
    moveMergeFile:(index:number, direction:-1|1) => { if (!busy && !adding) setMergeFiles(previous => moveImage(previous, index, direction)); },
    customSize, setCustomSize, pageSizeError, selectionError:setError, imagePreviews:imagePreviews.states, failImagePreview:imagePreviews.fail,
    engine, engineLoading, media, image, pdf, preview, pdfPages, setPdfPages, rangeError,
    outputIsFolder:pdfInput && (selection.output === 'png' || selection.output === 'jpg'), images, pageSize, setPageSize, adding, chooseImages, startImagePdf,
    removeImage:(index:number) => { if (!busy && !adding) setImages(previous => previous.filter((_,i) => i !== index)); },
    moveImage:(index:number, direction:-1|1) => { if (!busy && !adding) setImages(previous => moveImage(previous, index, direction)); },
    probing, probeError, error, job, busy, starting, cancelling, formats, availability, canConvert, configure, start, cancel};
}
export type ConversionController = ReturnType<typeof useConversion>;
