export interface GifOptions {maxEdge:number;fps:number}
export const defaultGifOptions:GifOptions={maxEdge:480,fps:10};
export function gifDimensions(size:{width:number;height:number}|null|undefined,options:GifOptions):{width:number;height:number}|null {
  if(!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width<=0 || size.height<=0 || ![320,480,640,960].includes(options.maxEdge) || ![10,15,20].includes(options.fps)) return null;
  const scale=Math.min(1,options.maxEdge/Math.max(size.width,size.height));
  return {width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))};
}
