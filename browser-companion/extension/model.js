// Independently implemented from public Chrome APIs. No response bodies or credentials.
export const TTL = 10 * 60_000;
export const MAX_CANDIDATES = 50;
export function httpUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function originPattern(value) { const u = httpUrl(value); return u ? new URL(u).origin + '/*' : null; }
export function mediaKind(value, contentType = '') {
  const valid = httpUrl(value); if (!valid) return null;
  const path = new URL(valid).pathname.toLowerCase(), type = contentType.split(';')[0].trim().toLowerCase();
  if (/\.(?:m4s|ts|cmfv|cmfa|key)$/i.test(path) || /(?:^|\/)(?:init|segment|seg|chunk|fragment)[-_\d][^/]*\.(?:mp4|aac|webm)$/i.test(path)) return null;
  if (/\.m3u8$/i.test(path) || ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'].includes(type)) return 'hls';
  if (/\.mpd$/i.test(path) || type === 'application/dash+xml') return 'dash';
  if (/\.(?:mp4|webm|mkv|mov|m4v|mp3|m4a|ogg|opus|wav|flac|aac)$/i.test(path) || /^(?:video|audio)\//.test(type) && !['video/mp2t', 'audio/aacp'].includes(type)) return 'direct';
  return null;
}
export function prune(sessions, now = Date.now()) {
  for (const [tab, s] of Object.entries(sessions)) {
    if (!s || s.expiresAt <= now || s.startedAt > now + 60_000) { delete sessions[tab]; continue; }
    s.candidates = s.candidates.filter(c => c.expiresAt > now).slice(-MAX_CANDIDATES);
    for(const[id,request]of Object.entries(s.requests||{}))if(!request||now-request.at>TTL)delete s.requests[id];
  }
  // Stay well below storage.session's quota, even with maximum-length signed URLs.
  while(JSON.stringify(sessions).length>2*1024*1024){const oldest=Object.values(sessions).filter(s=>s.candidates.length).sort((a,b)=>a.candidates[0].observedAt-b.candidates[0].observedAt)[0];if(!oldest)break;oldest.candidates.shift();}
  return sessions;
}
export function addCandidate(s, data, now = Date.now(), uuid = () => crypto.randomUUID()) {
  const mediaUrl = httpUrl(data.mediaUrl), kind = mediaKind(mediaUrl, data.contentType) ?? (data.dom && mediaUrl ? 'direct' : null);
  if (!kind || !mediaUrl || !Number.isInteger(data.frameId) || data.frameId < 0 || data.frameId > 1_000_000 || s.expiresAt <= now || data.navigationId !== s.navigationId || data.observedAt < s.startedAt) return false;
  // A full URL is the identity. Never remove signed query parameters or fragments.
  const previous=s.candidates.find(c => c.mediaUrl === mediaUrl && c.frameId === data.frameId);
  if (previous) { if(data.drm===true)previous.drm=true;if (!previous.context.referer && httpUrl(data.referer)) previous.context.referer=httpUrl(data.referer); if (!previous.width && Number.isInteger(data.width) && data.width>0 && data.width<=32768) previous.width=data.width; if (!previous.height && Number.isInteger(data.height) && data.height>0 && data.height<=32768) previous.height=data.height; return false; }
  if (s.candidates.some(c => c.mediaType !== 'direct' && new URL(c.mediaUrl).origin === new URL(mediaUrl).origin && c.frameId === data.frameId) && /\.(?:aac|mp4)$/i.test(new URL(mediaUrl).pathname) && /(?:seg|chunk|fragment|init)[-_\d]/i.test(new URL(mediaUrl).pathname)) return false;
  s.candidates.push({id: uuid(), pageUrl: s.pageUrl, frameUrl: httpUrl(data.frameUrl) ?? s.pageUrl, mediaUrl, mediaType: kind,
    title: typeof data.title === 'string' && data.title.trim() ? Array.from(data.title).slice(0, 1024).join('') : s.title || null,
    width: Number.isInteger(data.width) && data.width > 0 && data.width <= 32768 ? data.width : null,
    height: Number.isInteger(data.height) && data.height > 0 && data.height <= 32768 ? data.height : null,
    drm: data.drm===true ? true : null,
    frameId: data.frameId, documentId: String(data.documentId ?? '').slice(0, 128), navigationId: s.navigationId,
    observedAt: now, expiresAt: Math.min(now + TTL, s.expiresAt), context: {referer: httpUrl(data.referer)}});
  if (s.candidates.length > MAX_CANDIDATES) s.candidates.shift();
  return true;
}
export function candidateLabel(c) {
  return {title: c.title || 'Detected media', host: new URL(c.mediaUrl).host,
    detail: [c.mediaType === 'hls' ? 'HLS playlist' : c.mediaType === 'dash' ? 'DASH manifest' : 'Direct media', c.drm ? 'Protected media · unsupported' : null, c.width && c.height ? `${c.width} × ${c.height}` : null].filter(Boolean).join(' · ')};
}
