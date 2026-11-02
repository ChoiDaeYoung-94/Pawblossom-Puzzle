import {describe,expect,it,vi} from 'vitest';
import {createCallbackCloseReceipt} from './helpers/callbackCloseReceipt';

describe('callback close 반환 영수증',()=>{
  it('참조가 없으면 not-attempted이며 생성자 내부 handle 상태를 추정하지 않음',()=>{
    const probe=createCallbackCloseReceipt(true);probe.close(undefined);expect(probe.receipt).toEqual({outcome:'not-attempted'});
  });
  it('같은 객체의 close를 한 번만 호출한 뒤 returned를 기록',()=>{
    const probe=createCallbackCloseReceipt(true),resource={close:vi.fn(function(this:unknown){expect(this).toBe(resource);})};
    probe.close(resource);expect(resource.close).toHaveBeenCalledTimes(1);expect(probe.receipt).toEqual({outcome:'returned'});
  });
  it('close 오류는 같은 identity로 전파하며 원문을 DTO에 복사하지 않음',()=>{
    const probe=createCallbackCloseReceipt(true),error=new Error('private-close-message'),close=vi.fn(()=>{throw error;});
    let caught;try{probe.close({close});}catch(value){caught=value;}
    expect(caught).toBe(error);expect(close).toHaveBeenCalledTimes(1);expect(probe.receipt).toEqual({outcome:'threw'});
    expect(JSON.stringify(probe.receipt)).not.toContain('private-close-message');
  });
  it('비진단 close 호출과 오류 동작을 유지하며 영수증을 만들지 않음',()=>{
    const probe=createCallbackCloseReceipt(false),close=vi.fn();probe.close({close});expect(close).toHaveBeenCalledTimes(1);expect(probe.receipt).toBeUndefined();
    const error=new Error('private-disabled');expect(()=>probe.close({close(){throw error;}})).toThrow(error);expect(probe.receipt).toBeUndefined();
  });
  it('finally 전 만든 결과도 finally 뒤 직렬화할 때 최종 close 반환을 포함',()=>{
    const probe=createCallbackCloseReceipt(true);
    const run=()=>{try{return {kind:'completed',diagnostic:{close:probe.receipt}};}finally{probe.close({close(){}});}};
    expect(structuredClone(run())).toEqual({kind:'completed',diagnostic:{close:{outcome:'returned'}}});
  });
});
