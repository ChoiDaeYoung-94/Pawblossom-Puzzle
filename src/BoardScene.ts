import Phaser from 'phaser';
import { BoardEngine, type Position, type Tile, type ResolveStep, type LeafPile, type BoardSnapshot } from './core';
import type { AudioManager } from './audio/AudioManager';
import { BoardEffects } from './BoardEffects';
import { reducedMotion } from './reducedMotion';

export const tileNames = ['strawberry','carrot','blueberry','acorn','leaf','flower'];
type Notice='matched'|'chain'|'specialCreated'|'noMoves'|'rowClear'|'columnClear'|'bombClear'|'colorClear'|'comboClear'|'leafThinned'|'leavesCleared';
interface Hooks { audio: AudioManager; onStart:()=>void; onReady?:()=>void; onBoardState?:()=>void; onMove:(collected:number[],score:number,chains:number,leavesCleared:number)=>void; onNotice:(kind:Notice)=>void; }
const CELL = 56, PAD = 16;
export class BoardScene extends Phaser.Scene {
  engine: BoardEngine;
  private pieces: Phaser.GameObjects.Container[][] = [];
  private selected?: Position;
  private down?: {pos:Position,x:number,y:number,pointerId:number,downTime:number};
  private busy = false;
  private finished = false;
  private hooks: Hooks;
  private hintTimer?: Phaser.Time.TimerEvent;
  private leafObjects:(Phaser.GameObjects.Graphics|Phaser.GameObjects.Image|Phaser.GameObjects.Text)[]=[];
  private effects?:BoardEffects;
  private cursor?:Position;
  private cursorMark?:Phaser.GameObjects.Graphics;
  private selectionMark?:Phaser.GameObjects.Graphics;
  private hintMark?:Phaser.GameObjects.Graphics;
  private hintPieces:Phaser.GameObjects.Container[]=[];
  private motionReduced=reducedMotion();
  constructor(hooks: Hooks, snapshot?:BoardSnapshot) {super('Board');this.hooks=hooks;this.engine=new BoardEngine(8,8,Math.random,snapshot);}
  configureLeaves(piles:LeafPile[]){this.engine.setLeaves(piles);}
  preload() {
    for(const name of tileNames)if(!this.textures.exists(name))this.load.svg(name,`/assets/tiles/${name}.svg`,{width:100,height:100});
    for(const name of ['leaf-pile','leaf-single'])if(!this.textures.exists(name))this.load.svg(name,`/assets/obstacles/${name}.svg`,{width:100,height:100});
  }
  create() {
    this.finished=false;this.busy=false;this.motionReduced=reducedMotion();
    this.effects=new BoardEffects(this);
    this.cameras.main.setBackgroundColor('#dae6d7');
    const g=this.add.graphics();
    g.fillStyle(0xb9cdb5,1);g.fillRoundedRect(6,6,468,468,24);
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      g.fillStyle((r+c)%2?0xe7eee0:0xf1f3e7,1);g.fillRoundedRect(PAD+c*CELL+2,PAD+r*CELL+2,52,52,11);
    }
    this.paint(this.engine.board);
    this.paintLeaves(this.engine.leaves);
    this.input.on('pointerdown',this.pointerDown,this);
    this.input.on('pointerup',this.pointerUp,this);
    this.input.on('pointerupoutside',this.pointerOutside,this);
    const cancelGesture=()=>this.cancelInput();
    const cancelPointer=()=>{if(this.down)this.cancelInput();};
    this.input.on('gameout',cancelPointer);
    this.scale.on(Phaser.Scale.Events.RESIZE,cancelPointer);
    this.events.on(Phaser.Scenes.Events.PAUSE,cancelGesture);
    this.events.on(Phaser.Scenes.Events.RESUME,cancelGesture);
    this.events.on(Phaser.Scenes.Events.SLEEP,cancelGesture);
    this.events.on(Phaser.Scenes.Events.WAKE,cancelGesture);
    const dispose=()=>{
      this.input.off('pointerdown',this.pointerDown,this);this.input.off('pointerup',this.pointerUp,this);
      this.input.off('pointerupoutside',this.pointerOutside,this);this.input.off('gameout',cancelPointer);
      this.scale.off(Phaser.Scale.Events.RESIZE,cancelPointer);
      for(const event of [Phaser.Scenes.Events.PAUSE,Phaser.Scenes.Events.RESUME,Phaser.Scenes.Events.SLEEP,Phaser.Scenes.Events.WAKE])this.events.off(event,cancelGesture);
      this.events.off(Phaser.Scenes.Events.SHUTDOWN,dispose);this.events.off(Phaser.Scenes.Events.DESTROY,dispose);
      this.stopPlaying();this.effects?.clear();this.cursorMark=undefined;this.selectionMark=undefined;this.hintMark=undefined;this.pieces=[];this.leafObjects=[];
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,dispose);
    this.events.once(Phaser.Scenes.Events.DESTROY,dispose);
    this.resetHint();
    // CREATE는 에셋 로딩과 create()가 끝나고 Scene이 RUNNING이 된 뒤 발생합니다.
    this.events.once(Phaser.Scenes.Events.CREATE,()=>{this.hooks.onReady?.();this.changed();});
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
      tile:tile?{...tile}:undefined,layers:pos?this.engine.leaves[pos.row][pos.col]:0,selected:this.selected?{...this.selected}:undefined};
  }
  private changed(){this.hooks.onBoardState?.();}
  focusKeyboard(){if(!this.canInteract())return;this.syncMotion();this.cursor??={row:0,col:0};this.drawCursor();this.changed();}
  hideKeyboardCursor(){this.cursor=undefined;this.cursorMark?.clear();this.changed();}
  cancelInput(){this.down=undefined;this.hideKeyboardCursor();this.clearHint();this.clearSelection();}
  keyboardKey(key:string,repeat=false){
    if(!this.canInteract()||!this.cursor)return false;
    this.syncMotion();
    if(key==='Escape'){this.down=undefined;this.clearSelection();return true;}
    if(key==='Enter'||key===' '){this.down=undefined;if(!repeat)this.tap({...this.cursor});return true;}
    const delta=key==='ArrowUp'?[-1,0]:key==='ArrowDown'?[1,0]:key==='ArrowLeft'?[0,-1]:key==='ArrowRight'?[0,1]:undefined;
    if(!delta)return false;
    this.down=undefined;
    this.cursor={row:Math.max(0,Math.min(this.engine.rows-1,this.cursor.row+delta[0])),col:Math.max(0,Math.min(this.engine.cols-1,this.cursor.col+delta[1]))};
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
    return row>=0&&row<8&&col>=0&&col<8?{row,col}:undefined;
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
    if(!reduced){this.pieces[this.selected.row][this.selected.col].setScale(1.12);return;}
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
        const halo=this.add.graphics();halo.fillStyle(tile.special==='rainbow'?0xf9dc9f:0xffe8a7,.95);halo.fillRoundedRect(-25,-25,50,50,13);halo.lineStyle(2,0xf6c364,.85);halo.strokeRoundedRect(-25,-25,50,50,13);item.add(halo);
      }
      const image=this.add.image(0,0,tileNames[tile.kind]).setDisplaySize(43,43);item.add(image);
      if(tile.special){
        const mark=this.add.graphics().lineStyle(3,0xfffaf0,1);
        if(tile.special==='row') {mark.lineBetween(-19,0,19,0);mark.lineBetween(-19,0,-12,-6);mark.lineBetween(-19,0,-12,6);mark.lineBetween(19,0,12,-6);mark.lineBetween(19,0,12,6);}
        if(tile.special==='column') {mark.lineBetween(0,-19,0,19);mark.lineBetween(0,-19,-6,-12);mark.lineBetween(0,-19,6,-12);mark.lineBetween(0,19,-6,12);mark.lineBetween(0,19,6,12);}
        if(tile.special==='bomb') {mark.fillStyle(0xfff5db);mark.fillCircle(13,14,8);mark.lineStyle(2,0xc78f48);mark.strokeCircle(13,14,8);}
        if(tile.special==='rainbow') {const colors=[0xe67883,0xe9bd62,0x8db87b,0x849ccc,0xbd93ce];colors.forEach((color,i)=>{mark.lineStyle(3,color);mark.strokeCircle(0,0,17+i*1.7);});}
        item.add(mark);
      }
      return item;
  }
  private paint(board:Tile[][]) {
    this.pieces.flat().forEach(p=>p.destroy());
    this.pieces=board.map((row,r)=>row.map((tile,c)=>this.makePiece(tile,{row:r,col:c})));
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
  private showLeafHits(step:ResolveStep){
    if(!step.leaves)return;
    // 동기 엔진의 최종 상태 대신 각 연쇄 단계의 바닥층을 표시합니다.
    this.paintLeaves(step.leaves.before);
    for(const hit of step.leaves.hits)this.effects?.leafHit(hit);
  }
  /** 사라진 칸만 보충하고 남은 블록의 객체와 세로 순서를 유지합니다. */
  private drop(step:ResolveStep) {
    const reduced=this.syncMotion();
    const removed=new Set(step.removed.map(p=>p.row*this.engine.cols+p.col));
    step.removed.forEach(p=>this.pieces[p.row][p.col].destroy());
    step.created?.forEach(p=>{
      this.pieces[p.row][p.col].destroy();this.pieces[p.row][p.col]=this.makePiece(p.tile,p);
    });
    const next:Phaser.GameObjects.Container[][]=Array.from({length:this.engine.rows},()=>[]);
    for(let col=0;col<this.engine.cols;col++){
      const survivors=this.pieces.map(row=>row[col]).filter((_,row)=>!removed.has(row*this.engine.cols+col));
      const missing=this.engine.rows-survivors.length;
      for(let row=0;row<this.engine.rows;row++){
        const pos={row,col},point=this.point(pos);
        const item=row<missing?this.makePiece(step.after[row][col],reduced?pos:{row:row-missing,col}):survivors[row-missing];
        next[row][col]=item;
        if(reduced)item.setPosition(point.x,point.y);
        else if(item.y!==point.y)this.tweens.add({targets:item,y:point.y,duration:280,ease:'Cubic.easeIn'});
      }
    }
    this.pieces=next;
  }
  private tap(pos:Position) {
    if(!this.canInteract())return;
    const reduced=this.syncMotion();
    this.resetHint();this.hooks.audio.play('tap');
    if(this.selected&&Math.abs(pos.row-this.selected.row)+Math.abs(pos.col-this.selected.col)===1){void this.attempt(this.selected,pos);return;}
    if(this.engine.board[pos.row][pos.col].special){void this.attempt(pos);return;}
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
    return overlay;
  }
  private wait(ms:number){return new Promise<void>(resolve=>this.time.delayedCall(ms,()=>resolve()));}
  private async attempt(a:Position,b?:Position) {
    if(!this.canInteract())return;
    const reduced=this.syncMotion();this.clearHint();
    this.down=undefined;
    this.busy=true;this.hintTimer?.remove();this.clearSelection();this.hooks.onStart();
    this.pieces.forEach((row,r)=>row.forEach((item,c)=>{this.tweens.killTweensOf(item);item.setScale(1);item.setPosition(this.point({row:r,col:c}).x,this.point({row:r,col:c}).y);}));
    const x=this.pieces[a.row][a.col],y=b?this.pieces[b.row][b.col]:undefined;
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
        const special=step.created?.length||step.effects?.length;
        this.hooks.audio.play(special?'special':'match',i+1);
        this.hooks.onNotice(step.effects?.length?this.effectNotice(step):step.leaves?.hits.some(p=>p.after===0)?'leavesCleared':step.leaves?.hits.length?'leafThinned':step.created?.length?'specialCreated':i>0?'chain':'matched');
        this.showLeafHits(step);
        this.effects?.match(step,i+1);
        if(step.effects?.length){
          this.effects?.special(step);
          const overlay=this.showEffect(step);await this.wait(180);
          if(this.finished)return;
          this.tweens.add({targets:overlay,alpha:0,duration:130,onComplete:()=>overlay.destroy()});
        }
        const reducedRemoval=this.syncMotion();
        step.removed.forEach(p=>{
          const item=this.pieces[p.row][p.col];this.tweens.add({targets:item,...(reducedRemoval?{}:{scale:.25}),alpha:0,duration:180,ease:reducedRemoval?'Linear':'Back.easeIn'});
          if(reducedRemoval)return;
          const dot=this.add.circle(item.x,item.y,5,[0xf7b0a7,0xf4d488,0xa6c88e][i%3]);
          this.tweens.add({targets:dot,y:item.y-30,alpha:0,scale:2,duration:400,onComplete:()=>dot.destroy()});
        });
        await this.wait(200);if(this.finished)return;this.drop(step);if(step.leaves)this.paintLeaves(step.leaves.after);await this.wait(300);if(this.finished)return;
      }
      this.hooks.onMove(result.collected,result.score,result.steps.length,result.leavesCleared??0);
    }
    this.busy=false;if(!this.finished)this.resetHint();this.changed();
  }
  stopPlaying(){this.finished=true;this.hintTimer?.remove();this.cancelInput();}
  shuffle():boolean {if(!this.canInteract())return false;this.cancelInput();this.engine.shuffle();this.paint(this.engine.board);this.hooks.audio.play('special');this.resetHint();this.changed();return true;}
  canLeave(){return !this.busy;}
  private resetHint(){this.clearHint();this.hintTimer?.remove();this.hintTimer=this.time.delayedCall(7500,()=>this.showHint());}
  private showHint(){
    if(this.busy||this.finished||this.selected)return;
    const move=this.engine.legalMoves()[0];
    if(move){const {a,b}=move,reduced=this.syncMotion();this.resetHint();
      if(reduced){
        const g=(this.hintMark??=this.add.graphics().setDepth(19).setName('board-hint')).clear();
        g.lineStyle(3,0x294f40);
        for(const p of [a,b]){const {x,y}=this.point(p);g.strokeRoundedRect(x-23,y-23,46,46,8);g.lineBetween(x-5,y+18,x+5,y+18);}
        const start=this.point(a),end=this.point(b);g.lineBetween(start.x,start.y,end.x,end.y);
      }else {this.hintPieces=[this.pieces[a.row][a.col],this.pieces[b.row][b.col]];this.tweens.add({targets:this.hintPieces,scale:1.1,duration:450,yoyo:true,repeat:1,ease:'Sine.easeInOut'});}
    }
  }
}
