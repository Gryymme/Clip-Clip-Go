import { useRef } from 'react';
import type { Dispatch } from 'react';
import { categoryLabels, inputGroups, outputGroups, outputHelp } from './formats';
import { selectMediaFile } from './native';
import { formatFileSize, selectionError } from './selection';
import type { SelectionAction, SelectionState } from './selection';

export default function Converter({ state, dispatch, busy }: {
  state: SelectionState;
  dispatch: Dispatch<SelectionAction>;
  busy: { current: boolean };
}) {
  const selectButton = useRef<HTMLButtonElement>(null);
  const { file, selecting } = state;

  async function selectFile() {
    if (busy.current) return;
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
            aria-describedby="input-help" aria-disabled={selecting} onClick={selectFile}>
            {selecting ? 'Choosing file…' : file ? 'Replace file' : 'Choose file'}
          </button>
          {file && <button className="button" type="button" disabled={selecting} onClick={removeFile}>Remove file</button>}
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
        </dl> : <p className="field-help">No file selected.</p>}
        <p className="field-help">File type is preliminary, based on its extension. Content inspection is not implemented yet.</p>
      </section>
      <section className="converter-section" aria-labelledby="output-heading">
        <h2 id="output-heading">Choose an output format</h2>
        <label className="field-label" htmlFor="output-format">Output format</label>
        <select id="output-format" value={state.output} disabled={!file || selecting}
          aria-describedby="output-help" onChange={event => dispatch({ type: 'output', format: event.target.value })}>
          {!file && <option value="">Select a file first</option>}
          {file && outputGroups(file.format).map(group => <optgroup key={group.label} label={group.label}>
            {group.formats.map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}
          </optgroup>)}
        </select>
        <p className="field-help" id="output-help">{file && state.output ? outputHelp(file.format, state.output) : 'Select a file to see its planned outputs.'}</p>
        {file && <p className="field-help">These are planned conversion routes. Actual support will be validated when conversion engines are integrated.</p>}
      </section>
      <div className="conversion-action">
        <button className="button" type="button" disabled aria-describedby="conversion-limitation">Convert</button>
        <p className="field-help" id="conversion-limitation">Conversion is not available yet</p>
      </div>
    </div>
  );
}
