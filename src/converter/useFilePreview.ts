import { useEffect, useRef, useState } from 'react';
import { generatePreview, cancelPreview } from './native';
import { previewRequests, type PreviewState } from './preview';
import type { SelectedFile } from './selection';
export function useFilePreview(file: SelectedFile | null, validated: boolean, blocked: boolean, unavailable: boolean) {
  const [state,setState] = useState<PreviewState>({status:'idle',path:''});
  const requests = useRef<ReturnType<typeof previewRequests> | null>(null);
  if (!requests.current) requests.current = previewRequests(generatePreview,cancelPreview);
  const cached = useRef<{file: SelectedFile; state: PreviewState} | null>(null);
  const source = useRef<SelectedFile | null>(null);
  useEffect(() => {
    source.current = file;
    if (!file || (file.category !== 'image' && file.category !== 'video')) { cached.current=null; setState({status:'idle',path:file?.path ?? ''}); return; }
    if (cached.current?.file === file) { setState(cached.current.state); return; }
    cached.current = null;
    if (unavailable) { setState({status:'fallback',path:file.path}); return; }
    if (!validated || blocked) { setState({status:blocked?'idle':'loading',path:file.path}); return; }
    return requests.current!.start(file.path,next => { if (next.status === 'ready') cached.current={file,state:next}; setState(next); });
  },[file,validated,blocked,unavailable]);
  useEffect(() => () => requests.current?.stop(),[]);
  return { state: source.current === file && state.path === file?.path ? state : {status:'idle' as const,path:file?.path ?? ''}, failed: () => { cached.current=null; setState({status:'fallback',path:file?.path ?? ''}); } };
}
