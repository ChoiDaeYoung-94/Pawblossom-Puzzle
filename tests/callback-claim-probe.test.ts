import {describe,it,expect,vi} from 'vitest';
import {createCallbackClaimProbe} from './helpers/callbackClaimProbe';

describe('테스트 수신함 최초 선점 BEGIN 관측',()=>{
  it('생성자·다른 SQL을 관측하지 않고 처리 시작 뒤 최초 BEGIN만 한 번 호출합니다',()=>{
    let now=10;const probe=createCallbackClaimProbe(true,()=>now),first=vi.fn(()=>({exact:true}));
    probe.observe('BEGIN IMMEDIATE',first);expect(probe.snapshot()).toBeUndefined();probe.arm();
    probe.observe('COMMIT',()=>{});expect(probe.snapshot()).toBeUndefined();const returned={private:'never-export'};
    expect(probe.observe('BEGIN IMMEDIATE',()=>{now=25;return returned;})).toBe(returned);
    expect(probe.snapshot()).toEqual({stage:'inbox-claim-begin',outcome:'returned',elapsedMs:15,primaryCode:null,extendedCode:null});
    const frozen=probe.snapshot();probe.arm();probe.observe('BEGIN IMMEDIATE',first);expect(first).toHaveBeenCalledTimes(2);expect(probe.snapshot()).toEqual(frozen);
    frozen!.outcome='threw';expect(probe.snapshot()?.outcome).toBe('returned');
  });
  it.each([5,6,261,517])('숫자 SQLite 코드%s와 소요시간만 남기고 같은 예외를 그대로 던집니다',errcode=>{
    let now=100;const probe=createCallbackClaimProbe(true,()=>now),error=Object.assign(new Error('private SQL /private/path secret'),{code:'ERR_SQLITE_ERROR',errcode}),call=vi.fn(()=>{now=600;throw error;});probe.arm();
    let caught;try{probe.observe('BEGIN IMMEDIATE',call);}catch(value){caught=value;}
    expect(caught).toBe(error);expect(call).toHaveBeenCalledOnce();expect(probe.snapshot()).toEqual({stage:'inbox-claim-begin',outcome:'threw',elapsedMs:500,primaryCode:errcode&255,extendedCode:errcode});expect(JSON.stringify(probe.snapshot())).not.toMatch(/private|secret|SQL|BEGIN/);
  });
  it.each([undefined,null,{},'private-error',new Error('private-message')])('비SQLite 오류를 문자열화하거나 원문으로 내보내지 않습니다',error=>{
    const probe=createCallbackClaimProbe(true,()=>1);probe.arm();let caught;try{probe.observe('BEGIN IMMEDIATE',()=>{throw error;});}catch(value){caught=value;}
    expect(caught).toBe(error);expect(probe.snapshot()).toMatchObject({outcome:'threw',primaryCode:null,extendedCode:null});
  });
  it('시계나 오류 getter가 실패해도 원래 호출·반환·예외를 바꾸지 않습니다',()=>{
    const probe=createCallbackClaimProbe(true,()=>{throw Error('clock');});probe.arm();const object={};expect(probe.observe('BEGIN IMMEDIATE',()=>object)).toBe(object);expect(probe.snapshot()?.elapsedMs).toBeNull();
    const getter=new Proxy({},{get(){throw Error('getter');}}),second=createCallbackClaimProbe(true,()=>NaN);second.arm();let caught;try{second.observe('BEGIN IMMEDIATE',()=>{throw getter;});}catch(value){caught=value;}expect(caught).toBe(getter);expect(second.snapshot()).toMatchObject({elapsedMs:null,primaryCode:null,extendedCode:null});
  });
  it('diagnostics=false는 시계·추가 SQL·추가 관측 없이 원래 함수를 한 번 호출합니다',()=>{
    const clock=vi.fn(()=>1),probe=createCallbackClaimProbe(false,clock),call=vi.fn(()=>42);probe.arm();expect(probe.observe('BEGIN IMMEDIATE',call)).toBe(42);expect(call).toHaveBeenCalledOnce();expect(clock).not.toHaveBeenCalled();expect(probe.snapshot()).toBeUndefined();
  });
});
