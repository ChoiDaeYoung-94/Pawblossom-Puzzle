import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSave, saveData, levelSignature, validateCheckpoint, type RoundCheckpoint } from '../src/state';
import { LEVEL_COUNT, levels } from '../src/levels';
import { BoardEngine, seededRng } from '../src/core';

afterEach(()=>vi.unstubAllGlobals());
function storage(value:unknown){
  const base={version:1,highestLevel:1,completed:[],stars:0,coins:0,garden:0};
  const data=value&&typeof value==='object'?{...base,...value}:value;
  const values=new Map<string,string>(data===null?[]:[['pawblossom.save.v1',JSON.stringify(data)]]);
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,next:string)=>{values.set(key,next);},removeItem:(key:string)=>values.delete(key)});
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

function roundSave():RoundCheckpoint {
  const level=levels[5],engine=new BoardEngine(8,8,seededRng(42));engine.setLeaves(level.leaves!);
  engine.board[0][0]!.special='rainbow';engine.leaves[2][2]=1;engine.leaves[2][5]=0;
  return {schema:1,levelId:6,levelSignature:levelSignature(level),board:engine.board,leaves:engine.leaves,
    moves:24,score:1240,collected:[3,4,5,6,7,8],shuffles:0,clearedLeaves:1};
}
describe('안정 회차 저장 검증',()=>{
  it('2×2가 남은 구 회차는 기존 규칙으로 복원하고 새 V2 안정 검사와 구분하며 Pip·영구 기록을 보존합니다',()=>{
    const checkpoint=roundSave();checkpoint.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%5})));
    for(const [r,c] of [[2,2],[2,3],[3,2],[3,3]])checkpoint.board[r][c]={kind:5};
    checkpoint.board[0][0]!.special='row';
    expect(validateCheckpoint(checkpoint,6)).toEqual(checkpoint);
    expect(validateCheckpoint({...checkpoint,ruleVersion:2},6)).toBeUndefined();
    for(const ruleVersion of [null,0,3,'2'])expect(validateCheckpoint({...checkpoint,ruleVersion},6)).toBeUndefined();
    const pip={growth:34,affection:22,owned:['ribbon'],equipped:'ribbon'};
    storage({version:1,highestLevel:6,completed:[1,2,3,4,5],stars:3,coins:200,garden:1,pip,inProgress:checkpoint});
    const save=loadSave();expect(save.pip).toEqual(pip);expect(save.inProgress).toEqual(checkpoint);
    expect(new BoardEngine(8,8,()=>{throw Error('복원 난수');},save.inProgress).ruleVersion).toBe(1);
    expect(saveData(save)).toBe(true);expect(loadSave()).toEqual(save);
  });
  it('명시 V2 checkpoint는 같은 규칙으로 왕복하며 구 회차의 명시1도 유지합니다',()=>{
    for(const ruleVersion of [1,2] as const){
      const checkpoint={...roundSave(),ruleVersion};expect(validateCheckpoint(checkpoint,6)).toEqual(checkpoint);
      storage({highestLevel:6,completed:[1,2,3,4,5],inProgress:checkpoint});const save=loadSave();expect(saveData(save)).toBe(true);expect(loadSave().inProgress?.ruleVersion).toBe(ruleVersion);
    }
  });
  it('보드·특수·낙엽·수치와 기존 영구 기록을 같은 저장 키로 복원합니다',()=>{
    storage({version:1,highestLevel:6,completed:[1,2,3,4,5],stars:3,coins:200,garden:1,inProgress:roundSave()});
    const save=loadSave();expect(save.inProgress).toEqual(roundSave());
    expect(saveData(save)).toBe(true);expect(loadSave()).toEqual(save);
  });
  it.each([
    ['스키마',(x:RoundCheckpoint)=>{x.schema=2 as 1;}],
    ['레벨 서명',(x:RoundCheckpoint)=>{x.levelSignature+='old';}],
    ['레벨 ID',(x:RoundCheckpoint)=>{x.levelId=31;}],
    ['이동 종료',(x:RoundCheckpoint)=>{x.moves=0;}],
    ['이동 초과',(x:RoundCheckpoint)=>{x.moves=29;}],
    ['음수 점수',(x:RoundCheckpoint)=>{x.score=-1;}],
    ['점수 상한',(x:RoundCheckpoint)=>{x.score=100_000_001;}],
    ['섞기 횟수',(x:RoundCheckpoint)=>{x.shuffles=2;}],
    ['수집 크기',(x:RoundCheckpoint)=>{x.collected.push(0);}],
    ['수집 상한',(x:RoundCheckpoint)=>{x.collected[0]=1_000_001;}],
    ['행 크기',(x:RoundCheckpoint)=>{x.board[0].pop();}],
    ['타일 종류',(x:RoundCheckpoint)=>{x.board[0][0]!.kind=6;}],
    ['특수 종류',(x:RoundCheckpoint)=>{x.board[0][0]!.special='other' as never;}],
    ['낙엽 위치',(x:RoundCheckpoint)=>{x.leaves[0][0]=1;}],
    ['낙엽 겹 수',(x:RoundCheckpoint)=>{x.leaves[2][2]=3;}],
    ['낙엽 완료 수',(x:RoundCheckpoint)=>{x.clearedLeaves=2;}],
    ['이미 완료된 목표',(x:RoundCheckpoint)=>{x.collected.fill(100);x.leaves=x.leaves.map(row=>row.map(()=>0));x.clearedLeaves=4;}],
    ['불안정 매치',(x:RoundCheckpoint)=>{x.board[0][0]={kind:0};x.board[0][1]={kind:0};x.board[0][2]={kind:0};}],
    ['이동 없는 보드',(x:RoundCheckpoint)=>{x.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));}],
  ] as const)('%s 손상은 회차만 버리고 별·코인·정원을 유지합니다',(_name,damage)=>{
    const checkpoint=roundSave();damage(checkpoint);
    storage({version:1,highestLevel:6,completed:[1,2,3,4,5],stars:3,coins:200,garden:1,inProgress:checkpoint});
    expect(loadSave()).toMatchObject({highestLevel:6,stars:3,coins:200,garden:1});expect(loadSave().inProgress).toBeUndefined();
  });
  it('잠긴 ID는 복원하지 않으며 기존 완료 목록의 해제 경계를 사용합니다',()=>{
    storage({version:1,highestLevel:1,inProgress:roundSave()});expect(loadSave().inProgress).toBeUndefined();
    storage({version:1,highestLevel:1,completed:[1,2,3,4,5],inProgress:roundSave()});expect(loadSave().inProgress?.levelId).toBe(6);
  });
  it('검증·스냅샷 복원·합법 이동 조회는 난수를 소비하지 않고 입력을 복사합니다',()=>{
    const rng=vi.fn(()=>{throw Error('난수 소비');}),snapshot=roundSave(),before=structuredClone(snapshot);
    const valid=validateCheckpoint(snapshot,6)!;expect(valid).toEqual(before);
    const engine=new BoardEngine(8,8,rng,valid);engine.legalMoves();expect(rng).not.toHaveBeenCalled();
    engine.board[0][0]!.kind=2;engine.leaves[2][2]=0;valid.collected[0]=100;
    expect(snapshot).toEqual(before);
  });
  it('비정상 대형 배열은 원소 검사를 시작하기 전에 크기로 거부합니다',()=>{
    const large=new Array(100_000);Object.defineProperty(large,0,{get(){throw Error('대형 입력 순회');}});
    expect(validateCheckpoint({...roundSave(),board:large},6)).toBeUndefined();
    expect(validateCheckpoint({...roundSave(),leaves:large},6)).toBeUndefined();
    expect(validateCheckpoint({...roundSave(),collected:large},6)).toBeUndefined();
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
    storage({version:1,completed:[1,1,3,30,LEVEL_COUNT+1,-1,'2'],highestLevel:1});
    expect(loadSave()).toMatchObject({completed:[1,3,30],highestLevel:2});
  });
});

