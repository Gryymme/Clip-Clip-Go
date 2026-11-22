import {useRef} from 'react';
import {DropSelection,EmptySelectionCard} from './SelectionCard';
import {FileCard,readableSize} from './FileSummary';
import {JobStatus} from './ConversionControls';
import type {ConversionController} from './useConversion';

export default function MergePdf({conversion:c,selecting}:{conversion:ConversionController;selecting:boolean}) {
  const addButton=useRef<HTMLButtonElement>(null);
  const locked=c.busy || c.adding || selecting || c.probing || c.engineLoading;
  function remove(index:number) {
    c.removeMergeFile(index);
    requestAnimationFrame(()=>(document.getElementById(`pdf-remove-${Math.min(index,c.mergeFiles.length-2)}`) ?? addButton.current)?.focus());
  }
  return <div className="converter">
    <section className="workflow-section" aria-labelledby="merge-files-heading">
      <h2 id="merge-files-heading">PDF files <span className="quiet-count">({c.mergeFiles.length})</span></h2>
      <DropSelection multiple locked={locked} onDrop={c.chooseMergeFiles} onError={c.selectionError}>
        <EmptySelectionCard title={c.mergeFiles.length?'Add more PDFs':'Choose PDFs to merge'} description="Drop PDFs here, or choose files. All pages merge in file order. Choose 2–100 PDFs, up to 500 pages and 128 MiB combined." actions={<button ref={addButton} type="button" className={`button ${c.mergeFiles.length?'button-secondary':'button-primary'}`} disabled={locked} onClick={()=>void c.chooseMergeFiles()}>{c.adding?'Checking PDFs…':c.mergeFiles.length?'Add PDFs':'Choose PDFs'}</button>} />
      </DropSelection>
      <ol className="image-pdf-list" aria-label="PDF file order" tabIndex={c.mergeFiles.length?0:undefined}>
        {c.mergeFiles.map((file,index)=><li key={file.path}>
          <FileCard file={{...file,format:'pdf',category:'document'}} preview={{status:'idle',path:file.path}} onPreviewError={()=>{}} facts={<><span>PDF</span><span>{readableSize(file.sizeBytes)}</span>{file.pages!=null && <span>{file.pages.toLocaleString()} {file.pages===1?'page':'pages'}</span>}</>} actions={<div className="image-pdf-actions" role="group" aria-label={`File ${index+1}: ${file.name}`}>
            <button type="button" className="button button-quiet" disabled={locked || index===0} onClick={()=>c.moveMergeFile(index,-1)}>Move up</button>
            <button type="button" className="button button-quiet" disabled={locked || index===c.mergeFiles.length-1} onClick={()=>c.moveMergeFile(index,1)}>Move down</button>
            <button type="button" id={`pdf-remove-${index}`} className="button button-quiet button-destructive" disabled={locked} onClick={()=>remove(index)}>Remove</button>
          </div>} />
          {file.issue && <p className="selection-error" role="alert" dir="auto">{file.name}: {file.issue} Remove this file or choose a supported copy.</p>}
        </li>)}
      </ol>
      <p className="field-help" role="status">{c.mergeFiles.length<2?'Choose at least two valid PDFs to merge.':`${c.mergePages.toLocaleString()} pages in file order. Invalid files must be removed before merging.`}</p>
      {c.mergeLimitError && <p className="selection-error" role="alert">{c.mergeLimitError}</p>}
    </section>
    <section className="workflow-section" aria-labelledby="merge-options-heading">
      <h2 id="merge-options-heading">Page preservation</h2>
      <p className="field-help">Original page sizes, orientation and content are retained without rasterization.</p>
      <details className="supported-inputs field-help"><summary>PDF requirements and limitations</summary><p>Encrypted, password-protected, unreadable and unsupported PDFs cannot be merged. Page annotations and direct web links may carry over. Internal page-link destinations are not retained. Named links, forms, bookmarks, attachments, layers, accessibility tags and digital signatures are not guaranteed. Check important documents after merging. PDF actions are never executed and remote resources are never fetched during processing.</p></details>
    </section>
    {c.error && <p className="selection-error" role="alert">{c.error}</p>}
    <section className="destination-section workflow-section" aria-labelledby="merge-destination-heading">
      <h2 id="merge-destination-heading">Destination</h2>
      <div className="destination-row"><p className="field-help" id="merge-destination-help">{c.busy?'A download or conversion is active. Finish or cancel it before starting another.':'Choose a new filename in the Save dialog. Originals and existing files are protected.'}</p><button type="button" className="button button-primary" aria-describedby="merge-destination-help" disabled={!c.canMerge} onClick={()=>void c.startMerge()}>{c.starting?'Preparing…':'Merge PDF'}</button></div>
    </section>
    <JobStatus controller={c} />
  </div>;
}
