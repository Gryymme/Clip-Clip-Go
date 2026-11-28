export type PageSize = 'a4'|'letter'|'legal'|'image'|'custom';
export type Unit = 'in'|'cm'|'px';
export type PageSizePayload = Exclude<PageSize,'custom'> | {custom:{width:number;height:number}};
export const initialPageSize: PageSize = 'image';
export const initialSize = {width:612,height:792,unit:'in' as Unit,dpi:'96',widthDraft:null as string|null,heightDraft:null as string|null};
export type CustomSize = typeof initialSize;
export function unitFactor(unit:Unit,dpi:number){return unit==='in'?72:unit==='cm'?72/2.54:72/dpi;}
export function displayDimension(points:number,unit:Unit,dpi:number){return Number((points/unitFactor(unit,dpi)).toPrecision(12)).toString();}
export function customSizeErrors(s:CustomSize,mode:PageSize='custom'):Partial<Record<'width'|'height'|'dpi',string>> {
 if(mode!=='custom')return {};
 const errors:Partial<Record<'width'|'height'|'dpi',string>>={},dpi=Number(s.dpi);
 if(s.unit==='px'&&(!Number.isFinite(dpi)||dpi<1||dpi>2400)){errors.dpi='DPI must be between 1 and 2400 for pixel dimensions.';return errors;}
 for(const axis of ['width','height'] as const){const name=axis==='width'?'Width':'Height',value=s[axis];
  if(!Number.isFinite(value))errors[axis]=name+' must be a finite number.';
  else if(value<=72)errors[axis]=name+' must exceed 1 inch / 2.54 cm.';
  else if(value>14400)errors[axis]=name+' must be at most 200 inches / 508 cm.';
 }
 return errors;
}
export function sizeError(s:CustomSize):string|null {return Object.values(customSizeErrors(s))[0]??null;}
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
