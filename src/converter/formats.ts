export type MediaCategory = 'video' | 'audio';

const videoInputs = ['mp4', 'mkv', 'webm', 'mov'] as const;
const audioInputs = ['mp3', 'wav', 'flac', 'm4a', 'ogg'] as const;
export const audioOutputs = ['mp3', 'wav', 'flac', 'm4a'] as const;
export const videoOutputs = ['mp4', 'mkv', 'webm'] as const;
export type OutputFormat = (typeof videoOutputs)[number] | (typeof audioOutputs)[number];
export const inputExtensions: readonly string[] = [...videoInputs, ...audioInputs];
export const supportedInputLabel = inputExtensions.map(extension => extension.toUpperCase()).join(', ');

export function categorizeFile(name: string): MediaCategory | null {
  const extension = name.split('.').length > 1 ? name.split('.').at(-1)!.toLowerCase() : '';
  if ((videoInputs as readonly string[]).includes(extension)) return 'video';
  if ((audioInputs as readonly string[]).includes(extension)) return 'audio';
  return null;
}

export function outputFormats(category: MediaCategory): readonly OutputFormat[] {
  return category === 'video' ? [...videoOutputs, ...audioOutputs] : audioOutputs;
}

export function isCompatible(category: MediaCategory, format: string): format is OutputFormat {
  return (outputFormats(category) as readonly string[]).includes(format);
}
