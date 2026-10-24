import {describe,it,expect} from 'vitest';
import {CarrierEngine,CARRIER_PROFILE} from '../src/experimental/carrier/CarrierEngine';
import {ColumnCarrierEngine,COLUMN_CARRIER_PROFILE,isColumnCell,type ColumnCarrierLevel,type ColumnInput} from '../src/experimental/carrier/ColumnCarrierEngine';
import {columnScenario} from '../src/experimental/carrier/columnScenario';
const specialAt={row:4,col:2};
const changed=(edit:(board:ColumnInput[][])=>void,extra:Partial<ColumnCarrierLevel>={}):ColumnCarrierLevel=>{
  const board=columnScenario.board.map(row=>row.map(cell=>cell&&typeof cell==='object'?{...cell}:cell));edit(board);
  return {...columnScenario,board,...extra};
};
describe('별도 세로 특수 운반 프로필',()=>{
  it('일반 교환이 없어도 특수가 남으면 진행하고, 소진 뒤 둘 다 없을 때 막힘으로 끝낸다',()=>{
    const engine=new ColumnCarrierEngine({profile:COLUMN_CARRIER_PROFILE,id:'column-only-action',
      board:[[{carrierId:'isolated'},1,2],[null,{color:3,special:'column'},4],[4,5,0]],
      exits:[{row:2,col:0}],moves:5,seed:11});
    expect(engine.legalMoves()).toEqual([]);expect(engine.legalActivations()).toEqual([{row:1,col:1}]);
    expect(engine.snapshot.status).toBe('playing');
    const result=engine.activate({row:1,col:1});expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.state).toMatchObject({status:'blocked',movesRemaining:4,delivered:[]});
    expect(engine.legalMoves()).toEqual([]);expect(engine.legalActivations()).toEqual([]);
  });
  it('이전 프로필과 DTO를 섞지 않고 초기 판/조회/재시작을 결정적으로 보존한다',()=>{
    const engine=new ColumnCarrierEngine(columnScenario),before=engine.snapshot;
    expect(before.profile).toBe(COLUMN_CARRIER_PROFILE);expect(engine.findMatches()).toEqual([]);
    expect(engine.legalActivations()).toEqual([specialAt]);expect(isColumnCell(before.board[4][2])).toBe(true);
    engine.legalMoves();engine.legalActivations();engine.findMatches();
    expect(engine.snapshot).toEqual(before);expect(before.randomDraws).toBe(0);
    expect(Object.isFrozen(before.board[4][2])).toBe(true);
    expect(()=>new CarrierEngine({...columnScenario,profile:CARRIER_PROFILE} as never)).toThrow();
    expect(()=>new ColumnCarrierEngine({...columnScenario,profile:CARRIER_PROFILE} as never)).toThrow();
    expect(engine.activate(specialAt).valid).toBe(true);expect(engine.restart()).toEqual(before);
  });
  it('특수의 실제 일반조각 ID만 지우고 낙하→출구→보충→추가 매치를 한 이동에 끝낸다',()=>{
    const engine=new ColumnCarrierEngine(columnScenario),before=engine.snapshot,result=engine.activate(specialAt);
    expect(result.valid).toBe(true);if(!result.valid)return;
    const effect=result.frames.find(f=>f.kind==='effect')!,clear=result.frames.find(f=>f.kind==='clear')!,carrierId=before.board[1][2]!.id;
    expect(effect.effects).toHaveLength(1);expect(effect.effects![0]).toMatchObject({id:before.board[4][2]!.id,at:specialAt,column:2});
    expect(effect.effects![0].targets.map(t=>t.at.row)).toEqual([0,2,3,4,5]);
    expect(effect.effects![0].targets.every(t=>before.board[t.at.row][t.at.col]?.type==='tile')).toBe(true);
    expect(clear.removed.map(t=>t.id)).not.toContain(carrierId);
    expect(clear.board[1][2]).toMatchObject({id:carrierId,type:'carrier'});
    expect(clear.delivered).toEqual([]);
    const fall=result.frames.find(f=>f.kind==='fall'&&f.motions.some(m=>m.id===carrierId))!;
    expect(fall.motions.find(m=>m.id===carrierId)).toEqual({id:carrierId,from:{row:1,col:2},to:{row:5,col:2}});
    const exitIndex=result.frames.findIndex(f=>f.kind==='exit'),refillIndex=result.frames.findIndex(f=>f.kind==='refill');
    expect(exitIndex).toBeGreaterThan(0);expect(refillIndex).toBeGreaterThan(exitIndex);
    expect(result.frames[exitIndex].deliveries).toEqual([{id:carrierId,carrierId:'column-parcel',at:{row:5,col:2}}]);
    expect(result.cascades).toBeGreaterThanOrEqual(2);
    expect(result.frames.filter(f=>f.kind==='clear'&&f.cascade>1).every(f=>f.removed.length>=3)).toBe(true);
    expect(result.frames.filter(f=>f.kind==='effect')).toHaveLength(1);
    expect(result.state).toMatchObject({movesRemaining:7,status:'won',delivered:['column-parcel']});
    expect(engine.findMatches()).toEqual([]);expect(engine.legalActivations()).toEqual([]);
    expect(result.state.randomDraws).toBe(result.frames.filter(f=>f.kind==='refill').reduce((n,f)=>n+(f.spawned?.length??0),0));
    const ids=result.state.board.flat().filter(Boolean).map(c=>c!.id);expect(new Set(ids).size).toBe(ids.length);
    expect(new ColumnCarrierEngine(columnScenario).activate(specialAt)).toEqual(result);
  });
  it('추가 매치가 상한에 닿으면 출구/이동/RNG/serial까지 전체를 되돌린다',()=>{
    const engine=new ColumnCarrierEngine({...columnScenario,cascadeLimit:1}),before=engine.snapshot;
    expect(engine.activate(specialAt)).toEqual({valid:false,reason:'resolution-cap',frames:[]});
    expect(engine.snapshot).toEqual(before);expect(engine.legalActivations()).toEqual([specialAt]);
  });
  it('매치로 제거되는 특수도 한 번 발동하며 실제 색 매치를 유지한다',()=>{
    const engine=new ColumnCarrierEngine(changed(board=>{board[4][0]=4;board[4][1]=0;board[3][1]=4;}));
    expect(engine.findMatches()).toEqual([]);
    const result=engine.swap({row:3,col:1},{row:4,col:1});expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.frames[0].kind).toBe('swap');expect(result.frames.filter(f=>f.kind==='effect')).toHaveLength(1);
    expect(result.frames.every(f=>f.motions.every(m=>Object.isFrozen(m)&&Object.isFrozen(m.from)&&Object.isFrozen(m.to)))).toBe(true);
    expect(result.frames.find(f=>f.kind==='clear')!.removed).toHaveLength(7);
    expect(result.state.movesRemaining).toBe(7);
  });
  it('특수를 옆 줄로 바꿔 매치하면 이동한 ID의 새 열에서 발동한다',()=>{
    const engine=new ColumnCarrierEngine(changed(board=>{board[2][3]=4;board[3][3]=4;})),id=engine.snapshot.board[4][2]!.id;
    const result=engine.swap(specialAt,{row:4,col:3});expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.frames.find(f=>f.kind==='effect')!.effects![0]).toMatchObject({id,at:{row:4,col:3},column:3});
    expect(result.frames.find(f=>f.kind==='effect')!.effects![0].targets.every(t=>t.at.col===3)).toBe(true);
  });
  it('구멍은 타격/보충하지 않고 운반은 끊긴 고정 구간을 넘지 않는다',()=>{
    const engine=new ColumnCarrierEngine(changed(board=>{board[3][2]=null;})),result=engine.activate(specialAt);
    expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.frames.find(f=>f.kind==='effect')!.effects![0].targets.map(t=>t.at.row)).toEqual([0,2,4,5]);
    expect(result.state.board[3][2]).toBeNull();expect(result.state.delivered).toEqual([]);
    expect(result.state.board[2][2]).toMatchObject({type:'carrier',carrierId:'column-parcel'});
  });
  it('마지막 이동의 운반 성공은 승리, 미도달이면 실패로 판정한다',()=>{
    const won=new ColumnCarrierEngine({...columnScenario,moves:1}).activate(specialAt);
    expect(won.valid&&won.state.status).toBe('won');
    const lost=new ColumnCarrierEngine(changed(board=>{board[3][2]=null;},{moves:1})).activate(specialAt);
    expect(lost.valid&&lost.state.status).toBe('lost');
  });
  it('유효하지 않은 입력과 종료 뒤 입력은 한 이동도 소비하지 않는다',()=>{
    const engine=new ColumnCarrierEngine(columnScenario),before=engine.snapshot;
    expect(engine.activate({row:0,col:0})).toEqual({valid:false,reason:'not-special',frames:[]});
    expect(engine.activate({row:-1,col:2})).toEqual({valid:false,reason:'position',frames:[]});
    expect(engine.swap({row:0,col:0},{row:0,col:1})).toEqual({valid:false,reason:'no-match',frames:[]});
    expect(engine.snapshot).toEqual(before);
    engine.activate(specialAt);expect(engine.activate(specialAt)).toEqual({valid:false,reason:'ended',frames:[]});
  });
  it('특수는 1개만 사전 배치하며 잘못된 DTO/초기 매치를 거부하고 getter를 읽지 않는다',()=>{
    expect(()=>new ColumnCarrierEngine(changed(board=>{board[4][2]=4;}))).toThrow('exactly one');
    expect(()=>new ColumnCarrierEngine(changed(board=>{board[0][0]={color:0,special:'column'};}))).toThrow('exactly one');
    expect(()=>new ColumnCarrierEngine(changed(board=>{board[4][2]={color:6,special:'column'};}))).toThrow();
    expect(()=>new ColumnCarrierEngine(changed(board=>{board[4][2]={color:4,special:'column',extra:1} as never;}))).toThrow();
    expect(()=>new ColumnCarrierEngine(changed(board=>{board[2][2]=3;}))).toThrow();
    let reads=0;const bad=Object.defineProperty({color:4},'special',{enumerable:true,get(){reads++;return 'column';}});
    expect(()=>new ColumnCarrierEngine(changed(board=>{board[4][2]=bad as never;}))).toThrow();expect(reads).toBe(0);
  });
});
