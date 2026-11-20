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
      <div className="section-heading-row"><h2 id="images-pdf-heading">Image pages <span className="quiet-count">({c.images.length})</span></h2><button className={`button ${c.images.length ? 'button-secondary' : 'button-primary'}`} type="button" ref={addButton} disabled={locked || c.engineLoading || c.probing} onClick={() => void c.chooseImages()}>{c.adding ? 'Choosing…' : c.images.length ? 'Add images' : 'Choose images'}</button></div>
      <p className="field-help">One image per page, in the order shown. Up to 100 still images.</p>
      {!c.images.length && <p className="empty-image-list">Add images to start arranging your PDF.</p>}
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
      <label className="field-label" htmlFor="pdf-page-size">Page size</label><select id="pdf-page-size" value={c.pageSize} aria-describedby="image-page-defaults" disabled={locked} onChange={e => c.setPageSize(e.target.value as 'a4'|'image')}><option value="a4">A4</option><option value="image">Image-sized</option></select>
      <p className="field-help" id="image-page-defaults">{c.pageSize === 'a4' ? 'Fit images inside 12.7 mm margins.' : '150 DPI with no margins.'} Aspect ratio and EXIF orientation are preserved.</p>
      <details className="supported-inputs field-help"><summary>Image requirements and quality</summary><p>JPEG, PNG, WebP, BMP and TIFF still images. Transparency is flattened onto white; PDF images use JPEG quality 90. Animated/multipage inputs are rejected. Combined limit: 100 million pixels.</p></details>
    </section>
    <ConversionActions controller={c} file={null} imagesMode />
  </div>;
}
