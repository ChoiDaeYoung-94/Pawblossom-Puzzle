import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type Phaser from 'phaser';
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
  destroyed=false;alpha=1;rectangles:number[][]=[];lines:number[][]=[];strokes:number[][]=[];
  fillStyle(){return this;}lineStyle(){return this;}setDepth(){return this;}
  fillRoundedRect(...values:number[]){this.rectangles.push(values);return this;}
  strokeRoundedRect(...values:number[]){this.strokes.push(values);return this;}fillCircle(){return this;}strokeCircle(){return this;}
  lineBetween(...values:number[]){this.lines.push(values);return this;}
  setName(){return this;}setPosition(){return this;}
  clear(){this.rectangles=[];this.lines=[];this.strokes=[];return this;}
  destroy(){this.destroyed=true;}
}
vi.mock('phaser',async()=>{
  const {default:Events}=await import('eventemitter3');
  return {default:{Scenes:{Events:{PAUSE:'pause',RESUME:'resume',SLEEP:'sleep',WAKE:'wake',SHUTDOWN:'shutdown',DESTROY:'destroy',CREATE:'create'}},Scale:{Events:{RESIZE:'resize'}},Scene:class {
    input=new Events();events=new Events();scale=new Events();cameras={main:{setBackgroundColor(){}}};
    sys={isActive:()=>true,isPaused:()=>false};
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
// 렌더링은 대역을 유지하되 예약/만료/제거는 설치된 Phaser 3.90 Clock 원본을 사용합니다.
const Clock=createRequire(import.meta.url)('phaser/src/time/Clock.js') as new(scene:unknown)=>Phaser.Time.Clock&{start():void};
interface RenderScene {
  sys:{isActive():boolean;isPaused():boolean};shuffle():boolean;resumeAfterFailure():boolean;
  pieces:Piece[][];engine:BoardEngine;
  paint(board:Tile[][]):void;drop(step:ResolveStep):void;
  attempt(a:Position,b?:Position):Promise<void>;tap(p:Position):void;resetHint():void;
  showEffect(step:ResolveStep):Graphic;
  paintLeaves(leaves:number[][]):void;
  leafObjects:(Piece|Graphic)[];
  busy:boolean;finished:boolean;
  keyboardState:BoardScene['keyboardState'];focusKeyboard:BoardScene['focusKeyboard'];keyboardKey:BoardScene['keyboardKey'];cancelInput:BoardScene['cancelInput'];stopPlaying:BoardScene['stopPlaying'];
  create():void;down?:unknown;input:{emit(event:string,pointer?:unknown):void;listenerCount(event:string):number};events:{emit(event:string):void;listenerCount(event:string):number};scale:{emit(event:string):void;listenerCount(event:string):number};
  showHint():void;selectionMark?:Graphic;hintMark?:Graphic;cursorMark?:Graphic;hintPieces:Piece[];
  tweens:{add(config:Record<string,unknown>):void;killTweensOf(target:unknown):void};wait(ms:number):Promise<void>;
}

describe.each([false,true])('보드 모션 감소=%s',reduced=>{
beforeEach(()=>vi.stubGlobal('window',{matchMedia:()=>({matches:reduced})}));
afterEach(()=>vi.unstubAllGlobals());

describe('보드 포인터 종료 (Phaser 입력 대역)',()=>{
  const pointer=(overrides:Record<string,unknown>={})=>({id:1,x:44,y:44,downTime:1,wasTouch:true,wasCanceled:false,event:{touches:[{}]},...overrides});
  const create=()=>{const h=harness();h.scene.create();return h;};
  it.each([false,true])('취소된 일반/특수 탭은 보드·선택·결과를 바꾸지 않고 다음 입력은 회복합니다 (%s)',async special=>{
    const {scene,onMove}=create();if(special)scene.engine.board[0][0].special='row';
    const before=snapshot(scene.engine);scene.input.emit('pointerdown',pointer());scene.input.emit('pointerup',pointer({wasCanceled:true}));
    expect(snapshot(scene.engine)).toEqual(before);expect(scene.keyboardState().selected).toBeUndefined();expect(onMove).not.toHaveBeenCalled();expect(scene.down).toBeUndefined();
    scene.input.emit('pointerdown',pointer({downTime:2}));scene.input.emit('pointerup',pointer({downTime:2}));
    if(special){await vi.waitFor(()=>expect(scene.busy).toBe(false));expect(onMove).toHaveBeenCalledOnce();}else expect(scene.keyboardState().selected).toEqual({row:0,col:0});
  });
  it('보조 포인터·보조 마우스 종료는 주체를 빼앗지 않으며 동시 시작은 거부합니다',()=>{
    const {scene}=create();scene.input.emit('pointerdown',pointer({event:{touches:[{},{}]}}));expect(scene.down).toBeUndefined();
    const mouse=pointer({id:0,wasTouch:false,button:0});scene.input.emit('pointerdown',mouse);
    scene.input.emit('pointerdown',pointer({id:2}));scene.input.emit('pointerup',pointer({id:2,wasCanceled:true}));
    scene.input.emit('pointerup',pointer({id:0,wasTouch:false,button:2}));expect(scene.down).toBeDefined();
    scene.input.emit('pointerup',mouse);expect(scene.keyboardState().selected).toEqual({row:0,col:0});scene.cancelInput();
    scene.input.emit('pointerdown',pointer({wasTouch:false,button:2}));scene.input.emit('pointerup',pointer({wasTouch:false,button:2}));expect(scene.keyboardState().selected).toBeUndefined();
  });
  it('기존 선택 뒤 touchcancel은 선택을 유지하고 밖 종료·일시정지·섞기는 표시까지 정리합니다',()=>{
    const {scene}=create();scene.tap({row:0,col:0});
    scene.input.emit('pointerdown',pointer({x:100}));scene.input.emit('pointerup',pointer({x:100,wasCanceled:true}));
    expect(scene.keyboardState().selected).toEqual({row:0,col:0});
    expect((scene.selectionMark?.strokes.length??0)>0).toBe(reduced);
    for(const action of ['outside','pause','shuffle']){
      scene.tap({row:0,col:0});scene.input.emit('pointerdown',pointer({x:100}));
      if(action==='outside')scene.input.emit('pointerupoutside',pointer({x:100}));
      else if(action==='pause')scene.events.emit('pause');else scene.shuffle();
      expect(scene.keyboardState().selected).toBeUndefined();expect(scene.selectionMark?.strokes??[]).toEqual([]);
      expect(scene.pieces.flat().every(p=>p.scale===1)).toBe(true);
    }
  });
  it.each(['취소','비활성','busy','재사용','보드 밖'])('본인 종료는 실행 불가 상태에도 down을 비웁니다: %s',reason=>{
    const {scene,onMove}=create();scene.input.emit('pointerdown',pointer());
    if(reason==='비활성')scene.sys.isActive=()=>false;if(reason==='busy')scene.busy=true;
    scene.input.emit('pointerup',pointer({wasCanceled:reason==='취소',downTime:reason==='재사용'?2:1,x:reason==='보드 밖'?3:44}));
    expect(scene.down).toBeUndefined();expect(scene.keyboardState().selected).toBeUndefined();expect(onMove).not.toHaveBeenCalled();
    scene.busy=false;scene.sys.isActive=()=>true;scene.input.emit('pointerdown',pointer({downTime:3}));scene.input.emit('pointerup',pointer({downTime:3}));expect(scene.keyboardState().selected).toBeDefined();
  });
  it.each(['pause','resume','sleep','wake','shutdown','destroy','gameout','pointerupoutside','resize'])('수명 경계 %s 뒤 늦은 up은 실행하지 않습니다',event=>{
    const {scene,onMove}=create();scene.focusKeyboard();scene.keyboardKey('Enter');scene.input.emit('pointerdown',pointer());
    if(['gameout','pointerupoutside'].includes(event))scene.input.emit(event,pointer());else if(event==='resize')scene.scale.emit(event);else scene.events.emit(event);
    scene.input.emit('pointerup',pointer({y:100}));expect(scene.down).toBeUndefined();expect(scene.keyboardState()).toMatchObject({cursor:undefined,selected:undefined});expect(onMove).not.toHaveBeenCalled();
    if(event==='shutdown'||event==='destroy'){
      for(const name of ['pointerdown','pointerup','pointerupoutside','gameout'])expect(scene.input.listenerCount(name)).toBe(0);
      for(const name of ['pause','resume','sleep','wake','shutdown','destroy'])expect(scene.events.listenerCount(name)).toBe(0);
      expect(scene.scale.listenerCount('resize')).toBe(0);
    }
  });
  it.each([[0,56], [0,-56], [56,0], [-56,0]])('정상 스와이프 방향 %s/%s는 인접 교환 한 번을 실행합니다',async(dx,dy)=>{
    const {scene}=create();const swap=vi.spyOn(scene.engine,'swap');
    scene.input.emit('pointerdown',pointer({x:212,y:212}));scene.input.emit('pointerup',pointer({x:212+dx,y:212+dy}));
    await vi.waitFor(()=>expect(scene.busy).toBe(false));expect(swap).toHaveBeenCalledExactlyOnceWith({row:3,col:3},{row:3+Math.sign(dy),col:3+Math.sign(dx)});
  });
  it('두 칸 탭 특수 교환은 한 번만 실행합니다',async()=>{
    const {scene,onMove}=create();scene.engine.board[0][1].special='row';const swap=vi.spyOn(scene.engine,'swap');
    for(const x of [44,100]){scene.input.emit('pointerdown',pointer({x}));scene.input.emit('pointerup',pointer({x}));}
    await vi.waitFor(()=>expect(scene.busy).toBe(false));expect(swap).toHaveBeenCalledExactlyOnceWith({row:0,col:0},{row:0,col:1});expect(onMove).toHaveBeenCalledOnce();
  });
  it('무료 섞기 뒤 오래된 down/up은 새 보드를 실행하지 않으며 새 입력은 회복합니다',()=>{
    const {scene,onMove}=create();scene.input.emit('pointerdown',pointer());expect(scene.shuffle()).toBe(true);const after=snapshot(scene.engine);
    scene.input.emit('pointerup',pointer({y:100}));expect(snapshot(scene.engine)).toEqual(after);expect(scene.keyboardState().selected).toBeUndefined();expect(onMove).not.toHaveBeenCalled();
    scene.input.emit('pointerdown',pointer({downTime:2}));scene.input.emit('pointerup',pointer({downTime:2}));expect(scene.keyboardState().selected).toEqual({row:0,col:0});
  });
  it.each(['ArrowRight','Enter',' ','Escape'])('키보드 %s는 이전 포인터를 무효화하고 키보드 상태를 유지합니다',key=>{
    const {scene}=create();scene.focusKeyboard();scene.input.emit('pointerdown',pointer({x:212,y:212}));scene.keyboardKey(key);const state=scene.keyboardState();
    expect(scene.down).toBeUndefined();scene.input.emit('pointerup',pointer({x:268,y:212}));expect(scene.keyboardState()).toEqual(state);
  });
  it('포인터 제스처 없는 gameout/resize는 키보드 커서와 선택을 지우지 않습니다',()=>{
    const {scene}=create();scene.focusKeyboard();scene.keyboardKey('Enter');const state=scene.keyboardState();
    scene.input.emit('gameout',pointer());scene.scale.emit('resize');expect(scene.keyboardState()).toEqual(state);
  });
});
const snapshot=(engine:BoardEngine)=>({board:engine.board.map(row=>row.map(tile=>({...tile}))),leaves:engine.leaves.map(row=>row.slice())});
function harness(){
  const onMove=vi.fn(),onNotice=vi.fn();
  const scene=new BoardScene({audio:{play(){}} as never,onStart(){},onMove,onNotice}) as unknown as RenderScene;
  scene.engine=new BoardEngine(8,8,seededRng(42));
  scene.engine.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));
  scene.resetHint=()=>{};
  return {scene,onMove,onNotice};
}

describe('유휴 힌트 (실제 Phaser Clock)',()=>{
  function timed(){
    const h=harness(),scene=h.scene as RenderScene&{time:Phaser.Time.Clock;hintTimer?:Phaser.Time.TimerEvent;ready:boolean;hooks:{onReady?:()=>void}};
    delete (scene as Partial<RenderScene>).resetHint;
    let active=false,paused=false,now=0;
    Object.assign(scene.sys,{events:scene.events,game:{loop:{time:0}},isActive:()=>active,isPaused:()=>paused});
    const clock=scene.time=new Clock(scene);scene.events.emit('boot');clock.start();
    for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])scene.engine.board[r][c]={kind:k};
    const transition=(event:string)=>{active=['create','resume','wake'].includes(event);paused=event==='pause';scene.events.emit(event);};
    const advance=(ms:number)=>{if(active){clock.preUpdate(now,ms);clock.update(now+=ms,ms);}};
    const start=()=>{scene.create();transition('create');};
    const live=()=>{
      const queues=clock as unknown as {_active:Phaser.Time.TimerEvent[];_pendingInsertion:Phaser.Time.TimerEvent[]};
      return [...queues._active,...queues._pendingInsertion].filter(timer=>!timer.hasDispatched).length;
    };
    const shown=()=>reduced?(scene.hintMark?.strokes.length??0)>0:scene.hintPieces.length===2;
    return {...h,scene,clock,transition,advance,start,live,shown};
  }
  it('CREATE 전에는 예약하지 않고 RUNNING 뒤 처음 7.5초에 표시합니다',()=>{
    const h=timed();h.scene.create();expect(h.live()).toBe(0);h.scene.resetHint();expect(h.live()).toBe(0);
    h.transition('create');expect(h.live()).toBe(1);h.advance(7499);expect(h.shown()).toBe(false);
    h.advance(1);expect(h.shown()).toBe(true);expect(h.live()).toBe(1);
  });
  it('onReady에서 pause하면 예약하지 않고 resume 뒤 7.5초를 기다립니다',()=>{
    const h=timed();h.scene.hooks.onReady=()=>h.transition('pause');h.start();
    expect(h.live()).toBe(0);h.advance(20000);expect(h.shown()).toBe(false);
    h.transition('resume');h.advance(7499);expect(h.shown()).toBe(false);h.advance(1);expect(h.shown()).toBe(true);
  });
  it.each(['Escape','cancelInput'])('선택 중 만료한 뒤 %s 해제부터 새 7.5초를 기다립니다',action=>{
    const h=timed();h.start();h.scene.focusKeyboard();h.scene.keyboardKey('Enter');
    h.advance(7500);expect(h.shown()).toBe(false);expect(h.live()).toBe(0);
    if(action==='Escape')h.scene.keyboardKey('Escape');else h.scene.cancelInput();
    expect(h.scene.keyboardState().selected).toBeUndefined();expect(h.live()).toBe(1);
    h.advance(7499);expect(h.shown()).toBe(false);h.advance(1);expect(h.shown()).toBe(true);expect(h.live()).toBe(1);
  });
  it.each([['pause','resume'],['sleep','wake']])('%s에서 남은 시간을 취소하고 %s부터 다시 셉니다',(away,back)=>{
    const h=timed();h.start();h.advance(7000);h.transition(away);expect(h.live()).toBe(0);
    h.advance(30000);expect(h.shown()).toBe(false);h.transition(back);expect(h.live()).toBe(1);
    h.advance(7499);expect(h.shown()).toBe(false);h.advance(1);expect(h.shown()).toBe(true);
  });
  it('입력 취소·섞기 반복 뒤 유효 예약은 하나이며 이전 콜백은 새 표시를 지우지 않습니다',()=>{
    const h=timed();h.start();const old=h.scene.hintTimer!.callback!;
    for(let i=0;i<5;i++){h.scene.cancelInput();h.scene.shuffle();expect(h.live()).toBe(1);}
    h.advance(7500);expect(h.shown()).toBe(true);const timer=h.scene.hintTimer;
    old();expect(h.shown()).toBe(true);expect(h.scene.hintTimer).toBe(timer);expect(h.live()).toBe(1);
    h.advance(7500);expect(h.shown()).toBe(true);expect(h.live()).toBe(1);
  });
  it.each([false,true])('교환 valid=%s 완료 뒤 7.5초 힌트가 복구됩니다',async valid=>{
    const h=timed();h.start();vi.spyOn(h.scene,'wait').mockResolvedValue();
    await h.scene.attempt(valid?{row:4,col:2}:{row:0,col:0},valid?{row:3,col:2}:{row:0,col:1});
    expect(h.onMove).toHaveBeenCalledTimes(valid?1:0);expect(h.live()).toBe(1);
    h.advance(7499);expect(h.shown()).toBe(false);h.advance(1);expect(h.shown()).toBe(true);
  });
  it.each(['busy','finished','unready','pause','sleep','shutdown','destroy'])('만료 직전 %s 상태에서는 엔진·효과·블록을 읽지 않습니다',reason=>{
    const h=timed();h.start();const old=h.scene.hintTimer!.callback!;
    if(reason==='busy')h.scene.busy=true;else if(reason==='finished')h.scene.stopPlaying();else if(reason==='unready')h.scene.ready=false;else h.transition(reason);
    const moves=vi.spyOn(h.scene.engine,'legalMoves').mockImplementation(()=>{throw Error('비활성 엔진 접근');});
    Object.defineProperty(h.scene,'pieces',{get(){throw Error('비활성 블록 접근');}});
    Object.defineProperty(h.scene,'effects',{get(){throw Error('비활성 효과 접근');}});
    expect(()=>old()).not.toThrow();expect(()=>h.advance(7500)).not.toThrow();expect(moves).not.toHaveBeenCalled();
  });
  it('실패 복귀가 paused 상태이면 resume까지 예약하지 않습니다',()=>{
    const h=timed();h.start();h.scene.stopPlaying();h.transition('pause');
    expect(h.scene.resumeAfterFailure()).toBe(true);expect(h.live()).toBe(0);
    h.transition('resume');expect(h.live()).toBe(1);h.advance(7500);expect(h.shown()).toBe(true);
  });
  it.each(['shutdown','destroy'])('CREATE 이전 %s도 ready 콜백과 입력 리스너를 정리합니다',event=>{
    const h=timed();h.scene.create();const ready=vi.fn();h.scene.hooks.onReady=ready;h.transition(event);
    for(const name of ['create','pause','resume','sleep','wake','shutdown','destroy'])expect(h.scene.events.listenerCount(name)).toBe(event==='shutdown'&&name==='destroy'?1:0);
    h.transition('create');expect(ready).not.toHaveBeenCalled();expect(h.scene.ready).toBe(false);expect(h.live()).toBe(0);
  });
  it('shutdown/restart 뒤 이전 콜백을 불러도 현재 예약·표시·리스너를 보존합니다',()=>{
    const h=timed();h.start();const old=h.scene.hintTimer!.callback!;
    h.transition('shutdown');expect(h.live()).toBe(0);h.clock.start();h.start();old();
    expect(h.live()).toBe(1);expect(h.shown()).toBe(false);h.advance(7500);expect(h.shown()).toBe(true);
    const timer=h.scene.hintTimer;old();expect(h.scene.hintTimer).toBe(timer);expect(h.shown()).toBe(true);
    for(const name of ['pause','resume','sleep','wake'])expect(h.scene.events.listenerCount(name)).toBe(1);
    expect(h.scene.input.listenerCount('pointerdown')).toBe(1);expect(h.scene.events.listenerCount('create')).toBe(0);
    h.transition('shutdown');expect(h.live()).toBe(0);expect(h.scene.input.listenerCount('pointerdown')).toBe(0);
  });
});
describe('블록 객체 보존과 낙하 연출',()=>{
  it.each([false,true])('실패 복귀는 살아 있는 paused=%s 보드·엔진·낙엽·컨테이너를 그대로 유지합니다',paused=>{
    const {scene,onMove}=harness();scene.engine.setLeaves([{row:2,col:3,layers:2}]);
    scene.create();scene.events.emit('create');scene.focusKeyboard();scene.keyboardKey('Enter');scene.stopPlaying();
    scene.sys.isActive=()=>!paused;scene.sys.isPaused=()=>paused;
    const engine=scene.engine,pieces=scene.pieces,leaves=scene.leafObjects,items=scene.pieces.flat(),before=snapshot(engine);
    const hint=vi.spyOn(scene,'resetHint');
    expect(scene.resumeAfterFailure()).toBe(true);expect(scene.engine).toBe(engine);expect(scene.pieces).toBe(pieces);
    expect(scene.leafObjects).toBe(leaves);expect(scene.pieces.flat()).toEqual(items);expect(items.every(item=>!item.destroyed)).toBe(true);
    expect(snapshot(engine)).toEqual(before);expect(scene.keyboardState()).toMatchObject({finished:false,available:!paused,cursor:undefined,selected:undefined});
    expect(hint).toHaveBeenCalledOnce();expect(onMove).not.toHaveBeenCalled();expect(scene.resumeAfterFailure()).toBe(false);
    scene.sys.isActive=()=>true;scene.sys.isPaused=()=>false;scene.focusKeyboard();scene.keyboardKey('Enter');
    expect(scene.keyboardState().selected).toEqual({row:0,col:0});
  });
  it.each(['unready','busy','sleep','shutdown','destroy','missing-row','missing-piece','not-finished'])('복귀 불가 상태 %s는 종료 상태와 기존 객체를 바꾸지 않습니다',reason=>{
    const {scene}=harness();scene.create();if(reason!=='unready')scene.events.emit('create');
    scene.stopPlaying();
    if(reason==='busy')scene.busy=true;
    if(reason==='sleep'){scene.sys.isActive=()=>false;scene.sys.isPaused=()=>false;}
    if(reason==='shutdown'||reason==='destroy')scene.events.emit(reason);
    if(reason==='missing-row')scene.pieces.pop();if(reason==='missing-piece')scene.pieces[0].pop();
    if(reason==='not-finished')scene.finished=false;
    const pieces=scene.pieces,before=snapshot(scene.engine),finished=scene.finished,hint=vi.spyOn(scene,'resetHint');
    expect(scene.resumeAfterFailure()).toBe(false);expect(scene.finished).toBe(finished);expect(scene.pieces).toBe(pieces);
    expect(snapshot(scene.engine)).toEqual(before);expect(hint).not.toHaveBeenCalled();
  });
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

describe('모션 설정 경계와 정적 표시',()=>{
  it('선택·힌트·무효/유효 교환·낙하는 설정에 맞고 단계 대기·결과·오디오는 같습니다',async()=>{
    const {scene,onMove}=harness();for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])scene.engine.board[r][c]={kind:k};scene.create();scene.events.emit('create');
    const tweens=vi.spyOn(scene.tweens,'add'),wait=vi.spyOn(scene,'wait').mockResolvedValue();
    scene.showHint();
    if(reduced){expect(scene.hintMark?.strokes).toHaveLength(2);expect(scene.hintMark?.lines).toHaveLength(3);}
    else expect(tweens.mock.calls.some(([c])=>c.scale===1.1&&c.repeat===1)).toBe(true);
    scene.cancelInput();expect(scene.hintPieces).toEqual([]);expect(scene.hintMark?.strokes??[]).toEqual([]);
    tweens.mockClear();scene.tap({row:0,col:0});
    expect(scene.pieces[0][0].scale).toBe(reduced?1:1.12);
    if(reduced){expect(scene.selectionMark?.strokes).toHaveLength(2);expect(scene.selectionMark?.lines).toHaveLength(2);}
    scene.focusKeyboard();expect(scene.cursorMark?.lines).toHaveLength(8);
    await scene.attempt({row:0,col:0},{row:0,col:1});
    expect(wait.mock.calls.map(c=>c[0])).toEqual([140,150]);expect(onMove).not.toHaveBeenCalled();
    expect(scene.pieces[0][0]).toMatchObject({x:44,y:44,scale:1});expect(scene.selectionMark?.strokes??[]).toEqual([]);
    wait.mockClear();tweens.mockClear();
    for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])scene.engine.board[r][c]={kind:k};
    scene.paint(scene.engine.board);await scene.attempt({row:4,col:2},{row:3,col:2});
    expect(onMove).toHaveBeenCalledOnce();expect(wait.mock.calls.map(c=>c[0])).toContain(200);expect(wait.mock.calls.map(c=>c[0])).toContain(300);
    if(reduced)expect(tweens.mock.calls.every(([c])=>['x','y','scale','scaleX','scaleY','angle'].every(key=>c[key]===undefined))).toBe(true);
    else {expect(tweens.mock.calls.some(([c])=>c.duration===280&&c.y!==undefined)).toBe(true);expect(tweens.mock.calls.some(([c])=>c.scale===.25)).toBe(true);}
  });
  it('현재 보드에서 설정 반전은 다음 포인터/키/힌트부터 이전 확대와 정적 표시를 정리합니다',()=>{
    const {scene}=harness();for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])scene.engine.board[r][c]={kind:k};scene.create();scene.events.emit('create');scene.showHint();scene.tap({row:0,col:0});
    vi.stubGlobal('window',{matchMedia:()=>({matches:!reduced})});scene.focusKeyboard();
    expect(scene.pieces[0][0].scale).toBe(reduced?1.12:1);expect(scene.pieces[0][0].y).toBe(44);
    expect(scene.hintMark?.strokes??[]).toEqual([]);expect(scene.hintPieces).toEqual([]);
    if(!reduced)expect(scene.selectionMark?.lines).toHaveLength(2);
    else expect(scene.selectionMark?.strokes??[]).toEqual([]);
    scene.cancelInput();expect(scene.pieces[0][0]).toMatchObject({scale:1,y:44});
    scene.showHint();scene.events.emit('pause');expect(scene.hintMark?.strokes??[]).toEqual([]);
    scene.events.emit('resume');scene.showHint();scene.shuffle();expect(scene.hintMark?.strokes??[]).toEqual([]);
    scene.showHint();scene.events.emit('shutdown');expect(scene.hintMark).toBeUndefined();expect(scene.selectionMark).toBeUndefined();
    scene.create();expect(scene.keyboardState().available).toBe(true);expect(scene.keyboardState().selected).toBeUndefined();
  });
  it('같은 엔진 시드의 유효 교환은 두 모드에서 판정·난수·결과·음형·대기 순서가 같습니다',async()=>{
    const run=async(value:boolean)=>{
      vi.stubGlobal('window',{matchMedia:()=>({matches:value})});const h=harness();h.scene.paint(h.scene.engine.board);
      for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])h.scene.engine.board[r][c]={kind:k};
      const wait=vi.spyOn(h.scene,'wait').mockResolvedValue();const audio=vi.fn();
      (h.scene as unknown as {hooks:{audio:{play:typeof audio}}}).hooks.audio.play=audio;
      await h.scene.attempt({row:4,col:2},{row:3,col:2});
      return {board:snapshot(h.scene.engine),move:h.onMove.mock.calls,notice:h.onNotice.mock.calls,audio:audio.mock.calls,wait:wait.mock.calls};
    };
    expect(await run(true)).toEqual(await run(false));
  });
  it('진행 중 설정 변경은 시작한 교환을 유지하고 다음 제거/낙하부터 읽습니다',async()=>{
    vi.stubGlobal('window',{matchMedia:()=>({matches:false})});const {scene,onMove}=harness();
    for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])scene.engine.board[r][c]={kind:k};scene.paint(scene.engine.board);
    const tweens=vi.spyOn(scene.tweens,'add');let boundary=0;
    vi.spyOn(scene,'wait').mockImplementation(async ms=>{if(ms===140){boundary=tweens.mock.calls.length;vi.stubGlobal('window',{matchMedia:()=>({matches:true})});}});
    await scene.attempt({row:4,col:2},{row:3,col:2});expect(onMove).toHaveBeenCalledOnce();
    expect(tweens.mock.calls.slice(0,boundary).some(([c])=>c.duration===130&&c.y!==undefined)).toBe(true);
    expect(tweens.mock.calls.slice(boundary).every(([c])=>['x','y','scale','angle'].every(k=>c[k]===undefined))).toBe(true);
    expect(scene.pieces.flat().every(p=>p.scale===1&&p.alpha===1)).toBe(true);
  });
});
});
