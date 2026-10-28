import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPng,checkAsset,referenceHash} from './check-store-assets.mjs';
import {pipSpecPath,pipSourcePath,pipLayerPaths,hash,validatePipSpec,normalizeNative,maximumAlphaRadius,nativeLayout,pipStoreSvg,pipLauncherXml,pipPreviewSvg} from './pip-icon-source.mjs';
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const pipReferences=[pipSourcePath,pipSpecPath,'assets/branding/pip-icon-source-v2.png','assets/branding/pip-icon-art-v2-frozen.json','docs/art/pip-icon-v3-generation.json','assets/store/play-icon-source-v2.svg','assets/store/play-icon-preview-v2.svg','assets/store/play-feature-source-v1.png','assets/store/play-feature-base-v1.png','public/assets/pip.png','assets/source/meadow.png','assets/source/pip-win-v1.png'];
const read=(root,file)=>fs.readFileSync(path.join(root,file));
const text=(root,file)=>read(root,file).toString('utf8').replace(/\r\n/g,'\n');

export function checkPipManifest(manifest){
  requireThat(manifest.schemaVersion===2&&manifest.status==='draft'&&manifest.activeIcon==='pip-match3-v3','pip manifest version/status');
  requireThat(Array.isArray(manifest.assets)&&manifest.assets.length===2&&new Set(manifest.assets.map(a=>a.kind)).size===2,'pip manifest kinds');
  requireThat(Array.isArray(manifest.references)&&manifest.references.length===pipReferences.length&&new Set(manifest.references.map(r=>r.path)).size===pipReferences.length&&pipReferences.every(p=>manifest.references.some(r=>r.path===p)),'pip required references');
  for(const ref of manifest.references)requireThat(/^[a-f0-9]{64}$/.test(ref.sha256)&&ref.textNormalization===(/\.(json|svg)$/.test(ref.path)?'LF':undefined),'pip reference hash/normalization');
  for(const asset of manifest.assets){
    const icon=asset.kind==='icon';requireThat(icon||asset.kind==='feature','pip asset kind');
    requireThat(asset.path===(icon?'assets/store/play-icon-v2.png':'assets/store/play-feature-v1.png')&&asset.source===(icon?'assets/store/play-icon-source-v2.svg':'assets/store/play-feature-source-v1.png'),'pip asset paths');
    requireThat(asset.width===(icon?512:1024)&&asset.height===(icon?512:500)&&asset.colorType===(icon?6:2),'pip asset dimensions');
    requireThat(!icon||(asset.maxBytes===1048576&&/^[a-f0-9]{64}$/.test(asset.profileHash)),'pip icon limit/profile');
  }
}

export function checkForeground(image,spec){
  requireThat(image.width===432&&image.height===432&&image.colorType===6&&!image.opaque,'pip foreground format');
  const radius=maximumAlphaRadius(image);requireThat(radius<=spec.native.maximumRadiusDp*432/108,'pip foreground outside safe circle');return radius;
}

/** 1px AA 경계를 제외하고 원 밖 투명·안쪽 불투명/원래 RGB를 독립 검사합니다. */
export function checkRound(round,legacy){
  requireThat(round.width===512&&round.height===512&&round.colorType===6&&legacy.width===512&&legacy.height===512&&legacy.colorType===6,'pip round dimensions');
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
    const dx=Math.abs(x+.5-256),dy=Math.abs(y+.5-256),i=(y*512+x)*4;
    if(Math.hypot(Math.max(0,dx-.5),Math.max(0,dy-.5))>=257)requireThat(round.pixels[i+3]===0,'pip round outside alpha');
    if(Math.hypot(dx+.5,dy+.5)<=254){
      requireThat(round.pixels[i+3]===255,'pip round interior alpha');
      requireThat(round.pixels.subarray(i,i+3).equals(legacy.pixels.subarray(i,i+3)),'pip round interior RGB');
    }
  }
}

