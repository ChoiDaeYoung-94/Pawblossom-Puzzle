import { describe, expect, it, vi } from 'vitest';
import { BoardEngine, seededRng, type Tile, type Position, type ResolveStep } from '../src/core';

class Piece {
  destroyed=false;alpha=1;scale=1;
  constructor(public x:number,public y:number){}
  add(){return this;}setScale(value:number){this.scale=value;return this;}
  setPosition(x:number,y:number){this.x=x;this.y=y;return this;}
  destroy(){this.destroyed=true;}
}
vi.mock('phaser',()=>{
  const graphic:object=new Proxy({}, {get:()=>()=>graphic});
  return {default:{Scene:class {
    add={container:(x:number,y:number)=>new Piece(x,y),graphics:()=>graphic,image:()=>({setDisplaySize(){return this;}}),circle:(x:number,y:number)=>new Piece(x,y)};
    tweens={killTweensOf(){},add(config:Record<string,unknown>){
      const targets=Array.isArray(config.targets)?config.targets:[config.targets];
      for(const target of targets)for(const key of ['x','y','scale','alpha'])if(config[key]!==undefined)target[key]=config[key];
      if(typeof config.onComplete==='function')config.onComplete();
    }};
    time={delayedCall:(_ms:number,callback:()=>void)=>{callback();return {remove(){}};}};
  }}};
});
import { BoardScene } from '../src/BoardScene';
interface RenderScene {
  pieces:Piece[][];engine:BoardEngine;
  paint(board:Tile[][]):void;drop(step:ResolveStep):void;
  attempt(a:Position,b?:Position):Promise<void>;tap(p:Position):void;resetHint():void;
}
function harness(){
  const onMove=vi.fn(),onNotice=vi.fn();
  const scene=new BoardScene({audio:{play(){}} as never,onStart(){},onMove,onNotice}) as unknown as RenderScene;
  scene.engine=new BoardEngine(8,8,seededRng(42));
  scene.engine.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));
  scene.resetHint=()=>{};
  return {scene,onMove,onNotice};
}
describe('블록 객체 보존과 낙하 연출',()=>{
  it('보통 매치와 연쇄에서 제거되지 않은 객체를 유지하고 영향 없는 열을 그대로 둡니다',async()=>{
    const {scene,onMove,onNotice}=harness();
    for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])scene.engine.board[r][c]={kind:k};
    scene.paint(scene.engine.board);
    const old=scene.pieces.map(row=>row.slice()),drops:ResolveStep[]=[];
    const drop=scene.drop.bind(scene);scene.drop=step=>{
      const previous=scene.pieces.map(row=>row.slice());drops.push(step);drop(step);
      for(let col=0;col<8;col++){
        const survivors=previous.map((row,r)=>({piece:row[col],row:r}))
          .filter(item=>!step.removed.some(p=>p.row===item.row&&p.col===col));
        survivors.forEach((item,i)=>{
          if(step.created?.some(p=>p.row===item.row&&p.col===col))return;
          expect(scene.pieces[8-survivors.length+i][col]).toBe(item.piece);
          expect(item.piece.destroyed).toBe(false);
        });
      }
    };
    await scene.attempt({row:4,col:2},{row:3,col:2});
    expect(onMove).toHaveBeenCalledOnce();expect(drops.length).toBeGreaterThan(0);
    expect(old[3][0].destroyed).toBe(true);
    // 보충 난수에 따른 추가 제거까지 포함해 영향을 받지 않은 열을 검사합니다.
    for(let col=0;col<8;col++)if(!onNotice.mock.calls.some(call=>call[0]==='noMoves')&&drops.every(step=>step.removed.every(p=>p.col!==col))){
      for(let row=0;row<8;row++)expect(scene.pieces[row][col]).toBe(old[row][col]);
    }
    scene.pieces.forEach((row,r)=>row.forEach((piece,c)=>{
      expect(piece.x).toBe(44+c*56);expect(piece.y).toBe(44+r*56);expect(piece.alpha).toBe(1);
    }));
  });
  it('특수 생성 칸도 위의 빈칸만큼 내려오며 다른 블록은 새로 만들지 않습니다',()=>{
    const {scene}=harness();scene.paint(scene.engine.board);const old=scene.pieces.map(row=>row.slice());
    const before=scene.engine.board,after=before.map(row=>row.map(tile=>({...tile})));
    after[6][0]={kind:before[5][0].kind,special:'row'};
    scene.drop({before,after,removed:[{row:7,col:0}],created:[{row:5,col:0,tile:after[6][0]}]});
    expect(old[7][0].destroyed).toBe(true);expect(old[5][0].destroyed).toBe(true);
    expect(scene.pieces[7][0]).toBe(old[6][0]);expect(scene.pieces[4][0]).toBe(old[3][0]);
    expect(scene.pieces[6][0]).not.toBe(old[5][0]);expect(scene.pieces[6][0].y).toBe(380);
    expect(scene.pieces[3][1]).toBe(old[3][1]);
  });
  it('특수 탭과 교환은 결과 콜백을 한 번 호출하고 일반 블록 탭은 이동을 쓰지 않습니다',async()=>{
    const {scene,onMove}=harness();scene.engine.board[3][3].special='row';scene.paint(scene.engine.board);
    await scene.attempt({row:3,col:3});expect(onMove).toHaveBeenCalledOnce();
    await scene.attempt({row:0,col:0});expect(onMove).toHaveBeenCalledOnce();
    scene.engine.board[3][3].special='column';scene.paint(scene.engine.board);
    await scene.attempt({row:3,col:3},{row:3,col:4});expect(onMove).toHaveBeenCalledTimes(2);
  });
});
