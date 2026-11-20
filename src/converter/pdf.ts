import { identifyFile } from './formats.ts';
import type { NativeFile } from './selection.ts';
export function addImages(current: readonly NativeFile[], added: readonly NativeFile[]): NativeFile[] {
  if (added.some(f => identifyFile(f.name)?.category !== 'image')) throw Error('Choose supported still images only.');
  const result = [...current];
  for (const file of added) if (!result.some(f => f.path.toLowerCase() === file.path.toLowerCase())) result.push(file);
  if (result.length > 100) throw Error('Choose at most 100 images. Remove some before adding more.');
  return result;
}
export function moveImage(files: readonly NativeFile[], index: number, direction: -1 | 1): NativeFile[] {
  const next = index + direction;
  if (index < 0 || index >= files.length || next < 0 || next >= files.length) return [...files];
  const result = [...files]; [result[index], result[next]] = [result[next], result[index]]; return result;
}
export function pageRangeError(value: string, count: number): string | null {
  if (!value.trim()) return null;
  if (value.length > 2048) return 'Page range is too long.';
  for (const part of value.split(',')) {
    const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part.trim());
    if (!match) return 'Use page numbers and hyphen ranges, such as 1-3, 5.';
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > count) return `Choose pages between 1 and ${count}, with ascending ranges.`;
  }
  return null;
}

export function appendDroppedImages(current:readonly NativeFile[],added:readonly NativeFile[],locked=false){
 if(locked)return {files:[...current],rejected:['Finish or cancel the active conversion before changing files.']};
 const files=[...current],rejected:string[]=[];
 for(const file of added){
  if(identifyFile(file.name)?.category!=='image'){rejected.push(`${file.name}: unsupported image format.`);continue;}
  if(files.some(f=>f.path.toLowerCase()===file.path.toLowerCase()))continue;
  if(files.length>=100){rejected.push(`${file.name}: the 100-image limit has been reached.`);continue;}
  files.push(file);
 }
 return {files,rejected};
}
