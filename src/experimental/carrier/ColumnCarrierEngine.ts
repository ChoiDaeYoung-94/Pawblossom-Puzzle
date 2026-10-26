import {CarrierEngine,CARRIER_PROFILE,type CarrierLevel,type CarrierInput,type CarrierSnapshot,type Cell,type Grid,type Position,type Motion,type Delivery,type CarrierFrame,type SwapFailure} from './CarrierEngine';
import {clone,freezeBoard,point,plain,denseArray,integer,matches,makesMatch,boardMoves,settleCarrierWave,type Draft} from './CarrierMechanics';
import {carrierCheckpointContract,makeCarrierCheckpoint,restoreCarrierDraft} from './CarrierCheckpoint';

export const COLUMN_CARRIER_PROFILE='experimental-carrier-v2' as const;
export type ColumnInput=CarrierInput|Readonly<{color:number;special:'column'}>;
export interface ColumnCarrierLevel extends Omit<CarrierLevel,'profile'|'board'>{
  readonly profile:typeof COLUMN_CARRIER_PROFILE;
  readonly board:readonly (readonly ColumnInput[])[];
}
export type ColumnCell=Extract<Cell,{type:'tile'}>&Readonly<{special:'column'}>;
export const isColumnCell=(cell:Cell|null):cell is ColumnCell=>cell?.type==='tile'&&'special' in cell&&cell.special==='column';
export interface ColumnSnapshot extends Omit<CarrierSnapshot,'profile'>{readonly profile:typeof COLUMN_CARRIER_PROFILE}
export interface ColumnEffect {
  readonly id:string;readonly at:Position;readonly column:number;
  readonly targets:readonly Readonly<{id:string;at:Position}>[];
}
export interface ColumnFrame extends Omit<CarrierFrame,'kind'>{
  readonly kind:CarrierFrame['kind']|'effect';readonly effects?:readonly ColumnEffect[];
  readonly spawned?:readonly Readonly<{id:string;at:Position}>[];
}
export type ColumnResult=Readonly<{valid:false;reason:SwapFailure|'not-special';frames:readonly []}>|
  Readonly<{valid:true;frames:readonly ColumnFrame[];state:ColumnSnapshot;cascades:number}>;
const failure=(reason:SwapFailure|'not-special'):ColumnResult=>Object.freeze({valid:false,reason,frames:Object.freeze([]) as readonly []});
const specials=(board:Grid)=>board.flatMap((row,r)=>row.flatMap((cell,c)=>isColumnCell(cell)?[point(r,c)]:[]));

