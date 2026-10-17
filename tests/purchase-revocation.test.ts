import {afterEach, describe, expect, it, vi} from 'vitest';
import {createCipheriv, createHash, createHmac} from 'node:crypto';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {PurchaseLedger, type PurchaseLedgerOptions} from '../server/commerce/purchaseLedger';

const policy = {packageName: 'com.example.pawblossom', productId: 'remove_ads', purchaseOptionId: 'permanent', mode: 'production' as const};
const key = new Uint8Array(32).fill(37), token = 'synthetic-private-purchase/token', oauth = 'synthetic-private-oauth';
const owner = {ownerId: 'synthetic-private-owner', expectedObfuscatedAccountId: 'synthetic-private-account'};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (domain: string, s: string) => createHmac('sha256', key).update(`${domain}\0${s}`).digest('hex');
const folders: string[] = [], connections: DatabaseSync[] = [], ledgers: PurchaseLedger[] = [];
const workers = new Set<Worker>();
const workerUrl = new URL('./helpers/purchase-ledger-worker.mjs', import.meta.url);
function path() {const folder = mkdtempSync(join(tmpdir(), 'pawblossom-voided-')); folders.push(folder); return join(folder, 'ledger.sqlite');}
function db(p: string) {const c = new DatabaseSync(p); connections.push(c); return c;}
const json = (v: unknown) => new Response(JSON.stringify(v), {headers: {'content-type': 'application/json'}});
const purchase = (ack = true) => ({purchaseStateContext: {purchaseState: 'PURCHASED'},
  acknowledgementState: ack ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' : 'ACKNOWLEDGEMENT_STATE_PENDING',
  obfuscatedExternalAccountId: owner.expectedObfuscatedAccountId,
  productLineItem: [{productId: policy.productId, productOfferDetails: {purchaseOptionId: policy.purchaseOptionId,
    quantity: 1, refundableQuantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}]});
const voided = (t = token) => ({purchaseToken: t, purchaseTimeMillis: String(Date.now() - 100_000), voidedTimeMillis: String(Date.now() - 50_000), voidedSource: 2, voidedReason: 7});
const window = () => ({startTime: Date.now() - 86_400_000, endTime: Date.now()});
function open(p = path(), patch: Partial<PurchaseLedgerOptions> = {}, body = purchase()) {
  const lookup = vi.fn<typeof fetch>(async () => json(body)), transport = vi.fn<typeof fetch>(async () => json({voidedPurchases: [voided()]}));
  const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => 'acknowledged');
  const options = {databasePath: p, serverKey: key, purchase: policy, getAccessToken: async () => oauth,
    acknowledge: ack, lookupTransport: lookup, voidedTransport: transport, ...patch};
  const ledger = new PurchaseLedger(options); ledgers.push(ledger);
  return {ledger, path: p, options, transport, lookup, ack, body};
}
function close(l: PurchaseLedger) {l.close(); ledgers.splice(ledgers.indexOf(l), 1);}
async function revoke(h: ReturnType<typeof open>, tokens = [token]) {
  h.transport.mockImplementation(async () => json({voidedPurchases: tokens.map(t => voided(t))}));
  return h.ledger.reconcileVoided(window());
}
const workerData = (p: string, extra = {}) => ({path: p, key: [...key], policy, account: owner.expectedObfuscatedAccountId, owner: owner.ownerId, token, ...extra});
async function child(data: ReturnType<typeof workerData>) {
  const p = fork(workerUrl, [], {execArgv: ['--experimental-strip-types'], stdio: ['ignore','ignore','ignore','ipc']});
  const exited = new Promise<void>(resolve => p.once('exit', () => resolve()));
  try {
    const output = new Promise<any>((resolve, reject) => {p.once('message', resolve); p.once('error', reject); p.once('exit', code => {if (code) reject(new Error('child-failed'));});});
    p.send(data); const result = await output; await exited; return result;
  } finally {if (p.exitCode === null) {p.kill(); await exited;}}
}
async function concurrent(data: ReturnType<typeof workerData>[]) {
  const active = data.map(d => new Worker(workerUrl, {workerData: d, execArgv: ['--experimental-strip-types']})); active.forEach(w => workers.add(w));
  let ready = 0;
  try {
    return await Promise.all(active.map(w => new Promise<any>((resolve, reject) => {
      w.on('message', v => {if (v === 'ready') {if (++ready === active.length) active.forEach(a => a.postMessage('run'));} else resolve(v);});
      w.once('error', reject); w.once('exit', code => {if (code) reject(new Error('worker-failed'));});
    })));
  } finally {await Promise.all(active.map(w => w.terminate())); active.forEach(w => workers.delete(w));}
}
// 실제 v1 schema/암호문/profile fixture. 원문은 DB에 넣지 않습니다.
function legacy(p = path()) {
  const connection = db(p);
  const profile = JSON.stringify({version: 1, package: policy.packageName, product: policy.productId, option: policy.purchaseOptionId,
    environment: policy.mode, keyCheck: hmac('key-check', 'v1')});
  connection.exec(`CREATE TABLE ledger_meta (id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL) STRICT;
    CREATE TABLE purchases (token_id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, envelope TEXT NOT NULL,
      ack TEXT NOT NULL CHECK(ack IN ('pending','acknowledged')), attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
      next_at INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE entitlements (owner_hash TEXT PRIMARY KEY, token_id TEXT NOT NULL UNIQUE REFERENCES purchases(token_id)) STRICT;`);
  connection.prepare('INSERT INTO ledger_meta VALUES (1,?)').run(profile);
  const iv = Buffer.alloc(12, 19), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(hash(token)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({token, account: owner.expectedObfuscatedAccountId})), cipher.final()]);
  const envelope = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  connection.prepare('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?)').run(hash(token), hmac('owner', owner.ownerId), envelope, 'pending', 3, 1234, 'synthetic-lease', 12345);
  connection.prepare('INSERT INTO entitlements VALUES (?,?)').run(hmac('owner', owner.ownerId), hash(token));
  return {path: p, connection, profile, envelope};
}
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all([...workers].map(w => w.terminate())); workers.clear();
  for (const l of ledgers.splice(0)) l.close(); for (const c of connections.splice(0)) c.close();
  for (const f of folders.splice(0)) rmSync(f, {recursive: true, force: true});
});

