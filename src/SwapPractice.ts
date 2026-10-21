import {BoardEngine,seededRng,type Position,type SwapResult,type Tile} from './core';

const same=(a:Position,b:Position)=>a.row===b.row&&a.col===b.col;

/** 본 게임의 저장·보상·보드와 분리된 첫 교환 연습입니다. */
export class SwapPractice {
  private engine:BoardEngine;
  private targets:Position[];
  selected?:Position;
  result?:SwapResult;
  constructor(public readonly square=false){
    this.engine=new BoardEngine(3,3,seededRng(20261011),undefined,square?2:1);
    this.targets=square?[{row:1,col:1},{row:1,col:2}]:[{row:0,col:2},{row:1,col:2}];
    this.engine.board=(square?[[0,0,1],[0,2,0],[3,4,5]]:[[0,0,1],[2,3,0],[4,2,5]]).map(row=>row.map(kind=>({kind})));
  }
  get completed(){return Boolean(this.result?.valid);}
  get board():Tile[][] {return (this.result?.steps[0].before??this.engine.board).map(row=>row.map(tile=>({...tile!})));}
  isTarget(p:Position){return this.targets.some(target=>same(target,p));}
  select(p:Position):boolean {
    if(this.completed||!this.isTarget(p))return false;
    if(this.selected&&!same(this.selected,p))return this.swap(this.selected,p);
    this.selected=this.selected?undefined:{...p};return false;
  }
  swap(a:Position,b:Position):boolean {
    if(this.completed||same(a,b)||!this.isTarget(a)||!this.isTarget(b))return false;
    const result=this.engine.swap(a,b);
    if(!result.valid)return false;
    this.result=result;this.selected=undefined;return true;
  }
  swipe(a:Position,dx:number,dy:number):boolean {
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.hypot(dx,dy)<=16)return false;
    return this.swap(a,{row:a.row+(Math.abs(dy)>Math.abs(dx)?Math.sign(dy):0),col:a.col+(Math.abs(dx)>=Math.abs(dy)?Math.sign(dx):0)});
  }
}
