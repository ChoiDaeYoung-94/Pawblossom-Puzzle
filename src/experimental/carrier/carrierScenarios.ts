import {CARRIER_PROFILE,type CarrierInput,type CarrierLevel,type Position} from './CarrierEngine';

export interface CarrierScenario {
  readonly level:CarrierLevel;
  readonly title:{ko:string;en:string};
  readonly description:{ko:string;en:string};
  /** 작성된 대표 공략입니다. 플레이 중 상태/RNG를 바꾸거나 자동 실행하지 않습니다. */
  readonly authoredPath:readonly {a:Position;b:Position}[];
}
const field=(size:number):CarrierInput[][]=>Array.from({length:size},(_,row)=>Array.from({length:size},(_,col)=>(row*2+col)%6));
const carrier=(carrierId:string)=>({carrierId});

function straight():CarrierScenario{
  const board=field(6);
  board[4][0]=carrier('meadow-seeds');board[4][1]=0;
  board[5][0]=0;board[5][1]=1;board[5][2]=0;
  return {level:{profile:CARRIER_PROFILE,id:'first-delivery',board,exits:[{row:5,col:0}],moves:8,seed:11},
    title:{ko:'첫 번째 씨앗 배송',en:'First seed delivery'},
    description:{ko:'꾸러미 아래를 맞추면 블록과 꾸러미가 함께 내려와요.',en:'Match below the parcel. Tiles and parcels fall together.'},
    authoredPath:[{a:{row:4,col:1},b:{row:5,col:1}}]};
}
function lateral():CarrierScenario{
  const board=field(6);
  board[3][0]=0;board[4][0]=0;board[5][0]=carrier('pond-seeds');board[5][1]=0;
  return {level:{profile:CARRIER_PROFILE,id:'align-the-exit',board,exits:[{row:5,col:1}],moves:10,seed:23},
    title:{ko:'출구 쪽으로 한 칸',en:'One step toward the exit'},
    description:{ko:'꾸러미도 교환할 수 있어요. 다른 블록의 3매치가 생겨야 해요.',en:'You can swap a parcel when the other tile makes a match of three.'},
    authoredPath:[{a:{row:5,col:0},b:{row:5,col:1}}]};
}
function segmented():CarrierScenario{
  const board=field(8);
  for(const row of [0,1,6,7])for(const col of [0,7])board[row][col]=null;
  for(const row of [3,4])for(const col of [4,5])board[row][col]=null;
  board[6][1]=carrier('sunny-seeds');board[6][2]=0;
  board[7][1]=0;board[7][2]=1;board[7][3]=0;
  board[6][5]=carrier('forest-seeds');board[6][4]=3;board[6][6]=3;
  board[7][4]=2;board[7][5]=3;board[7][6]=2;
  return {level:{profile:CARRIER_PROFILE,id:'two-garden-paths',board,exits:[{row:7,col:1},{row:7,col:5}],moves:16,seed:37},
    title:{ko:'갈라진 정원 길',en:'Two garden paths'},
    description:{ko:'빈 공간을 건너뛰어 떨어지지 않아요. 각 출구의 길을 만들어 주세요.',en:'Parcels cannot fall through gaps. Open the path to each exit.'},
    authoredPath:[{a:{row:6,col:2},b:{row:7,col:2}},{a:{row:6,col:5},b:{row:7,col:5}}]};
}
/** 본게임 levels/진행/저장과 연결하지 않는 별도 세 시나리오입니다. */
export const carrierScenarios:readonly CarrierScenario[]=Object.freeze([straight(),lateral(),segmented()]);
