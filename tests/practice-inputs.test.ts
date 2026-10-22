import {describe,expect,it,vi} from 'vitest';
import {bindPracticeBoard} from '../src/bindPracticeInputs';
import {SwapPractice} from '../src/SwapPractice';
import {SpecialTapPractice} from '../src/SpecialTapPractice';

// DOM 이벤트/캡처 대역. 실제 브라우저 capture와 Enter/Space는 별도 Chrome QA에서 확인합니다.
function harness(){
  const lesson=new SwapPractice(),tap=vi.fn(pos=>lesson.select(pos)),swipe=vi.fn((pos,dx,dy)=>lesson.swipe(pos,dx,dy));
  const make=(row:number)=>({dataset:{row:String(row),col:'2'},disabled:false,setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,top:row*60,right:60,bottom:row*60+60})});
  const buttons=[make(0),make(1)] as unknown as HTMLButtonElement[];
  const board={isConnected:true,querySelectorAll:()=>buttons,getBoundingClientRect:()=>({left:0,top:0,right:180,bottom:180})};
  const binding=bindPracticeBoard(board as unknown as HTMLElement,{tap,swipe});
  const send=(type:string,row=0,values:Record<string,unknown>={})=>{
    const event={pointerId:1,button:0,isPrimary:true,clientX:30,clientY:row*60+30,detail:1,preventDefault:vi.fn(),...values};
    const handler=buttons[row][`on${type}` as keyof HTMLButtonElement];if(typeof handler==='function')(handler as Function)(event);
  };
  const click=(row=0)=>{send('pointerdown',row);send('pointerup',row);send('click',row);};
  return {lesson,tap,swipe,board,buttons,binding,send,click};
}
describe('실습 정상 종료와 취소 뒤 click 차단',()=>{
  it.each(['pointercancel','lostpointercapture'])('%s와 후속 합성 click은 무변경이며 다음 정상 탭이 회복합니다',type=>{
    const h=harness(),before=JSON.stringify(h.lesson.board);h.send('pointerdown');h.send(type);h.send('pointerup');h.send('click');
    expect(h.tap).not.toHaveBeenCalled();expect(h.lesson.selected).toBeUndefined();expect(JSON.stringify(h.lesson.board)).toBe(before);
    h.click();expect(h.lesson.selected).toEqual({row:0,col:2});h.click(1);expect(h.lesson.completed).toBe(true);
  });
  it('다른 ID 취소/종료와 보조 포인터/버튼은 주체를 바꾸지 않습니다',()=>{
    const h=harness();h.send('pointerdown');h.send('pointerdown',1,{pointerId:2,isPrimary:false});
    h.send('pointercancel',1,{pointerId:2});h.send('pointerup',1,{pointerId:2});h.send('click',1,{pointerId:2});
    h.send('pointerup',0,{button:2});h.send('click',0,{button:2});expect(h.tap).not.toHaveBeenCalled();
    h.send('pointerup');h.send('lostpointercapture');h.send('click');expect(h.tap).toHaveBeenCalledOnce();
  });
  it('정상 up은 click이 없어도 실행하고 같은/다른 ID click은 중복 실행하지 않습니다',()=>{
    const h=harness();h.send('pointerdown');h.send('pointerup');expect(h.tap).toHaveBeenCalledOnce();
    h.send('click',0,{pointerId:2});h.send('click');expect(h.tap).toHaveBeenCalledOnce();
  });
  it('capture 예외·DOM 교체·dispose 후 이벤트는 무변경입니다',()=>{
    const h=harness();h.buttons[0].setPointerCapture=()=>{throw Error('capture 실패');};h.send('pointerdown');h.send('pointerup');h.send('click');expect(h.tap).not.toHaveBeenCalled();
    h.buttons[0].setPointerCapture=()=>{};h.send('pointerdown');h.board.isConnected=false;h.send('pointerup');h.send('click');expect(h.tap).not.toHaveBeenCalled();
    h.board.isConnected=true;h.send('pointerdown');h.binding.dispose();h.send('pointerup');h.send('click',0,{detail:0});expect(h.tap).not.toHaveBeenCalled();expect(h.buttons[0].onclick).toBeNull();
  });
  it.each([['가로',90,30,false],['세로',30,90,true]] as const)('%s 스와이프 뒤 click은 중복 실행하지 않습니다',(_,clientX,clientY,done)=>{
    const h=harness();h.send('pointerdown');h.send('pointerup',0,{clientX,clientY});h.send('click');expect(h.swipe).toHaveBeenCalledOnce();expect(h.tap).not.toHaveBeenCalled();expect(h.lesson.completed).toBe(done);
  });
  it('캡처로 보낸 버튼 밖 짧은 종료도 click을 승인하지 않습니다',()=>{
    const h=harness();h.send('pointerdown',0,{clientX:59});h.send('pointerup',0,{clientX:62});h.send('click');expect(h.tap).not.toHaveBeenCalled();
  });
  it('정상 capture의 보드 밖 긴 스와이프도 바로 이웃을 한 번만 실행합니다',()=>{
    const h=harness();h.send('pointerdown');h.send('pointerup',0,{clientY:200});h.send('click');h.send('pointerup',0,{clientY:200});
    expect(h.swipe).toHaveBeenCalledExactlyOnceWith({row:0,col:2},0,170);expect(h.tap).not.toHaveBeenCalled();expect(h.lesson.completed).toBe(true);
  });
  it.each(['pointercancel','lostpointercapture'])('보드 밖 종료라도 %s 뒤에는 스와이프하지 않습니다',type=>{
    const h=harness();h.send('pointerdown');h.send(type);h.send('pointerup',0,{clientY:200});h.send('click');
    expect(h.swipe).not.toHaveBeenCalled();expect(h.lesson.completed).toBe(false);
  });
  it('바깥 방향의 무효 이웃과 비유한 좌표는 실습 완료를 만들지 않습니다',()=>{
    const h=harness();h.send('pointerdown');h.send('pointerup',0,{clientY:-200});expect(h.lesson.completed).toBe(false);
    h.send('pointerdown');h.send('pointerup',0,{clientY:Infinity});expect(h.swipe).toHaveBeenCalledOnce();expect(h.tap).not.toHaveBeenCalled();
  });
  it('취소 뒤 detail=0 키보드 활성화는 두 칸 선택을 완료합니다',()=>{
    const h=harness();h.send('pointerdown');h.send('pointercancel');h.send('click',0,{detail:0,pointerId:-1});h.send('click',1,{detail:0,pointerId:-1});expect(h.lesson.completed).toBe(true);
  });
  it('활동 중단 cancel 뒤 늦은 up/click은 무실행이며 새 입력은 회복합니다',()=>{
    const h=harness();h.send('pointerdown');h.binding.cancel();h.send('pointerup');h.send('click');expect(h.tap).not.toHaveBeenCalled();
    h.click();expect(h.tap).toHaveBeenCalledOnce();
  });
});

