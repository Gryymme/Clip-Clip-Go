// Headless asset/config verification using Node built-ins; no browser/desktop access.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {inflateSync,deflateSync} from 'node:zlib';
import {createServer} from 'vite';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
function png(bytes) {
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  assert.equal(bytes[24],8);assert.equal(bytes[25],6);assert.equal(bytes[28],0);
  const chunks=[];
  for(let p=8;p<bytes.length;) {const n=bytes.readUInt32BE(p);if(bytes.toString('ascii',p+4,p+8)==='IDAT')chunks.push(bytes.subarray(p+8,p+8+n));p+=12+n;}
  const raw=inflateSync(Buffer.concat(chunks)),pixels=Buffer.alloc(width*height*4),stride=width*4;
  const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];assert.ok(filter<=4);
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-stride]:0,c=y&&x>=4?pixels[i-stride-4]:0;
      const predict=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];pixels[i]=(raw[y*(stride+1)+1+x]+predict)&255;
    }
  }
  return {width,height,pixels};
}
function verify(bytes,size) {
  const decoded=png(bytes);assert.equal(decoded.width,size);assert.equal(decoded.height,size);
  const {pixels}=decoded;let opaqueWhite=0,opaqueBlue=0,minX=size,minY=size,maxX=0,maxY=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=(y*size+x)*4,[r,g,b,a]=pixels.subarray(i,i+4);
    if(a) {minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    if(a===255) {assert.ok(r===255&&g===255&&b===255 || r===66&&g===133&&b===244);if(r===255)opaqueWhite++;else opaqueBlue++;}
    if(x===0||y===0||x===size-1||y===size-1)assert.equal(a,0,'transparent, unclipped outer edge');
  }
  assert.ok(opaqueWhite>0&&opaqueBlue>0);assert.ok(minX>=Math.floor(size*.05)&&size-1-maxX>=Math.floor(size*.05));
  assert.ok(Math.abs(minX-(size-1-maxX))<=1 && Math.abs(minY-(size-1-maxY))<=1,'centered bounds');
  let runs=0,inside=false;const colors=[];
  for(let x=0;x<size;x++) {const i=(Math.floor(size/2)*size+x)*4,hit=pixels[i+3]>=128;if(hit&&!inside){runs++;colors.push(pixels[i]);}inside=hit;}
  assert.equal(runs,3,`three distinct chevrons at ${size}px`);assert.deepEqual(colors.slice(0,2),[255,255]);assert.ok(Math.abs(colors[2]-66)<=1,'blue antialiased edge (opaque pixels checked exactly above)');
  return decoded;
}
const master=await readFile('src-tauri/icons/app.svg','utf8');
assert.equal((master.match(/<path /g)??[]).length,3);assert.equal((master.match(/fill="#FFFFFF"/g)??[]).length,2);assert.equal((master.match(/fill="#4285F4"/g)??[]).length,1);assert.ok(!/<(?:rect|image|text|filter|linearGradient)\b/.test(master));
const config=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
assert.equal(config.identifier,'com.clipclipgo.app');
for(const path of config.bundle.icon)await access(`src-tauri/${path}`);
verify(await readFile('src-tauri/icons/icon.png'),512);
const ico=await readFile('src-tauri/icons/icon.ico');assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
const sizes=[];
for(let n=0;n<ico.readUInt16LE(4);n++) {const p=6+n*16,s=ico[p]||256;assert.equal(ico[p+1]||256,s);assert.equal(ico.readUInt16LE(p+6),32);const length=ico.readUInt32LE(p+8),offset=ico.readUInt32LE(p+12);assert.ok(offset+length<=ico.length);verify(ico.subarray(offset,offset+length),s);sizes.push(s);}
assert.deepEqual(sizes,[16,24,32,48,64,128,256]);
const manifest=JSON.parse(await readFile('browser-companion/extension/manifest.json','utf8'));assert.equal(manifest.name,'ClipClipGO Companion');assert.deepEqual(manifest.icons,manifest.action.default_icon);
const small=[];
for(const [size,path]of Object.entries(manifest.icons))small.push(verify(await readFile(`browser-companion/extension/${path}`),Number(size)));
assert.equal(config.bundle.resources['../browser-companion/extension/'],'extension/');
// If Tauri's generated development package exists, it must contain current icons.
let packaged=false;
try{await access('src-tauri/target/debug/extension/manifest.json');packaged=true;}catch{}
if(packaged) {
  assert.deepEqual(JSON.parse(await readFile('src-tauri/target/debug/extension/manifest.json','utf8')),manifest);
  for(const path of Object.values(manifest.icons))assert.deepEqual(await readFile(`src-tauri/target/debug/extension/${path}`),await readFile(`browser-companion/extension/${path}`));
}
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {default:Shell}=await server.ssrLoadModule('/src/components/AppShell.tsx');
  const html=renderToStaticMarkup(h(Shell,{activePage:'Merge PDF',onNavigate:()=>{}},h('p',null,'Selected page')));
  assert.match(html,/<li class="navigation-group-start"><button[^>]*>.*?<span>Queue<\/span>/);
  assert.equal((html.match(/class="navigation-group-start"/g)??[]).length,1);
  assert.ok(html.includes('aria-current="page"'));assert.ok(html.includes('brand-accent">GO'));
} finally {await server.close();}
// Pixel-aligned review sheet: actual 16/24/32/48px rasters at 4x nearest-neighbor.
const width=640,height=240,pixels=Buffer.alloc(width*height*4);
for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=32;pixels[i+3]=255;}
for(const [n,source]of small.filter(s=>s.width<=48).entries())for(let y=0;y<source.height*4;y++)for(let x=0;x<source.width*4;x++){
  const si=(Math.floor(y/4)*source.width+Math.floor(x/4))*4,di=((24+y)*width+[16,112,240,400][n]+x)*4,a=source.pixels[si+3]/255;
  for(let c=0;c<3;c++)pixels[di+c]=Math.round(source.pixels[si+c]*a+32*(1-a));
}
// Minimal PNG encoder for the review artifact, separate from transparent assets.
const crc=buffer=>{let c=0xffffffff;for(const b of buffer){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
const chunk=(name,data)=>{const type=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,data])),out.length-4);return out;};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
const scan=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)pixels.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
await mkdir('.engine-cache/branding',{recursive:true});await writeFile('.engine-cache/branding/small-icons.png',Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]));
console.log(`Branding checks passed: transparent PNGs, exact opaque colors, padding, three small-size chevrons; ICO ${sizes.join('/')}px; config/navigation references${packaged?' and generated extension folder':''}.`);
