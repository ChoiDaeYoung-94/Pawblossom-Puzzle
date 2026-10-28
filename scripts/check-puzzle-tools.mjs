import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inspectPng} from './check-store-assets.mjs';
const record=JSON.parse(fs.readFileSync('docs/art/puzzle-tools-v1.json','utf8'));
const ids=['trowel','gloves','broom','bell','seeds'];
if(record.entries.length!==5||record.outputs?.length!==5)throw Error('tool asset inventory');
for(const [i,id]of ids.entries()){
  for(const [entry,path]of [[record.entries[i],`assets/art/puzzle-tools-v1/${id}-v1.png`],[record.outputs[i],`public/assets/puzzle-tools-v1/${id}-v1.webp`]]){
    const data=fs.readFileSync(path);if(entry.path!==path||entry.id!==id||entry.bytes!==data.length||entry.sha256!==createHash('sha256').update(data).digest('hex'))throw Error('tool asset hash/path: '+id);
    if(path.endsWith('.png')){const png=inspectPng(data);if(png.width!==entry.width||png.height!==entry.height||png.colorType!==6)throw Error('tool PNG format');}
    else if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP'||data.readUInt32LE(4)+8!==data.length||entry.width!==192||entry.height!==192||data.length>24576)throw Error('tool WebP format/budget');
  }
}
console.log('자체 도구5종 원본/192px게임출력 경로·해시·형식/각24KiB예산 일치');
