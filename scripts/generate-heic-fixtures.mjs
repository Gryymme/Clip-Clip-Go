// Project-owned test patterns, encoded by the pinned bundled FFmpeg/libx265.
// Minimal ISO/IEC 14496-12 / HEIF item container: real HEVC, never renamed PNG/JPEG.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const ffmpeg=path.join(root,'src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe');
const manifest=JSON.parse(readFileSync(path.join(root,'scripts/ffmpeg-manifest.json'),'utf8'));
if(createHash('sha256').update(readFileSync(ffmpeg)).digest('hex')!==manifest.binaries.ffmpeg.sha256)throw Error('Fixture generation requires the hash-verified bundled FFmpeg. Run npm run engines:prepare.');
const output=path.join(root,'tests/fixtures/heic');
const work=path.join(root,'.engine-cache/heic');
mkdirSync(output,{recursive:true});mkdirSync(work,{recursive:true});
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const bytes=(...v)=>Buffer.concat(v.map(x=>typeof x==='string'?Buffer.from(x):Buffer.isBuffer(x)?x:Buffer.from(x)));
const box=(type,...data)=>{const b=bytes(...data);return bytes(u32(b.length+8),type,b);};
const full=(type,version,...data)=>box(type,[version,0,0,0],...data);
function encode(name,blue=false,depth=8){
 const w=64,h=48;
 const rgb=Buffer.alloc(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const color=blue?[0,0,255]:y<24?(x<32?[255,0,0]:[0,255,0]):(x<32?[255,255,0]:[0,0,255]);
  rgb.set(color,(y*w+x)*3);
 }
 const ppm=path.join(work,`${name}.ppm`),mp4=path.join(work,`${name}.mp4`);
 writeFileSync(ppm,bytes(`P6\n${w} ${h}\n255\n`,rgb));
 const result=spawnSync(ffmpeg,['-v','error','-y','-i',ppm,'-frames:v','1','-c:v','libx265','-threads','1','-x265-params','pools=none:frame-threads=1:lossless=1:keyint=1:log-level=error','-pix_fmt',depth===8?'yuv420p':'yuv420p10le','-tag:v','hvc1',mp4],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error(result.stderr);
 const data=readFileSync(mp4);
 const atom=type=>{const i=data.indexOf(type);if(i<4)throw Error(`Missing ${type}`);return data.subarray(i+4,i-4+data.readUInt32BE(i-4));};
 return {data:atom('mdat'),hvcc:atom('hvcC'),w,h,depth};
}
const pattern=encode('pattern'),blue=encode('blue',true),ten=encode('ten',false,10);
function container(name,items,primary,refs=[]){
 const properties=[],associations=[];
 for(const item of items){
  const props=[];
  const add=(type,data,essential=false)=>{properties.push(box(type,data));props.push(properties.length|(essential?128:0));};
  if(item.type==='hvc1')add('hvcC',item.hvcc,true);
  add('ispe',bytes([0,0,0,0],u32(item.w),u32(item.h)),true);
  add('pixi',bytes([0,0,0,0,3],Array(3).fill(item.depth??8)));
  add('colr',bytes('nclx',u16(1),u16(13),u16(1),[0]));
  if(item.crop)add('clap',bytes(u32(32),u32(1),u32(24),u32(1),u32(0),u32(1),u32(0),u32(1)),true);
  if(item.rotate!==undefined)add('irot',[item.rotate],true);
  if(item.mirror!==undefined)add('imir',[item.mirror],true);
  if(item.aux)add('auxC',bytes([0,0,0,0],item.aux,'\0'));
  associations.push(bytes(u16(item.id),[props.length],props));
 }
 const ftyp=box('ftyp','heic',u32(0),'mif1','heic');
 const makeMeta=offset=>{
  let at=offset;
  const locations=items.map(item=>{const b=bytes(u16(item.id),u16(0),u16(1),u32(at),u32(item.data.length));at+=item.data.length;return b;});
  return full('meta',0,
   full('hdlr',0,u32(0),'pict',Buffer.alloc(12),'ClipClipGO fixture\0'),
   full('pitm',0,u16(primary)),
   full('iloc',0,[0x44,0],u16(items.length),...locations),
   full('iinf',0,u16(items.length),...items.map(item=>full('infe',2,u16(item.id),u16(0),item.type,`Image ${item.id}\0`))),
   box('iprp',box('ipco',...properties),full('ipma',0,u32(items.length),...associations)),
   ...(refs.length?[full('iref',0,...refs.map(r=>box(r.type,u16(r.from),u16(r.to.length),...r.to.map(u16))))]:[]));
 };
 const meta=makeMeta(0);
 writeFileSync(path.join(output,name),bytes(ftyp,makeMeta(ftyp.length+meta.length+8),box('mdat',...items.map(i=>i.data))));
}
const item=(id,p=pattern,extra={})=>({...p,id,type:'hvc1',...extra});
container('pattern.heic',[item(1)],1);
container('rotated.heic',[item(1,pattern,{rotate:1})],1);
container('mirrored.heic',[item(1,pattern,{mirror:0})],1);
container('cropped.heic',[item(1,pattern,{crop:true})],1);
container('transformed.heic',[item(1,pattern,{crop:true,rotate:1,mirror:0})],1);
const tiff=Buffer.from('49492a0008000000010012010300010000000600000000000000','hex');
container('rotated-exif.heic',[item(1,pattern,{rotate:1}),{id:2,type:'Exif',w:64,h:48,data:bytes(u32(6),'Exif\0\0',tiff)}],1,[{type:'cdsc',from:2,to:[1]}]);
container('alpha.heic',[item(1),item(2,blue,{aux:'urn:mpeg:hevc:2015:auxid:1'})],1,[{type:'auxl',from:2,to:[1]}]);
container('primary-second.heic',[item(1,blue),item(2)],2);
container('ten-bit.heic',[item(1,ten)],1);
container('grid.heic',[item(1),item(2,blue),{id:3,type:'grid',w:128,h:48,data:bytes([0,0,0,1],u16(128),u16(48))}],3,[{type:'dimg',from:3,to:[1,2]}]);
container('grid-rotated.heic',[item(1),item(2,blue),{id:3,type:'grid',w:128,h:48,rotate:1,data:bytes([0,0,0,1],u16(128),u16(48))}],3,[{type:'dimg',from:3,to:[1,2]}]);
console.log('Generated genuine HEVC-in-HEIF fixtures with bundled FFmpeg.');
