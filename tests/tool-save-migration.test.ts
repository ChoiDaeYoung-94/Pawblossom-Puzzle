import {describe,it,expect} from 'vitest';
import {SaveStore,SAVE_KEY,BACKUP_KEY,RESET_KEY,levelSignature,validateCheckpoint,type SaveData,type RoundCheckpoint} from '../src/state';
import {SaveStore as LegacyStore,type SaveData as LegacyData} from './fixtures/legacy-save-v1';
import {BoardEngine,seededRng} from '../src/core';
import {levels} from '../src/levels';
import {freshToolProgress,validateToolProgress,validateToolIds} from '../src/puzzleTools';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import legacySource from './fixtures/legacy-save-v1.json';

function legacy(rule:1|2=2):LegacyData {
  const l=levels[5],e=new BoardEngine(8,8,seededRng(42),undefined,rule);e.setLeaves(l.leaves??[]);
  return {version:1,language:'en',highestLevel:6,completed:[1,2,3,4,5],stars:3,coins:200,garden:1,music:false,sfx:true,tutorialSeen:true,
    inProgress:{schema:1,ruleVersion:rule,levelId:6,levelSignature:levelSignature(l),board:e.board,leaves:e.leaves,moves:24,score:120,collected:[1,2,3,4,5,6],shuffles:0,clearedLeaves:0}};
}
function current():SaveData {return {...legacy(),version:2,puzzleTools:freshToolProgress()};}
function disk(primary?:string,backup?:string){
  const values=new Map<string,string>();if(primary!==undefined)values.set(SAVE_KEY,primary);if(backup!==undefined)values.set(BACKUP_KEY,backup);
  const writes:string[]=[];let failed='',readFailed='',removeFailed=false;
  const access=()=>({getItem:(key:string)=>{if(readFailed===key)throw Error('read');return values.get(key)??null;},setItem:(key:string,value:string)=>{writes.push(key);if(failed===key)throw Error('write');values.set(key,value);},removeItem:(key:string)=>{if(removeFailed)throw Error('remove');values.delete(key);}});
  return {values,writes,access,store:()=>new SaveStore(access),read:(key:string)=>JSON.parse(values.get(key)??'null'),fail:(key:string)=>{failed=key;},failRead:(key:string)=>{readFailed=key;},failRemove:(value:boolean)=>{removeFailed=value;}};
}
describe('도구 저장2 이행과 동결 구앱의 쓰기 차단',()=>{
  it('구앱 검수 fixture는 상대 import 외에 이전 소스와 같다',()=>{
    let code=readFileSync(new URL('./fixtures/legacy-save-v1.ts',import.meta.url),'utf8').replaceAll('\r\n','\n').split('\n').slice(1).join('\n');
    for(const name of ['i18n','levels','core','pipCare','gardenDesign'])code=code.replaceAll(`from '../../src/${name}'`,`from './${name}'`);
    expect(createHash('sha256').update(code).digest('hex')).toBe(legacySource.sourceLfSha256);
  });
  it.each([1,2] as const)('기존 룰%s 회차와 영구 기록은 무쓰기 이행하고 행동 프로필을 덧붙이지 않는다',rule=>{
    const old=legacy(rule),raw=JSON.stringify(old,null,2),d=disk(raw),s=d.store(),loaded=s.load();
    expect(loaded).toEqual({...old,version:2,puzzleTools:freshToolProgress()});expect(loaded.inProgress).toEqual(old.inProgress);
    expect(loaded.inProgress).not.toHaveProperty('actionProfile');expect(d.values.get(SAVE_KEY)).toBe(raw);expect(d.writes).toEqual([]);
    loaded.coins+=40;expect(s.save(loaded)).toBe(true);expect(d.read(SAVE_KEY)).toEqual(loaded);
    expect(d.read(BACKUP_KEY)).toEqual({...old,version:2,puzzleTools:freshToolProgress()});
  });
  it.each([[1,1],[1,2],[2,1],[2,2]])('primary v%s·backup v%s 혼합을 읽기만 하고 primary를 선택한다',(p,b)=>{
    const raw=JSON.stringify(p===1?legacy():current()),backup=JSON.stringify(b===1?{...legacy(),coins:80}:{...current(),coins:80}),d=disk(raw,backup),s=d.store();
    expect(s.load().coins).toBe(200);expect(s.status.load).toBe('loaded');expect([...d.values]).toEqual([[SAVE_KEY,raw],[BACKUP_KEY,backup]]);expect(d.writes).toEqual([]);
  });
  it.each(['primary','backup'] as const)('동결된 구앱이 새 %s를 발견하면 load/save/retry 모두 디스크를 쓰지 않는다',place=>{
    const d=disk(place==='primary'?JSON.stringify(current()):'{',place==='backup'?JSON.stringify(current()):JSON.stringify(legacy()));
    const before=[...d.values],old=new LegacyStore(d.access),data=old.load();expect(old.status.load).toBe('unsupported');
    data.coins=999;expect(old.save(data)).toBe(false);expect(old.retry(data)).toBe(false);expect([...d.values]).toEqual(before);expect(d.writes).toEqual([]);
  });
  it('v1 첫 커밋 뒤 두 사본이 v2라 primary 손상도 구앱 롤백을 허용하지 않는다',()=>{
    const d=disk(JSON.stringify(legacy()),JSON.stringify(legacy())),s=d.store(),data=s.load();data.coins+=40;expect(s.save(data)).toBe(true);
    expect(d.read(SAVE_KEY).version).toBe(2);expect(d.read(BACKUP_KEY).version).toBe(2);d.values.set(SAVE_KEY,'{');d.writes.length=0;
    const old=new LegacyStore(d.access);expect(old.save(old.load())).toBe(false);expect(d.writes).toEqual([]);
    const restored=d.store();expect(restored.load()).toEqual(current());expect(restored.status.load).toBe('recovered');
  });
  it('부분 이행의 정상v1 primary와 v2 backup도 구앱은 두 원문을 쓰지 않는다',()=>{
    const primary=JSON.stringify(legacy()),backup=JSON.stringify(current()),d=disk(primary,backup),old=new LegacyStore(d.access),data=old.load();
    expect(data.coins).toBe(200);expect(old.status.load).toBe('unsupported');data.coins+=40;
    expect(old.save(data)).toBe(false);expect(old.retry(data)).toBe(false);expect([...d.values]).toEqual([[SAVE_KEY,primary],[BACKUP_KEY,backup]]);expect(d.writes).toEqual([]);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('v1 이행 중 %s 쓰기 실패/재시도는 기존 기록과 소비를 함께 유지한다',key=>{
    const raw=JSON.stringify(legacy()),d=disk(raw,raw),s=d.store(),next=s.load();next.coins-=30;next.puzzleTools={schema:2,introduced:['trowel'],trialUsed:['trowel']};
    d.fail(key);expect(s.save(next)).toBe(false);expect(d.values.get(SAVE_KEY)).toBe(raw);
    if(key===BACKUP_KEY)expect(d.values.get(BACKUP_KEY)).toBe(raw);else expect(d.read(BACKUP_KEY)).toEqual(current());
    d.fail('');expect(s.retry(next)).toBe(true);expect(d.read(SAVE_KEY)).toEqual(next);expect(d.store().load().puzzleTools.trialUsed).toEqual(['trowel']);expect(d.store().load().coins).toBe(170);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('v1 원문 %s의 같은 의미 다른 JSON 변경도 이행으로 숨기지 않는다',key=>{
    const raw=JSON.stringify(legacy()),d=disk(raw,raw),s=d.store(),next=s.load();d.values.set(key,JSON.stringify(legacy(),null,2));const before=[...d.values];
    expect(s.save(next)).toBe(false);expect(s.retry(next)).toBe(false);expect(s.status.load).toBe('conflict');expect([...d.values]).toEqual(before);expect(d.writes).toEqual([]);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('v1 이행의 %s 읽기 예외 후에는 현재 메모리를 임의 승격하지 않는다',key=>{
    const raw=JSON.stringify(legacy()),d=disk(raw,raw);d.failRead(key);const s=d.store(),next=s.load();expect(s.status.load).toBe('read-error');expect(s.save(next)).toBe(false);expect(d.writes).toEqual([]);
    d.failRead('');const ok=s.retry(next);expect(ok).toBe(key===BACKUP_KEY);if(key===SAVE_KEY)expect(d.values.get(SAVE_KEY)).toBe(raw);
  });
  it('명시 초기화 marker는 v1보다 먼저 적용하고 remove 실패도 v2 기본/marker를 보존한다',()=>{
    const d=disk(JSON.stringify(legacy())),s=d.store();s.load();const empty=s.reset()!;expect(empty.version).toBe(2);expect(empty.puzzleTools).toEqual(freshToolProgress());
    d.failRemove(true);expect(s.save(empty)).toBe(false);expect(d.values.get(RESET_KEY)).toBe('1');expect(d.read(SAVE_KEY)).toEqual(empty);expect(d.read(BACKUP_KEY)).toEqual(empty);
    d.failRemove(false);expect(s.retry(empty)).toBe(true);expect(d.values.has(RESET_KEY)).toBe(false);expect(d.store().load()).toEqual(empty);
  });
  it.each([
    {puzzleTools:{schema:3,introduced:[],trialUsed:[]}},
    {inProgress:{...legacy().inProgress,schema:3}},
    {inProgress:{...legacy().inProgress,schema:2,actionProfile:'tools-v3',toolsUsed:[],toolsStarted:true}},
    {inProgress:{...legacy().inProgress,ruleVersion:3}},
  ])('미지원 새 형식은 구형 backup으로 롤백하거나 덮어쓰지 않는다 %#',patch=>{
    const raw=JSON.stringify({...current(),...patch}),d=disk(raw,JSON.stringify(legacy())),s=d.store(),data=s.load();
    expect(s.status.load).toBe('unsupported');expect(s.save(data)).toBe(false);expect(s.retry(data)).toBe(false);expect(d.values.get(SAVE_KEY)).toBe(raw);expect(d.writes).toEqual([]);
  });
  it.each([
    undefined,{schema:1,introduced:[],trialUsed:['trowel']},{schema:1,introduced:['trowel'],trialUsed:['trowel','trowel']},
    {schema:1,introduced:['unknown'],trialUsed:[]},{schema:1,introduced:[],trialUsed:[],paidStock:1},
  ])('잘못된 무료 체험은 빈 기록으로 정규화해 재지급하지 않는다 %#',puzzleTools=>{
    const raw=JSON.stringify({...current(),puzzleTools}),d=disk(raw),s=d.store(),data=s.load();
    expect(s.status.load).toBe('corrupt');expect(s.save(data)).toBe(false);expect(d.values.get(SAVE_KEY)).toBe(raw);expect(d.writes).toEqual([]);
  });
  it('tools-v1 회차는 사용·시작 상태와 판을 보존하고 구 회차는 여전히 schema1이다',()=>{
    const round:RoundCheckpoint={...legacy().inProgress!,schema:2,ruleVersion:2,actionProfile:'tools-v1',toolsUsed:['trowel'],toolsStarted:true};
    expect(validateCheckpoint(round,6)).toEqual(round);const data={...current(),inProgress:round,puzzleTools:{schema:2 as const,introduced:['trowel' as const],trialUsed:['trowel' as const]}};
    const d=disk(JSON.stringify(data)),s=d.store();expect(s.load()).toEqual(data);expect(s.save(data)).toBe(true);expect(d.store().load()).toEqual(data);
    for(const patch of [{toolsStarted:false},{toolsUsed:['trowel','trowel']},{toolsUsed:['trowel','broom','bell']},{ruleVersion:1},{actionProfile:undefined}])expect(validateCheckpoint({...round,...patch},6)).toBeUndefined();
    expect(validateCheckpoint(legacy().inProgress,6)?.schema).toBe(1);
  });
  it('빈 도구 배열과 새 객체는 서로 공유하지 않고 sparse/중복/미지원 ID를 거절한다',()=>{
    const a=freshToolProgress(),b=freshToolProgress();a.introduced.push('trowel');expect(b.introduced).toEqual([]);
    expect(validateToolIds(Array(1))).toBeUndefined();expect(validateToolIds(['bell','bell'])).toBeUndefined();expect(validateToolProgress({schema:1,introduced:[],trialUsed:[]})).toEqual(b);
  });
});
