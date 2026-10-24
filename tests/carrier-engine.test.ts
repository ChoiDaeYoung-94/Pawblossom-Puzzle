import {describe,expect,it} from 'vitest';
import {CarrierEngine,CARRIER_PROFILE,type CarrierInput,type CarrierLevel,type CarrierSnapshot,type Grid} from '../src/experimental/carrier/CarrierEngine';
import {carrierScenarios} from '../src/experimental/carrier/carrierScenarios';

const at=(row:number,col:number)=>({row,col});
const basket=(carrierId='seeds')=>({carrierId});
const dropBoard:CarrierInput[][]=[[1,2,1],[basket(),0,2],[0,1,0]];
const drop=(options:Partial<CarrierLevel>={}):CarrierLevel=>({profile:CARRIER_PROFILE,id:'drop-test',board:dropBoard,exits:[at(2,0)],moves:1,seed:0,...options});
const turn=(e:CarrierEngine)=>e.swap(at(1,1),at(2,1));
const carrierPositions=(board:Grid)=>board.flatMap((row,r)=>row.flatMap((cell,c)=>cell?.type==='carrier'?[{id:cell.carrierId,row:r,col:c}]:[]));
function invariant(state:CarrierSnapshot){
  const cells=state.board.flat().filter(cell=>cell!==null);
  expect(new Set(cells.map(cell=>cell.id)).size).toBe(cells.length);
  const remaining=carrierPositions(state.board).map(p=>p.id);
  expect([...remaining,...state.delivered].sort()).toEqual([...state.initialCarrierIds].sort());
  expect(new Set(state.delivered).size).toBe(state.delivered.length);
  state.mask.forEach((row,r)=>row.forEach((active,c)=>expect(Boolean(state.board[r][c])).toBe(active)));
  expect(state.movesRemaining).toBeGreaterThanOrEqual(0);
}