describe('영구 회수와 단일/복수 토큰 권한', () => {
  it('전액 회수·권한 제거·승인 대기 취소·lease 무효화를 원자적으로 저장합니다', async () => {
    const h = open(undefined, {acknowledge: async () => 'retry'}, purchase(false)); await h.ledger.process(token, owner);
    expect(await revoke(h)).toEqual({kind: 'reconcile-result', pages: 1, items: 1, revoked: 1, alreadyRevoked: 0, unknown: 0, removedEntitlements: 1});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(false);
    expect(db(h.path).prepare('SELECT * FROM purchases').get()).toMatchObject({revoked: 1, lease: null, lease_until: 0, next_at: 0});
    expect(h.ledger.acknowledgementSummary()).toEqual({pending: 0, attention: 0, inFlight: 0});
    expect(await h.ledger.retryPending()).toMatchObject({processed: 0});
    expect(await h.ledger.process(token, owner)).toEqual({kind: 'rejected', reason: 'token-revoked'});
  });
  it('재열기/중복/지연/빈 조회/다른 소유자/오래된 PURCHASED가 회수 기록을 되돌리지 않습니다', async () => {
    const h = open(); await h.ledger.process(token, owner); await revoke(h); close(h.ledger);
    const next = open(h.path); expect(await revoke(next, [token, token])).toMatchObject({items: 2, revoked: 0, alreadyRevoked: 1});
    expect(await revoke(next, [])).toMatchObject({revoked: 0});
    for (const context of [owner, {...owner, ownerId: 'different-owner'}]) expect(await next.ledger.process(token, context)).toEqual({kind: 'rejected', reason: 'token-revoked'});
    expect(next.lookup).not.toHaveBeenCalled(); expect(next.ack).not.toHaveBeenCalled(); expect(next.ledger.hasEntitlement(owner.ownerId)).toBe(false);
    expect(db(h.path).prepare('SELECT * FROM voided_tokens').all()).toHaveLength(1);
  });
  it('실제 프로세스 종료/시작 뒤에도 취소 토큰의 지급/승인 재개를 차단합니다', async () => {
    const p = path(); expect(await child(workerData(p))).toMatchObject({result: {kind: 'entitled'}, entitlement: true});
    expect(await child(workerData(p, {action: 'void'}))).toMatchObject({result: {revoked: 1}, entitlement: false});
    expect(await child(workerData(p, {pending: true}))).toMatchObject({result: {kind: 'rejected', reason: 'token-revoked'}, entitlement: false});
    expect(await child(workerData(p, {action: 'retry'}))).toMatchObject({result: {processed: 0}, entitlement: false});
  });
  it.each(['first', 'second'])('%s 토큰을 회수해도 다른 정상 구매가 있으면 권한을 유지합니다', async which => {
    const h = open(); await h.ledger.process(token, owner); await h.ledger.process('second-token', owner);
    expect(await revoke(h, [which === 'first' ? token : 'second-token'])).toMatchObject({revoked: 1, removedEntitlements: 0});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true);
    const active = db(h.path).prepare('SELECT token_id FROM entitlements').get()!;
    expect(active.token_id).toBe(hash(which === 'first' ? 'second-token' : token));
    expect(await revoke(h, [which === 'first' ? 'second-token' : token])).toMatchObject({revoked: 1, removedEntitlements: 1});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(false);
    expect(await h.ledger.process('new-valid-token', owner)).toMatchObject({kind: 'entitled', newGrant: true});
  });
  it('미등록 토큰은 hash 차단만 저장하고 소유자/구매/권한을 만들지 않습니다', async () => {
    const h = open(); expect(await revoke(h)).toMatchObject({unknown: 1, revoked: 0, removedEntitlements: 0});
    const c = db(h.path); expect(c.prepare('SELECT * FROM purchases').all()).toHaveLength(0); expect(c.prepare('SELECT * FROM entitlements').all()).toHaveLength(0);
    expect(c.prepare('SELECT * FROM voided_tokens').all()).toEqual([{token_id: hash(token), observed_at: expect.any(Number)}]);
    close(h.ledger); const next = open(h.path);
    expect(await next.ledger.process(token, owner)).toEqual({kind: 'rejected', reason: 'token-revoked'});
    expect(next.lookup).not.toHaveBeenCalled(); expect(await revoke(next)).toMatchObject({unknown: 1, revoked: 0});
  });
  it('DB 파일/WAL/결과/로그에는 토큰·OAuth·페이지 원문·owner·계정이 없습니다', async () => {
    const h = open(); const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    await h.ledger.process(token, owner);
    h.transport.mockResolvedValueOnce(json({voidedPurchases: [voided()], tokenPagination: {nextPageToken: 'synthetic-private-page-token'}})).mockResolvedValueOnce(json({}));
    const result = await h.ledger.reconcileVoided(window()); expect(result).toMatchObject({revoked: 1});
    const bytes = Buffer.concat(readdirSync(folders[0]).map(f => readFileSync(join(folders[0], f))));
    for (const secret of [token, oauth, 'synthetic-private-page-token', owner.ownerId, owner.expectedObfuscatedAccountId]) {expect(bytes.includes(Buffer.from(secret))).toBe(false); expect(JSON.stringify(result)).not.toContain(secret);}
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('환경/상품/옵션/패키지 구성은 기존 원장 binding이며 Voided 응답에서 추정하지 않습니다', async () => {
    const h = open(); await h.ledger.process(token, owner); await revoke(h); close(h.ledger);
    for (const change of [{mode: 'test'}, {productId: 'other'}, {purchaseOptionId: 'other'}, {packageName: 'com.other.app'}]) {
      expect(() => new PurchaseLedger({...h.options, purchase: {...policy, ...change} as any})).toThrow('ledger-open-failed');
    }
    expect(open(h.path).ledger.hasEntitlement(owner.ownerId)).toBe(false);
  });
});

describe('전체 검증 실패와 원자적 rollback', () => {
  it.each(['http', 'partial', 'bad-json', 'limit', 'cycle', 'metadata'])('두 번째 페이지 %s 실패는 기존 권한/승인/차단 기록 모두 보존합니다', async phase => {
    const h = open(undefined, {voided: {maxPages: phase === 'limit' ? 1 : 20}}); await h.ledger.process(token, owner);
    const before = db(h.path).prepare('SELECT * FROM purchases').all();
    h.transport.mockResolvedValueOnce(json({voidedPurchases: [voided()], tokenPagination: {nextPageToken: 'synthetic-next'}}));
    if (phase === 'http') h.transport.mockResolvedValueOnce(new Response('private-error', {status: 503}));
    if (phase === 'partial') h.transport.mockResolvedValueOnce(json({voidedPurchases: [{...voided('another'), voidedQuantity: 1}]}));
    if (phase === 'bad-json') h.transport.mockResolvedValueOnce(new Response('{bad', {headers: {'content-type': 'application/json'}}));
    if (phase === 'cycle') h.transport.mockResolvedValueOnce(json({tokenPagination: {nextPageToken: 'synthetic-next'}}));
    if (phase === 'metadata') h.transport.mockResolvedValueOnce(json({pageInfo: {totalResults: 3}}));
    expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'voided-error'});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true); expect(db(h.path).prepare('SELECT * FROM purchases').all()).toEqual(before);
    expect(db(h.path).prepare('SELECT * FROM voided_tokens').all()).toHaveLength(0);
  });
  it.each(['tombstone', 'purchase', 'entitlement', 'replacement'])('%s 쓰기 실패는 회수 및 모든 페이지 변경을 롤백합니다', async phase => {
    const h = open(); await h.ledger.process(token, owner); await h.ledger.process('second-token', owner);
    const c = db(h.path); const before = c.prepare('SELECT * FROM purchases').all();
    const table = phase === 'tombstone' ? 'voided_tokens' : phase === 'purchase' ? 'purchases' : 'entitlements';
    const operation = phase === 'tombstone' ? 'INSERT' : phase === 'entitlement' ? 'DELETE' : 'UPDATE';
    c.exec(`CREATE TRIGGER reject_revoke BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(FAIL,'synthetic-private-sql'); END;`);
    expect(await revoke(h, phase === 'replacement' ? [token] : [token, 'second-token', 'unknown'])).toEqual({kind: 'service-error', code: 'storage-unavailable'});
    expect(c.prepare('SELECT * FROM purchases').all()).toEqual(before); expect(c.prepare('SELECT * FROM voided_tokens').all()).toHaveLength(0);
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true);
  });
  it('조회 부재·조회 실패·오래된 창·클라이언트 취소 주장은 권한을 회수하지 않습니다', async () => {
    const h = open(); await h.ledger.process(token, owner); expect(await revoke(h, [])).toMatchObject({revoked: 0});
    expect(await h.ledger.reconcileVoided({startTime: Date.now() - 31 * 86_400_000, endTime: Date.now()})).toMatchObject({kind: 'voided-error', code: 'invalid-input'});
    h.body.purchaseStateContext.purchaseState = 'CANCELLED'; expect(await h.ledger.process(token, owner)).toMatchObject({reason: 'cancelled'});
    h.transport.mockRejectedValue(new Error(oauth)); expect(await h.ledger.reconcileVoided(window())).toMatchObject({kind: 'voided-error'});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true); expect(db(h.path).prepare('SELECT * FROM voided_tokens').all()).toHaveLength(0);
  });
  it('닫은 원장은 외부 GET를 시작하지 않습니다', async () => {
    const h = open(); close(h.ledger); expect(await h.ledger.reconcileVoided(window())).toEqual({kind: 'service-error', code: 'storage-unavailable'}); expect(h.transport).not.toHaveBeenCalled();
  });
});

