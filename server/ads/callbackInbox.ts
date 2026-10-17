/** 서버 전용 bounded 영구 수신함. 수신은 보상 성공이 아닙니다. 공개 listener/스케줄러 없음. */
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
import {isAbsolute,resolve,dirname,basename,join} from 'node:path';
import {existsSync,realpathSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {isAdmobCallbackStructure,snapshotPolicy,SSV_PROFILE,type AdmobPolicy} from './admobSsv.ts';
import {RewardLedger,type RewardLedgerOptions,type RewardResult} from './rewardLedger.ts';

export interface CallbackInboxOptions {
  readonly databasePath:string;
  /** 구매/보상 원장 키와 다른 안정적인 32byte 키. 이 모듈은 파일/env에서 읽지 않습니다. */
  readonly encryptionKey:Uint8Array;
  readonly policy:AdmobPolicy;
  /** 신뢰된 서버 구성입니다. 외부 verified/event/processor는 받지 않습니다. */
  readonly rewardLedger:Omit<RewardLedgerOptions,'policy'>;
  readonly now?:()=>number;
  readonly maxRows?:number;
  readonly maxAttempts?:number;
  readonly maxAgeMs?:number;
  readonly leaseMs?:number;
  readonly backoffMs?:number;
  readonly maxBackoffMs?:number;
}
export type ReceiveResult={readonly kind:'accepted';readonly receipt:string}
  | {readonly kind:'rejected';readonly code:'invalid-callback'}
  | {readonly kind:'unavailable';readonly code:'capacity'|'storage'|'clock'};
export type WorkResult={readonly kind:'idle'|'completed'|'discarded'|'retry'|'stale'}
  | {readonly kind:'unavailable';readonly code:'storage'|'clock'};
interface Row {receipt:string;digest:string;received_at:number;iv:Uint8Array;tag:Uint8Array|null;ciphertext:Uint8Array|null;attempts:number;token:string|null;}
const schema={
  callback_meta:'CREATE TABLE callback_meta (id INTEGER PRIMARY KEY CHECK(id=1),profile TEXT NOT NULL,high_water INTEGER NOT NULL) STRICT',
  callback_inbox:`CREATE TABLE callback_inbox (
    receipt TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, received_at INTEGER NOT NULL,
    iv BLOB NOT NULL UNIQUE CHECK(length(iv)=12), tag BLOB, ciphertext BLOB,
    state TEXT NOT NULL CHECK(state IN('pending','processing','completed','discarded')),
    attempts INTEGER NOT NULL CHECK(attempts>=0), next_at INTEGER NOT NULL, lease_until INTEGER NOT NULL, token TEXT,
    CHECK((state IN('completed','discarded') AND tag IS NULL AND ciphertext IS NULL AND token IS NULL)
      OR (state IN('pending','processing') AND length(tag)=16 AND length(ciphertext) BETWEEN 1 AND 4096))
  ) STRICT`,
};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
function databaseIdentity(path:string) {
  const absolute=resolve(path),physical=existsSync(absolute)?realpathSync(absolute):join(realpathSync(dirname(absolute)),basename(absolute));
  return process.platform==='win32'?physical.toLowerCase():physical;
}
const unavailable=(code:'storage'|'clock'):WorkResult=>({kind:'unavailable',code});
function bound(v:number|undefined,d:number,min:number,max:number) {
  const n=v??d;if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error();return n;
}
export class CallbackInbox {
  #db:DatabaseSync;
  #key:Buffer;
  #ledger:RewardLedger;
  #now:()=>number;
  #profile:string;
  #rows:number;
  #attempts:number;
  #age:number;
  #lease:number;
  #backoff:number;
  #maxBackoff:number;
  #last=-1;
  #closed=false;
  constructor(input:CallbackInboxOptions) {
    let key:Buffer|undefined,ledgerKey:Buffer|undefined,ledger:RewardLedger|undefined,db:DatabaseSync|undefined;
    let path:string,ledgerOptions:RewardLedgerOptions;
    try {
      // getter/배열/키/의존성을 한 번 snapshot하고 구성 변경은 재시작 때도 거절합니다.
      const o={databasePath:input.databasePath,encryptionKey:input.encryptionKey,policy:input.policy,rewardLedger:input.rewardLedger,
        now:input.now,maxRows:input.maxRows,maxAttempts:input.maxAttempts,maxAgeMs:input.maxAgeMs,leaseMs:input.leaseMs,
        backoffMs:input.backoffMs,maxBackoffMs:input.maxBackoffMs};
      path=o.databasePath;
      if(typeof path!=='string'||!isAbsolute(path)||!path.endsWith('.sqlite')||!(o.encryptionKey instanceof Uint8Array)||o.encryptionKey.byteLength!==32)throw new Error();
      this.#key=key=Buffer.from(o.encryptionKey);
      const policy=snapshotPolicy(o.policy), r=o.rewardLedger;
      const rewardPath=r.databasePath,rewardKey=r.serverKey;
      if(typeof rewardPath!=='string'||!isAbsolute(rewardPath)||!rewardPath.endsWith('.sqlite')||!(rewardKey instanceof Uint8Array)||rewardKey.byteLength!==32)throw new Error();
      ledgerKey=Buffer.from(rewardKey);
      ledgerOptions={databasePath:rewardPath,serverKey:ledgerKey,dependencies:{...r.dependencies},policy};
      const target=databaseIdentity(rewardPath);
      if(databaseIdentity(path)===target||key.equals(ledgerKey))throw new Error();
      this.#now=o.now??Date.now;if(typeof this.#now!=='function')throw new Error();
      this.#rows=bound(o.maxRows,10_000,1,100_000);this.#attempts=bound(o.maxAttempts,8,1,32);
      this.#age=bound(o.maxAgeMs,20*60_000,1,86_400_000);this.#lease=bound(o.leaseMs,30_000,1,300_000);
      this.#backoff=bound(o.backoffMs,1000,1,300_000);this.#maxBackoff=bound(o.maxBackoffMs,60_000,this.#backoff,300_000);
      const rewardBinding=hash(JSON.stringify([target,createHmac('sha256',ledgerKey).update('callback-inbox-target-reward-v1').digest('hex')]));
      this.#profile=JSON.stringify({version:1,ssv:SSV_PROFILE,policy,rewardBinding,rows:this.#rows,attempts:this.#attempts,age:this.#age,lease:this.#lease,
        backoff:this.#backoff,maxBackoff:this.#maxBackoff,keyCheck:createHmac('sha256',key).update('callback-inbox-v1-key-check').digest('hex')});
    } catch {key?.fill(0);ledgerKey?.fill(0);throw new Error('invalid-callback-inbox-config');}
    try {
      db=new DatabaseSync(path,{timeout:500,enableForeignKeyConstraints:true,allowExtension:false});this.#db=db;
      if(!['delete','wal'].includes(String(db.prepare('PRAGMA journal_mode').get()?.journal_mode)))throw new Error();
      db.exec('PRAGMA synchronous=FULL');
      this.#tx(()=>{
        const tables=db!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name).sort().join();
        if(tables!==''&&tables!=='callback_inbox,callback_meta')throw new Error();
        for(const [table,sql] of Object.entries(schema)) {
          db!.exec(sql.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '));
          const stored=db!.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
          if(typeof stored!=='string'||normalize(stored)!==normalize(sql))throw new Error();
        }
        const old=db!.prepare('SELECT * FROM callback_meta WHERE id=1').get();
        if((tables&&!old)||(old&&old.profile!==this.#profile))throw new Error();
        db!.prepare('INSERT OR IGNORE INTO callback_meta VALUES(1,?,0)').run(this.#profile);
      });
      this.#ledger=ledger=new RewardLedger(ledgerOptions);
    } catch {try{ledger?.close();}catch{}try{db?.close();}catch{}key.fill(0);throw new Error('callback-inbox-open-failed');}
    finally {ledgerKey!.fill(0);}
  }
  #tx<T>(work:()=>T):T {
    this.#db.exec('BEGIN IMMEDIATE');
    try{const result=work();this.#db.exec('COMMIT');return result;}
    catch{try{this.#db.exec('ROLLBACK');}catch{}throw new Error('callback-inbox-write-failed');}
  }
  #time():number|undefined {
    const t=this.#now(),m=this.#db.prepare('SELECT profile,high_water FROM callback_meta WHERE id=1').get();
    if(!m||m.profile!==this.#profile)throw new Error();
    if(!Number.isSafeInteger(t)||t<1_000_000_000_000||t>9_999_999_999_999-86_400_000
      ||typeof m.high_water!=='number'||!Number.isSafeInteger(m.high_water)||m.high_water<0||t<m.high_water||t<this.#last)return;
    this.#last=t;this.#db.prepare('UPDATE callback_meta SET high_water=? WHERE id=1').run(t);return t;
  }
  #aad(r:Pick<Row,'receipt'|'digest'|'received_at'>) {return Buffer.from(JSON.stringify([this.#profile,r.receipt,r.digest,r.received_at]));}
  receive(raw:unknown):ReceiveResult {
    if(this.#closed)return {kind:'unavailable',code:'storage'};
    if(!isAdmobCallbackStructure(raw))return {kind:'rejected',code:'invalid-callback'};
    const query=raw as string;
    try{return this.#tx(()=>{
      const now=this.#time();if(now===undefined)return {kind:'unavailable',code:'clock'};
      const digest=hash(query),old=this.#db.prepare('SELECT receipt FROM callback_inbox WHERE digest=?').get(digest);
      if(old)return {kind:'accepted',receipt:String(old.receipt)};
      if(Number(this.#db.prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n)>=this.#rows)return {kind:'unavailable',code:'capacity'};
      const receipt=randomBytes(24).toString('hex'),iv=randomBytes(12),row={receipt,digest,received_at:now};
      const cipher=createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(this.#aad(row));
      const encrypted=Buffer.concat([cipher.update(query,'utf8'),cipher.final()]);
      this.#db.prepare('INSERT INTO callback_inbox VALUES(?,?,?,?,?,?,\'pending\',0,?,0,NULL)').run(receipt,digest,now,iv,cipher.getAuthTag(),encrypted,now);
      return {kind:'accepted',receipt};
    });}catch{return {kind:'unavailable',code:'storage'};}
  }
  #terminal(receipt:string,state:'completed'|'discarded',token?:string) {
    const sql="UPDATE callback_inbox SET state=?,tag=NULL,ciphertext=NULL,token=NULL,lease_until=0,next_at=0 WHERE receipt=?";
    return this.#db.prepare(sql+(token?' AND state=\'processing\' AND token=?':'')).run(...(token?[state,receipt,token]:[state,receipt])).changes;
  }
  async processNext():Promise<WorkResult> {
    if(this.#closed)return unavailable('storage');
    let row:Row|undefined,clockError=false;
    try {
      row=this.#tx(()=>{
        const now=this.#time();if(now===undefined){clockError=true;return;}
        // 만료된 lease만 회수하고 진행 중인 worker의 소유권은 유지합니다.
        this.#db.prepare("UPDATE callback_inbox SET state='discarded',tag=NULL,ciphertext=NULL,token=NULL,lease_until=0,next_at=0 WHERE (state='pending' OR (state='processing' AND lease_until<=?)) AND (attempts>=? OR received_at+?<=?)").run(now,this.#attempts,this.#age,now);
        const candidate=this.#db.prepare("SELECT * FROM callback_inbox WHERE (state='pending' AND next_at<=?) OR (state='processing' AND lease_until<=?) ORDER BY received_at,receipt LIMIT 1").get(now,now) as unknown as Row|undefined;
        if(!candidate)return;
        const token=randomBytes(24).toString('hex');
        this.#db.prepare("UPDATE callback_inbox SET state='processing',attempts=attempts+1,token=?,lease_until=? WHERE receipt=?").run(token,now+this.#lease,candidate.receipt);
        return {...candidate,attempts:candidate.attempts+1,token};
      });
    } catch{return unavailable('storage');}
    if(!row)return clockError?unavailable('clock'):{kind:'idle'};
    let result:RewardResult|undefined,corrupt=false;
    try {
      const d=createDecipheriv('aes-256-gcm',this.#key,row.iv);d.setAAD(this.#aad(row));d.setAuthTag(row.tag!);
      const raw=Buffer.concat([d.update(row.ciphertext!),d.final()]).toString('utf8');
      if(hash(raw)!==row.digest||!isAdmobCallbackStructure(raw))throw new Error();
      result=await this.#ledger.processCallback(raw);
    } catch {corrupt=true;}
    if(this.#closed)return unavailable('storage');
    try{return this.#tx(()=>{
      const now=this.#time();if(now===undefined)return unavailable('clock');
      const owner=this.#db.prepare("SELECT token,lease_until FROM callback_inbox WHERE receipt=? AND state='processing'").get(row!.receipt);
      if(owner?.token!==row!.token||typeof owner.lease_until!=='number'||owner.lease_until<=now)return {kind:'stale'};
      if(corrupt){this.#terminal(row!.receipt,'discarded',row!.token!);return {kind:'discarded'};}
      if(result?.kind==='voucher-recorded'){this.#terminal(row!.receipt,'completed',row!.token!);return {kind:'completed'};}
      const retry=result?.kind==='service-error'||(result?.kind==='rejected'&&['key-unavailable','aborted'].includes(result.code));
      const delay=Math.min(this.#maxBackoff,this.#backoff*2**(row!.attempts-1));
      if(!retry||row!.attempts>=this.#attempts||now+delay>=row!.received_at+this.#age){this.#terminal(row!.receipt,'discarded',row!.token!);return {kind:'discarded'};}
      this.#db.prepare("UPDATE callback_inbox SET state='pending',token=NULL,lease_until=0,next_at=? WHERE receipt=? AND token=?").run(now+delay,row!.receipt,row!.token!);
      return {kind:'retry'};
    });}catch{return unavailable('storage');}
  }
  close() {
    if(this.#closed)return;this.#closed=true;
    let failed=false;try{this.#ledger.close();}catch{failed=true;}try{this.#db.close();}catch{failed=true;}this.#key.fill(0);
    if(failed)throw new Error('callback-inbox-close-failed');
  }
}
