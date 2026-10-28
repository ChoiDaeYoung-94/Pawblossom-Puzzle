import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkPipIconAssets,checkPipManifest,checkForeground,checkRound,checkPipXml} from './check-pip-icon.mjs';
import {normalizeNative,maximumAlphaRadius,pipLauncherXml,validatePipSpec} from './pip-icon-source.mjs';
const spec=JSON.parse(fs.readFileSync('assets/branding/pip-icon-v2.json'));
const manifest=JSON.parse(fs.readFileSync('assets/store/store-assets-v2.json'));

test('핍 원본·v2 스토어·native PNG와 활성 XML이 일치합니다',()=>checkPipIconAssets());
test('v2 path·원본참조·형식·opaque 제출 규격을 다른 초안으로 바꿀 수 없습니다',()=>{
  for(const mutate of [m=>{m.schemaVersion=1;},m=>{m.activeIcon='v1';},m=>{m.assets.pop();},m=>{m.assets[1]=m.assets[0];},m=>{m.assets[0].path='assets/store/play-icon-v1.png';},m=>{m.assets[0].source=m.assets[1].source;},m=>{m.assets[0].width=1024;},m=>{m.assets[0].colorType=2;},m=>{m.assets[0].maxBytes=2097152;},m=>{delete m.assets[0].profileHash;},m=>{m.references.pop();},m=>{m.references[0]=m.references[1];},m=>{m.references[0].path='../outside.png';}]){
    const candidate=structuredClone(manifest);mutate(candidate);assert.throws(()=>checkPipManifest(candidate),/pip/);
  }
});
test('native 정규화는 입력·RGB·alpha2 이상을 유지하고 정확 alpha1만 제거합니다',()=>{
  const pixels=Buffer.from([1,2,3,0,4,5,6,1,7,8,9,2,10,11,12,254,13,14,15,255]),before=Buffer.from(pixels);
  const result=normalizeNative({width:5,height:1,channels:4,pixels});
  assert.deepEqual(pixels,before);assert.equal(result.removedPixels,1);
  const expected=Buffer.from(before);expected[7]=0;assert.deepEqual(result.pixels,expected);
  assert.throws(()=>normalizeNative({width:5,height:1,channels:3,pixels}),/RGBA/);
  const invalid=structuredClone(spec);invalid.native.removeExactAlpha=2;assert.throws(()=>validatePipSpec(invalid),/native/);
});
test('희박한 alpha1과 픽셀 셀 모서리도 native 안전원 검사에서 제외하지 않습니다',()=>{
  const image={width:432,height:432,channels:4,colorType:6,opaque:false,pixels:Buffer.alloc(432*432*4)};
  image.pixels[(216*432+346)*4+3]=1;assert.ok(checkForeground(image,spec)<132);
  image.pixels.fill(0);image.pixels[(216*432+347)*4+3]=1;
  assert.ok(Math.hypot(347.5-216,216.5-216)<132);
  assert.throws(()=>checkForeground(image,spec),/outside safe circle/);
  image.pixels.fill(0);assert.throws(()=>maximumAlphaRadius(image),/empty/);
});
test('불투명 사각 foreground·다른 픽셀 크기를 안전 레이어로 통과시키지 않습니다',()=>{
  const image={width:432,height:432,channels:4,colorType:6,opaque:true,pixels:Buffer.alloc(432*432*4,255)};
  assert.throws(()=>checkForeground(image,spec),/format/);assert.throws(()=>checkForeground({...image,width:512,opaque:false},spec),/format/);
});
test('원형 파생의 바깥 불투명 픽셀·안쪽 구멍·원본 색 손상을 차단합니다',()=>{
  const legacy={width:512,height:512,colorType:6,pixels:Buffer.alloc(512*512*4,255)},round={...legacy,pixels:Buffer.from(legacy.pixels)};
  for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(Math.hypot(x+.5-256,y+.5-256)>256)round.pixels[(y*512+x)*4+3]=0;
  checkRound(round,legacy);
  const corner=Buffer.from(round.pixels);corner[3]=1;assert.throws(()=>checkRound({...round,pixels:corner},legacy),/outside alpha/);
  const center=Buffer.from(round.pixels),i=(256*512+256)*4;center[i+3]=254;assert.throws(()=>checkRound({...round,pixels:center},legacy),/interior alpha/);
  center[i+3]=255;center[i]=0;assert.throws(()=>checkRound({...round,pixels:center},legacy),/interior RGB/);
});
test('활성 wrapper의 잘못된 bitmap 크기맞춤·레이어 연결을 차단하고 v33 단색을 보존합니다',()=>{
  const files=pipLauncherXml(),note='<!-- scripts/generate-launcher-assets.mjs에서 생성합니다. -->';
  const text=file=>{const xml=files[file.replace('android/app/src/main/res/','')];return (xml.startsWith('<?xml')?xml.replace('?>','?>\n'+note):note+'\n'+xml)+'\n';};
  checkPipXml(text);
  assert.throws(()=>checkPipXml(file=>text(file).replace('android:gravity="fill"','android:gravity="center"')),/XML mismatch/);
  assert.throws(()=>checkPipXml(file=>text(file).replace('@drawable/pip_icon_background_v2','@color/ic_launcher_background')),/XML mismatch/);
  assert.ok(files['mipmap-anydpi-v33/ic_launcher.xml'].includes('@drawable/pawblossom_monochrome'));
  assert.ok(!files['mipmap-anydpi-v26/ic_launcher.xml'].includes('monochrome'));
});
