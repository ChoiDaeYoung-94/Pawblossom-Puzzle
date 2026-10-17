// 별도 프로세스·worker에서도 동일한 파일 원장을 사용합니다. 실제 계정·키·네트워크 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {RoundLedger} from '../../server/game/roundLedger.ts';
function run(data) {
  let ledger;
  try {
    ledger=new RoundLedger({databasePath:data.path,serverKey:new Uint8Array(data.key),environment:'test',now:()=>data.now});
    return data.action==='start'?ledger.start(data.owner,data.request):data.action==='command'?ledger.command(data.owner,data.request):ledger.get(data.owner,data.request);
  }catch{return {kind:'worker-error'};}
  finally{try{ledger?.close();}catch{}}
}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',()=>parentPort.postMessage(run(workerData)));}
else process.once('message',data=>{process.send?.(run(data));process.disconnect?.();});
