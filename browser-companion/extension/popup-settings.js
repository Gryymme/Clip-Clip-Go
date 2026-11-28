import {closeDisclosure,resetDisclosures} from './disclosures.js';
import {grantedOrigin} from './site-access.js';
export function grantDescription(pattern){
  return pattern==='<all_urls>'?'All websites (broad access)':pattern.includes('*')&& !/^https?:\/\/[^*]+\/\*$/.test(pattern)?`${pattern} · wildcard grant; may cover multiple sites`:pattern;
}
export function setupSettings({doc=document,api=chrome,onOpen=()=>{},onClose=()=>{},onChange=async()=>{}}={}){
  const $=id=>doc.getElementById(id),dialog=$('settings-dialog');let previousFocus=null,signature='',loading=false;let themeTimer;
  const trace=(result,origins)=>{void api.runtime.sendMessage?.({type:'permissionTrace',entry:{action:'remove',result,origins}})?.catch(()=>{});};
  const note=text=>{$('settings-result').textContent=text;};
  async function update(){
    if(loading)return;loading=true;
    try{const {origins=[]}=await api.permissions.getAll();$('grants-count').textContent=`Granted websites (${origins.length})`;const key=JSON.stringify([...origins].sort());if(key===signature)return;signature=key;
      const list=$('site-grants');list.replaceChildren();
      if(!origins.length){const p=doc.createElement('p');p.textContent='No website access granted. Use “Allow this site” on the main screen.';list.append(p);}
      for(const origin of [...origins].sort()){
        const row=doc.createElement('div');row.className='site-grant';const label=doc.createElement('span');label.textContent=grantDescription(origin);label.dir='auto';const button=doc.createElement('button');button.type='button';button.className='secondary';button.textContent='Revoke';button.setAttribute('aria-label',`Revoke ${origin}`);
        button.onclick=async()=>{note('');button.disabled=true;try{const pending=api.permissions.remove({origins:[origin]});trace('started',[origin]);const removed=await pending;trace(String(removed),[origin]);await onChange();const remaining=await api.permissions.getAll();const covering=(remaining.origins||[]).filter(p=>grantedOrigin(origin,[p]));note(removed?(remaining.origins||[]).includes(origin)?'Chrome still reports this grant. Review site access in Chrome extension settings.':covering.length?'Still covered by '+covering.slice(0,8).join(', ')+'. Review that grant below; revoking it affects every site it covers.':'This grant was removed. Other remaining grants are listed below.':'Chrome did not remove this grant. Review site access in Chrome extension settings.');signature='';}catch{trace('threw',[origin]);note('Chrome could not remove this grant. Use Chrome extension settings to review access.');}finally{button.disabled=false;await update();}};
        row.append(label,button);list.append(row);
      }
    }catch{note('Could not read website access. Open Chrome extension settings to review it.');}finally{loading=false;}
  }
  function open(){if(dialog.open)return;note('');previousFocus=doc.activeElement;resetDisclosures(dialog);closeDisclosure($('grants-disclosure'));onOpen();doc.body.classList.add('settings-open');dialog.showModal();void update();}
  dialog.addEventListener('close',()=>{doc.body.classList.remove('settings-open');onClose();previousFocus?.focus();});
  // Native dialog provides modal focus containment and Escape/cancel semantics.
  const close=()=>{if(dialog.dataset?.closing)return;if(typeof dialog.animate!=='function'||matchMedia('(prefers-reduced-motion: reduce)').matches){dialog.close();return;}dialog.dataset.closing='true';dialog.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.98)'}],{duration:parseFloat(getComputedStyle(dialog).getPropertyValue('--motion-fast'))||100}).finished.catch(()=>{}).finally(()=>{delete dialog.dataset.closing;dialog.close();});};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('settings-open').onclick=open;$('settings-close').onclick=close;
  $('browser-permissions').onclick=()=>{void api.tabs.create({url:`chrome://extensions/?id=${api.runtime.id}`});};
  $('theme').value=doc.documentElement.dataset.theme||'dark';
  $('theme').onchange=async()=>{const theme=$('theme').value;if(!['light','dark'].includes(theme))return;try{await api.storage.local.set({theme});const root=doc.documentElement;if(root.dataset.theme!==theme){root.classList?.add('theme-changing');void root.offsetWidth;clearTimeout(themeTimer);themeTimer=setTimeout(()=>root.classList?.remove('theme-changing'),180);}root.dataset.theme=theme;}catch{note('Theme could not be saved. Try again.');}};
  const permissionsChanged=()=>{signature='';void update();void onChange().catch(()=>note('Access changed. Reopen the popup if discovery has not refreshed.'));};
  api.permissions.onAdded.addListener(permissionsChanged);api.permissions.onRemoved.addListener(permissionsChanged);
  return {open,update,dispose(){clearTimeout(themeTimer);api.permissions.onAdded.removeListener(permissionsChanged);api.permissions.onRemoved.removeListener(permissionsChanged);}};
}
