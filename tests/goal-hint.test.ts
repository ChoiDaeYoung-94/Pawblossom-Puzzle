import {describe,it,expect,vi} from 'vitest';
import {BoardEngine,type Cell,type LegalMove,type RuleVersion} from '../src/core/BoardEngine';
import {goalAwareHint,type HintGoals} from '../src/GoalHint';

const pattern=[[0,1,0,2],[1,0,2,1],[2,0,1,0],[0,2,1,2]];
const colors=(kind:number,remaining=20):HintGoals=>({colors:[{kind,remaining}],leaves:false,crates:false});
const first:LegalMove={a:{row:0,col:0},b:{row:0,col:1}},later:LegalMove={a:{row:1,col:2},b:{row:1,col:3}};
function fixture(version:RuleVersion=1,options:{leaf?:[number,number];crate?:[number,number];hole?:[number,number];special?:boolean;pattern?:number[][]}={}){
  const source=options.pattern??pattern,board:Cell[][]=source.map(row=>row.map(kind=>({kind}))),leaves=source.map(row=>row.map(()=>0)),mask=source.map(row=>row.map(()=>true)),crates=source.map(row=>row.map(()=>0));
  if(options.leaf)leaves[options.leaf[0]][options.leaf[1]]=2;
  if(options.crate){const[r,c]=options.crate;board[r][c]=null;crates[r][c]=1;}
  if(options.hole){const[r,c]=options.hole;board[r][c]=null;mask[r][c]=false;}
  if(options.special)board[0][0]={kind:0,special:'rainbow'};
  const rng=vi.fn(()=>{throw new Error('난수 호출 금지');});
  const engine=new BoardEngine(4,4,rng,{board,leaves,ruleVersion:version,...(options.crate?{crates}:{})},version,mask);
  return {engine,rng};
}
function choices(engine:BoardEngine){const legal=engine.legalMoves();expect(legal).toContainEqual(first);expect(legal).toContainEqual(later);return [legal.find(move=>JSON.stringify(move)===JSON.stringify(first))!,legal.find(move=>JSON.stringify(move)===JSON.stringify(later))!];}
function freeze(value:unknown){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}}

describe('현재 합법 수의 목표 관련도 힌트',()=>{
  it('무관한 첫 수보다 남은 색 목표를 맞추는 후속 수를 고릅니다',()=>{
    const{engine,rng}=fixture(),moves=choices(engine);expect(goalAwareHint(engine,moves,colors(1))).toBe(moves[1]);expect(rng).not.toHaveBeenCalled();
  });
  it('완료 목표는 제외하고 현재 남은 목표를 반영합니다',()=>{
    const{engine}=fixture(),moves=choices(engine).reverse();expect(goalAwareHint(engine,moves,{colors:[{kind:1,remaining:0},{kind:0,remaining:3}],leaves:false,crates:false})).toBe(moves[1]);
  });
  it('동점·무관한 목표·목표 없음은 원래 후보와 순서를 그대로 유지합니다',()=>{
    const{engine}=fixture(),moves=choices(engine),before=structuredClone(moves);
    expect(goalAwareHint(engine,moves,{colors:[{kind:0,remaining:3},{kind:1,remaining:3}],leaves:false,crates:false})).toBe(moves[0]);
    for(const goals of [undefined,colors(5),colors(1,0),colors(1,NaN),colors(1,Infinity)])expect(goalAwareHint(engine,moves,goals)).toBe(moves[0]);
    expect(moves).toEqual(before);expect(goalAwareHint(engine,[],colors(0))).toBeUndefined();expect(goalAwareHint(engine,[moves[1]],colors(0))).toBe(moves[1]);
  });
  it.each([[3,3],[3,2]] as [number,number][])('현재 낙엽%s,%s의 직교/매치 관련도를 읽고 대각선 피해는 추정하지 않습니다',(row,col)=>{
    const{engine}=fixture(1,{leaf:[row,col]}),moves=choices(engine);expect(goalAwareHint(engine,moves,{colors:[],leaves:true,crates:false})).toBe(moves[1]);
    expect(goalAwareHint(engine,moves,{colors:[],leaves:false,crates:false})).toBe(moves[0]);
  });
  it('현재 상자에 닿는 매치를 고르되 상자 없는 수집 판으로 바꾸지 않습니다',()=>{
    const{engine}=fixture(2,{crate:[3,3]}),moves=choices(engine),before=structuredClone(engine.crates);
    expect(goalAwareHint(engine,moves,{colors:[],leaves:false,crates:true})).toBe(moves[1]);expect(engine.crates).toEqual(before);expect(engine.board[3][3]).toBeNull();
  });
  it('비정형 mask의 빈 칸과 원본 보드를 보존합니다',()=>{
    const{engine,rng}=fixture(2,{hole:[0,3]}),moves=choices(engine),before=structuredClone(engine.board);
    expect(goalAwareHint(engine,moves,colors(1))).toBe(moves[1]);expect(engine.mask[0][3]).toBe(false);expect(engine.board).toEqual(before);expect(rng).not.toHaveBeenCalled();
  });
  it('V1/V2 실제 판정으로 2×2 후보의 포함 여부를 유지합니다',()=>{
    const source=[[0,0,1,2],[0,1,0,3],[1,2,3,0],[2,3,0,1]],square={a:{row:1,col:1},b:{row:1,col:2}};
    const legacy=fixture(1,{pattern:source}),modern=fixture(2,{pattern:source}),a=legacy.engine.legalMoves(),b=modern.engine.legalMoves();
    expect(a).not.toContainEqual(square);expect(b).toContainEqual(square);expect(goalAwareHint(legacy.engine,a,colors(0))).toBe(a[0]);expect(goalAwareHint(modern.engine,b,colors(0))).toEqual(square);
  });
  it('특수 교환의 미래 효과는 일반 매치로 추정하지 않고 기존 합법 후보로 남깁니다',()=>{
    const{engine}=fixture(2,{special:true}),moves=choices(engine);
    expect(goalAwareHint(engine,moves,colors(1))).toBe(moves[1]);expect(goalAwareHint(engine,moves,colors(5))).toBe(moves[0]);
  });
  it('반복 조회는 동결한 원본과 후보를 쓰지 않고 난수·해결 동작을 호출하지 않습니다',()=>{
    const{engine,rng}=fixture(2,{leaf:[3,2],crate:[3,3]}),moves=choices(engine),before=JSON.stringify({board:engine.board,leaves:engine.leaves,crates:engine.crates,mask:engine.mask});
    freeze(engine);freeze(moves);for(let i=0;i<20;i++)expect(goalAwareHint(engine,moves,{...colors(1),leaves:true,crates:true})).toBe(moves[1]);
    expect(JSON.stringify({board:engine.board,leaves:engine.leaves,crates:engine.crates,mask:engine.mask})).toBe(before);expect(rng).not.toHaveBeenCalled();
  });
});
