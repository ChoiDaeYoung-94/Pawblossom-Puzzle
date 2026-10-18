import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {PurchaseLedger, type PurchaseLedgerOptions} from '../server/commerce/purchaseLedger';

// 실제 계정/Google/키/포트/프로세스 없는 합성 수명 회귀입니다.
const policy = {packageName: 'com.example.pawblossom', productId: 'remove_ads', purchaseOptionId: 'permanent', mode: 'production' as const};
const owner = {ownerId: 'synthetic-owner', expectedObfuscatedAccountId: 'synthetic-account'};
const token = 'synthetic-private-token', oauth = 'synthetic-private-oauth', pageToken = 'synthetic-private-page';
const folders: string[] = [], ledgers: PurchaseLedger[] = [];
const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
const window = () => ({startTime: Date.now() - 86_400_000, endTime: Date.now()});
const item = (purchaseToken = token) => ({purchaseToken, purchaseTimeMillis: String(Date.now() - 100_000), voidedTimeMillis: String(Date.now() - 50_000), voidedSource: 2, voidedReason: 7});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function open(patch: Partial<PurchaseLedgerOptions> = {}, acknowledged = true) {
  const folder = mkdtempSync(join(tmpdir(), 'pawblossom-voided-lifetime-')); folders.push(folder);
  const access = vi.fn(async () => oauth), transport = vi.fn<typeof fetch>(async () => json({voidedPurchases: [item()]}));
  const body = {purchaseStateContext: {purchaseState: 'PURCHASED'},
    acknowledgementState: acknowledged ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' : 'ACKNOWLEDGEMENT_STATE_PENDING',
    obfuscatedExternalAccountId: owner.expectedObfuscatedAccountId,
    productLineItem: [{productId: policy.productId, productOfferDetails: {purchaseOptionId: policy.purchaseOptionId,
      quantity: 1, refundableQuantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}]};
  const lookup = vi.fn<typeof fetch>(async () => json(body));
  const options: PurchaseLedgerOptions = {databasePath: join(folder, 'ledger.sqlite'), serverKey: new Uint8Array(32).fill(53), purchase: policy,
    maxPendingOperations: 1, getAccessToken: access, acknowledge: async () => 'acknowledged', lookupTransport: lookup, voidedTransport: transport, ...patch};
  const ledger = new PurchaseLedger(options); ledgers.push(ledger);
  return {ledger, options, access, transport, lookup};
}
function state(h: ReturnType<typeof open>) {
  const db = new DatabaseSync(h.options.databasePath);
  try {return Object.fromEntries(['purchases', 'entitlements', 'voided_tokens', 'ledger_meta'].map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]));}
  finally {db.close();}
}
function readerResponse(value: unknown, cancel: () => Promise<void>) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)), releaseLock = vi.fn(); let calls = 0;
  const read = vi.fn(async () => calls++ === 0 ? {done: false, value: bytes} : {done: true, value: undefined});
  const cancelCall = vi.fn(cancel), response = json(value);
  Object.defineProperty(response, 'body', {value: {getReader: () => ({read, cancel: cancelCall, releaseLock})}});
  return {response, read, cancel: cancelCall, releaseLock};
}
const flush = () => vi.advanceTimersByTimeAsync(0);
const saturated = {kind: 'voided-error', code: 'transport-error'};
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const folder of folders.splice(0)) rmSync(folder, {recursive: true, force: true});
});

