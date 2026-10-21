import {BoardEngine,seededRng,type BoardMask,type Tile,type BoardSnapshot} from './core';

/** 저장용 JSON DTO의 알려지지 않은 선택 필드/null도 복제 중 버리지 않습니다. */
export const cloneSnapshot=<T extends BoardSnapshot>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const inventory=(snapshot:BoardSnapshot)=>JSON.stringify(snapshot.board.flat().map(tile=>tile?`${tile.kind}:${tile.special??''}`:'hole').sort());

/** 후보 전용 새 seed 한 개만 사용합니다. 원래 엔진 RNG/미래 보충은 조회하지 않습니다. */
export function prepareShuffle<T extends BoardSnapshot>(snapshot:T,rng?:()=>number,mask?:BoardMask):T|undefined {
  try{
    if(!rng){const seed=new Uint32Array(1);globalThis.crypto.getRandomValues(seed);rng=seededRng(seed[0]);}
    const source=cloneSnapshot(snapshot),engine=new BoardEngine(8,8,rng,source,undefined,mask);
    const positions=engine.mask.flatMap((line,row)=>line.flatMap((active,col)=>active?[{row,col}]:[]));
    const tiles:Tile[]=positions.map(p=>engine.board[p.row][p.col]!);let found=false;
    // 유료 후보에는 엔진의 재생성 fallback을 사용하지 않습니다.
    for(let attempt=0;attempt<300;attempt++){
      for(let i=tiles.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[tiles[i],tiles[j]]=[tiles[j],tiles[i]];}
      positions.forEach((p,i)=>{engine.board[p.row][p.col]=tiles[i];});
      if(!engine.findMatches().length&&engine.hasMoves()){found=true;break;}
    }
    if(!found)return;
    const candidate={...source,board:engine.board,leaves:engine.leaves,ruleVersion:engine.ruleVersion};
    // 엔진의 재생성 fallback으로 특수/종류가 손실되면 비용 없이 거절합니다.
    if(inventory(source)!==inventory(candidate)||JSON.stringify(source.leaves)!==JSON.stringify(candidate.leaves)
      ||engine.findMatches().length||!engine.hasMoves())return;
    return cloneSnapshot(candidate);
  }catch{return;}
}
