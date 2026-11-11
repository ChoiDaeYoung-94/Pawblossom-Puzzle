import {describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {runLedgerWorkerBatch} from './helpers/ledgerWorkerBatch';
import {createTrace,childRow,purchaseFailureContext} from './helpers/ledgerDiagnostics';

class FakeWorker extends EventEmitter {
  postMessage=vi.fn((_value:unknown)=>{});
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function setup(options:Parameters<typeof runLedgerWorkerBatch>[2]={},count=2){
  const workers:FakeWorker[]=[];
  const output=runLedgerWorkerBatch(Array.from({length:count},(_,i)=>i),()=>{const worker=new FakeWorker();workers.push(worker);return worker;},options);
  return {workers,output};
}
describe('원장 worker 부모의 준비·결과 정산',()=>{
  it('전체 ready 뒤 한 번씩 기존 GO·입력 순서 결과 참조·정리는 caller 소유',async()=>{
    const go=vi.fn((index:number)=>({kind:'go',index})),ready=vi.fn(),receive=vi.fn((value:any)=>value.result);
    const {workers,output}=setup({go,onReady:ready,receive},8);
    workers.slice(1).forEach(worker=>worker.emit('message','ready'));await flush();
    workers.forEach(worker=>expect(worker.postMessage).not.toHaveBeenCalled());
    workers[0].emit('message','ready');workers[0].emit('message','ready');await flush();
    expect(ready.mock.calls.map(row=>row[0])).toEqual([1,2,3,4,5,6,7,0]);
    workers.forEach((worker,index)=>expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({kind:'go',index}));
    const values=workers.map((_,index)=>({index}));
    for(let i=7;i>=0;i--)workers[i].emit('message',{result:values[i]});
    const result=await output;result.forEach((value,index)=>expect(value).toBe(values[index]));
    expect(receive).toHaveBeenCalledTimes(8);expect(go).toHaveBeenCalledTimes(8);
    workers.forEach(worker=>expect(worker.listenerCount('exit')).toBe(1));
  });
  it.each(['before-ready','partial-ready','after-go','partial-result'] as const)('%s error는 모든 미완료 대기를 즉시 거절',async phase=>{
    const {workers,output}=setup();
    if(phase==='partial-ready')workers[0].emit('message','ready');
    if(phase==='after-go'||phase==='partial-result'){workers.forEach(worker=>worker.emit('message','ready'));await flush();}
    if(phase==='partial-result')workers[0].emit('message',{kind:'completed'});
    workers[0].emit('error',new Error('secret-worker-error'));
    await expect(output).rejects.toThrow(/^ledger-worker-error$/);
  });
  it.each([0,1])('ready 전 무결과 exit%s도 즉시 거절·GO0',async code=>{
    const {workers,output}=setup();workers[0].emit('exit',code);
    await expect(output).rejects.toThrow(/^ledger-worker-incomplete-exit$/);
    workers.forEach(worker=>expect(worker.postMessage).not.toHaveBeenCalled());
  });
  it.each([0,1])('GO 뒤 무결과 exit%s도 다른 결과 대기와 함께 거절',async code=>{
    const {workers,output}=setup();workers.forEach(worker=>worker.emit('message','ready'));await flush();
    workers[0].emit('exit',code);await expect(output).rejects.toThrow(/^ledger-worker-incomplete-exit$/);
  });
  it('다른 worker의 부분 결과 뒤 messageerror도 원문 없이 거절',async()=>{
    const {workers,output}=setup();workers.forEach(worker=>worker.emit('message','ready'));await flush();
    workers[0].emit('message',{kind:'completed'});workers[1].emit('messageerror',new Error('secret-body'));
    await expect(output).rejects.toThrow(/^ledger-worker-message-error$/);
  });
  it('결과 뒤 정상 exit는 아직 남은 다른 worker 결과를 방해하지 않음',async()=>{
    const {workers,output}=setup();workers.forEach(worker=>worker.emit('message','ready'));await flush();
    const first={},second={};workers[0].emit('message',first);workers[0].emit('exit',0);workers[1].emit('message',second);
    expect(await output).toEqual([first,second]);
  });
  it('round의 기존 제어 메시지는 결과로 세지 않으며 기존 run도 그대로 송신',async()=>{
    const progress=vi.fn((value:any)=>value?.kind==='synthetic-open-busy');
    const {workers,output}=setup({go:()=> 'run',progress});workers.forEach(worker=>worker.emit('message','ready'));await flush();
    workers[0].emit('message',{kind:'synthetic-open-busy'});workers[0].emit('exit',0);
    await expect(output).rejects.toThrow(/^ledger-worker-incomplete-exit$/);
    workers.forEach(worker=>expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith('run'));expect(progress).toHaveBeenCalledOnce();
  });
  it('다음 생성자 예외 뒤 이미 만든 worker의 정리는 caller에게 남기고 GO0',async()=>{
    const worker=new FakeWorker(),owned:FakeWorker[]=[];
    const output=runLedgerWorkerBatch([0,1],input=>{if(input)throw new Error('secret-path');owned.push(worker);return worker;});
    await expect(output).rejects.toThrow(/^ledger-worker-start-failed$/);expect(owned).toEqual([worker]);expect(worker.postMessage).not.toHaveBeenCalled();
  });
  it('다음 생성자 안의 이전 worker 동기 실패도 막 등록한 gate까지 거절',async()=>{
    const workers:FakeWorker[]=[];
    const output=runLedgerWorkerBatch([0,1,2],index=>{if(index===1)workers[0].emit('error',new Error('secret'));const worker=new FakeWorker();workers.push(worker);return worker;});
    await expect(output).rejects.toThrow(/^ledger-worker-error$/);expect(workers).toHaveLength(2);
    workers.forEach(worker=>expect(worker.postMessage).not.toHaveBeenCalled());
  });
  it('송신 예외 뒤 다음 worker의 GO를 막음',async()=>{
    const {workers,output}=setup({},3);workers[1].postMessage.mockImplementation(()=>{throw new Error('secret-send');});
    workers.forEach(worker=>worker.emit('message','ready'));await expect(output).rejects.toThrow(/^ledger-worker-send-failed$/);
    expect(workers[0].postMessage).toHaveBeenCalledOnce();expect(workers[1].postMessage).toHaveBeenCalledOnce();expect(workers[2].postMessage).not.toHaveBeenCalled();
  });
  it('실패 뒤 늦은 결과는 진단만 갱신하고 첫 실패·GO0을 유지',async()=>{
    const receive=vi.fn((value:any)=>value),{workers,output}=setup({receive});
    workers[0].emit('error',new Error('secret-error'));workers[1].emit('message','ready');
    const late={kind:'completed'};workers[1].emit('message',late);workers[1].emit('message',{});workers[1].emit('messageerror',new Error('second-error'));
    await expect(output).rejects.toThrow(/^ledger-worker-error$/);expect(receive).toHaveBeenCalledExactlyOnceWith(late,1);
    workers.forEach(worker=>expect(worker.postMessage).not.toHaveBeenCalled());
  });
  it('정상 결과 뒤 exit1은 받은 결과를 실패로 바꾸지 않음',async()=>{
    const {workers,output}=setup();workers.forEach(worker=>worker.emit('message','ready'));await flush();
    workers[0].emit('message',1);workers[0].emit('exit',1);workers[1].emit('message',2);expect(await output).toEqual([1,2]);
  });
  it('GO adapter 안의 동기 worker 실패는 해당·후속 GO를 막음',async()=>{
    let workers:FakeWorker[]=[];const run=setup({go:()=>{workers[0].emit('error',new Error('secret'));return 'go';}});workers=run.workers;
    workers.forEach(worker=>worker.emit('message','ready'));await expect(run.output).rejects.toThrow(/^ledger-worker-error$/);
    workers.forEach(worker=>expect(worker.postMessage).not.toHaveBeenCalled());
  });
  it.each(['go','onReady','progress','receive'] as const)('%s adapter 예외도 원문 없이 정산',async callback=>{
    const {workers,output}=setup({[callback]:()=>{throw new Error('secret-adapter');}});
    workers.forEach(worker=>worker.emit('message','ready'));await flush();
    if(callback==='progress'||callback==='receive')workers[0].emit('message',{});
    await expect(output).rejects.toThrow(callback==='go'?'ledger-worker-send-failed':'ledger-worker-message-failed');
  });
});

describe('구매 실패 콘솔의 제한된 투영',()=>{
  it('단계·시간·child 상태는 남기고 경로·SQL·토큰·오류 원문은 배제',()=>{
    const trace=createTrace('purchase-restart'),row=childRow(0);trace.phase='child-result';row.createdAtMs=12;row.sentAtMs=15;row.exitCode=1;row.terminationRequested=true;
    Object.assign(trace,{token:'secret-token',sql:'secret-sql',path:'secret-path',message:'secret-message'});
    Object.assign(row,{message:'secret-child',errorName:'secret-error',errorCode:'secret-code'});trace.children.push(row);
    const output=purchaseFailureContext(trace),raw=JSON.stringify(output);
    expect(output).toMatchObject({family:'purchase-restart',phase:'child-result',children:[{index:0,createdAtMs:12,sentAtMs:15,resultAtMs:null,exitAtMs:null,exitCode:1,terminationRequested:true,errorName:'other',errorCode:'other'}],childrenTruncated:false});
    expect(raw).not.toContain('secret-');expect(output).not.toBe(trace);
  });
  it('child 진단은 8개까지만 복사하고 잘림을 명시',()=>{
    const trace=createTrace('purchase-batch');trace.children=Array.from({length:10},(_,index)=>childRow(index));
    const output=purchaseFailureContext(trace);expect(output.children).toHaveLength(8);expect(output.childrenTruncated).toBe(true);
  });
});
