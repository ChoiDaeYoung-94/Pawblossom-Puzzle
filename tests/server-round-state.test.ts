import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BoardEngine,seededRng} from '../src/core/BoardEngine';
import {levels} from '../src/levels';
import {advanceState,commandSnapshot,CONTENT_HASH,ENGINE_SOURCE_SHA256,levelSnapshot,publicState,startState,validateState,type RoundState} from '../server/game/roundState';
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function move(s:RoundState){return new BoardEngine(8,8,()=>{throw new Error();},s).legalMoves()[0];}
function invalid(s:RoundState){const e=new BoardEngine(8,8,()=>{throw new Error();},s),legal=e.legalMoves();for(let r=0;r<8;r++)for(let c=0;c<7;c++){const a={row:r,col:c},b={row:r,col:c+1};if(!legal.some(m=>JSON.stringify(m)===JSON.stringify({a,b})))return {a,b};}throw new Error('fixture-no-invalid');}
describe('서버 순수 회차 상태·기존 엔진 기준 동등성',()=>{
  it('엔진 LF SHA-256·콘텐츠 snapshot 고정',()=>{
    const source=readFileSync(new URL('../src/core/BoardEngine.ts',import.meta.url),'utf8').replace(/\r\n/g,'\n');
    expect(createHash('sha256').update(source).digest('hex')).toBe(ENGINE_SOURCE_SHA256);
    expect(createHash('sha256').update(JSON.stringify(levels)).digest('hex')).toBe(CONTENT_HASH);
    const l=levelSnapshot(1);l.moves=1;expect(levelSnapshot(1)).toEqual(levels[0]);
  });
  it.each([0,1,0xffffffff,0x6d2b79f5,123456789])('seed %s: 초기 생성/수천 난수 진행·복원 뒤 셔플이 기존 Mulberry32와 동일',seed=>{
    let s=startState(4,seed),calls=0;const next=seededRng(seed),rng=()=>{calls++;return next();};
    const e=new BoardEngine(8,8,rng);e.setLeaves(levels[3].leaves??[]);
    expect(s.board).toEqual(e.board);expect(s.rngState).toBe((seed+Math.imul(calls,0x6d2b79f5))>>>0);
    for(let n=0;n<15&&s.status==='active';n++){
      const m=e.legalMoves()[n%e.legalMoves().length],r=e.swap(m.a,m.b);const out=advanceState(s,{type:'swap',...m});s=clone(out.state);
      expect(out.outcome).toBe('valid-swap');expect(s.board).toEqual(e.board);expect(s.leaves).toEqual(e.leaves);
      expect(s.rngState).toBe((seed+Math.imul(calls,0x6d2b79f5))>>>0);expect(r.valid).toBe(true);
    }
    if(s.status==='active'){e.shuffle();s=advanceState(clone(s),{type:'shuffle'}).state;expect(s.board).toEqual(e.board);expect(s.leaves).toEqual(e.leaves);expect(s.rngState).toBe((seed+Math.imul(calls,0x6d2b79f5))>>>0);}
  });
  it.each(levels.map(l=>l.id))('level %s: 전체 회차 점수/수집/낙엽/이동/승패를 기준 엔진과 비교',id=>{
    const seed=id*9876543;let s=startState(id,seed),score=0,leaves=0,moves=levels[id-1].moves,items=[0,0,0,0,0,0];
    const e=new BoardEngine(8,8,seededRng(seed));e.setLeaves(levels[id-1].leaves??[]);
    expect(s.board).toEqual(e.board);
    for(let n=0;n<40&&s.status==='active';n++){
      if(n===3){e.shuffle();s=advanceState(clone(s),{type:'shuffle'}).state;expect(s.moves).toBe(moves);expect(s.shuffles).toBe(0);}
      const legal=e.legalMoves(),m=legal[(n*7)%legal.length],result=e.swap(m.a,m.b);moves--;score+=result.score;leaves+=result.leavesCleared??0;result.collected.forEach((x,k)=>items[k]+=x);
      s=advanceState(clone(s),{type:'swap',...m}).state;
      const won=levels[id-1].goals.every(g=>items[g.kind]>=g.count)&&leaves>=(levels[id-1].leaves?.length??0);
      expect(s).toMatchObject({board:e.board,leaves:e.leaves,moves,score,collected:items,clearedLeaves:leaves,status:won?'won':moves===0?'failed':'active'});
      validateState(s);
    }
    expect(s.status).not.toBe('active');
    expect(()=>advanceState(s,{type:'shuffle'})).toThrow('round-terminal');
    if(s.status==='failed'){const abandoned=advanceState(s,{type:'abandon'}).state;expect(abandoned.status).toBe('abandoned');expect(abandoned.moves).toBe(0);expect(()=>advanceState(abandoned,{type:'abandon'})).toThrow('round-terminal');}
  });
  it('불성립 교환은 RNG/보드/점수/낙엽/이동 불변·입력 사본 유지',()=>{
    const s=startState(30,71),before=clone(s),r=advanceState(s,{type:'swap',...invalid(s)});
    expect(r).toEqual({state:before,outcome:'invalid-swap'});expect(s).toEqual(before);
  });
  it.each([
    {special:'row',seed:1,a:{row:3,col:5},b:{row:4,col:5},at:{row:3,col:2}},
    {special:'column',seed:2,a:{row:1,col:4},b:{row:1,col:5},at:{row:3,col:4}},
    {special:'bomb',seed:2,a:{row:6,col:7},b:{row:7,col:7},at:{row:2,col:6}},
    {special:'rainbow',seed:3,a:{row:3,col:2},b:{row:2,col:2},at:{row:2,col:2}},
  ])('기존 생성/교환으로 만든 $special 탭은 기준 엔진·복원 RNG·점수/수집/낙엽과 동일',fixture=>{
    let calls=0;const next=seededRng(fixture.seed),reference=new BoardEngine(8,8,()=>{calls++;return next();});reference.setLeaves(levels[29].leaves??[]);
    const initial=startState(30,fixture.seed);
    if(fixture.special==='rainbow'){
      // V2 초기 생성은 정사각을 피하므로 옛 seed3의 5직선 위치가 달라집니다. 같은 seed/소비 상태에 명시적인 5직선 교환을 구성합니다.
      const authored=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%5})));
      for(const [r,c] of [[2,0],[2,1],[2,3],[2,4],[3,2]])authored[r][c]={kind:5};
      reference.board=authored.map(row=>row.map(t=>({...t})));initial.board=authored;
    }
    const setup=reference.swap(fixture.a,fixture.b),before=advanceState(initial,{type:'swap',a:fixture.a,b:fixture.b}).state;
    expect(setup.valid).toBe(true);expect(before.board[fixture.at.row][fixture.at.col].special).toBe(fixture.special);expect(before.board).toEqual(reference.board);
    const original=clone(before),result=reference.activate(fixture.at),actual=advanceState(clone(before),{type:'activate',at:fixture.at});
    expect(actual.outcome).toBe('valid-activation');expect(result.valid).toBe(true);expect(actual.state.board).toEqual(reference.board);expect(actual.state.leaves).toEqual(reference.leaves);
    expect(actual.state.moves).toBe(before.moves-1);expect(actual.state.score).toBe(before.score+result.score);expect(actual.state.collected).toEqual(before.collected.map((n,k)=>n+result.collected[k]));
    expect(actual.state.clearedLeaves).toBe(before.clearedLeaves+(result.leavesCleared??0));expect(actual.state.rngState).toBe((fixture.seed+Math.imul(calls,0x6d2b79f5))>>>0);
    expect(before).toEqual(original);validateState(actual.state);
  });
  it('일반 타일 탭은 기준 엔진과 같은 불성립이며 RNG/이동/보드/집계 불변',()=>{
    const state=startState(30,1),before=clone(state),reference=new BoardEngine(8,8,()=>{throw new Error('unexpected-rng');},state),at={row:0,col:0};
    expect(reference.activate(at).valid).toBe(false);expect(advanceState(state,{type:'activate',at})).toEqual({state:before,outcome:'invalid-activation'});expect(state).toEqual(before);
  });
  it('명시 V2 정사각만 되는 교환도 서버/순수 엔진의 결과와 RNG가 일치합니다',()=>{
    const state=startState(1,42);state.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%5})));
    for(const [r,c] of [[2,2],[2,3],[3,2],[3,4]])state.board[r][c]={kind:5};
    validateState(state);let calls=0;const next=seededRng(state.rngState),engine=new BoardEngine(8,8,()=>{calls++;return next();},state);
    const command={type:'swap' as const,a:{row:3,col:4},b:{row:3,col:3}},result=engine.swap(command.a,command.b),actual=advanceState(state,command);
    expect(result.steps[0].created).toEqual([{row:3,col:3,tile:{kind:5,special:'bomb'}}]);
    expect(actual.outcome).toBe('valid-swap');expect(actual.state).toMatchObject({ruleVersion:2,board:engine.board,leaves:engine.leaves,moves:state.moves-1,score:result.score,collected:result.collected});
    expect(actual.state.rngState).toBe((state.rngState+Math.imul(calls,0x6d2b79f5))>>>0);
  });
  it.each([undefined,null,1,3,'2'])('서버 회차 버전 %s는 신규 명시2 계약에서 거절합니다',ruleVersion=>{
    const state:any=startState(1,42);if(ruleVersion===undefined)delete state.ruleVersion;else state.ruleVersion=ruleVersion;
    expect(()=>validateState(state)).toThrow();
  });
  it.each(['won','failed'] as const)('특수 탭 마지막 이동의 %s·종료 뒤 재조작 차단',status=>{
    const id=status==='won'?1:30,setup=advanceState(startState(id,1),{type:'swap',a:{row:3,col:5},b:{row:4,col:5}}).state;
    setup.moves=1;if(status==='won'){setup.collected=Array(6).fill(1000);setup.collected[0]=11;}
    const result=advanceState(setup,{type:'activate',at:{row:3,col:2}});expect(result.outcome).toBe('valid-activation');expect(result.state.moves).toBe(0);expect(result.state.status).toBe(status);
    expect(()=>advanceState(result.state,{type:'activate',at:{row:0,col:0}})).toThrow('round-terminal');
  });
  it('마지막 이동에 목표 달성하면 won, 남은 목표·낙엽이면 failed',()=>{
    let s=startState(1,71);s.moves=1;s.collected=Array(6).fill(1000);s.collected[0]=11;
    const choices=new BoardEngine(8,8,()=>0,s).legalMoves();
    const m=choices.find(m=>{const r=advanceState(s,{type:'swap',...m});return r.state.status==='won';});expect(m).toBeDefined();
    const won=advanceState(s,{type:'swap',...m!}).state;expect(won.moves).toBe(0);expect(won.status).toBe('won');
    s=startState(30,71);s.moves=1;const failed=advanceState(s,{type:'swap',...move(s)}).state;expect(failed.status).toBe('failed');expect(failed.moves).toBe(0);
  });
  it('셔플 1회·포기 및 공개 상태 깊은 동결/RNG 비노출',()=>{
    const s=startState(4,71),shuffle=advanceState(s,{type:'shuffle'}).state;
    expect(shuffle.moves).toBe(s.moves);expect(shuffle.leaves).toEqual(s.leaves);expect(()=>advanceState(shuffle,{type:'shuffle'})).toThrow('shuffle-used');
    const abandoned=advanceState(s,{type:'abandon'}).state;expect(abandoned.status).toBe('abandoned');
    const p=publicState(s);expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.board[0][0])).toBe(true);expect(Object.isFrozen(p.level.goals[0])).toBe(true);expect(p).not.toHaveProperty('rngState');expect(p.board).not.toBe(s.board);expect(()=>{(p.board[0][0] as any).kind=9;}).toThrow();
  });
  it.each([
    null,{},[],{type:'activate',a:{row:0,col:0}},{type:'shuffle',score:9},{type:'abandon',ownerId:'x'},
    {type:'swap',a:{row:0,col:0},b:{row:0,col:0}},{type:'swap',a:{row:0,col:0},b:{row:2,col:0}},
    {type:'swap',a:{row:-1,col:0},b:{row:0,col:0}},{type:'swap',a:{row:0.1,col:0},b:{row:1.1,col:0}},
    {type:'swap',a:{row:0,col:0,score:1},b:{row:0,col:1}},{type:'swap',a:{row:0,col:0},b:{row:0,col:8}},
    {type:'activate'},{type:'activate',at:null},{type:'activate',at:{row:0,col:8}},{type:'activate',at:{row:-1,col:0}},
    {type:'activate',at:{row:0.5,col:0}},{type:'activate',at:{row:0,col:0,score:1}},{type:'activate',at:{row:0,col:0},rng:42},
  ])('잘못된 명령 %j 거절',v=>expect(()=>commandSnapshot(v)).toThrow());
  it('요청 getter·toJSON·symbol·상속 거절 및 getter 미호출',()=>{
    const getter=vi.fn(()=> 'shuffle');expect(()=>commandSnapshot({get type(){return getter();}})).toThrow();expect(getter).not.toHaveBeenCalled();
    for(const c of [Object.assign(Object.create({}),{type:'shuffle'}),{type:'shuffle',[Symbol()]:1},{type:'shuffle',toJSON(){throw new Error('secret');}}])expect(()=>commandSnapshot(c)).toThrow();
    const s=startState(1,1);Object.defineProperty(s.level,'goals',{get(){getter();throw new Error('secret');},enumerable:true});expect(()=>validateState(s)).toThrow();expect(getter).not.toHaveBeenCalled();
    expect(()=>commandSnapshot({type:'activate',get at(){return getter();}})).toThrow();
    expect(()=>commandSnapshot({type:'activate',at:{row:0,get col(){return getter();}}})).toThrow();expect(getter).not.toHaveBeenCalled();
  });
  it.each(['rng','board','tile','leaf','collected','score','moves','shuffle','status','level','unsettled','empty-leaves'])('잘못된 저장 상태 %s 거절',field=>{
    const s:any=startState(4,71);
    if(field==='rng')s.rngState=-1;if(field==='board')s.board.pop();if(field==='tile')s.board[0][0].special={toString:()=> 'bomb'};
    if(field==='leaf')s.leaves[0][0]=2;if(field==='collected')s.collected[0]=-1;if(field==='score')s.score=Infinity;if(field==='moves')s.moves=27;
    if(field==='shuffle')s.shuffles=2;if(field==='status')s.status={toString:()=> 'active'};if(field==='level')s.level.moves=1;
    if(field==='unsettled')s.board[0]=Array(8).fill({kind:0});if(field==='empty-leaves'){s.leaves[2][2]=0;}
    expect(()=>validateState(s)).toThrow();
  });
});
