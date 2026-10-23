import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {BoardEngine,seededRng} from '../src/core';
import {levels,type Level} from '../src/levels';
import {SaveStore,SAVE_KEY,BACKUP_KEY,levelSignature,validateCheckpoint,type RoundCheckpoint} from '../src/state';
import {freshGardenDesign} from '../src/gardenDesign';

// 실제 이전 콘텐츠를 고정하며 엔진 golden이나 새 목표값으로 다시 만들지 않습니다.
const previous=JSON.parse(readFileSync(new URL('./helpers/content-247-before.json',import.meta.url),'utf8')) as {levels:Level[]};
function checkpoint(level:Level):RoundCheckpoint {
  const engine=new BoardEngine(8,8,seededRng(42),undefined,2,level.mask,level.crates);
  engine.setLeaves(level.leaves??[]);
  return {schema:1,ruleVersion:2,levelId:level.id,levelSignature:levelSignature(level),board:engine.board,leaves:engine.leaves,
    moves:level.moves,score:0,collected:[0,0,0,0,0,0],shuffles:1,clearedLeaves:0,...(level.crates?{crates:engine.crates,clearedCrates:0}:{})};
}

describe('대표 구간 콘텐츠 변경과 영구 진행 보호',()=>{
  it.each(previous.levels)('이전 $id번 회차만 분리하고 완료·재화·정원·핍과 현재 회차 복원을 보존합니다',old=>{
    const current=levels[old.id-1],legacy=checkpoint(old),fresh=checkpoint(current);
    expect(levelSignature(old)).not.toBe(levelSignature(current));
    expect(validateCheckpoint(legacy,old.id)).toBeUndefined();
    expect(validateCheckpoint(fresh,old.id)).toEqual(fresh);
    const completed=Array.from({length:old.id-1},(_,i)=>i+1),pip={growth:34,affection:22,owned:[],equipped:'none'},gardenDesign=freshGardenDesign();
    const data={version:1,language:'ko',highestLevel:old.id,completed,stars:7,coins:240,garden:2,music:true,sfx:true,tutorialSeen:true,pip,gardenDesign,inProgress:legacy};
    const raw=JSON.stringify(data),disk=new Map<string,string>([[SAVE_KEY,raw]]);let writes=0;
    const access=()=>({getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{writes++;disk.set(key,value);},removeItem:(key:string)=>{disk.delete(key);}});
    const store=new SaveStore(access),loaded=store.load();
    expect(loaded).toMatchObject({highestLevel:old.id,completed,stars:7,coins:240,garden:2,pip,gardenDesign});
    expect(loaded.inProgress).toBeUndefined();expect(disk.get(SAVE_KEY)).toBe(raw);expect(writes).toBe(0);
    expect(store.save({...loaded,inProgress:fresh})).toBe(true);
    expect(new SaveStore(access).load()).toEqual({...loaded,inProgress:fresh});
    disk.set(SAVE_KEY,'{');disk.set(BACKUP_KEY,raw);writes=0;
    const invalidBackup=new SaveStore(access);expect(invalidBackup.load().completed).toEqual([]);expect(invalidBackup.status.load).toBe('corrupt');
    expect(writes).toBe(0);expect(disk.get(BACKUP_KEY)).toBe(raw);
  });
});
