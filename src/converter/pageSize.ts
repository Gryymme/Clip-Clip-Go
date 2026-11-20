export type PageSize = 'a4'|'letter'|'legal'|'image'|'custom';
export type Unit = 'in'|'cm'|'px';
export type PageSizePayload = Exclude<PageSize,'custom'> | {custom:{width:number;height:number}};
export const initialSize = {width:595.2755905511812,height:841.8897637795276,unit:'in' as Unit,dpi:'96',widthDraft:null as string|null,heightDraft:null as string|null};
export type CustomSize = typeof initialSize;
export function unitFactor(unit:Unit,dpi:number){return unit==='in'?72:unit==='cm'?72/2.54:72/dpi;}
export function displayDimension(points:number,unit:Unit,dpi:number){return Number((points/unitFactor(unit,dpi)).toPrecision(12)).toString();}
export function sizeError(s:CustomSize):string|null {
 const dpi=Number(s.dpi);
 if(s.unit==='px'&&(!Number.isFinite(dpi)||dpi<1||dpi>2400))return 'DPI must be between 1 and 2400.';
 if(![s.width,s.height].every(v=>Number.isFinite(v)&&v>=72&&v<=14400))return 'Page dimensions must be finite and between 1 and 200 inches (72–14,400 points).';
 if(s.width<=72||s.height<=72)return 'Page dimensions must exceed 1 inch to leave usable space inside the 0.5-inch margins.';
 return null;
}
export function editDimension(s:CustomSize,axis:'width'|'height',value:string):CustomSize {
 const n=value.trim()?Number(value):NaN;
 return {...s,[axis]:n*unitFactor(s.unit,Number(s.dpi)),[axis+'Draft']:value};
}
// Canonical points are untouched by presentation changes, so repeated switches cannot drift.
export function changeUnit(s:CustomSize,unit:Unit):CustomSize {return {...s,unit,widthDraft:null,heightDraft:null};}
export function changeDpi(s:CustomSize,dpi:string):CustomSize {return {...s,dpi,widthDraft:null,heightDraft:null};}
export function sizePayload(size:PageSize,custom:CustomSize):PageSizePayload {
 if(size!=='custom')return size;
 const error=sizeError(custom);if(error)throw Error(error);
 return {custom:{width:custom.width,height:custom.height}};
}
