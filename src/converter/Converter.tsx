import { useRef } from 'react';
import type { Dispatch } from 'react';
import { categoryLabels, inputGroups, outputGroups, outputHelp, isTextInput } from './formats';
import { selectMediaFile } from './native';
import { formatFileSize, selectionError } from './selection';
import type { SelectionAction, SelectionState } from './selection';
import type { ConversionController } from './useConversion';
import { isMediaFile, isImageFile, imageOutputHelp } from './conversion';
import { ConversionActions, EngineSetup } from './ConversionControls';

export default function Converter({ state, dispatch, busy, conversion }: {
  state: SelectionState;
  dispatch: Dispatch<SelectionAction>;
  busy: { current: boolean };
  conversion: ConversionController;
}) {
  const selectButton = useRef<HTMLButtonElement>(null);
  const addImagesButton = useRef<HTMLButtonElement>(null);
  const { file, selecting } = state;
  const mediaInput = isMediaFile(file);
  const imageInput = isImageFile(file);
  const textInput = file !== null && isTextInput(file.format);
  const pdfInput = file?.format === 'pdf';
  const locked = state.locked || conversion.busy;
  const inspecting = conversion.engineLoading || conversion.probing;

  async function selectFile() {
    if (busy.current || locked || inspecting) return;
    busy.current = true;
    dispatch({ type: 'start' });
    try {
      dispatch({ type: 'selected', file: await selectMediaFile() });
    } catch (error) {
      dispatch({ type: 'failed', message: selectionError(error) });
    } finally {
      busy.current = false;
    }
  }

  function removeFile() {
    dispatch({ type: 'remove' });
    selectButton.current?.focus();
  }
  function removeImage(index: number) {
    conversion.removeImage(index);
    requestAnimationFrame(() => {
      const next = document.getElementById(`image-remove-${Math.min(index, conversion.images.length - 2)}`);
      (next ?? addImagesButton.current)?.focus();
    });
  }

  return (
    <div className="converter">
      <div className="converter-modes action-row" role="group" aria-label="Conversion mode">
        <button type="button" className="button" aria-pressed={conversion.mode === 'single'} disabled={locked || selecting || conversion.adding} onClick={() => conversion.setMode('single')}>Single file</button>
        <button type="button" className="button" aria-pressed={conversion.mode === 'imagesPdf'} disabled={locked || selecting || conversion.adding} onClick={() => conversion.setMode('imagesPdf')}>Images to PDF</button>
      </div>
      {conversion.mode === 'imagesPdf' ? <>
        <section className="converter-section" aria-labelledby="images-pdf-heading">
          <h2 id="images-pdf-heading">Arrange image pages</h2>
          <p className="field-help">Add up to 100 JPEG, PNG, WebP, BMP or TIFF still images. Each image becomes one page, in the order below.</p>
          <button type="button" className="button" ref={addImagesButton} disabled={locked || conversion.adding || inspecting} onClick={() => void conversion.chooseImages()}>{conversion.adding ? 'Choosing images…' : conversion.images.length ? 'Add more images' : 'Choose images'}</button>
          <p className="field-help numeric-value" role="status">{conversion.images.length} {conversion.images.length === 1 ? 'image' : 'images'} selected</p>
          {!conversion.images.length && <p className="field-help">No image pages yet.</p>}
          <ol className="image-pdf-list">{conversion.images.map((image,index) => <li key={image.path}>
            <div className="image-pdf-name"><span className="file-name" dir="auto">{image.name}</span><span className="file-path" dir="auto">{image.path}</span><span className="field-help">{formatFileSize(image.sizeBytes)}</span></div>
            <div className="image-pdf-actions" role="group" aria-label={`Page ${index + 1}: ${image.name}`}>
              <button type="button" className="button" disabled={locked || conversion.adding || index === 0} onClick={() => conversion.moveImage(index,-1)}>Move up</button>
              <button type="button" className="button" disabled={locked || conversion.adding || index === conversion.images.length - 1} onClick={() => conversion.moveImage(index,1)}>Move down</button>
              <button type="button" className="button" id={`image-remove-${index}`} disabled={locked || conversion.adding} onClick={() => removeImage(index)}>Remove</button>
            </div>
          </li>)}</ol>
          <label className="field-label" htmlFor="pdf-page-size">PDF page size</label>
          <select id="pdf-page-size" value={conversion.pageSize} aria-describedby="image-page-defaults" disabled={locked || conversion.adding} onChange={e => conversion.setPageSize(e.target.value as 'a4' | 'image')}>
            <option value="a4">A4</option><option value="image">Image-sized</option>
          </select>
          <p className="field-help" id="image-page-defaults">A4 fits each image inside 12.7 mm margins. Image-sized pages use 150 DPI with no margins.</p>
          <p className="field-help">Aspect ratio and EXIF orientation are preserved. Transparency is flattened onto white. Images use JPEG quality 90 in the PDF. Animated/multipage images are rejected. Combined limit: 100 million pixels.</p>
        </section>
      </> : <>
      <section className="converter-section" aria-labelledby="input-heading">
        <h2 id="input-heading">Select a file</h2>
        <p className="field-help" id="input-help">Choose one video, audio, image, or document file.</p>
        <details className="supported-inputs field-help">
          <summary>Supported input formats</summary>
          <dl>{inputGroups.map(group => <div key={group.label}>
            <dt>{group.label}</dt><dd>{group.extensions.map(extension => extension.toUpperCase()).join(', ')}</dd>
          </div>)}</dl>
        </details>
        <div className="action-row">
          <button className="button button-primary" type="button" ref={selectButton}
            aria-describedby="input-help" disabled={locked || inspecting} aria-disabled={selecting || locked || inspecting} onClick={selectFile}>
            {selecting ? 'Choosing file…' : file ? 'Replace file' : 'Choose file'}
          </button>
          {file && <button className="button" type="button" disabled={selecting || locked || inspecting} onClick={removeFile}>Remove file</button>}
        </div>
        <p className="selection-notice" role="status">{selecting ? 'Choose one file in the open dialog. File details will be checked after selection.' : state.notice}</p>
        {state.error && <div className="selection-error" role="alert">
          <p>{state.error}</p>
          {file && <p>Your previous file and output format are unchanged.</p>}
        </div>}
        {file ? <dl className="file-details">
          <div><dt>File name</dt><dd className="file-name" dir="auto">{file.name}</dd></div>
          <div><dt>Full path</dt><dd className="file-path" dir="auto">{file.path}</dd></div>
          <div><dt>Size</dt><dd className="file-size">{formatFileSize(file.sizeBytes)}</dd></div>
          <div><dt>Category</dt><dd>{categoryLabels[file.category]} (based on extension)</dd></div>
          {imageInput && conversion.image && <>
            <div><dt>Detected format</dt><dd>{conversion.image.format.toUpperCase()} (decoded)</dd></div>
            <div><dt>Dimensions</dt><dd className="numeric-value">{new Intl.NumberFormat().format(conversion.image.width)} × {new Intl.NumberFormat().format(conversion.image.height)} pixels{conversion.image.orientationApplied ? ' (after EXIF orientation)' : ''}</dd></div>
          </>}
          {pdfInput && conversion.pdf && <div><dt>Pages</dt><dd className="numeric-value">{conversion.pdf.pages}</dd></div>}
        </dl> : <p className="field-help">No file selected.</p>}
        <p className="field-help">File content is checked natively. Documents support TXT, Markdown, HTML and PDF. Microsoft Office and OpenDocument files are unsupported.</p>
      </section>
      {(!file || mediaInput) && <EngineSetup controller={conversion} selecting={selecting} />}
      <section className="converter-section" aria-labelledby="output-heading">
        <h2 id="output-heading">Choose an output format</h2>
        <label className="field-label" htmlFor="output-format">Output format</label>
        <select id="output-format" value={state.output} disabled={!file || selecting || locked || ((mediaInput || imageInput) && inspecting) || (mediaInput && !conversion.engine?.ready)}
          aria-describedby="output-help output-availability" onChange={event => dispatch({ type: 'output', format: event.target.value })}>
          {!file && <option value="">Select a file first</option>}
          {file && outputGroups(file.format).map(group => <optgroup key={group.label} label={group.label}>
            {group.formats.map(format => {
              const available = pdfInput && conversion.pdf && !conversion.pdf.hasText ? format === 'png' || format === 'jpg' : !mediaInput || conversion.formats.find(item => item.format === format)?.available;
              return <option key={format} value={format} disabled={!available}>{format.toUpperCase()}{!available ? ' — unavailable' : ''}</option>;
            })}
          </optgroup>)}
        </select>
        <p className="field-help" id="output-help">{file && state.output ? outputHelp(file.format, state.output) : 'Select a file to see compatible outputs.'}</p>
        <p className="field-help" id="output-availability">{mediaInput ? conversion.availability?.reason ?? 'Formats depend on the selected media streams and bundled encoders.' : textInput ? (state.output === 'txt' ? 'TXT keeps readable content and image alt text, not images or rich formatting.' : 'Local images must be inside the input folder; missing or remote image references produce an error.') : imageInput ? imageOutputHelp(conversion.image, state.output) : ''}</p>
        {pdfInput && conversion.pdf && !conversion.pdf.hasText && <p className="field-help">No extractable text found. This may be a scanned PDF. OCR is not supported; choose PNG or JPEG to render its pages.</p>}
        {pdfInput && (state.output === 'png' || state.output === 'jpg') && <>
          <label className="field-label" htmlFor="pdf-pages">Pages to render</label>
          <input id="pdf-pages" className="text-input" value={conversion.pdfPages} disabled={locked || selecting} maxLength={2048} aria-describedby="pdf-pages-help pdf-range-error" aria-invalid={Boolean(conversion.rangeError)} onChange={e => conversion.setPdfPages(e.target.value)} placeholder="All pages" />
          <p className="field-help" id="pdf-pages-help">Leave blank for all pages, or enter 1-3, 5. Duplicates are removed; pages use document order. In the Save dialog, name a new output folder. Existing folders are protected.</p>
          <p id="pdf-range-error" className="selection-error" role="status">{conversion.rangeError}</p>
        </>}
        {textInput && <details className="supported-inputs field-help"><summary>Text and PDF limitations</summary><p>Raw Markdown HTML is shown literally. HTML scripts/styles are ignored and active objects are rejected. No remote resources are fetched. PDF output reflows headings, lists, links, code and basic table rows; CSS and exact layout are not preserved. Output text is UTF-8. PDF generation supports font-covered Latin, Greek and Cyrillic; complex scripts and combining sequences are rejected. Use precomposed characters.</p></details>}
        {imageInput && <details className="supported-inputs field-help">
          <summary>Image conversion details</summary>
          <p>Single still images only. Outputs use 8-bit channels. EXIF orientation is applied to the pixels; other source metadata and color profiles are not copied. No ICC color-profile conversion is performed, so some images may look different. Cancellation takes effect at the next safe processing boundary.</p>
        </details>}
      </section>
      </>}
      <ConversionActions controller={conversion} file={file} />
    </div>
  );
}
