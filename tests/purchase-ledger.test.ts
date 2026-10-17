import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {PurchaseLedger, type PurchaseLedgerOptions} from '../server/commerce/purchaseLedger';
import {createLedgerAcknowledger} from '../server/commerce/googlePlayAcknowledge';

// 실제 계정·키·구매가 아닌 합성 fixture만 사용합니다.
const policy = {packageName: 'com.example.pawblossom', productId: 'remove_ads', purchaseOptionId: 'permanent', mode: 'production' as const};
const key = new Uint8Array(32).fill(37);
const owner = {ownerId: 'synthetic-owner', expectedObfuscatedAccountId: 'synthetic-account'};
const token = 'synthetic/purchase?token#never-logged';
const oauth = 'synthetic-oauth-never-persisted';
const folders: string[] = [], ledgers: PurchaseLedger[] = [], connections: DatabaseSync[] = [];
const activeWorkers = new Set<Worker>();
const workerUrl = new URL('./helpers/purchase-ledger-worker.mjs', import.meta.url);
function path() { const dir = mkdtempSync(join(tmpdir(), 'pawblossom-ledger-')); folders.push(dir); return join(dir, 'ledger.sqlite'); }
function fixture(ack = false, test = false): Record<string, any> {
  return {purchaseStateContext: {purchaseState: 'PURCHASED'},
    acknowledgementState: ack ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' : 'ACKNOWLEDGEMENT_STATE_PENDING',
    obfuscatedExternalAccountId: owner.expectedObfuscatedAccountId,
    ...(test ? {testPurchaseContext: {fopType: 'TEST'}} : {}),
    productLineItem: [{productId: policy.productId, productOfferDetails: {purchaseOptionId: policy.purchaseOptionId,
      quantity: 1, refundableQuantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}]};
}
function open(databasePath = path(), patch: Partial<PurchaseLedgerOptions> = {}, body = fixture()) {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}}));
  const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => 'acknowledged');
  const options: PurchaseLedgerOptions = {databasePath, serverKey: key, purchase: {...policy}, lookupTransport: transport,
    getAccessToken: async () => oauth, acknowledge: ack, ...patch};
  const ledger = new PurchaseLedger(options); ledgers.push(ledger);
  return {ledger, transport, ack, options, body, path: databasePath};
}
function close(ledger: PurchaseLedger) { ledger.close(); ledgers.splice(ledgers.indexOf(ledger), 1); }
function db(path: string) { const connection = new DatabaseSync(path); connections.push(connection); return connection; }
function rows(path: string) { return db(path).prepare('SELECT * FROM purchases').all(); }
function advance() { vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_001); }
function data(path: string, extra = {}) { return {path, key: [...key], policy, account: owner.expectedObfuscatedAccountId, token, owner: owner.ownerId, ...extra}; }
async function child(input: ReturnType<typeof data>) {
  const process = fork(workerUrl, [], {execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
  const exited = new Promise<void>(resolve => process.once('exit', () => resolve()));
  const output = new Promise<any>((resolve, reject) => { process.once('message', resolve); process.once('error', reject); process.once('exit', code => {if (code) reject(new Error('child-failed'));}); });
  try { process.send(input); const result = await output; await exited; return result; }
  finally { if (process.exitCode === null) {process.kill(); await exited;} }
}
async function concurrent(inputs: ReturnType<typeof data>[]) {
  const workers = inputs.map(input => new Worker(workerUrl, {workerData: input, execArgv: ['--experimental-strip-types']}));
  workers.forEach(worker => activeWorkers.add(worker));
  const readies: Promise<void>[] = [];
  const outputs: Promise<any>[] = [];
  for (const worker of workers) {
    let ready!: () => void, result!: (value: any) => void;
    let failReady!: (error: Error) => void, failResult!: (error: Error) => void;
    readies.push(new Promise((resolve, reject) => {ready = resolve; failReady = reject;}));
    outputs.push(new Promise((resolve, reject) => {result = resolve; failResult = reject;}));
    worker.on('message', value => {if (value === 'ready') ready(); else result(value);});
    worker.once('error', error => {failReady(error); failResult(error);});
    worker.once('exit', code => {if (code) {const error = new Error('worker-failed'); failReady(error); failResult(error);}});
  }
  try {
    // 모든 연결 작업자가 준비될 때까지 기다린 뒤 같은 barrier에서 실행합니다.
    const [, results] = await Promise.all([Promise.all(readies).then(() => workers.forEach(worker => worker.postMessage('run'))), Promise.all(outputs)]);
    return results;
  } finally { await Promise.all(workers.map(worker => worker.terminate())); workers.forEach(worker => activeWorkers.delete(worker)); }
}
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  await Promise.all([...activeWorkers].map(worker => worker.terminate())); activeWorkers.clear();
  for (const connection of connections.splice(0)) connection.close();
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const dir of folders.splice(0)) rmSync(dir, {recursive: true, force: true});
});

