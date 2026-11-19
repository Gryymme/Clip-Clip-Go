export type FileCategory = 'video' | 'audio' | 'image' | 'document';
export const categoryLabels: Record<FileCategory, string> = {
  video: 'Video', audio: 'Audio', image: 'Image', document: 'Document',
};

const audioOutputs = ['mp3', 'wav', 'flac', 'm4a'] as const;
const videoOutputs = ['mp4', 'mkv', 'webm'] as const;
const videoRoutes = [...videoOutputs, ...audioOutputs] as const;
const imageOutputs = ['jpg', 'png', 'webp', 'bmp', 'tiff'] as const;
const textDocumentOutputs = ['pdf', 'docx', 'odt', 'txt'] as const;
const presentationOutputs = ['pdf', 'pptx', 'odp'] as const;
const spreadsheetOutputs = ['pdf', 'xlsx', 'ods', 'csv'] as const;

// Selection compatibility. Image/document routes remain planned; native encoders gate audio/video.
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
  doc: { category: 'document', outputs: textDocumentOutputs },
  docx: { category: 'document', outputs: textDocumentOutputs },
  odt: { category: 'document', outputs: textDocumentOutputs },
  rtf: { category: 'document', outputs: textDocumentOutputs },
  txt: { category: 'document', outputs: ['pdf', 'docx', 'odt'] },
  ppt: { category: 'document', outputs: presentationOutputs },
  pptx: { category: 'document', outputs: presentationOutputs },
  odp: { category: 'document', outputs: presentationOutputs },
  xls: { category: 'document', outputs: spreadsheetOutputs },
  xlsx: { category: 'document', outputs: spreadsheetOutputs },
  ods: { category: 'document', outputs: spreadsheetOutputs },
  pdf: { category: 'document', outputs: ['txt', 'png', 'jpg'] },
} as const satisfies Record<string, { category: FileCategory; outputs: readonly string[] }>;

export type InputFormat = keyof typeof inputRules;
export type OutputFormat = (typeof inputRules)[InputFormat]['outputs'][number];
const aliases = { jpeg: 'jpg', tif: 'tiff' } as const satisfies Record<string, InputFormat>;
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

export function outputGroups(input: InputFormat): { label: string; formats: readonly OutputFormat[] }[] {
  if (inputRules[input].category === 'video') {
    return [{ label: 'Video', formats: videoOutputs }, { label: 'Extract audio', formats: audioOutputs }];
  }
  return [{ label: inputRules[input].category === 'audio' ? 'Audio' : 'Planned outputs', formats: outputFormats(input) }];
}

export function outputHelp(input: InputFormat, output: OutputFormat): string {
  if (input === 'pdf') {
    return output === 'txt'
      ? 'PDF-to-text will initially require a text-based PDF. Scanned documents need OCR, which is not offered.'
      : 'PDF-to-image is planned to produce one image per page.';
  }
  if (output === 'csv') return 'Spreadsheet-to-CSV may export only one sheet.';
  if (inputRules[input].category === 'video') return 'Choose a video format or extract audio from the video.';
  if (inputRules[input].category === 'audio') return 'Choose an audio output format.';
  return `Choose a planned output for this ${categoryLabels[inputRules[input].category].toLowerCase()}.`;
}
