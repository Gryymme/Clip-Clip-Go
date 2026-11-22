// Isolated SSR fixtures only: no desktop/browser control or native operations.
import {createServer} from 'vite';
import {createElement as h} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {default:MergePdf}=await server.ssrLoadModule('/src/converter/MergePdf.tsx');
  const {default:Shell}=await server.ssrLoadModule('/src/components/AppShell.tsx');
  const noop=()=>{};
  const base={mergeFiles:[],mergePages:0,mergeLimitError:null,canMerge:false,busy:false,adding:false,probing:false,engineLoading:false,starting:false,error:null,job:null,chooseMergeFiles:noop,selectionError:noop,moveMergeFile:noop,removeMergeFile:noop,startMerge:noop,cancel:noop};
  const files=[
    {name:'Q3 Board Deck — FINAL (revised after board approval) v12.pdf',path:'C:\\Projects\\Board review\\Approved versions\\Q3 Board Deck — FINAL (revised after board approval) v12.pdf',sizeBytes:'1024',pages:1},
    {name:'2026_RegionalOperations_QuarterlyFinancialStatementsAndSupplementaryNotes_ApprovedRevision12.PDF',path:'C:\\Projects\\Regional operations\\2026_RegionalOperations_QuarterlyFinancialStatementsAndSupplementaryNotes_ApprovedRevision12.PDF',sizeBytes:'134000000',pages:499},
    {name:'最終版_承認済み_販売報告書.pdf',path:'C:\\Documents\\最終版_承認済み_販売報告書.pdf',sizeBytes:'0',issue:'Encrypted or password-protected PDFs are unsupported.'},
    {name:'J.pdf',path:'C:\\Documents\\J.pdf',sizeBytes:'8',issue:'PDF processing failed. The input may be corrupt or unsupported.'},
  ];
  const datasets=[
    ['Demo data',{mergeFiles:files.slice(0,2),mergePages:500,canMerge:true}],
    ['Worst case',{mergeFiles:files,mergePages:500,error:'Rejected folder: directories are unsupported.'}],
    ['Empty',{}],['One',{mergeFiles:[files[0]],mergePages:1}],
    ['100 files',{mergeFiles:Array.from({length:100},(_,i)=>({...files[i%2],path:`C:\\PDFs\\${i}.pdf`,pages:1})),mergePages:100,canMerge:true}],
    ['Over limit',{mergeFiles:files.slice(0,2),mergePages:501,mergeLimitError:'Merged PDF must contain at most 500 pages.'}],
    ['Checking',{adding:true}],
    ['Running',{mergeFiles:files.slice(0,2),mergePages:500,busy:true,job:{id:1,format:'pdf',phase:'running',message:'Importing PDF pages…',pagesDone:2,pagesTotal:500,percent:0.4,inputPath:'2 PDFs (visible list order)'}}],
    ['Failed',{mergeFiles:files.slice(0,2),mergePages:500,canMerge:true,job:{id:1,format:'pdf',phase:'failed',message:'The destination already exists.',inputPath:'2 PDFs (visible list order)'}}],
  ];
  const fixtures=[];
  for(const [name,extra] of datasets) {
    const c={...base,...extra};
    const html=render(h(Shell,{activePage:'Merge PDF',onNavigate:noop},h(MergePdf,{conversion:c,selecting:false})));
    assert.equal((html.match(/class="file-summary(?: file-empty)?"/g)??[]).length,c.mergeFiles.length+1,name);
    assert.equal((html.match(/aria-current="page"/g)??[]).length,1);
    assert.ok(!html.includes('undefined') && !html.includes('NaN'),name);
    assert.ok(html.includes('aria-label="PDF file order"'));
    assert.ok(c.canMerge ? /<button[^>]*class="button button-primary"[^>]*>Merge PDF<\/button>/.test(html) : /<button[^>]*disabled=""[^>]*>Merge PDF<\/button>/.test(html),name);
    if(c.mergeFiles.length) { assert.ok(html.includes('id="pdf-remove-0"')); assert.ok(html.includes('aria-label="File 1:')); }
    if(name==='Worst case') { assert.ok(html.includes(files[2].name)); assert.ok(html.includes('password-protected')); }
    fixtures.push([name,html]);
  }
  const css=await readFile('src/styles.css','utf8');
  // Shared rules protect wrapping, action placement, scrolling and enlarged text.
  for(const rule of ['minmax(0,1fr)','overflow-wrap: anywhere','.image-pdf-list {','overflow: auto','.image-pdf-actions { display: flex; flex-wrap: wrap']) assert.ok(css.includes(rule),rule);
  const fixtureCss=css.replaceAll('/fonts/montserrat/','../../public/fonts/montserrat/');
  const docs=fixtures.flatMap(([name,html])=>['light','dark'].map(theme=>[`${name} / ${theme}`,`<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><style>${fixtureCss}</style><div id="root">${html}</div></html>`]));
  const serialized=JSON.stringify(docs).replaceAll('<','\\u003c');
  const output=`<!doctype html><meta charset="utf-8"><title>Merge PDF development fixtures</title><style>body{font:14px system-ui;background:#222;color:#eee}label{display:inline-block;margin:8px}iframe{display:block;border:1px solid #888}select{padding:8px}</style><label>Dataset <select id="data">${docs.map(([n])=>`<option>${n}</option>`).join('')}</select></label><label>Width <select id="width"><option>1100</option><option>640</option><option>320</option><option>2560</option></select></label><label><input type="checkbox" id="large">200% text</label><p>Isolated development fixtures; native boundaries mocked. No production toggle or native jobs.</p><iframe title="Merge PDF layout"></iframe><script>const docs=new Map(${serialized}),frame=document.querySelector('iframe'),data=document.querySelector('#data'),width=document.querySelector('#width'),large=document.querySelector('#large'),params=new URLSearchParams(location.search);data.value=params.get('data')||'Demo data / dark';width.value=params.get('width')||'1100';large.checked=params.get('large')==='true';function show(){frame.width=width.value;frame.height=740;frame.srcdoc=docs.get(data.value)+(large.checked?'<style>:root{font-size:200%}</style>':'');history.replaceState(null,'','?'+new URLSearchParams({data:data.value,width:width.value,large:large.checked}));}data.onchange=width.onchange=large.onchange=show;show();</script>`;
  await mkdir('.engine-cache/ui-check',{recursive:true});
  await writeFile('.engine-cache/ui-check/merge-pdf.html',output);
  console.log(`${fixtures.length} Merge PDF component states passed in both theme fixtures. CSS reviewed for 320/640/1100/2560px and 200% text; pixels/native functionality remain manual.`);
} finally {await server.close();}
