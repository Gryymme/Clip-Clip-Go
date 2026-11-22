export type FileCategory = 'video' | 'audio' | 'image' | 'document';
export const categoryLabels: Record<FileCategory, string> = {
  video: 'Video', audio: 'Audio', image: 'Image', document: 'Document',
};

const audioOutputs = ['mp3', 'wav', 'flac', 'm4a'] as const;
const videoOutputs = ['mp4', 'mkv', 'webm', 'gif'] as const;
const videoRoutes = [...videoOutputs, ...audioOutputs] as const;
export const imageOutputs = ['jpg', 'png', 'webp', 'bmp', 'tiff'] as const;
// Implemented routes. Native providers independently validate file contents.
const inputRules = {
  mp4: { category: 'video', outputs: videoRoutes },
  mkv: { category: 'video', outputs: videoRoutes },
  webm: { category: 'video', outputs: videoRoutes },
  mov: { category: 'video', outputs: videoRoutes },
  mp3: { category: 'audio', outputs: audioOutputs },
  wav: { category: 'audio', outputs: audioOutputs },
  flac: { category: 'audio', outputs: audioOutputs },
  m4a: { category: 'audio', outputs: audioOutputs },
  ogg: { category: 'audio', outputs: audioOutputs },
  jpg: { category: 'image', outputs: imageOutputs },
  png: { category: 'image', outputs: imageOutputs },
  webp: { category: 'image', outputs: imageOutputs },
  bmp: { category: 'image', outputs: imageOutputs },
  tiff: { category: 'image', outputs: imageOutputs },
  txt: { category: 'document', outputs: ['md', 'html', 'pdf'] },
  md: { category: 'document', outputs: ['html', 'txt', 'pdf'] },
  html: { category: 'document', outputs: ['md', 'txt', 'pdf'] },
  pdf: { category: 'document', outputs: ['txt', 'md', 'html', 'png', 'jpg'] },
} as const satisfies Record<string, { category: FileCategory; outputs: readonly string[] }>;

export type InputFormat = keyof typeof inputRules;
export type OutputFormat = (typeof inputRules)[InputFormat]['outputs'][number];
const aliases = { jpeg: 'jpg', tif: 'tiff', markdown: 'md', htm: 'html' } as const satisfies Record<string, InputFormat>;
export const inputExtensions: readonly string[] = [...Object.keys(inputRules), ...Object.keys(aliases)];
export const supportedInputLabel = inputExtensions.map(extension => extension.toUpperCase()).join(', ');
export const inputGroups = (Object.keys(categoryLabels) as FileCategory[]).map(category => ({
  label: categoryLabels[category],
  extensions: inputExtensions.filter(extension => inputRules[normalizeExtension(extension)!].category === category),
}));

export function normalizeExtension(extension: string): InputFormat | null {
  const lower = extension.toLowerCase();
  const normalized = Object.hasOwn(aliases, lower) ? aliases[lower as keyof typeof aliases] : lower;
  return Object.hasOwn(inputRules, normalized) ? normalized as InputFormat : null;
}

export function identifyFile(name: string): { format: InputFormat; category: FileCategory } | null {
  const dot = name.lastIndexOf('.');
  const format = dot < 0 ? null : normalizeExtension(name.slice(dot + 1));
  return format ? { format, category: inputRules[format].category } : null;
}

export function categorizeFile(name: string): FileCategory | null {
  return identifyFile(name)?.category ?? null;
}

export function outputFormats(input: InputFormat): readonly OutputFormat[] {
  return inputRules[input].outputs;
}

export function isCompatible(input: InputFormat, output: string): output is OutputFormat {
  return (outputFormats(input) as readonly string[]).includes(output);
}

export function isTextRoute(input: InputFormat, output: string): boolean {
  return isTextInput(input) && ['md','html','txt'].includes(output) && input !== output;
}
export function isTextInput(input: InputFormat): boolean { return input === 'md' || input === 'html' || input === 'txt'; }
export function isDocumentRoute(input: InputFormat, output: string): boolean {
  return isTextRoute(input,output) || (isTextInput(input) && output === 'pdf') || (input === 'pdf' && ['txt','md','html','png','jpg'].includes(output));
}

export function outputGroups(input: InputFormat): { label: string; formats: readonly OutputFormat[] }[] {
  if (inputRules[input].category === 'video') {
    return [{ label: 'Video', formats: videoOutputs }, { label: 'Extract audio', formats: audioOutputs }];
  }
  return [{ label: inputRules[input].category === 'audio' ? 'Audio' : inputRules[input].category === 'image' ? 'Image' : 'Document', formats: outputFormats(input) }];
}

export function outputHelp(input: InputFormat, output: OutputFormat): string {
  if (output === 'gif') return 'Animated GIF with no audio. Loops continuously. Long or high-resolution clips can produce large files.';
  if (isTextInput(input)) return output === 'pdf' ? 'Paginated A4 PDF with an embedded font. Latin, Greek and Cyrillic text are supported where the font has glyphs; complex scripts, combining sequences and missing glyphs produce an error.' : 'Local UTF-8 output. Basic structure is preserved where supported; formatting may change.';
  if (input === 'pdf') {
    return output === 'png' || output === 'jpg'
      ? 'One image per selected page at 150 DPI, in a new output folder. JPEG uses a white background.'
      : 'Reconstructed text with page boundaries. Original styling, exact tables and perfect reading order are not preserved. Scanned PDFs need OCR, which is not supported.';
  }
  if (inputRules[input].category === 'video') return 'Choose a video format or extract audio from the video.';
  if (inputRules[input].category === 'audio') return 'Choose an audio output format.';
  if (inputRules[input].category === 'image') return 'Convert one still image. Dimensions are preserved after applying EXIF orientation.';
  return 'Choose an output format.';
}
