/** 서버 전용 로컬 SQLite 보상권 원장. 실제 보드 지급/소비·HTTP·인증 구현이 아닙니다. */
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createAdmobSsvVerifier, snapshotPolicy, SSV_PROFILE, type AdmobPolicy, type SsvDependencies} from './admobSsv.ts';

export interface TrustedRewardRound {
  /** 서버 인증·신뢰된 게임 상태 계층에서 결정해야 합니다. 이 타입 자체는 인증 수단이 아닙니다. */
  readonly ownerId: string;
  readonly roundId: string;
}
export interface RewardLedgerOptions {
  readonly databasePath: string;
  /** 구매 원장과 별도 안정적인 32바이트 키를 비밀 저장소에서 주입합니다. 자동 읽기 없음. */
  readonly serverKey: Uint8Array;
  readonly policy: AdmobPolicy;
  readonly dependencies?: SsvDependencies;
}
export type RewardResult = {readonly kind: 'voucher-recorded'; readonly newGrant: boolean}
  | {readonly kind: 'rejected'; readonly code: 'invalid-input' | 'invalid-claim' | 'round-closed' | 'round-limit' | 'expired' | 'invalid-time' | 'duplicate-transaction' | 'aborted' | 'invalid-callback' | 'policy-mismatch' | 'invalid-signature' | 'key-unavailable'}
  | {readonly kind: 'service-error'; readonly code: 'storage-unavailable'};
export type ClaimResult = {readonly kind:'claim-issued'; readonly customData:string; readonly userId:string; readonly expiresAt:number} | Exclude<RewardResult,{kind:'voucher-recorded'}>;
// 광고 실패 시 새 시도 가능(최대3), 회차 종료는 별도 영구 취소입니다.
const CLAIM_TTL=15*60_000, ARRIVAL_DELAY=5*60_000, EVENT_AGE=20*60_000, FUTURE_SKEW=30_000, MAX_ATTEMPTS=3;
const identity=(v:unknown):v is string=>typeof v==='string' && v.length>0 && v.length<=256 && !/[\u0000-\u001f\u007f]/.test(v);
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
interface Claim {nonce_hash:string; user_hash:string; round_hash:string; ad_unit:string; issued_at:number; expires_at:number; state:string; tx_hash:string|null;}
const schema={
  reward_meta:'CREATE TABLE reward_meta (id INTEGER PRIMARY KEY CHECK(id=1),profile TEXT NOT NULL,high_water INTEGER NOT NULL) STRICT',
  reward_rounds:`CREATE TABLE reward_rounds (
    round_hash TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, closed INTEGER NOT NULL CHECK(closed IN(0,1)), attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 3)
  ) STRICT`,
  reward_claims:`CREATE TABLE reward_claims (
    nonce_hash TEXT PRIMARY KEY, user_hash TEXT NOT NULL UNIQUE, round_hash TEXT NOT NULL REFERENCES reward_rounds(round_hash),
    ad_unit TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN('pending','used')), tx_hash TEXT
  ) STRICT`,
  reward_vouchers:`CREATE TABLE reward_vouchers (
    tx_hash TEXT PRIMARY KEY, round_hash TEXT NOT NULL UNIQUE REFERENCES reward_rounds(round_hash),
    nonce_hash TEXT NOT NULL UNIQUE REFERENCES reward_claims(nonce_hash), recorded_at INTEGER NOT NULL, amount INTEGER NOT NULL CHECK(amount=5), item TEXT NOT NULL CHECK(item='moves')
  ) STRICT`,
};
const normalizedSql=(sql:string)=>sql.replace(/\s+/g,' ').trim();

