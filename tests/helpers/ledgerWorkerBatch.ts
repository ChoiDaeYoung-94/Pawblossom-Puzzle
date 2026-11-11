// 검사 부모의 준비·결과 대기만 소유합니다. Worker 정리 시점과 SQL/IPC는 caller가 유지합니다.
import type {Worker} from 'node:worker_threads';

type BatchWorker=Pick<Worker,'on'|'once'|'postMessage'>;
interface BatchOptions {
  go?(index:number):unknown;
  onReady?(index:number):void;
  progress?(value:any,index:number):boolean;
  receive?(value:any,index:number):any;
}
function gate<T>(){
  let settled=false,resolve!:(value:T)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});
  return {promise,get settled(){return settled;},resolve(value:T){if(!settled){settled=true;resolve(value);}},reject(error:Error){if(!settled){settled=true;reject(error);}}};
}
export function runLedgerWorkerBatch<T>(inputs:readonly T[],spawn:(input:T,index:number)=>BatchWorker,options:BatchOptions={}):Promise<any[]> {
  const jobs:{ready:ReturnType<typeof gate<void>>;result:ReturnType<typeof gate<any>>;send():void}[]=[];
  let failure:Error|undefined;
  function fail(reason:string){failure??=new Error('ledger-worker-'+reason);for(const job of jobs){job.ready.reject(failure);job.result.reject(failure);}}
  try{for(const [index,input]of inputs.entries()){
    const worker=spawn(input,index),ready=gate<void>(),result=gate<any>();let exited=false,readyReceived=false,received=false;
    const job={ready,result,send(){if(failure)throw failure;try{const message=options.go?options.go(index):'go';if(failure)throw failure;worker.postMessage(message);}catch{fail('send-failed');throw failure;}}};
    jobs.push(job);
    worker.on('message',(value:any)=>{
      if(exited)return;
      try{
        if(value==='ready'){if(!readyReceived){readyReceived=true;options.onReady?.(index);if(!failure)ready.resolve();}}
        else if(options.progress?.(value,index)===true)return;
        else if(!received){received=true;const output=options.receive?options.receive(value,index):value;if(!failure)result.resolve(output);}
      }catch{fail('message-failed');}
    });
    worker.on('error',()=>fail('error'));
    worker.on('messageerror',()=>fail('message-error'));
    worker.once('exit',()=>{exited=true;if(!readyReceived||!received)fail('incomplete-exit');});
    if(failure){ready.reject(failure);result.reject(failure);break;}
  }}catch{fail('start-failed');}
  const allReady=Promise.all(jobs.map(job=>job.ready.promise)),allResults=Promise.all(jobs.map(job=>job.result.promise));
  void allReady.catch(()=>{});void allResults.catch(()=>{});
  const output=(async()=>{await allReady;if(failure)throw failure;for(const job of jobs)job.send();return allResults;})();
  void output.catch(()=>{});return output;
}