describe('회수 조회의 공유 그룹과 실제 작업 종료', () => {
  it.each(['oauth', 'fetch', 'read'] as const)('%s timeout 뒤 late resolve/reject까지 슬롯을 유지하며 부분 회수하지 않습니다', async phase => {
    for (const completion of ['resolve', 'reject']) {
      vi.useFakeTimers(); const h = open(); await h.ledger.process(token, owner); const before = state(h);
      const access = deferred<string>(), fetched = deferred<Response>(), chunk = deferred<ReadableStreamReadResult<Uint8Array>>();
      const cancel = vi.fn(async () => {}), releaseLock = vi.fn(), getReader = vi.fn(() => ({read: () => chunk.promise, cancel, releaseLock}));
      const raw = json({}); Object.defineProperty(raw, 'body', {value: {getReader, cancel}});
      if (phase === 'oauth') h.access.mockImplementationOnce(() => access.promise);
      if (phase === 'fetch') h.transport.mockImplementationOnce(() => fetched.promise);
      if (phase === 'read') h.transport.mockResolvedValueOnce(raw);
      const pending = h.ledger.reconcileVoided(window()); await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toEqual({kind: 'voided-error', code: 'timeout'});
      expect(await h.ledger.reconcileVoided(window())).toEqual(saturated);
      expect(await h.ledger.process('blocked', owner)).toEqual({kind: 'lookup-error', code: 'transport-error'});
      expect(state(h)).toEqual(before); const fetchCount = h.transport.mock.calls.length;
      const secret = new Error([token, oauth, pageToken].join('|'));
      if (phase === 'oauth') {if (completion === 'resolve') access.resolve(oauth); else access.reject(secret);}
      if (phase === 'fetch') {if (completion === 'resolve') fetched.resolve(raw); else fetched.reject(secret);}
      if (phase === 'read') {if (completion === 'resolve') chunk.resolve({done: true, value: undefined}); else chunk.reject(secret);}
      await flush(); expect(state(h)).toEqual(before); expect(h.transport).toHaveBeenCalledTimes(fetchCount);
      expect(cancel).toHaveBeenCalledTimes(phase === 'read' || phase === 'fetch' && completion === 'resolve' ? 1 : 0);
      if (phase === 'fetch') expect(getReader).not.toHaveBeenCalled();
      expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', revoked: 1});
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });
  it.each([30_000, 60_000])('기존 전체 기한 %sms는 10초로 줄지 않으며 경계 직전에 반환하지 않습니다', async timeoutMs => {
    vi.useFakeTimers(); const h = open({voided: timeoutMs === 30_000 ? undefined : {timeoutMs}}), gate = deferred<string>();
    h.access.mockImplementationOnce(() => gate.promise); let done = false;
    const pending = h.ledger.reconcileVoided(window()); void pending.then(() => {done = true;});
    await vi.advanceTimersByTimeAsync(10_000); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(timeoutMs - 10_001); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toEqual({kind: 'voided-error', code: 'timeout'});
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated);
    gate.resolve(oauth); await flush(); expect(h.transport).not.toHaveBeenCalled();
  });
  it.each(['process', 'retry', 'voided'] as const)('%s가 가진 max1을 나머지 경로도 공유하고 포화 호출은 OAuth/DB를 바꾸지 않습니다', async holder => {
    vi.useFakeTimers(); const h = open({acknowledge: async () => 'retry'}, false);
    await h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(60_001);
    const gate = deferred<string>(); h.access.mockImplementationOnce(() => gate.promise);
    const pending = holder === 'process' ? h.ledger.process('new', owner) : holder === 'retry' ? h.ledger.retryPending() : h.ledger.reconcileVoided(window());
    await flush(); const before = state(h), calls = h.access.mock.calls.length;
    expect(await h.ledger.process('blocked', owner)).toEqual({kind: 'lookup-error', code: 'transport-error'});
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated);
    expect(await h.ledger.retryPending()).toEqual({kind: 'retry-result', processed: 0, acknowledged: 0, attention: 0});
    expect(state(h)).toEqual(before); expect(h.access).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(30_000); await pending;
    const afterDeadline = state(h); expect(await h.ledger.reconcileVoided(window())).toEqual(saturated);
    gate.resolve(oauth); await flush(); expect(state(h)).toEqual(afterDeadline);
    expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', revoked: 1});
  });
  it('페이지마다 신선한 OAuth를 받되 입력 창과 최초 now snapshot은 교체하지 않습니다', async () => {
    vi.useFakeTimers(); const h = open(), gate = deferred<string>(), input = window(), expected = {...input};
    await h.ledger.process(token, owner);
    h.access.mockResolvedValueOnce(oauth).mockImplementationOnce(() => gate.promise);
    h.transport.mockResolvedValueOnce(json({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}})).mockResolvedValueOnce(json({}));
    const pending = h.ledger.reconcileVoided(input); await flush();
    input.startTime = 0; input.endTime = 0;
    vi.setSystemTime(Date.now() + 31 * 86_400_000);
    gate.resolve('synthetic-second-oauth'); expect(await pending).toMatchObject({kind: 'reconcile-result', pages: 2, revoked: 1});
    expect(h.access).toHaveBeenCalledTimes(3);
    for (const call of h.transport.mock.calls) {
      const url = new URL(String(call[0])); expect(url.searchParams.get('startTime')).toBe(String(expected.startTime)); expect(url.searchParams.get('endTime')).toBe(String(expected.endTime));
    }
    expect(h.transport.mock.calls[1][1]?.headers).toMatchObject({Authorization: 'Bearer synthetic-second-oauth'});
  });
});

