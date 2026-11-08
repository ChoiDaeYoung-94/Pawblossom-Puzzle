// 합성 데이터는 IPC 메모리로만 받습니다. 실제 transport/키 파일/네트워크 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {CallbackInbox} from '../../server/ads/callbackInbox.ts';
import {DatabaseSync} from 'node:sqlite';
import {createCallbackClaimProbe} from './callbackClaimProbe.ts';
import {createCallbackCloseReceipt} from './callbackCloseReceipt.ts';
import {createCallbackConnectionProbe} from './callbackConnectionState.ts';
import {createSpanRecorder} from './ledgerTransactionSpans.ts';
import {inboxSpanEnvelope} from './inboxTransactionSpans.ts';
// 운영 오류 메시지에는 SQL 원인이 없으므로 테스트 worker 내부에서 숫자 코드만 분류합니다.
// SQL·인수·원문 오류를 결과나 로그로 내보내지 않습니다.
let sqliteFailure;
let claimProbe=createCallbackClaimProbe(false);
let connectionProbe=createCallbackConnectionProbe(false);
let transactionSpans,transactionPhase='inbox-open';
const spanFailure=()=>{try{if(transactionSpans)transactionSpans.report.observationFailed=true;}catch{}};
const classify=error=>{sqliteFailure=error?.code==='ERR_SQLITE_ERROR'&&[5,6].includes(error.errcode&255)?'busy':'sql-error';};
const originalPrepare=DatabaseSync.prototype.prepare;
DatabaseSync.prototype.exec=function(...args){try{return connectionProbe.observe(args[0],this,args,invoke=>claimProbe.observe(args[0],invoke));}catch(error){classify(error);throw error;}};
DatabaseSync.prototype.prepare=function(...args){
  let statement;try{statement=Reflect.apply(originalPrepare,this,args);}catch(error){classify(error);throw error;}
  if(transactionSpans)try{transactionSpans.nativeReturned?.('prepare',args[0],this,originalPrepare);}catch{spanFailure();}
  for(const method of ['get','all','run']){const original=statement[method];statement[method]=function(...values){try{return Reflect.apply(original,this,values);}catch(error){classify(error);throw error;}};}
  return statement;
};
async function run(d,spans) {
  transactionSpans=spans;transactionPhase='inbox-open';
  claimProbe=createCallbackClaimProbe(d.diagnostics===true);
  connectionProbe=createCallbackConnectionProbe(d.diagnostics===true,spans?{recorder:spans,phase:()=>transactionPhase}:undefined);
  const closeReceipt=createCallbackCloseReceipt(d.diagnostics===true);
  let inbox,stage='open',openAttempts=0;
  const failures=[],limit=Number.isSafeInteger(d.openRetries)&&d.openRetries>=0&&d.openRetries<=2?d.openRetries+1:1;
  const diagnostic=result=>{const claimBegin=claimProbe.snapshot();return d.diagnostics?{...result,diagnostic:{openAttempts,failures,close:closeReceipt.receipt,claimConnection:connectionProbe.receipt,...(claimBegin?{claimBegin}:{})}}:result;};
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
    transactionPhase=stage==='receive'?'inbox-receive':'inbox-process';
    if(stage==='process'){claimProbe.arm();connectionProbe.arm();}
    sqliteFailure=undefined;
    const result=d.action==='receive'?inbox.receive(d.query):await inbox.processNext();
    return diagnostic(d.diagnostics&&result.kind==='unavailable'?{...result,stage,sqlite:sqliteFailure??'none'}:result);
  }catch(error){return diagnostic({kind:'worker-error',stage,code:error?.message==='callback-inbox-open-failed'?'open-failed':'unexpected',sqlite:sqliteFailure??'none'});}
  // 반환 DTO의 같은 영수증은 finally 뒤 IPC 직렬화 때 최종 값을 읽습니다.
  finally{transactionPhase='inbox-close';try{closeReceipt.close(inbox);}catch{}finally{connectionProbe.afterClose();}}
}
async function observedRun(d,go){
  if(d.diagnostics!==true||d.transactionSpans!==true||go?.kind!=='go')return run(d);
  let spans,result;try{spans=createSpanRecorder(go.spanClockAnchor);}catch{}
  try{result=await run(d,spans);}finally{
    try{spans?.finish();}catch{spanFailure();}finally{transactionSpans=undefined;}
  }
  return inboxSpanEnvelope(result,spans?.report??{schema:0},go.spanClockAnchor);
}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',async go=>parentPort.postMessage(await observedRun(workerData,go)));}
else process.once('message',async d=>{process.send?.(await run(d));process.disconnect?.();});