export function checkPipLayers(root=process.cwd(),spec=JSON.parse(read(root,pipSpecPath))){
  validatePipSpec(spec);const source=read(root,pipSourcePath);
  requireThat(source.length===spec.source.bytes&&hash(source)===spec.source.sha256,'pip source bytes/hash');
  const decoded=inspectPng(source);requireThat(decoded.width===1254&&decoded.height===1254&&decoded.colorType===6&&!decoded.opaque,'pip source dimensions/alpha');
  const normalized=normalizeNative(decoded),layout=nativeLayout(spec,normalized);
  requireThat(normalized.removedPixels===19851&&spec.proof?.removedAlphaOne===normalized.removedPixels&&spec.proof.normalizedRawSha256===hash(normalized.pixels)&&spec.proof.nativeSide===layout.side,'pip normalization proof');
  const images={};for(const [kind,file]of Object.entries(pipLayerPaths)){
    const expected=spec.outputs?.[kind];requireThat(expected?.path===file&&/^[a-f0-9]{64}$/.test(expected.sha256),'pip layer specification');
    const bytes=read(root,file);requireThat(bytes.length===expected.bytes&&hash(bytes)===expected.sha256,'pip layer bytes/hash');
    images[kind]=inspectPng(bytes);requireThat(images[kind].width===(['foreground','background'].includes(kind)?432:512)&&images[kind].height===images[kind].width&&images[kind].colorType===6,'pip layer dimensions');
    if(kind==='background'||kind==='legacy')requireThat(images[kind].opaque,'pip layer opaque');
    if(kind==='round')requireThat(!images[kind].opaque&&images[kind].pixels[3]===0,'pip round transparency');
  }
  checkRound(images.round,images.legacy);
  const radius=checkForeground(images.foreground,spec);requireThat(radius===spec.proof.foregroundMaximumCellRadius,'pip foreground radius proof');
  return {spec,source,images,radius,layout};
}

export function checkPipXml(readText){
  for(const [file,expected]of Object.entries(pipLauncherXml())){
    const note='<!-- scripts/generate-launcher-assets.mjs에서 생성합니다. -->';
    const content=(expected.startsWith('<?xml')?expected.replace('?>','?>\n'+note):note+'\n'+expected)+'\n';
    requireThat(readText(`android/app/src/main/res/${file}`).replace(/\r\n/g,'\n')===content,`pip launcher XML mismatch: ${file}`);
  }
}

export function checkPipIconAssets(root=process.cwd()){
  const manifest=JSON.parse(read(root,'assets/store/store-assets-v2.json'));checkPipManifest(manifest);
  for(const ref of manifest.references)requireThat(referenceHash(read(root,ref.path),ref)===ref.sha256,`pip reference mismatch: ${ref.path}`);
  const {spec,source,radius}=checkPipLayers(root);checkPipXml(file=>text(root,file));
  requireThat(text(root,'assets/store/play-icon-source-v2.svg')===pipStoreSvg(spec,source),'pip store SVG differs from source');
  for(const asset of manifest.assets)checkAsset(read(root,asset.path),asset);
  requireThat(text(root,'assets/store/play-icon-preview-v2.svg')===pipPreviewSvg(read(root,'assets/store/play-icon-v2.png'),read(root,pipLayerPaths.legacy)),'pip preview differs from exported files');
  const icon=inspectPng(read(root,'assets/store/play-icon-v2.png')),bg=Buffer.from(spec.palette.outer.slice(1),'hex');
  for(const point of [0,511,512*511,512*512-1])requireThat(icon.pixels.subarray(point*4,point*4+3).equals(bg),'pip full square background');
  console.log(`핍 매치3 그림3 초안·원본·런처8XML·4PNG·모든 foreground alpha 안전원 통과 (${radius/4}dp). 실제 단말/권리 최종 승인·콘솔 별도`);
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url)))checkPipIconAssets();
