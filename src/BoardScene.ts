import Phaser from 'phaser';
import { BoardEngine, type Position, type Tile, type Cell, type BoardMask, type ResolveStep, type LeafPile, type BoardSnapshot } from './core';
import type { AudioManager } from './audio/AudioManager';
import { BoardEffects } from './BoardEffects';
import { reducedMotion } from './reducedMotion';
import type { ResolveVisual } from './RoundFeedback';

export const tileNames = ['strawberry','carrot','blueberry','acorn','leaf','flower'];
type Notice='matched'|'chain'|'specialCreated'|'noMoves'|'rowClear'|'columnClear'|'bombClear'|'colorClear'|'comboClear'|'leafThinned'|'leavesCleared'|'cratesCleared';
interface Hooks { audio: AudioManager; onStart:()=>void; onReady?:()=>void; onBoardState?:()=>void; onResolveVisual?:(event:ResolveVisual)=>void; onVisualCancel?:()=>void; onMove:(collected:number[],score:number,chains:number,leavesCleared:number,cratesCleared?:number)=>void; onNotice:(kind:Notice)=>void; }
const CELL = 56, PAD = 16;
export class BoardScene extends Phaser.Scene {
  engine: BoardEngine;
  private pieces: (Phaser.GameObjects.Container|null)[][] = [];
  private selected?: Position;
  private down?: {pos:Position,x:number,y:number,pointerId:number,downTime:number};
  private busy = false;
  private finished = false;
  private ready = false;
  private hooks: Hooks;
  private hintTimer?: Phaser.Time.TimerEvent;
  private leafObjects:(Phaser.GameObjects.Graphics|Phaser.GameObjects.Image|Phaser.GameObjects.Text)[]=[];
  private crateObjects:Phaser.GameObjects.Image[]=[];
  private effects:BoardEffects;
  private cursor?:Position;
  private cursorMark?:Phaser.GameObjects.Graphics;
  private selectionMark?:Phaser.GameObjects.Graphics;
  private hintMark?:Phaser.GameObjects.Graphics;
  private hintPieces:Phaser.GameObjects.Container[]=[];
  private motionReduced=reducedMotion();
  constructor(hooks: Hooks, snapshot?:BoardSnapshot, mask?:BoardMask, crates?:readonly Position[]) {super('Board');this.hooks=hooks;this.engine=new BoardEngine(8,8,Math.random,snapshot,undefined,mask,crates);this.effects=new BoardEffects(this);}
  configureLeaves(piles:LeafPile[]){this.engine.setLeaves(piles);}
  preload() {
    for(const name of tileNames)if(!this.textures.exists(name))this.load.svg(name,`/assets/tiles-v2/${name}.svg`,{width:100,height:100});
    for(const name of ['leaf-pile','leaf-single','wooden-crate'])if(!this.textures.exists(name))this.load.svg(name,`/assets/obstacles/${name}.svg`,{width:100,height:100});
  }
  create() {
    this.ready=false;this.finished=false;this.busy=false;this.motionReduced=reducedMotion();
    this.effects.clear();this.effects=new BoardEffects(this);
    this.cameras.main.setBackgroundColor('#dae6d7');
    const g=this.add.graphics();
    g.fillStyle(0xb9cdb5,1);g.fillRoundedRect(6,6,468,468,24);
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      if(!this.engine.isActive({row:r,col:c}))continue;
      g.fillStyle((r+c)%2?0xe7eee0:0xf1f3e7,1);g.fillRoundedRect(PAD+c*CELL+2,PAD+r*CELL+2,52,52,11);
    }
    this.paint(this.engine.board);
    this.paintLeaves(this.engine.leaves);
    this.paintCrates(this.engine.crates);
    this.input.on('pointerdown',this.pointerDown,this);
    this.input.on('pointerup',this.pointerUp,this);
    this.input.on('pointerupoutside',this.pointerOutside,this);
    const cancelGesture=()=>{this.cancelInput();this.hooks.onVisualCancel?.();};
    const cancelPointer=()=>{if(this.down)this.cancelInput();};
    const cancelResize=()=>{cancelPointer();this.hooks.onVisualCancel?.();};
    this.input.on('gameout',cancelPointer);
    this.scale.on(Phaser.Scale.Events.RESIZE,cancelResize);
    this.events.on(Phaser.Scenes.Events.PAUSE,cancelGesture);
    this.events.on(Phaser.Scenes.Events.RESUME,cancelGesture);
    this.events.on(Phaser.Scenes.Events.SLEEP,cancelGesture);
    this.events.on(Phaser.Scenes.Events.WAKE,cancelGesture);
    const onCreate=()=>{this.ready=true;this.hooks.onReady?.();this.resetHint();this.changed();};
    const dispose=()=>{
      this.input.off('pointerdown',this.pointerDown,this);this.input.off('pointerup',this.pointerUp,this);
      this.input.off('pointerupoutside',this.pointerOutside,this);this.input.off('gameout',cancelPointer);
      this.scale.off(Phaser.Scale.Events.RESIZE,cancelResize);
      for(const event of [Phaser.Scenes.Events.PAUSE,Phaser.Scenes.Events.RESUME,Phaser.Scenes.Events.SLEEP,Phaser.Scenes.Events.WAKE])this.events.off(event,cancelGesture);
      this.events.off(Phaser.Scenes.Events.SHUTDOWN,dispose);this.events.off(Phaser.Scenes.Events.DESTROY,dispose);
      this.events.off(Phaser.Scenes.Events.CREATE,onCreate);
      this.ready=false;this.stopPlaying();this.effects?.clear();this.cursorMark=undefined;this.selectionMark=undefined;this.hintMark=undefined;this.pieces=[];this.leafObjects=[];this.crateObjects=[];
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,dispose);
    this.events.once(Phaser.Scenes.Events.DESTROY,dispose);
    // CREATE는 에셋 로딩과 create()가 끝나고 Scene이 RUNNING이 된 뒤 발생합니다.
    this.events.once(Phaser.Scenes.Events.CREATE,onCreate);
  }
  private pointerDown(p:Phaser.Input.Pointer){
    if(!this.canInteract()||this.down||(!p.wasTouch&&p.button!==0))return;
    this.syncMotion();
    // TouchEvent에는 isPrimary가 없습니다. 이미 다른 손가락이 내려간 뒤의 새 제스처는 받지 않습니다.
    if(p.wasTouch&&(p.event as TouchEvent).touches.length!==1)return;
    const pos=this.position(p.x,p.y);if(pos)this.down={pos,x:p.x,y:p.y,pointerId:p.id,downTime:p.downTime};
  }
  private pointerOutside(p:Phaser.Input.Pointer){
    if(this.down?.pointerId===p.id&&(p.wasTouch||p.button===0))this.cancelInput();
  }
  private pointerUp(p:Phaser.Input.Pointer){
    if(!this.down||this.down.pointerId!==p.id||(!p.wasTouch&&p.button!==0))return;
    const d=this.down;this.down=undefined;
    // Phaser 3.90은 touchcancel도 pointerup으로 전달합니다. 비활성/취소 종료도 down부터 비웁니다.
    if(p.wasCanceled||p.downTime!==d.downTime||!this.canInteract()||!this.position(p.x,p.y))return;
    const dx=p.x-d.x,dy=p.y-d.y;
    if(Math.hypot(dx,dy)>16){
      const to={row:d.pos.row+(Math.abs(dy)>Math.abs(dx)?Math.sign(dy):0),col:d.pos.col+(Math.abs(dx)>=Math.abs(dy)?Math.sign(dx):0)};
      if(to.row>=0&&to.row<8&&to.col>=0&&to.col<8)void this.attempt(d.pos,to);
    }else this.tap(d.pos);
  }
  private canInteract(){return !this.busy&&!this.finished&&this.pieces.length===this.engine.rows&&this.sys.isActive();}
  /** 조회는 엔진 판정/난수/이동을 소비하지 않습니다. */
  keyboardState(){
    const pos=this.cursor,tile=pos?this.engine.board[pos.row][pos.col]:undefined;
    return {available:this.canInteract(),busy:this.busy,finished:this.finished,cursor:pos?{...pos}:undefined,
      tile:tile?{...tile}:undefined,layers:pos?this.engine.leaves[pos.row][pos.col]:0,...(this.engine.hasCrates?{crate:Boolean(pos&&this.engine.crates[pos.row][pos.col])}:{}),selected:this.selected?{...this.selected}:undefined};
  }
  private changed(){this.hooks.onBoardState?.();}
  focusKeyboard(){if(!this.canInteract())return;this.syncMotion();this.cursor??=this.engine.mask.flatMap((line,row)=>line.flatMap((active,col)=>active?[{row,col}]:[]))[0];this.drawCursor();this.changed();}
  hideKeyboardCursor(){this.cursor=undefined;this.cursorMark?.clear();this.changed();}
  cancelInput(){
    this.down=undefined;this.hideKeyboardCursor();this.clearHint();this.clearSelection();
    if(this.ready&&this.canInteract())this.resetHint();else this.stopHintTimer();
  }
  keyboardKey(key:string,repeat=false){
    if(!this.canInteract()||!this.cursor)return false;
    this.syncMotion();
    if(key==='Escape'){this.down=undefined;this.clearSelection();this.resetHint();return true;}
    if(key==='Enter'||key===' '){this.down=undefined;if(!repeat)this.tap({...this.cursor});return true;}
    const delta=key==='ArrowUp'?[-1,0]:key==='ArrowDown'?[1,0]:key==='ArrowLeft'?[0,-1]:key==='ArrowRight'?[0,1]:undefined;
    if(!delta)return false;
    this.down=undefined;
    let next={row:this.cursor.row+delta[0],col:this.cursor.col+delta[1]};
    while(next.row>=0&&next.row<this.engine.rows&&next.col>=0&&next.col<this.engine.cols){
      if(this.engine.isActive(next)){this.cursor=next;break;}
      next={row:next.row+delta[0],col:next.col+delta[1]};
    }
    this.drawCursor();this.changed();return true;
  }
  private drawCursor(){
    if(!this.cursor)return;
    const {x,y}=this.point(this.cursor);
    this.cursorMark??=this.add.graphics().setDepth(20);
    // 선택의 안쪽 체크 테두리와 구분되는 바깥 이중 테두리와 네 모서리입니다.
    const g=this.cursorMark.clear();g.lineStyle(5,0xfffdf5);g.strokeRoundedRect(x-26,y-26,52,52,9);
    g.lineStyle(2,0x294f40);g.strokeRoundedRect(x-26,y-26,52,52,9);
    for(const dx of [-1,1])for(const dy of [-1,1]){g.lineBetween(x+dx*19,y+dy*23,x+dx*23,y+dy*23);g.lineBetween(x+dx*23,y+dy*23,x+dx*23,y+dy*19);}
  }
  private position(x:number,y:number): Position|undefined {
    const col=Math.floor((x-PAD)/CELL),row=Math.floor((y-PAD)/CELL);
    return this.engine.isActive({row,col})?{row,col}:undefined;
  }
  private point(p:Position) {return {x:PAD+p.col*CELL+CELL/2,y:PAD+p.row*CELL+CELL/2};}
  private restorePiece(pos:Position){
    const item=this.pieces[pos.row]?.[pos.col];if(!item)return;
    this.tweens.killTweensOf(item);const {x,y}=this.point(pos);item.setScale(1).setPosition(x,y);
  }
  private syncMotion(){
    const reduced=reducedMotion();
    if(reduced!==this.motionReduced){
      this.motionReduced=reduced;this.clearHint();this.selectionMark?.clear();
      if(this.selected){this.restorePiece(this.selected);this.drawSelection(reduced);}
    }
    return reduced;
  }
  private drawSelection(reduced:boolean){
    if(!this.selected)return;
    if(!reduced){this.pieces[this.selected.row][this.selected.col]!.setScale(1.12);return;}
    const {x,y}=this.point(this.selected);
    const g=(this.selectionMark??=this.add.graphics().setDepth(21).setName('board-selection')).clear();
    g.lineStyle(5,0xfffdf5);g.strokeRoundedRect(x-21,y-21,42,42,7);
    g.lineStyle(2,0x294f40);g.strokeRoundedRect(x-21,y-21,42,42,7);
    g.lineStyle(4,0x294f40);g.lineBetween(x+7,y-15,x+11,y-11);g.lineBetween(x+11,y-11,x+18,y-18);
  }
  private clearHint(){
    this.hintMark?.clear();
    for(const item of this.hintPieces){this.tweens.killTweensOf(item);item.setScale(1);}
    this.hintPieces=[];
  }
  private makePiece(tile:Tile,pos:Position) {
      const point=this.point(pos);const item=this.add.container(point.x,point.y).setDepth(2);
      if(tile.special){
        const halo=this.add.graphics().setName(`special-body-${tile.special}`);
        if(tile.special==='row'||tile.special==='column'){
          const across=tile.special==='row';
          // 몸체는 정사각형으로 유지하고 방향은 띠/화살표로 구분합니다.
          halo.fillStyle(0x244d60,1);halo.fillRoundedRect(-24,-24,48,48,12);
          halo.fillStyle(across?0x2684b0:0x248665,1);halo.fillRoundedRect(-23,-24,46,46,11);
          halo.lineStyle(2,across?0xb5f2ff:0xc1ffda,1);halo.strokeRoundedRect(-22,-22,44,44,10);
        }else{
          halo.fillStyle(tile.special==='bomb'?0x493354:0x354d68,1);halo.fillCircle(0,1,25);
          halo.lineStyle(3,tile.special==='bomb'?0xeea864:0xffe9ad,1);halo.strokeCircle(0,0,24);
          if(tile.special==='bomb'){
            halo.fillStyle(0x33283f,1);halo.fillRoundedRect(-8,-25,16,8,3);
            halo.lineStyle(3,0xffd48e,1);halo.lineBetween(5,-25,11,-27);halo.lineBetween(11,-27,16,-23);
          }
        }
        item.add(halo);
      }
      const size=tile.special?(tile.special==='rainbow'?29:tile.special==='bomb'?32:35):45;
      const image=this.add.image(0,tile.special==='bomb'?2:0,tileNames[tile.kind]).setDisplaySize(size,size);item.add(image);
      if(tile.special){
        const mark=this.add.graphics().setName(`special-mark-${tile.special}`).lineStyle(3,0xfffaf0,1);
        if(tile.special==='row') {
          for(const y of [-16,16])mark.lineBetween(-15,y,15,y);
          for(const x of [-21,21]){const inward=x>0?-5:5;mark.lineBetween(x,0,x+inward,-5);mark.lineBetween(x,0,x+inward,5);}
        }
        if(tile.special==='column') {
          for(const x of [-16,16])mark.lineBetween(x,-15,x,15);
          for(const y of [-21,21]){const inward=y>0?-5:5;mark.lineBetween(0,y,-5,y+inward);mark.lineBetween(0,y,5,y+inward);}
        }
        if(tile.special==='bomb') {mark.lineStyle(3,0xffe3b8);mark.lineBetween(-17,-12,-13,-16);mark.fillStyle(0xffdf81);mark.fillCircle(17,-23,3);}
        if(tile.special==='rainbow') {
          const colors=[0xff788f,0xffc65b,0x9bdc64,0x73ddeb,0x9e9bff,0xf5a2df];
          colors.forEach((color,i)=>{const angle=(i*60-90)*Math.PI/180;mark.fillStyle(color);mark.fillCircle(Math.cos(angle)*19,Math.sin(angle)*19,5);});
          mark.lineStyle(2,0xfff8dc,.8);mark.strokeCircle(0,0,13);
        }
        item.add(mark);
      }
      return item;
  }
  private paint(board:Cell[][]) {
    this.pieces.flat().forEach(p=>p?.destroy());
    this.pieces=board.map((row,r)=>row.map((tile,c)=>tile?this.makePiece(tile,{row:r,col:c}):null));
  }
  private paintLeaves(leaves:number[][]){
    this.leafObjects.forEach(item=>item.destroy());this.leafObjects=[];
    for(let row=0;row<this.engine.rows;row++)for(let col=0;col<this.engine.cols;col++){
      const layers=leaves[row][col];if(!layers)continue;
      const {x,y}=this.point({row,col});
      const ground=this.add.graphics().setDepth(1);
      ground.fillStyle(layers===2?0xd09a5e:0xeacb9e,layers===2?.65:.45);ground.fillRoundedRect(x-26,y-26,52,52,11);
      ground.lineStyle(2,layers===2?0x9f653b:0xc8955b,.95);ground.strokeRoundedRect(x-26,y-26,52,52,11);
      if(layers===2){ground.lineStyle(2,0xf2d09c,.9);ground.lineBetween(x-20,y-21,x+20,y-21);}
      const size=layers===2?31:24,badge=this.add.image(x+12,y+12,layers===2?'leaf-pile':'leaf-single').setDisplaySize(size,size).setDepth(3);
      const count=this.add.text(x+19,y+20,String(layers),{fontFamily:'Arial, sans-serif',fontSize:'17px',fontStyle:'bold',color:'#fffaf0',stroke:'#744521',strokeThickness:4}).setOrigin(.5).setDepth(4);
      this.leafObjects.push(ground,badge,count);
    }
  }
  private paintCrates(crates:number[][]){
    this.crateObjects.forEach(item=>item.destroy());this.crateObjects=[];
    for(let row=0;row<this.engine.rows;row++)for(let col=0;col<this.engine.cols;col++)if(crates[row][col]){
      const {x,y}=this.point({row,col});
      this.crateObjects.push(this.add.image(x,y,'wooden-crate').setDisplaySize(51,51).setDepth(3).setName(`crate-${row}-${col}`));
    }
  }
  private showLeafHits(step:ResolveStep){
    if(!step.leaves)return;
    // 동기 엔진의 최종 상태 대신 각 연쇄 단계의 바닥층을 표시합니다.
    this.paintLeaves(step.leaves.before);
    for(const hit of step.leaves.hits)this.effects?.leafHit(hit);
  }
  /** 사라진 칸만 보충하고 남은 블록의 객체와 세로 순서를 유지합니다. */
  private drop(step:ResolveStep) {
    const reduced=this.syncMotion();
    step.removed.forEach(p=>this.pieces[p.row][p.col]?.destroy());
    step.created?.forEach(p=>{
      this.pieces[p.row][p.col]?.destroy();this.pieces[p.row][p.col]=this.makePiece(p.tile,p);
    });
    const next:(Phaser.GameObjects.Container|null)[][]=this.engine.mask.map(line=>line.map(()=>null));
    for(const fall of step.falls??[]){
      const point=this.point(fall.to),tile=step.after[fall.to.row][fall.to.col]!;
      const item=fall.from?this.pieces[fall.from.row][fall.from.col]!:this.makePiece(tile,reduced?fall.to:{row:fall.startRow,col:fall.to.col});
      next[fall.to.row][fall.to.col]=item;
      if(reduced)item.setPosition(point.x,point.y);
      else if(item.y!==point.y)this.tweens.add({targets:item,y:point.y,duration:280,ease:'Cubic.easeIn'});
    }
    this.pieces=next;
  }
  private tap(pos:Position) {
    if(!this.canInteract()||!this.engine.isPlayable(pos))return;
    const reduced=this.syncMotion();
    this.resetHint();this.hooks.audio.play('tap');
    if(this.selected&&Math.abs(pos.row-this.selected.row)+Math.abs(pos.col-this.selected.col)===1){void this.attempt(this.selected,pos);return;}
    if(this.engine.board[pos.row][pos.col]!.special){void this.attempt(pos);return;}
    this.clearSelection();this.selected=pos;this.drawSelection(reduced);
    if(!reduced)this.tweens.add({targets:this.pieces[pos.row][pos.col],y:this.point(pos).y-3,duration:180,yoyo:true,repeat:1});
    this.changed();
  }
  private clearSelection(){if(this.selected)this.restorePiece(this.selected);this.selectionMark?.clear();this.selected=undefined;this.changed();}
  private effectNotice(step:ResolveStep):Notice {
    const effects=step.effects??[];
    if(effects.length>1)return 'comboClear';
    return effects[0]?.special==='row'?'rowClear':effects[0]?.special==='column'?'columnClear':effects[0]?.special==='bomb'?'bombClear':'colorClear';
  }
  private showEffect(step:ResolveStep) {
    const overlay=this.add.graphics().setDepth(10);
    // 판정이 끝난 실제 제거 칸을 사용하므로 조합·연쇄의 범위와도 일치합니다.
    for(const p of step.removed){
      overlay.fillStyle(0xffefab,0.22);overlay.fillRoundedRect(PAD+p.col*CELL+2,PAD+p.row*CELL+2,52,52,11);
      overlay.lineStyle(2,0xfff8d3,0.9);overlay.strokeRoundedRect(PAD+p.col*CELL+2,PAD+p.row*CELL+2,52,52,11);
    }
    const drawn=new Set<string>();
    for(const effect of step.effects??[]){
      const point=this.point(effect),key=effect.special==='row'?`r${effect.row}`:effect.special==='column'?`c${effect.col}`:`${effect.row},${effect.col}`;
      if(drawn.has(key))continue;drawn.add(key);
      overlay.lineStyle(5,effect.special==='rainbow'?0xd7b7f2:effect.special==='bomb'?0xf5bbcf:0xffe8a2,0.85);
      if(effect.special==='row')overlay.lineBetween(PAD,point.y,PAD+this.engine.cols*CELL,point.y);
      else if(effect.special==='column')overlay.lineBetween(point.x,PAD,point.x,PAD+this.engine.rows*CELL);
      else overlay.strokeCircle(point.x,point.y,effect.special==='bomb'?CELL*1.25:24);
    }
    this.effects.trackOverlay(overlay);return overlay;
  }
  private wait(ms:number){return new Promise<void>(resolve=>this.time.delayedCall(ms,()=>resolve()));}
  private async attempt(a:Position,b?:Position) {
    if(!this.canInteract()||!this.engine.isPlayable(a)||(b&&!this.engine.isPlayable(b)))return;
    const reduced=this.syncMotion();this.clearHint();
    this.down=undefined;
    this.busy=true;this.stopHintTimer();this.clearSelection();this.hooks.onStart();
    this.pieces.forEach((row,r)=>row.forEach((item,c)=>{if(!item)return;this.tweens.killTweensOf(item);item.setScale(1);item.setPosition(this.point({row:r,col:c}).x,this.point({row:r,col:c}).y);}));
    const x=this.pieces[a.row][a.col]!,y=b?this.pieces[b.row][b.col]:undefined;
    const result=b?this.engine.swap(a,b):this.engine.activate(a);
    this.hooks.audio.play(result.valid?'swap':'invalid');
    if(b){
      if(reduced){x.setPosition(this.point(b).x,this.point(b).y);y!.setPosition(this.point(a).x,this.point(a).y);}
      else {this.tweens.add({targets:x,...this.point(b),duration:130,ease:'Sine.easeInOut'});
      this.tweens.add({targets:y,...this.point(a),duration:130,ease:'Sine.easeInOut'});}
      await this.wait(140);
      if(this.finished)return;
      if(result.valid){this.pieces[a.row][a.col]=y!;this.pieces[b.row][b.col]=x;}
    }
    if(!result.valid){
      if(b){if(this.syncMotion()){x.setPosition(this.point(a).x,this.point(a).y);y!.setPosition(this.point(b).x,this.point(b).y);}
      else {this.tweens.add({targets:x,...this.point(a),duration:130});this.tweens.add({targets:y,...this.point(b),duration:130});}await this.wait(150);if(this.finished)return;}
    }else {
      for(let i=0;i<result.steps.length;i++){
        const step=result.steps[i];
        if(!step.removed.length){this.hooks.onNotice('noMoves');this.paint(step.after);await this.wait(250);if(this.finished)return;continue;}
        if(step.effects?.length&&!this.syncMotion()){
          this.effects.anticipate(step);await this.wait(80);if(this.finished)return;
        }
        const special=step.created?.length||step.effects?.length;
        this.hooks.audio.play(special?'special':'match',i+1);
        this.hooks.onNotice(step.effects?.length?this.effectNotice(step):step.crates?.hits.length?'cratesCleared':step.leaves?.hits.some(p=>p.after===0)?'leavesCleared':step.leaves?.hits.length?'leafThinned':step.created?.length?'specialCreated':i>0?'chain':'matched');
        // 대량 파편보다 실제 제거범위 표시를 먼저 확보합니다.
        if(step.effects?.length)this.showEffect(step);
        this.showLeafHits(step);
        if(step.crates)this.paintCrates(step.crates.before);
        this.effects?.match(step,i+1);
        if(step.effects?.length){
          this.effects?.special(step);
          await this.wait(180);
          if(this.finished)return;
        }
        const reducedRemoval=this.syncMotion();
        // 동기 엔진의 최종 보드 대신 현재 제거 단계의 실제 데이터만 복사합니다.
        this.hooks.onResolveVisual?.({cascade:i+1,
          removed:step.removed.map(p=>({...this.point(p),kind:step.before[p.row][p.col]!.kind})),
          clearedLeaves:(step.leaves?.hits??[]).filter(p=>p.after===0).map(p=>this.point(p)),
          ...(step.crates?{clearedCrates:step.crates.hits.map(p=>this.point(p))}:{}),
          specialActivated:Boolean(step.effects?.length),specialCreated:Boolean(step.created?.length)});
        step.removed.forEach(p=>{
          const item=this.pieces[p.row][p.col];this.tweens.add({targets:item,...(reducedRemoval?{}:{scale:.25}),alpha:0,duration:180,ease:reducedRemoval?'Linear':'Back.easeIn'});
        });
        await this.wait(200);if(this.finished)return;if(step.crates)this.paintCrates(step.crates.after);this.drop(step);if(step.leaves)this.paintLeaves(step.leaves.after);await this.wait(300);if(this.finished)return;
      }
      if(this.engine.hasCrates)this.hooks.onMove(result.collected,result.score,result.steps.length,result.leavesCleared??0,result.cratesCleared??0);
      else this.hooks.onMove(result.collected,result.score,result.steps.length,result.leavesCleared??0);
    }
    this.busy=false;if(!this.finished)this.resetHint();this.changed();
  }
  stopPlaying(){this.finished=true;this.stopHintTimer();this.cancelInput();this.effects.clear();this.hooks.onVisualCancel?.();}
  snapshot():BoardSnapshot {return JSON.parse(JSON.stringify({board:this.engine.board,leaves:this.engine.leaves,ruleVersion:this.engine.ruleVersion,...(this.engine.hasCrates?{crates:this.engine.crates}:{})}));}
  canResumeAfterFailure():boolean {
    return this.ready&&this.finished&&!this.busy&&(this.sys.isActive()||this.sys.isPaused())
      &&this.pieces.length===this.engine.rows&&this.pieces.every(row=>row.length===this.engine.cols);
  }
  /** 읽기 전용 사전 검사를 통과하고 저장 성공한 같은 동기 실행에서만 호출합니다. */
  resumePreparedFailure(){this.cancelInput();this.finished=false;this.resetHint();this.changed();}
  applyPreparedShuffle(snapshot:BoardSnapshot){
    this.cancelInput();this.hooks.onVisualCancel?.();
    this.engine.board=JSON.parse(JSON.stringify(snapshot.board));this.engine.leaves=snapshot.leaves.map(row=>row.slice());
    if(snapshot.crates)this.engine.crates=snapshot.crates.map(row=>row.slice());
    this.paint(this.engine.board);this.paintLeaves(this.engine.leaves);this.paintCrates(this.engine.crates);this.hooks.audio.play('special');this.resetHint();this.changed();
  }
  /** 현재 실패 보드의 안정 상태만 복귀합니다. 라운드 자격/1회 제한은 호출자가 검사합니다. */
  resumeAfterFailure():boolean {
    if(!this.canResumeAfterFailure())return false;
    this.resumePreparedFailure();return true;
  }
  shuffle():boolean {if(!this.canInteract())return false;this.cancelInput();this.hooks.onVisualCancel?.();this.engine.shuffle();this.paint(this.engine.board);this.hooks.audio.play('special');this.resetHint();this.changed();return true;}
  canLeave(){return !this.busy;}
  private stopHintTimer(){this.hintTimer?.remove();this.hintTimer=undefined;}
  private resetHint(){
    this.stopHintTimer();
    if(!this.ready||!this.canInteract())return;
    this.clearHint();
    const timer=this.time.delayedCall(7500,()=>{
      // 취소·종료·재시작 이전의 콜백은 현재 장면의 표시나 새 예약을 건드리지 않습니다.
      if(this.hintTimer!==timer)return;
      this.hintTimer=undefined;this.showHint();
    });
    this.hintTimer=timer;
  }
  private showHint(){
    if(!this.ready||!this.canInteract()||this.selected)return;
    const move=this.engine.legalMoves()[0];
    if(move){const {a,b}=move,reduced=this.syncMotion();this.resetHint();
      if(reduced){
        const g=(this.hintMark??=this.add.graphics().setDepth(19).setName('board-hint')).clear();
        g.lineStyle(3,0x294f40);
        for(const p of [a,b]){const {x,y}=this.point(p);g.strokeRoundedRect(x-23,y-23,46,46,8);g.lineBetween(x-5,y+18,x+5,y+18);}
        const start=this.point(a),end=this.point(b);g.lineBetween(start.x,start.y,end.x,end.y);
      }else {this.hintPieces=[this.pieces[a.row][a.col]!,this.pieces[b.row][b.col]!];this.tweens.add({targets:this.hintPieces,scale:1.1,duration:450,yoyo:true,repeat:1,ease:'Sine.easeInOut'});}
    }
  }
}
