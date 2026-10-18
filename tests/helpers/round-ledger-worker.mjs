// 별도 프로세스·worker에서도 동일한 파일 원장을 사용합니다. 실제 계정·키·네트워크 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {RoundLedger} from '../../server/game/roundLedger.ts';
import {createTrace,step,recordError,resultAt,withSqliteDiagnostics} from './ledgerDiagnostics.ts';
function execute(data,diagnostic) {
  let ledger;
  try {
    ledger=step(diagnostic,'round-open',()=>new RoundLedger({databasePath:data.path,serverKey:new Uint8Array(data.key),environment:'test',now:()=>data.now}));
    return resultAt(diagnostic,data.action==='start'?step(diagnostic,'start',()=>ledger.start(data.owner,data.request)):data.action==='command'?step(diagnostic,'command',()=>ledger.command(data.owner,data.request)):step(diagnostic,'get',()=>ledger.get(data.owner,data.request)));
  }catch(error){if(diagnostic)recordError(diagnostic,error);return resultAt(diagnostic,{kind:'worker-error'});}
  finally{step(diagnostic,'close',()=>{try{ledger?.close();}catch(error){if(diagnostic)recordError(diagnostic,error);}});}
}
function run(data){const diagnostic=data.diagnostics===true?createTrace('round-worker'):null;const result=withSqliteDiagnostics(diagnostic,()=>execute(data,diagnostic));return diagnostic?{kind:'synthetic-worker-report',result,diagnostic}:result;}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',()=>parentPort.postMessage(run(workerData)));}
else process.once('message',data=>{process.send?.(run(data));process.disconnect?.();});
