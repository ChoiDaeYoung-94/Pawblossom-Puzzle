/** 버전별 명령은 호출자에 두고 기존 운반의 순수 판정·공동 중력·보충만 공유합니다. */
import type {Cell,Grid,Position,Motion,Delivery,CarrierStatus,CarrierFrame} from './CarrierEngine';

export type MutableGrid = (Cell|null)[][];
export type Draft = {board:MutableGrid;delivered:string[];movesRemaining:number;status:CarrierStatus;
  rngState:number;randomDraws:number;serial:number};
export const same=(a:Position,b:Position)=>a.row===b.row&&a.col===b.col;
export const copyBoard=(board:Grid):MutableGrid=>board.map(row=>row.map(cell=>cell?{...cell}:null));
export const freezeBoard=(board:Grid):Grid=>Object.freeze(board.map(row=>Object.freeze(row.map(cell=>cell?Object.freeze({...cell}):null))));
export const clone=(draft:Draft):Draft=>({...draft,board:copyBoard(draft.board),delivered:draft.delivered.slice()});
export const point=(row:number,col:number):Position=>Object.freeze({row,col});
export const idPattern=/^[a-z][a-z0-9-]{0,47}$/;

export function plain(value:unknown,allowed:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new TypeError('carrier config object');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const [key,descriptor] of Object.entries(descriptors)){
    if(!allowed.includes(key)||!('value' in descriptor))throw new TypeError('unsupported carrier config');
  }
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string'))throw new TypeError('carrier config key');
  return value as Record<string,unknown>;
}
export function denseArray(value:unknown):unknown[]{
  if(!Array.isArray(value)||Reflect.ownKeys(value).length!==value.length+1||Object.keys(value).length!==value.length)throw new TypeError('dense carrier array');
  for(let i=0;i<value.length;i++)if(!Object.hasOwn(value,i)||!('value' in Object.getOwnPropertyDescriptor(value,i)!))throw new TypeError('carrier array entry');
  return value;
}
export const integer=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isInteger(n)&&n>=min&&n<=max;

/** 일반 색만 판정합니다. 운반물/구멍에서 선이 끊기며 2×2·특수 생성은 다루지 않습니다. */
export function matches(board:Grid):Position[]{
  const result=new Map<string,Position>();
  const scan=(line:Position[])=>{
    let run:Position[]=[],color=-1;
    const flush=()=>{if(run.length>=3)for(const p of run)result.set(`${p.row}:${p.col}`,p);run=[];};
    for(const p of line){const cell=board[p.row][p.col];
      if(cell?.type==='tile'){
        if(cell.color!==color){flush();color=cell.color;}
        run.push(p);
      }else{flush();color=-1;}
    }
    flush();
  };
  for(let row=0;row<board.length;row++)scan(board[row].map((_,col)=>point(row,col)));
  for(let col=0;col<board[0].length;col++)scan(board.map((_,row)=>point(row,col)));
  return [...result.values()].sort((a,b)=>a.row-b.row||a.col-b.col);
}
export function makesMatch(board:MutableGrid,a:Position,b:Position){
  const first=board[a.row][a.col],second=board[b.row][b.col];
  if(!first||!second||first.type==='carrier'&&second.type==='carrier')return false;
  board[a.row][a.col]=second;board[b.row][b.col]=first;
  const valid=matches(board).some(p=>same(p,a)||same(p,b));
  board[a.row][a.col]=first;board[b.row][b.col]=second;
  return valid;
}
export function boardMoves(board:Grid):{a:Position;b:Position}[]{
  const candidate=copyBoard(board),result:{a:Position;b:Position}[]=[];
  for(let row=0;row<board.length;row++)for(let col=0;col<board[0].length;col++){
    if(!board[row][col])continue;
    const a=point(row,col);
    for(const b of [point(row,col+1),point(row+1,col)]){
      if(b.row<board.length&&b.col<board[0].length&&makesMatch(candidate,a,b))result.push({a,b});
    }
  }
  return result;
}

export function nextColor(work:Draft){
  work.rngState=(work.rngState+0x6d2b79f5)>>>0;work.randomDraws++;
  let n=work.rngState;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);
  return Math.floor((((n^(n>>>14))>>>0)/0x100000000)*6);
}

export function compact(board:MutableGrid,mask:readonly (readonly boolean[])[]){
  const motions:Motion[]=[];
  for(let col=0;col<mask[0].length;col++){
    for(let top=0;top<mask.length;){
      if(!mask[top][col]){top++;continue;}
      let bottom=top;while(bottom+1<mask.length&&mask[bottom+1][col])bottom++;
      const occupied:{cell:Cell;row:number}[]=[];
      for(let row=top;row<=bottom;row++)if(board[row][col])occupied.push({cell:board[row][col]!,row});
      for(let row=top;row<=bottom;row++)board[row][col]=null;
      const offset=bottom-occupied.length+1;
      occupied.forEach(({cell,row},index)=>{
        const target=offset+index;board[target][col]=cell;
        if(target!==row)motions.push({id:cell.id,from:point(row,col),to:point(target,col)});
      });
      top=bottom+1;
    }
  }
  return motions;
}

export type CarrierWaveEmit=(kind:'fall'|'exit'|'refill',cascade:number,motions?:Motion[],removed?:CarrierFrame['removed'],deliveries?:Delivery[])=>void;
export function settleCarrierWave(work:Draft,mask:readonly (readonly boolean[])[],exits:readonly Position[],carrierCount:number,cascade:number,emit:CarrierWaveEmit){
  // 배송 빈칸을 먼저 재압축합니다. 보충 타일로 운반물의 실제 경로를 바꾸지 않습니다.
  for(let deliveriesLeft=carrierCount;;){
    const falls=compact(work.board,mask);
    if(falls.length)emit('fall',cascade,falls);
    const delivered:Delivery[]=[];
    for(const at of exits){const cell=work.board[at.row][at.col];
      if(cell?.type==='carrier'){
        if(deliveriesLeft--<=0||work.delivered.includes(cell.carrierId))throw new Error('carrier delivery invariant');
        delivered.push({id:cell.id,carrierId:cell.carrierId,at});work.delivered.push(cell.carrierId);work.board[at.row][at.col]=null;
      }
    }
    if(!delivered.length)break;
    emit('exit',cascade,[],[],delivered);
  }
  for(let row=0;row<mask.length;row++)for(let col=0;col<mask[0].length;col++){
    if(mask[row][col]&&!work.board[row][col])work.board[row][col]={type:'tile',id:`tile:${++work.serial}`,color:nextColor(work)};
  }
  emit('refill',cascade);
}
