import { useRef } from 'react';
import type { Dispatch } from 'react';
import { categoryLabels, inputGroups, outputGroups, outputHelp } from './formats';
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
  const { file, selecting } = state;
  const mediaInput = isMediaFile(file);
  const imageInput = isImageFile(file);
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

  return (
    <div className="converter">
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
        </dl> : <p className="field-help">No file selected.</p>}
        <p className="field-help">Category starts with the extension. Audio/video streams are checked with FFprobe; images are validated by decoding. Document content inspection is not implemented.</p>
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
              const available = !mediaInput || conversion.formats.find(item => item.format === format)?.available;
              return <option key={format} value={format} disabled={!available}>{format.toUpperCase()}{!available ? ' — unavailable' : ''}</option>;
            })}
          </optgroup>)}
        </select>
        <p className="field-help" id="output-help">{file && state.output ? outputHelp(file.format, state.output) : 'Select a file to see compatible outputs.'}</p>
        <p className="field-help" id="output-availability">{mediaInput ? conversion.availability?.reason ?? 'Formats depend on the selected media streams and bundled encoders.' : imageInput ? imageOutputHelp(conversion.image, state.output) : file ? 'These are planned conversion routes. Actual support will be validated when conversion engines are integrated.' : ''}</p>
        {imageInput && <details className="supported-inputs field-help">
          <summary>Image conversion details</summary>
          <p>Single still images only. Outputs use 8-bit channels. EXIF orientation is applied to the pixels; other source metadata and color profiles are not copied. No ICC color-profile conversion is performed, so some images may look different. Cancellation takes effect at the next safe processing boundary.</p>
        </details>}
      </section>
      <ConversionActions controller={conversion} file={file} />
    </div>
  );
}
