import {candidateLabel} from './model.js';
export function renderCandidates(root, candidates, selected, choose, doc = document) {
  const focused=doc.activeElement?.name==='candidate'&&root.contains?.(doc.activeElement)?doc.activeElement.value:null;let restore;
  root.replaceChildren();
  for (const c of candidates) {
    const info = candidateLabel(c), row = doc.createElement('label'), radio = doc.createElement('input'), text = doc.createElement('span');
    row.className = 'candidate'; radio.type = 'radio'; radio.name = 'candidate'; radio.value = c.id; radio.checked = selected === c.id;radio.disabled=c.drm===true;
    radio.addEventListener('change', () => choose(c.id));
    for (const [tag, value] of [['strong', info.title], ['small', info.host], ['small', info.detail]]) { const el = doc.createElement(tag); el.textContent = value; el.dir = 'auto'; text.append(el); }
    row.append(radio, text); root.append(row);
    if(radio.value===focused)restore=radio;
  }
  restore?.focus?.();
}
