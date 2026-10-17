// 별도 프로세스·8worker도 같은 파일과 실제 소비 경로를 사용합니다. 운영 계정·키·통신 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {RewardLedger} from '../../server/ads/rewardLedger.ts';
import {RoundLedger} from '../../server/game/roundLedger.ts';
function run(data){
  let reward,round;
  try{
    reward=new RewardLedger({databasePath:data.rewardPath,serverKey:new Uint8Array(data.rewardKey),policy:data.policy,dependencies:{now:()=>data.now,transport:async()=>{throw new Error('통신 금지');}}});
    const redeemed=reward.redeemVoucher(data.context);
    if(data.action==='redeem')return redeemed;
    if(redeemed.kind!=='voucher-redeemed')return redeemed;
    if(data.action==='consume-stop')return {kind:'consumed',opaqueGrantId:redeemed.grant.opaqueGrantId};
    round=new RoundLedger({databasePath:data.roundPath,serverKey:new Uint8Array(data.roundKey),environment:'test',now:()=>data.now});
    const result=round.applyReward({ownerId:data.context.ownerId},{roundId:data.context.roundId},redeemed.grant);
    // 응답 전 종료를 흉내 냅니다. DB의 COMMIT은 실제 완료되어야 합니다.
    return data.action==='apply-stop'?{kind:'applied-response-lost'}:result;
  }catch{return {kind:'worker-error'};}
  finally{try{reward?.close();}catch{}try{round?.close();}catch{}}
}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',()=>parentPort.postMessage(run(workerData)));}
else process.once('message',data=>{process.send?.(run(data));process.disconnect?.();});
