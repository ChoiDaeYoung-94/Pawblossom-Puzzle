import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const mode=process.argv[2];
assert(['production','testing'].includes(mode),'production 또는 testing 모드가 필요합니다.');
const root=resolve('dist');
const files=[];
function collect(folder){for(const entry of readdirSync(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())collect(path);else files.push(path);}}
collect(root);
const text=files.filter(path=>/\.(html|js|css)$/.test(path)).map(path=>readFileSync(path,'utf8')).join('\n');
const page=join(root,'carrier-trial.html');
const parcelRoot=resolve('src/experimental/carrier/assets');
const parcel=JSON.parse(readFileSync(join(parcelRoot,'carrier-trial-parcel-v1.json'),'utf8'));
const partNames=['body','left-leaf','right-leaf'];
assert.deepEqual(Object.keys(parcel.parts).sort(),[...partNames].sort(),'꾸러미 부품 목록이 다릅니다.');
for(const name of partNames){
  const part=parcel.parts[name],expected=`carrier-trial-parcel-${name}-v1.webp`;
  assert.equal(part.path,expected,'꾸러미 부품 경로가 다릅니다.');
  const bytes=readFileSync(join(parcelRoot,expected));
  assert.equal(bytes.length,part.bytes,'꾸러미 원본 크기가 다릅니다.');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),part.sha256,'꾸러미 원본 SHA가 다릅니다.');
  if(mode==='testing'){
    const prefix=expected.slice(0,-5)+'-';
    const built=files.filter(path=>relative(root,path).replaceAll('\\','/').startsWith('assets/'+prefix)&&path.endsWith('.webp'));
    assert.equal(built.length,1,'시험 빌드에 꾸러미 부품이 없거나 중복됐습니다.');
    assert.equal(createHash('sha256').update(readFileSync(built[0])).digest('hex'),part.sha256,'빌드의 꾸러미 부품 SHA가 다릅니다.');
  }
}
if(mode==='production'){
  assert.equal(existsSync(page),false,'운영 빌드에 운반 시험 HTML이 있습니다.');
  assert(!files.some(path=>/carrier[-_]?trial/i.test(relative(root,path))),'운영 빌드에 운반 시험 entry/chunk가 있습니다.');
  assert(!text.includes('experimental-carrier-v1'),'운영 빌드에 시험 규칙이 포함됐습니다.');
  assert(!text.includes('carrier-trial.html'),'운영 빌드에 시험 진입 경로가 포함됐습니다.');
}else{
  assert(existsSync(page),'시험 HTML을 찾을 수 없습니다.');
  assert(text.includes('experimental-carrier-v1'),'시험 엔진을 찾을 수 없습니다.');
  const html=readFileSync(page,'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]);
  assert(scripts.length>0,'시험 entry script가 없습니다.');
  for(const source of scripts){
    assert(source.startsWith('/assets/'),'시험 script는 빌드 내부 asset이어야 합니다.');
    const path=resolve(root,'.'+source);assert(relative(root,path)&&!relative(root,path).startsWith('..')&&existsSync(path),'시험 entry를 찾을 수 없습니다.');
  }
}
console.log(`운반 시험 ${mode==='production'?'제외':'포함'} 확인: HTML·entry·규칙·진입 경로`);
