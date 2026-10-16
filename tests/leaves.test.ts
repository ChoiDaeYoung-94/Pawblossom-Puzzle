import {describe,expect,it} from 'vitest';
import {BoardEngine,seededRng,type Special} from '../src/core';

function fixture(){
  const engine=new BoardEngine(8,8,seededRng(42));
  engine.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));
  return engine;
}
function four(engine:BoardEngine){
  for(const [r,c,k] of [[2,0,5],[2,1,5],[2,2,5],[2,3,1],[3,3,5]])engine.board[r][c]={kind:k};
}
describe('고정 낙엽 바닥층',()=>{
  it('자기 칸·직교 이웃 매치는 한 단계에 한 겹만 제거하고 새 특수 아래도 처리합니다',()=>{
    const engine=fixture();four(engine);
    engine.setLeaves([{row:2,col:3,layers:2},{row:1,col:1,layers:2},{row:1,col:4,layers:2}]);
    const step=engine.swap({row:3,col:3},{row:2,col:3}).steps[0];
    expect(step.created).toContainEqual({row:2,col:3,tile:{kind:5,special:'row'}});
    expect(step.leaves?.hits).toEqual([{row:1,col:1,before:2,after:1},{row:2,col:3,before:2,after:1}]);
    expect(step.leaves?.after[1][4]).toBe(2);
    expect(step.removed).not.toContainEqual({row:2,col:3});
  });
  it.each([['row',3,5],['column',5,3],['bomb',4,4],['rainbow',0,3]] as [Special,number,number][])
  ('%s 직접 효과는 두 겹 더미도 한 번에 치웁니다',(special,row,col)=>{
    const engine=fixture();engine.board[3][3].special=special;engine.setLeaves([{row,col,layers:2}]);
    const result=engine.activate({row:3,col:3});
    expect(result.steps[0].leaves?.hits).toEqual([{row,col,before:2,after:0}]);
    expect(result.leavesCleared).toBe(1);expect(engine.remainingLeaves()).toBe(0);
  });
  it('연쇄별 스냅샷은 앞 단계와 연결되며 제거 수와 전체 더미 수가 일치합니다',()=>{
    for(let seed=1;seed<=20;seed++){
      const engine=new BoardEngine(8,8,seededRng(seed));
      engine.setLeaves(Array.from({length:8},(_,row)=>({row,col:row,layers:2})));
      for(let move=0;move<12;move++){
        const initial=engine.leaves.map(row=>row.slice()),count=engine.remainingLeaves();
        const next=engine.legalMoves()[0],result=engine.swap(next.a,next.b);
        let previous=initial,cleared=0;
        for(const step of result.steps)if(step.leaves){
          expect(step.leaves.before).toEqual(previous);
          expect(new Set(step.leaves.hits.map(p=>p.row*8+p.col)).size).toBe(step.leaves.hits.length);
          cleared+=step.leaves.hits.filter(p=>p.after===0).length;previous=step.leaves.after;
        }
        expect(previous).toEqual(engine.leaves);expect(result.leavesCleared??0).toBe(cleared);
        expect(count-engine.remainingLeaves()).toBe(cleared);
      }
    }
  });
  it('타일 낙하와 섞기·생성 대체 경로에서도 바닥 좌표를 유지합니다',()=>{
    const engine=fixture();four(engine);engine.setLeaves([{row:7,col:7,layers:2}]);
    const result=engine.swap({row:3,col:3},{row:2,col:3});
    expect(result.steps[0].leaves).toBeUndefined();expect(engine.leaves[7][7]).toBe(2);
    const before=JSON.stringify(engine.leaves);engine.shuffle();expect(JSON.stringify(engine.leaves)).toBe(before);
    engine.board=engine.board.map(row=>row.map(()=>({kind:0})));
    engine.shuffle();expect(JSON.stringify(engine.leaves)).toBe(before);
  });
  it('무효 교환·일반 탭은 낙엽을 바꾸지 않고 잘못된 설정은 기존 층을 유지합니다',()=>{
    const engine=fixture();engine.setLeaves([{row:0,col:0,layers:2}]);const before=JSON.stringify(engine.leaves);
    expect(engine.swap({row:0,col:0},{row:0,col:1}).valid).toBe(false);expect(engine.activate({row:0,col:0}).valid).toBe(false);
    for(const piles of [[{row:-1,col:0,layers:1}],[{row:0,col:0,layers:3}],[{row:0,col:0,layers:1},{row:0,col:0,layers:2}]]){
      expect(()=>engine.setLeaves(piles as never)).toThrow(RangeError);expect(JSON.stringify(engine.leaves)).toBe(before);
    }
  });
});
