import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

// Sharp는 개발용 내보내기에만 사용하고 게임/CI 의존성은 추가하지 않습니다.
const sharp=createRequire(import.meta.url)(process.argv[2]||'sharp');
const manifestPath='docs/art/trail-episode-v1.json';
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const outputs=[];
for(const source of manifest.sources){
  const original=fs.readFileSync(source.path);
  if(hash(original)!==source.sha256||original.length!==source.bytes)throw Error('trail original changed');
  const name=source.path.split('/').at(-1).replace('.png','.webp');
  const file=`public/assets/trail-episode-v1/${name}`;
  // 원본 alpha/색을 선별하지 않고 축소와 투명 여백만 적용합니다.
  const bytes=await sharp(original).resize(352,352,{fit:'contain',background:'#00000000'}).extend({top:16,bottom:16,left:16,right:16,background:'#00000000'}).webp({quality:90,alphaQuality:100,effort:6}).toBuffer();
  fs.mkdirSync('public/assets/trail-episode-v1',{recursive:true});fs.writeFileSync(file,bytes);
  outputs.push({path:file,width:384,height:384,bytes:bytes.length,sha256:hash(bytes)});
}
manifest.outputs=outputs;manifest.export={sharp:sharp.versions.sharp,canvas:384,content:352,padding:16,webpQuality:90,alphaQuality:100,policy:'original untouched;standard proportional resize/transparent padding/encoding only'};
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({outputs}));
