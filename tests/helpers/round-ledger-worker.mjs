// 별도 프로세스·worker에서도 동일한 파일 원장을 사용합니다. 실제 계정·키·네트워크 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {RoundLedger} from '../../server/game/roundLedger.ts';
import {createTrace,step,recordError,resultAt,withSqliteDiagnostics} from './ledgerDiagnostics.ts';
import {retryLedgerOpen} from './ledgerOpenRetry.ts';
function execute(data,diagnostic) {
  let ledger;
  try {
    const retryEnabled=!!parentPort&&data.diagnostics===true&&data.retryConstructorBusy===true;
    const onRetry=retryEnabled&&data.notifyConstructorBusy===true?attempt=>{
      const shared=data.constructorReleaseGate;if(!(shared instanceof SharedArrayBuffer)||shared.byteLength!==4)return false;
      const gate=new Int32Array(shared);parentPort.postMessage({kind:'synthetic-open-busy',attempt});
      // 전용 잠금 회귀만 사용하며 일반 concurrent 실행에는 gate/추가 메시지가 없습니다.
      Atomics.wait(gate,0,0,500);return Atomics.load(gate,0)===1;
    }:undefined;
    ledger=retryLedgerOpen(diagnostic,'round-open',retryEnabled,()=>new RoundLedger({databasePath:data.path,serverKey:new Uint8Array(data.key),environment:'test',now:()=>data.now}),ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),onRetry);
    return resultAt(diagnostic,data.action==='start'?step(diagnostic,'start',()=>ledger.start(data.owner,data.request)):data.action==='command'?step(diagnostic,'command',()=>ledger.command(data.owner,data.request)):step(diagnostic,'get',()=>ledger.get(data.owner,data.request)));
  }catch(error){if(diagnostic)recordError(diagnostic,error);return resultAt(diagnostic,{kind:'worker-error'});}
  finally{step(diagnostic,'close',()=>{try{ledger?.close();}catch(error){if(diagnostic)recordError(diagnostic,error);}});}
}
function run(data){const diagnostic=data.diagnostics===true?createTrace('round-worker'):null;const result=withSqliteDiagnostics(diagnostic,()=>execute(data,diagnostic));return diagnostic?{kind:'synthetic-worker-report',result,diagnostic}:result;}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',()=>parentPort.postMessage(run(workerData)));}
else process.once('message',data=>{process.send?.(run(data));process.disconnect?.();});