describe('모든 페이지의 read/cancel 정리와 원자 회수', () => {
  it('timeout 뒤 늦은 Response도 cancel 한 번을 시작하고 그 종료까지 그룹을 유지합니다', async () => {
    vi.useFakeTimers(); const h = open(); await h.ledger.process(token, owner); const before = state(h);
    const fetched = deferred<Response>(), cancelled = deferred<void>(), cancel = vi.fn(() => cancelled.promise), getReader = vi.fn();
    h.transport.mockImplementationOnce(() => fetched.promise);
    const pending = h.ledger.reconcileVoided(window()); await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({code: 'timeout'});
    fetched.resolve({body: {cancel, getReader}} as unknown as Response); await flush();
    expect(cancel).toHaveBeenCalledOnce(); expect(getReader).not.toHaveBeenCalled(); expect(state(h)).toEqual(before);
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated);
    cancelled.resolve(); await flush(); expect(cancel).toHaveBeenCalledOnce(); expect(state(h)).toEqual(before);
    expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', revoked: 1});
  });
  it.each(['read-first', 'cancel-first'].flatMap(order => ['resolve', 'reject'].map(completion => ({order, completion}))))('$order/$completion 순서에서 read와 cancel 모두 종료 뒤 lock과 그룹을 회수합니다', async ({order, completion}) => {
    vi.useFakeTimers(); const h = open(); await h.ledger.process(token, owner); const before = state(h);
    const read = deferred<ReadableStreamReadResult<Uint8Array>>(), cancelled = deferred<void>();
    const cancel = vi.fn(() => cancelled.promise), releaseLock = vi.fn(), readCall = vi.fn(() => read.promise);
    const raw = json({}); Object.defineProperty(raw, 'body', {value: {getReader: () => ({read: readCall, cancel, releaseLock})}});
    h.transport.mockResolvedValueOnce(raw);
    const pending = h.ledger.reconcileVoided(window()); await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({code: 'timeout'}); expect(cancel).toHaveBeenCalledOnce();
    const endRead = () => completion === 'resolve' ? read.resolve({done: true, value: undefined}) : read.reject(new Error(token));
    const endCancel = () => completion === 'resolve' ? cancelled.resolve() : cancelled.reject(new Error(oauth));
    if (order === 'read-first') endRead(); else endCancel(); await flush();
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated); expect(releaseLock).not.toHaveBeenCalled();
    if (order === 'read-first') endCancel(); else endRead(); await flush();
    expect(releaseLock).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(readCall).toHaveBeenCalledOnce(); expect(state(h)).toEqual(before);
    expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', revoked: 1});
  });
  it.each(['first', 'last', 'both'] as const)('%s 페이지 cancel만 미완료여도 정상 facts는 원자 회수하고 모든 정리까지 공유 슬롯을 유지합니다', async outstanding => {
    vi.useFakeTimers(); const h = open(); await h.ledger.process(token, owner);
    const first = deferred<void>(), last = deferred<void>();
    const page1 = readerResponse({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}}, () => outstanding === 'last' ? Promise.resolve() : first.promise);
    const page2 = readerResponse({voidedPurchases: [item('synthetic-unknown')]}, () => outstanding === 'first' ? Promise.resolve() : last.promise);
    h.transport.mockResolvedValueOnce(page1.response).mockResolvedValueOnce(page2.response);
    expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', pages: 2, items: 2, revoked: 1, unknown: 1});
    await flush(); expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(false);
    expect(state(h).voided_tokens).toHaveLength(2);
    expect(page1.cancel).toHaveBeenCalledOnce(); expect(page2.cancel).toHaveBeenCalledOnce();
    expect(await h.ledger.process('blocked', owner)).toEqual({kind: 'lookup-error', code: 'transport-error'});
    expect(page1.releaseLock).toHaveBeenCalledTimes(outstanding === 'last' ? 1 : 0);
    expect(page2.releaseLock).toHaveBeenCalledTimes(outstanding === 'first' ? 1 : 0);
    first.resolve(); await flush();
    if (outstanding === 'both') expect(await h.ledger.reconcileVoided(window())).toEqual(saturated);
    last.resolve(); await flush();
    expect(page1.releaseLock).toHaveBeenCalledOnce(); expect(page2.releaseLock).toHaveBeenCalledOnce();
    expect(await h.ledger.process('recovered', owner)).toMatchObject({kind: 'entitled'}); expect(vi.getTimerCount()).toBe(0);
  });
  it('한 페이지의 정상 result도 cancel이 끝나기 전에는 그룹을 반환하지 않습니다', async () => {
    vi.useFakeTimers(); const h = open(); await h.ledger.process(token, owner); const cancelled = deferred<void>();
    const page = readerResponse({voidedPurchases: [item()]}, () => cancelled.promise); h.transport.mockResolvedValueOnce(page.response);
    expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', revoked: 1});
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated); expect(page.releaseLock).not.toHaveBeenCalled();
    cancelled.reject(new Error(oauth)); await flush(); expect(page.releaseLock).toHaveBeenCalledOnce();
    expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', alreadyRevoked: 1});
  });
  it.each(['timeout', 'abort', 'http', 'json'] as const)('앞 페이지 cancel pending과 뒷 페이지 %s는 부분 회수/늦은 DB 변경 없이 정리합니다', async failure => {
    vi.useFakeTimers(); const h = open(); await h.ledger.process(token, owner); const before = state(h);
    const cancelled = deferred<void>(), fetched = deferred<Response>(), controller = new AbortController();
    const first = readerResponse({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}}, () => cancelled.promise);
    h.transport.mockResolvedValueOnce(first.response);
    if (failure === 'http') h.transport.mockResolvedValueOnce(new Response(null, {status: 503}));
    else if (failure === 'json') h.transport.mockResolvedValueOnce(new Response('{broken', {headers: {'content-type': 'application/json'}}));
    else h.transport.mockImplementationOnce(() => fetched.promise);
    const pending = h.ledger.reconcileVoided({...window(), signal: controller.signal}); await flush();
    if (failure === 'abort') controller.abort(); else if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({kind: 'voided-error'}); expect(state(h)).toEqual(before);
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated);
    fetched.resolve(json({voidedPurchases: [item()]})); await flush(); expect(state(h)).toEqual(before);
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated); expect(first.releaseLock).not.toHaveBeenCalled();
    cancelled.resolve(); await flush(); expect(first.releaseLock).toHaveBeenCalledOnce(); expect(first.cancel).toHaveBeenCalledOnce();
    expect(state(h)).toEqual(before); expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'reconcile-result', revoked: 1});
  });
  it('앞 페이지 정상 정리의 동기 abort 재진입은 cancel 한 번이며 회수하지 않습니다', async () => {
    vi.useFakeTimers(); const h = open(); await h.ledger.process(token, owner); const before = state(h), controller = new AbortController(), cancelled = deferred<void>();
    const first = readerResponse({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}}, () => {controller.abort(); return cancelled.promise;});
    h.transport.mockResolvedValueOnce(first.response);
    expect(await h.ledger.reconcileVoided({...window(), signal: controller.signal})).toEqual({kind: 'voided-error', code: 'aborted'});
    expect(first.cancel).toHaveBeenCalledOnce(); expect(state(h)).toEqual(before); expect(h.transport).toHaveBeenCalledOnce();
    expect(await h.ledger.reconcileVoided(window())).toEqual(saturated); expect(first.releaseLock).not.toHaveBeenCalled();
    cancelled.resolve(); await flush(); expect(first.releaseLock).toHaveBeenCalledOnce(); expect(first.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
