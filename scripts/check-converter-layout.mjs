// Isolated development fixtures: existing Vite/React only. No native dialogs,
// desktop control, new browser stack, real jobs or production demo toggles.
import {createServer} from 'vite';
import {createElement as h} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {default:Converter}=await server.ssrLoadModule('/src/converter/Converter.tsx');
 const {default:ImagesToPdf}=await server.ssrLoadModule('/src/converter/ImagesToPdf.tsx');
 const {default:Shell}=await server.ssrLoadModule('/src/components/AppShell.tsx');
 const {initialSelection}=await server.ssrLoadModule('/src/converter/selection.ts');
 const noop=()=>{};
 const base={engine:null,engineLoading:false,media:null,image:null,pdf:null,pdfPages:'',rangeError:null,outputIsFolder:false,images:[],pageSize:'a4',adding:false,probing:false,probeError:null,error:null,job:null,busy:false,starting:false,cancelling:false,formats:[],availability:null,canConvert:false,preview:{state:{status:'idle',path:''},failed:noop}};
 for(const key of ['chooseImages','setPageSize','moveImage','removeImage','startImagePdf','configure','start','cancel','setPdfPages','setCustomSize','selectionError'])base[key]=noop;
 const files=[
  {name:'2026 Annual Review — FINAL (revised after board approval) v12.png',path:'C:\\Projects\\Annual review\\Approved assets\\2026 Annual Review — FINAL (revised after board approval) v12.png',sizeBytes:'134217728'},
  {name:'IMG_20261120_183022_HDR_portrait_edited_edited.PNG',path:'C:\\Images\\Campaign\\Source images\\IMG_20261120_183022_HDR_portrait_edited_edited.PNG',sizeBytes:'1'},
  {name:'最終版_承認済み_販売報告書.TIFF',path:'C:\\Images\\International\\最終版_承認済み_販売報告書.TIFF',sizeBytes:'0'},
 ];
 const {initialSize}=await server.ssrLoadModule('/src/converter/pageSize.ts');
 base.customSize=initialSize;base.pageSizeError=null;
 const fixtures=[];
 function view(page,node){return render(h(Shell,{activePage:page,onNavigate:noop},node));}
 for(const [name,images]of [['Images empty',[]],['Images one',[files[0]]],['Images worst case',files],['Images 100',Array.from({length:100},(_,i)=>({...files[i%3],path:files[i%3].path+`-${i}`}))]]){
  const html=view('Images to PDF',h(ImagesToPdf,{conversion:{...base,images,pageSize:'image'},selecting:false}));assert.equal((html.match(/class="file-summary(?: file-empty)?"/g)??[]).length,images.length+1);assert.ok(html.includes('Image sized'));fixtures.push([name,html]);
 }
 for(const [name,extra] of [['Custom pixel page',{customSize:{...initialSize,unit:'px'},pageSizeError:null}],['Invalid custom page',{customSize:{...initialSize,width:NaN,widthDraft:''},pageSizeError:'Page dimensions must be finite.'}]]){
 const html=view('Images to PDF',h(ImagesToPdf,{conversion:{...base,...extra,images:files,pageSize:'custom'},selecting:false}));assert.ok(html.includes('custom-width'));assert.ok(html.includes('custom-height'));assert.ok(html.includes('custom-unit'));if(name==='Custom pixel page')assert.ok(html.includes('custom-dpi'));fixtures.push([name,html]);
 }
 for(const [name,format,category,extra]of [
  ['Image loading','png','image',{preview:{state:{status:'loading',path:files[0].path},failed:noop}}],
  ['Image fallback','png','image',{image:{width:16384,height:976,format:'png',hasAlpha:true,orientationApplied:true},preview:{state:{status:'fallback',path:files[0].path},failed:noop},canConvert:true}],
  ['Video','mp4','video',{media:{duration:3723.5,video:{index:0,codec:'h264'},audio:null,container:'mp4',formats:[]}}],
  ['Audio','mp3','audio',{}],['PDF range','pdf','document',{pdf:{pages:500,hasText:true},pdfPages:'1-3, 499-500',outputIsFolder:true}],
  ['Scanned PDF','pdf','document',{pdf:{pages:500,hasText:false},outputIsFolder:true}],
  ['Invalid range','pdf','document',{pdf:{pages:500,hasText:true},pdfPages:'501',rangeError:'Choose pages between 1 and 500.',outputIsFolder:true}],
 ]){
  const file={...files[0],format,category};const state={...initialSelection,file,output:format==='pdf'?'png':format};
  const html=view('Converter',h(Converter,{state,dispatch:noop,busy:{current:false},conversion:{...base,...extra}}));assert.ok(html.includes('class="file-summary"'));assert.ok(html.includes('File details'));assert.ok(!html.includes('Conversion mode'));assert.ok(!html.includes('Single file'));
  if(name==='Image fallback'){assert.ok(html.includes('No preview'));assert.ok(/<button[^>]*class="button button-primary"[^>]*>Convert file<\/button>/.test(html));}
  if(name==='Scanned PDF')assert.ok(html.includes('OCR is not supported'));
  if(name==='Invalid range')assert.ok(html.includes('aria-invalid="true"'));
  fixtures.push([name,html]);
 }
 const {FileCard}=await server.ssrLoadModule('/src/converter/FileSummary.tsx');
 const card=render(h(FileCard,{file:{...files[0],category:'image',format:'png'},preview:{status:'ready',path:files[0].path,image:{dataUrl:'data:image/png;base64,aA==',width:80,height:40,sourceWidth:1200,sourceHeight:600}},onPreviewError:noop,actions:h('button',null,'Remove')}));
 assert.ok(card.includes('<img'));assert.ok(card.includes('1,200'));assert.ok(card.includes('Remove'));assert.ok(card.includes(files[0].name));
 const empty=view('Converter',h(Converter,{state:initialSelection,dispatch:noop,busy:{current:false},conversion:base}));fixtures.push(['Empty converter',empty]);
 for(const [name,html]of fixtures){assert.ok(!html.includes('undefined'),name);assert.ok(!html.includes('NaN'),name);assert.ok(html.includes('aria-label="ClipClipGO"'));assert.ok(html.includes('Images to PDF'));assert.ok(html.includes(`© ${new Date().getFullYear()}`));assert.ok(html.indexOf('sidebar-footer')>html.indexOf('</nav>'));assert.equal((html.match(/aria-current="page"/g)??[]).length,1);}
 // Render both destinations again from the same app-owned state snapshots.
 const retained={...base,images:[files[2],files[0]],pageSize:'image',pdfPages:'2-4'};
 const before=view('Images to PDF',h(ImagesToPdf,{conversion:retained,selecting:false}));
 view('Converter',h(Converter,{state:initialSelection,dispatch:noop,busy:{current:false},conversion:retained}));
 assert.equal(view('Images to PDF',h(ImagesToPdf,{conversion:retained,selecting:false})),before);
 assert.deepEqual(retained.images,[files[2],files[0]]);assert.equal(retained.pdfPages,'2-4');
 const css=await readFile('src/styles.css','utf8');
 assert.ok(css.includes('--radius-base: 12px'));assert.ok(css.includes('minmax(0,1fr)'));assert.ok(!css.includes('border-inline-start-color'));assert.ok(!css.includes('position: fixed'));
 const fixtureCss=css.replaceAll('/fonts/montserrat/','../../public/fonts/montserrat/');
 const documents=fixtures.flatMap(([name,html])=>['light','dark'].map(theme=>[name+' / '+theme,`<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><style>${fixtureCss}</style><div id="root">${html}</div></html>`]));
 const escaped=JSON.stringify(documents).replaceAll('<','\\u003c');
 const html=`<!doctype html><meta charset="utf-8"><title>ClipClipGO development layout fixtures</title><style>body{margin:0;padding:16px;font:14px system-ui,sans-serif;color:#eee;background:#181818}.tools{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;align-items:center}select,button{font:inherit;padding:8px}iframe{display:block;border:1px solid #555;max-width:none}</style><div class="tools"><label>Dataset <select id="data">${documents.map(([name])=>`<option>${name}</option>`).join('')}</select></label><label>Viewport <select id="size"><option>1100x740</option><option>640x480</option><option>320x480</option><option>1100x320</option><option>2560x1000</option></select></label><label><input type="checkbox" id="large">200% text</label><span>Development fixtures; native boundaries mocked. No dialogs or jobs run.</span></div><iframe title="Application layout fixture"></iframe><script>const docs=new Map(${escaped}),frame=document.querySelector('iframe'),data=document.querySelector('#data'),size=document.querySelector('#size'),large=document.querySelector('#large');const p=new URLSearchParams(location.search);data.value=p.get('data')||'Image fallback / dark';size.value=p.get('size')||'1100x740';large.checked=p.get('large')==='true';function show(){const[w,h]=size.value.split('x');frame.style.width=w+'px';frame.style.height=h+'px';frame.srcdoc=docs.get(data.value)+(large.checked?'<style>:root{font-size:200%}</style>':'');history.replaceState(null,'','?'+new URLSearchParams({data:data.value,size:size.value,large:large.checked}));}data.onchange=size.onchange=large.onchange=show;show();</script>`;
 await mkdir('.engine-cache/ui-check',{recursive:true});await writeFile('.engine-cache/ui-check/converter.html',html);
 const report={checks:fixtures.length,themes:['light','dark'],sharedImageCard:true,rendered:true,visualInspection:false,pixelMeasurements:false,widthsReviewed:[320,640,1100,2560],heightsReviewed:[320,480,740,1000],textScaling:'200% CSS review / dev fixture toggle',findings:[{field:'Short/narrow sidebar',severity:'Broken',cause:'Unbounded navigation height could consume the content region',fix:'Flexible navigation region between nonshrinking header/footer, compact narrow layout bounded at 48dvh'},{field:'Long filename/path',severity:'Fragile',cause:'Intrinsic grid minimums and always-visible paths dominate workflow',fix:'minmax(0,1fr), wrapping filename, proportional path in disclosure'},{field:'100 image rows',severity:'Broken',cause:'Output controls would be hundreds of rows below selection',fix:'Keyboard-accessible bounded list scrolling'},{field:'Preview text scaling',severity:'Fragile',cause:'A rem-sized thumbnail can consume the row at 200% text',fix:'88x80px footprint, responsive action placement and concentric nested corners'}],heldUp:['Zero/one/100 image list states','500-page PDF count and 2048-character range bound','Preview failure leaves Convert enabled','Single-file and image-PDF state snapshots retained across destination rendering','Exactly one selected sidebar destination'],limitations:'SSR/component assertions and CSS inference; no visual desktop or browser pixel verification.'};
 await writeFile('.engine-cache/ui-check/report.json',JSON.stringify(report,null,2)+'\n');console.log(`${fixtures.length} shell/component fixtures in both themes plus shared-card and navigation/state assertions passed. Layout reviewed by CSS; actual pixels and native dialogs remain manual.`);
} finally {await server.close();}
