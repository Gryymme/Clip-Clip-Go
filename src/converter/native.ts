import { invoke, isTauri } from '@tauri-apps/api/core';
import { inputExtensions } from './formats';
import type { NativeFile } from './selection';

export async function selectMediaFile(): Promise<NativeFile | null> {
  if (!isTauri()) throw { code: 'desktopRequired' };
  return invoke<NativeFile | null>('select_media_file', { extensions: inputExtensions });
}
