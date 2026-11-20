import type { ReactNode } from 'react';
import Icon from '../components/Icon';
import { formatFileSize, type SelectedFile } from './selection';
import { displayDuration } from './conversion';
import type { ConversionController } from './useConversion';
import type { PreviewState } from './preview';
export const readableSize = (bytes: string) => formatFileSize(bytes).split(' (')[0];
export function Thumbnail({ file, state, onError }: { file: SelectedFile; state: PreviewState; onError: () => void }) {
  const name = file.category === 'audio' ? 'audio' : file.category === 'document' ? 'document' : file.category === 'video' ? 'video' : 'image';
  const caption = state.status === 'loading' ? 'Loading…' : state.status === 'fallback' ? 'No preview' : null;
  return <figure className="file-preview" aria-label={caption ? `${file.category} preview: ${caption}` : `${file.category} file`}>
    {state.status === 'ready' ? <img src={state.image.dataUrl} alt="" onError={onError} width={state.image.width} height={state.image.height} /> : <>
      <Icon name={name} />{caption && <figcaption className="preview-caption" role="status">{caption}</figcaption>}
    </>}
  </figure>;
}
export default function FileSummary({ file, conversion: c, actions }: { file: SelectedFile; conversion: ConversionController; actions: ReactNode }) {
  const dimensions = c.image ? `${c.image.width.toLocaleString()} × ${c.image.height.toLocaleString()} px` : null;
  return <FileCard file={file} preview={c.preview.state} onPreviewError={c.preview.failed} actions={actions} facts={<><span>{(c.image?.format ?? file.format).toUpperCase()} {c.media ? c.media.video ? 'video' : 'audio' : file.category}</span><span>{readableSize(file.sizeBytes)}</span>{dimensions && <span>{dimensions}</span>}{c.media && <span>{displayDuration(c.media.duration)}</span>}{c.pdf && <span>{c.pdf.pages} {c.pdf.pages === 1 ? 'page' : 'pages'}</span>}</>} />;
}
export function FileCard({file,preview,onPreviewError,actions,facts}: {file:SelectedFile;preview:PreviewState;onPreviewError:()=>void;actions:ReactNode;facts?:ReactNode}) {
  return <div className="file-summary">
    <Thumbnail file={file} state={preview} onError={onPreviewError} />
    <div className="file-summary-content">
      <h3 className="selected-file-name" dir="auto">{file.name}</h3>
      <p className="file-facts">{facts ?? <><span>{file.format.toUpperCase()} image</span><span>{readableSize(file.sizeBytes)}</span>{preview.status === 'ready' && preview.image.sourceWidth && preview.image.sourceHeight && <span>{preview.image.sourceWidth.toLocaleString()} × {preview.image.sourceHeight.toLocaleString()} px</span>}</>}</p>
      <details className="file-location"><summary>File details</summary><dl><div><dt>Full path</dt><dd dir="auto">{file.path}</dd></div><div><dt>Exact size</dt><dd>{formatFileSize(file.sizeBytes)}</dd></div></dl></details>
    </div>
    <div className="file-summary-actions">{actions}</div>
  </div>;
}
