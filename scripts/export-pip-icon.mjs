import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {inspectPng,referenceHash} from './check-store-assets.mjs';
import {pipReferences,checkForeground} from './check-pip-icon.mjs';
import {pipSpecPath,pipSourcePath,pipLayerPaths,hash,validatePipSpec,normalizeNative,nativeLayout,backgroundSvg,pipStoreSvg,pipPreviewSvg} from './pip-icon-source.mjs';

// 기존 도구와 같이 sharp는 내보내기에만 사용하며 게임/CI 의존성에는 추가하지 않습니다.
const sharp=createRequire(import.meta.url)(process.argv[2]||'sharp'),spec=JSON.parse(fs.readFileSync(pipSpecPath)),source=fs.readFileSync(pipSourcePath);
validatePipSpec(spec);if(source.length!==spec.source.bytes||hash(source)!==spec.source.sha256)throw Error('pip source bytes/hash');
const decoded=inspectPng(source),normalized=normalizeNative(decoded);if(normalized.removedPixels!==spec.native.removedPixels)throw Error('pip exact alpha1 count');
const layout=nativeLayout(spec,normalized),write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);};
const encode=instance=>instance.ensureAlpha().png({palette:false,compressionLevel:9}).toBuffer();
const resized=await encode(sharp(normalized.pixels,{raw:{width:1254,height:1254,channels:4}}).resize(layout.side,layout.side));
const foreground=await encode(sharp({create:{width:432,height:432,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:resized,left:layout.left,top:layout.top}]));
const radius=checkForeground(inspectPng(foreground),spec),background=await encode(sharp(Buffer.from(backgroundSvg(spec,432))));
const combined=await encode(sharp(background).composite([{input:foreground}]));
const legacy=await sharp(combined).extract({left:72,top:72,width:288,height:288}).resize(512,512).ensureAlpha().withIccProfile('srgb').png({palette:false,compressionLevel:9}).toBuffer();
const round=await encode(sharp(legacy).composite([{input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>'),blend:'dest-in'}]));
const layers={foreground,background,legacy,round};spec.outputs={};for(const [kind,data]of Object.entries(layers)){write(pipLayerPaths[kind],data);spec.outputs[kind]={path:pipLayerPaths[kind],bytes:data.length,sha256:hash(data)};}
spec.proof={normalizedRawSha256:hash(normalized.pixels),nativeSide:layout.side,removedAlphaOne:normalized.removedPixels,foregroundMaximumCellRadius:radius};write(pipSpecPath,JSON.stringify(spec,null,2)+'\n');
const svg=pipStoreSvg(spec,source);write('assets/store/play-icon-source-v2.svg',svg);
const store=await sharp(Buffer.from(svg)).toColourspace('srgb').ensureAlpha().withIccProfile('srgb').png({palette:false,compressionLevel:9}).toBuffer();write('assets/store/play-icon-v2.png',store);write('assets/store/play-icon-preview-v2.svg',pipPreviewSvg(store,legacy));
const image=inspectPng(store),old=JSON.parse(fs.readFileSync('assets/store/store-assets-v1.json'));
const manifest={schemaVersion:2,status:'draft',activeIcon:'pip-match3-v3',verifiedOn:'2026-10-28',tooling:{sharp:sharp.versions.sharp,libvips:sharp.versions.vips,librsvg:sharp.versions.rsvg},assets:[{kind:'icon',path:'assets/store/play-icon-v2.png',width:512,height:512,colorType:6,bytes:store.length,sha256:hash(store),maxBytes:1048576,profileHash:image.profileHash,source:'assets/store/play-icon-source-v2.svg'},old.assets.find(a=>a.kind==='feature')],references:pipReferences.map(file=>{const ref={path:file};if(/\.(json|svg)$/.test(file))ref.textNormalization='LF';return {...ref,sha256:referenceHash(fs.readFileSync(file),ref)};})};write('assets/store/store-assets-v2.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sourceHash:hash(source),nativeLayout:layout,removedAlphaOne:normalized.removedPixels,maximumForegroundDp:radius/4,storeBytes:store.length,sharp:sharp.versions.sharp}));
