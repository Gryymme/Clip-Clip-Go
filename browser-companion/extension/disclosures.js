const controllers=new WeakMap();
export function disclosure(button,panel,{details=null,labels=false}={}){
 let expanded=false,animation=null,generation=0;
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 function set(open,immediate=false){
  const token=++generation,start=panel.hidden?0:panel.getBoundingClientRect().height;animation?.cancel();animation=null;expanded=open;
  button.setAttribute('aria-expanded',String(open));if(labels)button.textContent=open?'See less':'Learn more';
  if(!open&&panel.contains(panel.ownerDocument?.activeElement))button.focus();panel.inert=!open;
  if(open){if(details)details.open=true;panel.hidden=false;}
  const finish=()=>{if(token!==generation)return;animation=null;panel.inert=!expanded;panel.style.height='';panel.style.overflow='';panel.hidden=!expanded;if(details)details.open=expanded;};
  if(immediate||reduced()||typeof panel.animate!=='function'){finish();return;}
  panel.hidden=false;panel.inert=true;panel.style.overflow='hidden';
  animation=panel.animate([{height:start+'px',opacity:open?0.5:1},{height:(open?panel.scrollHeight:0)+'px',opacity:open?1:0}],{duration:140,easing:'ease-in-out',fill:'both'});
  const running=animation;running.finished.then(()=>{finish();running.cancel();}).catch(()=>{});
 }
 const click=event=>{event.preventDefault();set(!expanded);};button.addEventListener('click',click);set(false,true);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(animation&&expanded)set(true);}):null;
 if(panel.firstElementChild)observer?.observe(panel.firstElementChild);
 const media=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
 const motion=()=>{if(media?.matches)set(expanded,true);};media?.addEventListener?.('change',motion);
 return {set,get expanded(){return expanded;},dispose(){generation++;animation?.cancel();observer?.disconnect();button.removeEventListener('click',click);media?.removeEventListener?.('change',motion);}};
}
export function resetDisclosures(scope){for(const button of scope.querySelectorAll?.('[aria-expanded]')||[])controllers.get(button)?.set(false,true);}
export function closeDisclosure(details){const controller=controllers.get(details);if(controller)controller.set(false,true);else details.open=false;}
export function setupDisclosures(doc=document){
 const all=[];let index=0;
 for(const p of doc.querySelectorAll?.('[data-short]')||[]){
  const full=p.textContent,button=doc.createElement('button'),panel=doc.createElement('div'),text=doc.createElement('p');
  button.type='button';button.className='inline-disclosure';button.textContent='Learn more';panel.id='explanation-'+(++index);button.setAttribute('aria-controls',panel.id);text.textContent=full;panel.append(text);p.textContent=p.dataset.short+' ';p.append(button);p.after(panel);const control=disclosure(button,panel,{labels:true});controllers.set(button,control);all.push(control);
 }
 for(const details of doc.querySelectorAll?.('details')||[]){
  const summary=details.querySelector('summary');if(!summary)continue;const panel=doc.createElement('div'),inner=doc.createElement('div');
  for(const node of [...details.childNodes])if(node!==summary)inner.append(node);panel.append(inner);details.append(panel);panel.id='section-'+(++index);summary.setAttribute('aria-controls',panel.id);const control=disclosure(summary,panel,{details});controllers.set(details,control);controllers.set(summary,control);all.push(control);
 }
 return ()=>all.forEach(c=>c.dispose());
}
