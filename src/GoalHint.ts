import {BoardEngine,type LegalMove,type Position} from './core/BoardEngine';

export interface HintGoals {
  colors:readonly {kind:number;remaining:number}[];
  leaves:boolean;
  crates:boolean;
}

/** 현재 합법 수의 첫 매치 관련도만 비교합니다. 연쇄·보충·특수 효과 예측은 하지 않습니다. */
export function goalAwareHint(engine:BoardEngine,moves:readonly LegalMove[],goals?:HintGoals):LegalMove|undefined {
  const first=moves[0];if(!first||moves.length<2||!goals)return first;
  const remaining=new Map<number,number>();
  for(const goal of goals.colors){
    if(Number.isInteger(goal.kind)&&goal.kind>=0&&Number.isFinite(goal.remaining)&&goal.remaining>0)remaining.set(goal.kind,Math.max(remaining.get(goal.kind)??0,goal.remaining));
  }
  if(!remaining.size&&!goals.leaves&&!goals.crates)return first;
  const snapshot={board:engine.board,leaves:engine.leaves,ruleVersion:engine.ruleVersion,...(engine.hasCrates?{crates:engine.crates}:{})};
  const preview=new BoardEngine(engine.rows,engine.cols,()=>{throw new Error('힌트 관련도 조회는 난수를 사용하지 않습니다.');},snapshot,engine.ruleVersion,engine.mask);
  let best=first,bestScore=0;
  for(const move of moves){
    const {a,b}=move,left=preview.board[a.row]?.[a.col],right=preview.board[b.row]?.[b.col];
    // 특수의 교환·조합 효과를 일반 매치로 추정하지 않습니다. 합법 후보의 원래 순서는 보존합니다.
    if(!left||!right||left.special||right.special)continue;
    preview.board[a.row][a.col]=right;preview.board[b.row][b.col]=left;
    try {
      const matched=new Map<string,Position>();
      for(const position of preview.findMatches())matched.set(`${position.row},${position.col}`,position);
      const colors=new Map<number,number>(),floor=new Map<string,Position>();
      for(const position of matched.values()){
        const tile=preview.board[position.row][position.col];if(tile)colors.set(tile.kind,(colors.get(tile.kind)??0)+1);
        for(const [dr,dc] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]){
          const p={row:position.row+dr,col:position.col+dc};if(preview.isActive(p))floor.set(`${p.row},${p.col}`,p);
        }
      }
      // 새 특수의 보존 칸도 포함한 관련도이며 실제 수집/제거 수량으로 표시하지 않습니다.
      let score=[...colors].reduce((sum,[kind,count])=>sum+Math.min(count,remaining.get(kind)??0),0);
      for(const p of floor.values()){
        if(goals.leaves&&engine.leaves[p.row][p.col]>0)score++;
        if(goals.crates&&engine.crates[p.row][p.col]>0)score++;
      }
      if(score>bestScore){best=move;bestScore=score;}
    }finally{preview.board[a.row][a.col]=left;preview.board[b.row][b.col]=right;}
  }
  return best;
}