describe('비정형 콘텐츠 해금과 구 회차 보존',()=>{
  it('구40완료는41, 구100완료는101을 열고 재화·풍경을 백업 복원하며501을 거절합니다',()=>{
    const completed=Array.from({length:40},(_,i)=>i+1);storage({completed,highestLevel:40,stars:40});expect(loadSave().highestLevel).toBe(41);
    const data={version:1,language:'ko',completed:Array.from({length:100},(_,i)=>i+1),highestLevel:100,stars:100,coins:400,garden:5,music:true,sfx:true,tutorialSeen:true,pip:{growth:100,affection:100,owned:[],equipped:'none'},gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:[],placed:[],ownedThemes:['sunset','starlight'],theme:'starlight'}};
    storage(data);const save=loadSave();expect(save.highestLevel).toBe(101);expect(save.completed).toHaveLength(100);expect(saveData(save)).toBe(true);localStorage.setItem('pawblossom.save.v1','{');expect(loadSave().gardenDesign?.theme).toBe('starlight');expect(loadSave().stars).toBe(100);
    storage({...data,highestLevel:101});expect(loadSave().highestLevel).toBe(101);
    storage({...data,highestLevel:501});expect(loadSave().completed).toEqual([]);
    storage({...data,completed:Array.from({length:500},(_,i)=>i+1),highestLevel:500,stars:500});expect(loadSave()).toMatchObject({highestLevel:500,stars:500,coins:400,garden:5});expect(loadSave().completed).toHaveLength(500);
  });
  it('1–30 완료만 31을 열며 구 30 checkpoint·Pip·재화는 변경하지 않습니다',()=>{
    const l=levels[29],e=new BoardEngine(8,8,seededRng(42),undefined,1);e.setLeaves(l.leaves??[]);
    const inProgress={schema:1,levelId:30,levelSignature:levelSignature(l),board:e.board,leaves:e.leaves,moves:24,score:0,collected:[0,0,0,0,0,0],shuffles:1,clearedLeaves:0};
    const pip={growth:34,affection:22,owned:[],equipped:'none'};
    storage({completed:Array.from({length:30},(_,i)=>i+1),highestLevel:30,stars:7,coins:240,garden:1,pip,inProgress});
    expect(loadSave()).toMatchObject({highestLevel:31,stars:7,coins:240,garden:1,pip,inProgress});
    expect(loadSave().inProgress).not.toHaveProperty('ruleVersion');
    storage({completed:[1,30],highestLevel:30});expect(loadSave().highestLevel).toBe(30);
  });
});
