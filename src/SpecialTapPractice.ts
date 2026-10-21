import {BoardEngine,seededRng,type Position,type SwapResult,type Tile} from './core';

/** 교환 실습과 본판에서 분리된, 한 번만 실행하는 특수 탭 연습입니다. */
export class SpecialTapPractice {
  private engine=new BoardEngine(3,3,seededRng(20261021),undefined,1);
  result?:SwapResult;
  constructor(){
    this.engine.board=[[0,1,2],[3,4,5],[1,2,0]].map(row=>row.map(kind=>({kind})));
    this.engine.board[1][1]!.special='row';
  }
  get completed(){return Boolean(this.result?.valid);}
  get board():Tile[][] {return (this.result?.steps[0].before??this.engine.board).map(row=>row.map(tile=>({...tile!})));}
  isTarget(p:Position){return p.row===1&&p.col===1;}
  tap(p:Position):boolean {
    if(this.completed||!this.isTarget(p))return false;
    const result=this.engine.activate(p);
    if(!result.valid)return false;
    this.result=result;return true;
  }
}
