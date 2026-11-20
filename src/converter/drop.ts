export function insideDrop(position:{x:number;y:number},rect:{left:number;right:number;top:number;bottom:number},ratio:number):boolean {
 if(!Number.isFinite(ratio)||ratio<=0)return false;
 const x=position.x/ratio,y=position.y/ratio;
 return x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom;
}
export function dropError(paths:readonly string[],multiple:boolean,locked:boolean):string|null {
 if(locked)return 'Finish or cancel the current operation before changing files.';
 if(!paths.length)return 'Drop supported local files, not URLs.';
 if(!multiple&&paths.length!==1)return 'Choose one file.';
 if(paths.length>100)return 'Drop at most 100 images.';
 return null;
}
