import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inspectPng} from './check-store-assets.mjs';

const record=JSON.parse(fs.readFileSync('docs/art/trail-episode-v1.json','utf8'));
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const sourceNames=['wolf-blocking-v1','wolf-relieved-v1'];
requireThat(record.sources.length===2&&record.outputs?.length===2,'trail asset inventory');
for(const [index,name]of sourceNames.entries()){
  for(const [entry,file]of [[record.sources[index],`assets/art/trail-episode-v1/${name}.png`],[record.outputs[index],`public/assets/trail-episode-v1/${name}.webp`]]){
    requireThat(entry.path===file,'trail asset path');
    const data=fs.readFileSync(file);
    requireThat(data.length===entry.bytes&&createHash('sha256').update(data).digest('hex')===entry.sha256,'trail source/output changed: '+file);
    if(file.endsWith('.png')){
      const png=inspectPng(data);requireThat(png.width===1254&&png.height===1254&&png.colorType===6,'trail original format');
    }else{
      requireThat(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'&&data.readUInt32LE(4)+8===data.length,'trail WebP container');
      requireThat(entry.width===384&&entry.height===384&&data.length<65536,'trail output dimensions/budget');
    }
  }
}
console.log('숲길 원본2개·게임 WebP2개 경로/해시/형식·출력별64KiB 예산 일치');

const beaver=JSON.parse(fs.readFileSync('docs/art/trail-episode-v2.json','utf8'));
requireThat(beaver.issue===459&&beaver.sources.length===2&&beaver.outputs?.length===2,'beaver runtime exports incomplete');
for(const [index,name]of ['beaver-blocking-v1','beaver-relieved-v1'].entries()){
  for(const [entry,file]of [[beaver.sources[index],`assets/art/trail-episode-v2/${name}.png`],[beaver.outputs[index],`public/assets/trail-episode-v2/${name}.webp`]]){
    requireThat(entry.path===file,'beaver asset path');
    const data=fs.readFileSync(file);
    requireThat(data.length===entry.bytes&&createHash('sha256').update(data).digest('hex')===entry.sha256,'beaver source/output changed: '+file);
    if(file.endsWith('.png')){
      const png=inspectPng(data);requireThat(png.width===1254&&png.height===1254&&png.colorType===6,'beaver original format');
    }else{
      requireThat(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'&&data.readUInt32LE(4)+8===data.length,'beaver WebP container');
      requireThat(entry.width===384&&entry.height===384&&data.length<65536,'beaver output dimensions/budget');
    }
  }
}
console.log('물가 비버 원본2개·게임 WebP2개 경로/해시/형식·출력별64KiB 예산 일치');

const squirrel=JSON.parse(fs.readFileSync('docs/art/trail-episode-v3.json','utf8'));
requireThat(squirrel.issue===483&&squirrel.sources.length===2&&squirrel.outputs?.length===2,'squirrel runtime exports incomplete');
for(const [index,name]of ['squirrel-blocking-v1','squirrel-relieved-v1'].entries()){
  for(const [entry,file]of [[squirrel.sources[index],`assets/art/trail-episode-v3/${name}.png`],[squirrel.outputs[index],`public/assets/trail-episode-v3/${name}.webp`]]){
    requireThat(entry.path===file,'squirrel asset path');
    const data=fs.readFileSync(file);
    requireThat(data.length===entry.bytes&&createHash('sha256').update(data).digest('hex')===entry.sha256,'squirrel source/output changed: '+file);
    if(file.endsWith('.png')){
      const png=inspectPng(data);requireThat(png.width===1254&&png.height===1254&&png.colorType===6,'squirrel original format');
    }else{
      requireThat(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'&&data.readUInt32LE(4)+8===data.length,'squirrel WebP container');
      requireThat(data.length>=30&&data.toString('ascii',12,16)==='VP8X'&&data.readUInt32LE(16)===10&&(data[20]&0x10)!==0,'squirrel extended WebP alpha header');
      requireThat(data.readUIntLE(24,3)+1===384&&data.readUIntLE(27,3)+1===384&&entry.width===384&&entry.height===384&&data.length<65536,'squirrel actual output dimensions/budget');
    }
  }
}
console.log('과수원 다람쥐 원본2개·게임 WebP2개 경로/해시/형식·실제384px/alpha header·출력별64KiB 일치');
