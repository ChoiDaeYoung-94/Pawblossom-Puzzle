// 합성 입력만 사용하는 독립 연결/프로세스 재시작 검증용입니다. 실제 통신은 없습니다.
import {parentPort, workerData} from 'node:worker_threads';
import {PurchaseLedger} from '../../server/commerce/purchaseLedger.ts';
import {createLedgerAcknowledger} from '../../server/commerce/googlePlayAcknowledge.ts';

async function run(data) {
  let ledger;
  let postCount = 0;
  try {
    const acknowledge = data.httpAcknowledge ? createLedgerAcknowledger(data.policy, async () => {
      postCount++; return new Response(null, {status: data.postStatus ?? 200});
    }) : async () => data.ackFailure ? 'retry' : 'acknowledged';
    ledger = new PurchaseLedger({databasePath: data.path, serverKey: new Uint8Array(data.key), purchase: data.policy,
      getAccessToken: async () => 'synthetic-oauth', acknowledge,
      lookupTransport: async () => new Response(JSON.stringify({
        purchaseStateContext: {purchaseState: 'PURCHASED'}, acknowledgementState: data.pending ? 'ACKNOWLEDGEMENT_STATE_PENDING' : 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        obfuscatedExternalAccountId: data.account,
        ...(data.policy.mode === 'test' ? {testPurchaseContext: {fopType: 'TEST'}} : {}),
        productLineItem: [{productId: data.policy.productId, productOfferDetails: {
          purchaseOptionId: data.policy.purchaseOptionId, quantity: 1, refundableQuantity: 1,
          consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED',
        }}],
      }), {headers: {'content-type': 'application/json'}})});
    return {result: data.action === 'retry' ? await ledger.retryPending() : await ledger.process(data.token, {ownerId: data.owner, expectedObfuscatedAccountId: data.account}),
      entitlement: ledger.hasEntitlement(data.owner), ...(data.httpAcknowledge ? {postCount} : {})};
  } catch { return {error: 'worker-failed'}; }
  finally { ledger?.close(); }
}
if (parentPort) {
  parentPort.postMessage('ready');
  parentPort.once('message', async () => parentPort.postMessage(await run(workerData)));
} else {
  process.once('message', async data => { process.send(await run(data)); process.disconnect(); });
}