/** 사전 배치 세로특수1개만 허용합니다. 생성/조합·목표 자동선정·본편 저장은 포함하지 않습니다. */
export class ColumnCarrierEngine {
  private readonly geometry:CarrierSnapshot;
  private readonly initial:Draft;
  private current:Draft;
  private readonly cascadeLimit:number;
  private readonly checkpointContract:string;
  constructor(input:ColumnCarrierLevel){
    const level=plain(input,['profile','id','board','exits','moves','seed','cascadeLimit']);
    if(level.profile!==COLUMN_CARRIER_PROFILE)throw new TypeError('column carrier profile');
    const positions:Position[]=[];
    const normalized=denseArray(level.board).map((row,r)=>denseArray(row).map((value,c)=>{
      if(value&&typeof value==='object'&&Object.hasOwn(value,'special')){
        const special=plain(value,['color','special']);
        if(special.special!=='column'||!integer(special.color,0,5))throw new TypeError('column carrier special');
        positions.push(point(r,c));return special.color;
      }
      return value;
    }));
    if(positions.length!==1)throw new TypeError('exactly one preplaced column');
    // 기존 validator로 일반 색/ID/고정 구간/출구/초기 안정성을 그대로 검사한 초기 판만 받습니다.
    const base=new CarrierEngine({profile:CARRIER_PROFILE,id:level.id,board:normalized,exits:level.exits,moves:level.moves,seed:level.seed,
      cascadeLimit:level.cascadeLimit} as CarrierLevel);
    this.geometry=base.snapshot;this.cascadeLimit=(level.cascadeLimit as number|undefined)??32;
    this.current={board:this.geometry.board.map(row=>row.map(cell=>cell?{...cell}:null)),delivered:[],movesRemaining:this.geometry.movesRemaining,
      status:'playing',rngState:this.geometry.rngState,randomDraws:0,serial:this.geometry.serial};
    const at=positions[0],tile=this.current.board[at.row][at.col];
    if(tile?.type!=='tile')throw new Error('column initial tile invariant');
    const special:ColumnCell={...tile,special:'column'};this.current.board[at.row][at.col]=special;
    this.initial=clone(this.current);
    this.checkpointContract=carrierCheckpointContract(this.snapshot,this.cascadeLimit);
  }
  get snapshot():ColumnSnapshot{
    const state=this.current,geometry=this.geometry;
    return Object.freeze({profile:COLUMN_CARRIER_PROFILE,scenarioId:geometry.scenarioId,board:freezeBoard(state.board),
      mask:geometry.mask,exits:geometry.exits,initialCarrierIds:geometry.initialCarrierIds,delivered:Object.freeze(state.delivered.slice()),
      movesRemaining:state.movesRemaining,status:state.status,rngState:state.rngState,randomDraws:state.randomDraws,serial:state.serial});
  }
  legalMoves(){return this.current.status==='playing'?boardMoves(this.current.board):[];}
  legalActivations(){return this.current.status==='playing'?specials(this.current.board):[];}
  findMatches(){return matches(this.current.board);}
  restart(){this.current=clone(this.initial);return this.snapshot;}
  checkpoint(){return makeCarrierCheckpoint(this.checkpointContract,this.snapshot);}
  static restore(level:ColumnCarrierLevel,checkpoint:unknown):ColumnCarrierEngine|undefined{
    try{const engine=new ColumnCarrierEngine(level),state=restoreCarrierDraft(engine.snapshot,engine.cascadeLimit,checkpoint);
      if(!state)return;engine.current=state;return engine;
    }catch{return;}
  }
  private validPosition(p:Position){return p&&integer(p.row,0,this.geometry.mask.length-1)&&integer(p.col,0,this.geometry.mask[0].length-1);}
  activate(at:Position):ColumnResult{
    if(this.current.status!=='playing')return failure('ended');
    if(!this.validPosition(at))return failure('position');
    if(!this.geometry.mask[at.row][at.col])return failure('inactive');
    if(!isColumnCell(this.current.board[at.row][at.col]))return failure('not-special');
    const work=clone(this.current);work.movesRemaining--;
    return this.resolve(work,[],[point(at.row,at.col)]);
  }
  swap(a:Position,b:Position):ColumnResult{
    if(this.current.status!=='playing')return failure('ended');
    if(!this.validPosition(a)||!this.validPosition(b))return failure('position');
    if(!this.geometry.mask[a.row][a.col]||!this.geometry.mask[b.row][b.col])return failure('inactive');
    if(Math.abs(a.row-b.row)+Math.abs(a.col-b.col)!==1)return failure('adjacent');
    const work=clone(this.current);if(!makesMatch(work.board,a,b))return failure('no-match');
    const first=work.board[a.row][a.col]!,second=work.board[b.row][b.col]!;
    work.board[a.row][a.col]=second;work.board[b.row][b.col]=first;work.movesRemaining--;
    const frame:ColumnFrame=Object.freeze({kind:'swap',cascade:0,board:freezeBoard(work.board),
      motions:Object.freeze([Object.freeze({id:first.id,from:point(a.row,a.col),to:point(b.row,b.col)}),Object.freeze({id:second.id,from:point(b.row,b.col),to:point(a.row,a.col)})]),
      removed:Object.freeze([]),deliveries:Object.freeze([]),delivered:Object.freeze(work.delivered.slice())});
    return this.resolve(work,[frame],matches(work.board));
  }
  private resolve(work:Draft,frames:ColumnFrame[],initial:Position[]):ColumnResult{
    const geometry=this.geometry,triggered=new Set<string>();let cascade=0;
    const emit=(kind:ColumnFrame['kind'],depth:number,motions:Motion[]=[],removed:CarrierFrame['removed']=[],deliveries:Delivery[]=[],effects?:ColumnEffect[])=>{
      const before=frames.at(-1)?.board;
      const spawned=kind==='refill'?work.board.flatMap((row,r)=>row.flatMap((cell,c)=>cell&&!before?.[r][c]
        ?[Object.freeze({id:cell.id,at:point(r,c)})]:[])):undefined;
      const frame={kind,cascade:depth,board:freezeBoard(work.board),motions:Object.freeze(motions.map(m=>Object.freeze({...m}))),
        removed:Object.freeze(removed.map(m=>Object.freeze({...m}))),deliveries:Object.freeze(deliveries.map(d=>Object.freeze({...d}))),delivered:Object.freeze(work.delivered.slice()),
        ...(spawned?{spawned:Object.freeze(spawned)}:{})};
      frames.push(Object.freeze(effects?{...frame,effects:Object.freeze(effects.map(e=>Object.freeze({...e,targets:Object.freeze(e.targets.map(t=>Object.freeze({...t})))})))}:frame));
    };
    for(let found=initial;found.length;found=matches(work.board)){
      if(cascade===this.cascadeLimit)return failure('resolution-cap');cascade++;
      const targets=new Map<string,Position>(),queue:Position[]=[],effects:ColumnEffect[]=[];
      const add=(at:Position)=>{
        const cell=work.board[at.row][at.col];if(cell?.type!=='tile')return;
        if(!targets.has(cell.id)){targets.set(cell.id,at);if(isColumnCell(cell))queue.push(at);}
      };
      for(const at of found)add(at);
      for(let index=0;index<queue.length;index++){
        const at=queue[index],cell=work.board[at.row][at.col];if(!isColumnCell(cell)||triggered.has(cell.id))continue;
        triggered.add(cell.id);const hits:{id:string;at:Position}[]=[];
        for(let row=0;row<work.board.length;row++){
          const target=work.board[row][at.col];if(target?.type!=='tile')continue;
          const p=point(row,at.col);hits.push({id:target.id,at:p});add(p);
        }
        effects.push({id:cell.id,at,column:at.col,targets:hits});
      }
      if(effects.length)emit('effect',cascade,[],[],[],effects);
      const removed=[...targets].map(([id,at])=>({id,at})).sort((a,b)=>a.at.row-b.at.row||a.at.col-b.at.col);
      for(const {at} of removed)work.board[at.row][at.col]=null;
      emit('clear',cascade,[],removed);
      settleCarrierWave(work,geometry.mask,geometry.exits,geometry.initialCarrierIds.length,cascade,emit);
    }
    work.status=work.delivered.length===geometry.initialCarrierIds.length?'won':work.movesRemaining===0?'lost'
      :boardMoves(work.board).length||specials(work.board).length?'playing':'blocked';
    this.current=work;
    return Object.freeze({valid:true,frames:Object.freeze(frames),state:this.snapshot,cascades:cascade});
  }
}
