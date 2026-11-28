import {displayPathText} from '../pathDisplay';
import { useRef } from 'react';
import type { Dispatch } from 'react';
import { inputGroups, outputGroups, outputHelp, isTextInput } from './formats';
import { claimDrop, selectMediaFile } from './native';
import { selectionError } from './selection';
import type { SelectionAction, SelectionState } from './selection';
import type { ConversionController } from './useConversion';
import { isMediaFile, isImageFile, imageOutputHelp } from './conversion';
import { ConversionActions, EngineSetup } from './ConversionControls';
import FileSummary from './FileSummary';
import {DropSelection,EmptySelectionCard} from './SelectionCard';

export default function Converter({ state, dispatch, busy, conversion: c }: {
  state: SelectionState; dispatch: Dispatch<SelectionAction>; busy: { current: boolean }; conversion: ConversionController;
}) {
  const selectButton = useRef<HTMLButtonElement>(null);
  const { file, selecting } = state;
  const mediaInput = isMediaFile(file), imageInput = isImageFile(file);
  const textInput = file !== null && isTextInput(file.format), pdfInput = file?.format === 'pdf';
  const locked = state.locked || c.busy || c.adding;
  const inspecting = c.engineLoading || c.probing;
  async function selectFile(paths?: string[]) {
    if (busy.current || locked || inspecting) return;
    busy.current = true; dispatch({ type: 'start' });
    try {
      let file;
      if(paths){const result=await claimDrop(paths,false);if(result.rejected.length)throw result.rejected.join(' ');file=result.files[0]??null;}else file=await selectMediaFile();
      dispatch({ type: 'selected', file });
    }
    catch (cause) { dispatch({ type: 'failed', message: typeof cause==='string'?cause:selectionError(cause) }); }
    finally { busy.current = false; }
  }
  function removeFile() { dispatch({ type: 'remove' }); selectButton.current?.focus(); }
  const chooseButton = <button className={`button ${file ? 'button-secondary' : 'button-primary'}`} type="button" ref={selectButton} disabled={locked || inspecting || selecting} onClick={() => void selectFile()}>{selecting ? 'Choosing…' : file ? 'Replace' : 'Choose file'}</button>;
  return <div className="converter">
    <section className="workflow-section" aria-labelledby="input-heading">
      <h2 id="input-heading">Selected file</h2>
      <DropSelection multiple={false} locked={locked || inspecting || selecting} onDrop={selectFile} onError={message=>{if(locked||selecting||busy.current||inspecting)return;dispatch({type:'start'});dispatch({type:'failed',message});}}>
      {file ? <FileSummary file={file} conversion={c} actions={<>{chooseButton}<button className="button button-quiet button-destructive" type="button" disabled={locked || inspecting || selecting} onClick={removeFile}>Remove</button></>} />
        : <EmptySelectionCard title="Choose a file to convert" description="Drop one file here, or choose video, audio, an image, text or PDF." actions={chooseButton} />}
      </DropSelection>
      <p className="sr-only" role="status">{selecting ? 'Waiting for the native file dialog.' : state.notice}</p>
      {state.error && <p className="selection-error" role="alert">{displayPathText(state.error)}{file && ' Your previous selection is unchanged.'}</p>}
      <details className="supported-inputs field-help"><summary>Supported formats</summary><dl>{inputGroups.map(group => <div key={group.label}><dt>{group.label}</dt><dd>{group.extensions.map(e => e.toUpperCase()).join(', ')}</dd></div>)}</dl><p>Microsoft Office and OpenDocument files are unsupported.</p></details>
    </section>
    <section className="workflow-section output-section" aria-labelledby="output-heading">
      <h2 id="output-heading">Output format</h2>
      <label className="sr-only" htmlFor="output-format">Output format</label>
      <select id="output-format" value={state.output} disabled={!file || selecting || locked || ((mediaInput || imageInput) && inspecting) || (mediaInput && !c.engine?.ready)} aria-describedby={(file&&state.output&&outputHelp(file.format,state.output)?"output-help ":"")+"output-availability"} onChange={e => dispatch({ type: 'output', format: e.target.value })}>
        {!file && <option value="">Choose a file first</option>}
        {file && outputGroups(file.format).map(group => <optgroup key={group.label} label={group.label}>{group.formats.filter(format=>format!=='gif' || Boolean(c.media?.video && c.formats.find(item=>item.format==='gif')?.available)).map(format => {
          const available = pdfInput && c.pdf && !c.pdf.hasText ? format === 'png' || format === 'jpg' : !mediaInput || c.formats.find(item => item.format === format)?.available;
          return <option key={format} value={format} disabled={!available}>{format.toUpperCase()}{!available ? ' — unavailable' : ''}</option>;
        })}</optgroup>)}
      </select>
      {file&&state.output&&outputHelp(file.format,state.output)&&<p className="field-help" id="output-help">{outputHelp(file.format,state.output)}</p>}
      <p className="field-help" id="output-availability">{mediaInput ? c.availability?.reason : imageInput ? imageOutputHelp(c.image, state.output) : textInput && state.output === 'txt' ? 'TXT retains readable text and image alt text.' : ''}</p>
      {state.output==='gif' && <div className="custom-page-size">
        <div><label className="field-label" htmlFor="gif-size">Maximum edge</label><select id="gif-size" disabled={locked || selecting || inspecting} value={c.gifOptions.maxEdge} onChange={e=>c.setGifOptions(previous=>({...previous,maxEdge:Number(e.target.value)}))}>{[320,480,640,960].map(edge=><option key={edge} value={edge}>{edge} px</option>)}</select></div>
        <div><label className="field-label" htmlFor="gif-fps">Frame rate</label><select id="gif-fps" disabled={locked || selecting || inspecting} value={c.gifOptions.fps} onChange={e=>c.setGifOptions(previous=>({...previous,fps:Number(e.target.value)}))}>{[10,15,20].map(fps=><option key={fps} value={fps}>{fps} fps</option>)}</select></div>
        <p className="field-help numeric-value" role="status">{c.gifSize?`${c.gifSize.width.toLocaleString()} × ${c.gifSize.height.toLocaleString()} px at ${c.gifOptions.fps} fps. Aspect ratio and display orientation preserved; no upscaling.`:'Inspecting video dimensions…'} GIF frame timing is rounded to hundredths of a second.</p>
      </div>}
      {pdfInput && c.pdf && !c.pdf.hasText && <p className="field-help">No extractable text found. OCR is not supported; choose PNG or JPEG to render pages.</p>}
      {pdfInput && (state.output === 'png' || state.output === 'jpg') && <div className="option-field">
        <label className="field-label" htmlFor="pdf-pages">Pages to render</label>
        <input id="pdf-pages" className="text-input" value={c.pdfPages} disabled={locked || selecting} maxLength={2048} aria-describedby="pdf-pages-help pdf-range-error" aria-invalid={Boolean(c.rangeError)} onChange={e => c.setPdfPages(e.target.value)} placeholder="All pages" />
        <p className="field-help" id="pdf-pages-help">Blank means all pages. Use ranges such as 1-3, 5; results follow document order.</p>
        <p id="pdf-range-error" className={c.rangeError ? 'selection-error' : 'sr-only'} role="status">{c.rangeError}</p>
      </div>}
      {(textInput || imageInput) && <details className="supported-inputs field-help"><summary>Conversion details</summary>{imageInput
        ? <p>Single still images only. EXIF orientation is applied. Other metadata and ICC profiles are not copied; output uses 8-bit channels without an ICC color transform. Cancellation waits for the current processing step.</p>
        : <p>UTF-8 text is parsed locally. Raw Markdown HTML is literal; HTML scripts/styles are ignored and active objects rejected. Local images must stay inside the source folder. Missing or remote images produce an error. PDF reflows basic structure; CSS and exact layout are not retained. PDF generation supports precomposed Latin, Greek and Cyrillic where the font has glyphs; complex scripts and missing glyphs fail explicitly.</p>}</details>}
    </section>
    {mediaInput && <EngineSetup controller={c} selecting={selecting} />}
    <ConversionActions controller={c} file={file} />
  </div>;
}
