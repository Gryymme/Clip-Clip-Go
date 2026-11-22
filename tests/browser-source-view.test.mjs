import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateLink,receivedBrowserSource} from '../src/companion/types.ts';
test('URL disclosure preserves complete signed values and rejects unsafe actions',()=>{
 const value='https://cdn.example.test/manifest?signature=A%2Bz&expires=99#part';
 assert.deepEqual(candidateLink(value),{value,compact:'cdn.example.test'});
 for(const url of ['javascript:alert(1)','data:text/html,x','file:///C:/secret','https://user:pass@example.test/v','https://example.test/\n','https://example.test/'+ 'x'.repeat(8192)])assert.equal(candidateLink(url),null);
});
test('a new pending candidate takes priority over retained job data',()=>{
 const old={id:'A'},next={id:'B'};assert.equal(receivedBrowserSource(null,old),old);assert.equal(receivedBrowserSource(next,old),next);assert.equal(receivedBrowserSource(null,next),next);assert.equal(receivedBrowserSource(null,null),null);
});
