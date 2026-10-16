import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { storeIconSvg } from './store-icon-source.mjs';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const referenceHash = (data, reference) => sha256(reference.textNormalization==='LF'?data.toString('utf8').replace(/\r\n/g,'\n'):data);
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit=0;bit<8;bit++) crc = (crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
const requireThat = (condition, message) => { if (!condition) throw Error(message); };
const requiredReferences = [
  'assets/branding/pawblossom-mark.json','assets/branding/pawblossom-color.svg',
  'assets/store/play-icon-source-v1.svg','assets/store/play-icon-preview-v1.svg',
  'assets/store/play-feature-source-v1.png','assets/store/play-feature-base-v1.png',
  'public/assets/pip.png','public/assets/meadow.png','assets/source/pip-win-v1.png',
];

export function checkManifest(manifest) {
  requireThat(manifest.schemaVersion===1 && manifest.status==='draft' && Array.isArray(manifest.assets) && manifest.assets.length===2, 'store manifest schema/status/assets');
  requireThat(Array.isArray(manifest.references) && manifest.references.length===requiredReferences.length && new Set(manifest.references.map(ref=>ref.path)).size===requiredReferences.length && requiredReferences.every(p=>manifest.references.some(ref=>ref.path===p)), 'store required references');
  for(const ref of manifest.references) {
    requireThat(/^[0-9a-f]{64}$/.test(ref.sha256) && ref.textNormalization===(/\.(json|svg)$/.test(ref.path)?'LF':undefined), 'store reference hash/normalization');
  }
  requireThat(new Set(manifest.assets.map(asset=>asset.kind)).size===2, 'store asset duplicate kind');
  for(const asset of manifest.assets) {
    const icon=asset.kind==='icon';
    requireThat(icon || asset.kind==='feature', 'store asset kind');
    requireThat(asset.path===`assets/store/play-${asset.kind}-v1.png`, 'store asset path');
    requireThat(asset.width===(icon?512:1024) && asset.height===(icon?512:500) && asset.colorType===(icon?6:2), 'store asset policy dimensions/format');
    requireThat(!icon || (asset.maxBytes===1048576 && /^[0-9a-f]{64}$/.test(asset.profileHash)), 'store icon size/profile policy');
    requireThat(asset.source===(icon?'assets/store/play-icon-source-v1.svg':'assets/store/play-feature-source-v1.png'), 'store asset reference source');
  }
}

// 이 저장소의 8-bit RGB/RGBA, non-interlaced PNG만 검사합니다.
// 범용 이미지 로더가 아니며 지원하지 않는 인코딩은 명시적으로 실패합니다.
export function inspectPng(data) {
  requireThat(data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')), 'PNG signature');
  let offset=8, header, ended=false, profileHash=null, sawIdat=false, closedIdat=false;
  const compressed=[];
  while (offset<data.length) {
    requireThat(offset+12<=data.length, 'PNG truncated chunk');
    const length=data.readUInt32BE(offset), type=data.toString('ascii',offset+4,offset+8);
    const end=offset+12+length;
    requireThat(end<=data.length, 'PNG truncated payload');
    requireThat(crc32(data.subarray(offset+4,end-4))===data.readUInt32BE(end-4), `PNG CRC ${type}`);
    const payload=data.subarray(offset+8,end-4);
    if (!header) requireThat(type==='IHDR', 'PNG IHDR first');
    if (type==='IHDR') {
      requireThat(!header && length===13, 'PNG IHDR duplicate/length');
      const width=payload.readUInt32BE(0),height=payload.readUInt32BE(4),depth=payload[8],colorType=payload[9];
      requireThat(width>0 && height>0 && width<=4096 && height<=4096, 'PNG dimensions limit');
      requireThat(depth===8 && [2,6].includes(colorType) && payload[10]===0 && payload[11]===0 && payload[12]===0, 'PNG unsupported encoding');
      header={width,height,depth,colorType,channels:colorType===6?4:3};
    } else if (type==='IDAT') {
      requireThat(!closedIdat, 'PNG nonconsecutive IDAT');
      compressed.push(payload);sawIdat=true;
    } else {
      if(sawIdat)closedIdat=true;
      requireThat(type!=='tRNS', 'PNG tRNS transparency unsupported');
      if(type==='iCCP') {
        const zero=payload.indexOf(0);
        requireThat(profileHash===null && zero>0 && zero<=79 && payload[zero+1]===0, 'PNG ICC header');
        const profile=inflateSync(payload.subarray(zero+2),{maxOutputLength:1024*1024});
        requireThat(profile.length>=128 && profile.readUInt32BE(0)===profile.length && profile.toString('ascii',36,40)==='acsp', 'PNG ICC profile');
        profileHash=sha256(profile);
      } else if(type==='IEND') {
        requireThat(length===0 && sawIdat && end===data.length, 'PNG IEND/trailing bytes');
        ended=true;offset=end;break;
      } else requireThat((data[offset+4]&32)!==0, `PNG unsupported critical chunk ${type}`);
    }
    offset=end;
  }
  requireThat(ended, 'PNG missing IEND');
  const stride=header.width*header.channels, expected=(stride+1)*header.height;
  const scanlines=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});
  requireThat(scanlines.length===expected, 'PNG decoded length');
  const pixels=Buffer.alloc(stride*header.height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<header.height;y++) {
    const filter=scanlines[y*(stride+1)];
    requireThat(filter<=4, 'PNG invalid filter');
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=header.channels?pixels[i-header.channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=header.channels?pixels[i-stride-header.channels]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      pixels[i]=(scanlines[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  const opaque=header.channels===3 || pixels.every((value,i)=>i%4!==3 || value===255);
  return {...header,profileHash,opaque,pixels};
}

export function checkAsset(data, specification) {
  requireThat(data.length===specification.bytes, 'asset byte size mismatch');
  if(specification.maxBytes)requireThat(data.length<=specification.maxBytes, 'asset maximum size');
  const image=inspectPng(data);
  for(const key of ['width','height','colorType'])requireThat(image[key]===specification[key], `asset ${key} mismatch`);
  requireThat(image.opaque, 'asset must be opaque');
  if(specification.profileHash)requireThat(image.profileHash===specification.profileHash, 'asset sRGB profile mismatch');
  requireThat(sha256(data)===specification.sha256, 'asset hash mismatch');
  return image;
}

export function checkStoreAssets(root=process.cwd()) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/store/store-assets-v1.json'),'utf8'));
  checkManifest(manifest);
  for(const reference of manifest.references) {
    requireThat(referenceHash(fs.readFileSync(path.join(root,reference.path)),reference)===reference.sha256, `reference mismatch: ${reference.path}`);
  }
  const mark=JSON.parse(fs.readFileSync(path.join(root,'assets/branding/pawblossom-mark.json'),'utf8'));
  requireThat(fs.readFileSync(path.join(root,'assets/store/play-icon-source-v1.svg'),'utf8').replace(/\r\n/g,'\n')===storeIconSvg(mark), 'icon SVG differs from brand source');
  for(const asset of manifest.assets) {
    const image=checkAsset(fs.readFileSync(path.join(root,asset.path)),asset);
    if(asset.kind==='icon') {
      const background=Buffer.from(mark.background.slice(1),'hex');
      for(const pixel of [0,image.width-1,image.width*(image.height-1),image.width*image.height-1]) {
        requireThat(image.pixels.subarray(pixel*4,pixel*4+3).equals(background), 'icon full-square background');
      }
    }
    console.log(`${asset.path}: ${image.width}×${image.height}, ${image.channels*8}-bit PNG, ${asset.bytes} bytes, SHA256 ${asset.sha256}`);
  }
  console.log('스토어 초안 파일과 참조 원본 검증 통과 (최종 아트/권리·콘솔·실기기 검증 별도)');
}
if(process.argv[1] && fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url)))checkStoreAssets();
