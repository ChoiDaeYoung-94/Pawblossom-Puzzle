import {describe,it,expect} from 'vitest';
import {createLabStore,completeLabThrough,freshLabProgress,LAB_PREFIX} from '../src/ProgressLab';
import {SAVE_KEY,BACKUP_KEY,RESET_KEY} from '../src/state';

describe('시험 진행의 격리·완료·실패 경계',()=>{
  const preferences={language:'ko' as const,music:false,sfx:true};
  it('이미 소비한 재화와 비연속 완료를 보존하고 빠진 판만 보상한다',()=>{
    const source={...freshLabProgress(preferences),completed:[1,3,11],highestLevel:12,stars:1,coins:5};
    const next=completeLabThrough(source,10);
    expect(next.added).toEqual([2,4,5,6,7,8,9,10]);expect(next.save).toMatchObject({highestLevel:12,stars:9,coins:325});
    expect(completeLabThrough(next.save,10).save).toEqual(next.save);expect(source.completed).toEqual([1,3,11]);
  });
  it('500 첫 완료는 500별·20000코인이며 반복·역방향 요청은 중복 지급하지 않는다',()=>{
    const full=completeLabThrough(freshLabProgress(preferences),500).save;
    expect(full).toMatchObject({highestLevel:500,stars:500,coins:20000});expect(full.completed).toHaveLength(500);
    expect(completeLabThrough(full,500).added).toEqual([]);expect(completeLabThrough(full,10).save).toEqual(full);
  });
  it.each([0,501,-1,1.5,NaN,Infinity])('범위 밖 %s는 사본도 저장도 만들지 않는다',level=>{
    const source=freshLabProgress(preferences);expect(()=>completeLabThrough(source,level)).toThrow(RangeError);expect(source.completed).toEqual([]);
  });
  it('초기화는 전달한 진행을 펼쳐 복사하지 않고 언어·음량만 유지한다',()=>{
    const full={...completeLabThrough(freshLabProgress(preferences),500).save,garden:5,pip:{growth:100,affection:100}};
    expect(freshLabProgress(full)).toEqual({...freshLabProgress(preferences),garden:0});
  });
  it('세 키의 모든 read/write/remove가 namespace 안에 있고 재로드·reset도 정상 키를 건드리지 않는다',()=>{
    const disk=new Map([[SAVE_KEY,'normal-primary'],[BACKUP_KEY,'different-backup'],[RESET_KEY,'normal-reset']]),seen:string[]=[];
    const access=()=>({getItem:(key:string)=>{seen.push(key);return disk.get(key)??null;},setItem:(key:string,value:string)=>{seen.push(key);disk.set(key,value);},removeItem:(key:string)=>{seen.push(key);disk.delete(key);}});
    const store=createLabStore(access);store.load();expect(store.save(completeLabThrough(freshLabProgress(preferences),10).save)).toBe(true);
    expect(createLabStore(access).load().completed).toHaveLength(10);expect(store.reset()).toBeDefined();expect(store.save(freshLabProgress(preferences))).toBe(true);
    expect(seen.every(key=>key.startsWith(LAB_PREFIX))).toBe(true);expect([disk.get(SAVE_KEY),disk.get(BACKUP_KEY),disk.get(RESET_KEY)]).toEqual(['normal-primary','different-backup','normal-reset']);
  });
});
