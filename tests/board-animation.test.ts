import { describe, expect, it, vi } from 'vitest';
import { BoardEngine, seededRng, type Tile, type Position, type ResolveStep } from '../src/core';

class Piece {
  destroyed=false;alpha=1;scale=1;
  name='';text='';texture='';width=0;height=0;
  constructor(public x:number,public y:number){}
  add(){return this;}setScale(value:number){this.scale=value;return this;}
  setDepth(){return this;}
  setName(name:string){this.name=name;return this;}setOrigin(){return this;}
  setAngle(){return this;}setDisplaySize(width:number,height:number){this.width=width;this.height=height;return this;}
  setPosition(x:number,y:number){this.x=x;this.y=y;return this;}
  destroy(){this.destroyed=true;}
}
class Graphic {
  destroyed=false;alpha=1;rectangles:number[][]=[];lines:number[][]=[];
  fillStyle(){return this;}lineStyle(){return this;}setDepth(){return this;}
  fillRoundedRect(...values:number[]){this.rectangles.push(values);return this;}
  strokeRoundedRect(){return this;}fillCircle(){return this;}strokeCircle(){return this;}
  lineBetween(...values:number[]){this.lines.push(values);return this;}
  setName(){return this;}setPosition(){return this;}
  clear(){return this;}
  destroy(){this.destroyed=true;}
}
vi.mock('phaser',()=>{
  return {default:{Scene:class {
    sys={isActive:()=>true};
    add={container:(x:number,y:number)=>new Piece(x,y),graphics:()=>new Graphic(),image:(x:number,y:number,texture:string)=>{const image=new Piece(x,y);image.texture=texture;return image;},text:(x:number,y:number,text:string)=>{const label=new Piece(x,y);label.text=text;return label;},circle:(x:number,y:number)=>new Piece(x,y)};
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
  sys:{isActive():boolean};shuffle():boolean;
  pieces:Piece[][];engine:BoardEngine;
  paint(board:Tile[][]):void;drop(step:ResolveStep):void;
  attempt(a:Position,b?:Position):Promise<void>;tap(p:Position):void;resetHint():void;
  showEffect(step:ResolveStep):Graphic;
  paintLeaves(leaves:number[][]):void;
  leafObjects:(Piece|Graphic)[];
  busy:boolean;finished:boolean;
  keyboardState:BoardScene['keyboardState'];focusKeyboard:BoardScene['focusKeyboard'];keyboardKey:BoardScene['keyboardKey'];cancelInput:BoardScene['cancelInput'];stopPlaying:BoardScene['stopPlaying'];
}
const snapshot=(engine:BoardEngine)=>({board:engine.board.map(row=>row.map(tile=>({...tile}))),leaves:engine.leaves.map(row=>row.slice())});
function harness(){
  const onMove=vi.fn(),onNotice=vi.fn();
  const scene=new BoardScene({audio:{play(){}} as never,onStart(){},onMove,onNotice}) as unknown as RenderScene;
  scene.engine=new BoardEngine(8,8,seededRng(42));
  scene.engine.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));
  scene.resetHint=()=>{};
  return {scene,onMove,onNotice};
}
describe('블록 객체 보존과 낙하 연출',()=>{
  it('미준비·일시정지 Scene의 섞기는 그리기 전에 거부하고 보드를 유지합니다',()=>{
    const {scene}=harness(),before=JSON.stringify(scene.engine.board);
    scene.sys.isActive=()=>false;scene.paint=()=>{throw Error('미준비 Scene 그리기');};
    expect(scene.shuffle()).toBe(false);expect(JSON.stringify(scene.engine.board)).toBe(before);
  });
  it('두 겹은 겹잎·2, 한 겹은 작은 한 장·1을 표시하고 이전 바닥 객체만 정리합니다',()=>{
    const {scene}=harness();scene.paint(scene.engine.board);const pieces=scene.pieces.map(row=>row.slice());
    scene.engine.setLeaves([{row:3,col:3,layers:2}]);scene.paintLeaves(scene.engine.leaves);
    const previous=scene.leafObjects.slice(),badge=previous.find(p=>p instanceof Piece&&p.texture==='leaf-pile') as Piece;
    expect(badge.width).toBe(31);expect(previous.some(p=>p instanceof Piece&&p.text==='2')).toBe(true);
    scene.engine.leaves[3][3]=1;scene.paintLeaves(scene.engine.leaves);
    expect(previous.every(p=>p.destroyed)).toBe(true);
    const single=scene.leafObjects.find(p=>p instanceof Piece&&p.texture==='leaf-single') as Piece;
    expect(single.width).toBe(24);expect(scene.leafObjects.some(p=>p instanceof Piece&&p.text==='1')).toBe(true);
    expect(scene.pieces).toEqual(pieces);expect(pieces.flat().every(p=>!p.destroyed)).toBe(true);
  });
  it('낙엽은 각 연쇄의 이전·이후 상태를 표시하고 완료 수를 한 번 전달합니다',async()=>{
    const {scene,onMove}=harness();scene.engine.board[3][3].special='row';
    scene.engine.setLeaves([{row:3,col:5,layers:2}]);scene.paint(scene.engine.board);
    const snapshots:number[][][]=[],paint=scene.paintLeaves.bind(scene);
    scene.paintLeaves=leaves=>{snapshots.push(leaves.map(row=>row.slice()));paint(leaves);};
    await scene.attempt({row:3,col:3});
    expect(snapshots[0][3][5]).toBe(2);expect(snapshots.at(-1)![3][5]).toBe(0);
    expect(onMove).toHaveBeenCalledOnce();expect(onMove.mock.calls[0][3]).toBe(1);
  });
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
  it('실제 제거 칸·줄 방향을 먼저 표시하고 중복 입력을 막은 뒤 표시 객체를 정리합니다',async()=>{
    const {scene,onMove,onNotice}=harness();scene.engine.board[3][3].special='row';scene.paint(scene.engine.board);
    const overlays:Graphic[]=[],showEffect=scene.showEffect.bind(scene);
    scene.showEffect=step=>{
      const overlay=showEffect(step);overlays.push(overlay);
      expect(overlay.rectangles.map(rect=>rect.slice(0,2))).toEqual(step.removed.map(p=>[18+p.col*56,18+p.row*56]));
      expect(overlay.lines).toContainEqual([16,212,464,212]);
      return overlay;
    };
    const first=scene.attempt({row:3,col:3});
    await scene.attempt({row:3,col:3});await first;
    expect(onMove).toHaveBeenCalledOnce();expect(onNotice.mock.calls[0]).toEqual(['rowClear']);
    expect(overlays).toHaveLength(1);expect(overlays.every(overlay=>overlay.destroyed)).toBe(true);
  });
});

describe('보드 키보드 입력과 읽기 상태',()=>{
  it('8×8 경계를 넘지 않으며 커서 조회와 선택·취소는 난수와 이동을 소비하지 않습니다',()=>{
    const {scene,onMove}=harness();scene.paint(scene.engine.board);
    const rng=vi.fn(seededRng(42));scene.engine=new BoardEngine(8,8,rng,snapshot(scene.engine));rng.mockClear();
    const before=snapshot(scene.engine);scene.focusKeyboard();
    scene.keyboardKey('ArrowUp');scene.keyboardKey('ArrowLeft');expect(scene.keyboardState().cursor).toEqual({row:0,col:0});
    for(let i=0;i<12;i++){scene.keyboardKey('ArrowDown',true);scene.keyboardKey('ArrowRight',true);}
    expect(scene.keyboardState().cursor).toEqual({row:7,col:7});
    scene.keyboardKey('Enter');expect(scene.keyboardState().selected).toEqual({row:7,col:7});
    scene.keyboardKey('Escape');expect(scene.keyboardState().selected).toBeUndefined();
    const state=scene.keyboardState();state.cursor!.row=0;state.tile!.kind=99;
    expect(scene.keyboardState().cursor).toEqual({row:7,col:7});expect(snapshot(scene.engine)).toEqual(before);
    expect(onMove).not.toHaveBeenCalled();expect(rng).not.toHaveBeenCalled();
  });
  it('Enter와 Space의 무효 교환은 기존 attempt를 사용하고 이동을 쓰지 않습니다',async()=>{
    const {scene,onMove}=harness();scene.paint(scene.engine.board);scene.focusKeyboard();
    const before=snapshot(scene.engine);const swap=vi.spyOn(scene.engine,'swap');
    scene.keyboardKey('Enter');scene.keyboardKey('ArrowRight');scene.keyboardKey(' ');
    await vi.waitFor(()=>expect(scene.busy).toBe(false));
    expect(swap).toHaveBeenCalledExactlyOnceWith({row:0,col:0},{row:0,col:1});expect(onMove).not.toHaveBeenCalled();expect(snapshot(scene.engine)).toEqual(before);
  });
  it('방향키로 인접 칸을 선택한 유효 교환은 결과를 한 번 전달합니다',async()=>{
    const {scene,onMove}=harness();for(const [r,c,k] of [[0,0,5],[0,1,5],[0,2,1],[1,2,5]])scene.engine.board[r][c]={kind:k};
    scene.paint(scene.engine.board);scene.focusKeyboard();scene.keyboardKey('ArrowRight');scene.keyboardKey('ArrowRight');
    scene.keyboardKey('Enter');scene.keyboardKey('ArrowDown');scene.keyboardKey(' ');
    await vi.waitFor(()=>expect(scene.busy).toBe(false));expect(onMove).toHaveBeenCalledOnce();expect(onMove.mock.calls[0][1]).toBeGreaterThan(0);
  });
  it.each(['Enter',' '])('특수 바로 사용 %s 뒤 연쇄 중 반복 입력·섞기는 거부합니다',async key=>{
    const {scene,onMove}=harness();scene.engine.board[0][0].special='row';scene.engine.setLeaves([{row:0,col:0,layers:2}]);scene.paint(scene.engine.board);
    scene.focusKeyboard();expect(scene.keyboardState()).toMatchObject({tile:{special:'row'},layers:2});
    expect(scene.keyboardKey(key,true)).toBe(true);expect(scene.busy).toBe(false);
    scene.keyboardKey(key);const before=snapshot(scene.engine);
    for(let i=0;i<20;i++){expect(scene.keyboardKey('ArrowDown',true)).toBe(false);expect(scene.keyboardKey(key,true)).toBe(false);expect(scene.shuffle()).toBe(false);}
    expect(scene.keyboardState().cursor).toEqual({row:0,col:0});expect(snapshot(scene.engine)).toEqual(before);
    await vi.waitFor(()=>expect(scene.busy).toBe(false));expect(onMove).toHaveBeenCalledOnce();
  });
  it('미준비·비활성·종료 상태는 선택·교환·섞기·커서 진입을 거부합니다',async()=>{
    const {scene,onMove}=harness();const before=snapshot(scene.engine);scene.focusKeyboard();expect(scene.keyboardState().cursor).toBeUndefined();
    await scene.attempt({row:0,col:0},{row:0,col:1});scene.tap({row:0,col:0});expect(scene.shuffle()).toBe(false);
    scene.paint(scene.engine.board);scene.sys.isActive=()=>false;scene.focusKeyboard();await scene.attempt({row:0,col:0},{row:0,col:1});scene.tap({row:0,col:0});expect(scene.shuffle()).toBe(false);
    scene.sys.isActive=()=>true;scene.focusKeyboard();scene.keyboardKey('Enter');scene.stopPlaying();
    expect(scene.keyboardState()).toMatchObject({available:false,finished:true,cursor:undefined,selected:undefined});expect(scene.keyboardKey(' ')).toBe(false);
    expect(snapshot(scene.engine)).toEqual(before);expect(onMove).not.toHaveBeenCalled();
  });
  it('선택과 커서를 정리하고 다시 초점이 들어오면 첫 칸에서 시작합니다',()=>{
    const {scene}=harness();scene.paint(scene.engine.board);scene.focusKeyboard();scene.keyboardKey('ArrowDown');scene.keyboardKey('Enter');scene.cancelInput();
    expect(scene.keyboardState()).toMatchObject({cursor:undefined,selected:undefined});scene.focusKeyboard();expect(scene.keyboardState().cursor).toEqual({row:0,col:0});
  });
});
