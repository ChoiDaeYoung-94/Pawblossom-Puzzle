import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SaveStore,SAVE_KEY,BACKUP_KEY,levelSignature,validateCheckpoint,type RoundCheckpoint} from '../src/state';
import {BoardEngine,seededRng} from '../src/core';
import {levels} from '../src/levels';
import {preparePuzzleTool} from '../src/puzzleToolActions';
import {toolStatus,toolArt} from '../src/PuzzleToolUI';
import {SaveStore as OldStore} from './fixtures/legacy-save-v2-tools-v1';
import source from './fixtures/legacy-save-v2-tools-v1.json';

function oldSave(){
  const level=levels[8],e=new BoardEngine(8,8,seededRng(42),undefined,2,level.mask,level.crates);e.setLeaves(level.leaves??[]);
  const round:RoundCheckpoint={schema:2,actionProfile:'tools-v1',toolsUsed:['trowel'],toolsStarted:true,ruleVersion:2,levelId:level.id,levelSignature:levelSignature(level),board:e.board,leaves:e.leaves,moves:level.moves,score:0,collected:Array(6).fill(0),shuffles:1,clearedLeaves:0,...(e.hasCrates?{crates:e.crates,clearedCrates:0}:{})};
  return {version:2,language:'en',highestLevel:69,completed:Array.from({length:68},(_,i)=>i+1),stars:68,coins:200,garden:0,music:true,sfx:true,tutorialSeen:true,puzzleTools:{schema:1,introduced:['trowel','seeds'],trialUsed:['trowel']},inProgress:round};
}
function disk(primary=JSON.stringify(oldSave()),backup=primary){
  const values=new Map([[SAVE_KEY,primary],[BACKUP_KEY,backup]]),writes:string[]=[];let fail='';
  const access=()=>({getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{writes.push(k);if(k===fail)throw Error('write');values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}});
  return {values,writes,access,store:new SaveStore(access),fail:(k:string)=>{fail=k;},read:(k:string)=>JSON.parse(values.get(k)!)};
}
describe('도구2 프로필과 실제 이전 version2 앱의 저장 보호',()=>{
  it('이전 state와 도구 validator fixture는 동결 소스와 일치한다',()=>{
    let code=readFileSync(new URL('./fixtures/legacy-save-v2-tools-v1.ts',import.meta.url),'utf8').replaceAll('\r\n','\n').split('\n').slice(1).join('\n');
    for(const name of ['i18n','levels','core','pipCare','gardenDesign'])code=code.replaceAll(`from '../../src/${name}'`,`from './${name}'`);
    code=code.replace("from './legacy-puzzle-tools-v1'","from './puzzleTools'");
    const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
    expect(hash(code)).toBe(source.stateLfSha256);expect(hash(readFileSync(new URL('./fixtures/legacy-puzzle-tools-v1.ts',import.meta.url),'utf8').replaceAll('\r\n','\n'))).toBe(source.toolsLfSha256);
  });
  it('읽기만 할 때 원문·옛 판·소비 기록을 보존하며 새 동작을 허용하지 않는다',()=>{
    const old=oldSave(),d=disk(),before=[...d.values],loaded=d.store.load();
    expect(loaded.puzzleTools).toEqual({...old.puzzleTools,schema:2});expect(loaded.inProgress).toEqual(old.inProgress);
    expect([...d.values]).toEqual(before);expect(d.writes).toEqual([]);expect(validateCheckpoint(loaded.inProgress,69)).toEqual(old.inProgress);
    expect(preparePuzzleTool(loaded.inProgress!,'broom',{row:0,col:0})).toBeUndefined();expect(toolStatus(loaded,loaded.inProgress,'broom',false).available).toBe(false);
    loaded.language='ko';expect(d.store.save(loaded)).toBe(true);expect(d.read(SAVE_KEY).inProgress).toEqual(old.inProgress);
    expect(d.read(BACKUP_KEY).puzzleTools).toEqual({...old.puzzleTools,schema:2});expect(d.read(SAVE_KEY).puzzleTools.trialUsed).toEqual(['trowel']);
  });
  it.each(['primary','backup','old-primary-new-backup'] as const)('이전 앱은 새 %s를 읽어도 두 사본을 덮어쓰지 않는다',place=>{
    const d=disk(),data=d.store.load();expect(d.store.save(data)).toBe(true);
    if(place==='backup')d.values.set(SAVE_KEY,'{');if(place==='old-primary-new-backup')d.values.set(SAVE_KEY,JSON.stringify(oldSave()));
    const before=[...d.values],writes=d.writes.length,old=new OldStore(d.access),oldData=old.load();
    expect(old.status.load).toBe('unsupported');oldData.coins=999;expect(old.save(oldData)).toBe(false);expect(old.retry(oldData)).toBe(false);
    expect([...d.values]).toEqual(before);expect(d.writes).toHaveLength(writes);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('%s 쓰기 실패는 무료 기록을 보존하고 재시도 때 한 번만 저장한다',key=>{
    const d=disk(),raw=d.values.get(SAVE_KEY),data=d.store.load();data.coins-=30;d.fail(key);
    expect(d.store.save(data)).toBe(false);expect(d.values.get(SAVE_KEY)).toBe(raw);
    if(key===SAVE_KEY){expect(d.read(BACKUP_KEY).puzzleTools.schema).toBe(2);const old=new OldStore(d.access);expect(old.save(old.load())).toBe(false);}
    else expect(d.values.get(BACKUP_KEY)).toBe(raw);
    d.fail('');expect(d.store.retry(data)).toBe(true);const reloaded=new SaveStore(d.access).load();
    expect(reloaded.coins).toBe(170);expect(reloaded.puzzleTools.trialUsed).toEqual(['trowel']);expect(reloaded.inProgress).toEqual(oldSave().inProgress);
  });
  it('손상 primary는 새 backup의 기존 판·소비기록으로 복구하고 이전 앱 롤백은 막는다',()=>{
    const d=disk(),data=d.store.load();expect(d.store.save(data)).toBe(true);d.values.set(SAVE_KEY,'{');
    const recovered=new SaveStore(d.access);expect(recovered.load()).toEqual(data);expect(recovered.status.load).toBe('recovered');
    const old=new OldStore(d.access);expect(old.save(old.load())).toBe(false);
  });
  it('특수 도구는 보드와 동일한 몸체·과일·방향 표시를 공유한다',()=>{
    expect(toolArt('trowel')).toContain('data-special="bomb"');expect(toolArt('seeds')).toContain('data-special="column"');
    expect(toolArt('broom')).toContain('special-art-mark');expect(toolArt('bell')).toContain('data-special="rainbow"');
    expect(toolArt('gloves')).toContain('/puzzle-tools-v1/gloves-v1.webp');
  });
});
