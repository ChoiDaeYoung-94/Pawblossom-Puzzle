import {afterEach, describe, expect, it, vi} from 'vitest';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {PurchaseLedger, type PurchaseLedgerOptions} from '../server/commerce/purchaseLedger';
import {createLedgerAcknowledger, createPlayPurchaseAcknowledger} from '../server/commerce/googlePlayAcknowledge';
import {createPlayPurchaseLookup} from '../server/commerce/googlePlayPurchase';

// 합성 자료만 사용합니다. 실제 계정/OAuth/Google/포트/프로세스를 사용하지 않습니다.
const policy = {packageName: 'com.example.pawblossom', productId: 'remove_ads', purchaseOptionId: 'permanent', mode: 'production' as const};
const owner = {ownerId: 'synthetic-owner', expectedObfuscatedAccountId: 'synthetic-account'};
const oauth = 'synthetic-oauth', token = 'synthetic-token';
const folders: string[] = [], ledgers: PurchaseLedger[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function location() {const path = mkdtempSync(join(tmpdir(), 'pawblossom-lifetime-')); folders.push(path); return join(path, 'ledger.sqlite');}
function body(acknowledged = false) {
  return {purchaseStateContext: {purchaseState: 'PURCHASED'},
    acknowledgementState: acknowledged ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' : 'ACKNOWLEDGEMENT_STATE_PENDING',
    obfuscatedExternalAccountId: owner.expectedObfuscatedAccountId,
    productLineItem: [{productId: policy.productId, productOfferDetails: {purchaseOptionId: policy.purchaseOptionId,
      quantity: 1, refundableQuantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}]};
}
function response(acknowledged = false) {return new Response(JSON.stringify(body(acknowledged)), {headers: {'content-type': 'application/json'}});}
function open(patch: Partial<PurchaseLedgerOptions> = {}) {
  const access = vi.fn(async () => oauth), lookup = vi.fn<typeof fetch>(async () => response());
  const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => 'acknowledged');
  const options: PurchaseLedgerOptions = {databasePath: location(), serverKey: new Uint8Array(32).fill(47), purchase: {...policy},
    getAccessToken: access, lookupTransport: lookup, acknowledge: ack, ...patch};
  const ledger = new PurchaseLedger(options); ledgers.push(ledger);
  return {ledger, options, access, lookup, ack};
}
function rows(path: string) {
  const db = new DatabaseSync(path);
  try {return db.prepare('SELECT token_id,ack,attempts,next_at,lease,lease_until FROM purchases ORDER BY token_id').all();}
  finally {db.close();}
}
function update(path: string, sql: string) {const db = new DatabaseSync(path); try {db.exec(sql);} finally {db.close();}}
async function flush() {await vi.advanceTimersByTimeAsync(0);}
const saturated = {kind: 'lookup-error', code: 'transport-error'};
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const dir of folders.splice(0)) rmSync(dir, {recursive: true, force: true});
});

