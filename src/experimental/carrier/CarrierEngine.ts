/** 기존 RuleVersion/저장/보상과 분리된 메모리 전용 운반 목표 시험 규칙입니다. */
import {clone,freezeBoard,point,idPattern,plain,denseArray,integer,matches,makesMatch,boardMoves,settleCarrierWave,type Draft,type MutableGrid} from './CarrierMechanics';
import {carrierCheckpointContract,makeCarrierCheckpoint,restoreCarrierDraft} from './CarrierCheckpoint';
export const CARRIER_PROFILE = 'experimental-carrier-v1' as const;
export type Position = Readonly<{row:number;col:number}>;
export type CarrierInput = number | Readonly<{carrierId:string}> | null;
export interface CarrierLevel {
  readonly profile: typeof CARRIER_PROFILE;
  readonly id:string;
  readonly board:readonly (readonly CarrierInput[])[];
  readonly exits:readonly Position[];
  readonly moves:number;
  readonly seed:number;
  /** 계산 한도입니다. N회 해소까지 허용하고 N+1번째 매치가 남으면 전체 이동을 취소합니다. */
  readonly cascadeLimit?:number;
}
export type Cell = Readonly<{type:'tile';id:string;color:number}> |
  Readonly<{type:'carrier';id:string;carrierId:string}>;
export type Grid = readonly (readonly (Cell|null)[])[];
export type CarrierStatus = 'playing'|'won'|'lost'|'blocked';
export interface CarrierSnapshot {
  readonly profile:typeof CARRIER_PROFILE;
  readonly scenarioId:string;
  readonly board:Grid;
  readonly mask:readonly (readonly boolean[])[];
  readonly exits:readonly Position[];
  readonly initialCarrierIds:readonly string[];
  readonly delivered:readonly string[];
  readonly movesRemaining:number;
  readonly status:CarrierStatus;
  readonly rngState:number;
  readonly randomDraws:number;
  readonly serial:number;
}
export interface Motion {readonly id:string;readonly from:Position;readonly to:Position}
export interface Delivery {readonly id:string;readonly carrierId:string;readonly at:Position}
export interface CarrierFrame {
  readonly kind:'swap'|'clear'|'fall'|'exit'|'refill';
  readonly cascade:number;
  readonly board:Grid;
  readonly motions:readonly Motion[];
  readonly removed:readonly {readonly id:string;readonly at:Position}[];
  readonly deliveries:readonly Delivery[];
  readonly delivered:readonly string[];
}
export type SwapFailure = 'ended'|'position'|'inactive'|'adjacent'|'no-match'|'resolution-cap';
export type CarrierSwap = Readonly<{valid:false;reason:SwapFailure;frames:readonly []}> |
  Readonly<{valid:true;frames:readonly CarrierFrame[];state:CarrierSnapshot;cascades:number}>;

const fail=(reason:SwapFailure):CarrierSwap=>Object.freeze({valid:false,reason,frames:Object.freeze([]) as readonly []});

