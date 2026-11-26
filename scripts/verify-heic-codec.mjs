// A codec listing is insufficient: exercise the pinned CLI's HEIF item/grid path.
import {createHash} from 'node:crypto';
import path from 'node:path';
export function verifyHeicCodec(ffmpeg,ffprobe,run) {
 const fixture=name=>path.resolve(import.meta.dirname,'../tests/fixtures/heic',name);
 const raster=(name,map)=>{
  const input=['-v','error','-nostdin','-threads','1','-filter_threads','1','-filter_complex_threads','1','-protocol_whitelist','file','-f','mov','-i',fixture(name)];
  const mapping=map.startsWith('[')?['-filter_complex',map,'-map','[primary]']:['-map',map];
  return run(ffmpeg,[...input,...mapping,'-frames:v','1','-an','-sn','-dn','-f','rawvideo','-pix_fmt','rgba','pipe:1'],true);
 };
 const probe=JSON.parse(run(ffprobe,['-v','error','-f','mov','-show_streams','-of','json',fixture('primary-second.heic')]));
 if(probe.streams?.length!==2||probe.streams[1].id!=='0x2'||probe.streams[1].codec_name!=='hevc'||probe.streams[1].disposition.default!==1)throw Error('Bundled HEIC primary-item inspection failed.');
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const reference=raster('pattern.heic','0:0');
 if(reference.length!==64*48*4 || hash(reference)!==hash(raster('primary-second.heic','0:1')))throw Error('Bundled HEIC primary-image decoding failed.');
 const rotated=raster('rotated.heic','0:0'),grid=raster('grid.heic','[0:g:0]null[primary]');
 if(rotated.length!==64*48*4||grid.length!==128*48*4)throw Error('Bundled HEIC transform/grid decoding failed.');
 // Top-left after a CCW quarter turn is green. Grid's right tile is blue.
 if(rotated[1]<220||rotated[0]>20||grid[(96+24*128)*4+2]<220)throw Error('Bundled HEIC transformed pixels failed verification.');
 return {codec:'native hevc',container:'HEIF primary item / tile grid',extraDecoderAssets:0};
}
