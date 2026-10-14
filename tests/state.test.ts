import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSave, saveData } from '../src/state';

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
    storage({version:1,completed:['1',0,11,null]});
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