describe('별도 운반 시험 규칙',()=>{
  it('실제 carrier ID가 낙하하고 배송 빈자리를 보충 전에 다시 압축합니다',()=>{
    const engine=new CarrierEngine(drop()),before=engine.snapshot,result=turn(engine);
    expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.cascades).toBe(1);
    expect(result.frames.map(frame=>frame.kind)).toEqual(['swap','clear','fall','exit','fall','refill']);
    const fall=result.frames[2];
    expect(fall.motions).toContainEqual({id:'carrier:seeds',from:at(1,0),to:at(2,0)});
    expect(result.frames[3].deliveries).toEqual([{id:'carrier:seeds',carrierId:'seeds',at:at(2,0)}]);
    const top=before.board[0][0]!;
    expect(result.frames[4].motions).toContainEqual({id:top.id,from:at(1,0),to:at(2,0)});
    expect(result.state.delivered).toEqual(['seeds']);expect(result.state.status).toBe('won');
    expect(result.state.movesRemaining).toBe(0);expect(result.state.randomDraws).toBe(4);
    expect(result.frames.flatMap(frame=>frame.removed).some(cell=>cell.id.startsWith('carrier:'))).toBe(false);
    expect(result.state.board[2][0]?.id).toBe(top.id);invariant(result.state);
  });
  it('carrier와 일반 블록의 옆 교환은 일반 끝점의 새 매치를 만들 때만 승인합니다',()=>{
    const engine=new CarrierEngine(drop({board:[[0,2,1],[0,1,2],[basket(),0,1]],exits:[at(2,1)]}));
    const result=engine.swap(at(2,0),at(2,1));
    expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.frames[0].motions).toContainEqual({id:'carrier:seeds',from:at(2,0),to:at(2,1)});
    expect(result.state.status).toBe('won');expect(result.state.delivered).toEqual(['seeds']);
  });
  it('같은 구간에 쌓인 두 꾸러미를 아래 ID부터 중복 없이 연속 배송합니다',()=>{
    const engine=new CarrierEngine(drop({board:[[basket('first'),2,1],[basket('second'),3,2],[0,0,1],[1,1,0]],exits:[at(3,0)]}));
    const result=engine.swap(at(2,2),at(3,2));
    expect(result.valid).toBe(true);if(!result.valid)return;
    const exits=result.frames.filter(frame=>frame.kind==='exit');
    expect(exits.map(frame=>frame.deliveries.map(item=>item.carrierId))).toEqual([['second'],['first']]);
    expect(result.state.delivered).toEqual(['second','first']);expect(result.state.status).toBe('won');
    expect(result.frames.findIndex(frame=>frame.kind==='refill')).toBeGreaterThan(result.frames.lastIndexOf(exits[1]));
    invariant(result.state);
  });
  it('서로 다른 두 출구에 동시에 도착한 ID를 한 번씩 배송합니다',()=>{
    const engine=new CarrierEngine(drop({board:[[1,2,1],[basket('left'),0,basket('right')],[0,1,0]],exits:[at(2,0),at(2,2)]}));
    const result=turn(engine);expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.frames.find(frame=>frame.kind==='exit')?.deliveries.map(d=>d.carrierId)).toEqual(['left','right']);
    expect(result.state.delivered).toEqual(['left','right']);invariant(result.state);
  });
  it('중간 구멍과 미선언 구간 바닥을 출구처럼 취급하지 않습니다',()=>{
    const engine=new CarrierEngine(drop({board:[[basket(),2,1],[1,0,2],[null,1,0],[2,0,2],[0,2,0]],exits:[at(4,0)],moves:5}));
    const result=engine.swap(at(3,1),at(4,1));expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.state.delivered).toEqual([]);
    expect(carrierPositions(result.state.board)[0].row).toBeLessThan(2);
    for(const frame of result.frames.filter(f=>f.kind==='fall'))for(const m of frame.motions){
      expect(m.to.col).toBe(m.from.col);
      for(let row=m.from.row;row<=m.to.row;row++)expect(result.state.mask[row][m.to.col]).toBe(true);
    }
    invariant(result.state);
  });
  it('조회 반복은 board·RNG·새 ID serial·이동을 전혀 소비하지 않습니다',()=>{
    const engine=new CarrierEngine(drop()),before=engine.snapshot;
    for(let i=0;i<5;i++){expect(engine.legalMoves().length).toBeGreaterThan(0);expect(engine.findMatches()).toEqual([]);}
    expect(engine.snapshot).toEqual(before);
  });
  it.each([
    [at(-1,0),at(0,0),'position'],[at(0,0),at(0,0),'adjacent'],[at(0,0),at(2,2),'adjacent'],
    [at(0,0),at(0,1),'no-match'],[at(Number.NaN,0),at(0,0),'position'],
  ] as const)('무효 교환은 전체 상태 불변입니다: %j → %j',(a,b,reason)=>{
    const engine=new CarrierEngine(drop()),before=engine.snapshot;
    expect(engine.swap(a,b)).toEqual({valid:false,reason,frames:[]});expect(engine.snapshot).toEqual(before);
  });
  it('독립된 같은 색2×2는 특수나 매치로 바꾸지 않습니다',()=>{
    const engine=new CarrierEngine(drop({board:[[0,0,1],[0,1,0],[2,basket(),3]],exits:[at(2,0)],moves:5})),before=engine.snapshot;
    expect(engine.swap(at(1,1),at(1,2))).toEqual({valid:false,reason:'no-match',frames:[]});
    expect(engine.snapshot).toEqual(before);
  });
  it('5개 직선도 일반 제거이며 기존 특수 규칙을 끌어오지 않습니다',()=>{
    const engine=new CarrierEngine(drop({board:[[basket(),1,2,3,4],[0,0,1,0,0],[1,2,0,3,4]],exits:[at(2,0)],moves:5}));
    const result=engine.swap(at(1,2),at(2,2));expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.frames.find(frame=>frame.kind==='clear')?.removed).toHaveLength(5);
    expect(result.state.board.flat().filter(Boolean).some(cell=>'special' in cell!)).toBe(false);
  });
  it('N회 cap 경계는 성공하고 N+1은 배송/RNG/serial까지 원자적으로 취소합니다',()=>{
    const allowed=new CarrierEngine(drop({seed:11,cascadeLimit:2}));
    const success=turn(allowed);expect(success.valid).toBe(true);if(!success.valid)return;
    expect(success.cascades).toBe(2);expect(success.state.delivered).toEqual(['seeds']);
    const capped=new CarrierEngine(drop({seed:11,cascadeLimit:1})),before=capped.snapshot;
    expect(turn(capped)).toEqual({valid:false,reason:'resolution-cap',frames:[]});
    expect(capped.snapshot).toEqual(before);
    const fresh=new CarrierEngine(drop({seed:11,cascadeLimit:1}));
    expect(turn(capped)).toEqual(turn(fresh));expect(capped.snapshot).toEqual(fresh.snapshot);
  });
  it('마지막 이동의 배송 성공은 won, 목표가 남으면 lost입니다',()=>{
    const win=new CarrierEngine(drop());turn(win);expect(win.snapshot.status).toBe('won');
    const lost=new CarrierEngine(drop({exits:[at(2,2)]}));turn(lost);
    expect(lost.snapshot.movesRemaining).toBe(0);expect(lost.snapshot.delivered).toEqual([]);expect(lost.snapshot.status).toBe('lost');
    for(const engine of [win,lost]){const before=engine.snapshot;expect(turn(engine)).toEqual({valid:false,reason:'ended',frames:[]});expect(engine.snapshot).toEqual(before);}
  });
  it('유효 교환이 없는 판을 자동 재생성하지 않고 blocked로 표시합니다',()=>{
    const board:CarrierInput[][]=[[basket(),0,1],[2,3,4],[1,4,5]];
    const engine=new CarrierEngine(drop({board,moves:5})),before=engine.snapshot;
    expect(before.status).toBe('blocked');expect(before.randomDraws).toBe(0);expect(engine.legalMoves()).toEqual([]);
    expect(turn(engine)).toEqual({valid:false,reason:'ended',frames:[]});expect(engine.snapshot).toEqual(before);
  });
  it('유효 이동 후 남은 이동이 있어도 더 매치할 수 없으면 blocked입니다',()=>{
    const engine=new CarrierEngine(drop({board:[[3,4,5],[basket(),0,2],[0,1,0]],exits:[at(2,2)],moves:5}));
    expect(engine.snapshot.status).toBe('playing');
    const result=turn(engine);expect(result.valid).toBe(true);if(!result.valid)return;
    expect(result.state.movesRemaining).toBe(4);expect(result.state.delivered).toEqual([]);
    expect(result.state.status).toBe('blocked');expect(engine.legalMoves()).toEqual([]);
    const before=engine.snapshot;expect(turn(engine)).toEqual({valid:false,reason:'ended',frames:[]});expect(engine.snapshot).toEqual(before);
  });
  it('운반물끼리의 교환과 구멍을 향한 교환은 무변경입니다',()=>{
    const engine=new CarrierEngine(drop({board:[[basket('first'),2,1],[basket('second'),3,2],[0,0,1],[1,1,0]],exits:[at(3,0)]}));
    const before=engine.snapshot;expect(engine.swap(at(0,0),at(1,0))).toEqual({valid:false,reason:'no-match',frames:[]});expect(engine.snapshot).toEqual(before);
    const masked=new CarrierEngine(carrierScenarios[2].level),initial=masked.snapshot;
    expect(masked.swap(at(2,4),at(3,4))).toEqual({valid:false,reason:'inactive',frames:[]});expect(masked.snapshot).toEqual(initial);
  });
  it('같은 시드 재시작은 초기 ID·RNG·상태와 다음 결과를 복원합니다',()=>{
    const engine=new CarrierEngine(drop({seed:11})),before=engine.snapshot,result=turn(engine);
    expect(engine.restart()).toEqual(before);expect(turn(engine)).toEqual(result);
  });
  it('입력과 공개 스냅샷/단계가 실제 엔진 상태를 변경할 수 없습니다',()=>{
    const input=structuredClone(drop()),engine=new CarrierEngine(input),before=engine.snapshot;
    (input.board as CarrierInput[][])[0][0]=5;
    expect(engine.snapshot).toEqual(before);
    expect(()=>{(before.board[0][0] as {id:string}).id='changed';}).toThrow();
    const result=turn(engine);expect(result.valid).toBe(true);if(!result.valid)return;
    expect(()=>{(result.frames[0].motions[0].to as {row:number}).row=7;}).toThrow();
  });
  it.each(carrierScenarios)('작성된 대표 공략이 실제 목표를 완료합니다: $level.id',scenario=>{
    const engine=new CarrierEngine(scenario.level);
    for(const move of scenario.authoredPath){const result=engine.swap(move.a,move.b);expect(result.valid).toBe(true);if(!result.valid)return;invariant(result.state);}
    expect(engine.snapshot.status).toBe('won');expect(engine.snapshot.delivered.length).toBe(engine.snapshot.initialCarrierIds.length);
  });
  it('여러 시드의 실제 합법 명령에서 carrier 보존·마스크·안정 상태가 유지됩니다',()=>{
    for(const scenario of carrierScenarios)for(let seed=0;seed<12;seed++){
      const engine=new CarrierEngine({...scenario.level,seed});
      for(let turnIndex=0;turnIndex<8&&engine.snapshot.status==='playing';turnIndex++){
        const before=engine.snapshot,moves=engine.legalMoves();expect(engine.snapshot).toEqual(before);
        const move=moves[turnIndex%moves.length],result=engine.swap(move.a,move.b);
        if(!result.valid){expect(result.reason).toBe('resolution-cap');expect(engine.snapshot).toEqual(before);break;}
        invariant(result.state);expect(engine.findMatches()).toEqual([]);
        for(const frame of result.frames.filter(f=>f.kind==='fall'))for(const m of frame.motions){
          expect(m.to.row).toBeGreaterThan(m.from.row);expect(m.to.col).toBe(m.from.col);
          for(let row=m.from.row;row<=m.to.row;row++)expect(result.state.mask[row][m.to.col]).toBe(true);
          expect(frame.board[m.to.row][m.to.col]?.id).toBe(m.id);
        }
      }
    }
  });
  it.each([
    {...drop(),profile:'legacy'}, {...drop(),seed:NaN}, {...drop(),moves:0}, {...drop(),cascadeLimit:0},
    {...drop(),leaves:[]}, {...drop(),crates:[]}, {...drop(),shuffle:true},
    {...drop(),board:[[1,2,1],[basket(),{color:0,special:'row'},2],[0,1,0]]},
    {...drop(),board:[[1,2,1],[basket(),basket(),2],[0,1,0]]},
    {...drop(),board:[[1,2,1],[0,0,2],[basket(),1,0]]},
    {...drop(),exits:[at(1,0)]}, {...drop(),exits:[at(2,0),at(2,0)]},
    {...drop(),board:[[0,0,0],[basket(),1,2],[0,1,0]]},
  ])('불량/미지원 구성을 거절합니다: %#',input=>expect(()=>new CarrierEngine(input as CarrierLevel)).toThrow());
  it('희소 배열과 배열의 숨은 추가 필드/접근자를 무시하지 않습니다',()=>{
    const sparse=structuredClone(drop());delete (sparse.board[0] as CarrierInput[])[1];
    expect(()=>new CarrierEngine(sparse)).toThrow();
    const extra=structuredClone(drop());Object.defineProperty(extra.board,'specials',{value:[]});
    expect(()=>new CarrierEngine(extra)).toThrow();
    let getter=0;const accessor=structuredClone(drop());Object.defineProperty(accessor,'seed',{get(){getter++;return 0;}});
    expect(()=>new CarrierEngine(accessor)).toThrow();expect(getter).toBe(0);
  });
});
