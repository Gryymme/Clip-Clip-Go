import test from 'node:test';
import assert from 'node:assert/strict';
import {isTextRoute,normalizeExtension,outputGroups} from '../src/converter/formats.ts';
import {initialSelection,selectionReducer} from '../src/converter/selection.ts';
test('all six native text routes are enabled without identical-format routes',()=>{
 for(const [input,output] of [['md','html'],['md','txt'],['html','md'],['txt','md'],['html','txt'],['txt','html']])assert.equal(isTextRoute(input,output),true);
 for(const input of ['md','html','txt','docx','odt','rtf','pdf'])for(const output of ['pdf','docx','odt'])assert.equal(isTextRoute(input,output),false);
 for(const input of ['md','html','txt'])assert.equal(isTextRoute(input,input),false);
 
 assert.equal(normalizeExtension('MARKDOWN'),'md');assert.equal(normalizeExtension('HTM'),'html');
 assert.deepEqual(outputGroups('md')[0].formats,['html','txt','pdf']);
});
test('Markdown defaults to HTML, literal TXT defaults to Markdown, and locks preserve the selection',()=>{
 function select(name){let s=selectionReducer(initialSelection,{type:'start'});return selectionReducer(s,{type:'selected',file:{name,path:'C:\\Docs\\'+name,sizeBytes:'100'}});}
 const md=select('最終.markdown');assert.equal(md.file.format,'md');assert.equal(md.output,'html');
 const txt=select('notes.txt');assert.equal(txt.output,'md');
 const locked=selectionReducer(md,{type:'lock',locked:true});assert.equal(selectionReducer(locked,{type:'remove'}),locked);assert.equal(selectionReducer(locked,{type:'output',format:'txt'}),locked);
});
