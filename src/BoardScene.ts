import Phaser from 'phaser';
import { BoardEngine, type Position, type Tile } from './core';
import type { AudioManager } from './audio/AudioManager';

export const tileNames = ['strawberry','carrot','blueberry','acorn','leaf','flower'];
interface Hooks { audio: AudioManager; onStart:()=>void; onMove:(collected:number[],score:number,chains:number)=>void; onNotice:(kind:'matched'|'chain'|'special'|'noMoves')=>void; }
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
  constructor(hooks: Hooks) {super('Board');this.hooks=hooks;}
  preload() {tileNames.forEach(name=>this.load.svg(name,`/assets/tiles/${name}.svg`,{width:100,height:100}));}
  create() {
    this.cameras.main.setBackgroundColor('#dae6d7');
    const g=this.add.graphics();
    g.fillStyle(0xb9cdb5,1);g.fillRoundedRect(6,6,468,468,24);
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      g.fillStyle((r+c)%2?0xe7eee0:0xf1f3e7,1);g.fillRoundedRect(PAD+c*CELL+2,PAD+r*CELL+2,52,52,11);
    }
    this.paint(this.engine.board);
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
  private paint(board:Tile[][],fall=false) {
    this.pieces.flat().forEach(p=>p.destroy());this.pieces=[];
    board.forEach((row,r)=>{this.pieces[r]=[];row.forEach((tile,c)=>{
      const point=this.point({row:r,col:c});const item=this.add.container(point.x,point.y);
      if(tile.special){
        const halo=this.add.graphics();halo.fillStyle(tile.special==='rainbow'?0xf9dc9f:0xffe8a7,.95);halo.fillRoundedRect(-25,-25,50,50,13);halo.lineStyle(2,0xf6c364,.85);halo.strokeRoundedRect(-25,-25,50,50,13);item.add(halo);
      }
      const image=this.add.image(0,0,tileNames[tile.kind]).setDisplaySize(43,43);item.add(image);
      if(tile.special){
        const mark=this.add.graphics().lineStyle(3,0xfffaf0,1);
        if(tile.special==='row') {mark.lineBetween(-17,-5,17,-5);mark.lineBetween(-17,3,17,3);}
        if(tile.special==='column') {mark.lineBetween(-5,-17,-5,17);mark.lineBetween(3,-17,3,17);}
        if(tile.special==='bomb') {mark.fillStyle(0xfff5db);mark.fillCircle(13,14,8);mark.lineStyle(2,0xc78f48);mark.strokeCircle(13,14,8);}
        if(tile.special==='rainbow') {const colors=[0xe67883,0xe9bd62,0x8db87b,0x849ccc,0xbd93ce];colors.forEach((color,i)=>{mark.lineStyle(3,color);mark.strokeCircle(0,0,17+i*1.7);});}
        item.add(mark);
      }
      this.pieces[r][c]=item;
      if(fall){item.y-=20;item.alpha=.25;this.tweens.add({targets:item,y:point.y,alpha:1,duration:200,delay:c*12,ease:'Back.easeOut'});}
    });});
  }
  private tap(pos:Position) {
    this.resetHint();this.hooks.audio.play('tap');
    if(this.selected&&Math.abs(pos.row-this.selected.row)+Math.abs(pos.col-this.selected.col)===1){void this.attempt(this.selected,pos);return;}
    this.clearSelection();this.selected=pos;this.pieces[pos.row][pos.col].setScale(1.12);
    this.tweens.add({targets:this.pieces[pos.row][pos.col],y:this.point(pos).y-3,duration:180,yoyo:true,repeat:1});
  }
  private clearSelection(){if(this.selected)this.pieces[this.selected.row]?.[this.selected.col]?.setScale(1);this.selected=undefined;}
  private wait(ms:number){return new Promise<void>(resolve=>this.time.delayedCall(ms,()=>resolve()));}
  private async attempt(a:Position,b:Position) {
    if(this.busy||this.finished)return;
    this.busy=true;this.hintTimer?.remove();this.clearSelection();this.hooks.onStart();
    const x=this.pieces[a.row][a.col],y=this.pieces[b.row][b.col];
    const result=this.engine.swap(a,b);
    this.hooks.audio.play(result.valid?'swap':'invalid');
    this.tweens.add({targets:x,...this.point(b),duration:130,ease:'Sine.easeInOut'});
    this.tweens.add({targets:y,...this.point(a),duration:130,ease:'Sine.easeInOut'});
    await this.wait(140);
    if(!result.valid){
      this.tweens.add({targets:x,...this.point(a),duration:130});this.tweens.add({targets:y,...this.point(b),duration:130});await this.wait(150);
    }else {
      for(let i=0;i<result.steps.length;i++){
        const step=result.steps[i];this.paint(step.before);
        if(!step.removed.length){this.hooks.onNotice('noMoves');this.paint(step.after,true);await this.wait(250);continue;}
        const special=step.created?.length||step.removed.some(p=>step.before[p.row][p.col].special);
        this.hooks.audio.play(special?'special':'match',i+1);
        this.hooks.onNotice(special?'special':i>0?'chain':'matched');
        step.removed.forEach(p=>{
          const item=this.pieces[p.row][p.col];this.tweens.add({targets:item,scale:.25,alpha:0,duration:180,ease:'Back.easeIn'});
          const dot=this.add.circle(item.x,item.y,5,[0xf7b0a7,0xf4d488,0xa6c88e][i%3]);
          this.tweens.add({targets:dot,y:item.y-30,alpha:0,scale:2,duration:400,onComplete:()=>dot.destroy()});
        });
        await this.wait(200);this.paint(step.after,true);await this.wait(300);
      }
      this.hooks.onMove(result.collected,result.score,result.steps.length);
    }
    this.busy=false;if(!this.finished)this.resetHint();
  }
  stopPlaying(){this.finished=true;this.hintTimer?.remove();this.clearSelection();}
  shuffle():boolean {if(this.busy||this.finished)return false;this.clearSelection();this.engine.shuffle();this.paint(this.engine.board,true);this.hooks.audio.play('special');this.resetHint();return true;}
  canLeave(){return !this.busy;}
  private resetHint(){this.hintTimer?.remove();this.hintTimer=this.time.delayedCall(7500,()=>this.showHint());}
  private showHint(){
    if(this.busy||this.finished||this.selected)return;
    for(let r=0;r<8;r++)for(let c=0;c<8;c++)for(const b of [{row:r+1,col:c},{row:r,col:c+1}]){
      if(b.row>=8||b.col>=8)continue;
      const a={row:r,col:c};const board=this.engine.board;
      const x=board[r][c],y=board[b.row][b.col];
      let valid=x.special==='rainbow'||y.special==='rainbow'||Boolean(x.special&&y.special);
      if(!valid){
        [board[r][c],board[b.row][b.col]]=[y,x];valid=this.engine.findMatches().some(p=>(p.row===r&&p.col===c)||(p.row===b.row&&p.col===b.col));[board[r][c],board[b.row][b.col]]=[x,y];
      }
      if(valid){this.tweens.add({targets:[this.pieces[a.row][a.col],this.pieces[b.row][b.col]],scale:1.1,duration:450,yoyo:true,repeat:1,ease:'Sine.easeInOut'});this.resetHint();return;}
    }
  }
}