describe('원장 인스턴스의 실제 미종료 처리 그룹 제한', () => {
  it.each([0, -1, 1.5, NaN, Infinity, 33, '1', null])('잘못된 한도 %s는 DB를 만들기 전에 거절합니다', value => {
    const h = open(), path = location();
    expect(() => new PurchaseLedger({...h.options, databasePath: path, maxPendingOperations: value as number})).toThrow('invalid-ledger-config');
    expect(existsSync(path)).toBe(false);
  });
  it.each([1, 32])('한도 %s의 중첩 GET/재조회/ACK가 추가 슬롯 없이 끝납니다', async maxPendingOperations => {
    const h = open({maxPendingOperations});
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'entitled', newGrant: true, acknowledgement: 'acknowledged'});
    expect(h.lookup).toHaveBeenCalledTimes(2); expect(h.ack).toHaveBeenCalledOnce();
    expect(await h.ledger.process(token, owner)).toMatchObject({newGrant: false, acknowledgement: 'acknowledged'});
  });
  it('한도 getter는 한 번 복사하며 DB profile에는 저장하지 않습니다', async () => {
    vi.useFakeTimers(); const seed = open(), gate = deferred<string>(); let limit = 1, reads = 0;
    const options = {...seed.options, databasePath: location(), getAccessToken: () => gate.promise,
      get maxPendingOperations() {reads++; return limit;}};
    const ledger = new PurchaseLedger(options); ledgers.push(ledger); limit = 32;
    const pending = ledger.process(token, owner); await flush();
    expect(await ledger.process('blocked', owner)).toEqual(saturated);
    expect(reads).toBe(1);
    const other = new PurchaseLedger({...options, maxPendingOperations: 32}); ledgers.push(other);
    expect(other.hasEntitlement(owner.ownerId)).toBe(false);
    gate.resolve(oauth); expect(await pending).toMatchObject({kind: 'entitled'});
  });
  it('기본8개와 9999+1ms 기한 뒤 잔여 OAuth를 유지하고 한 개씩만 회수합니다', async () => {
    vi.useFakeTimers(); const gates = Array.from({length: 9}, () => deferred<string>());
    let calls = 0; const access = vi.fn(() => gates[calls++].promise);
    const h = open({getAccessToken: access});
    const running = Array.from({length: 8}, (_, i) => h.ledger.process(`${token}-${i}`, owner));
    let completed = false; void Promise.all(running).then(() => {completed = true;});
    expect(await h.ledger.process('ninth', owner)).toEqual(saturated);
    await vi.advanceTimersByTimeAsync(9999); expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.all(running)).toEqual(Array.from({length: 8}, () => ({kind: 'lookup-error', code: 'timeout'})));
    for (let i = 0; i < 10; i++) expect(await h.ledger.process(`blocked-${i}`, owner)).toEqual(saturated);
    expect(access).toHaveBeenCalledTimes(8); expect(h.lookup).not.toHaveBeenCalled(); expect(rows(h.options.databasePath)).toEqual([]);
    gates[0].resolve(oauth); await flush();
    const accepted = h.ledger.process('accepted', owner); await flush(); expect(access).toHaveBeenCalledTimes(9);
    expect(await h.ledger.process('still-full', owner)).toEqual(saturated);
    await vi.advanceTimersByTimeAsync(10_000); expect(await accepted).toMatchObject({code: 'timeout'});
    for (const gate of gates) gate.resolve(oauth); await flush();
    expect(h.lookup).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['resolve', 'reject'])('OAuth timeout 뒤 늦은 %s까지 슬롯을 유지하며 새 GET을 시작하지 않습니다', async mode => {
    vi.useFakeTimers(); const gate = deferred<string>(); const access = vi.fn(async () => oauth).mockImplementationOnce(() => gate.promise);
    const h = open({maxPendingOperations: 1, getAccessToken: access});
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({code: 'timeout'}); expect(await h.ledger.process('blocked', owner)).toEqual(saturated);
    if (mode === 'resolve') gate.resolve(oauth); else gate.reject(new Error('synthetic-private-oauth'));
    await flush(); expect(h.lookup).not.toHaveBeenCalled();
    expect(await h.ledger.process('recovered', owner)).toMatchObject({kind: 'entitled'});
  });
  it.each(['resolve', 'reject'])('외부 ACK timeout 뒤 늦은 %s는 슬롯만 회수하고 DB는 변경하지 않습니다', async mode => {
    vi.useFakeTimers(); const gate = deferred<'acknowledged' | 'retry'>();
    const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => 'acknowledged').mockImplementationOnce(() => gate.promise);
    const h = open({maxPendingOperations: 1, acknowledge: ack});
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({acknowledgement: 'pending'}); const before = rows(h.options.databasePath);
    await vi.advanceTimersByTimeAsync(60_000);
    const calls = h.access.mock.calls.length;
    expect(await h.ledger.retryPending()).toEqual({kind: 'retry-result', processed: 0, acknowledged: 0, attention: 0});
    expect(await h.ledger.process('blocked', owner)).toEqual(saturated);
    expect(rows(h.options.databasePath)).toEqual(before); expect(h.access).toHaveBeenCalledTimes(calls); expect(ack).toHaveBeenCalledOnce();
    if (mode === 'resolve') gate.resolve('acknowledged'); else gate.reject(new Error('synthetic-private-ack'));
    await flush(); expect(rows(h.options.databasePath)).toEqual(before);
    expect(await h.ledger.retryPending()).toEqual({kind: 'retry-result', processed: 1, acknowledged: 1, attention: 0});
    expect(rows(h.options.databasePath)[0]).toMatchObject({ack: 'acknowledged', attempts: 2, lease: null});
  });
  it.each(['resolve', 'reject'])('ACK 직전 OAuth의 늦은 %s까지 슬롯을 유지하며 timeout 뒤 POST하지 않습니다', async mode => {
    vi.useFakeTimers(); const gate = deferred<string>(); let calls = 0;
    const access = vi.fn(() => ++calls === 3 ? gate.promise : Promise.resolve(oauth));
    const h = open({maxPendingOperations: 1, getAccessToken: access});
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({acknowledgement: 'pending'}); const before = rows(h.options.databasePath);
    expect(access).toHaveBeenCalledTimes(3); expect(await h.ledger.process('blocked', owner)).toEqual(saturated);
    if (mode === 'resolve') gate.resolve(oauth); else gate.reject(new Error('synthetic-private-oauth'));
    await flush(); expect(h.ack).not.toHaveBeenCalled(); expect(rows(h.options.databasePath)).toEqual(before);
    expect(await h.ledger.process('recovered', owner)).toMatchObject({kind: 'entitled'});
  });
  it('재시도 배치는 포화 후보를 processed에 넣지 않고 나머지 행의 시도/lease/cooldown을 보존합니다', async () => {
    vi.useFakeTimers(); const h = open({maxPendingOperations: 1, acknowledge: async () => 'retry'});
    for (let i = 0; i < 3; i++) await h.ledger.process(`${token}-${i}`, owner);
    update(h.options.databasePath, 'UPDATE purchases SET next_at=0');
    const gate = deferred<string>(); const access = vi.fn(() => gate.promise);
    const next = open({...h.options, getAccessToken: access}); const before = rows(h.options.databasePath), lookupCalls = h.lookup.mock.calls.length;
    const pending = next.ledger.retryPending(3); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({kind: 'retry-result', processed: 1, acknowledged: 0, attention: 0});
    const after = rows(h.options.databasePath);
    expect(after[0]).toMatchObject({attempts: 2, lease: null}); expect(after.slice(1)).toEqual(before.slice(1));
    expect(access).toHaveBeenCalledOnce(); gate.resolve(oauth); await flush(); expect(h.lookup).toHaveBeenCalledTimes(lookupCalls);
  });
});

