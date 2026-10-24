// 별도 프로세스·8worker도 같은 파일과 실제 소비 경로를 사용합니다. 운영 계정·키·통신 없음.
import {parentPort,workerData} from 'node:worker_threads';
import {RewardLedger} from '../../server/ads/rewardLedger.ts';
import {RoundLedger} from '../../server/game/roundLedger.ts';
import {createTrace,step,recordError,resultAt,withSqliteDiagnostics} from './ledgerDiagnostics.ts';
import {retryLedgerOpen} from './ledgerOpenRetry.ts';
function execute(data,diagnostic){
  let reward,round;
  try{
    const retryEnabled=!!parentPort&&data.diagnostics===true&&data.retryConstructorBusy===true;
    const onRetry=retryEnabled&&data.notifyConstructorBusy===true?attempt=>{
      const shared=data.constructorReleaseGate;if(!(shared instanceof SharedArrayBuffer)||shared.byteLength!==4)return false;
      const gate=new Int32Array(shared);parentPort.postMessage({kind:'synthetic-open-busy',attempt});
      // 전용 잠금 회귀만 사용합니다. 일반8worker에는 이 gate/추가 메시지가 없습니다.
      Atomics.wait(gate,0,0,500);return Atomics.load(gate,0)===1;
    }:undefined;
    reward=retryLedgerOpen(diagnostic,'reward-open',retryEnabled,()=>new RewardLedger({databasePath:data.rewardPath,serverKey:new Uint8Array(data.rewardKey),policy:data.policy,dependencies:{now:()=>data.now,transport:async()=>{throw new Error('통신 금지');}}}),ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),onRetry);
    const redeemed=step(diagnostic,'redeem',()=>reward.redeemVoucher(data.context));
    if(data.action==='redeem')return resultAt(diagnostic,redeemed);
    if(redeemed.kind!=='voucher-redeemed')return resultAt(diagnostic,redeemed);
    if(data.action==='consume-stop')return resultAt(diagnostic,{kind:'consumed',opaqueGrantId:redeemed.grant.opaqueGrantId});
    round=step(diagnostic,'round-open',()=>new RoundLedger({databasePath:data.roundPath,serverKey:new Uint8Array(data.roundKey),environment:'test',now:()=>data.now}));
    const result=step(diagnostic,'apply',()=>round.applyReward({ownerId:data.context.ownerId},{roundId:data.context.roundId},redeemed.grant));
    // 응답 전 종료를 흉내 냅니다. DB의 COMMIT은 실제 완료되어야 합니다.
    return resultAt(diagnostic,data.action==='apply-stop'?{kind:'applied-response-lost'}:result);
  }catch(error){if(diagnostic)recordError(diagnostic,error);return resultAt(diagnostic,{kind:'worker-error'});}
  finally{step(diagnostic,'close',()=>{try{reward?.close();}catch(error){if(diagnostic)recordError(diagnostic,error);}try{round?.close();}catch(error){if(diagnostic)recordError(diagnostic,error);}});}
}
function run(data){const diagnostic=data.diagnostics===true?createTrace('reward-worker'):null;const result=withSqliteDiagnostics(diagnostic,()=>execute(data,diagnostic),parentPort&&diagnostic?{transactionSpans:true,spanClockAnchor:data.spanClockAnchor}:undefined);return diagnostic?{kind:'synthetic-worker-report',result,diagnostic}:result;}
if(parentPort){parentPort.postMessage('ready');parentPort.once('message',()=>parentPort.postMessage(run(workerData)));}
else process.once('message',data=>{process.send?.(run(data));process.disconnect?.();});
