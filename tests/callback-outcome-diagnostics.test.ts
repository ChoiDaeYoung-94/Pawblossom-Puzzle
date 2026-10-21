import {describe,it,expect,vi} from 'vitest';
import {Worker} from 'node:worker_threads';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createCallbackOutcome,projectCallbackOutcome,runObservedCallback,callbackOutcomeEnvelope,createCallbackOutcomeTrace,receiveCallbackOutcome,callbackOutcomeContext} from './helpers/callbackOutcomeDiagnostics';

describe('callback 검사 전용 결과 관측',()=>{
  it.each([{kind:'voucher-recorded',newGrant:true},{kind:'voucher-recorded',newGrant:false},{kind:'rejected',code:'invalid-signature'},{kind:'service-error',code:'storage-unavailable'}])('정상 반환 참조와 호출1회 유지: %j',async result=>{
    const trace=createCallbackOutcome(),query={private:'synthetic-private-query'},processCallback=vi.fn(async(received:unknown)=>{expect(received).toBe(query);return result;}),close=vi.fn(),create=vi.fn(()=>({processCallback,close}));
    expect(await runObservedCallback(create,query,trace)).toBe(result);
    expect(create).toHaveBeenCalledTimes(1);expect(processCallback).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
    expect(trace).toMatchObject({stage:'close',resultStage:'callback',errorStage:null,kind:result.kind,closeOutcome:'returned',observationFailed:false,nativeObservation:'not-observed'});
    expect(trace.newGrant).toBe('newGrant' in result?result.newGrant:null);expect(trace.code).toBe('code' in result?result.code:null);
  });
  it('생성자 예외는 기존 worker-error, close 없음과 별도 단계',async()=>{
    const trace=createCallbackOutcome(),create=vi.fn(()=>{throw new Error('synthetic-private-constructor');});
    expect(await runObservedCallback(create,'synthetic-private-query',trace)).toEqual({kind:'worker-error'});
    expect(create).toHaveBeenCalledTimes(1);expect(trace).toMatchObject({kind:'worker-error',resultStage:'constructor',errorStage:'constructor',closeOutcome:'not-opened',nativeObservation:'not-observed'});
    expect(JSON.stringify(trace)).not.toContain('synthetic-private');
  });
  it.each(['sync','async'] as const)('callback %s 예외도 worker-error와 finally close1회',async mode=>{
    const trace=createCallbackOutcome(),close=vi.fn(),error=new Error('synthetic-private-callback');
    const processCallback=vi.fn(()=>{if(mode==='sync')throw error;return Promise.reject(error);});
    expect(await runObservedCallback(()=>({processCallback,close}),null,trace)).toEqual({kind:'worker-error'});
    expect(processCallback).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
    expect(trace).toMatchObject({resultStage:'callback',errorStage:'callback',kind:'worker-error',closeOutcome:'returned'});
  });
  it.each([false,true])('close 예외는 원래 결과/worker-error를 덮지 않음: %s',async callbackThrows=>{
    const trace=createCallbackOutcome(),result={kind:'voucher-recorded',newGrant:false},close=vi.fn(()=>{throw new Error('synthetic-private-close');});
    const returned=await runObservedCallback(()=>({processCallback:()=>{if(callbackThrows)throw new Error();return result;},close}),null,trace);
    expect(callbackThrows?returned:returned===result).toEqual(callbackThrows?{kind:'worker-error'}:true);
    expect(close).toHaveBeenCalledTimes(1);expect(trace.closeOutcome).toBe('threw');expect(trace.errorStage).toBe(callbackThrows?'callback':null);
  });
  it('결과 getter/관측 쓰기 실패가 실제 반환과 close를 바꾸지 않음',async()=>{
    const result={get kind(){throw new Error('synthetic-private-getter');}},trace=createCallbackOutcome(),close=vi.fn();
    expect(await runObservedCallback(()=>({processCallback:()=>result,close}),null,trace)).toBe(result);
    expect(trace.observationFailed).toBe(true);expect(trace.kind).toBe('unknown');expect(close).toHaveBeenCalledTimes(1);
    const frozen=Object.freeze(createCallbackOutcome()),normal={kind:'voucher-recorded',newGrant:true};
    expect(await runObservedCallback(()=>({processCallback:()=>normal,close}),null,frozen)).toBe(normal);
    expect(projectCallbackOutcome(frozen).observationFailed).toBe(true);expect(close).toHaveBeenCalledTimes(2);
  });
  it('고정 허용목록·누락·boolean만 투영하고 원문을 복사하지 않음',()=>{
    const secret='synthetic-private-query-owner-path-SQL-stack',raw={...createCallbackOutcome(),stage:secret,resultStage:secret,errorStage:secret,kind:'voucher-recorded',code:secret,newGrant:'false',closeOutcome:secret,query:secret,error:new Error(secret)};
    const projected=projectCallbackOutcome(raw);expect(projected).toMatchObject({stage:'unknown',resultStage:'unknown',errorStage:'unknown',code:'unknown',newGrant:null,closeOutcome:'not-observed',nativeObservation:'not-observed'});
    expect(JSON.stringify(projected)).not.toContain(secret);expect(projectCallbackOutcome(undefined).observationFailed).toBe(true);
    expect(projectCallbackOutcome({...raw,kind:secret,newGrant:true})).toMatchObject({kind:'unknown',newGrant:null});
    expect(projectCallbackOutcome({...createCallbackOutcome(),get code(){throw new Error(secret);}}).observationFailed).toBe(true);
  });
  it('원래 결과와 배열 index 유지·최대8행·미관측 report 구분',()=>{
    const trace=createCallbackOutcomeTrace(10),a={kind:'voucher-recorded',newGrant:false},b={kind:'rejected',code:'expired'},observed={...createCallbackOutcome(),stage:'close' as const,resultStage:'callback' as const,kind:'voucher-recorded' as const,newGrant:false,closeOutcome:'returned' as const};
    expect(receiveCallbackOutcome(callbackOutcomeEnvelope(a,observed),trace,3)).toBe(a);
    expect(receiveCallbackOutcome(b,trace,1)).toBe(b);expect(receiveCallbackOutcome(callbackOutcomeEnvelope(a,observed),trace,8)).toBe(a);
    expect(trace.workers).toHaveLength(8);expect(trace.truncated).toBe(true);expect(trace.workers[3]).toMatchObject({index:3,report:'received',newGrant:false});
    expect(trace.workers[1]).toMatchObject({index:1,report:'missing',kind:'unknown',closeOutcome:'not-observed',nativeObservation:'not-observed'});
    expect(trace.workers[0].report).toBe('missing');expect(JSON.parse(callbackOutcomeContext(trace)).workers).toHaveLength(8);
  });
  it('envelope 진단 getter/행 쓰기 실패도 원래 결과 유지·실패 명시',()=>{
    const trace=createCallbackOutcomeTrace(1),result={kind:'service-error',code:'storage-unavailable'};
    const envelope={kind:'synthetic-callback-outcome',result,get diagnostic(){throw new Error('synthetic-private-diagnostic');}};
    expect(receiveCallbackOutcome(envelope,trace,0)).toBe(result);expect(trace.workers[0]).toMatchObject({report:'invalid',observationFailed:true,kind:'unknown',nativeObservation:'not-observed'});
    Object.freeze(trace.workers);expect(receiveCallbackOutcome(callbackOutcomeEnvelope(result,createCallbackOutcome()),trace,0)).toBe(result);
    expect(JSON.parse(callbackOutcomeContext(trace)).observationFailed).toBe(true);
    const report=callbackOutcomeContext({get workers():never{throw new Error('synthetic-private-context');},truncated:false,observationFailed:false});
    expect(JSON.parse(report)).toEqual({workers:[],truncated:false,observationFailed:true});
    expect(report).not.toContain('synthetic-private');
    const secret='synthetic-private-flags';
    for(const badFlag of [secret,{raw:secret}]){
      const unknown=callbackOutcomeContext(Object.assign(createCallbackOutcomeTrace(0),{truncated:badFlag,observationFailed:badFlag}));
      expect(JSON.parse(unknown)).toEqual({workers:[],truncated:false,observationFailed:true});expect(unknown).not.toContain(secret);
    }
    const custom=createCallbackOutcomeTrace(1);Object.defineProperty(custom.workers,'slice',{value:()=>[secret]});
    expect(JSON.parse(callbackOutcomeContext(custom)).workers[0].report).toBe('missing');
    expect(callbackOutcomeContext(Object.assign(createCallbackOutcomeTrace(0),{workers:secret}))).not.toContain(secret);
  });
  it('opt-in 실제 worker는 생성자 실패 단계만 안전 envelope로 전송',async()=>{
    const worker=new Worker(new URL('./helpers/reward-ledger-worker.mjs',import.meta.url),{workerData:{diagnostics:true},execArgv:['--experimental-strip-types']});
    try{
      expect((await once(worker,'message'))[0]).toBe('ready');const output=once(worker,'message');worker.postMessage('go');
      const envelope=(await output)[0],trace=createCallbackOutcomeTrace(1);
      expect(receiveCallbackOutcome(envelope,trace,0)).toEqual({kind:'worker-error'});
      expect(trace.workers[0]).toMatchObject({report:'received',kind:'worker-error',resultStage:'constructor',errorStage:'constructor',closeOutcome:'not-opened',nativeObservation:'not-observed',observationFailed:false});
    }finally{await worker.terminate();}
  });
  it('기본 worker ready/go·raw 결과와 child IPC는 opt-in flag가 있어도 기존 유지',async()=>{
    const url=new URL('./helpers/reward-ledger-worker.mjs',import.meta.url);
    for(const data of [{},{diagnostics:true,action:'close'}]){
      const worker=new Worker(url,{workerData:data,execArgv:['--experimental-strip-types']});
      try{expect((await once(worker,'message'))[0]).toBe('ready');const output=once(worker,'message');worker.postMessage('go');expect((await output)[0]).toEqual({kind:'worker-error'});}
      finally{await worker.terminate();}
    }
    const child=fork(url,[],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','ignore','ipc']}),exit=once(child,'exit');
    try{const output=once(child,'message');child.send({diagnostics:true});expect((await output)[0]).toEqual({kind:'worker-error'});await exit;}
    finally{if(child.exitCode===null){child.kill();await exit;}}
  });
});
