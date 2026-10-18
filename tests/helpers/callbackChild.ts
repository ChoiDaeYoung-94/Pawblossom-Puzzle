// callback 검사 전용 fork 수명 관리입니다. 원문 오류/IPC 입력/DB 정보를 진단에 복사하지 않습니다.
import type {ChildProcess,Serializable} from 'node:child_process';

export interface CallbackChildJob {
  readonly result:Promise<any>;
  readonly done:Promise<void>;
  readonly output:Promise<any>;
  cancelAndWait():Promise<void>;
}
export function createCallbackChildScope(){
  const jobs=new Set<CallbackChildJob>();
  function track(process:ChildProcess,data:Serializable,onBusy?:()=>void):CallbackChildJob {
    let resultSettled=false,received=false,closed=false,exited=false,cancelled=false,callbacksEnabled=true,killRequested=false;
    let code:number|null=null,signal:NodeJS.Signals|null=null,failure:Error|undefined,cancelPromise:Promise<void>|undefined;
    let resolveResult!:(value:any)=>void,rejectResult!:(error:Error)=>void,resolveDone!:()=>void,output!:Promise<any>;
    const result=new Promise<any>((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;}),done=new Promise<void>(resolve=>{resolveDone=resolve;});
    // 호출자가 기다리기 전에 송신/종료 오류가 발생해도 거부를 즉시 관측합니다.
    void result.catch(()=>{});
    function fail(reason:string){
      callbacksEnabled=false;failure??=new Error('callback-child-'+reason);
      if(!resultSettled){resultSettled=true;rejectResult(failure);}
      if(!closed)void cancelAndWait();
    }
    function cancelAndWait():Promise<void>{
      if(cancelPromise)return cancelPromise;
      callbacksEnabled=false;
      cancelPromise=done;
      if(!closed){cancelled=true;fail('cancelled');}
      // 검사 본문/output 대신 close만 기다리며, 종료 요청 전에 같은 조인 Promise를 등록합니다.
      if(!closed&&!exited&&process.pid!==undefined&&!killRequested){killRequested=true;try{process.kill();}catch{fail('kill-failed');}}
      return cancelPromise;
    }
    const job:CallbackChildJob={result,done,get output(){return output;},cancelAndWait};
    jobs.add(job);
    process.on('message',(value:any)=>{
      if(!callbacksEnabled)return;
      if(value?.kind==='worker-open-busy'){try{onBusy?.();}catch{fail('busy-callback-failed');}return;}
      if(!resultSettled){received=true;resultSettled=true;callbacksEnabled=false;resolveResult(value);}
    });
    process.on('error',()=>fail('process-error'));
    process.once('disconnect',()=>{if(!received)fail('disconnected');});
    process.once('exit',(exitCode,exitSignal)=>{exited=true;code=exitCode;signal=exitSignal;if(exitCode!==0||exitSignal!==null)fail('exit-failed');});
    process.once('close',(closeCode,closeSignal)=>{
      closed=true;callbacksEnabled=false;if(!exited){code=closeCode;signal=closeSignal;}
      if(!received)fail('no-result');resolveDone();jobs.delete(job);
    });
    output=(async()=>{
      try{const value=await result;await done;if(failure)throw failure;if(cancelled)throw new Error('callback-child-cancelled');if(code!==0||signal!==null)throw new Error('callback-child-exit-failed');return value;}
      finally{await cancelAndWait();}
    })();void output.catch(()=>{});
    try{process.send(data,error=>{if(error)fail('send-failed');});}catch{fail('send-failed');}
    return job;
  }
  async function cancelAllAndWait():Promise<void>{
    const results=await Promise.allSettled([...jobs].map(job=>job.cancelAndWait()));
    if(results.some(result=>result.status==='rejected')||jobs.size)throw new Error('callback-child-cleanup-unconfirmed');
  }
  return {track,cancelAllAndWait,get size(){return jobs.size;}};
}
export async function finishCallbackTest(scope:ReturnType<typeof createCallbackChildScope>,steps:{terminateWorkers:()=>Promise<unknown>;releaseLocks:()=>void;closeParents:()=>void;removeFolders:()=>void}):Promise<void>{
  await scope.cancelAllAndWait();
  await steps.terminateWorkers();
  let failed=false;try{steps.releaseLocks();}catch{failed=true;}try{steps.closeParents();}catch{failed=true;}
  if(failed)throw new Error('callback-parent-cleanup-failed');
  steps.removeFolders();
}