describe('특수 탭 입력의 한 번 실행과 중단',()=>{
  function specialHarness(){
    const lesson=new SpecialTapPractice(),h=harness();h.binding.dispose();
    const button=h.buttons[0];button.dataset.row='1';button.dataset.col='1';
    const binding=bindPracticeBoard(h.board as unknown as HTMLElement,{tap:pos=>{lesson.tap(pos);},swipe:()=>{}});
    return {...h,lesson,binding};
  }
  it.each(['pointercancel','lostpointercapture','cancel','dispose'])('%s 뒤 늦은 up/click은 무변경입니다',type=>{
    const h=specialHarness(),before=JSON.stringify(h.lesson.board);h.send('pointerdown');
    if(type==='cancel'||type==='dispose')h.binding[type]();else h.send(type);
    h.send('pointerup');h.send('click');expect(h.lesson.completed).toBe(false);expect(JSON.stringify(h.lesson.board)).toBe(before);
    if(type!=='dispose'){h.click();expect(h.lesson.completed).toBe(true);}
  });
  it('가로·세로 스와이프와 후속 click은 실행하지 않고 키보드 활성화는 한 번 완료합니다',()=>{
    const h=specialHarness();
    for(const values of [{clientX:90},{clientY:90}]){h.send('pointerdown');h.send('pointerup',0,values);h.send('click');}
    expect(h.lesson.completed).toBe(false);
    h.send('click',0,{detail:0});const result=h.lesson.result;h.send('click',0,{detail:0});
    expect(h.lesson.completed).toBe(true);expect(h.lesson.result).toBe(result);
  });
});
