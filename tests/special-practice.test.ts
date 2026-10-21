import {describe,expect,it,vi} from 'vitest';
import {BoardEngine} from '../src/core';
import {SpecialTapPractice} from '../src/SpecialTapPractice';
import {SwapPractice} from '../src/SwapPractice';

describe('선택형 특수 탭 실습',()=>{
  it('매치 없는 3×3 보드의 중앙 가로 특수 한 개를 실제 엔진으로 한 번 사용합니다',()=>{
    const lesson=new SpecialTapPractice();
    expect(lesson.board.flat().filter(tile=>tile.special)).toEqual([{kind:4,special:'row'}]);
    const engine=new BoardEngine(3,3,()=>0.3,{board:lesson.board,leaves:Array.from({length:3},()=>[0,0,0])});
    expect(engine.findMatches()).toEqual([]);
    const activate=vi.spyOn(BoardEngine.prototype,'activate');
    try{
      expect(lesson.tap({row:1,col:1})).toBe(true);
      expect(activate).toHaveBeenCalledExactlyOnceWith({row:1,col:1});
      expect(lesson.result?.steps[0].removed).toEqual(expect.arrayContaining([{row:1,col:0},{row:1,col:1},{row:1,col:2}]));
      expect(lesson.result?.steps[0].removed).toHaveLength(3);
      expect(lesson.result?.steps[0].effects).toEqual([{row:1,col:1,special:'row'}]);
      expect(lesson.completed).toBe(true);
      const result=lesson.result,board=lesson.board;
      expect(lesson.tap({row:1,col:1})).toBe(false);
      expect(activate).toHaveBeenCalledTimes(1);expect(lesson.result).toBe(result);expect(lesson.board).toBe(board);
    }finally{activate.mockRestore();}
  });
  it('중앙 외 모든 칸과 잘못된 좌표는 보드·결과를 바꾸지 않습니다',()=>{
    const lesson=new SpecialTapPractice(),before=JSON.stringify(lesson.board);
    for(const row of [-1,0,1,2,3,NaN])for(const col of [-1,0,1,2,3,Infinity]){
      if(row===1&&col===1)continue;
      expect(lesson.tap({row,col})).toBe(false);
    }
    expect(lesson.result).toBeUndefined();expect(JSON.stringify(lesson.board)).toBe(before);
  });
  it('낙하·보충 후에도 첫 before와 removed만 표시하며 교환 결과와 난수 흐름을 분리합니다',()=>{
    const swap=new SwapPractice();swap.swipe({row:0,col:2},0,60);
    const before=JSON.stringify(swap),result=swap.result;
    const lesson=new SpecialTapPractice(),initial=JSON.stringify(lesson.board);
    lesson.tap({row:1,col:1});
    expect(JSON.stringify(lesson.board)).toBe(initial);
    expect(lesson.board).toBe(lesson.result?.steps[0].before);
    expect(JSON.stringify(swap)).toBe(before);expect(swap.result).toBe(result);expect(swap.completed).toBe(true);
    const fresh=new SpecialTapPractice();expect(fresh.completed).toBe(false);expect(JSON.stringify(fresh.board)).toBe(initial);
  });
});
