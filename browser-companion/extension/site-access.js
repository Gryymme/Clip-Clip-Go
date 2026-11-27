import {httpUrl} from './model.js';
// Match only HTTP(S) host grants returned by Chrome, never an app-maintained allowlist.
// Host-permission paths do not narrow access. Chrome remains the final authority.
export function grantedOrigin(value,origins=[]){
  const valid=httpUrl(value);if(!valid)return false;const url=new URL(valid);
  return origins.some(pattern=>{
    if(pattern==='<all_urls>')return true;
    const match=/^(https?|\*):\/\/([^/]+)\//.exec(pattern);if(!match)return false;
    if(match[1]!=='*'&&match[1]+':'!==url.protocol)return false;
    const host=match[2].toLowerCase();if(host==='*')return true;
    if(host.startsWith('*.'))return url.hostname===host.slice(2)||url.hostname.endsWith('.'+host.slice(2));
    return host===url.host||host===url.hostname;
  });
}
