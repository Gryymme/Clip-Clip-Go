import test from 'node:test';
import assert from 'node:assert/strict';
import {report,journal,errorCode,operation} from '../browser-companion/extension/diagnostics.js';
test('reports allowlist fields, strip sensitive values, and retain covering grants beyond the display cap',()=>{
 const secret='https://cdn.test/video?signature=SECRET';
 const grants=[...Array.from({length:40},(_,i)=>`https://site${i}.test/*`),'*://*.imdb.com/*'];
 const output=report({version:'0.5.3',tab:{id:7,url:'https://www.imdb.com/video/vi3232221721/?private=SECRET'},grants,contains:true,manifest:{host_permissions:[],optional_host_permissions:['https://*/*']},session:{title:secret,candidates:[{mediaUrl:secret,context:{Cookie:'SECRET'}}],domMessages:4,scans:{0:{reports:10,mediaElements:1,resources:12}},rejectionReasons:{media_origin_access:1},snapshotUrl:'SECRET'},frames:[{frameId:0,documentId:'document',origin:'https://www.imdb.com/*',attempted:true,completed:true,error:secret}],operations:[{at:Date.now(),action:'request',result:'true',origins:['https://www.imdb.com/*',secret]}]});
 assert.ok(!JSON.stringify(output).includes('SECRET'));assert.equal(output.requiredHosts.length,0);assert.equal(output.grants.length,32);assert.equal(output.grantsTruncated,true);assert.deepEqual(output.page.coveringGrants,['*://*.imdb.com/*']);assert.equal(output.frames[0].heartbeatAgeMs,null,'Completed injection is not proof of a live heartbeat');assert.equal(output.frames[0].scan.mediaElements,1);assert.equal(output.rejections.media_origin_access,1);assert.equal(output.counters.domMessages,4);assert.equal(output.candidates,1);
});
test('permission journal is bounded, expires, rejects spoofed outcomes and never retains signed paths',()=>{
 let entries=[];for(let i=0;i<100;i++)entries=journal(entries,{action:'remove',result:'true',origins:['https://page.test/*','https://cdn.test/media?token=SECRET']},1000+i);
 assert.equal(entries.length,20);assert.equal(journal(entries,null,700000).length,0);assert.ok(!JSON.stringify(entries).includes('SECRET'));assert.equal(operation({action:'execute',result:'true'}),null);assert.equal(operation({action:'request',result:'SECRET'}),null);
 assert.equal(errorCode(Error('Cannot access host https://cdn.test/?sig=SECRET: permission denied')),'host_access_denied');
});