describe('실제 v1→v2 migration과 구버전/변조 경계', () => {
  it('기존 암호문/소유자/권한/카운터/lease를 보존하여 원자적으로 v2로 전환합니다', async () => {
    const v1 = legacy(); const before = v1.connection.prepare('SELECT * FROM purchases').get(); const h = open(v1.path);
    expect(v1.connection.prepare('SELECT * FROM purchases').get()).toEqual({...before, revoked: 0, revoked_at: 0});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true);
    const profile = String(v1.connection.prepare('SELECT profile FROM ledger_meta').get()!.profile);
    expect(JSON.parse(profile)).toEqual({...JSON.parse(v1.profile), version: 2});
    // v1 코드의 exact profile 비교는 새 profile을 수용하지 못합니다.
    expect(profile).not.toBe(v1.profile);
    expect(await revoke(h)).toMatchObject({revoked: 1}); close(h.ledger);
    expect(await child(workerData(v1.path))).toMatchObject({result: {reason: 'token-revoked'}, entitlement: false});
  });
  it.each(['key', 'package', 'product', 'option', 'environment', 'future', 'extra-profile', 'missing', 'extra-column'])('%s 불일치는 migration 전에 실패하고 v1 자료를 보존합니다', phase => {
    const v1 = legacy(); const patch: {-readonly [K in keyof PurchaseLedgerOptions]?: PurchaseLedgerOptions[K]} = {};
    if (phase === 'key') patch.serverKey = new Uint8Array(32).fill(99);
    if (phase === 'package') patch.purchase = {...policy, packageName: 'com.other.app'};
    if (phase === 'product') patch.purchase = {...policy, productId: 'other'};
    if (phase === 'option') patch.purchase = {...policy, purchaseOptionId: 'other'};
    if (phase === 'environment') patch.purchase = {...policy, mode: 'test'};
    if (phase === 'future' || phase === 'extra-profile') v1.connection.prepare('UPDATE ledger_meta SET profile=?').run(JSON.stringify({...JSON.parse(v1.profile), ...(phase === 'future' ? {version: 3} : {extra: true})}));
    if (phase === 'missing') v1.connection.exec('DELETE FROM ledger_meta');
    if (phase === 'extra-column') v1.connection.exec('ALTER TABLE purchases ADD COLUMN unexpected TEXT');
    const before = v1.connection.prepare('SELECT * FROM purchases').all(), profile = v1.connection.prepare('SELECT * FROM ledger_meta').all();
    expect(() => open(v1.path, patch)).toThrow('ledger-open-failed');
    expect(v1.connection.prepare('SELECT * FROM purchases').all()).toEqual(before); expect(v1.connection.prepare('SELECT * FROM ledger_meta').all()).toEqual(profile);
    expect(v1.connection.prepare("SELECT * FROM sqlite_master WHERE name='voided_tokens'").get()).toBeUndefined();
  });
  it('profile 갱신 실패는 ALTER COLUMN까지 롤백하며 다음 정상 open에서만 전환합니다', () => {
    const v1 = legacy(); v1.connection.exec("CREATE TRIGGER migration_fail BEFORE UPDATE ON ledger_meta BEGIN SELECT RAISE(FAIL,'private-error'); END;");
    expect(() => open(v1.path)).toThrow('ledger-open-failed');
    expect(v1.connection.prepare('PRAGMA table_info(purchases)').all().map(c => c.name)).not.toContain('revoked');
    expect(v1.connection.prepare('SELECT profile FROM ledger_meta').get()!.profile).toBe(v1.profile);
    v1.connection.exec('DROP TRIGGER migration_fail'); expect(open(v1.path).ledger.hasEntitlement(owner.ownerId)).toBe(true);
  });
  it.each(['valid-shape', 'broken-shape'])('v1에 %s 거부 table이 섞여 있으면 부분 전환으로 거절합니다', shape => {
    const v1 = legacy(); v1.connection.exec(shape === 'valid-shape'
      ? 'CREATE TABLE voided_tokens(token_id TEXT PRIMARY KEY,observed_at INTEGER NOT NULL) STRICT'
      : 'CREATE TABLE voided_tokens(unexpected TEXT)');
    expect(() => open(v1.path)).toThrow('ledger-open-failed');
    expect(v1.connection.prepare('SELECT profile FROM ledger_meta').get()!.profile).toBe(v1.profile);
    expect(v1.connection.prepare('PRAGMA table_info(purchases)').all().map(c => c.name)).not.toContain('revoked');
    expect(v1.connection.prepare('SELECT * FROM entitlements').all()).toHaveLength(1);
  });
  it('동시 독립 worker open에서도 migration과 회수/지급은 직렬화됩니다', async () => {
    const v1 = legacy(); const results = await concurrent([workerData(v1.path, {action: 'void'}), workerData(v1.path), workerData(v1.path, {action: 'void'})]);
    expect(results.every(r => !r.error)).toBe(true); const h = open(v1.path);
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(false); expect(await h.ledger.process(token, owner)).toMatchObject({reason: 'token-revoked'});
    expect(v1.connection.prepare('SELECT * FROM voided_tokens').all()).toHaveLength(1);
  });
});

