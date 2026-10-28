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
