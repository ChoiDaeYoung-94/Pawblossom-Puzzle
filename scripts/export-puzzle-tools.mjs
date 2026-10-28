import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)(process.argv[2]||'sharp');
const path='docs/art/puzzle-tools-v1.json',record=JSON.parse(fs.readFileSync(path,'utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
record.outputs=[];
for(const entry of record.entries){
  const original=fs.readFileSync(entry.path);if(hash(original)!==entry.sha256||original.length!==entry.bytes)throw Error('tool original changed');
  const info=await sharp(original).metadata();entry.width=info.width;entry.height=info.height;
  const data=await sharp(original).resize(176,176,{fit:'contain',background:'#00000000'}).extend({top:8,bottom:8,left:8,right:8,background:'#00000000'}).webp({quality:90,alphaQuality:100,effort:6}).toBuffer();
  const output=`public/assets/puzzle-tools-v1/${entry.id}-v1.webp`;fs.mkdirSync('public/assets/puzzle-tools-v1',{recursive:true});fs.writeFileSync(output,data);
  record.outputs.push({id:entry.id,path:output,width:192,height:192,bytes:data.length,sha256:hash(data)});
}
record.export={sharp:sharp.versions.sharp,canvas:192,content:176,padding:8,quality:90,alphaQuality:100,policy:'original untouched;standard resize/padding/encoding only'};
record.status='runtime exports prepared;gameplay/UI integration unverified';
fs.writeFileSync(path,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record.outputs));
