import {describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {Worker} from 'node:worker_threads';
import {createCallbackParallelScope} from './helpers/callbackParallel';
import {createCallbackChildScope,finishCallbackTest} from './helpers/callbackChild';

class FakeWorker extends EventEmitter {
  ended=false;
  resolveTermination!:(code:number)=>void;
  termination=new Promise<number>(resolve=>this.resolveTermination=resolve);
  postMessage=vi.fn((_value:unknown)=>{});
  terminate=vi.fn(()=>this.termination);
  asWorker(){return this as unknown as Worker;}
  end(code=1){if(this.ended)return;this.ended=true;this.emit('exit',code);this.resolveTermination(code);}
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function setup(count=2){
  const scope=createCallbackParallelScope(),workers:FakeWorker[]=[],inputs:number[]=[];
  const output=scope.run(Array.from({length:count},(_,i)=>i),input=>{inputs.push(input);const worker=new FakeWorker();workers.push(worker);return worker.asWorker();});
  return {scope,workers,inputs,output};
}
async function cleanup(scope:ReturnType<typeof createCallbackParallelScope>,workers:FakeWorker[]){
  const joining=scope.cancelAllAndWait();await flush();workers.forEach(worker=>worker.end());await joining;expect(scope.size).toBe(0);
}

describe('callback parallel 준비·결과·실제 종료',()=>{
  it('8개 전체 ready 뒤 입력 순서 go, 역순 결과도 원래 순서·payload 그대로, exit 대기 없음',async()=>{
    const {scope,workers,inputs,output}=setup(8),sent:number[]=[];
    workers.forEach((worker,index)=>worker.postMessage.mockImplementation(value=>{expect(value).toBe('go');sent.push(index);}));
    for(let i=7;i>0;i--)workers[i].emit('message','ready');await flush();expect(sent).toEqual([]);
    workers[0].emit('message','ready');await flush();expect(sent).toEqual([0,1,2,3,4,5,6,7]);expect(inputs).toEqual(sent);
    const values=workers.map((_,index)=>({kind:index===0?'completed':'idle',diagnostic:{openAttempts:1,failures:[]}}));
    for(let i=7;i>=0;i--)workers[i].emit('message',values[i]);
    const result=await output;result.forEach((value,index)=>expect(value).toBe(values[index]));
    expect(scope.size).toBe(8);workers.forEach(worker=>expect(worker.terminate).not.toHaveBeenCalled());await cleanup(scope,workers);
  });
  it.each(['before-ready','after-ready','partial-ready','after-own-result'])('%s error가 batch 전체 미완료 대기를 거절',async phase=>{
    const {scope,workers,output}=setup();
    if(phase!=='before-ready')workers[0].emit('message','ready');
    if(phase==='after-ready')workers[1].emit('message','ready');
    if(phase==='after-own-result')workers[0].emit('message',{kind:'completed'});
    workers[0].emit('error',new Error('비공개 Worker 오류'));workers[1].emit('messageerror',new Error('후속 오류'));
    await expect(output).rejects.toThrow(/^callback-parallel-worker-error$/);
    workers.forEach(worker=>expect(worker.postMessage).not.toHaveBeenCalled());await cleanup(scope,workers);
  });
  it.each([false,true])('전체 ready/go 송신 뒤 자기 결과 수신=%s error도 다른 미완료 결과를 거절',async received=>{
    const {scope,workers,output}=setup();workers.forEach(worker=>worker.emit('message','ready'));await flush();
    workers.forEach(worker=>expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith('go'));
    if(received)workers[0].emit('message',{kind:'completed'});
    workers[0].emit('error',new Error('비공개 go 이후 오류'));
    await expect(output).rejects.toThrow(/^callback-parallel-worker-error$/);await cleanup(scope,workers);
  });
  it.each([['before-ready',0],['before-ready',1],['after-ready',0],['after-ready',1]] as const)('%s 무결과 exit%s도 즉시 거절',async(phase,code)=>{
    const {scope,workers,output}=setup();if(phase==='after-ready'){workers.forEach(worker=>worker.emit('message','ready'));await flush();}
    workers[0].end(code);await expect(output).rejects.toThrow(/^callback-parallel-incomplete-exit$/);
    await cleanup(scope,workers);expect(workers[0].terminate).not.toHaveBeenCalled();
  });
  it('go 송신 예외는 다음 송신을 멈추고 같은 batch를 거절',async()=>{
    const {scope,workers,output}=setup(3);workers[1].postMessage.mockImplementation(()=>{throw new Error('비공개 전송 오류');});
    workers.forEach(worker=>worker.emit('message','ready'));await expect(output).rejects.toThrow(/^callback-parallel-send-failed$/);
    expect(workers[0].postMessage).toHaveBeenCalledExactlyOnceWith('go');expect(workers[1].postMessage).toHaveBeenCalledTimes(1);expect(workers[2].postMessage).not.toHaveBeenCalled();
    await cleanup(scope,workers);
  });
  it.each(['before-ready','after-ready','partial-result'])('%s 취소가 pending을 정산하고 반복/재진입 조인을 공유',async phase=>{
    const {scope,workers,output}=setup();if(phase!=='before-ready'){workers.forEach(worker=>worker.emit('message','ready'));await flush();}
    if(phase==='partial-result')workers[0].emit('message',{kind:'completed'});
    let nested:Promise<void>|undefined;workers[0].terminate.mockImplementation(()=>{nested=scope.cancelAllAndWait();return workers[0].termination;});
    const join=scope.cancelAllAndWait();expect(scope.cancelAllAndWait()).toBe(join);await flush();expect(nested).toBe(join);
    workers.forEach(worker=>{worker.emit('message','ready');worker.emit('message',{kind:'completed'});expect(worker.terminate).toHaveBeenCalledTimes(1);});
    await expect(output).rejects.toThrow(/^callback-parallel-cancelled$/);let joined=false;void join.then(()=>{joined=true;});
    workers[0].end();await flush();expect(joined).toBe(false);workers[1].end();await join;expect(scope.size).toBe(0);
  });
  it('정상 결과 뒤에도 마지막 owned Worker exit 전에는 부모 DB·폴더 정리0회',async()=>{
    const {scope,workers,output}=setup(),order:string[]=[];workers.forEach(worker=>worker.emit('message','ready'));await flush();
    workers.forEach(worker=>worker.emit('message',{kind:'idle'}));await output;
    workers.forEach(worker=>worker.terminate.mockResolvedValue(1));
    const finishing=finishCallbackTest(createCallbackChildScope(),{
      terminateWorkers:()=>scope.cancelAllAndWait(),releaseLocks:()=>{order.push('lock');},closeParents:()=>{order.push('db');},removeFolders:()=>{order.push('rm');},
    });
    await flush();expect(order).toEqual([]);workers[0].end();await flush();expect(order).toEqual([]);
    workers[1].end();await finishing;expect(order).toEqual(['lock','db','rm']);
  });
  it.each(['throw','reject'])('terminate %s는 exit 증거가 아니며 정리 실패 때 DB·폴더를 보존',async mode=>{
    const {scope,workers,output}=setup(),close=vi.fn(),remove=vi.fn();
    workers[0].terminate.mockImplementation(()=>{if(mode==='throw')throw new Error('비공개 종료 오류');return Promise.reject(new Error('비공개 종료 오류'));});
    const finishing=finishCallbackTest(createCallbackChildScope(),{terminateWorkers:()=>scope.cancelAllAndWait(),releaseLocks:vi.fn(),closeParents:close,removeFolders:remove});
    void finishing.catch(()=>{});await flush();await expect(output).rejects.toThrow(/^callback-parallel-cancelled$/);
    expect(scope.size).toBe(2);expect(close).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
    workers.forEach(worker=>worker.end());await expect(finishing).rejects.toThrow(/^callback-parallel-cleanup-unconfirmed$/);
    expect(close).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
  });
  it('중간 생성자 예외에도 앞서 생성한 Worker를 즉시 소유·정리',async()=>{
    const scope=createCallbackParallelScope(),workers:FakeWorker[]=[];
    const output=scope.run([0,1,2,3],index=>{if(index===2)throw new Error('비공개 생성 오류');const worker=new FakeWorker();workers.push(worker);return worker.asWorker();});
    expect(scope.size).toBe(2);await expect(output).rejects.toThrow(/^callback-parallel-start-failed$/);await cleanup(scope,workers);
  });
  it('새 Worker 생성 중 이전 Worker 오류가 도착해도 새 ready/result를 남기지 않음',async()=>{
    const scope=createCallbackParallelScope(),workers:FakeWorker[]=[];
    const output=scope.run([0,1],index=>{if(index===1)workers[0].emit('error',new Error('비공개 오류'));const worker=new FakeWorker();workers.push(worker);return worker.asWorker();});
    await expect(output).rejects.toThrow(/^callback-parallel-worker-error$/);await cleanup(scope,workers);
  });
  it('messageerror도 원문 없이 고정 오류로 정산하고 지연 관측해도 unhandled rejection 없음',async()=>{
    const {scope,workers,output}=setup(),unhandled=vi.fn();process.on('unhandledRejection',unhandled);
    try{workers[0].emit('messageerror',new Error('비공개 역직렬화 오류'));await flush();expect(unhandled).not.toHaveBeenCalled();
      await expect(output).rejects.toThrow(/^callback-parallel-message-error$/);await cleanup(scope,workers);
    }finally{process.off('unhandledRejection',unhandled);}
  });
  it('최종 메시지 뒤 자연 exit와 정리용 exit1이 정상 결과를 바꾸지 않음',async()=>{
    const {scope,workers,output}=setup(1),value={kind:'completed'};workers[0].emit('message','ready');await flush();
    workers[0].emit('message',value);workers[0].end(0);expect((await output)[0]).toBe(value);expect(scope.size).toBe(0);
    await scope.cancelAllAndWait();expect(workers[0].terminate).not.toHaveBeenCalled();
  });
  it('정리 중 새 batch를 시작하지 않고 종료 확인 후 다음 batch는 독립 실행',async()=>{
    const {scope,workers,output}=setup(1),join=scope.cancelAllAndWait(),spawn=vi.fn(()=>new FakeWorker().asWorker());
    await expect(scope.run([0],spawn)).rejects.toThrow(/^callback-parallel-cleaning$/);expect(spawn).not.toHaveBeenCalled();
    await flush();await expect(output).rejects.toThrow(/^callback-parallel-cancelled$/);workers[0].end();await join;
    const next=new FakeWorker(),value={kind:'idle'},second=scope.run([0],()=>next.asWorker());next.emit('message','ready');await flush();next.emit('message',value);
    expect((await second)[0]).toBe(value);await cleanup(scope,[next]);
  });
});