describe('내장 GET/ACK의 raw fetch/read/cancel 수명 전달', () => {
  function rawFixture(phase: 'lookup' | 'ack', patch: Partial<PurchaseLedgerOptions> = {}) {
    const transport = vi.fn<typeof fetch>();
    const h = open({maxPendingOperations: 1, ...patch, ...(phase === 'lookup' ? {lookupTransport: transport}
      : {acknowledge: createLedgerAcknowledger(policy, transport)})});
    return {...h, transport};
  }
  it.each(['lookup', 'ack'] as const)('%s 정상 정리의 cancel 중 동기 abort 재진입도 cancel을 한 번만 호출합니다', async phase => {
    vi.useFakeTimers(); const controller = new AbortController(), cancelled = deferred<void>();
    const cancel = vi.fn(() => {controller.abort(); return cancelled.promise;}), releaseLock = vi.fn();
    const bytes = new TextEncoder().encode(JSON.stringify(body())); let readCount = 0;
    const native = phase === 'lookup' ? response() : new Response(null);
    Object.defineProperty(native, 'body', {value: {getReader: () => ({read: async () => phase === 'lookup' && readCount++ === 0
      ? {done: false, value: bytes} : {done: true, value: undefined}, cancel, releaseLock})}});
    const transport = vi.fn<typeof fetch>(async () => native);
    const input = {...policy, purchaseToken: token, accessToken: oauth, expectedObfuscatedAccountId: owner.expectedObfuscatedAccountId, signal: controller.signal};
    const callable = phase === 'lookup' ? createPlayPurchaseLookup(policy, transport) : createPlayPurchaseAcknowledger(policy, transport);
    await callable(input); await flush();
    expect(cancel).toHaveBeenCalledOnce(); expect(controller.signal.aborted).toBe(true); expect(releaseLock).not.toHaveBeenCalled();
    cancelled.resolve(); await flush(); expect(releaseLock).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['lookup', 'ack'] as const)('%s 늦은 Response는 한 번 cancel하며 cancel 종료 전 슬롯을 보존합니다', async phase => {
    vi.useFakeTimers(); const fetched = deferred<Response>(), cancelled = deferred<void>();
    const h = rawFixture(phase); h.transport.mockImplementationOnce(() => fetched.promise).mockImplementation(async () => phase === 'lookup' ? response() : new Response(null));
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject(phase === 'lookup' ? {kind: 'lookup-error', code: 'timeout'} : {acknowledgement: 'pending'});
    expect(await h.ledger.process('blocked', owner)).toEqual(saturated);
    const cancel = vi.fn(() => cancelled.promise), getReader = vi.fn();
    fetched.resolve({body: {cancel, getReader}} as unknown as Response); await flush();
    expect(cancel).toHaveBeenCalledOnce(); expect(getReader).not.toHaveBeenCalled();
    expect(await h.ledger.process('still-blocked', owner)).toEqual(saturated);
    cancelled.resolve(); await flush();
    expect(await h.ledger.process('recovered', owner)).toMatchObject({kind: 'entitled'});
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['lookup', 'ack'] as const)('%s 늦은 fetch reject도 관찰하고 슬롯을 회수합니다', async phase => {
    vi.useFakeTimers(); const fetched = deferred<Response>(); const h = rawFixture(phase);
    h.transport.mockImplementationOnce(() => fetched.promise).mockImplementation(async () => phase === 'lookup' ? response() : new Response(null));
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000); await pending;
    expect(await h.ledger.process('blocked', owner)).toEqual(saturated);
    fetched.reject(new Error('synthetic-private-fetch')); await flush();
    expect(await h.ledger.process('recovered', owner)).toMatchObject({kind: 'entitled'});
  });
  it.each((['lookup', 'ack'] as const).flatMap(phase => ['read-first', 'cancel-first'].flatMap(order => ['resolve', 'reject'].map(completion => ({phase, order, completion})))))('$phase $order/$completion에서 read와 cancel 모두 끝나야 lock/슬롯을 회수합니다', async ({phase, order, completion}) => {
    vi.useFakeTimers(); const read = deferred<ReadableStreamReadResult<Uint8Array>>(), cancelled = deferred<void>();
    const cancel = vi.fn(() => cancelled.promise), releaseLock = vi.fn(), readCall = vi.fn(() => read.promise);
    const native = phase === 'lookup' ? response() : new Response(null);
    Object.defineProperty(native, 'body', {value: {getReader: () => ({read: readCall, cancel, releaseLock})}});
    const h = rawFixture(phase); h.transport.mockResolvedValueOnce(native).mockImplementation(async () => phase === 'lookup' ? response() : new Response(null));
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000); await pending;
    const before = rows(h.options.databasePath);
    expect(cancel).toHaveBeenCalledOnce(); expect(readCall).toHaveBeenCalledOnce(); expect(releaseLock).not.toHaveBeenCalled();
    const endRead = () => completion === 'resolve' ? read.resolve({done: true, value: undefined}) : read.reject(new Error('synthetic-private-read'));
    const endCancel = () => completion === 'resolve' ? cancelled.resolve() : cancelled.reject(new Error('synthetic-private-cancel'));
    if (order === 'read-first') endRead(); else endCancel(); await flush();
    expect(await h.ledger.process('blocked', owner)).toEqual(saturated); expect(releaseLock).not.toHaveBeenCalled();
    if (order === 'read-first') endCancel(); else endRead(); await flush();
    expect(releaseLock).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(readCall).toHaveBeenCalledOnce();
    expect(rows(h.options.databasePath)).toEqual(before);
    expect(await h.ledger.process('recovered', owner)).toMatchObject({kind: 'entitled'});
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['lookup', 'ack'] as const)('%s 정상 결과 뒤 cancel만 미완료여도 슬롯은 남고 공개 결과는 유지됩니다', async phase => {
    vi.useFakeTimers(); const cancelled = deferred<void>(), cancel = vi.fn(() => cancelled.promise), releaseLock = vi.fn();
    const bytes = new TextEncoder().encode(JSON.stringify(body())); let readCount = 0;
    const native = phase === 'lookup' ? response() : new Response(null);
    Object.defineProperty(native, 'body', {value: {getReader: () => ({read: async () => phase === 'lookup' && readCount++ === 0
      ? {done: false, value: bytes} : {done: true, value: undefined}, cancel, releaseLock})}});
    const h = rawFixture(phase); h.transport.mockResolvedValueOnce(native).mockImplementation(async () => phase === 'lookup' ? response() : new Response(null));
    expect(await h.ledger.process(token, owner)).toMatchObject({kind: 'entitled', acknowledgement: 'acknowledged'});
    expect(await h.ledger.process('blocked', owner)).toEqual(saturated); expect(releaseLock).not.toHaveBeenCalled();
    cancelled.resolve(); await flush(); expect(releaseLock).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
    expect(await h.ledger.process('recovered', owner)).toMatchObject({kind: 'entitled'});
  });
  it('원장 밖 async wrapper가 먼저 반환하면 숨긴 내부 cancel은 관찰할 수 없다는 경계를 유지합니다', async () => {
    vi.useFakeTimers(); const cancelled = deferred<void>(), cancel = vi.fn(() => cancelled.promise);
    const transport = vi.fn<typeof fetch>(async () => ({status: 200, headers: new Headers(), body: {getReader: () => ({read: async () => ({done: true, value: undefined}), cancel})}} as unknown as Response));
    const builtin = createLedgerAcknowledger(policy, transport);
    const h = open({maxPendingOperations: 1, acknowledge: async input => builtin(input)});
    expect(await h.ledger.process(token, owner)).toMatchObject({kind: 'entitled'}); await flush();
    expect(await h.ledger.process('next', owner)).toMatchObject({kind: 'entitled'});
    cancelled.resolve(); await flush(); expect(transport).toHaveBeenCalledTimes(2);
  });
});
