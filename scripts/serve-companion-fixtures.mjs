// Local, generated media only. Does not launch or operate any browser.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const project=process.cwd(),ffmpeg=path.join(project,'src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe');
const manifest=JSON.parse(await readFile('scripts/ffmpeg-manifest.json','utf8'));
if(createHash('sha256').update(await readFile(ffmpeg)).digest('hex')!==manifest.binaries.ffmpeg.sha256)throw Error('Bundled FFmpeg checksum mismatch');
await mkdir('.engine-cache',{recursive:true});const root=await mkdtemp(path.join(project,'.engine-cache/companion-fixtures-'));
async function generate(args,capture=false){return await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-hide_banner','-v','error','-nostdin',...args.map(s=>s.replaceAll('\\','/'))],{cwd:root,shell:false,windowsHide:true,stdio:['ignore',capture?'pipe':'ignore','pipe']});let stderr='',stdout='';child.stdout?.on('data',b=>{stdout+=b;if(stdout.length>4*1024*1024){child.kill();reject(Error('Generated manifest exceeds fixture bound'));}});child.stderr.on('data',b=>stderr=(stderr+b).slice(-4000));child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));});}
await generate(['-f','lavfi','-i','testsrc2=size=640x360:rate=25:duration=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx264','-preset','ultrafast','-g','25','-c:a','aac','-ac','2','-shortest',path.join(root,'fixture.mp4')]);
await generate(['-i',path.join(root,'fixture.mp4'),'-c','copy','-f','hls','-hls_time','1','-hls_list_size','0','-hls_segment_filename',path.join(root,'segment-%03d.ts'),path.join(root,'playlist.m3u8')]);
await generate(['-i',path.join(root,'fixture.mp4'),'-vf','scale=320:180','-c:v','libx264','-preset','ultrafast','-g','25','-c:a','copy','-f','hls','-hls_time','1','-hls_list_size','0','-hls_segment_filename',path.join(root,'small-%03d.ts'),path.join(root,'small.m3u8')]);
// FFmpeg emits multiple MPD snapshots while muxing. Capture its non-file manifest
// sink and write only the complete final snapshot, avoiding Windows replace races.
const snapshots=await generate(['-i',path.join(root,'fixture.mp4'),'-map','0','-c','copy','-f','dash','-seg_duration','1','pipe:1'],true);
const finalStart=snapshots.lastIndexOf('<?xml');const finalManifest=snapshots.slice(finalStart);
if(finalStart<0||!finalManifest.trimEnd().endsWith('</MPD>'))throw Error('Generated final MPD is incomplete');
await writeFile(path.join(root,'manifest.mpd'),finalManifest);
await generate(['-stream_loop','5','-i',path.join(root,'fixture.mp4'),'-t','15','-c','copy','-movflags','+faststart',path.join(root,'preview.mp4')]);
await generate(['-i',path.join(root,'fixture.mp4'),'-frames:v','1','-vf','scale=320:-1',path.join(root,'poster.jpg')]);
const mime=n=>n.endsWith('.jpg')?'image/jpeg':n.endsWith('.m3u8')?'application/vnd.apple.mpegurl':n.endsWith('.mpd')?'application/dash+xml':n.endsWith('.ts')?'video/mp2t':n.endsWith('.html')?'text/html':'video/mp4';
let mainOrigin,cdnOrigin;
const html=body=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ClipClipGO local fixture</title><style>body{font:18px system-ui;margin:2rem;max-width:55rem}video,iframe{max-width:100%}li{margin:1rem 0}</style>${body}`;
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,FRAME-RATE=25\nplaylist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=350000,RESOLUTION=320x180,FRAME-RATE=25\nsmall.m3u8\n';
async function handle(req,res){try{
 const url=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/expired'){res.writeHead(403);res.end('Expired local fixture');return;}
 if(url.pathname==='/redirect'){res.writeHead(302,{Location:cdnOrigin+'/media'});res.end();return;}
 if(url.pathname==='/master.m3u8'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(master);return;}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html(`<h1>ClipClipGO local fixtures</h1><p>Activate detection before playback. Navigation clears candidates. Only generated three-second media is served.</p><ul>${['direct','extensionless','delayed','iframe','hls','dash','duplicates','missing','expired-test','shadow','changing','spa','late','multiple','xhr','preview'].map(n=>`<li><a href="/${n}">${n}</a></li>`).join('')}</ul>`));return;}
 const pages={direct:'<video controls src="/fixture.mp4"></video>',extensionless:'<video controls src="/media?signature=retain%2Bexact"></video>',delayed:'<button id="play">Load after delay</button><video controls></video><script>document.getElementById("play").onclick=()=>setTimeout(()=>{document.querySelector("video").src="/media?delayed=1";document.querySelector("video").play()},1500)</script>',iframe:`<p>Grant the iframe origin ${cdnOrigin} separately.</p><iframe src="${cdnOrigin}/frame" width="700" height="420"></iframe>`,frame:`<video controls src="${cdnOrigin}/media?frame=1"></video>`,hls:'<p>Chrome may not play native HLS. Click to request the master and media playlists for detection, then inspect variants in ClipClipGO.</p><button onclick="fetch(\'/master.m3u8\');fetch(\'/playlist.m3u8\')">Request HLS playlists</button>',dash:'<p>This fixture requests a DASH manifest without adding a remote player library.</p><button onclick="fetch(\'/manifest.mpd\')">Request DASH manifest</button>',duplicates:'<button onclick="for(let i=0;i<30;i++){fetch(\'/segment-000.ts\');fetch(\'/media?duplicate=1\')}">Request duplicate media and segments</button>',missing:'<title></title><video controls src="/media"></video>','expired-test':'<button onclick="fetch(\'/expired?token=expired\')">Request expired source (403)</button><p>Failed requests should not become downloadable candidates.</p>'};
 Object.assign(pages,{
 preview:'<p>Generated fast-start direct media for bounded popup preview testing.</p><video controls preload="metadata" poster="/poster.jpg" src="/preview.mp4"></video>',
 shadow:'<div id="player"></div><script>const root=document.querySelector("#player").attachShadow({mode:"open"});root.innerHTML=\'<video controls src="/media?shadow=1"></video>\';</script>',
 changing:'<video controls src="/media?item=one"></video><button onclick="document.querySelector(\'video\').src=\'/media?item=two\'">Change source</button>',
 spa:'<video controls src="/media?item=one"></video><button onclick="history.pushState(null,\'\',\'/spa?item=two\');document.querySelector(\'video\').src=\'/media?item=two\'">Next SPA item</button>',
 late:'<p>Play/load this video before activating detection.</p><video controls preload="auto" src="/media?already=loaded"></video>',
 multiple:'<video controls src="/media?item=A"></video><video controls src="/media?item=B"></video>',
 xhr:'<button onclick="fetch(\'/media?via=fetch\');const x=new XMLHttpRequest();x.open(\'GET\',\'/media?via=xhr\');x.send()">Request extensionless media via fetch/XHR</button>'
 });
 const key=url.pathname.slice(1);if(key in pages){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html(pages[key]));return;}
 const name=url.pathname==='/media'?'fixture.mp4':path.basename(url.pathname);if(url.pathname!=='/media'&&url.pathname!=='/'+name){res.writeHead(404);res.end();return;}
 const file=path.join(root,name);const info=await stat(file);if(!info.isFile())throw Error();let start=0,end=info.size-1;let code=200;
 const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');if(range){start=Number(range[1]);end=range[2]?Number(range[2]):end;if(start>end||end>=info.size){res.writeHead(416);res.end();return;}code=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);}
 res.writeHead(code,{'Content-Type':mime(name),'Content-Length':end-start+1,'Accept-Ranges':'bytes'});if(req.method==='HEAD')res.end();else res.end((await readFile(file)).subarray(start,end+1));
 }catch{res.writeHead(404);res.end();}}
const main=createServer(handle),cdn=createServer(handle);await new Promise(r=>main.listen(0,'127.0.0.1',r));await new Promise(r=>cdn.listen(0,'127.0.0.1',r));mainOrigin=`http://127.0.0.1:${main.address().port}`;cdnOrigin=`http://127.0.0.1:${cdn.address().port}`;
if(process.argv.includes('--check')){for(const file of ['init-stream0.m4s','init-stream1.m4s','chunk-stream0-00001.m4s','chunk-stream1-00001.m4s']){const r=await fetch(mainOrigin+'/'+file);if(!r.ok||(await r.arrayBuffer()).byteLength===0)throw Error('Generated DASH fragment is missing');}}
if(process.argv.includes('--check')){for(const url of ['/',...['direct','extensionless','delayed','iframe','hls','dash','duplicates','missing','expired-test','shadow','changing','spa','late','multiple','xhr','preview','master.m3u8','playlist.m3u8','manifest.mpd','media?signature=retain%2Bexact'].map(n=>'/'+n)]){const r=await fetch(mainOrigin+url);if(!r.ok)throw Error(`Fixture HTTP ${r.status}: ${url}`);await r.arrayBuffer();}if((await fetch(mainOrigin+'/expired')).status!==403)throw Error('Expiry fixture');console.log('Generated local fixture HTTP checks passed (no browser integration).');main.close();cdn.close();}else{console.log(`Local fixture pages: ${mainOrigin}\nOptional page grant: ${mainOrigin}/*\nOptional iframe/CDN grant: ${cdnOrigin}/*\nGenerated media directory: ${root}\nStop with Ctrl+C. No browser is opened.`);}
