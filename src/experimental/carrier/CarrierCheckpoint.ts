import type {CarrierSnapshot,Cell} from './CarrierEngine';
import type {ColumnSnapshot} from './ColumnCarrierEngine';
import {freezeBoard,boardMoves,matches,nextColor,integer,type Draft,type MutableGrid} from './CarrierMechanics';

type Snapshot=CarrierSnapshot|ColumnSnapshot;
export type CheckpointCell=Extract<Cell,{type:'tile'}>&Readonly<{special?:'column'}>|Extract<Cell,{type:'carrier'}>;
export interface CarrierCheckpoint {
  readonly schema:1;
  readonly profile:Snapshot['profile'];
  /** 정확한 초기 콘텐츠 계약문입니다. 인증 서명이나 플레이 이력의 증명이 아닙니다. */
  readonly levelContract:string;
  readonly state:Readonly<{
    board:readonly (readonly (CheckpointCell|null)[])[];delivered:readonly string[];
    movesRemaining:number;status:Snapshot['status'];rngState:number;randomDraws:number;serial:number;
  }>;
}
const fail=():never=>{throw new TypeError('invalid carrier checkpoint');};
function exact(value:unknown,keys:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(value);
  if(names.some(key=>typeof key!=='string'||!keys.includes(key)&&!optional.includes(key))||keys.some(key=>!Object.hasOwn(descriptors,key)))return fail();
  const result:Record<string,unknown>={};
  for(const key of names as string[]){const d=descriptors[key];if(!d.enumerable||!('value' in d))return fail();result[key]=d.value;}
  return result;
}
function dense(value:unknown,max:number):unknown[]{
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return fail();
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!integer(length,0,max)||Reflect.ownKeys(value).length!==length+1)return fail();
  return Array.from({length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||!('value' in d))return fail();return d.value;});
}
const column=(cell:Cell|null)=>cell?.type==='tile'&&'special' in cell&&cell.special==='column';
/** 정상 생성자의 초기 snapshot에서만 호출합니다. 필드 순서/기본 cap을 정규화합니다. */
export function carrierCheckpointContract(initial:Snapshot,cap:number){
  return JSON.stringify({schema:1,profile:initial.profile,id:initial.scenarioId,
    board:initial.board.map(row=>row.map(cell=>cell?.type==='tile'?{type:'tile',id:cell.id,color:cell.color,...(column(cell)?{special:'column'}:{})}:cell?{type:'carrier',id:cell.id,carrierId:cell.carrierId}:null)),
    exits:initial.exits.map(p=>[p.row,p.col]),moves:initial.movesRemaining,seed:initial.rngState,cap});
}
export function makeCarrierCheckpoint(levelContract:string,state:Snapshot):CarrierCheckpoint{
  return Object.freeze({schema:1,profile:state.profile,levelContract,state:Object.freeze({board:freezeBoard(state.board),
    delivered:Object.freeze(state.delivered.slice()),movesRemaining:state.movesRemaining,status:state.status,
    rngState:state.rngState,randomDraws:state.randomDraws,serial:state.serial})});
}
/** 메모리 시험의 결정적 복원만 검증합니다. 명령 이력/보상 자격/인증은 검증하지 않습니다. */
export function restoreCarrierDraft(initial:Snapshot,cap:number,value:unknown):Draft|undefined{
  try{
    const checkpoint=exact(value,['schema','profile','levelContract','state']);
    if(checkpoint.schema!==1||checkpoint.profile!==initial.profile||checkpoint.levelContract!==carrierCheckpointContract(initial,cap))return;
    const state=exact(checkpoint.state,['board','delivered','movesRemaining','status','rngState','randomDraws','serial']);
    if(!integer(state.movesRemaining,0,initial.movesRemaining))return;
    const used=initial.movesRemaining-state.movesRemaining,active=initial.mask.flat().filter(Boolean).length;
    if(!integer(state.randomDraws,used*(initial.profile==='experimental-carrier-v1'?3:1),used*cap*active)
      ||!integer(state.serial,initial.serial,initial.serial+used*cap*active)||state.serial!==initial.serial+state.randomDraws
      ||!integer(state.rngState,0,0xffffffff)||state.rngState!==((initial.rngState+Math.imul(state.randomDraws,0x6d2b79f5))>>>0))return;
    const serialBound=state.serial;
    const known=new Set(initial.initialCarrierIds),delivered=dense(state.delivered,known.size);
    if(delivered.some(id=>typeof id!=='string'||!known.has(id))||new Set(delivered).size!==delivered.length)return;
    const ids=new Set<string>(),remaining=new Set<string>(),original=new Map(initial.board.flat().filter((cell):cell is Cell=>Boolean(cell)).map(cell=>[cell.id,cell]));
    const rows=dense(state.board,initial.mask.length);if(rows.length!==initial.mask.length)return;
    const board:MutableGrid=rows.map((row,r)=>{
      const cells=dense(row,initial.mask[r].length);if(cells.length!==initial.mask[r].length)return fail();
      return cells.map((value,c):Cell|null=>{
        if(!initial.mask[r][c]){if(value!==null)return fail();return null;}
        const cell=exact(value,['type','id'],['color','carrierId','special']);
        if(typeof cell.id!=='string'||ids.has(cell.id))return fail();ids.add(cell.id);
        if(cell.type==='carrier'){
          exact(value,['type','id','carrierId']);
          if(typeof cell.carrierId!=='string'||!known.has(cell.carrierId)||remaining.has(cell.carrierId)
            ||delivered.includes(cell.carrierId)||cell.id!==`carrier:${cell.carrierId}`||initial.exits.some(p=>p.row===r&&p.col===c))return fail();
          remaining.add(cell.carrierId);return {type:'carrier',id:cell.id,carrierId:cell.carrierId};
        }
        exact(value,['type','id','color'],['special']);
        if(cell.type!=='tile'||!integer(cell.color,0,5)||!/^tile:[1-9]\d{0,5}$/.test(cell.id))return fail();
        const serial=Number(cell.id.slice(5));if(serial>serialBound)return fail();
        const before=original.get(cell.id);
        if(before?.type==='tile'){if(cell.color!==before.color)return fail();}
        else{
          if(serial<=initial.serial)return fail();
          const probe:Draft={board:[],delivered:[],status:'playing',movesRemaining:0,serial:0,randomDraws:0,rngState:(initial.rngState+Math.imul(serial-initial.serial-1,0x6d2b79f5))>>>0};
          if(cell.color!==nextColor(probe))return fail();
        }
        if(Object.hasOwn(cell,'special')){
          if(initial.profile!=='experimental-carrier-v2'||cell.special!=='column'||!before||!column(before))return fail();
          return {type:'tile',id:cell.id,color:cell.color,special:'column'} as CheckpointCell;
        }
        if(before&&column(before))return fail();
        return {type:'tile',id:cell.id,color:cell.color};
      });
    });
    if(remaining.size+delivered.length!==known.size||matches(board).length)return;
    const status=delivered.length===known.size?'won':state.movesRemaining===0?'lost':boardMoves(board).length||board.some(row=>row.some(column))?'playing':'blocked';
    if(state.status!==status||used===0&&JSON.stringify(board)!==JSON.stringify(initial.board))return;
    return {board,delivered:delivered as string[],movesRemaining:state.movesRemaining,status,rngState:state.rngState,randomDraws:state.randomDraws,serial:state.serial};
  }catch{return;}
}
