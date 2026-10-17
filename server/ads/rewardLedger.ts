/** 서버 전용 로컬 SQLite 보상권 소비. HTTP·인증·앱 연결은 별도입니다. */
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
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
  | {readonly kind: 'rejected'; readonly code: 'invalid-input' | 'invalid-claim' | 'voucher-missing' | 'round-closed' | 'round-limit' | 'expired' | 'invalid-time' | 'duplicate-transaction' | 'aborted' | 'invalid-callback' | 'policy-mismatch' | 'invalid-signature' | 'key-unavailable'}
  | {readonly kind: 'service-error'; readonly code: 'storage-unavailable'};
export type ClaimResult = {readonly kind:'claim-issued'; readonly customData:string; readonly userId:string; readonly expiresAt:number} | Exclude<RewardResult,{kind:'voucher-recorded'}>;
export interface RedeemedGrant {readonly opaqueGrantId:string;}
export type RedeemResult={readonly kind:'voucher-redeemed';readonly consumed:boolean;readonly grant:RedeemedGrant}|Exclude<RewardResult,{kind:'voucher-recorded'}>;
type GrantBinding={owner:string;round:string;environment:'test'|'production';opaqueGrantId:string};
// 이 모듈의 성공 소비 경로만 참조를 등록합니다. 직렬화·복사로는 권한이 이전되지 않습니다.
const grants=new WeakMap<object,GrantBinding>();
export function readRedeemedGrant(grant:unknown,context:TrustedRewardRound,environment:'test'|'production'):Readonly<Pick<GrantBinding,'opaqueGrantId'>>|undefined {
  try {
    const c=exactRecord(context,['ownerId','roundId']);
    if(!identity(c.ownerId)||!identity(c.roundId)||!grant||typeof grant!=='object')return;
    const b=grants.get(grant);
    if(b&&b.owner===c.ownerId&&b.round===c.roundId&&b.environment===environment)return Object.freeze({opaqueGrantId:b.opaqueGrantId});
  }catch{}
}
// 광고 실패 시 새 시도 가능(최대3), 회차 종료는 별도 영구 취소입니다.
const CLAIM_TTL=15*60_000, ARRIVAL_DELAY=5*60_000, EVENT_AGE=20*60_000, FUTURE_SKEW=30_000, MAX_ATTEMPTS=3;
const identity=(v:unknown):v is string=>typeof v==='string' && v.length>0 && v.length<=256 && !/[\u0000-\u001f\u007f]/.test(v);
function exactRecord(v:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw new Error();
  const own=Reflect.ownKeys(v);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))throw new Error();
  const out:Record<string,unknown>={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!('value' in d)||!d.enumerable)throw new Error();out[k]=d.value;}return out;
}
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
interface Claim {nonce_hash:string; user_hash:string; round_hash:string; ad_unit:string; issued_at:number; expires_at:number; state:string; tx_hash:string|null;}
const legacySchema={
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
const schema={...legacySchema,
  reward_redemptions:`CREATE TABLE reward_redemptions (
    round_hash TEXT PRIMARY KEY REFERENCES reward_vouchers(round_hash), tx_hash TEXT NOT NULL UNIQUE REFERENCES reward_vouchers(tx_hash),
    grant_id TEXT NOT NULL UNIQUE CHECK(length(grant_id)=64), redeemed_at INTEGER NOT NULL
  ) STRICT`,
  reward_auth:'CREATE TABLE reward_auth (id INTEGER PRIMARY KEY CHECK(id=1),state_mac TEXT NOT NULL CHECK(length(state_mac)=64)) STRICT',
};
const normalizedSql=(sql:string)=>sql.replace(/\s+/g,' ').trim();
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1_000_000_000_000&&v<=9_999_999_999_999;

export class RewardLedger {
  #db:DatabaseSync;
  #key:Buffer;
  #policy:AdmobPolicy;
  #verify:ReturnType<typeof createAdmobSsvVerifier>;
  #now:()=>number;
  #lastTime=-1;
  #closed=false;
  #ready=false;
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
        const entries=db!.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
        const oldProfile=this.#profile(1),profile=this.#profile(2);
        if(!entries.length){Object.values(schema).forEach(sql=>db!.exec(sql));db!.prepare('INSERT INTO reward_meta VALUES(1,?,0)').run(profile);}
        else {
          const old=db!.prepare('SELECT profile FROM reward_meta WHERE id=1').get();
          if(old?.profile===oldProfile){
            this.#checkSchema(legacySchema);this.#validateRows(oldProfile,false);
            db!.exec(schema.reward_redemptions);db!.exec(schema.reward_auth);
            db!.prepare('UPDATE reward_meta SET profile=? WHERE id=1').run(profile);
          }else {this.#checkSchema(schema);this.#validateRows(profile,true);this.#checkSeal();}
        }
        this.#checkSchema(schema);this.#capacity();this.#validateRows(profile,true);this.#seal();
      });
      this.#ready=true;
    } catch {try{db?.close();}catch{} this.#key.fill(0);throw new Error('reward-ledger-open-failed');}
  }
  #hmac(domain:string,value:string) {return createHmac('sha256',this.#key).update(domain+'\0'+value).digest('hex');}
  #profile(version:number){return JSON.stringify({version,ssv:SSV_PROFILE,policy:this.#policy,ttl:CLAIM_TTL,arrival:ARRIVAL_DELAY,age:EVENT_AGE,skew:FUTURE_SKEW,attempts:MAX_ATTEMPTS,keyCheck:this.#hmac('key-check','reward-v1'),...(version===2?{rowLimit:10000}:{})});}
  #checkSchema(expected:Record<string,string>){
    const entries=this.#db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    if(entries.map(r=>r.name).join()!==Object.keys(expected).sort().join())throw new Error();
    for(const r of entries)if(r.type!=='table'||normalizedSql(String(r.sql))!==normalizedSql(expected[String(r.name)]))throw new Error();
  }
  #capacity(reserve=0){
    // 전량 서명 검사량을 고정 상한 안에 제한합니다. 한도에서 새 쓰기는 rollback하며 자동 삭제하지 않습니다.
    const n=this.#db.prepare('SELECT (SELECT count(*) FROM reward_rounds)+(SELECT count(*) FROM reward_claims)+(SELECT count(*) FROM reward_vouchers)+(SELECT count(*) FROM reward_redemptions) AS n').get()?.n;
    if(typeof n!=='number'||n+reserve>10000)throw new Error();
  }
  #validateRows(profile:string,modern:boolean){
    const count=this.#db.prepare('SELECT (SELECT count(*) FROM reward_rounds)+(SELECT count(*) FROM reward_claims)+(SELECT count(*) FROM reward_vouchers)'+(modern?'+(SELECT count(*) FROM reward_redemptions)':'')+' AS n').get()?.n;
    if(typeof count!=='number'||count>10000)throw new Error();
    const meta=this.#db.prepare('SELECT * FROM reward_meta').all();
    if(meta.length!==1||meta[0].id!==1||meta[0].profile!==profile||!(meta[0].high_water===0||time(meta[0].high_water)))throw new Error();
    const high=Number(meta[0].high_water);
    const rounds=this.#db.prepare('SELECT * FROM reward_rounds').all(),claims=this.#db.prepare('SELECT * FROM reward_claims').all(),vouchers=this.#db.prepare('SELECT * FROM reward_vouchers').all();
    const roundMap=new Map(rounds.map(r=>[r.round_hash,r])),claimMap=new Map(claims.map(c=>[c.nonce_hash,c])),voucherMap=new Map(vouchers.map(v=>[v.nonce_hash,v])),roundVoucherMap=new Map(vouchers.map(v=>[v.round_hash,v]));
    const claimCounts=new Map<unknown,number>();for(const c of claims)claimCounts.set(c.round_hash,(claimCounts.get(c.round_hash)??0)+1);
    for(const r of rounds){if(!hex(r.round_hash)||!hex(r.owner_hash)||![0,1].includes(Number(r.closed))||!Number.isSafeInteger(r.attempts)||Number(r.attempts)<0||Number(r.attempts)>MAX_ATTEMPTS||(claimCounts.get(r.round_hash)??0)!==r.attempts)throw new Error();}
    for(const c of claims){
      if(!hex(c.nonce_hash)||!hex(c.user_hash)||!hex(c.round_hash)||!this.#policy.adUnits.includes(String(c.ad_unit))||!time(c.issued_at)||!time(c.expires_at)||c.expires_at-c.issued_at!==CLAIM_TTL||c.issued_at>high||!['pending','used'].includes(String(c.state)))throw new Error();
      const v=voucherMap.get(c.nonce_hash);
      if(c.state==='pending'?(c.tx_hash!==null||v!==undefined):(!hex(c.tx_hash)||!v||v.tx_hash!==c.tx_hash||v.round_hash!==c.round_hash))throw new Error();
    }
    for(const v of vouchers){const c=claimMap.get(v.nonce_hash);if(!hex(v.tx_hash)||!c||c.state!=='used'||c.tx_hash!==v.tx_hash||c.round_hash!==v.round_hash||!time(v.recorded_at)||v.recorded_at<Number(c.issued_at)||v.recorded_at>high||v.amount!==5||v.item!=='moves')throw new Error();}
    if(modern)for(const r of this.#db.prepare('SELECT * FROM reward_redemptions').all()){
      const v=roundVoucherMap.get(r.round_hash),b=roundMap.get(r.round_hash);
      if(!v||!b||v.tx_hash!==r.tx_hash||!time(r.redeemed_at)||r.redeemed_at<Number(v.recorded_at)||r.redeemed_at>high||r.grant_id!==this.#grantId(String(b.owner_hash),String(r.round_hash),String(r.tx_hash)))throw new Error();
    }
    if(this.#db.prepare('PRAGMA foreign_key_check').all().length)throw new Error();
  }
  #stateMac(){return this.#hmac('reward-state-v2',JSON.stringify(Object.keys(schema).filter(t=>t!=='reward_auth').sort().map(t=>[t,this.#db.prepare('SELECT * FROM '+t+' ORDER BY 1').all()])));}
  #checkSeal(){const rows=this.#db.prepare('SELECT * FROM reward_auth').all(),mac=this.#stateMac();if(rows.length!==1||rows[0].id!==1||!hex(rows[0].state_mac)||!timingSafeEqual(Buffer.from(rows[0].state_mac,'hex'),Buffer.from(mac,'hex')))throw new Error();}
  #seal(){this.#db.prepare('INSERT INTO reward_auth VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state_mac=excluded.state_mac').run(this.#stateMac());}
  #grantId(owner:string,round:string,tx:string){return this.#hmac('redemption-v2',JSON.stringify([this.#policy.environment,owner,round,tx]));}
  #binding(c:TrustedRewardRound) {
    try {
    const value=exactRecord(c,['ownerId','roundId']),owner=value.ownerId,round=value.roundId;
    if(!identity(owner) || !identity(round)) return;
    return {owner:this.#hmac('owner',owner),round:this.#hmac('round',JSON.stringify([owner,round]))};
    }catch{return;}
  }
  #transaction<T>(work:()=>T):T {
    this.#db.exec('BEGIN IMMEDIATE');
    try{if(this.#ready){this.#checkSchema(schema);this.#capacity();this.#validateRows(this.#profile(2),true);this.#checkSeal();}const result=work();if(this.#ready){this.#capacity();this.#validateRows(this.#profile(2),true);this.#seal();}this.#db.exec('COMMIT');return result;}
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
      return this.#transaction(()=>({kind:'voucher-status',present:!!this.#db.prepare('SELECT 1 FROM reward_vouchers WHERE round_hash=?').get(b.round)}));
    } catch{return {kind:'service-error',code:'storage-unavailable'};}
  }
  redeemVoucher(context:TrustedRewardRound):RedeemResult {
    let c:Record<string,unknown>,binding:{owner:string;round:string}|undefined;
    if(this.#closed)return {kind:'service-error',code:'storage-unavailable'};
    try{c=exactRecord(context,['ownerId','roundId']);binding=this.#binding(c as unknown as TrustedRewardRound);if(!binding)return {kind:'rejected',code:'invalid-input'};}catch{return {kind:'rejected',code:'invalid-input'};}
    try {
      const result=this.#transaction(()=>{
        const now=this.#time();if(now===undefined)return {kind:'rejected',code:'invalid-time'} as const;
        const prior=this.#db.prepare('SELECT grant_id FROM reward_redemptions WHERE round_hash=?').get(binding.round);
        // 영구 소비는 철회하지 않습니다. close 후에도 같은 소비의 복구 capability만 재발급합니다.
        if(prior)return {opaqueGrantId:String(prior.grant_id),consumed:false};
        const round=this.#db.prepare('SELECT * FROM reward_rounds WHERE round_hash=?').get(binding.round);
        if(round?.closed===1)return {kind:'rejected',code:'round-closed'} as const;
        const voucher=this.#db.prepare('SELECT tx_hash FROM reward_vouchers WHERE round_hash=?').get(binding.round);
        if(!voucher)return {kind:'rejected',code:'voucher-missing'} as const;
        const opaqueGrantId=this.#grantId(binding.owner,binding.round,String(voucher.tx_hash));
        this.#db.prepare('INSERT INTO reward_redemptions VALUES(?,?,?,?)').run(binding.round,String(voucher.tx_hash),opaqueGrantId,now);
        return {opaqueGrantId,consumed:true};
      });
      if(result.kind!==undefined)return result;
      // COMMIT 성공 뒤에만 등록합니다. close는 이미 발급한 참조를 취소하지 않으며 회차 원장이 최종 상태를 검사합니다.
      const grant=Object.freeze({opaqueGrantId:result.opaqueGrantId});
      grants.set(grant,{owner:c.ownerId as string,round:c.roundId as string,environment:this.#policy.environment==='synthetic'?'test':'production',opaqueGrantId:result.opaqueGrantId});
      return {kind:'voucher-redeemed',consumed:result.consumed,grant};
    }catch{return {kind:'service-error',code:'storage-unavailable'};}
  }
  close() {
    if(!this.#closed){this.#closed=true;try{this.#db.close();}catch{throw new Error('reward-ledger-close-failed');}finally{this.#key.fill(0);}}
  }
}
