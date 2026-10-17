/** 서버 전용 파일 원장. 앱 import 금지. 구성/키/OAuth/인증 context를 자동으로 읽지 않습니다. */
import {createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createPlayPurchaseLookup, type PlayPurchaseServerConfig, type PurchaseLookupResult} from './googlePlayPurchase.ts';

export interface TrustedPurchaseOwner {
  /** 인증 미들웨어가 결정해야 합니다. HTTP body userId를 복사하는 것은 인증이 아닙니다. */
  readonly ownerId: string;
  readonly expectedObfuscatedAccountId: string;
}
export interface PurchaseAcknowledgerInput {
  readonly packageName: string;
  readonly productId: string;
  readonly purchaseToken: string;
  readonly accessToken: string;
  readonly signal: AbortSignal;
}
export interface PurchaseLedgerOptions {
  readonly databasePath: string;
  /** 서버 비밀 저장소에서 주입한 안정적인 32바이트 키. DB와 분리 보존/백업해야 합니다. */
  readonly serverKey: Uint8Array;
  readonly purchase: PlayPurchaseServerConfig;
  /** 매 조회/재시도에 신선한 OAuth를 주입합니다. 반환값은 DB에 저장하지 않습니다. */
  readonly getAccessToken: () => Promise<string>;
  /** 신뢰된 서버 전용 구현. 실제 Google POST transport는 별도 후속 구현입니다. */
  readonly acknowledge: (input: PurchaseAcknowledgerInput) => Promise<'acknowledged' | 'retry'>;
  readonly lookupTransport?: typeof fetch;
}
type Fact = Extract<PurchaseLookupResult, {kind: 'purchase-fact'}>['fact'];
type NotPurchased = Exclude<PurchaseLookupResult, {kind: 'purchase-fact'}>;
export type PurchaseProcessResult = NotPurchased
  | {readonly kind: 'rejected'; readonly reason: 'owner-conflict' | 'environment-mismatch'}
  | {readonly kind: 'service-error'; readonly code: 'invalid-input' | 'storage-unavailable'}
  | {readonly kind: 'entitled'; readonly newGrant: boolean; readonly acknowledgement: 'acknowledged' | 'pending' | 'attention'};
