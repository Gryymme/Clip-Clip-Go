import {DropSelection,EmptySelectionCard} from './SelectionCard';
import {displayDimension,editDimension,changeUnit,changeDpi,type Unit,type PageSize} from './pageSize';
import { useRef } from 'react';
import type { ConversionController } from './useConversion';
import { ConversionActions } from './ConversionControls';
import { FileCard } from './FileSummary';
import { identifyFile } from './formats';

export default function ImagesToPdf({ conversion: c, selecting }: { conversion: ConversionController; selecting: boolean }) {
  const addButton = useRef<HTMLButtonElement>(null);
  const locked = c.busy || c.adding || selecting;
  function remove(index: number) {
    c.removeImage(index);
    requestAnimationFrame(() => (document.getElementById(`image-remove-${Math.min(index,c.images.length-2)}`) ?? addButton.current)?.focus());
  }
  return <div className="converter">
    <section className="workflow-section" aria-labelledby="images-pdf-heading">
      <h2 id="images-pdf-heading">Image pages <span className="quiet-count">({c.images.length})</span></h2>
      <DropSelection multiple locked={locked || c.engineLoading || c.probing} onDrop={c.chooseImages} onError={c.selectionError}>
        <EmptySelectionCard title={c.images.length?'Add more image pages':'Choose images for your PDF'} description="Drop still images here, or choose files. One image per page, in list order (up to 100)." actions={<button className={`button ${c.images.length?'button-secondary':'button-primary'}`} type="button" ref={addButton} disabled={locked || c.engineLoading || c.probing} onClick={()=>void c.chooseImages()}>{c.adding?'Choosing…':c.images.length?'Add images':'Choose images'}</button>} />
      </DropSelection>
      <ol className="image-pdf-list" aria-label="Image page order" tabIndex={c.images.length ? 0 : undefined}>{c.images.map((file,index) => <li key={file.path}>
        <FileCard file={{...file,...identifyFile(file.name)!}} preview={c.imagePreviews?.[file.path] ?? {status:'loading',path:file.path}} onPreviewError={() => c.failImagePreview(file.path)} actions={
        <div className="image-pdf-actions" role="group" aria-label={`Page ${index+1}: ${file.name}`}>
          <button type="button" className="button button-quiet" disabled={locked || index === 0} onClick={() => c.moveImage(index,-1)}>Move up</button>
          <button type="button" className="button button-quiet" disabled={locked || index === c.images.length-1} onClick={() => c.moveImage(index,1)}>Move down</button>
          <button type="button" className="button button-quiet button-destructive" id={`image-remove-${index}`} disabled={locked} onClick={() => remove(index)}>Remove</button>
        </div>} />
      </li>)}</ol>
    </section>
    <section className="workflow-section" aria-labelledby="pdf-options-heading"><h2 id="pdf-options-heading">PDF options</h2>
      <label className="field-label" htmlFor="pdf-page-size">Page size</label><select id="pdf-page-size" value={c.pageSize} aria-describedby="image-page-defaults" disabled={locked} onChange={e => c.setPageSize(e.target.value as PageSize)}><option value="a4">A4</option><option value="letter">Letter (8.5 × 11 in)</option><option value="legal">Legal (8.5 × 14 in)</option><option value="image">Image sized</option><option value="custom">Custom</option></select>
      <p className="field-help" id="image-page-defaults">{c.pageSize === 'image' ? '150 DPI with no margins.' : 'Fit images inside 0.5-inch (12.7 mm) margins.'} Aspect ratio and EXIF orientation are preserved.</p>
      {c.pageSize==='custom' && <div className="custom-page-size">
        {(['width','height'] as const).map(axis=><div key={axis}><label className="field-label" htmlFor={`custom-${axis}`}>{axis==='width'?'Width':'Height'}</label><input id={`custom-${axis}`} className="text-input" type="number" step="any" value={c.customSize[axis+'Draft' as 'widthDraft'|'heightDraft'] ?? (Number.isFinite(c.customSize[axis])?displayDimension(c.customSize[axis],c.customSize.unit,Number(c.customSize.dpi)):'')} disabled={locked} aria-invalid={Boolean(c.pageSizeError)} aria-describedby="custom-size-help custom-size-error" onChange={e=>c.setCustomSize(previous=>editDimension(previous,axis,e.target.value))} /></div>)}
        <div><label className="field-label" htmlFor="custom-unit">Unit</label><select id="custom-unit" value={c.customSize.unit} disabled={locked} onChange={e=>c.setCustomSize(previous=>changeUnit(previous,e.target.value as Unit))}><option value="in">Inches</option><option value="cm">Centimeters</option><option value="px">Pixels</option></select></div>
        {c.customSize.unit==='px' && <div><label className="field-label" htmlFor="custom-dpi">DPI</label><input id="custom-dpi" className="text-input" type="number" min="1" max="2400" step="any" value={c.customSize.dpi} disabled={locked} onChange={e=>c.setCustomSize(previous=>changeDpi(previous,e.target.value))} /></div>}
        <p className="field-help" id="custom-size-help">Each side must exceed 1 inch and be at most 200 inches. Pixels need DPI (1–2400) to determine physical size. Unit/DPI changes preserve physical dimensions.</p>
        <p id="custom-size-error" className={c.pageSizeError?'selection-error':'sr-only'} role="status">{c.pageSizeError}</p>
      </div>}
      <details className="supported-inputs field-help"><summary>Image requirements and quality</summary><p>JPEG, PNG, WebP, BMP and TIFF still images. Transparency is flattened onto white; PDF images use JPEG quality 90. Animated/multipage inputs are rejected. Combined limit: 100 million pixels.</p></details>
    </section>
    <ConversionActions controller={c} file={null} imagesMode />
  </div>;
}
