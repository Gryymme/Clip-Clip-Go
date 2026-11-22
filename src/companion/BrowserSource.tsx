import type {BrowserCandidate} from './types';
import {candidateLink} from './types';
function SourceLink({label,url}:{label:string;url:string}){
 const link=candidateLink(url);if(!link)return null;
 return <details className="browser-source-link"><summary>{label} · <span dir="auto">{link.compact}</span></summary><label><span className="field-help">Full {label.toLowerCase()} · select and copy with Ctrl+C</span><textarea readOnly rows={3} value={link.value} aria-label={`Full ${label.toLowerCase()}`} spellCheck={false} onFocus={e=>e.currentTarget.select()}/></label></details>;
}
export default function BrowserSource({candidate:c,disabled,onInspect,onDismiss}:{candidate:BrowserCandidate;disabled:boolean;onInspect?:()=>void;onDismiss?:()=>void}){
 return <div className="browser-source"><h4 className="selected-file-name" dir="auto">{c.title||'Detected media'}</h4><p className="field-help">{[c.mediaType==='hls'?'HLS playlist':c.mediaType==='dash'?'DASH manifest':'Direct media',c.width&&c.height?`${c.width} × ${c.height}`:null,c.drm?'Protected media · unsupported':null].filter(Boolean).join(' · ')}</p>
 <SourceLink label="Detected media link" url={c.mediaUrl}/>{c.pageUrl!==c.mediaUrl&&<SourceLink label="Original page link" url={c.pageUrl}/>}
 {(onInspect||onDismiss)&&<div className="companion-actions">{onInspect&&<button className="button button-primary" disabled={disabled||c.drm===true} onClick={onInspect}>Inspect browser source</button>}{onDismiss&&<button className="button button-secondary" onClick={onDismiss}>Dismiss</button>}</div>}</div>;
}
