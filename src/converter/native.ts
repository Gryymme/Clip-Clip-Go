import type {GifOptions} from './gif';
import type {PageSizePayload} from './pageSize';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { inputExtensions } from './formats';
import type { NativeFile } from './selection';
import type { EngineReport, MediaInfo, ImageInfo, PdfInfo, ConversionFormat, ConversionJob } from './conversion';
import type { Thumbnail } from './preview';
export async function generatePreview(inputPath: string, requestId: number): Promise<Thumbnail> { desktop(); return invoke('generate_preview', { inputPath, requestId }); }
export async function cancelPreview(requestId: number): Promise<void> { desktop(); return invoke('cancel_preview', { requestId }); }

export async function selectMediaFile(): Promise<NativeFile | null> {
  if (!isTauri()) throw { code: 'desktopRequired' };
  return invoke<NativeFile | null>('select_media_file', { extensions: inputExtensions });
}

function desktop() { if (!isTauri()) throw 'Engine checks and conversion are available in the ClipClipGO desktop app.'; }
export async function configureEngines(source: 'current' | 'bundled'): Promise<EngineReport> {
  desktop(); return invoke('configure_engines', { source });
}
export async function probeMedia(inputPath: string): Promise<MediaInfo> {
  desktop(); return invoke('probe_media', { inputPath });
}
export async function probeImage(inputPath: string): Promise<ImageInfo> {
  desktop(); return invoke('probe_image', { inputPath });
}
export async function probePdf(inputPath: string): Promise<PdfInfo> { desktop(); return invoke('probe_pdf', { inputPath }); }
export async function selectImages(): Promise<NativeFile[] | null> { desktop(); return invoke('select_images'); }
export async function startImagesPdf(inputPaths: string[], pageSize: PageSizePayload, outputPath: string): Promise<ConversionJob> { desktop(); return invoke('start_images_pdf', { inputPaths, pageSize, outputPath }); }
export async function startConversion(inputPath: string, format: ConversionFormat, outputPath: string, pages = '', gifOptions?:GifOptions): Promise<ConversionJob> {
  desktop(); return invoke('start_conversion', { inputPath, format, outputPath, pdfOptions: { pages }, gifOptions:format==='gif'?gifOptions:undefined });
}
export async function conversionStatus(): Promise<ConversionJob | null> { desktop(); return invoke('get_conversion_status'); }
export async function cancelConversion(id: number): Promise<void> { desktop(); return invoke('cancel_conversion', { id }); }

export async function claimDrop(paths:string[],imagesOnly:boolean):Promise<{files:NativeFile[];rejected:string[]}> {desktop();return invoke('claim_drop',{paths,imagesOnly});}

export async function selectPdfs(): Promise<NativeFile[] | null> { desktop(); return invoke('select_pdfs'); }
export async function startMergePdf(inputPaths: string[], outputPath: string): Promise<ConversionJob> { desktop(); return invoke('start_merge_pdf', { inputPaths, outputPath }); }
export async function claimPdfDrop(paths: string[]): Promise<{files:NativeFile[];rejected:string[]}> { desktop(); return invoke('claim_drop', { paths, imagesOnly:false, pdfsOnly:true }); }

export async function chooseQueueDestination(suggested: string, format: ConversionFormat, folderOutput = false): Promise<string | null> { desktop(); return invoke('choose_queue_destination', {suggested, format, folderOutput}); }
