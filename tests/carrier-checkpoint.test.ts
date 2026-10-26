import {describe,it,expect} from 'vitest';
import {CarrierEngine,CARRIER_PROFILE,type CarrierLevel,type CarrierInput} from '../src/experimental/carrier/CarrierEngine';
import {ColumnCarrierEngine,COLUMN_CARRIER_PROFILE,type ColumnCarrierLevel} from '../src/experimental/carrier/ColumnCarrierEngine';
import {carrierScenarios} from '../src/experimental/carrier/carrierScenarios';
import {columnScenario} from '../src/experimental/carrier/columnScenario';
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
const at=(row:number,col:number)=>({row,col});
const special=at(4,2);
const drop=(extra:Partial<CarrierLevel>={}):CarrierLevel=>({profile:CARRIER_PROFILE,id:'checkpoint-drop',
  board:[[1,2,1],[{carrierId:'seeds'},0,2],[0,1,0]],exits:[at(2,0)],moves:1,seed:0,...extra});
const turn=(engine:CarrierEngine)=>engine.swap(at(1,1),at(2,1));

describe('운반 시험의 명시 계약과 메모리 체크포인트',()=>{
  it.each(carrierScenarios)('$level.id의 초기·중간·종료 JSON왕복은 다음 전체frame/ID/RNG와 restart를 보존합니다',scenario=>{
    const engine=new CarrierEngine(scenario.level),initial=engine.snapshot;
    for(let index=0;index<=scenario.authoredPath.length;index++){
      const checkpoint=engine.checkpoint(),before=engine.snapshot,restored=CarrierEngine.restore(scenario.level,json(checkpoint));
      expect(restored).toBeDefined();expect(restored!.snapshot).toEqual(before);expect(engine.snapshot).toEqual(before);
      expect(restored!.legalMoves()).toEqual(engine.legalMoves());expect(restored!.findMatches()).toEqual(engine.findMatches());
      if(index<scenario.authoredPath.length){const {a,b}=scenario.authoredPath[index];expect(restored!.swap(a,b)).toEqual(engine.swap(a,b));}
      expect(restored!.restart()).toEqual(initial);expect(engine.checkpoint().levelContract).toBe(checkpoint.levelContract);
    }
  });
  it('v2의 사전 배치 특수·활성화 뒤 소진·승리와 다음 무효 명령을 정확히 복원합니다',()=>{
    const engine=new ColumnCarrierEngine(columnScenario),initial=engine.snapshot;
    const restored=ColumnCarrierEngine.restore(columnScenario,json(engine.checkpoint()))!;
    expect(restored.snapshot).toEqual(initial);expect(restored.legalActivations()).toEqual([special]);
    expect(restored.activate(special)).toEqual(engine.activate(special));expect(engine.snapshot.status).toBe('won');
    const ended=ColumnCarrierEngine.restore(columnScenario,json(engine.checkpoint()))!;expect(ended.snapshot).toEqual(engine.snapshot);expect(ended.legalActivations()).toEqual([]);expect(ended.activate(special)).toEqual(engine.activate(special));expect(ended.restart()).toEqual(initial);
  });
  it('uint32 경계를 넘는 보충과 v2의 분리 구간 실패 상태도 복원합니다',()=>{
    for(const seed of [0,0x80000000,0xffffffff]){
      const level=drop({seed}),engine=new CarrierEngine(level);expect(turn(engine).valid).toBe(true);expect(engine.snapshot.randomDraws).toBeGreaterThan(0);
      expect(CarrierEngine.restore(level,json(engine.checkpoint()))!.snapshot).toEqual(engine.snapshot);
    }
    const board=columnScenario.board.map(row=>row.slice());board[3][2]=null;
    const level={...columnScenario,board,moves:1},engine=new ColumnCarrierEngine(level);expect(engine.activate(special).valid).toBe(true);expect(engine.snapshot.status).toBe('lost');
    const restored=ColumnCarrierEngine.restore(level,json(engine.checkpoint()))!;expect(restored.snapshot).toEqual(engine.snapshot);expect(restored.activate(special)).toEqual(engine.activate(special));
  });
  it('일반 교환으로 보충한 뒤에도 남아 있는 v2 특수의 ID·다음 발동을 보존합니다',()=>{
    const board=columnScenario.board.map(row=>row.slice());board[0][0]=0;board[0][1]=1;board[0][2]=0;board[1][1]=0;
    const level={...columnScenario,board},engine=new ColumnCarrierEngine(level),initialId=engine.snapshot.board[4][2]!.id;
    expect(engine.swap(at(0,1),at(1,1)).valid).toBe(true);expect(engine.snapshot.randomDraws).toBeGreaterThan(0);expect(engine.legalActivations()).toEqual([special]);
    const checkpoint=engine.checkpoint();expect(checkpoint.state.board[4][2]).toMatchObject({id:initialId,special:'column'});
    const restored=ColumnCarrierEngine.restore(level,json(checkpoint))!;expect(restored.snapshot).toEqual(engine.snapshot);expect(restored.activate(special)).toEqual(engine.activate(special));
  });
  it('lost·초기blocked·이동뒤blocked의 우선순위를 바꾸지 않습니다',()=>{
    const configurations=[drop({exits:[at(2,2)]}),drop({board:[[{carrierId:'seeds'},0,1],[2,3,4],[1,4,5]],moves:5}),drop({board:[[3,4,5],[{carrierId:'seeds'},0,2],[0,1,0]],exits:[at(2,2)],moves:5})];
    for(const [i,level] of configurations.entries()){
      const engine=new CarrierEngine(level);if(i!==1)expect(turn(engine).valid).toBe(true);
      expect(engine.snapshot.status).toBe(i===0?'lost':'blocked');const restored=CarrierEngine.restore(level,json(engine.checkpoint()))!;
      expect(restored.snapshot).toEqual(engine.snapshot);expect(turn(restored)).toEqual(turn(engine));
    }
    const level:ColumnCarrierLevel={profile:COLUMN_CARRIER_PROFILE,id:'column-blocked-checkpoint',board:[[{carrierId:'isolated'},1,2],[null,{color:3,special:'column'},4],[4,5,0]],exits:[at(2,0)],moves:5,seed:11};
    const column=new ColumnCarrierEngine(level);expect(column.legalMoves()).toEqual([]);expect(ColumnCarrierEngine.restore(level,json(column.checkpoint()))!.snapshot.status).toBe('playing');column.activate(at(1,1));expect(column.snapshot.status).toBe('blocked');expect(ColumnCarrierEngine.restore(level,json(column.checkpoint()))!.snapshot).toEqual(column.snapshot);
  });
  it('무효·cap rollback은 checkpoint까지 무변경이고 생략 cap은 명시32와 같습니다',()=>{
    const level={...carrierScenarios[0].level,cascadeLimit:1},engine=new CarrierEngine(level),before=engine.checkpoint(),path=carrierScenarios[0].authoredPath[0];
    expect(engine.swap(at(-1,0),at(0,0)).valid).toBe(false);expect(engine.swap(path.a,path.b)).toMatchObject({valid:false,reason:'resolution-cap'});expect(engine.checkpoint()).toEqual(before);
    expect(CarrierEngine.restore(level,json(before))!.checkpoint()).toEqual(before);
    const normal=new CarrierEngine(carrierScenarios[0].level);expect(CarrierEngine.restore({...carrierScenarios[0].level,cascadeLimit:32},json(normal.checkpoint()))!.snapshot).toEqual(normal.snapshot);
    const columnLevel={...columnScenario,cascadeLimit:1},column=new ColumnCarrierEngine(columnLevel),checkpoint=column.checkpoint();expect(column.activate(special)).toMatchObject({valid:false,reason:'resolution-cap'});expect(column.checkpoint()).toEqual(checkpoint);expect(ColumnCarrierEngine.restore(columnLevel,json(checkpoint))!.snapshot).toEqual(column.snapshot);
  });
  it('profile·동일 ID의 다른 seed/cap/초기board/출구·이동수 계약을 거절합니다',()=>{
    const level=carrierScenarios[2].level,engine=new CarrierEngine(level),checkpoint=json(engine.checkpoint());
    for(const other of [{...level,seed:level.seed+1},{...level,cascadeLimit:1},{...level,moves:level.moves+1},{...level,exits:[...level.exits].reverse()}])expect(CarrierEngine.restore(other,checkpoint)).toBeUndefined();
    const board=level.board.map(row=>row.slice()) as CarrierInput[][];board[0][1]=4;expect(CarrierEngine.restore({...level,board},checkpoint)).toBeUndefined();
    expect(ColumnCarrierEngine.restore(columnScenario,checkpoint)).toBeUndefined();expect(CarrierEngine.restore(level,new ColumnCarrierEngine(columnScenario).checkpoint())).toBeUndefined();
  });
  it.each([
    ['schema',(c:ReturnType<typeof json>)=>{c.schema=2;}],['profile',(c:ReturnType<typeof json>)=>{c.profile='experimental-carrier-v2';}],
    ['missing',(c:ReturnType<typeof json>)=>{delete c.levelContract;}],['extra',(c:ReturnType<typeof json>)=>{c.extra=true;}],
    ['moves',(c:ReturnType<typeof json>)=>{c.state.movesRemaining=100;}],['status',(c:ReturnType<typeof json>)=>{c.state.status='won';}],
    ['rng',(c:ReturnType<typeof json>)=>{c.state.rngState++;}],['draws',(c:ReturnType<typeof json>)=>{c.state.randomDraws++;}],['serial',(c:ReturnType<typeof json>)=>{c.state.serial++;}],
    ['tile-color',(c:ReturnType<typeof json>)=>{c.state.board[0][0].color=(c.state.board[0][0].color+1)%6;}],
    ['duplicate-id',(c:ReturnType<typeof json>)=>{c.state.board[0][1]={...c.state.board[0][0]};}],
    ['unknown-id',(c:ReturnType<typeof json>)=>{c.state.board[0][0].id='tile:999999';}],
    ['carrier',(c:ReturnType<typeof json>)=>{c.state.board[4][0].carrierId='unknown';}],
    ['active-null',(c:ReturnType<typeof json>)=>{c.state.board[0][0]=null;}],
    ['missing-carrier',(c:ReturnType<typeof json>)=>{c.state.delivered=['meadow-seeds'];}],
    ['array-hole',(c:ReturnType<typeof json>)=>{delete c.state.board[0][0];}],
    ['special-v1',(c:ReturnType<typeof json>)=>{c.state.board[0][0].special='column';}],
    ['extra-tile-field',(c:ReturnType<typeof json>)=>{c.state.board[0][0].carrierId='fake';}],
  ] as const)('%s 손상은 현재 엔진을 바꾸지 않고 거절합니다',(name,edit)=>{
    const level=carrierScenarios[0].level,engine=new CarrierEngine(level),before=engine.snapshot,checkpoint=json(engine.checkpoint());edit(checkpoint);
    expect(CarrierEngine.restore(level,checkpoint),name).toBeUndefined();expect(engine.snapshot).toEqual(before);
  });
  it('getter 호출 없이 추가 symbol·비열거·배열 prototype·비활성 칸 배치를 거절합니다',()=>{
    const level=carrierScenarios[2].level,engine=new CarrierEngine(level);let getterCalls=0;
    const values=Array.from({length:6},()=>json(engine.checkpoint()));
    Object.defineProperty(values[0],'state',{enumerable:true,get(){getterCalls++;throw new Error('getter');}});
    values[1][Symbol('extra')]=true;Object.defineProperty(values[2],'schema',{enumerable:false,value:1});
    Object.setPrototypeOf(values[3].state.board,{});Object.defineProperty(values[4].state.board[0],'1',{enumerable:true,get(){getterCalls++;throw new Error('cell getter');}});
    values[5].state.board[0][0]={type:'tile',id:'tile:999999',color:0};
    for(const value of values)expect(CarrierEngine.restore(level,value)).toBeUndefined();expect(getterCalls).toBe(0);
  });
  it('보충 색·배달 집합·v2 특수의 누락과 위조를 거절합니다',()=>{
    const level=carrierScenarios[0].level,engine=new CarrierEngine(level),initialSerial=engine.snapshot.serial,move=carrierScenarios[0].authoredPath[0];engine.swap(move.a,move.b);expect(engine.snapshot.status).toBe('won');
    const color=json(engine.checkpoint()),tile=color.state.board.flat().find((c:{type:string;id:string}|null)=>c?.type==='tile'&&Number(c.id.slice(5))>initialSerial);tile.color=(tile.color+1)%6;expect(CarrierEngine.restore(level,color)).toBeUndefined();
    const delivery=json(engine.checkpoint());delivery.state.delivered.push(delivery.state.delivered[0]);expect(CarrierEngine.restore(level,delivery)).toBeUndefined();
    const column=new ColumnCarrierEngine(columnScenario),missing=json(column.checkpoint()),fake=json(column.checkpoint());delete missing.state.board[4][2].special;fake.state.board[0][0].special='column';
    expect(ColumnCarrierEngine.restore(columnScenario,missing)).toBeUndefined();expect(ColumnCarrierEngine.restore(columnScenario,fake)).toBeUndefined();
  });
  it('체크포인트는 깊게 동결하고 복원 뒤 입력을 바꿔도 소유한 상태로 전파하지 않습니다',()=>{
    const level=carrierScenarios[0].level,engine=new CarrierEngine(level),checkpoint=engine.checkpoint();
    for(const value of [checkpoint,checkpoint.state,checkpoint.state.board,checkpoint.state.board[0],checkpoint.state.board[0][0],checkpoint.state.delivered])expect(Object.isFrozen(value)).toBe(true);
    const input=json(checkpoint),restored=CarrierEngine.restore(level,input)!,before=restored.snapshot;
    input.state.board[0][0].color=5;input.state.movesRemaining=0;input.state.delivered.push('fake');expect(restored.snapshot).toEqual(before);expect(engine.snapshot).toEqual(before);
  });
});
