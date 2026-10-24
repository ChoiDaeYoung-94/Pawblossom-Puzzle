import {COLUMN_CARRIER_PROFILE,type ColumnCarrierLevel,type ColumnInput} from './ColumnCarrierEngine';

const board:ColumnInput[][]=Array.from({length:6},(_,row)=>Array.from({length:6},(_,col)=>(row*2+col)%6));
board[1][2]={carrierId:'column-parcel'};
board[4][2]={color:4,special:'column'};
board[2][0]=3;board[2][1]=3;
/** seed11의 실제 보충이 이어지는 매치를 만듭니다. 기존 판의 seed/규칙은 바꾸지 않습니다. */
export const columnScenario:ColumnCarrierLevel=Object.freeze({profile:COLUMN_CARRIER_PROFILE,id:'column-parcel-cascade',
  board:Object.freeze(board.map(row=>Object.freeze(row.map(cell=>cell&&typeof cell==='object'?Object.freeze(cell):cell)))),
  exits:Object.freeze([Object.freeze({row:5,col:2})]),moves:8,seed:11});
