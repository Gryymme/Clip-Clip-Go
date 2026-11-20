import { identifyFile, isCompatible, outputFormats, supportedInputLabel } from './formats.ts';
import type { FileCategory, InputFormat, OutputFormat } from './formats.ts';

export interface NativeFile {
  name: string;
  path: string;
  // Decimal bytes avoid rounding the native u64 across the JSON boundary.
  sizeBytes: string;
}

export interface SelectedFile extends NativeFile { category: FileCategory; format: InputFormat }
export interface SelectionState {
  file: SelectedFile | null;
  output: OutputFormat | '';
  selecting: boolean;
  error: string | null;
  notice: string;
  locked: boolean;
}

export const initialSelection: SelectionState = {
  file: null, output: '', selecting: false, error: null, notice: '', locked: false,
};

export type SelectionAction =
  | { type: 'lock'; locked: boolean }
  | { type: 'start' }
  | { type: 'selected'; file: NativeFile | null }
  | { type: 'failed'; message: string }
  | { type: 'output'; format: string }
  | { type: 'remove' };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  if (state.locked && action.type !== 'lock') return state;
  switch (action.type) {
    case 'lock': return { ...state, locked: action.locked };
    case 'start':
      if (state.locked) return state;
      return { ...state, selecting: true, error: null, notice: '' };
    case 'selected': {
      if (!state.selecting) return state;
      if (action.file === null) {
        return { ...state, selecting: false, notice: 'File selection cancelled.' };
      }
      const input = identifyFile(action.file.name);
      if (!input) {
        const office = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i.test(action.file.name);
        return { ...state, selecting: false, error: office ? 'Microsoft Office and OpenDocument files are not supported. Choose TXT, Markdown, HTML or PDF instead.' : `Unsupported file extension. Choose one of: ${supportedInputLabel}.` };
      }
      return {
        file: { ...action.file, ...input },
        output: isCompatible(input.format, state.output) ? state.output : outputFormats(input.format)[0],
        selecting: false, error: null, notice: 'File selected. Choose an output format.', locked: false,
      };
    }
    case 'failed':
      return { ...state, selecting: false, error: action.message, notice: '' };
    case 'output':
      if (state.locked || state.selecting || !state.file || !isCompatible(state.file.format, action.format)) return state;
      return { ...state, output: action.format };
    case 'remove':
      return state.locked || state.selecting ? state : { ...initialSelection, notice: 'Selected file removed.' };
  }
}

export function selectionError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  switch (code) {
    case 'desktopRequired': return 'File selection is available in the Clip-Clip-Go desktop app. Open the desktop app and try again.';
    case 'missingFile': return 'The selected file could not be found. It may have been moved or deleted. Choose the file again.';
    case 'notAFile': return 'The selection is not a regular file. Choose a supported video, audio, image, or document file.';
    case 'busy': return 'A conversion is active. Finish or cancel it before choosing another file.';
    case 'permissionDenied': return 'The file details could not be accessed. Check your file permissions or choose another file.';
    default: return 'The file details could not be loaded. Try selecting the file again, or choose another file.';
  }
}

export function formatFileSize(decimalBytes: string): string {
  const bytes = BigInt(decimalBytes);
  const exact = new Intl.NumberFormat().format(bytes);
  if (bytes < 1024n) return `${exact} ${bytes === 1n ? 'byte' : 'bytes'}`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  let divisor = 1024n;
  let index = 0;
  while (bytes >= divisor * 1024n && index < units.length - 1) { divisor *= 1024n; index++; }
  const roundedTenths = (bytes * 10n + divisor / 2n) / divisor;
  const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(roundedTenths) / 10);
  return `${value} ${units[index]} (${exact} bytes)`;
}
