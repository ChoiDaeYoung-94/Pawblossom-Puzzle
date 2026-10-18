import {describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {createCallbackChildScope,finishCallbackTest} from './helpers/callbackChild';

class FakeChild extends EventEmitter {
  pid:number|undefined=123;
  sendCallback:((error:Error|null)=>void)|undefined;
  send=vi.fn((_data:unknown,callback:(error:Error|null)=>void)=>{this.sendCallback=callback;return true;});
  kill=vi.fn(()=>true);
  asProcess(){return this as unknown as ChildProcess;}
  end(code:number|null=0,signal:NodeJS.Signals|null=null){this.emit('exit',code,signal);this.emit('close',code,signal);}
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function setup(onBusy?:()=>void){const scope=createCallbackChildScope(),child=new FakeChild(),job=scope.track(child.asProcess(),{},onBusy);return {scope,child,job};}

describe('callback fork 종료와 정리 순서',()=>{
  it.each([false,true])('결과 수신=%s: 실제 close 전에는 DB·폴더를 정리하지 않고 반복 취소를 공유',async received=>{
    const busy=vi.fn(),{scope,child,job}=setup(busy),order:string[]=[];
    if(received)child.emit('message',{kind:'completed'});
    const cleanup=finishCallbackTest(scope,{
      terminateWorkers:async()=>{order.push('worker');},releaseLocks:()=>{order.push('lock');},
      closeParents:()=>{order.push('db');},removeFolders:()=>{order.push('rm');},
    });
    const first=job.cancelAndWait();expect(job.cancelAndWait()).toBe(first);expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('message',{kind:'worker-open-busy'});expect(busy).not.toHaveBeenCalled();
    await flush();expect(order).toEqual([]);expect(scope.size).toBe(1);
    child.emit('exit',null,'SIGTERM');await flush();expect(order).toEqual([]);
    child.emit('close',null,'SIGTERM');await first;await cleanup;
    await expect(job.output).rejects.toThrow('callback-child-cancelled');expect(scope.size).toBe(0);
    expect(order).toEqual(['worker','lock','db','rm']);expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it('정상 최종 결과를 그대로 반환하되 close까지 기다리고 종료 요청은 보내지 않음',async()=>{
    const {scope,child,job}=setup(),value={kind:'completed',diagnostic:{openAttempts:2,failures:[{stage:'open',sqlite:'busy'}]}};
    let returned=false;void job.output.then(()=>{returned=true;});child.emit('message',value);
    child.emit('exit',0,null);await flush();expect(returned).toBe(false);expect(scope.size).toBe(1);
    child.emit('close',0,null);expect(await job.output).toBe(value);expect(scope.size).toBe(0);
    await job.cancelAndWait();expect(child.kill).not.toHaveBeenCalled();
  });
  it.each([[0,null,'no-result'],[3,null,'exit-failed'],[null,'SIGTERM','exit-failed']] as const)('최종 결과 없이 종료 code=%s signal=%s',async(code,signal,reason)=>{
    const {child,job}=setup();child.end(code,signal);await expect(job.output).rejects.toThrow('callback-child-'+reason);expect(child.kill).not.toHaveBeenCalled();
  });
  it('exit(0)만으로 결과 누락을 판정하지 않고 IPC가 닫히는 close까지 대기',async()=>{
    const {scope,child,job}=setup();let rejected=false;void job.result.catch(()=>{rejected=true;});
    child.emit('exit',0,null);await flush();expect(rejected).toBe(false);expect(scope.size).toBe(1);
    child.emit('close',0,null);await expect(job.output).rejects.toThrow(/^callback-child-no-result$/);expect(child.kill).not.toHaveBeenCalled();
  });
  it('exit(0) 뒤 drain 중 받은 최종 IPC도 그대로 반환하며 close 전에는 미완료',async()=>{
    const {scope,child,job}=setup(),value={kind:'completed'};let returned=false;void job.output.then(()=>{returned=true;});
    child.emit('exit',0,null);child.emit('message',value);await flush();expect(returned).toBe(false);expect(scope.size).toBe(1);
    child.emit('close',0,null);expect(await job.output).toBe(value);expect(scope.size).toBe(0);expect(child.kill).not.toHaveBeenCalled();
  });
  it('spawn 오류로 exit가 없어도 close를 기다려 완료',async()=>{
    const scope=createCallbackChildScope(),child=new FakeChild();child.pid=undefined;
    const job=scope.track(child.asProcess(),{});child.emit('error',new Error('원문 오류는 노출하지 않음'));
    await flush();expect(scope.size).toBe(1);expect(child.kill).not.toHaveBeenCalled();
    child.emit('close',-2,null);await expect(job.output).rejects.toThrow(/^callback-child-process-error$/);expect(scope.size).toBe(0);
  });
  it.each(['throw','callback'])('send %s 오류는 즉시 관측하고 자식 close를 기다림',async mode=>{
    const scope=createCallbackChildScope(),child=new FakeChild(),unhandled=vi.fn();
    if(mode==='throw')child.send.mockImplementation(()=>{throw new Error('비공개 송신 오류');});
    process.on('unhandledRejection',unhandled);
    try{
      const job=scope.track(child.asProcess(),{});
      if(mode==='callback')child.sendCallback?.(new Error('비공개 송신 오류'));
      await flush();expect(unhandled).not.toHaveBeenCalled();expect(child.kill).toHaveBeenCalledTimes(1);expect(scope.size).toBe(1);
      child.end(null,'SIGTERM');await expect(job.output).rejects.toThrow(/^callback-child-send-failed$/);expect(scope.size).toBe(0);
    }finally{process.off('unhandledRejection',unhandled);}
  });
  it('BUSY 콜백 오류 뒤에도 종료를 기다리고 늦은 BUSY를 무시',async()=>{
    const busy=vi.fn(()=>{throw new Error('비공개 콜백 오류');}),{child,job}=setup(busy);
    child.emit('message',{kind:'worker-open-busy'});await flush();child.emit('message',{kind:'worker-open-busy'});
    expect(busy).toHaveBeenCalledTimes(1);expect(child.kill).toHaveBeenCalledTimes(1);
    child.end(null,'SIGTERM');await expect(job.output).rejects.toThrow(/^callback-child-busy-callback-failed$/);
  });
  it('최종 결과 뒤의 프로세스 오류를 정상 완료로 반환하지 않음',async()=>{
    const {child,job}=setup();child.emit('message',{kind:'completed'});child.emit('error',new Error('비공개 프로세스 오류'));
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.end();await expect(job.output).rejects.toThrow(/^callback-child-process-error$/);
  });
  it('최종 결과 뒤 송신 콜백 오류도 취소하고 close 뒤 고정 오류로 반환',async()=>{
    const {scope,child,job}=setup();child.emit('message',{kind:'completed'});child.sendCallback?.(new Error('비공개 송신 오류'));
    expect(child.kill).toHaveBeenCalledTimes(1);expect(scope.size).toBe(1);
    child.end(null,'SIGTERM');await expect(job.output).rejects.toThrow(/^callback-child-send-failed$/);
  });
  it('최종 결과 없는 IPC 종료도 취소 후 close를 기다림',async()=>{
    const {child,job}=setup();child.emit('disconnect');await flush();expect(child.kill).toHaveBeenCalledTimes(1);
    child.end(null,'SIGTERM');await expect(job.output).rejects.toThrow(/^callback-child-disconnected$/);
  });
  it.each(['false','throw'])('kill %s는 종료 증거로 간주하지 않음',async mode=>{
    const {scope,child,job}=setup();if(mode==='false')child.kill.mockReturnValue(false);else child.kill.mockImplementation(()=>{throw new Error('비공개 종료 오류');});
    let joined=false;const join=job.cancelAndWait();void join.then(()=>{joined=true;});await flush();
    expect(joined).toBe(false);expect(scope.size).toBe(1);expect(job.cancelAndWait()).toBe(join);expect(child.kill).toHaveBeenCalledTimes(1);
    child.end(null,'SIGTERM');await join;await expect(job.output).rejects.toThrow(/^callback-child-cancelled$/);
  });
  it('kill 중 동기 종료가 발생해도 같은 조인과 종료 요청 1회를 유지',async()=>{
    const {child,job}=setup();let nested:Promise<void>|undefined;
    child.kill.mockImplementation(()=>{nested=job.cancelAndWait();child.end(null,'SIGTERM');return true;});
    const join=job.cancelAndWait();expect(nested).toBe(join);await join;expect(child.kill).toHaveBeenCalledTimes(1);
    await expect(job.output).rejects.toThrow(/^callback-child-cancelled$/);
  });
  it.each(['lock','db'])('%s 정리 오류가 있으면 부모 정리까지 시도하고 폴더는 보존',async failure=>{
    const scope=createCallbackChildScope(),order:string[]=[];
    await expect(finishCallbackTest(scope,{
      terminateWorkers:async()=>{order.push('worker');},releaseLocks:()=>{order.push('lock');if(failure==='lock')throw new Error('비공개 잠금 오류');},
      closeParents:()=>{order.push('db');if(failure==='db')throw new Error('비공개 DB 오류');},removeFolders:()=>{order.push('rm');},
    })).rejects.toThrow(/^callback-parent-cleanup-failed$/);
    expect(order).toEqual(['worker','lock','db']);
  });
});
