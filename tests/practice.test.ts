import {describe,expect,it} from 'vitest';
import {SwapPractice} from '../src/SwapPractice';

describe('첫 교환 실습',()=>{
  it('표시된 블록을 어느 순서로 선택해도 실제 첫 제거는 딸기 3개입니다',()=>{
    for(const reverse of [false,true]){
      const lesson=new SwapPractice();
      const positions=reverse?[{row:1,col:2},{row:0,col:2}]:[{row:0,col:2},{row:1,col:2}];
      expect(lesson.select(positions[0])).toBe(false);
      expect(lesson.select(positions[1])).toBe(true);
      expect(lesson.result?.steps[0].removed).toEqual([{row:0,col:0},{row:0,col:1},{row:0,col:2}]);
      expect(lesson.result?.steps[0].before[0].map(tile=>tile.kind)).toEqual([0,0,0]);
      expect(lesson.result?.collected[0]).toBeGreaterThanOrEqual(3);
    }
  });
  it('다른 블록·같은 블록 교환은 진행하지 않으며 선택을 취소할 수 있습니다',()=>{
    const lesson=new SwapPractice(), before=JSON.stringify(lesson.board);
    expect(lesson.swap({row:0,col:0},{row:0,col:1})).toBe(false);
    expect(lesson.swap({row:0,col:2},{row:0,col:2})).toBe(false);
    lesson.select({row:0,col:2});lesson.select({row:0,col:2});
    expect(lesson.selected).toBeUndefined();expect(lesson.completed).toBe(false);
    expect(JSON.stringify(lesson.board)).toBe(before);
  });
  it('위·아래 스와이프만 완료하며 짧거나 옆으로 민 입력은 보드를 바꾸지 않습니다',()=>{
    for(const [pos,dx,dy] of [[{row:0,col:2},0,60],[{row:1,col:2},0,-60]] as const){
      expect(new SwapPractice().swipe(pos,dx,dy)).toBe(true);
    }
    const lesson=new SwapPractice(), before=JSON.stringify(lesson.board);
    for(const [dx,dy] of [[0,16],[60,0],[-60,0],[0,-60],[NaN,60]])expect(lesson.swipe({row:0,col:2},dx,dy)).toBe(false);
    expect(JSON.stringify(lesson.board)).toBe(before);
  });
  it('성공 후 중복 입력은 다시 실행하지 않으며 새 연습은 독립된 보드입니다',()=>{
    const lesson=new SwapPractice();lesson.swipe({row:0,col:2},0,50);
    const result=lesson.result;
    expect(lesson.swipe({row:1,col:2},0,-50)).toBe(false);
    expect(lesson.result).toBe(result);
    const fresh=new SwapPractice();expect(fresh.completed).toBe(false);
    expect(fresh.board[0].map(tile=>tile.kind)).toEqual([0,0,1]);
  });
});
