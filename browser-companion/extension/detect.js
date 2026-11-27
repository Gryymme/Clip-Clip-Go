// Runs in Chrome's isolated world, only in permitted frames of a permitted page.
// No page storage, page script injection, network fetch, or response body access.
export function watchMedia(navigationId, _legacyDeadline, previousUrls=[],recoverSince=0) {
  const key = '__clipclipgoDetector';
  globalThis[key]?.stop();
  // Ignore only known previous media: the new player may already exist when history changes.
  const signals=new Set(),hints=new Map(),suppressed=new Set(previousUrls);
  const sent = new Set(Array.isArray(previousUrls)?previousUrls.slice(-50):[]);
  let stopped=false,checking=false,authorizedUntil=Date.now()+60_000;
  let scheduled=null;const roots=new Set(),walkers=new WeakMap();
  const send=data=>{if(stopped)return;if(data.posterUrl?.length>8192)data.posterUrl=null;if(typeof data.title==='string')data.title=data.title.slice(0,4096);if(data.type!=='dom'){const key=[data.type,data.extractorPageUrl,data.mediaUrl,data.kind,data.posterUrl,data.snapshotUrl?.length,data.title].join('|');if(signals.has(key))return;signals.add(key);if(signals.size>128)signals.delete(signals.values().next().value);}return chrome.runtime.sendMessage({navigationId,...data}).catch(()=>{});};
  const frames=new WeakMap();let captures=0;
  const absolute=value=>{try{if(!value||value.length>8192)return null;const u=new URL(value,document.baseURI||globalThis.location?.href);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
  function poster(el){const owner=el.tagName==='SOURCE'?el.parentElement:el;return absolute(owner?.poster||owner?.getAttribute?.('poster')||owner?.getAttribute?.('data-poster')||owner?.getAttribute?.('data-lazy-poster')||owner?.getAttribute?.('data-thumbnail')||owner?.getAttribute?.('data-poster-url'));}
  function frame(el){if(el.tagName!=='VIDEO'||el.mediaKeys||el.srcObject||el.readyState<2||!el.videoWidth||!el.videoHeight||el.isConnected===false)return null;
    const key=el.currentSrc||el.src,old=frames.get(el);if(old?.key===key)return old.value;if(captures>=8)return null;captures++;
    let value=null;try{const canvas=document.createElement('canvas'),scale=Math.min(320/el.videoWidth,180/el.videoHeight,1);canvas.width=Math.max(1,Math.floor(el.videoWidth*scale));canvas.height=Math.max(1,Math.floor(el.videoHeight*scale));canvas.getContext('2d').drawImage(el,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.6);if(data.length<=48000)value=data;canvas.width=canvas.height=0;}catch{}frames.set(el,{key,value});return value;
  }
  const report = event => {
    if(stopped)return;
    if(Date.now()>=authorizedUntil){stop();return;}
    // Bounded rescans also discover roots attached after initial activation.
    const queue=[...new Set([document,...roots])].slice(0,24),media=[];let nodes=0;
    for(const el of event?.composedPath?.()??(event?.target?[event.target]:[]))if(el.matches?.('video,audio,video source,audio source')&&media.length<64)media.push(el);
    for(let i=0;i<queue.length&&i<24;i++){const root=queue[i];if(!roots.has(root)&&roots.size<24){roots.add(root);observer.observe(root===document?document.documentElement:root,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','poster','data-poster','data-lazy-poster']});if(root!==document){root.addEventListener?.('playing',report,true);root.addEventListener?.('loadedmetadata',report,true);root.addEventListener?.('encrypted',encrypted,true);}}
      if(document.createTreeWalker){let walker=walkers.get(root);if(!walker){walker=document.createTreeWalker(root,1);walkers.set(root,walker);}let el;while(nodes<3000&&(el=walker.nextNode())){nodes++;if(el.matches('video,audio,video source,audio source')&&media.length<64)media.push(el);if(el.shadowRoot&&queue.length<24&&!queue.includes(el.shadowRoot))queue.push(el.shadowRoot);}if(!el)walkers.delete(root);}
      else for(const el of root.querySelectorAll('video,audio,video source,audio source'))if(media.length<64)media.push(el);
    }
    const loc=globalThis.location;let pagePoster=null;try{const raw=document.querySelector?.('meta[property="og:image"]')?.content;if(raw&&raw.length<=8192)pagePoster=new URL(raw,loc.href).href;const canonical=document.querySelector?.('meta[property="og:url"]')?.content;if(pagePoster&&canonical&&canonical.length<=8192){const og=new URL(canonical,loc.href);const item=u=>u.searchParams.get('v')||u.pathname.split('/').filter(Boolean).at(-1);if(og.origin!==loc.origin||item(og)!==item(loc))pagePoster=null;}}catch{}
    if(loc&&/^(www\.|m\.)?youtube(?:-nocookie)?\.com$/.test(loc.hostname))send({type:'page',extractorPageUrl:loc.href,title:document.title,posterUrl:pagePoster});
    for (const el of media) {
      const posterUrl=poster(el),snapshotUrl=frame(el);
      if(loc&&/^(www\.|m\.)?youtube(?:-nocookie)?\.com$/.test(loc.hostname)&&el.tagName==='VIDEO')send({type:'page',extractorPageUrl:loc.href,title:document.title,posterUrl:posterUrl||pagePoster,snapshotUrl});
      if(loc&&/^(www\.)?instagram\.com$/.test(loc.hostname)){
        const article=el.closest?.('article');const links=article?[...article.querySelectorAll('a[href]')].slice(0,40):[];
        // Only item permalinks in this video's article; never the generic feed URL.
        const pages=links.map(a=>a.href).filter(u=>{try{return /^\/(p|reel|reels)\/[\w-]+\/?$/.test(new URL(u).pathname);}catch{return false;}});
        const own=/^\/(p|reel|reels)\/[\w-]+\/?$/.test(loc.pathname)?loc.href:null;
        for(const url of new Set(own?[own]:pages)){send({type:'page',extractorPageUrl:url,title:own?document.title:null,posterUrl:posterUrl||(own?pagePoster:null),snapshotUrl});if(el.mediaKeys)send({type:'encrypted',mediaUrl:el.currentSrc||el.src||'',extractorPageUrl:url});}
      }
      if(el.mediaKeys)send({type:'encrypted',mediaUrl:el.currentSrc||el.src||'',extractorPageUrl:loc?.href});
      if(typeof MediaStream!=='undefined'&&el.srcObject instanceof MediaStream)send({type:'playback',kind:'stream'});
      const url = el.currentSrc || el.src || el.getAttribute?.('src');
      if (!url || url.length>8192 || suppressed.has(url)) continue;
      const hint=[posterUrl,snapshotUrl?.length,el.videoWidth,el.videoHeight,Boolean(el.mediaKeys),Boolean(el.srcObject)].join('|');if(sent.has(url)&&hints.get(url)===hint)continue;hints.set(url,hint);if(hints.size>128)hints.delete(hints.keys().next().value);
      sent.add(url);
      if(sent.size>128)sent.delete(sent.values().next().value);
      send({type: 'dom', mediaUrl: url, title: document.title,
        posterUrl,snapshotUrl,
        width: el.videoWidth || null, height: el.videoHeight || null, contentType: el.type || '', observedAt: Date.now()});
    }
  };
  const observer = new MutationObserver(()=>{if(scheduled===null)scheduled=setTimeout(()=>{scheduled=null;report();},150);});
  observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['src','poster','data-poster','data-lazy-poster']});
  document.addEventListener('loadedmetadata', report, true);
  document.addEventListener('playing', report, true);
  const encrypted=event=>send({type:'encrypted',mediaUrl:event.target.currentSrc||event.target.src||'',extractorPageUrl:globalThis.location?.href});
  document.addEventListener('encrypted',encrypted,true);
  // Resource Timing has URLs, not response bodies/MIME. Recover only recognizable media paths.
  const recover=()=>{for(const e of (globalThis.performance?.getEntriesByType('resource')||[]).slice(-256)){
    if((!recoverSince||globalThis.performance.timeOrigin+e.startTime>=recoverSince)&&/\.(m3u8|mpd|mp4|webm|m4a|mp3)(?:[?#]|$)/i.test(e.name)&&['video','audio','fetch','xmlhttprequest','other'].includes(e.initiatorType)&&!sent.has(e.name)){sent.add(e.name);if(sent.size>128)sent.delete(sent.values().next().value);send({type:'dom',mediaUrl:e.name,title:null,observedAt:Date.now(),resourceTiming:true});}
  }};
  const poll=setInterval(()=>{report();recover();},1500);
  // This renewable fail-closed check is not an activation timeout. Permission remains
  // browser-owned; revocation sends stop immediately, and lost workers/messages stop us too.
  const authorization=setInterval(async()=>{if(checking||stopped)return;checking=true;try{const reply=await chrome.runtime.sendMessage({type:'observationAccess',navigationId});if(reply?.ok!==true)stop();else authorizedUntil=Date.now()+60_000;}catch{stop();}finally{checking=false;}},15_000);
  const control=(message,sender)=>{if(sender.id===chrome.runtime.id&&message?.type==='stopClipClipGO')stop();};
  chrome.runtime.onMessage.addListener(control);
  function stop() { stopped=true;observer.disconnect();clearInterval(poll);clearTimeout(scheduled);for(const root of roots){if(root!==document){root.removeEventListener?.('playing',report,true);root.removeEventListener?.('loadedmetadata',report,true);root.removeEventListener?.('encrypted',encrypted,true);}}roots.clear(); clearInterval(authorization); sent.clear();signals.clear();hints.clear();suppressed.clear(); chrome.runtime.onMessage.removeListener(control); document.removeEventListener('encrypted',encrypted,true);document.removeEventListener('loadedmetadata', report, true); document.removeEventListener('playing', report, true); }
  globalThis[key] = {stop}; report();recover();
}
