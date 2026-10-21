import {describe,it,expect,vi} from 'vitest';
import {BoardEngine,seededRng} from '../src/core';
import {cloneSnapshot,prepareShuffle} from '../src/puzzleHelp';
import {validateCheckpoint,levelSignature} from '../src/state';
import {levels} from '../src/levels';

const snapshot=()=>{const e=new BoardEngine(8,8,seededRng(42),undefined,2);return {board:e.board,leaves:e.leaves,ruleVersion:e.ruleVersion};};
const inventory=(s:ReturnType<typeof snapshot>)=>s.board.flat().map(t=>`${t.kind}:${t.special??''}`).sort();
describe('독립 섞기 후보와 회차 도움 저장',()=>{
  it('종류·특수·낙엽·규칙과 확장 DTO를 보존하며 원본을 바꾸지 않습니다',()=>{
    const source={...snapshot(),future:{mask:null,label:'preserve'}};source.board[0][0].special='rainbow';source.board[1][1].special='bomb';source.leaves[3][3]=2;
    const before=cloneSnapshot(source),candidate=prepareShuffle(source,seededRng(83));expect(candidate).toBeDefined();
    expect(source).toEqual(before);expect(inventory(candidate!)).toEqual(inventory(source));expect(candidate!.leaves).toEqual(source.leaves);
    expect(candidate!.ruleVersion).toBe(2);expect(candidate!.future).toEqual(source.future);expect(candidate!.future).not.toBe(source.future);
    const e=new BoardEngine(8,8,()=>{throw Error('조회 중 난수');},candidate);expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);
  });
  it('기본 후보는 Math.random과 원래 엔진의 보충 RNG를 소비하지 않습니다',()=>{
    const e=new BoardEngine(8,8,seededRng(25));const spy=vi.spyOn(Math,'random').mockImplementation(()=>{throw Error('공유 난수');});
    try{expect(prepareShuffle({board:e.board,leaves:e.leaves,ruleVersion:e.ruleVersion})).toBeDefined();expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
    const control=new BoardEngine(8,8,seededRng(25));e.shuffle();control.shuffle();expect(e.board).toEqual(control.board);
  });
  it('재생성 fallback이 종류/특수를 잃으면 후보를 거절합니다',()=>{
    const source=snapshot();source.board=source.board.map(row=>row.map(()=>({kind:0})));source.board[0][0].special='rainbow';
    const before=cloneSnapshot(source);expect(prepareShuffle(source,seededRng(10))).toBeUndefined();expect(source).toEqual(before);
  });
  const checkpoint=()=>({...snapshot(),schema:1,levelId:1,levelSignature:levelSignature(levels[0]),moves:5,score:0,collected:[0,0,0,0,0,0],shuffles:0,clearedLeaves:0});
  it('구형 cap 없음은 부재로 보존하고 새 cap은 복원합니다',()=>{
    expect(validateCheckpoint(checkpoint(),1)).not.toHaveProperty('continueUsed');
    expect(validateCheckpoint({...checkpoint(),paidShuffleUsed:true,continueUsed:true},1)).toMatchObject({paidShuffleUsed:true,continueUsed:true,moves:5});
  });
  it.each([{continueUsed:'true'},{paidShuffleUsed:1},{paidShuffleUsed:true,shuffles:1},{continueUsed:true,moves:6}])('불가능한 cap %j는 회차만 거절합니다',patch=>{
    expect(validateCheckpoint({...checkpoint(),...patch},1)).toBeUndefined();
  });
});