describe('실제 SQLite 구매 원장과 권한', () => {
  it('원장+권한+pending ack 커밋 뒤에만 승인하며 같은 소유자 반복은 지급하지 않습니다', async () => {
    const h = open();
    h.ack.mockImplementation(async () => {
      expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true);
      expect(rows(h.path)[0]).toMatchObject({ack: 'pending', attempts: 1});
      return 'acknowledged';
    });
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'entitled', newGrant: true, acknowledgement: 'acknowledged'});
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'entitled', newGrant: false, acknowledgement: 'acknowledged'});
    expect(rows(h.path)).toHaveLength(1); expect(h.ack).toHaveBeenCalledTimes(1);
  });
  it('프로세스를 종료·다시 시작해도 원장/권한과 중복 방지가 유지됩니다', async () => {
    const location = path();
    expect(await child(data(location))).toMatchObject({result: {kind: 'entitled', newGrant: true}, entitlement: true});
    expect(await child(data(location))).toMatchObject({result: {kind: 'entitled', newGrant: false}, entitlement: true});
    expect(rows(location)).toHaveLength(1);
  });
  it('6개 worker의 독립 동시 연결에서 같은 토큰은 단 한 번 지급됩니다', async () => {
    const location = path();
    const results = await concurrent(Array.from({length: 6}, () => data(location)));
    expect(results).toEqual(results.map(() => expect.objectContaining({result: expect.objectContaining({kind: 'entitled'})})));
    expect(results.filter(value => value.result.newGrant)).toHaveLength(1); expect(rows(location)).toHaveLength(1);
  });
  it('다른 소유자의 동시 worker도 같은 토큰을 한 소유자에게만 귀속합니다', async () => {
    const location = path();
    const results = await concurrent(Array.from({length: 4}, (_, i) => data(location, {owner: `synthetic-owner-${i}`})));
    expect(results.filter(value => value.result?.kind === 'entitled')).toHaveLength(1);
    expect(results.filter(value => value.result?.reason === 'owner-conflict')).toHaveLength(3);
    expect(results.filter(value => value.entitlement)).toHaveLength(1);
  });
  it('소유자와 무관한 unique 토큰 식별값으로 다른 소유자를 거절합니다', async () => {
    const h = open(undefined, {}, fixture(true)); await h.ledger.process(token, owner);
    expect(await h.ledger.process(token, {...owner, ownerId: 'different-synthetic-owner'})).toEqual({kind: 'rejected', reason: 'owner-conflict'});
    expect(h.ledger.hasEntitlement('different-synthetic-owner')).toBe(false); expect(h.ack).not.toHaveBeenCalled();
    expect(rows(h.path)).toHaveLength(1);
  });
  it('여러 토큰이 같은 소유자의 영구 권한을 반복 지급하지 않습니다', async () => {
    const h = open(undefined, {}, fixture(true));
    expect(await h.ledger.process(token, owner)).toMatchObject({newGrant: true});
    expect(await h.ledger.process('another-synthetic-token', owner)).toMatchObject({newGrant: false});
    expect(rows(h.path)).toHaveLength(2); expect(db(h.path).prepare('SELECT * FROM entitlements').all()).toHaveLength(1);
  });
  it('권한 저장 실패 시 원장/outbox도 롤백하고 승인하지 않습니다', async () => {
    const h = open(); const connection = db(h.path);
    connection.exec("CREATE TRIGGER reject_grant BEFORE INSERT ON entitlements BEGIN SELECT RAISE(FAIL,'synthetic-private-error'); END;");
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'service-error', code: 'storage-unavailable'});
    expect(rows(h.path)).toHaveLength(0); expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(false); expect(h.ack).not.toHaveBeenCalled();
    connection.exec('DROP TRIGGER reject_grant');
    expect(await h.ledger.process(token, owner)).toMatchObject({kind: 'entitled', newGrant: true});
  });
  it('다른 DB 연결이 쓰기 잠금을 보유한 실패에서도 부분 지급/승인이 없습니다', async () => {
    const h = open(); const connection = db(h.path); connection.exec('BEGIN IMMEDIATE');
    try { expect(await h.ledger.process(token, owner)).toEqual({kind: 'service-error', code: 'storage-unavailable'}); }
    finally { connection.exec('ROLLBACK'); }
    expect(rows(h.path)).toHaveLength(0); expect(h.ack).not.toHaveBeenCalled();
  }, 10_000);
  it.each(['PENDING', 'CANCELLED', 'UNKNOWN'])('%s 조회는 신규 지급/승인도 기존 권한 철회도 하지 않습니다', async state => {
    const h = open(undefined, {}, fixture(true)); await h.ledger.process(token, owner);
    h.body.purchaseStateContext.purchaseState = state;
    expect(await h.ledger.process(token, owner)).toMatchObject({kind: 'rejected'});
    expect(await h.ledger.process('new-synthetic-token', owner)).toMatchObject({kind: 'rejected'});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true); expect(rows(h.path)).toHaveLength(1); expect(h.ack).not.toHaveBeenCalled();
  });
  it.each(['product', 'account', 'offer', 'lookup-error'])('%s 실패는 원장에 기록/지급/승인하지 않습니다', async kind => {
    const h = open();
    if (kind === 'product') h.body.productLineItem[0].productId = 'other';
    if (kind === 'account') h.body.obfuscatedExternalAccountId = 'other';
    if (kind === 'offer') h.body.productLineItem[0].productOfferDetails.quantity = 2;
    if (kind === 'lookup-error') h.transport.mockRejectedValue(new Error('synthetic-private-error'));
    expect(await h.ledger.process(token, owner)).not.toMatchObject({kind: 'entitled'});
    expect(rows(h.path)).toHaveLength(0); expect(h.ack).not.toHaveBeenCalled();
  });
});

