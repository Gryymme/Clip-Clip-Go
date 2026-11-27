// Independently implemented from public Chrome APIs. No response bodies or credentials.
export const TTL = 10 * 60_000;
export const MAX_CANDIDATES = 50;
export function httpUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function originPattern(value) { const u = httpUrl(value); return u ? new URL(u).origin + '/*' : null; }
export function extractorPage(value){const valid=httpUrl(value);if(!valid)return null;const u=new URL(valid),host=u.hostname;
 if(['www.youtube.com','youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(host)&&((u.pathname==='/watch'&&/^[\w-]{11}$/.test(u.searchParams.get('v')||''))||/^\/(shorts|embed)\/[\w-]{11}\/?$/.test(u.pathname)))return valid;
 if(['www.instagram.com','instagram.com'].includes(host)&&/^\/(p|reel|reels)\/[\w-]{1,128}\/?$/.test(u.pathname))return valid;return null;}
export function partialMedia(value){const valid=httpUrl(value);if(!valid)return true;const u=new URL(valid);return /(^|\.)googlevideo\.com$/.test(u.hostname)&&u.pathname.includes('videoplayback')||['range','bytestart','byteend','sq'].some(k=>/^\d+(?:-\d*)?$/.test(u.searchParams.get(k)||''))||/\.(m4s|ts|cmfv|cmfa|key)$/i.test(u.pathname)||/(?:^|\/)(?:init|segment|seg|chunk|fragment)[-_\d][^/]*\.(?:mp4|aac|webm)$/i.test(u.pathname);}
export function mediaKind(value, contentType = '') {
  const valid = httpUrl(value); if (!valid) return null;
  if(partialMedia(valid))return null;
  const path = new URL(valid).pathname.toLowerCase(), type = contentType.split(';')[0].trim().toLowerCase();
  if(/json|^image\/|^text\/html|iso\.segment/.test(type))return null;
  if (/\.(?:m4s|ts|cmfv|cmfa|key)$/i.test(path) || /(?:^|\/)(?:init|segment|seg|chunk|fragment)[-_\d][^/]*\.(?:mp4|aac|webm)$/i.test(path)) return null;
  if (/\.m3u8$/i.test(path) || ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'].includes(type)) return 'hls';
  if (/\.mpd$/i.test(path) || type === 'application/dash+xml') return 'dash';
  if (/\.(?:mp4|webm|mkv|mov|m4v|mp3|m4a|ogg|opus|wav|flac|aac)$/i.test(path) || /^(?:video|audio)\//.test(type) && !['video/mp2t', 'audio/aacp'].includes(type)) return 'direct';
  return null;
}
export function prune(sessions, now = Date.now()) {
  for (const [tab, s] of Object.entries(sessions)) {
    if (!s || s.startedAt > now + 60_000) { delete sessions[tab]; continue; }
    // Access comes from Chrome grants, not a session deadline. Migrate old sessions.
    delete s.expiresAt;
    s.candidates = s.candidates.filter(c => c.expiresAt > now).slice(-MAX_CANDIDATES);
    for(const[id,request]of Object.entries(s.requests||{}))if(!request||now-request.at>TTL)delete s.requests[id];
  }
  // Stay well below storage.session's quota, even with maximum-length signed URLs.
  while(JSON.stringify(sessions).length>2*1024*1024){const oldest=Object.values(sessions).filter(s=>s.candidates.length).sort((a,b)=>a.candidates[0].observedAt-b.candidates[0].observedAt)[0];if(!oldest)break;oldest.candidates.shift();}
  return sessions;
}
export function addCandidate(s, data, now = Date.now(), uuid = () => crypto.randomUUID()) {
  const mediaUrl = httpUrl(data.mediaUrl), kind = mediaKind(mediaUrl, data.contentType) ?? (data.dom && !data.contentType && mediaUrl && !partialMedia(mediaUrl) ? 'direct' : null);
  if (!kind || !mediaUrl || !Number.isInteger(data.frameId) || data.frameId < 0 || data.frameId > 1_000_000 || data.navigationId !== s.navigationId || data.observedAt < s.startedAt) return false;
  // A full URL is the identity. Never remove signed query parameters or fragments.
  const previous=s.candidates.find(c => c.mediaUrl === mediaUrl && c.frameId === data.frameId);
  if (previous) { if(!previous.posterUrl&&httpUrl(data.posterUrl))previous.posterUrl=httpUrl(data.posterUrl);if(!previous.snapshotUrl&&safeSnapshot(data.snapshotUrl))previous.snapshotUrl=data.snapshotUrl;if(data.drm===true)previous.drm=true;if (!previous.context.referer && httpUrl(data.referer)) previous.context.referer=httpUrl(data.referer); if (!previous.width && Number.isInteger(data.width) && data.width>0 && data.width<=32768) previous.width=data.width; if (!previous.height && Number.isInteger(data.height) && data.height>0 && data.height<=32768) previous.height=data.height; return false; }
  if (s.candidates.some(c => ['hls','dash'].includes(c.mediaType) && new URL(c.mediaUrl).origin === new URL(mediaUrl).origin && c.frameId === data.frameId) && /\.(?:aac|mp4)$/i.test(new URL(mediaUrl).pathname) && /(?:seg|chunk|fragment|init)[-_\d]/i.test(new URL(mediaUrl).pathname)) return false;
  s.candidates.push({id: uuid(), pageUrl: s.pageUrl, frameUrl: httpUrl(data.frameUrl) ?? s.pageUrl, mediaUrl, mediaType: kind,...(httpUrl(data.posterUrl)?{posterUrl:httpUrl(data.posterUrl)}:{}),...(safeSnapshot(data.snapshotUrl)?{snapshotUrl:data.snapshotUrl}:{}),
    title: typeof data.title === 'string' && data.title.trim() ? Array.from(data.title).slice(0, 1024).join('') : s.title || null,
    width: Number.isInteger(data.width) && data.width > 0 && data.width <= 32768 ? data.width : null,
    height: Number.isInteger(data.height) && data.height > 0 && data.height <= 32768 ? data.height : null,
    drm: data.drm===true ? true : null,
    frameId: data.frameId, documentId: String(data.documentId ?? '').slice(0, 128), navigationId: s.navigationId,
    observedAt: now, expiresAt: now + TTL, context: {referer: httpUrl(data.referer)}});
  if (s.candidates.length > MAX_CANDIDATES) s.candidates.shift();
  return true;
}
export function addPageCandidate(s,data,now=Date.now()){
 const url=extractorPage(data.extractorPageUrl),frame=httpUrl(data.frameUrl);if(!url||!frame||new URL(url).origin!==new URL(frame).origin||data.navigationId!==s.navigationId)return false;
 const previous=s.candidates.find(c=>c.extractorPageUrl===url&&c.frameId===data.frameId);if(previous){if(!previous.posterUrl&&httpUrl(data.posterUrl))previous.posterUrl=httpUrl(data.posterUrl);if(!previous.snapshotUrl&&safeSnapshot(data.snapshotUrl))previous.snapshotUrl=data.snapshotUrl;return false;}
 s.candidates.push({id:crypto.randomUUID(),pageUrl:s.pageUrl,frameUrl:frame,mediaUrl:'',extractorPageUrl:url,mediaType:'page',...(httpUrl(data.posterUrl)?{posterUrl:httpUrl(data.posterUrl)}:{}),...(safeSnapshot(data.snapshotUrl)?{snapshotUrl:data.snapshotUrl}:{}),title:typeof data.title==='string'?Array.from(data.title).slice(0,1024).join(''):null,width:null,height:null,drm:s.encryptedPages?.includes(url)?true:null,frameId:data.frameId,documentId:String(data.documentId??'').slice(0,128),navigationId:s.navigationId,observedAt:now,expiresAt:now+TTL,context:{referer:null}});if(s.candidates.length>MAX_CANDIDATES)s.candidates.shift();return true;
}
export function candidateLabel(c) {
  return {title: c.title || (c.mediaType==='page'?'Media page '+new URL(c.extractorPageUrl).pathname:'Detected media'), host: new URL(c.extractorPageUrl||c.mediaUrl).host,
    detail: [c.mediaType==='page'?'Page available for desktop inspection':c.mediaType === 'hls' ? 'HLS playlist' : c.mediaType === 'dash' ? 'DASH manifest' : 'Direct media', c.drm ? 'Protected media · unsupported' : null, c.width && c.height ? `${c.width} × ${c.height}` : null].filter(Boolean).join(' · ')};
}

// Inline frames are JPEG-only, byte- and dimension-bounded, and never bridge data.
export function safeSnapshot(value){
 if(typeof value!=='string'||value.length>48000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value))return null;
 try{const bytes=atob(value.slice(23));if(bytes.charCodeAt(0)!==255||bytes.charCodeAt(1)!==216)return null;let i=2;
 while(i+8<bytes.length){if(bytes.charCodeAt(i++)!==255)return null;const marker=bytes.charCodeAt(i++),length=bytes.charCodeAt(i)*256+bytes.charCodeAt(i+1);if(length<2)return null;
 if([192,193,194].includes(marker)){const h=bytes.charCodeAt(i+3)*256+bytes.charCodeAt(i+4),w=bytes.charCodeAt(i+5)*256+bytes.charCodeAt(i+6);return w>0&&w<=320&&h>0&&h<=180?value:null;}i+=length;}
 }catch{}return null;
}
