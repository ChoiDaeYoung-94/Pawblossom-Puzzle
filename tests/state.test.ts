import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSave, saveData } from '../src/state';
import { LEVEL_COUNT } from '../src/levels';

afterEach(()=>vi.unstubAllGlobals());
function storage(value:unknown){
  let raw=JSON.stringify(value);
  vi.stubGlobal('localStorage',{getItem:()=>raw,setItem:(_key:string,next:string)=>{raw=next;}});
}
describe('튜토리얼 저장 호환',()=>{
  it('첫 실행과 언어 없는 저장은 한국어이며 명시한 영어는 유지합니다',()=>{
    storage(null);expect(loadSave().language).toBe('ko');
    storage({version:1});expect(loadSave().language).toBe('ko');
    storage({version:1,language:'en'});expect(loadSave().language).toBe('en');
  });
  it('신규 저장은 안내 미완료이며 안내 완료는 재로드 후 복원됩니다',()=>{
    storage(null);
    const save=loadSave();expect(save.tutorialSeen).toBe(false);
    save.tutorialSeen=true;expect(saveData(save)).toBe(true);
    expect(loadSave().tutorialSeen).toBe(true);
  });
  it('이전 버전 완료 기록은 보존하며 안내를 자동 생략합니다',()=>{
    storage({version:1,completed:[1,2],highestLevel:3,stars:2,coins:80,garden:0,language:'ko'});
    expect(loadSave()).toMatchObject({completed:[1,2],highestLevel:3,stars:2,coins:80,language:'ko',tutorialSeen:true});
  });
  it('유효하지 않은 완료 목록은 안내를 건너뛰게 하지 않습니다',()=>{
    storage({version:1,completed:['1',0,LEVEL_COUNT+1,null]});
    expect(loadSave().tutorialSeen).toBe(false);
    expect(loadSave().completed).toEqual([]);
  });
  it('명시된 안내 설정은 완료 기록보다 우선합니다',()=>{
    storage({version:1,completed:[1],tutorialSeen:false});expect(loadSave().tutorialSeen).toBe(false);
    storage({version:1,completed:[],tutorialSeen:true});expect(loadSave().tutorialSeen).toBe(true);
  });
  it('저장소 오류에서도 첫 실행은 동작하고 쓰기 실패를 반환합니다',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('read');},setItem:()=>{throw Error('write');}});
    const save=loadSave();expect(save.tutorialSeen).toBe(false);
    expect(saveData({...save,tutorialSeen:true})).toBe(false);
  });
});

describe('추가 콘텐츠의 저장 호환',()=>{
  it('이전 10개 완료 저장은 보상을 더하지 않고 11번을 해제합니다',()=>{
    storage({version:1,completed:Array.from({length:10},(_,i)=>i+1),highestLevel:10,stars:4,coins:400,garden:3});
    expect(loadSave()).toMatchObject({highestLevel:11,stars:4,coins:400,garden:3});
  });
  it('30개 완료와 추가 별을 재로드하며 마지막 ID를 넘지 않습니다',()=>{
    storage({version:1,completed:Array.from({length:LEVEL_COUNT},(_,i)=>i+1),highestLevel:LEVEL_COUNT,stars:LEVEL_COUNT});
    const save=loadSave();expect(save.highestLevel).toBe(LEVEL_COUNT);expect(save.stars).toBe(LEVEL_COUNT);
    expect(saveData(save)).toBe(true);expect(loadSave()).toEqual(save);
  });
  it('중복·잘못된 ID를 버리고 건너뛴 완료 기록으로 새 스테이지를 해제하지 않습니다',()=>{
    storage({version:1,completed:[1,1,3,30,31,-1,'2'],highestLevel:1});
    expect(loadSave()).toMatchObject({completed:[1,3,30],highestLevel:2});
  });
});