export class CarrierEngine {
  private current:Draft;
  private readonly initial:Draft;
  private readonly mask:boolean[][];
  private readonly exits:Position[];
  private readonly carriers:string[]=[];
  private readonly scenarioId:string;
  private readonly cascadeLimit:number;
  private readonly checkpointContract:string;
  constructor(input:CarrierLevel){
    const level=plain(input,['profile','id','board','exits','moves','seed','cascadeLimit']);
    if(level.profile!==CARRIER_PROFILE||typeof level.id!=='string'||!idPattern.test(level.id)
      ||!integer(level.moves,1,99)||!integer(level.seed,0,0xffffffff)
      ||level.cascadeLimit!==undefined&&!integer(level.cascadeLimit,1,32))throw new TypeError('carrier level profile');
    this.scenarioId=level.id;this.cascadeLimit=(level.cascadeLimit as number|undefined)??32;
    const rows=denseArray(level.board);
    if(rows.length<3||rows.length>8)throw new TypeError('carrier rows');
    let cols=0,serial=0;
    const board:MutableGrid=rows.map((row,index)=>{
      const values=denseArray(row);
      if(index===0)cols=values.length;
      if(cols<3||cols>8||values.length!==cols)throw new TypeError('carrier columns');
      return values.map(value=>{
        if(value===null)return null;
        if(integer(value,0,5))return {type:'tile' as const,id:`tile:${++serial}`,color:value};
        const carrier=plain(value,['carrierId']);
        if(typeof carrier.carrierId!=='string'||!idPattern.test(carrier.carrierId)||this.carriers.includes(carrier.carrierId))throw new TypeError('carrier ID');
        this.carriers.push(carrier.carrierId);
        return {type:'carrier' as const,id:`carrier:${carrier.carrierId}`,carrierId:carrier.carrierId};
      });
    });
    if(this.carriers.length<1||this.carriers.length>8)throw new TypeError('carrier count');
    this.mask=board.map(row=>row.map(Boolean));
    const exits=denseArray(level.exits);
    if(exits.length<1||exits.length>8)throw new TypeError('carrier exits');
    this.exits=exits.map(value=>{
      const p=plain(value,['row','col']);
      if(!integer(p.row,0,rows.length-1)||!integer(p.col,0,cols-1)||!this.mask[p.row][p.col]
        ||p.row+1<rows.length&&this.mask[p.row+1][p.col])throw new TypeError('carrier exit must end a segment');
      return point(p.row,p.col);
    });
    if(new Set(this.exits.map(p=>`${p.row}:${p.col}`)).size!==this.exits.length)throw new TypeError('duplicate carrier exit');
    if(this.exits.some(p=>board[p.row][p.col]?.type==='carrier'))throw new TypeError('initial carrier at exit');
    if(matches(board).length)throw new TypeError('initial carrier board must be stable');
    this.current={board,delivered:[],movesRemaining:level.moves,status:boardMoves(board).length?'playing':'blocked',
      rngState:level.seed,randomDraws:0,serial};
    this.initial=clone(this.current);
    this.checkpointContract=carrierCheckpointContract(this.snapshot,this.cascadeLimit);
  }
  get snapshot():CarrierSnapshot{
    const state=this.current;
    return Object.freeze({profile:CARRIER_PROFILE,scenarioId:this.scenarioId,board:freezeBoard(state.board),
      mask:Object.freeze(this.mask.map(row=>Object.freeze(row.slice()))),exits:Object.freeze(this.exits.slice()),
      initialCarrierIds:Object.freeze(this.carriers.slice()),delivered:Object.freeze(state.delivered.slice()),
      movesRemaining:state.movesRemaining,status:state.status,rngState:state.rngState,randomDraws:state.randomDraws,serial:state.serial});
  }
  legalMoves(){return this.current.status==='playing'?boardMoves(this.current.board):[];}
  findMatches(){return matches(this.current.board);}
  restart(){this.current=clone(this.initial);return this.snapshot;}
  checkpoint(){return makeCarrierCheckpoint(this.checkpointContract,this.snapshot);}
  static restore(level:CarrierLevel,checkpoint:unknown):CarrierEngine|undefined{
    try{const engine=new CarrierEngine(level),state=restoreCarrierDraft(engine.snapshot,engine.cascadeLimit,checkpoint);
      if(!state)return;engine.current=state;return engine;
    }catch{return;}
  }
  swap(a:Position,b:Position):CarrierSwap{
    if(this.current.status!=='playing')return fail('ended');
    const validPosition=(p:Position)=>p&&integer(p.row,0,this.mask.length-1)&&integer(p.col,0,this.mask[0].length-1);
    if(!validPosition(a)||!validPosition(b))return fail('position');
    if(!this.mask[a.row][a.col]||!this.mask[b.row][b.col])return fail('inactive');
    if(Math.abs(a.row-b.row)+Math.abs(a.col-b.col)!==1)return fail('adjacent');
    const work=clone(this.current);
    if(!makesMatch(work.board,a,b))return fail('no-match');
    const first=work.board[a.row][a.col]!,second=work.board[b.row][b.col]!;
    work.board[a.row][a.col]=second;work.board[b.row][b.col]=first;work.movesRemaining--;
    const frames:CarrierFrame[]=[];
    const emit=(kind:CarrierFrame['kind'],cascade:number,motions:Motion[]=[],removed:CarrierFrame['removed']=[],deliveries:Delivery[]=[])=>{
      frames.push(Object.freeze({kind,cascade,board:freezeBoard(work.board),motions:Object.freeze(motions.map(m=>Object.freeze({...m}))),
        removed:Object.freeze(removed.map(m=>Object.freeze({...m}))),deliveries:Object.freeze(deliveries.map(d=>Object.freeze({...d}))),
        delivered:Object.freeze(work.delivered.slice())}));
    };
    emit('swap',0,[{id:first.id,from:point(a.row,a.col),to:point(b.row,b.col)},{id:second.id,from:point(b.row,b.col),to:point(a.row,a.col)}]);
    let cascade=0;
    for(let found=matches(work.board);found.length;found=matches(work.board)){
      if(cascade===this.cascadeLimit)return fail('resolution-cap');
      cascade++;
      const removed=found.map(at=>({id:work.board[at.row][at.col]!.id,at}));
      for(const p of found)work.board[p.row][p.col]=null;
      emit('clear',cascade,[],removed);
      settleCarrierWave(work,this.mask,this.exits,this.carriers.length,cascade,emit);
    }
    work.status=work.delivered.length===this.carriers.length?'won':work.movesRemaining===0?'lost':boardMoves(work.board).length?'playing':'blocked';
    this.current=work;
    return Object.freeze({valid:true,frames:Object.freeze(frames),state:this.snapshot,cascades:cascade});
  }

}