interface Row {
  token_id: string; owner_hash: string; envelope: string; ack: string;
  attempts: number; next_at: number; lease: string | null; lease_until: number;
}
const MAX_ATTEMPTS = 5;
const ATTEMPT_TIMEOUT = 10_000;
const LEASE_MS = 60_000;
const bounded = (v: unknown, n: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= n && /^[\x21-\x7e]+$/.test(v);
const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Node24(검증24.21.0)/Node22.16+의 DatabaseSync API를 사용합니다. 로컬 영구 디스크 전용입니다.
 * SQLite 파일/키 접근 제어·인증·백업·감시·권한 회수는 배포자가 준비해야 합니다.
 * 대기 루프 없이 신뢰된 서버 작업이 retryPending을 명시 호출합니다.
 */
export class PurchaseLedger {
  #db: DatabaseSync;
  #key: Buffer;
  #policy: PlayPurchaseServerConfig;
  #lookup: ReturnType<typeof createPlayPurchaseLookup>;
  #accessToken: PurchaseLedgerOptions['getAccessToken'];
  #acknowledge: PurchaseLedgerOptions['acknowledge'];
  #closed = false;

  constructor(options: PurchaseLedgerOptions) {
    if (!options || typeof options.databasePath !== 'string' || !isAbsolute(options.databasePath) || !/\.sqlite$/.test(options.databasePath)
      || !(options.serverKey instanceof Uint8Array) || options.serverKey.byteLength !== 32
      || typeof options.getAccessToken !== 'function' || typeof options.acknowledge !== 'function') {
      throw new Error('invalid-ledger-config');
    }
    this.#key = Buffer.from(options.serverKey);
    this.#policy = {...options.purchase};
    this.#lookup = createPlayPurchaseLookup(this.#policy, options.lookupTransport);
    this.#accessToken = options.getAccessToken;
    this.#acknowledge = options.acknowledge;
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(options.databasePath, {timeout: 5_000, enableForeignKeyConstraints: true, allowExtension: false});
      this.#db = db;
      // 새 파일은 기본 DELETE journal을 사용합니다. 동시 open에서 journal 모드를 변경하지 않습니다.
      // 기존 WAL 파일도 허용하되 journal OFF/MEMORY는 거절합니다. 공유 디스크는 대상 밖입니다.
      const journal = db.prepare('PRAGMA journal_mode').get();
      if (journal?.journal_mode !== 'delete' && journal?.journal_mode !== 'wal') throw new Error('unsafe-journal');
      db.exec('PRAGMA synchronous=FULL;');
      this.#transaction(() => {
        db!.exec('CREATE TABLE IF NOT EXISTS ledger_meta (id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL) STRICT;');
        const profile = JSON.stringify({version: 1, package: this.#policy.packageName, product: this.#policy.productId,
          option: this.#policy.purchaseOptionId, environment: this.#policy.mode, keyCheck: this.#hash('key-check', 'v1')});
        const old = db!.prepare('SELECT profile FROM ledger_meta WHERE id=1').get();
        if (old && old.profile !== profile) throw new Error('ledger-profile-mismatch');
        if (!old && db!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('purchases','entitlements')").get()) {
          throw new Error('ledger-profile-missing');
        }
        db!.prepare('INSERT OR IGNORE INTO ledger_meta VALUES (1, ?)').run(profile);
        db!.exec(`
          CREATE TABLE IF NOT EXISTS purchases (
            token_id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, envelope TEXT NOT NULL,
            ack TEXT NOT NULL CHECK(ack IN ('pending','acknowledged')),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
            next_at INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0
          ) STRICT;
          CREATE TABLE IF NOT EXISTS entitlements (
            owner_hash TEXT PRIMARY KEY, token_id TEXT NOT NULL UNIQUE REFERENCES purchases(token_id)
          ) STRICT;
        `);
      });
    } catch {
      try { db?.close(); } catch { /* 경로/SQL/값 원문을 외부에 노출하지 않습니다. */ }
      this.#key.fill(0);
      throw new Error('ledger-open-failed');
    }
  }

  #hash(domain: string, value: string): string {
    return createHmac('sha256', this.#key).update(`${domain}\0${value}`).digest('hex');
  }
  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch { try { this.#db.exec('ROLLBACK'); } catch { /* 원본 오류도 비공개입니다. */ } throw new Error('ledger-write-failed'); }
  }
  #seal(id: string, token: string, account: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({token, account}), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  #unseal(row: Row): {token: string; account: string} {
    const bytes = Buffer.from(row.envelope, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(row.token_id)); decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    if (!bounded(value.token, 4096) || !bounded(value.account, 64) || tokenId(value.token) !== row.token_id) throw new Error('invalid-envelope');
    return value;
  }
  #row(id: string): Row | undefined {
    return this.#db.prepare('SELECT * FROM purchases WHERE token_id=?').get(id) as unknown as Row | undefined;
  }
  #matches(fact: Fact): boolean {
    return fact.environment === this.#policy.mode && fact.packageName === this.#policy.packageName
      && fact.productId === this.#policy.productId && fact.purchaseOptionId === this.#policy.purchaseOptionId;
  }
  async #query(token: string, account: string, signal?: AbortSignal): Promise<PurchaseLookupResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop!: (code: 'timeout' | 'aborted') => void;
    const expired = new Promise<PurchaseLookupResult>(resolve => {
      stop = code => { controller.abort(); resolve({kind: 'lookup-error', code}); };
      timer = setTimeout(() => stop('timeout'), ATTEMPT_TIMEOUT);
    });
    const onAbort = () => stop('aborted');
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) stop('aborted');
    const work = async (): Promise<PurchaseLookupResult> => {
      try {
        const accessToken = await this.#accessToken();
        if (controller.signal.aborted) return {kind: 'lookup-error', code: 'aborted'};
        return await this.#lookup({purchaseToken: token, expectedObfuscatedAccountId: account, accessToken, signal: controller.signal});
      } catch { return {kind: 'lookup-error', code: 'transport-error'}; }
    };
    try {
      return await Promise.race([work(), expired]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }

  async process(purchaseToken: string, context: TrustedPurchaseOwner): Promise<PurchaseProcessResult> {
    if (this.#closed) return {kind: 'service-error', code: 'storage-unavailable'};
    if (!bounded(purchaseToken, 4096) || purchaseToken === '.' || purchaseToken === '..'
      || !context || !bounded(context.ownerId, 256) || !bounded(context.expectedObfuscatedAccountId, 64)) {
      return {kind: 'service-error', code: 'invalid-input'};
    }
    // await 도중 호출자 객체 변경이 인증 context에 섞이지 않도록 복사합니다.
    const owner = context.ownerId, account = context.expectedObfuscatedAccountId;
    const verified = await this.#query(purchaseToken, account);
    if (verified.kind !== 'purchase-fact') return verified;
    if (!this.#matches(verified.fact)) return {kind: 'rejected', reason: 'environment-mismatch'};
    try {
      const id = tokenId(purchaseToken), ownerHash = this.#hash('owner', owner);
      const recorded = this.#transaction(() => {
        const old = this.#row(id);
        if (old && old.owner_hash !== ownerHash) return {conflict: true, newGrant: false};
        if (!old) {
          this.#db.prepare('INSERT INTO purchases(token_id, owner_hash, envelope, ack) VALUES (?,?,?,?)')
            .run(id, ownerHash, this.#seal(id, purchaseToken, account), verified.fact.acknowledgement);
        } else if (verified.fact.acknowledgement === 'acknowledged') {
          this.#db.prepare("UPDATE purchases SET ack='acknowledged', lease=NULL, lease_until=0 WHERE token_id=?").run(id);
        }
        const inserted = this.#db.prepare('INSERT OR IGNORE INTO entitlements(owner_hash,token_id) VALUES (?,?)').run(ownerHash, id);
        return {conflict: false, newGrant: inserted.changes === 1};
      });
      if (recorded.conflict) return {kind: 'rejected', reason: 'owner-conflict'};
      // 트랜잭션 성공 뒤에만 승인하며, 승인 실패가 영구 권한을 되돌리지 않습니다.
      const acknowledgement = await this.#attempt(id);
      return {kind: 'entitled', newGrant: recorded.newGrant, acknowledgement};
    } catch { return {kind: 'service-error', code: 'storage-unavailable'}; }
  }

  hasEntitlement(ownerId: string): boolean {
    if (!bounded(ownerId, 256)) throw new Error('invalid-owner');
    try { return !!this.#db.prepare('SELECT 1 FROM entitlements WHERE owner_hash=?').get(this.#hash('owner', ownerId)); }
    catch { throw new Error('ledger-read-failed'); }
  }

  /** 식별자 없이 영구 미승인/활성/시도 소진 수만 노출합니다. 재시작 뒤에도 조사 대상을 숨기지 않습니다. */
  acknowledgementSummary(): {pending: number; inFlight: number; attention: number} {
    try {
      const now = Date.now();
      const row = this.#db.prepare(`SELECT COUNT(*) AS pending,
        COALESCE(SUM(CASE WHEN lease_until>? THEN 1 ELSE 0 END),0) AS in_flight,
        COALESCE(SUM(CASE WHEN attempts>=5 AND lease_until<=? THEN 1 ELSE 0 END),0) AS attention
        FROM purchases WHERE ack='pending'`).get(now, now)!;
      return {pending: Number(row.pending), inFlight: Number(row.in_flight), attention: Number(row.attention)};
    } catch { throw new Error('ledger-read-failed'); }
  }

  async #attempt(id: string): Promise<'acknowledged' | 'pending' | 'attention'> {
    const now = Date.now(), lease = randomUUID();
    const claimed = this.#transaction(() => {
      const row = this.#row(id);
      if (!row) throw new Error('missing-purchase');
      if (row.ack === 'acknowledged') return {state: 'acknowledged' as const};
      if (row.lease_until > now) return {state: 'pending' as const};
      if (row.attempts >= MAX_ATTEMPTS) return {state: 'attention' as const};
      if (row.next_at > now) return {state: 'pending' as const};
      this.#db.prepare('UPDATE purchases SET attempts=attempts+1,lease=?,lease_until=?,next_at=? WHERE token_id=?')
        .run(lease, now + LEASE_MS, now + Math.min(60_000 * 2 ** row.attempts, 3_600_000), id);
      return {state: 'claimed' as const, row};
    });
    if (claimed.state !== 'claimed') return claimed.state;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async (): Promise<boolean> => {
      try {
        const payload = this.#unseal(claimed.row);
        // 응답 유실 뒤에도 재조회하며, 이미 승인되었다면 POST를 재전송하지 않습니다.
        const result = await this.#query(payload.token, payload.account, controller.signal);
        if (controller.signal.aborted || result.kind !== 'purchase-fact' || !this.#matches(result.fact)) return false;
        if (result.fact.acknowledgement === 'acknowledged') return true;
        const accessToken = await this.#accessToken();
        if (controller.signal.aborted || !bounded(accessToken, 8192) || !/^[A-Za-z0-9._~+\/-]+=*$/.test(accessToken)) return false;
        return await this.#acknowledge({packageName: this.#policy.packageName, productId: this.#policy.productId,
          purchaseToken: payload.token, accessToken, signal: controller.signal}) === 'acknowledged';
      } catch { return false; }
    };
    const expired = new Promise<boolean>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(false); }, ATTEMPT_TIMEOUT);
    });
    let success: boolean;
    try { success = await Promise.race([work(), expired]); }
    finally { clearTimeout(timer); }
    // 만료된 작업의 늦은 결과는 다른 lease를 갱신할 수 없습니다. 오류 본문은 저장하지 않습니다.
    this.#transaction(() => {
      this.#db.prepare('UPDATE purchases SET ack=?,lease=NULL,lease_until=0 WHERE token_id=? AND lease=?')
        .run(success ? 'acknowledged' : 'pending', id, lease);
    });
    const row = this.#row(id)!;
    return row.ack === 'acknowledged' ? 'acknowledged' : row.attempts >= MAX_ATTEMPTS ? 'attention' : 'pending';
  }

  /** 최대100건, 구매마다 통산5회. 초과 시 운영자 조사가 필요하며 자동 실행은 없습니다. */
  async retryPending(limit = 20): Promise<{kind: 'retry-result'; processed: number; acknowledged: number; attention: number} | {kind: 'service-error'; code: 'invalid-input' | 'storage-unavailable'}> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return {kind: 'service-error', code: 'invalid-input'};
    try {
      const now = Date.now();
      const rows = this.#db.prepare("SELECT token_id FROM purchases WHERE ack='pending' AND attempts<5 AND next_at<=? AND lease_until<=? ORDER BY next_at,token_id LIMIT ?").all(now, now, limit);
      let acknowledged = 0;
      for (const row of rows) {
        const state = await this.#attempt(row.token_id as string);
        if (state === 'acknowledged') acknowledged++;
      }
      return {kind: 'retry-result', processed: rows.length, acknowledged, attention: this.acknowledgementSummary().attention};
    } catch { return {kind: 'service-error', code: 'storage-unavailable'}; }
  }

  /** 진행 중 작업이 끝난 후 닫으세요. 닫은 뒤 사용은 안전한 오류가 됩니다. */
  close(): void {
    try { this.#db.close(); } catch { throw new Error('ledger-close-failed'); }
    finally { this.#closed = true; this.#key.fill(0); }
  }
}