describe('실제 파일 원장 + Google 승인 POST adapter', () => {
  function httpOpen(transport: typeof fetch, databasePath?: string, body = fixture(), timeoutMs = 8_000) {
    return open(databasePath, {acknowledge: createLedgerAcknowledger({...policy, timeoutMs}, transport)}, body);
  }
  it('독립 DB 연결에서 권한 commit을 확인한 뒤 POST 1회, 반복 요청은 재지급/POST하지 않습니다', async () => {
    let h: ReturnType<typeof open>;
    const transport = vi.fn<typeof fetch>(async (_url, request) => {
      expect(request!.method).toBe('POST'); expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true);
      expect(rows(h.path)[0]).toMatchObject({ack: 'pending', attempts: 1});
      expect(db(h.path).prepare('SELECT * FROM entitlements').all()).toHaveLength(1);
      return new Response(null);
    });
    h = httpOpen(transport);
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'entitled', newGrant: true, acknowledgement: 'acknowledged'});
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'entitled', newGrant: false, acknowledgement: 'acknowledged'});
    expect(transport).toHaveBeenCalledTimes(1); expect(h.transport).toHaveBeenCalledTimes(3);
    expect(rows(h.path)[0]).toMatchObject({ack: 'acknowledged', lease: null});
  });
  it.each(['initial', 'before-post'])('최신 GET가 이미 승인된 %s 상태면 POST를 생략합니다', async phase => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null));
    const h = httpOpen(transport, undefined, fixture(phase === 'initial'));
    if (phase === 'before-post') h.transport.mockResolvedValueOnce(new Response(JSON.stringify(fixture()), {headers: {'content-type': 'application/json'}}))
      .mockImplementation(async () => new Response(JSON.stringify(fixture(true)), {headers: {'content-type': 'application/json'}}));
    expect(await h.ledger.process(token, owner)).toMatchObject({newGrant: true, acknowledgement: 'acknowledged'});
    expect(transport).not.toHaveBeenCalled();
  });
  it('권한 트랜잭션 실패 시 실제 POST도 실행하지 않습니다', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null)); const h = httpOpen(transport);
    db(h.path).exec("CREATE TRIGGER reject_http_grant BEFORE INSERT ON entitlements BEGIN SELECT RAISE(FAIL,'synthetic-private-error'); END;");
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'service-error', code: 'storage-unavailable'});
    expect(rows(h.path)).toHaveLength(0); expect(transport).not.toHaveBeenCalled();
  });
  it.each([400, 409, 401, 403, 404, 429, 500, 503, 202, 302])('HTTP %s 실패는 영구 권한을 보존하고 pending으로 남깁니다', async status => {
    const transport = vi.fn<typeof fetch>(async () => new Response('already acknowledged synthetic-private-upstream', {status}));
    const h = httpOpen(transport);
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'entitled', newGrant: true, acknowledgement: 'pending'});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true);
    expect(rows(h.path)[0]).toMatchObject({ack: 'pending', attempts: 1, lease: null});
    expect(h.ledger.acknowledgementSummary()).toEqual({pending: 1, inFlight: 0, attention: 0});
    expect(JSON.stringify(rows(h.path))).not.toContain('synthetic-private-upstream'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('400/409를 성공 추정하지 않고 재열기 뒤 최신 GET 승인 사실로만 수렴합니다', async () => {
    for (const status of [400, 409]) {
      const transport = vi.fn<typeof fetch>(async () => new Response('already acknowledged', {status}));
      const h = httpOpen(transport); expect(await h.ledger.process(token, owner)).toMatchObject({acknowledgement: 'pending'});
      close(h.ledger); const next = httpOpen(transport, h.path, fixture(true)); advance();
      expect(await next.ledger.retryPending()).toEqual({kind: 'retry-result', processed: 1, acknowledged: 1, attention: 0});
      expect(await next.ledger.process(token, owner)).toMatchObject({newGrant: false, acknowledgement: 'acknowledged'});
      expect(transport).toHaveBeenCalledTimes(1); expect(db(h.path).prepare('SELECT * FROM entitlements').all()).toHaveLength(1);
    }
  });
  it('실제 프로세스 재시작 뒤 최신 GET로 수렴하고 POST·재지급하지 않습니다', async () => {
    const location = path();
    const first = await child(data(location, {httpAcknowledge: true, postStatus: 409, pending: true}));
    expect(first).toMatchObject({result: {newGrant: true, acknowledgement: 'pending'}, entitlement: true, postCount: 1});
    db(location).exec('UPDATE purchases SET next_at=0');
    const second = await child(data(location, {httpAcknowledge: true, action: 'retry'}));
    expect(second).toMatchObject({result: {processed: 1, acknowledged: 1}, entitlement: true, postCount: 0});
    const third = await child(data(location, {httpAcknowledge: true}));
    expect(third).toMatchObject({result: {newGrant: false, acknowledgement: 'acknowledged'}, postCount: 0});
    expect(rows(location)[0]).toMatchObject({ack: 'acknowledged', attempts: 2});
    expect(db(location).prepare('SELECT * FROM entitlements').all()).toHaveLength(1);
  });
  it('실제 프로세스 재시작 뒤 아직 pending이면 최신 GET 후 다시 POST합니다', async () => {
    const location = path();
    expect(await child(data(location, {httpAcknowledge: true, postStatus: 503, pending: true}))).toMatchObject({result: {acknowledgement: 'pending'}, postCount: 1});
    db(location).exec('UPDATE purchases SET next_at=0');
    expect(await child(data(location, {httpAcknowledge: true, pending: true, action: 'retry'}))).toMatchObject({result: {acknowledged: 1}, postCount: 1});
    expect(rows(location)[0]).toMatchObject({ack: 'acknowledged', attempts: 2});
    expect(db(location).prepare('SELECT * FROM entitlements').all()).toHaveLength(1);
  });
  it('기존 토큰의 다른 소유자 요청은 승인/재지급하지 않습니다', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null, {status: 503})); const h = httpOpen(transport);
    await h.ledger.process(token, owner);
    expect(await h.ledger.process(token, {...owner, ownerId: 'different-synthetic-owner'})).toEqual({kind: 'rejected', reason: 'owner-conflict'});
    expect(h.ledger.hasEntitlement('different-synthetic-owner')).toBe(false); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('transport 예외/비어 있지 않은 성공 본문도 pending으로 유지합니다', async () => {
    for (const transport of [vi.fn<typeof fetch>(async () => {throw new Error(oauth, {cause: token});}), vi.fn<typeof fetch>(async () => new Response('{}'))]) {
      const h = httpOpen(transport);
      expect(await h.ledger.process(token, owner)).toMatchObject({newGrant: true, acknowledgement: 'pending'});
      expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true); expect(rows(h.path)[0].ack).toBe('pending');
    }
  });
  it.each([20, 30_000])('transport 기한 %s와 원장 10초 기한 후 늦은 HTTP 성공은 DB를 갱신하지 못합니다', async timeoutMs => {
    vi.useFakeTimers(); let finish!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise(resolve => {finish = resolve;}));
    const h = httpOpen(transport, undefined, fixture(), timeoutMs); const pending = h.ledger.process(token, owner);
    await vi.advanceTimersByTimeAsync(0); expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(Math.min(timeoutMs, 10_000));
    expect(await pending).toMatchObject({newGrant: true, acknowledgement: 'pending'});
    expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
    const nextTransport = vi.fn<typeof fetch>(async () => new Response(null, {status: 503}));
    const next = httpOpen(nextTransport, h.path); await vi.advanceTimersByTimeAsync(60_000);
    expect(await next.ledger.retryPending()).toMatchObject({processed: 1, acknowledged: 0});
    finish(new Response(null)); await vi.advanceTimersByTimeAsync(0);
    expect(rows(h.path)[0]).toMatchObject({ack: 'pending', attempts: 2, lease: null});
    expect(next.ledger.hasEntitlement(owner.ownerId)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('본문 EOF가 기한 뒤 완료되어도 원장은 pending이며 최신 GET 수렴만 허용합니다', async () => {
    vi.useFakeTimers(); let finish!: () => void;
    const response = new Response(new ReadableStream({start(c) {finish = () => {try {c.close();} catch { /* 이미 취소된 fixture */ }};}, cancel() {return new Promise(() => {});}}));
    const transport = vi.fn<typeof fetch>(async () => response); const h = httpOpen(transport, undefined, fixture(), 20);
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({acknowledgement: 'pending'}); finish(); await vi.advanceTimersByTimeAsync(0);
    expect(rows(h.path)[0].ack).toBe('pending');
    h.body.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'; await vi.advanceTimersByTimeAsync(60_000);
    expect(await h.ledger.retryPending()).toMatchObject({acknowledged: 1}); expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('환경·키·입력·암호화 경계', () => {
  it('동일 파일의 환경/상품/옵션/패키지/키 변경을 열기 단계에서 차단합니다', async () => {
    const h = open(undefined, {}, fixture(true)); await h.ledger.process(token, owner); close(h.ledger);
    for (const purchase of [{...policy, mode: 'test' as const}, {...policy, productId: 'other'}, {...policy, purchaseOptionId: 'other'}, {...policy, packageName: 'com.other.app'}]) {
      expect(() => new PurchaseLedger({...h.options, purchase})).toThrow('ledger-open-failed');
    }
    expect(() => new PurchaseLedger({...h.options, serverKey: new Uint8Array(32).fill(99)})).toThrow('ledger-open-failed');
    const reopened = open(h.path); expect(reopened.ledger.hasEntitlement(owner.ownerId)).toBe(true);
  });
  it.each(['missing', 'future'])('메타데이터 %s 상태에서는 기존 권한 파일을 다른 구성으로 채택하지 않습니다', async state => {
    const h = open(undefined, {}, fixture(true)); await h.ledger.process(token, owner); close(h.ledger);
    const connection = db(h.path);
    if (state === 'missing') connection.exec('DELETE FROM ledger_meta');
    else connection.prepare('UPDATE ledger_meta SET profile=?').run(JSON.stringify({version: 999}));
    expect(() => new PurchaseLedger(h.options)).toThrow('ledger-open-failed');
    expect(connection.prepare('SELECT * FROM entitlements').all()).toHaveLength(1);
  });
  it('test 원장은 production 구매를 거절하며 시험 권한은 운영 파일에 나타나지 않습니다', async () => {
    const test = open(undefined, {purchase: {...policy, mode: 'test'}}, fixture(true, true));
    expect(await test.ledger.process(token, owner)).toMatchObject({kind: 'entitled'});
    const production = open(undefined, {}, fixture(true));
    expect(production.ledger.hasEntitlement(owner.ownerId)).toBe(false);
    delete test.body.testPurchaseContext;
    expect(await test.ledger.process(token, owner)).toEqual({kind: 'rejected', reason: 'environment-mismatch'});
    production.body.testPurchaseContext = {fopType: 'TEST'};
    expect(await production.ledger.process(token, owner)).toEqual({kind: 'rejected', reason: 'test-purchase-blocked'});
  });
  it('토큰/계정/owner/OAuth/서버키 원문은 DB·WAL·결과·로그에 없습니다', async () => {
    const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    const h = open(undefined, {acknowledge: async () => { throw new Error([token, oauth, owner.ownerId].join('|')); }});
    const result = await h.ledger.process(token, owner);
    expect(result).toMatchObject({kind: 'entitled', acknowledgement: 'pending'});
    const bytes = Buffer.concat(readdirSync(folders[0]).map(file => readFileSync(join(folders[0], file))));
    for (const secret of [token, oauth, owner.ownerId, owner.expectedObfuscatedAccountId]) {
      expect(bytes.includes(Buffer.from(secret))).toBe(false); expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(bytes.includes(Buffer.from(key))).toBe(false);
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('입력/구성/주입 키를 await 도중 변경해도 저장 소유자와 정책은 바뀌지 않습니다', async () => {
    const mutableOwner = {...owner}, mutableKey = key.slice(), mutablePolicy = {...policy};
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const h = open(undefined, {serverKey: mutableKey, purchase: mutablePolicy, getAccessToken: async () => {await gate; return oauth;}});
    const pending = h.ledger.process(token, mutableOwner);
    mutableOwner.ownerId = 'different'; mutableOwner.expectedObfuscatedAccountId = 'different'; mutableKey.fill(0); mutablePolicy.productId = 'other';
    release(); expect(await pending).toMatchObject({kind: 'entitled'});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true); expect(h.ledger.hasEntitlement('different')).toBe(false);
    close(h.ledger); expect(open(h.path).ledger.hasEntitlement(owner.ownerId)).toBe(true);
  });
  it('구성의 OAuth/ack/lookup 함수를 나중에 바꿔도 최초 서버 경계가 유지됩니다', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
    const h = open(undefined, {getAccessToken: async () => {await gate; return oauth;}});
    const pending = h.ledger.process(token, owner);
    const forbidden = vi.fn(async () => {throw new Error('synthetic-mutation');});
    Object.assign(h.options, {getAccessToken: forbidden, acknowledge: forbidden, lookupTransport: forbidden});
    release(); expect(await pending).toMatchObject({kind: 'entitled', acknowledgement: 'acknowledged'});
    expect(h.ack).toHaveBeenCalledTimes(1); expect(forbidden).not.toHaveBeenCalled();
  });
  it.each([{purchaseToken: ''}, {purchaseToken: '..'}, {purchaseToken: 'x'.repeat(4097)}, {ownerId: ''}, {expectedObfuscatedAccountId: ''}])('잘못된 입력은 조회하지 않습니다: %j', async patch => {
    const h = open();
    expect(await h.ledger.process(patch.purchaseToken ?? token, {...owner, ...patch})).toEqual({kind: 'service-error', code: 'invalid-input'});
    expect(h.transport).not.toHaveBeenCalled(); expect(h.ack).not.toHaveBeenCalled();
  });
  it('메모리/상대경로 DB·잘못된 키·누락 승인 구현을 구성 단계에서 거절합니다', () => {
    const h = open();
    for (const patch of [{databasePath: 123}, {databasePath: ':memory:'}, {databasePath: 'ledger.sqlite'}, {serverKey: new Uint8Array(31)}, {acknowledge: undefined}]) {
      expect(() => new PurchaseLedger({...h.options, ...patch} as PurchaseLedgerOptions)).toThrow('invalid-ledger-config');
    }
  });
  it('OAuth 공급자 예외/무응답은 안전하게 종료하고 늦은 값으로 조회하지 않습니다', async () => {
    const bad = open(undefined, {getAccessToken: async () => { throw new Error(oauth); }});
    expect(await bad.ledger.process(token, owner)).toEqual({kind: 'lookup-error', code: 'transport-error'});
    vi.useFakeTimers(); let release!: (value: string) => void;
    const h = open(undefined, {getAccessToken: () => new Promise(resolve => {release = resolve;})});
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({kind: 'lookup-error', code: 'timeout'}); release(oauth);
    await Promise.resolve(); await Promise.resolve(); expect(h.transport).not.toHaveBeenCalled();
  });
});

describe('영구 pending ack와 제한된 재시도', () => {
  it('실패 후 파일 재열기·cooldown 뒤 암호화 토큰을 복구하여 승인하고 재지급하지 않습니다', async () => {
    const first = open(undefined, {acknowledge: async () => 'retry'});
    expect(await first.ledger.process(token, owner)).toMatchObject({newGrant: true, acknowledgement: 'pending'});
    close(first.ledger); const second = open(first.path);
    expect(await second.ledger.retryPending()).toMatchObject({processed: 0});
    advance(); expect(await second.ledger.retryPending()).toEqual({kind: 'retry-result', processed: 1, acknowledged: 1, attention: 0});
    expect(second.ack).toHaveBeenCalledWith(expect.objectContaining({purchaseToken: token, accessToken: oauth}));
    expect(await second.ledger.process(token, owner)).toMatchObject({newGrant: false, acknowledgement: 'acknowledged'});
  });
  it('승인 응답 유실은 최신 GET의 이미 ack 상태로 수렴하고 POST를 반복하지 않습니다', async () => {
    const h = open();
    h.ack.mockImplementation(async () => { h.body.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'; throw new Error('synthetic-lost-response'); });
    expect(await h.ledger.process(token, owner)).toMatchObject({acknowledgement: 'pending'});
    advance(); expect(await h.ledger.retryPending()).toMatchObject({acknowledged: 1}); expect(h.ack).toHaveBeenCalledTimes(1);
  });
  it('실패한 pending 작업은 실제 프로세스 재시작 뒤 암호화 자료로 재시도됩니다', async () => {
    const location = path();
    expect(await child(data(location, {pending: true, ackFailure: true}))).toMatchObject({result: {kind: 'entitled', acknowledgement: 'pending'}, entitlement: true});
    // 실제 기다림 없이 cooldown 시각만 과거로 옮기고 프로세스를 새로 실행합니다.
    db(location).exec('UPDATE purchases SET next_at=0');
    expect(await child(data(location, {pending: true, action: 'retry'}))).toMatchObject({result: {kind: 'retry-result', processed: 1, acknowledged: 1}, entitlement: true});
    expect(rows(location)[0]).toMatchObject({attempts: 2, ack: 'acknowledged'});
  });
  it.each(['PENDING', 'CANCELLED', 'account', 'product', 'environment', 'lookup-error'])('재시도 전 최신 %s는 승인하지 않고 기존 권한을 보존합니다', async state => {
    const h = open(undefined, {acknowledge: async () => 'retry'}); await h.ledger.process(token, owner);
    const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => 'acknowledged'); close(h.ledger);
    const body = fixture(); if (state === 'PENDING' || state === 'CANCELLED') body.purchaseStateContext.purchaseState = state;
    if (state === 'account') body.obfuscatedExternalAccountId = 'different';
    if (state === 'product') body.productLineItem[0].productId = 'other';
    if (state === 'environment') body.testPurchaseContext = {fopType: 'TEST'};
    const next = open(h.path, {acknowledge: ack}, body); if (state === 'lookup-error') next.transport.mockRejectedValue(new Error('synthetic-failure'));
    advance(); expect(await next.ledger.retryPending()).toMatchObject({processed: 1, acknowledged: 0});
    expect(next.ledger.hasEntitlement(owner.ownerId)).toBe(true); expect(ack).not.toHaveBeenCalled();
  });
  it('독립 연결의 동시 재시도는 하나의 활성 lease만 승인합니다', async () => {
    const first = open(undefined, {acknowledge: async () => 'retry'}); await first.ledger.process(token, owner);
    let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
    const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => {await gate; return 'acknowledged';});
    const second = open(first.path, {acknowledge: ack}); const third = open(first.path, {acknowledge: ack}); advance();
    const running = second.ledger.retryPending();
    await vi.waitFor(() => expect(ack).toHaveBeenCalledTimes(1));
    expect(await third.ledger.retryPending()).toMatchObject({processed: 0});
    release(); expect(await running).toMatchObject({acknowledged: 1}); expect(ack).toHaveBeenCalledTimes(1);
  });
  it('프로세스 중단으로 남은 lease는 만료 후 복구하고 만료 전 실행하지 않습니다', async () => {
    const h = open(undefined, {acknowledge: async () => 'retry'}); await h.ledger.process(token, owner);
    const now = Date.now(); db(h.path).prepare('UPDATE purchases SET lease=?,lease_until=?,next_at=0').run('synthetic-crashed-lease', now + 60_000);
    expect(await h.ledger.retryPending()).toMatchObject({processed: 0}); advance();
    expect(await h.ledger.retryPending()).toMatchObject({processed: 1}); expect(rows(h.path)[0]).toMatchObject({attempts: 2, lease: null});
  });
  it('타임아웃을 무시한 늦은 승인 성공은 새 lease의 실패 상태를 덮어쓰지 않습니다', async () => {
    vi.useFakeTimers(); let finish!: (state: 'acknowledged') => void;
    const h = open(undefined, {acknowledge: () => new Promise(resolve => {finish = resolve;})});
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000); expect(await pending).toMatchObject({acknowledgement: 'pending'});
    const next = open(h.path, {acknowledge: async () => 'retry'}); await vi.advanceTimersByTimeAsync(60_000);
    expect(await next.ledger.retryPending()).toMatchObject({processed: 1, acknowledged: 0});
    finish('acknowledged'); await vi.advanceTimersByTimeAsync(0);
    expect(rows(h.path)[0]).toMatchObject({attempts: 2, ack: 'pending', lease: null});
  });
  it('완료 전 다른 작업이 lease를 바꿔도 이전 completion은 갱신하지 못합니다', async () => {
    let finish!: (state: 'acknowledged') => void;
    const h = open(undefined, {acknowledge: () => new Promise(resolve => {finish = resolve;})});
    const pending = h.ledger.process(token, owner); await vi.waitFor(() => expect(rows(h.path)[0]?.attempts).toBe(1));
    // 만료 뒤 새 작업이 claim한 상황을 독립 DB 연결에서 모사합니다.
    db(h.path).prepare('UPDATE purchases SET lease=?,attempts=2 WHERE token_id IS NOT NULL').run('synthetic-new-lease');
    finish('acknowledged'); expect(await pending).toMatchObject({acknowledgement: 'pending'});
    expect(rows(h.path)[0]).toMatchObject({ack: 'pending', lease: 'synthetic-new-lease', attempts: 2});
  });
  it('통산5회 한도는 반복 요청/재열기로 초기화되지 않으며 자동 루프가 없습니다', async () => {
    const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => 'retry');
    const h = open(undefined, {acknowledge: ack}); await h.ledger.process(token, owner);
    for (let i = 0; i < 4; i++) {advance(); await h.ledger.retryPending();}
    expect(ack).toHaveBeenCalledTimes(5); close(h.ledger); const next = open(h.path, {acknowledge: ack}); advance();
    expect(await next.ledger.retryPending()).toMatchObject({processed: 0, attention: 1});
    expect(next.ledger.acknowledgementSummary()).toEqual({pending: 1, inFlight: 0, attention: 1});
    expect(await next.ledger.process(token, owner)).toMatchObject({newGrant: false, acknowledgement: 'attention'});
    expect(ack).toHaveBeenCalledTimes(5); expect(rows(h.path)[0].attempts).toBe(5);
  });
  it('close 뒤 조회·재시도·권한/집계 읽기는 안전한 오류이며 외부 호출하지 않습니다', async () => {
    const h = open(); close(h.ledger);
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'service-error', code: 'storage-unavailable'});
    expect(await h.ledger.retryPending()).toEqual({kind: 'service-error', code: 'storage-unavailable'});
    expect(() => h.ledger.hasEntitlement(owner.ownerId)).toThrow('ledger-read-failed');
    expect(() => h.ledger.acknowledgementSummary()).toThrow('ledger-read-failed');
    expect(h.transport).not.toHaveBeenCalled(); expect(h.ack).not.toHaveBeenCalled();
  });
  it('배치 한도와 잘못된 재시도 한도를 지킵니다', async () => {
    const h = open(undefined, {acknowledge: async () => 'retry'});
    for (let i = 0; i < 3; i++) await h.ledger.process(`${token}${i}`, owner);
    advance(); expect(await h.ledger.retryPending(2)).toMatchObject({processed: 2});
    for (const limit of [0, 101, 1.5, NaN]) expect(await h.ledger.retryPending(limit)).toEqual({kind: 'service-error', code: 'invalid-input'});
  });
  it('암호문 변조는 승인/정보 노출 없이 pending을 유지합니다', async () => {
    const h = open(undefined, {acknowledge: async () => 'retry'}); await h.ledger.process(token, owner);
    db(h.path).exec("UPDATE purchases SET envelope='broken-synthetic-envelope'"); close(h.ledger);
    const next = open(h.path); advance();
    expect(await next.ledger.retryPending()).toMatchObject({acknowledged: 0}); expect(next.ack).not.toHaveBeenCalled();
    expect(next.ledger.hasEntitlement(owner.ownerId)).toBe(true);
  });
});
