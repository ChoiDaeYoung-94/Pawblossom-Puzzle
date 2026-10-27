// 합성 데이터는 IPC 메모리로만 받습니다. 실제 transport/키 파일/네트워크 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {CallbackInbox} from '../../server/ads/callbackInbox.ts';
import {DatabaseSync} from 'node:sqlite';
import {createCallbackClaimProbe} from './callbackClaimProbe.ts';
// 운영 오류 메시지에는 SQL 원인이 없으므로 테스트 worker 내부에서 숫자 코드만 분류합니다.
// SQL·인수·원문 오류를 결과나 로그로 내보내지 않습니다.
let sqliteFailure;
let claimProbe=createCallbackClaimProbe(false);
const classify=error=>{sqliteFailure=error?.code==='ERR_SQLITE_ERROR'&&[5,6].includes(error.errcode&255)?'busy':'sql-error';};
const originalExec=DatabaseSync.prototype.exec,originalPrepare=DatabaseSync.prototype.prepare;
DatabaseSync.prototype.exec=function(...args){try{return claimProbe.observe(args[0],()=>Reflect.apply(originalExec,this,args));}catch(error){classify(error);throw error;}};
DatabaseSync.prototype.prepare=function(...args){
  let statement;try{statement=Reflect.apply(originalPrepare,this,args);}catch(error){classify(error);throw error;}
  for(const method of ['get','all','run']){const original=statement[method];statement[method]=function(...values){try{return Reflect.apply(original,this,values);}catch(error){classify(error);throw error;}};}
  return statement;
};
async function run(d) {
  claimProbe=createCallbackClaimProbe(d.diagnostics===true);
  let inbox,stage='open',openAttempts=0;
  const failures=[],limit=Number.isSafeInteger(d.openRetries)&&d.openRetries>=0&&d.openRetries<=2?d.openRetries+1:1;
  const diagnostic=result=>{const claimBegin=claimProbe.snapshot();return d.diagnostics?{...result,diagnostic:{openAttempts,failures,...(claimBegin?{claimBegin}:{})}}:result;};
  try {
    while(!inbox){
      sqliteFailure=undefined;openAttempts++;
      try{inbox=new CallbackInbox({databasePath:d.path,encryptionKey:new Uint8Array(d.key),policy:d.policy,now:()=>d.now,
      leaseMs:100,maxRows:d.maxRows??100,maxAttempts:d.maxAttempts??3,backoffMs:10,maxBackoffMs:20,maxAgeMs:1000,
      rewardLedger:{databasePath:d.rewardPath,serverKey:new Uint8Array(d.rewardKey),dependencies:{now:()=>d.now,
        transport:async()=>new Response(JSON.stringify({keys:d.entries}),{headers:{'content-type':'application/json'}})}}});}
      catch(error){
        failures.push({stage:'open',sqlite:sqliteFailure??'none'});
        // 생성자에서 실제 SQLite BUSY/LOCKED가 관찰된 경우에만 같은 구성을 제한 재시도합니다.
        if(error?.message!=='callback-inbox-open-failed'||sqliteFailure!=='busy'||openAttempts>=limit)throw error;
        if(d.notifyOpenBusy)process.send?.({kind:'worker-open-busy'});
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
    stage=d.action==='receive'?'receive':'process';
    if(stage==='process')claimProbe.arm();
    sqliteFailure=undefined;
    const result=d.action==='receive'?inbox.receive(d.query):await inbox.processNext();
    return diagnostic(d.diagnostics&&result.kind==='unavailable'?{...result,stage,sqlite:sqliteFailure??'none'}:result);
  }catch(error){return diagnostic({kind:'worker-error',stage,code:error?.message==='callback-inbox-open-failed'?'open-failed':'unexpected',sqlite:sqliteFailure??'none'});}
  finally{try{inbox?.close();}catch{}}
}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',async()=>parentPort.postMessage(await run(workerData)));}
else process.once('message',async d=>{process.send?.(await run(d));process.disconnect?.();});
