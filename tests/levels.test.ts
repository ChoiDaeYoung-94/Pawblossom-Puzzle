import {describe,expect,it} from 'vitest';
import {levels} from '../src/levels';
import {BoardEngine,seededRng} from '../src/core';

describe('출시 전 레벨 데이터 점검',()=>{
  it('첫 세 스테이지는 기존 규칙이고 이후 낙엽 위치와 겹 수는 유효합니다',()=>{
    expect(levels.slice(0,3).map(level=>level.leaves)).toEqual([undefined,undefined,undefined]);
    for(const level of levels.slice(3)){
      const engine=new BoardEngine(8,8,seededRng(1));engine.setLeaves(level.leaves!);
      expect(engine.remainingLeaves()).toBe(level.leaves!.length);expect(level.leaves!.length).toBeGreaterThan(0);
    }
    expect(levels[3].leaves!.every(p=>p.layers===1)).toBe(true);
    expect(levels[5].leaves!.every(p=>p.layers===2)).toBe(true);
  });
  it('저장 ID 1~10을 유지하고 목표가 실제 타일 종류와 연결됩니다',()=>{
    expect(levels.map(level=>level.id)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    for(const level of levels){
      expect(Number.isInteger(level.moves)&&level.moves>0).toBe(true);
      expect(level.goals.length).toBeGreaterThan(0);
      expect(new Set(level.goals.map(goal=>goal.kind)).size).toBe(level.goals.length);
      for(const goal of level.goals){
        expect(Number.isInteger(goal.kind)&&goal.kind>=0&&goal.kind<6).toBe(true);
        expect(Number.isInteger(goal.count)&&goal.count>0).toBe(true);
      }
    }
  });
});

describe('힌트와 자동 점검의 합법 이동',()=>{
  it('조회가 타일·특수·보충 난수를 소비하지 않습니다',()=>{
    const rng=seededRng(19);let calls=0;
    const engine=new BoardEngine(8,8,()=>{calls++;return rng();});
    engine.board[0][0].special='rainbow';
    const before=JSON.stringify(engine.board), count=calls;
    const moves=engine.legalMoves();
    expect(engine.legalMoves()).toEqual(moves);
    expect(engine.hasMoves()).toBe(true);
    expect(JSON.stringify(engine.board)).toBe(before);
    expect(calls).toBe(count);
  });
  it('일반·특수 보드에서 모든 이웃 교환의 실제 유효성과 일치합니다',()=>{
    for(const special of [false,true])for(let seed=1;seed<=4;seed++){
      const source=new BoardEngine(8,8,seededRng(seed));
      if(special){source.board[0][0].special='rainbow';source.board[3][3].special='row';source.board[3][4].special='bomb';}
      const listed=source.legalMoves();
      const keys=listed.map(({a,b})=>`${a.row},${a.col}:${b.row},${b.col}`);
      expect(new Set(keys).size).toBe(keys.length);
      const probe=new BoardEngine(8,8,seededRng(900));
      for(let row=0;row<8;row++)for(let col=0;col<8;col++)for(const b of [{row,col:col+1},{row:row+1,col}]){
        if(b.row>=8||b.col>=8)continue;
        probe.board=source.board.map(line=>line.map(tile=>({...tile})));
        expect(probe.swap({row,col},b).valid).toBe(keys.includes(`${row},${col}:${b.row},${b.col}`));
      }
    }
  });
});
