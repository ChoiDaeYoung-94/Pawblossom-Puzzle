import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPng, checkAsset, checkManifest, checkStoreAssets, crc32, sha256, referenceHash } from './check-store-assets.mjs';

const signature=Buffer.from('89504e470d0a1a0a','hex');
function chunk(type,payload=Buffer.alloc(0)) {
  const result=Buffer.alloc(payload.length+12);
  result.writeUInt32BE(payload.length);result.write(type,4);payload.copy(result,8);
  result.writeUInt32BE(crc32(result.subarray(4,-4)),result.length-4);
  return result;
}
function png({type=6,depth=8,raw=Buffer.from([0,10,20,30,255]),tail=[],end=true}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=depth;header[9]=type;
  return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),...tail,...(end?[chunk('IEND')]:[])]);
}
const spec = data=>({width:1,height:1,colorType:6,bytes:data.length,sha256:sha256(data)});

test('저장된 스토어 초안·참조 원본이 현재 작업 트리와 일치합니다',()=>checkStoreAssets());
test('표준 CRC 벡터와 실제 RGBA 픽셀을 검증합니다',()=>{
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  assert.deepEqual(inspectPng(png()).pixels,Buffer.from([10,20,30,255]));
});
test('PNG signature·청크 절단·CRC 손상을 차단합니다',()=>{
  assert.throws(()=>inspectPng(Buffer.alloc(8)),/signature/);
  assert.throws(()=>inspectPng(png().subarray(0,-2)),/truncated/);
  const corrupted=png();corrupted[45]^=1;assert.throws(()=>inspectPng(corrupted),/CRC/);
});
test('알파 없는 RGB를 RGBA 제출 규격으로 통과시키지 않습니다',()=>{
  const rgb=png({type:2,raw:Buffer.from([0,10,20,30])});
  assert.equal(inspectPng(rgb).channels,3);
  assert.throws(()=>checkAsset(rgb,spec(rgb)),/colorType/);
});
test('CRC가 유효한 RGB/RGBA tRNS 투명 색상 청크를 차단합니다',()=>{
  for(const type of [2,6]) {
    const raw=Buffer.from(type===2?[0,10,20,30]:[0,10,20,30,255]);
    assert.throws(()=>inspectPng(png({type,raw,tail:[chunk('tRNS',Buffer.from([0,10,0,20,0,30]))]})),/tRNS/);
  }
});
test('manifest 목록 누락·중복·다른 경로·규격·필수 참조 삭제를 차단합니다',()=>{
  const original=JSON.parse(readFileSync('assets/store/store-assets-v1.json','utf8'));
  const mutations=[
    m=>{delete m.assets;},m=>{m.assets=[];},m=>{m.assets=[m.assets[0],m.assets[0]];},
    m=>{m.assets[0].path='assets/store/preview.png';},m=>{m.assets[0].width=32;},
    m=>{m.assets[0].colorType=2;},m=>{m.assets[0].maxBytes=2097152;},
    m=>{delete m.assets[0].profileHash;},m=>{m.assets[1].height=512;},
    m=>{m.assets[1].colorType=6;},m=>{m.assets[0].source=m.assets[1].source;},
    m=>{delete m.references;},m=>{m.references=[];},m=>{m.references.pop();},
    m=>{m.references[0]=m.references[1];},
  ];
  for(const mutate of mutations) {const m=structuredClone(original);mutate(m);assert.throws(()=>checkManifest(m),/store/);}
});
test('지원하지 않는 인코딩·해독 길이·필터를 차단합니다',()=>{
  assert.throws(()=>inspectPng(png({depth:16})),/encoding/);
  assert.throws(()=>inspectPng(png({raw:Buffer.from([0,10])})),/decoded length/);
  assert.throws(()=>inspectPng(png({raw:Buffer.alloc(10)})),/larger than|decoded length/i);
  assert.throws(()=>inspectPng(png({raw:Buffer.from([5,10,20,30,255])})),/filter/);
});
test('필터 0–4를 위/왼쪽/대각선 이웃을 포함해 해독합니다',()=>{
  const header=Buffer.from([0,0,0,2,0,0,0,2,8,6,0,0,0]);
  const pixels=Buffer.from([10,20,30,255,30,40,50,255,20,30,40,255,50,60,70,255]);
  const paeth=(a,b,c)=>{const p=a+b-c,ds=[Math.abs(p-a),Math.abs(p-b),Math.abs(p-c)];return [a,b,c][ds.indexOf(Math.min(...ds))];};
  for(let filter=0;filter<=4;filter++) {
    const raw=[];
    for(let y=0;y<2;y++) {raw.push(filter);for(let x=0;x<8;x++) {
      const i=y*8+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-8]:0,c=y&&x>=4?pixels[i-12]:0;
      raw.push((pixels[i]-[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter]+256)&255);
    }}
    const data=Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from(raw))),chunk('IEND')]);
    assert.deepEqual(inspectPng(data).pixels,pixels,`filter ${filter}`);
  }
});
test('IEND 누락·뒷바이트·분리 IDAT·알 수 없는 critical chunk를 차단합니다',()=>{
  assert.throws(()=>inspectPng(png({end:false})),/missing IEND/);
  assert.throws(()=>inspectPng(Buffer.concat([png(),Buffer.from([0])])),/trailing/);
  assert.throws(()=>inspectPng(png({tail:[chunk('tEXt'),chunk('IDAT')]})),/nonconsecutive/);
  assert.throws(()=>inspectPng(png({tail:[chunk('ABCD')]})),/critical/);
});
test('투명 픽셀·파일 최대 크기·크기·해시·sRGB 프로파일 불일치를 차단합니다',()=>{
  const transparent=png({raw:Buffer.from([0,10,20,30,0])});
  assert.throws(()=>checkAsset(transparent,spec(transparent)),/opaque/);
  const data=png();
  for(const [override,message] of [[{bytes:1},/byte size/],[{maxBytes:1},/maximum/],[{width:512},/width/],[{height:512},/height/],[{sha256:'0'.repeat(64)},/hash/],[{profileHash:'0'.repeat(64)},/profile/]]) {
    assert.throws(()=>checkAsset(data,{...spec(data),...override}),message);
  }
});
test('텍스트 참조의 LF/CRLF 해시는 같고 내용 변경은 다릅니다',()=>{
  const reference={textNormalization:'LF'};
  assert.equal(referenceHash(Buffer.from('a\r\nb\r\n'),reference),sha256('a\nb\n'));
  assert.notEqual(referenceHash(Buffer.from('changed\r\n'),reference),sha256('a\nb\n'));
});
test('참조 원본의 변경을 최종 PNG 검증보다 먼저 차단합니다',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'pawblossom-store-'));
  try {
    mkdirSync(path.join(root,'assets/store'),{recursive:true});
    const manifest=JSON.parse(readFileSync('assets/store/store-assets-v1.json','utf8'));
    mkdirSync(path.join(root,'assets/branding'),{recursive:true});
    writeFileSync(path.join(root,manifest.references[0].path),'changed');
    writeFileSync(path.join(root,'assets/store/store-assets-v1.json'),JSON.stringify(manifest));
    assert.throws(()=>checkStoreAssets(root),/reference mismatch/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
