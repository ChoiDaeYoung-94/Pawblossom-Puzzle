// 별도 프로세스/worker에서 합성 public key 응답만 사용합니다. 실제 네트워크/개인키 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {RewardLedger} from '../../server/ads/rewardLedger.ts';
import {createCallbackOutcome,runObservedCallback,callbackOutcomeEnvelope} from './callbackOutcomeDiagnostics.ts';
function createLedger(data){return new RewardLedger({databasePath:data.path,serverKey:new Uint8Array(data.key),policy:data.policy,
  dependencies:{now:()=>data.now,transport:async()=>new Response(JSON.stringify({keys:data.entries}),{headers:{'content-type':'application/json'}})}});}
async function run(data) {
  let ledger;
  try {
    ledger=createLedger(data);
    return data.action==='close' ? ledger.closeRound(data.context)
      : data.action==='issue' ? ledger.issueClaim(data.context,data.policy.adUnits[0])
      : await ledger.processCallback(data.query);
  } catch {return {kind:'worker-error'};}
  finally {try{ledger?.close();}catch{}}
}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',async()=>{
  if(workerData.diagnostics===true&&workerData.action===undefined){const trace=createCallbackOutcome();const result=await runObservedCallback(()=>createLedger(workerData),workerData.query,trace);parentPort.postMessage(callbackOutcomeEnvelope(result,trace));}
  else parentPort.postMessage(await run(workerData));
});}
else process.once('message',async data=>{process.send?.(await run(data));process.disconnect?.();});
