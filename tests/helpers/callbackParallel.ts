// callback parallel 검사 전용입니다. 오류 원문·입력·DB 내용을 진단에 복사하지 않습니다.
import type {Worker} from 'node:worker_threads';
type CallbackWorker=Pick<Worker,'on'|'once'|'postMessage'|'terminate'>;
function gate<T>(){
  let settled=false,resolve!:(value:T)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});void promise.catch(()=>{});
  return {promise,get settled(){return settled;},resolve(value:T){if(!settled){settled=true;resolve(value);}},reject(error:Error){if(!settled){settled=true;reject(error);}}};
}
export function createCallbackParallelScope(){
  const owned=new Set<{cancelAndWait():Promise<void>}>();let joining:Promise<void>|undefined;
  function run<T>(data:T[],spawn:(input:T)=>CallbackWorker):Promise<any[]>{
    if(joining){const rejected=Promise.reject<any[]>(new Error('callback-parallel-cleaning'));void rejected.catch(()=>{});return rejected;}
    const batch:{ready:ReturnType<typeof gate<void>>;result:ReturnType<typeof gate<any>>;go():void;rejectPending(error:Error):void}[]=[];
    let failure:Error|undefined;
    function fail(reason:string){failure??=new Error('callback-parallel-'+reason);for(const job of batch)job.rejectPending(failure);}
    try{for(const input of data){
      if(failure)break;
      const worker=spawn(input),ready=gate<void>(),result=gate<any>();let exited=false,received=false,stop:Promise<void>|undefined;
      let resolveDone!:()=>void;const done=new Promise<void>(resolve=>resolveDone=resolve);
      const job={ready,result,rejectPending(error:Error){ready.reject(error);result.reject(error);},
        go(){if(failure)throw failure;try{worker.postMessage('go');}catch{fail('send-failed');throw failure;}},
        cancelAndWait():Promise<void>{
          if(stop)return stop;
          let termination=Promise.resolve(),stopFailed=false;
          stop=done.then(async()=>{await termination;if(stopFailed)throw new Error('callback-parallel-termination-failed');});void stop.catch(()=>{});
          if(!exited){
            fail('cancelled');
            try{termination=worker.terminate().then(()=>{},()=>{stopFailed=true;});}catch{stopFailed=true;}
          }
          return stop;
        },
      };
      // 각 생성 직후 등록하므로 다음 생성자가 실패해도 앞선 Worker를 정리합니다.
      owned.add(job);batch.push(job);
      worker.on('message',(value:any)=>{
        if(failure||exited)return;
        if(value==='ready')ready.resolve();else if(!result.settled){received=true;result.resolve(value);}
      });
      worker.on('error',()=>fail('worker-error'));
      worker.on('messageerror',()=>fail('message-error'));
      worker.once('exit',()=>{
        exited=true;if(!ready.settled||!received)fail('incomplete-exit');
        resolveDone();owned.delete(job);
      });
      if(failure)job.rejectPending(failure);
    }}catch{fail('start-failed');}
    const allReady=Promise.all(batch.map(job=>job.ready.promise)),allResults=Promise.all(batch.map(job=>job.result.promise));
    void allReady.catch(()=>{});void allResults.catch(()=>{});
    const output=(async()=>{
      await allReady;if(failure)throw failure;
      for(const job of batch)job.go();
      return allResults;
    })();void output.catch(()=>{});return output;
  }
  function cancelAllAndWait():Promise<void>{
    if(joining)return joining;
    const jobs=[...owned];
    joining=Promise.resolve().then(async()=>{
      const results=await Promise.allSettled(jobs.map(job=>job.cancelAndWait()));
      if(results.some(result=>result.status==='rejected')||owned.size)throw new Error('callback-parallel-cleanup-unconfirmed');
    }).finally(()=>{joining=undefined;});void joining.catch(()=>{});return joining;
  }
  return {run,cancelAllAndWait,get size(){return owned.size;}};
}
