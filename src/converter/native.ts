import { invoke, isTauri } from '@tauri-apps/api/core';
import { inputExtensions } from './formats';
import type { NativeFile } from './selection';
import type { EngineReport, MediaInfo, EngineFormat, ConversionJob } from './conversion';

export async function selectMediaFile(): Promise<NativeFile | null> {
  if (!isTauri()) throw { code: 'desktopRequired' };
  return invoke<NativeFile | null>('select_media_file', { extensions: inputExtensions });
}

function desktop() { if (!isTauri()) throw 'Engine checks and conversion are available in the Clip-Clip-Go desktop app.'; }
export async function configureEngines(source: 'current' | 'bundled'): Promise<EngineReport> {
  desktop(); return invoke('configure_engines', { source });
}
export async function probeMedia(inputPath: string): Promise<MediaInfo> {
  desktop(); return invoke('probe_media', { inputPath });
}
export async function startConversion(inputPath: string, format: EngineFormat): Promise<ConversionJob> {
  desktop(); return invoke('start_conversion', { inputPath, format });
}
export async function conversionStatus(): Promise<ConversionJob | null> { desktop(); return invoke('get_conversion_status'); }
export async function cancelConversion(id: number): Promise<void> { desktop(); return invoke('cancel_conversion', { id }); }
