// Isolated SSR layout fixture using existing Vite/React tooling, no browser stack,
// desktop control or native dialogs. Never imported by the application.
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {default:Converter}=await server.ssrLoadModule('/src/converter/Converter.tsx');
 const {initialSelection}=await server.ssrLoadModule('/src/converter/selection.ts');
 const base={engine:null,engineLoading:false,media:null,image:null,pdf:null,pdfPages:'',rangeError:null,mode:'imagesPdf',images:[],pageSize:'a4',adding:false,probing:false,probeError:null,error:null,job:null,busy:false,starting:false,cancelling:false,formats:[],availability:null,canConvert:false};
 for(const key of ['setMode','chooseImages','setPageSize','moveImage','removeImage','startImagePdf','configure','start','cancel','setPdfPages'])base[key]=()=>{};
 const files=[
  {name:'2026 Annual Review — FINAL (revised after board approval) v12.png',path:'C:\\Projects\\Annual review\\Approved assets\\2026 Annual Review — FINAL (revised after board approval) v12.png',sizeBytes:'134217728'},
  {name:'IMG_20261120_183022_HDR_portrait_edited_edited.PNG',path:'C:\\Images\\Campaign\\Source images\\IMG_20261120_183022_HDR_portrait_edited_edited.PNG',sizeBytes:'1'},
  {name:'最終版_承認済み_販売報告書.TIFF',path:'C:\\Images\\International\\最終版_承認済み_販売報告書.TIFF',sizeBytes:'0'},
 ];
 const cases=[['Empty',[]],['One',[files[0]]],['Worst case',files],['100 pages',Array.from({length:100},(_,i)=>({...files[i%3],path:files[i%3].path+`-${i}`}))]];
 const render=(controller,state=initialSelection)=>renderToStaticMarkup(createElement(Converter,{state,dispatch:()=>{},busy:{current:false},conversion:controller}));
 const sections=[];
 for(const [name,images]of cases){const html=render({...base,images});assert.equal((html.match(/class="image-pdf-name"/g)??[]).length,images.length);assert.ok(!html.includes('undefined'));assert.ok(!html.includes('NaN'));assert.ok(html.includes('id="pdf-page-size"'));sections.push(`<section data-case="${name}" hidden>${html}</section>`);}
 const file={name:'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf',path:'C:\\Documents\\Board review\\2026\\Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf',sizeBytes:'134217728',format:'pdf',category:'document'};
 for(const [name,hasText,error]of [['PDF range',true,null],['Scanned PDF',false,null],['Invalid range',true,'Choose pages between 1 and 500, with ascending ranges.']]){
  const html=render({...base,mode:'single',pdf:{pages:500,hasText},pdfPages:error?'501':'1-3, 499-500',rangeError:error},{...initialSelection,file,output:'png'});
  assert.ok(html.includes('id="pdf-pages"'));assert.ok(html.includes('500'));if(!hasText)assert.ok(html.includes('OCR is not supported'));if(error)assert.ok(html.includes('aria-invalid="true"'));sections.push(`<section data-case="${name}" hidden>${html}</section>`);
 }
 const css=await readFile('src/styles.css','utf8');
 const html=`<!doctype html><meta charset="utf-8"><title>Converter layout fixtures — development only</title><style>${css}body{padding:1rem}.fixture-controls{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:2rem}.fixture-controls button{padding:.5rem}body.large{font-size:200%}html:has(body.large){font-size:200%}</style><div class="fixture-controls"><label>Dataset <select id="case">${[...cases.map(c=>c[0]),'PDF range','Scanned PDF','Invalid range'].map(c=>`<option>${c}</option>`).join('')}</select></label><button id="scale">Toggle 200% text</button><p>Development fixtures. Native boundaries are mocked; no dialogs or conversion jobs run.</p></div>${sections.join('')}<script>const select=document.querySelector('#case');select.value=new URLSearchParams(location.search).get('data')||'Worst case';function show(){document.querySelectorAll('[data-case]').forEach(s=>s.hidden=s.dataset.case!==select.value);history.replaceState(null,'','?data='+encodeURIComponent(select.value));}select.onchange=show;show();document.querySelector('#scale').onclick=()=>document.body.classList.toggle('large');</script>`;
 await mkdir('.engine-cache/ui-check',{recursive:true});await writeFile('.engine-cache/ui-check/converter.html',html);
 const report={checks:7,rendered:true,visualInspection:false,fixtures:['Empty','One','Worst case','100 pages','PDF range','Scanned PDF','Invalid range'],widthsReviewed:[320,640,2560],textScaling:'200% (CSS review; no browser measurement)',fields:{filename:'NativeFile.name: Windows component length, no additional app length cap',path:'NativeFile.path: OS path, no additional UI cap',imageCount:'0–100',pageCount:'1–500',pageRange:'2048 characters',size:'native u64 serialized as decimal'},findings:[{field:'Page size options',before:'Long defaults inside native select labels',after:'Short labels and associated explanatory text',reason:'Native select text does not wrap at narrow widths/large text'},{field:'Removal focus',before:'Removed row could leave keyboard focus on body',after:'Focus next remove control or Add images',reason:'Keyboard continuity'}],limitations:'SSR and CSS inference only. Actual pixel bounds, visual alignment and native functionality require user confirmation.'};
 await writeFile('.engine-cache/ui-check/report.json',JSON.stringify(report,null,2)+'\n');
 console.log('Seven SSR edge-case fixtures passed. Reviewed 320–2560 px and 200% text through CSS; no browser/pixel or desktop verification claimed.');
} finally {await server.close();}
