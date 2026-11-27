import {candidateLabel} from './model.js';
export function renderCandidates(root, candidates, selected, choose, doc = document,enhance=()=>{}) {
  const focused=doc.activeElement?.name==='candidate'&&root.contains?.(doc.activeElement)?doc.activeElement.value:null;let restore;
  root.replaceChildren();
  for (const c of candidates) {
    const info = candidateLabel(c), row = doc.createElement('div'), radio = doc.createElement('input'), text = doc.createElement('label'),poster=doc.createElement('div'),fallback=doc.createElement('span');
    row.className = 'candidate'; radio.type = 'radio'; radio.name = 'candidate'; radio.value = c.id; radio.checked = selected === c.id;radio.disabled=c.drm===true;
    radio.addEventListener('change', () => choose(c.id));
    radio.id='candidate-'+c.id;text.htmlFor=radio.id;poster.className='candidate-poster';fallback.className='poster-fallback';fallback.textContent='▶';fallback.setAttribute?.('aria-hidden','true');poster.append(fallback);enhance(poster,c);
    for (const [tag, value] of [['strong', info.title], ['small', info.host], ['small', info.detail]]) { const el = doc.createElement(tag); el.textContent = value; el.dir = 'auto'; text.append(el); }
    row.append(radio,poster,text); root.append(row);
    if(radio.value===focused)restore=radio;
  }
  restore?.focus?.();
}
