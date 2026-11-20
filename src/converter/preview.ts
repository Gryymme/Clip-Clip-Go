let requestSequence = 0;
export const nextPreviewId = () => requestSequence = Math.max(requestSequence + 1,Date.now()*1024);
export interface Thumbnail { dataUrl: string; width: number; height: number; sourceWidth?: number; sourceHeight?: number }
export type PreviewState = { status: 'idle' | 'loading' | 'fallback'; path: string } | { status: 'ready'; path: string; image: Thumbnail };
// Dependency-injected lifecycle also allows testing late replies without a DOM.
export function previewRequests(load: (path: string, id: number) => Promise<Thumbnail>, cancel: (id: number) => Promise<unknown>, clock?: () => number) {
  let sequence = 0, active: number | null = null;
  function stop() { if (active !== null) { const id = active; active = null; void cancel(id).catch(() => {}); } }
  return {
    stop,
    start(path: string, update: (state: PreviewState) => void) {
      // A frontend reload must not restart IDs below the native cancellation fence.
      stop(); const id = sequence = clock ? Math.max(sequence + 1,clock() * 1024) : nextPreviewId(); active = id; update({ status: 'loading', path });
      void load(path,id).then(image => {
        if (active !== id) return;
        const valid = image && typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:image/png;base64,') && image.dataUrl.length <= 524310 && Number.isInteger(image.width) && image.width > 0 && image.width <= 320 && Number.isInteger(image.height) && image.height > 0 && image.height <= 240;
        update(valid ? { status: 'ready', path, image } : { status: 'fallback', path });
      }, () => { if (active === id) update({ status: 'fallback', path }); });
      return () => { if (active === id) stop(); };
    },
  };
}