export class RewardLedger {
  #db:DatabaseSync;
  #key:Buffer;
  #policy:AdmobPolicy;
  #verify:ReturnType<typeof createAdmobSsvVerifier>;
  #now:()=>number;
  #lastTime=-1;
  #closed=false;
  constructor(options:RewardLedgerOptions) {
    let copiedKey:Buffer|undefined;
    try {
      options={databasePath:options.databasePath,serverKey:options.serverKey,policy:options.policy,dependencies:options.dependencies};
      if (typeof options.databasePath!=='string' || !isAbsolute(options.databasePath) || !/\.sqlite$/.test(options.databasePath)
        || !(options.serverKey instanceof Uint8Array) || options.serverKey.byteLength!==32) throw new Error('invalid-reward-config');
      this.#key=copiedKey=Buffer.from(options.serverKey);
      this.#policy=snapshotPolicy(options.policy);
      const deps={...options.dependencies};
      this.#now=deps.now??Date.now;
      this.#verify=createAdmobSsvVerifier(this.#policy,deps);
    } catch {copiedKey?.fill(0);throw new Error('invalid-reward-config');}
    let db:DatabaseSync|undefined;
    try {
      db=new DatabaseSync(options.databasePath,{timeout:500,enableForeignKeyConstraints:true,allowExtension:false}); this.#db=db;
      const journal=db.prepare('PRAGMA journal_mode').get()?.journal_mode;
      if(journal!=='delete' && journal!=='wal') throw new Error();
      db.exec('PRAGMA synchronous=FULL');
      this.#transaction(()=>{
        const tables=db!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(v=>v.name).sort().join();
        if(tables!=='' && tables!=='reward_claims,reward_meta,reward_rounds,reward_vouchers') throw new Error();
        const profile=JSON.stringify({version:1,ssv:SSV_PROFILE,policy:this.#policy,ttl:CLAIM_TTL,arrival:ARRIVAL_DELAY,age:EVENT_AGE,skew:FUTURE_SKEW,attempts:MAX_ATTEMPTS,keyCheck:this.#hmac('key-check','reward-v1')});
        db!.exec(schema.reward_meta.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '));
        const old=db!.prepare('SELECT * FROM reward_meta WHERE id=1').get();
        if(old && old.profile!==profile) throw new Error();
        if(tables && !old) throw new Error();
        db!.prepare('INSERT OR IGNORE INTO reward_meta VALUES(1,?,0)').run(profile);
        // UNIQUE/PK/FK/CHECK까지 일치하는 자체 스키마만 허용합니다. 구매 DB migration 없음.
        for(const [table,sql] of Object.entries(schema)) {
          db!.exec(sql.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '));
          const stored=db!.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
          if(typeof stored!=='string' || normalizedSql(stored)!==normalizedSql(sql)) throw new Error();
        }
      });
    } catch {try{db?.close();}catch{} this.#key.fill(0);throw new Error('reward-ledger-open-failed');}
  }
  #hmac(domain:string,value:string) {return createHmac('sha256',this.#key).update(domain+'\0'+value).digest('hex');}
  #binding(c:TrustedRewardRound) {
    if(!c) return;
    const owner=c.ownerId, round=c.roundId;
    if(!identity(owner) || !identity(round)) return;
    return {owner:this.#hmac('owner',owner),round:this.#hmac('round',JSON.stringify([owner,round]))};
  }
  #transaction<T>(work:()=>T):T {
    this.#db.exec('BEGIN IMMEDIATE');
    try{const result=work();this.#db.exec('COMMIT');return result;}
    catch{try{this.#db.exec('ROLLBACK');}catch{}throw new Error('reward-write-failed');}
  }
  #time():number|undefined {
    const n=this.#now(), persisted=this.#db.prepare('SELECT high_water FROM reward_meta WHERE id=1').get()?.high_water;
    if(!Number.isSafeInteger(n) || n<1_000_000_000_000 || n>9_999_999_999_999-CLAIM_TTL-ARRIVAL_DELAY
      || typeof persisted!=='number' || n<persisted || n<this.#lastTime) return;
    this.#lastTime=n; this.#db.prepare('UPDATE reward_meta SET high_water=? WHERE id=1').run(n);return n;
  }
  issueClaim(context:TrustedRewardRound,adUnit:string):ClaimResult {
    try {
      if(this.#closed) return {kind:'service-error',code:'storage-unavailable'};
      const binding=this.#binding(context);
      if(!binding || !this.#policy.adUnits.includes(adUnit)) return {kind:'rejected',code:'invalid-input'};
      return this.#transaction(()=>{
        const now=this.#time(); if(now===undefined) return {kind:'rejected',code:'invalid-time'};
        const round=this.#db.prepare('SELECT * FROM reward_rounds WHERE round_hash=?').get(binding.round);
        if(round?.closed===1 || this.#db.prepare('SELECT 1 FROM reward_vouchers WHERE round_hash=?').get(binding.round)) return {kind:'rejected',code:'round-closed'};
        if(round && Number(round.attempts)>=MAX_ATTEMPTS) return {kind:'rejected',code:'round-limit'};
        this.#db.prepare('INSERT OR IGNORE INTO reward_rounds VALUES(?,?,0,0)').run(binding.round,binding.owner);
        const nonce=randomBytes(32).toString('base64url'), user=randomBytes(32).toString('base64url');
        this.#db.prepare('INSERT INTO reward_claims VALUES(?,?,?,?,?,?,?,NULL)').run(digest(nonce),digest(user),binding.round,adUnit,now,now+CLAIM_TTL,'pending');
        this.#db.prepare('UPDATE reward_rounds SET attempts=attempts+1 WHERE round_hash=?').run(binding.round);
        // 인증된 호출자에게만 반환하는 SDK용 opaque 값. 일반 결과/DB/log에는 원문 없음.
        return {kind:'claim-issued',customData:nonce,userId:user,expiresAt:now+CLAIM_TTL};
      });
    } catch{return {kind:'service-error',code:'storage-unavailable'};}
  }
  closeRound(context:TrustedRewardRound):{readonly kind:'round-closed'}|Exclude<RewardResult,{kind:'voucher-recorded'}> {
    try {
      if(this.#closed) return {kind:'service-error',code:'storage-unavailable'};
      const b=this.#binding(context); if(!b) return {kind:'rejected',code:'invalid-input'};
      return this.#transaction(()=>{
        if(this.#time()===undefined) return {kind:'rejected',code:'invalid-time'};
        this.#db.prepare('INSERT INTO reward_rounds VALUES(?,?,1,0) ON CONFLICT(round_hash) DO UPDATE SET closed=1').run(b.round,b.owner);
        return {kind:'round-closed'};
      });
    } catch{return {kind:'service-error',code:'storage-unavailable'};}
  }
  async processCallback(rawQuery:unknown,signal?:AbortSignal):Promise<RewardResult> {
    if(this.#closed) return {kind:'service-error',code:'storage-unavailable'};
    // 외부 verified:true/fact를 받지 않고 이 인스턴스 내부 검증기를 반드시 호출합니다.
    const result=await this.#verify(rawQuery,signal);
    if(this.#closed) return {kind:'service-error',code:'storage-unavailable'};
    if(result.kind!=='verified') return result;
    try {
      if(signal?.aborted) return {kind:'rejected',code:'aborted'};
      return this.#transaction(()=>{
        const now=this.#time(); if(now===undefined) return {kind:'rejected',code:'invalid-time'};
        const f=result.event, nonceHash=f.nonceHash, txHash=f.transactionHash;
        const claim=this.#db.prepare('SELECT * FROM reward_claims WHERE nonce_hash=?').get(nonceHash) as unknown as Claim|undefined;
        if(!claim || claim.user_hash!==f.userHash || claim.ad_unit!==f.adUnit) return {kind:'rejected',code:'invalid-claim'};
        if(this.#db.prepare('SELECT closed FROM reward_rounds WHERE round_hash=?').get(claim.round_hash)?.closed!==0) return {kind:'rejected',code:'round-closed'};
        const existing=this.#db.prepare('SELECT * FROM reward_vouchers WHERE tx_hash=?').get(txHash);
        if(existing) return existing.nonce_hash===nonceHash ? {kind:'voucher-recorded',newGrant:false}:{kind:'rejected',code:'duplicate-transaction'};
        if(claim.state!=='pending' || this.#db.prepare('SELECT 1 FROM reward_vouchers WHERE round_hash=?').get(claim.round_hash)) return {kind:'rejected',code:'round-closed'};
        const event=f.timestamp;
        if(event<claim.issued_at-FUTURE_SKEW || event>now+FUTURE_SKEW || event>claim.expires_at || now-event>EVENT_AGE) return {kind:'rejected',code:'invalid-time'};
        if(now>claim.expires_at+ARRIVAL_DELAY) return {kind:'rejected',code:'expired'};
        this.#db.prepare('UPDATE reward_claims SET state=?,tx_hash=? WHERE nonce_hash=?').run('used',txHash,nonceHash);
        this.#db.prepare('INSERT INTO reward_vouchers VALUES(?,?,?,?,5,?)').run(txHash,claim.round_hash,nonceHash,now,'moves');
        return {kind:'voucher-recorded',newGrant:true};
      });
    } catch{return {kind:'service-error',code:'storage-unavailable'};}
  }
  hasVoucher(context:TrustedRewardRound):{readonly kind:'voucher-status';readonly present:boolean}|Exclude<RewardResult,{kind:'voucher-recorded'}> {
    try {
      if(this.#closed) return {kind:'service-error',code:'storage-unavailable'};
      const b=this.#binding(context);if(!b)return {kind:'rejected',code:'invalid-input'};
      return {kind:'voucher-status',present:!!this.#db.prepare('SELECT 1 FROM reward_vouchers WHERE round_hash=?').get(b.round)};
    } catch{return {kind:'service-error',code:'storage-unavailable'};}
  }
  close() {
    if(!this.#closed){this.#closed=true;try{this.#db.close();}catch{throw new Error('reward-ledger-close-failed');}finally{this.#key.fill(0);}}
  }
}
