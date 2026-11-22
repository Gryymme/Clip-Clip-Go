// Runs in Chrome's isolated world, only in specifically permitted frames of an activated tab.
// No page storage, page script injection, network fetch, or response body access.
export function watchMedia(navigationId, expiresAt, previousUrls=[]) {
  const key = '__clipclipgoDetector';
  globalThis[key]?.stop();
  // Ignore only known previous media: the new player may already exist when history changes.
  const sent = new Set(Array.isArray(previousUrls)?previousUrls.slice(-50):[]);
  const report = () => {
    if (Date.now() >= expiresAt) { stop(); return; }
    for (const el of document.querySelectorAll('video,audio,video source,audio source')) {
      const url = el.currentSrc || el.src;
      if (!url || url.length>8192 || sent.has(url)) continue;
      sent.add(url);
      if(sent.size>128)sent.delete(sent.values().next().value);
      chrome.runtime.sendMessage({type: 'dom', navigationId, mediaUrl: url, title: document.title,
        width: el.videoWidth || null, height: el.videoHeight || null, contentType: el.type || '', observedAt: Date.now()}).catch(() => {});
    }
  };
  const observer = new MutationObserver(report);
  observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['src']});
  document.addEventListener('loadedmetadata', report, true);
  document.addEventListener('playing', report, true);
  const encrypted=event=>chrome.runtime.sendMessage({type:'encrypted',navigationId,mediaUrl:event.target.currentSrc||event.target.src||''}).catch(()=>{});
  document.addEventListener('encrypted',encrypted,true);
  const timer = setTimeout(() => stop(), Math.max(0, expiresAt - Date.now()));
  const control=(message,sender)=>{if(sender.id===chrome.runtime.id&&message?.type==='stopClipClipGO')stop();};
  chrome.runtime.onMessage.addListener(control);
  function stop() { observer.disconnect(); clearTimeout(timer); sent.clear(); chrome.runtime.onMessage.removeListener(control); document.removeEventListener('encrypted',encrypted,true);document.removeEventListener('loadedmetadata', report, true); document.removeEventListener('playing', report, true); }
  globalThis[key] = {stop}; report();
}
