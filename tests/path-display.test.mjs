import test from 'node:test';
import assert from 'node:assert/strict';
import {displayPath,displayPathText} from '../src/pathDisplay.ts';
test('extended drive and UNC paths display as equivalent Windows paths',()=>{
 for(const [input,expected] of [[String.raw`\\?\C:\Users\User\Test Files\one.pdf`,String.raw`C:\Users\User\Test Files\one.pdf`],[String.raw`\\?\UNC\server\share\one.pdf`,String.raw`\\server\share\one.pdf`],[String.raw`\\?\unc\server\share`,String.raw`\\server\share`]])assert.equal(displayPath(input),expected);
});
test('ordinary paths, URLs, non-path text and other namespaces remain untouched',()=>{
 for(const input of [String.raw`C:\Test Files\one.pdf`,String.raw`\\server\share\one.pdf`,'No destination',String.raw`\\?\Volume{123}\one`,String.raw`https://example.test/(\\?\C:\one`]){
  assert.equal(displayPath(input),input);assert.equal(displayPathText(input),input);
 }
});
test('messages and multi-file summaries format recognized paths without changing useful details',()=>{
 assert.equal(displayPathText(String.raw`Cannot read "\\?\C:\Test Files\one.pdf"; select it again.`),String.raw`Cannot read "C:\Test Files\one.pdf"; select it again.`);
 assert.equal(displayPathText('\\\\?\\C:\\one\n\\\\?\\UNC\\server\\share\\two'), 'C:\\one\n\\\\server\\share\\two');
 assert.equal(displayPathText(String.raw`not-a-path\\?\C:\file`),String.raw`not-a-path\\?\C:\file`);
});