describe('지급/승인과 회수 경합', () => {
  it('뒤 토큰 재시도 중 앞 토큰이 회수되면 최종 승인 집계도 다시 확인합니다', async () => {
    const h = open(undefined, {acknowledge: async () => 'retry'}, purchase(false));
    await h.ledger.process(token, owner); await h.ledger.process('second-token', owner);
    db(h.path).exec('UPDATE purchases SET next_at=0');
    let release!: (value: 'acknowledged') => void; let calls = 0;
    close(h.ledger); const ack = vi.fn<PurchaseLedgerOptions['acknowledge']>(async () => {if (++calls === 2) return new Promise(resolve => {release = resolve;}); return 'acknowledged';});
    const next = open(h.path, {acknowledge: ack}, purchase(false)); const pending = next.ledger.retryPending();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const c = db(h.path), firstId = String(c.prepare("SELECT token_id FROM purchases WHERE ack='acknowledged'").get()!.token_id);
    await revoke(next, [firstId === hash(token) ? token : 'second-token']); release('acknowledged');
    expect(await pending).toMatchObject({processed: 2, acknowledged: 1});
    expect(next.ledger.hasEntitlement(owner.ownerId)).toBe(true);
  });
  it.each([false, true])('기존 등록=%s의 대기 GET 뒤 회수되면 늦은 PURCHASED가 지급하지 못합니다', async registered => {
    const h = open(); if (registered) await h.ledger.process(token, owner);
    const next = open(h.path); let release!: (v: Response) => void;
    h.lookup.mockImplementation(() => new Promise(resolve => {release = resolve;}));
    const pending = h.ledger.process(token, owner); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await revoke(next)).toMatchObject(registered ? {revoked: 1} : {unknown: 1}); release(json(purchase()));
    expect(await pending).toEqual({kind: 'rejected', reason: 'token-revoked'}); expect(next.ledger.hasEntitlement(owner.ownerId)).toBe(false);
    expect(h.ack).not.toHaveBeenCalled();
  });
  it('미등록 토큰 최초 지급 4개 worker와 회수 worker의 동시 commit 뒤 최종 권한은 없습니다', async () => {
    const p = path(); const results = await concurrent([...Array.from({length: 4}, (_, i) => workerData(p, {owner: `synthetic-owner-${i}`})), workerData(p, {action: 'void'})]);
    expect(results.every(r => !r.error)).toBe(true); const h = open(p);
    for (let i = 0; i < 4; i++) {expect(h.ledger.hasEntitlement(`synthetic-owner-${i}`)).toBe(false); expect(await h.ledger.process(token, {...owner, ownerId: `synthetic-owner-${i}`})).toMatchObject({reason: 'token-revoked'});}
    expect(db(p).prepare('SELECT * FROM entitlements').all()).toHaveLength(0);
  });
  it.each(['lookup', 'oauth', 'post'])('승인 %s가 대기 중 회수되면 lease/늦은 완료/응답이 권한을 복원하지 못합니다', async phase => {
    const h = open(undefined, {}, purchase(false)); const other = open(h.path);
    let release!: (value: any) => void;
    if (phase === 'lookup') h.lookup.mockResolvedValueOnce(json(purchase(false))).mockImplementation(() => new Promise(resolve => {release = resolve;}));
    if (phase === 'oauth') {let calls = 0; close(h.ledger); h.options.getAccessToken = async () => {if (++calls === 3) return new Promise(resolve => {release = resolve;}); return oauth;}; h.ledger = new PurchaseLedger(h.options); ledgers.push(h.ledger);}
    if (phase === 'post') h.ack.mockImplementation(() => new Promise(resolve => {release = resolve;}));
    const pending = h.ledger.process(token, owner); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await revoke(other)).toMatchObject({revoked: 1});
    release(phase === 'lookup' ? json(purchase(false)) : phase === 'oauth' ? oauth : 'acknowledged');
    expect(await pending).toEqual({kind: 'rejected', reason: 'token-revoked'});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(false);
    expect(db(h.path).prepare('SELECT * FROM purchases').get()).toMatchObject({revoked: 1, ack: 'pending', lease: null});
    expect(h.ack).toHaveBeenCalledTimes(phase === 'post' ? 1 : 0);
    expect(await h.ledger.retryPending()).toMatchObject({processed: 0});
  });
  it('타임아웃 뒤 늦은 성공도 회수와 새 정상 토큰 권한을 덮어쓰지 않습니다', async () => {
    vi.useFakeTimers(); let release!: (s: 'acknowledged') => void;
    const h = open(undefined, {acknowledge: () => new Promise(resolve => {release = resolve;})}, purchase(false));
    const pending = h.ledger.process(token, owner); await vi.advanceTimersByTimeAsync(10_000); expect(await pending).toMatchObject({acknowledgement: 'pending'});
    await revoke(h); h.body.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
    expect(await h.ledger.process('new-valid-token', owner)).toMatchObject({newGrant: true});
    release('acknowledged'); await vi.advanceTimersByTimeAsync(0);
    expect(db(h.path).prepare('SELECT * FROM purchases WHERE token_id=?').get(hash(token))).toMatchObject({revoked: 1, ack: 'pending', lease: null});
    expect(h.ledger.hasEntitlement(owner.ownerId)).toBe(true);
  });
});
