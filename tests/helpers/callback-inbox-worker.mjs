// 합성 데이터는 IPC 메모리로만 받습니다. 실제 transport/키 파일/네트워크 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {CallbackInbox} from '../../server/ads/callbackInbox.ts';
async function run(d) {
  let inbox;
  try {
    inbox=new CallbackInbox({databasePath:d.path,encryptionKey:new Uint8Array(d.key),policy:d.policy,now:()=>d.now,
      leaseMs:100,maxRows:d.maxRows??100,maxAttempts:d.maxAttempts??3,backoffMs:10,maxBackoffMs:20,maxAgeMs:1000,
      rewardLedger:{databasePath:d.rewardPath,serverKey:new Uint8Array(d.rewardKey),dependencies:{now:()=>d.now,
        transport:async()=>new Response(JSON.stringify({keys:d.entries}),{headers:{'content-type':'application/json'}})}}});
    return d.action==='receive'?inbox.receive(d.query):await inbox.processNext();
  }catch{return {kind:'worker-error'};}
  finally{try{inbox?.close();}catch{}}
}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',async()=>parentPort.postMessage(await run(workerData)));}
else process.once('message',async d=>{process.send?.(await run(d));process.disconnect?.();});
