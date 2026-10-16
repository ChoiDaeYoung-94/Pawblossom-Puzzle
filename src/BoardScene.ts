import Phaser from 'phaser';
import { BoardEngine, type Position, type Tile, type ResolveStep, type LeafPile } from './core';
import type { AudioManager } from './audio/AudioManager';

export const tileNames = ['strawberry','carrot','blueberry','acorn','leaf','flower'];
type Notice='matched'|'chain'|'specialCreated'|'noMoves'|'rowClear'|'columnClear'|'bombClear'|'colorClear'|'comboClear';
interface Hooks { audio: AudioManager; onStart:()=>void; onMove:(collected:number[],score:number,chains:number,leavesCleared:number)=>void; onNotice:(kind:Notice)=>void; }
const CELL = 56, PAD = 16;
export class BoardScene extends Phaser.Scene {
  engine = new BoardEngine();
  private pieces: Phaser.GameObjects.Container[][] = [];
  private selected?: Position;
  private down?: {pos:Position,x:number,y:number,pointerId:number};
  private busy = false;
  private finished = false;
  private hooks: Hooks;
  private hintTimer?: Phaser.Time.TimerEvent;
  private leafObjects:(Phaser.GameObjects.Graphics|Phaser.GameObjects.Image)[]=[];
  constructor(hooks: Hooks) {super('Board');this.hooks=hooks;}
  configureLeaves(piles:LeafPile[]){this.engine.setLeaves(piles);}
  preload() {tileNames.forEach(name=>this.load.svg(name,`/assets/tiles/${name}.svg`,{width:100,height:100}));this.load.svg('leaf-pile','/assets/obstacles/leaf-pile.svg',{width:100,height:100});}
  create() {
    this.cameras.main.setBackgroundColor('#dae6d7');
    const g=this.add.graphics();
    g.fillStyle(0xb9cdb5,1);g.fillRoundedRect(6,6,468,468,24);
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      g.fillStyle((r+c)%2?0xe7eee0:0xf1f3e7,1);g.fillRoundedRect(PAD+c*CELL+2,PAD+r*CELL+2,52,52,11);
    }
    this.paint(this.engine.board);
    this.paintLeaves(this.engine.leaves);
    this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{
      if(this.busy||this.finished||this.down)return;
      const pos=this.position(p.x,p.y);if(pos)this.down={pos,x:p.x,y:p.y,pointerId:p.id};
    });
    this.input.on('pointerup',(p:Phaser.Input.Pointer)=>{
      if(this.busy||this.finished||!this.down||this.down.pointerId!==p.id)return;
      const d=this.down;this.down=undefined;
      const dx=p.x-d.x,dy=p.y-d.y;
      if(Math.hypot(dx,dy)>16){
        const to={row:d.pos.row+(Math.abs(dy)>Math.abs(dx)?Math.sign(dy):0),col:d.pos.col+(Math.abs(dx)>=Math.abs(dy)?Math.sign(dx):0)};
        if(to.row>=0&&to.row<8&&to.col>=0&&to.col<8)void this.attempt(d.pos,to);
      }else this.tap(d.pos);
    });
    this.input.on('gameout',()=>{this.down=undefined;});
    const cancelGesture=()=>{this.down=undefined;this.clearSelection();};
    this.events.on(Phaser.Scenes.Events.PAUSE,cancelGesture);
    this.events.on(Phaser.Scenes.Events.RESUME,cancelGesture);
    this.events.on(Phaser.Scenes.Events.SLEEP,cancelGesture);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,cancelGesture);
    this.resetHint();
  }
  private position(x:number,y:number): Position|undefined {
    const col=Math.floor((x-PAD)/CELL),row=Math.floor((y-PAD)/CELL);
    return row>=0&&row<8&&col>=0&&col<8?{row,col}:undefined;
  }
  private point(p:Position) {return {x:PAD+p.col*CELL+CELL/2,y:PAD+p.row*CELL+CELL/2};}
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
      ground.fillStyle(0xd8ab70,.5);ground.fillRoundedRect(x-26,y-26,52,52,11);
      ground.lineStyle(2,layers===2?0x9f653b:0xc8955b,.95);ground.strokeRoundedRect(x-26,y-26,52,52,11);
      const badge=this.add.image(x+16,y+16,'leaf-pile').setDisplaySize(22,22).setDepth(3);
      const dots=this.add.graphics().setDepth(3);dots.fillStyle(0xfffaf0,1);
      for(let n=0;n<layers;n++)dots.fillCircle(x+12+n*7,y+25,2);
      this.leafObjects.push(ground,badge,dots);
    }
  }
  private showLeafHits(step:ResolveStep){
    if(!step.leaves)return;
    // 동기 엔진의 최종 상태 대신 각 연쇄 단계의 바닥층을 표시합니다.
    this.paintLeaves(step.leaves.before);
    const glow=this.add.graphics().setDepth(9);
    for(const p of step.leaves.hits){const {x,y}=this.point(p);glow.lineStyle(3,0xf6cf8d,1);glow.strokeRoundedRect(x-25,y-25,50,50,11);}
    this.tweens.add({targets:glow,alpha:0,duration:350,onComplete:()=>glow.destroy()});
  }
  /** 사라진 칸만 보충하고 남은 블록의 객체와 세로 순서를 유지합니다. */
  private drop(step:ResolveStep) {
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
        const item=row<missing?this.makePiece(step.after[row][col],{row:row-missing,col}):survivors[row-missing];
        next[row][col]=item;
        if(item.y!==point.y)this.tweens.add({targets:item,y:point.y,duration:280,ease:'Cubic.easeIn'});
      }
    }
    this.pieces=next;
  }
  private tap(pos:Position) {
    this.resetHint();this.hooks.audio.play('tap');
    if(this.selected&&Math.abs(pos.row-this.selected.row)+Math.abs(pos.col-this.selected.col)===1){void this.attempt(this.selected,pos);return;}
    if(this.engine.board[pos.row][pos.col].special){void this.attempt(pos);return;}
    this.clearSelection();this.selected=pos;this.pieces[pos.row][pos.col].setScale(1.12);
    this.tweens.add({targets:this.pieces[pos.row][pos.col],y:this.point(pos).y-3,duration:180,yoyo:true,repeat:1});
  }
  private clearSelection(){if(this.selected)this.pieces[this.selected.row]?.[this.selected.col]?.setScale(1);this.selected=undefined;}
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
    if(this.busy||this.finished)return;
    this.busy=true;this.hintTimer?.remove();this.clearSelection();this.hooks.onStart();
    this.pieces.forEach((row,r)=>row.forEach((item,c)=>{this.tweens.killTweensOf(item);item.setScale(1);item.setPosition(this.point({row:r,col:c}).x,this.point({row:r,col:c}).y);}));
    const x=this.pieces[a.row][a.col],y=b?this.pieces[b.row][b.col]:undefined;
    const result=b?this.engine.swap(a,b):this.engine.activate(a);
    this.hooks.audio.play(result.valid?'swap':'invalid');
    if(b){
      this.tweens.add({targets:x,...this.point(b),duration:130,ease:'Sine.easeInOut'});
      this.tweens.add({targets:y,...this.point(a),duration:130,ease:'Sine.easeInOut'});
      await this.wait(140);
      if(result.valid){this.pieces[a.row][a.col]=y!;this.pieces[b.row][b.col]=x;}
    }
    if(!result.valid){
      if(b){this.tweens.add({targets:x,...this.point(a),duration:130});this.tweens.add({targets:y,...this.point(b),duration:130});await this.wait(150);}
    }else {
      for(let i=0;i<result.steps.length;i++){
        const step=result.steps[i];
        if(!step.removed.length){this.hooks.onNotice('noMoves');this.paint(step.after);await this.wait(250);continue;}
        const special=step.created?.length||step.effects?.length;
        this.hooks.audio.play(special?'special':'match',i+1);
        this.hooks.onNotice(step.effects?.length?this.effectNotice(step):step.created?.length?'specialCreated':i>0?'chain':'matched');
        this.showLeafHits(step);
        if(step.effects?.length){
          const overlay=this.showEffect(step);await this.wait(180);
          this.tweens.add({targets:overlay,alpha:0,duration:130,onComplete:()=>overlay.destroy()});
        }
        step.removed.forEach(p=>{
          const item=this.pieces[p.row][p.col];this.tweens.add({targets:item,scale:.25,alpha:0,duration:180,ease:'Back.easeIn'});
          const dot=this.add.circle(item.x,item.y,5,[0xf7b0a7,0xf4d488,0xa6c88e][i%3]);
          this.tweens.add({targets:dot,y:item.y-30,alpha:0,scale:2,duration:400,onComplete:()=>dot.destroy()});
        });
        await this.wait(200);this.drop(step);if(step.leaves)this.paintLeaves(step.leaves.after);await this.wait(300);
      }
      this.hooks.onMove(result.collected,result.score,result.steps.length,result.leavesCleared??0);
    }
    this.busy=false;if(!this.finished)this.resetHint();
  }
  stopPlaying(){this.finished=true;this.hintTimer?.remove();this.clearSelection();}
  shuffle():boolean {if(this.busy||this.finished)return false;this.clearSelection();this.engine.shuffle();this.paint(this.engine.board);this.hooks.audio.play('special');this.resetHint();return true;}
  canLeave(){return !this.busy;}
  private resetHint(){this.hintTimer?.remove();this.hintTimer=this.time.delayedCall(7500,()=>this.showHint());}
  private showHint(){
    if(this.busy||this.finished||this.selected)return;
    const move=this.engine.legalMoves()[0];
    if(move){const {a,b}=move;this.tweens.add({targets:[this.pieces[a.row][a.col],this.pieces[b.row][b.col]],scale:1.1,duration:450,yoyo:true,repeat:1,ease:'Sine.easeInOut'});this.resetHint();}
  }
}
