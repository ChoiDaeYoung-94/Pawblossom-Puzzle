/** 서버 전용 로컬 SQLite 회차 원장. HTTP·실제 인증·앱은 연결하지 않습니다. */
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {beginIdempotentWrite} from '../storage/transactionBegin.ts';
import {readRedeemedGrant} from '../ads/rewardLedger.ts';
import {advanceState,commandSnapshot,CONTENT_HASH,ENGINE_PROFILE,ENGINE_SOURCE_SHA256,exactRecord,freezeCopy,isLevelId,publicState,startState,validateState,
  type Command,type CommandOutcome,type PublicRoundState,type RoundState} from './roundState.ts';

export interface TrustedRoundOwner {
  /** 서버 인증 middleware의 현재 요청 context 전용입니다. HTTP body의 owner를 복사하면 안 됩니다. 타입 자체는 인증 수단이 아닙니다. */
  readonly ownerId:string;
}
export interface RoundLedgerOptions {
  readonly databasePath:string;
  /** 인증·구매·광고 원장과 별도인 안정적인 32byte 키. 파일/env/실키를 자동으로 읽지 않습니다. */
  readonly serverKey:Uint8Array;
  readonly environment:'test'|'production';
  readonly now?:()=>number;
  /** meta 제외 round+operation+reward 전체 행수. terminal과 오래된 영수증도 포함하며 자동 삭제하지 않습니다. */
  readonly maxRows?:number;
  readonly maxOperations?:number;
  readonly ttlMs?:number;
}
export interface StartRoundRequest {readonly requestId:string;readonly levelId:number;}
export interface RoundCommandRequest {readonly roundId:string;readonly operationId:string;readonly expectedRevision:number;readonly command:Command;}
export interface RoundSnapshot {
  readonly roundId:string;
  readonly revision:number;
  readonly createdAt:number;
  readonly expiresAt:number;
  readonly state:PublicRoundState;
}
type Failure={readonly kind:'rejected';readonly code:'invalid-input'|'invalid-grant'|'reward-used'|'not-found'|'request-conflict'|'revision-conflict'|'round-terminal'|'shuffle-used'|'expired'|'capacity'|'operation-limit'|'invalid-time'}
  | {readonly kind:'service-error';readonly code:'storage-unavailable'};
export type StartRoundResult={readonly kind:'round-started';readonly created:boolean;readonly snapshot:RoundSnapshot}|Failure;
export type RoundCommandResult={readonly kind:'command-result';readonly applied:boolean;readonly outcome:CommandOutcome;readonly snapshot:RoundSnapshot}|Failure;
export type GetRoundResult={readonly kind:'round-snapshot';readonly snapshot:RoundSnapshot}|Failure;
export type RewardEligibilityResult={readonly kind:'reward-eligible';readonly snapshot:RoundSnapshot}|Failure;
export type ApplyRewardResult={readonly kind:'reward-result';readonly applied:boolean;readonly snapshot:RoundSnapshot}|Failure;
interface Row {round_id:string;owner_hash:string;create_hash:string;create_digest:string;created_at:number;expires_at:number;revision:number;state_json:string;state_mac:string;}
interface Receipt {round_id:string;op_hash:string;request_digest:string;revision:number;outcome:CommandOutcome|'reward-applied';receipt_mac:string;}
interface RewardRow {round_id:string;grant_id:string;revision:number;reward_mac:string;}
const legacySchema={
  round_meta:'CREATE TABLE round_meta (id INTEGER PRIMARY KEY CHECK(id=1),profile TEXT NOT NULL,high_water INTEGER NOT NULL CHECK(high_water>=0),meta_mac TEXT NOT NULL) STRICT',
  round_rounds:`CREATE TABLE round_rounds (
    round_id TEXT PRIMARY KEY CHECK(length(round_id)=43), owner_hash TEXT NOT NULL CHECK(length(owner_hash)=64),
    create_hash TEXT NOT NULL CHECK(length(create_hash)=64), create_digest TEXT NOT NULL CHECK(length(create_digest)=64),
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>created_at), revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 128),
    state_json TEXT NOT NULL CHECK(length(state_json) BETWEEN 1 AND 32768), state_mac TEXT NOT NULL CHECK(length(state_mac)=64),
    UNIQUE(owner_hash,create_hash)
  ) STRICT`,
  round_ops:`CREATE TABLE round_ops (
    round_id TEXT NOT NULL REFERENCES round_rounds(round_id), op_hash TEXT NOT NULL CHECK(length(op_hash)=64),
    request_digest TEXT NOT NULL CHECK(length(request_digest)=64), revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 128),
    outcome TEXT NOT NULL CHECK(outcome IN('valid-swap','invalid-swap','valid-activation','invalid-activation','shuffled','abandoned')), receipt_mac TEXT NOT NULL CHECK(length(receipt_mac)=64),
    PRIMARY KEY(round_id,op_hash), UNIQUE(round_id,revision)
  ) STRICT`,
};
const schema={...legacySchema,
  round_ops:legacySchema.round_ops.replace("'shuffled','abandoned'","'shuffled','abandoned','reward-applied'"),
  round_rewards:`CREATE TABLE round_rewards (
    round_id TEXT PRIMARY KEY REFERENCES round_rounds(round_id), grant_id TEXT NOT NULL UNIQUE CHECK(length(grant_id)=64),
    revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 128), reward_mac TEXT NOT NULL CHECK(length(reward_mac)=64),
    FOREIGN KEY(round_id,revision) REFERENCES round_ops(round_id,revision)
  ) STRICT`,
};
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const identity=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\u0000-\u0020\u007f]/.test(v);
const requestId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const bounded=(v:unknown,fallback:number,min:number,max:number):number=>{const n=v===undefined?fallback:v;if(typeof n!=='number'||!Number.isSafeInteger(n)||n<min||n>max)throw new Error();return n;};
const rejected=(code:Extract<Failure,{kind:'rejected'}>['code']):Failure=>({kind:'rejected',code});
const unavailable=():Failure=>({kind:'service-error',code:'storage-unavailable'});
const sameMac=(a:unknown,b:string)=>hex(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const MAX_TIME=9_999_999_999_999;
const timeValue=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=1_000_000_000_000&&n<=MAX_TIME;
class RoundIntegrityError extends Error {}
class RoundRollbackError extends Error {}
function structural(work:()=>void):void {try{work();}catch{throw new RoundIntegrityError();}}

export class RoundLedger {
  #db!:DatabaseSync;
  #keys:Record<string,Buffer>={};
  #now!:()=>number;
  #profile='';
  #rows=1000;
  #operations=64;
  #ttl=3_600_000;
  #last=0;
  #closed=false;
  #modern=true;
  #environment:'test'|'production'='test';
  constructor(input:RoundLedgerOptions) {
    let master:Buffer|undefined,db:DatabaseSync|undefined;
    let path:string;
    try {
      // 구성도 accessor를 실행하지 않습니다. 선택 필드의 누락은 허용하지만 알 수 없는 필드는 거절합니다.
      const allowed=['databasePath','serverKey','environment','now','maxRows','maxOperations','ttlMs'];
      if(!input||typeof input!=='object')throw new Error();
      const names=Reflect.ownKeys(input);
      if(names.some(k=>typeof k!=='string'||!allowed.includes(k)))throw new Error();
      const o=exactRecord(input,names as string[]);
      path=o.databasePath as string;
      if(typeof path!=='string'||!isAbsolute(path)||!path.endsWith('.sqlite')||!(o.serverKey instanceof Uint8Array)||o.serverKey.byteLength!==32
        ||(o.environment!=='test'&&o.environment!=='production')||(o.now!==undefined&&typeof o.now!=='function'))throw new Error();
      master=Buffer.from(o.serverKey);
      for(const domain of ['owner','create','operation','state','receipt','meta','reward'])this.#keys[domain]=createHmac('sha256',master).update('pawblossom-round-v1\0'+domain).digest();
      this.#rows=bounded(o.maxRows,1000,1,10000);this.#operations=bounded(o.maxOperations,64,1,128);this.#ttl=bounded(o.ttlMs,3_600_000,1000,86_400_000);
      this.#now=(o.now as (()=>number)|undefined)??Date.now;
      this.#environment=o.environment;
      this.#profile=JSON.stringify({version:2,environment:o.environment,engine:ENGINE_PROFILE,source:ENGINE_SOURCE_SHA256,content:CONTENT_HASH,
        rows:this.#rows,operations:this.#operations,ttl:this.#ttl,keyCheck:this.#mac('meta','key-check')});
    }catch{this.#wipe();throw new Error('invalid-round-config');}
    finally{master?.fill(0);}
    try {
      db=new DatabaseSync(path,{timeout:500,enableForeignKeyConstraints:true,allowExtension:false});this.#db=db;
      const journal=db.prepare('PRAGMA journal_mode').get()?.journal_mode;
      if(journal!=='delete'&&journal!=='wal')throw new Error();
      db.exec('PRAGMA synchronous=FULL');
      this.#transaction(()=>{
        const entries=db!.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
        const modernProfile=this.#profile,oldProfile=modernProfile.replace('"version":2','"version":1');
        if(entries.length&&db!.prepare('SELECT profile FROM round_meta WHERE id=1').get()?.profile===oldProfile){
          // 구 profile로 먼저 전체 서명을 검증합니다. owner/create/operation 키 파생은 유지합니다.
          this.#modern=false;this.#profile=oldProfile;this.#schema();const high=this.#metadata();this.#capacity(0);
          (db!.prepare('SELECT * FROM round_rounds').all() as unknown as Row[]).forEach(r=>this.#readRow(r));
          if(db!.prepare('PRAGMA foreign_key_check').all().length)throw new Error();
          db!.exec('ALTER TABLE round_ops RENAME TO round_ops_v1');db!.exec(schema.round_ops);
          db!.exec('INSERT INTO round_ops SELECT * FROM round_ops_v1');db!.exec('DROP TABLE round_ops_v1');db!.exec(schema.round_rewards);
          this.#profile=modernProfile;this.#modern=true;
          for(const r of db!.prepare('SELECT * FROM round_rounds').all() as unknown as Row[])db!.prepare('UPDATE round_rounds SET state_mac=? WHERE round_id=?').run(this.#rowMac(r),r.round_id);
          for(const r of db!.prepare('SELECT * FROM round_ops').all() as unknown as Receipt[])db!.prepare('UPDATE round_ops SET receipt_mac=? WHERE round_id=? AND op_hash=?').run(this.#receiptMac(r),r.round_id,r.op_hash);
          db!.prepare('UPDATE round_meta SET profile=?,meta_mac=? WHERE id=1').run(this.#profile,this.#metaMac(high));
        }
        for(const [name,sql] of Object.entries(schema)){
          db!.exec(sql.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '));
          if(normalize(String(db!.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql))!==normalize(sql))throw new Error();
        }
        if(!entries.length)db!.prepare('INSERT INTO round_meta VALUES(1,?,0,?)').run(this.#profile,this.#metaMac(0));
        this.#schema();
        this.#metadata();
        this.#capacity(0);
        const rows=db!.prepare('SELECT * FROM round_rounds').all() as unknown as Row[];
        rows.forEach(r=>this.#readRow(r));
        // 외부 연결이 FK를 끄고 삽입한 고아 영수증도 거절합니다.
        if(db!.prepare('PRAGMA foreign_key_check').all().length)throw new Error();
      });
    }catch{try{db?.close();}catch{}this.#wipe();this.#closed=true;throw new Error('round-ledger-open-failed');}
  }
  #mac(domain:string,value:string):string{return createHmac('sha256',this.#keys[domain]).update(value).digest('hex');}
  #wipe(){Object.values(this.#keys).forEach(key=>key.fill(0));this.#keys={};}
  #transaction<T>(work:()=>T,retryIdempotentBegin=false):T {
    if(retryIdempotentBegin)beginIdempotentWrite(this.#db);else this.#db.exec('BEGIN IMMEDIATE');
    try{const r=work();this.#db.exec('COMMIT');return r;}
    catch(error){try{this.#db.exec('ROLLBACK');}catch{throw new RoundRollbackError();}throw error;}
  }
  #run<T extends StartRoundResult|RoundCommandResult|GetRoundResult|RewardEligibilityResult|ApplyRewardResult>(work:()=>T,retryIdempotentBegin=false):T|Failure {
    if(this.#closed)return unavailable();
    try{return this.#transaction(()=>{this.#schema();this.#capacity(0);return work();},retryIdempotentBegin);}
    catch(error){if(error instanceof RoundIntegrityError||error instanceof RoundRollbackError){try{this.close();}catch{}}return unavailable();}
  }
  #schema():void {
    const entries=this.#db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const expected:Record<string,string>=this.#modern?schema:legacySchema;
    if(entries.map(r=>r.name).join()!==Object.keys(expected).sort().join())throw new RoundIntegrityError();
    for(const entry of entries){const sql=expected[String(entry.name)];if(entry.type!=='table'||!sql||normalize(String(entry.sql))!==normalize(sql))throw new RoundIntegrityError();}
  }
  #metaMac(high:number){return this.#mac('meta',JSON.stringify([this.#profile,high]));}
  #metadata():number {
    const rows=this.#db.prepare('SELECT * FROM round_meta').all();
    if(rows.length!==1)throw new RoundIntegrityError();
    const m=rows[0];
    if(m.id!==1||m.profile!==this.#profile||typeof m.high_water!=='number'||!Number.isSafeInteger(m.high_water)||m.high_water<0
      ||(m.high_water!==0&&!timeValue(m.high_water))||!sameMac(m.meta_mac,this.#metaMac(m.high_water)))throw new RoundIntegrityError();
    return m.high_water;
  }
  #time():number|undefined {
    const persisted=this.#metadata(),now=this.#now();
    if(!timeValue(now)||now>MAX_TIME-this.#ttl||now<persisted||now<this.#last)return;
    this.#last=now;this.#db.prepare('UPDATE round_meta SET high_water=?,meta_mac=? WHERE id=1').run(now,this.#metaMac(now));return now;
  }
  #owner(input:unknown):string {
    const c=exactRecord(input,['ownerId']);if(!identity(c.ownerId))throw new Error();return this.#mac('owner',c.ownerId);
  }
  #capacity(reserve:number):boolean {
    const n=this.#db.prepare('SELECT (SELECT count(*) FROM round_rounds)+(SELECT count(*) FROM round_ops)'+(this.#modern?'+(SELECT count(*) FROM round_rewards)':'')+' AS n').get()?.n;
    if(typeof n!=='number'||!Number.isSafeInteger(n)||n>this.#rows)throw new RoundIntegrityError();return n+reserve<=this.#rows;
  }
  #rowMac(r:Omit<Row,'state_mac'>):string {
    return this.#mac('state',JSON.stringify([this.#profile,r.round_id,r.owner_hash,r.create_hash,r.create_digest,r.created_at,r.expires_at,r.revision,r.state_json]));
  }
  #receiptMac(r:Omit<Receipt,'receipt_mac'>):string {
    return this.#mac('receipt',JSON.stringify([this.#profile,r.round_id,r.op_hash,r.request_digest,r.revision,r.outcome]));
  }
  #rewardMac(r:Omit<RewardRow,'reward_mac'>){return this.#mac('reward',JSON.stringify([this.#profile,r.round_id,r.grant_id,r.revision]));}
  #readRow(r:Row):RoundState {
    structural(()=>{exactRecord(r,['round_id','owner_hash','create_hash','create_digest','created_at','expires_at','revision','state_json','state_mac']);});
    if(!opaque(r.round_id)||![r.owner_hash,r.create_hash,r.create_digest].every(hex)||!timeValue(r.created_at)||!timeValue(r.expires_at)
      ||r.expires_at-r.created_at!==this.#ttl||!Number.isSafeInteger(r.revision)||r.revision<0||r.revision>this.#operations
      ||typeof r.state_json!=='string'||Buffer.byteLength(r.state_json)>32768||!sameMac(r.state_mac,this.#rowMac(r)))throw new RoundIntegrityError();
    let state!:RoundState;
    structural(()=>{const parsed:unknown=JSON.parse(r.state_json);if(JSON.stringify(parsed)!==r.state_json)throw new Error();validateState(parsed);state=parsed;});
    if(r.create_digest!==hash(JSON.stringify({levelId:state.level.id})))throw new RoundIntegrityError();
    const receipts=this.#db.prepare('SELECT * FROM round_ops WHERE round_id=? ORDER BY revision').all(r.round_id) as unknown as Receipt[];
    if(receipts.length!==r.revision)throw new RoundIntegrityError();
    receipts.forEach((op,i)=>{
      structural(()=>{exactRecord(op,['round_id','op_hash','request_digest','revision','outcome','receipt_mac']);});
      if(op.round_id!==r.round_id||!hex(op.op_hash)||!hex(op.request_digest)||op.revision!==i+1
        ||!['valid-swap','invalid-swap','valid-activation','invalid-activation','shuffled','abandoned',...(this.#modern?['reward-applied']:[])].includes(op.outcome)||!sameMac(op.receipt_mac,this.#receiptMac(op)))throw new RoundIntegrityError();
    });
    const rewards=this.#modern?this.#db.prepare('SELECT * FROM round_rewards WHERE round_id=?').all(r.round_id) as unknown as RewardRow[]:[];
    const rewardOps=receipts.filter(op=>op.outcome==='reward-applied');
    if(rewards.length>1||rewards.length!==rewardOps.length)throw new RoundIntegrityError();
    for(const reward of rewards){
      structural(()=>{exactRecord(reward,['round_id','grant_id','revision','reward_mac']);});
      const op=rewardOps[0];
      if(reward.round_id!==r.round_id||!hex(reward.grant_id)||reward.revision!==op.revision||!sameMac(reward.reward_mac,this.#rewardMac(reward))
        ||op.op_hash!==this.#mac('operation',JSON.stringify(['reward',r.round_id,reward.grant_id]))||op.request_digest!==hash(JSON.stringify(['reward',r.round_id,reward.grant_id]))
        ||receipts.filter(v=>v.revision<reward.revision&&(v.outcome==='valid-swap'||v.outcome==='valid-activation')).length!==state.level.moves)throw new RoundIntegrityError();
    }
    const valid=receipts.filter(op=>op.outcome==='valid-swap'||op.outcome==='valid-activation').length,shuffled=receipts.filter(op=>op.outcome==='shuffled').length;
    if(state.moves!==state.level.moves+5*rewards.length-valid||state.shuffles!==1-shuffled||receipts.filter(op=>op.outcome==='abandoned').length!==(state.status==='abandoned'?1:0)
      ||(state.status==='abandoned'&&receipts.at(-1)?.outcome!=='abandoned'))throw new RoundIntegrityError();
    return state;
  }
  #rewardCheck(row:Row,state:RoundState):Failure|undefined {
    if(this.#db.prepare('SELECT 1 FROM round_rewards WHERE round_id=?').get(row.round_id))return rejected('reward-used');
    if(state.status!=='failed'||state.moves!==0)return rejected('round-terminal');
    if(row.revision>=this.#operations)return rejected('operation-limit');
    if(!this.#capacity(2))return rejected('capacity');
  }
  #rewardInput(context:TrustedRoundOwner,request:{readonly roundId:string}){
    const c=exactRecord(context,['ownerId']),owner=this.#owner(c as unknown as TrustedRoundOwner),r=exactRecord(request,['roundId']);
    if(!opaque(r.roundId))throw new Error();return {owner,ownerId:c.ownerId as string,id:r.roundId};
  }
  rewardEligibility(context:TrustedRoundOwner,request:{readonly roundId:string}):RewardEligibilityResult {
    if(this.#closed)return unavailable();let input:{owner:string;ownerId:string;id:string};
    try{input=this.#rewardInput(context,request);}catch{return rejected('invalid-input');}
    return this.#run(()=>{
      const now=this.#time();if(now===undefined)return rejected('invalid-time');
      const row=this.#db.prepare('SELECT * FROM round_rounds WHERE round_id=? AND owner_hash=?').get(input.id,input.owner) as unknown as Row|undefined;
      if(!row)return rejected('not-found');const state=this.#readRow(row);
      if(row.owner_hash!==input.owner)return rejected('not-found');if(now>=row.expires_at)return rejected('expired');
      return this.#rewardCheck(row,state)??{kind:'reward-eligible',snapshot:this.#snapshot(row,state)};
    }) as RewardEligibilityResult;
  }
  applyReward(context:TrustedRoundOwner,request:{readonly roundId:string},capability:unknown):ApplyRewardResult {
    if(this.#closed)return unavailable();let input:{owner:string;ownerId:string;id:string},grant:ReturnType<typeof readRedeemedGrant>;
    try{input=this.#rewardInput(context,request);grant=readRedeemedGrant(capability,{ownerId:input.ownerId,roundId:input.id},this.#environment);if(!grant)return rejected('invalid-grant');}catch{return rejected('invalid-input');}
    const grantId=grant.opaqueGrantId;
    return this.#run(()=>{
      const now=this.#time();if(now===undefined)return rejected('invalid-time');
      const row=this.#db.prepare('SELECT * FROM round_rounds WHERE round_id=? AND owner_hash=?').get(input.id,input.owner) as unknown as Row|undefined;
      if(!row)return rejected('not-found');const state=this.#readRow(row);
      if(row.owner_hash!==input.owner)return rejected('not-found');if(now>=row.expires_at)return rejected('expired');
      const prior=this.#db.prepare('SELECT grant_id FROM round_rewards WHERE round_id=?').get(input.id);
      if(prior)return prior.grant_id===grantId?{kind:'reward-result',applied:false,snapshot:this.#snapshot(row,state)}:rejected('reward-used');
      const failure=this.#rewardCheck(row,state);if(failure)return failure;
      state.moves=5;state.status='active';validateState(state);row.revision++;row.state_json=JSON.stringify(state);row.state_mac=this.#rowMac(row);
      const op:Receipt={round_id:input.id,op_hash:this.#mac('operation',JSON.stringify(['reward',input.id,grantId])),request_digest:hash(JSON.stringify(['reward',input.id,grantId])),revision:row.revision,outcome:'reward-applied',receipt_mac:''};op.receipt_mac=this.#receiptMac(op);
      const reward:RewardRow={round_id:input.id,grant_id:grantId,revision:row.revision,reward_mac:''};reward.reward_mac=this.#rewardMac(reward);
      this.#db.prepare('UPDATE round_rounds SET revision=?,state_json=?,state_mac=? WHERE round_id=?').run(row.revision,row.state_json,row.state_mac,input.id);
      this.#db.prepare('INSERT INTO round_ops VALUES(?,?,?,?,?,?)').run(input.id,op.op_hash,op.request_digest,op.revision,op.outcome,op.receipt_mac);
      this.#db.prepare('INSERT INTO round_rewards VALUES(?,?,?,?)').run(input.id,grantId,reward.revision,reward.reward_mac);
      return {kind:'reward-result',applied:true,snapshot:this.#snapshot(row,state)};
    }) as ApplyRewardResult;
  }
  #snapshot(r:Row,state:RoundState):RoundSnapshot {
    return freezeCopy({roundId:r.round_id,revision:r.revision,createdAt:r.created_at,expiresAt:r.expires_at,state:publicState(state)});
  }
  start(context:TrustedRoundOwner,request:StartRoundRequest):StartRoundResult {
    if(this.#closed)return unavailable();
    let owner:string,id:string,level:number;
    try{owner=this.#owner(context);const r=exactRecord(request,['requestId','levelId']);if(!requestId(r.requestId)||!isLevelId(r.levelId))throw new Error();id=r.requestId;level=r.levelId;}
    catch{return rejected('invalid-input');}
    return this.#run(()=>{
      const now=this.#time();if(now===undefined)return rejected('invalid-time');
      const createHash=this.#mac('create',JSON.stringify([owner,id])),digest=hash(JSON.stringify({levelId:level}));
      const old=this.#db.prepare('SELECT * FROM round_rounds WHERE owner_hash=? AND create_hash=?').get(owner,createHash) as unknown as Row|undefined;
      if(old){const state=this.#readRow(old);if(old.create_digest!==digest)return rejected('request-conflict');if(now>=old.expires_at)return rejected('expired');return {kind:'round-started',created:false,snapshot:this.#snapshot(old,state)};}
      if(!this.#capacity(1))return rejected('capacity');
      const state=startState(level,randomBytes(4).readUInt32LE()),row:Row={round_id:randomBytes(32).toString('base64url'),owner_hash:owner,create_hash:createHash,
        create_digest:digest,created_at:now,expires_at:now+this.#ttl,revision:0,state_json:JSON.stringify(state),state_mac:''};
      row.state_mac=this.#rowMac(row);
      this.#db.prepare('INSERT INTO round_rounds VALUES(?,?,?,?,?,?,?,?,?)').run(row.round_id,owner,createHash,digest,now,row.expires_at,0,row.state_json,row.state_mac);
      return {kind:'round-started',created:true,snapshot:this.#snapshot(row,state)};
    },true) as StartRoundResult;
  }
  get(context:TrustedRoundOwner,request:{readonly roundId:string}):GetRoundResult {
    if(this.#closed)return unavailable();
    let owner:string,id:string;
    try{owner=this.#owner(context);const r=exactRecord(request,['roundId']);if(!opaque(r.roundId))throw new Error();id=r.roundId;}catch{return rejected('invalid-input');}
    return this.#run(()=>{
      const now=this.#time();if(now===undefined)return rejected('invalid-time');
      const row=this.#db.prepare('SELECT * FROM round_rounds WHERE round_id=? AND owner_hash=?').get(id,owner) as unknown as Row|undefined;
      if(!row)return rejected('not-found');
      const state=this.#readRow(row);if(row.owner_hash!==owner)return rejected('not-found');if(now>=row.expires_at)return rejected('expired');
      return {kind:'round-snapshot',snapshot:this.#snapshot(row,state)};
    }) as GetRoundResult;
  }
  command(context:TrustedRoundOwner,request:RoundCommandRequest):RoundCommandResult {
    if(this.#closed)return unavailable();
    let owner:string,id:string,opId:string,revision:number,command:Command;
    try{
      owner=this.#owner(context);const r=exactRecord(request,['roundId','operationId','expectedRevision','command']);
      if(!opaque(r.roundId)||!requestId(r.operationId)||typeof r.expectedRevision!=='number'||!Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<0||r.expectedRevision>this.#operations)throw new Error();
      id=r.roundId;opId=r.operationId;revision=r.expectedRevision;command=commandSnapshot(r.command);
    }catch{return rejected('invalid-input');}
    return this.#run(()=>{
      const now=this.#time();if(now===undefined)return rejected('invalid-time');
      const row=this.#db.prepare('SELECT * FROM round_rounds WHERE round_id=? AND owner_hash=?').get(id,owner) as unknown as Row|undefined;
      if(!row)return rejected('not-found');
      const state=this.#readRow(row);if(row.owner_hash!==owner)return rejected('not-found');if(now>=row.expires_at)return rejected('expired');
      const opHash=this.#mac('operation',JSON.stringify([id,opId])),digest=hash(JSON.stringify([id,opId,revision,command]));
      // 오래된 revision·종료·한도보다 먼저 서명한 중복 영수증을 확인하고 현재 상태를 반환합니다.
      const receipt=this.#db.prepare('SELECT * FROM round_ops WHERE round_id=? AND op_hash=?').get(id,opHash) as unknown as Receipt|undefined;
      if(receipt){if(receipt.outcome==='reward-applied'||receipt.request_digest!==digest)return rejected('request-conflict');return {kind:'command-result',applied:false,outcome:receipt.outcome,snapshot:this.#snapshot(row,state)};}
      if(row.revision!==revision)return rejected('revision-conflict');
      if(state.status!=='active'&&!(state.status==='failed'&&command.type==='abandon'))return rejected('round-terminal');
      if(row.revision>=this.#operations)return rejected('operation-limit');
      if(command.type==='shuffle'&&!state.shuffles)return rejected('shuffle-used');
      if(!this.#capacity(1))return rejected('capacity');
      const next=advanceState(state,command);row.revision++;row.state_json=JSON.stringify(next.state);row.state_mac=this.#rowMac(row);
      const op:Receipt={round_id:id,op_hash:opHash,request_digest:digest,revision:row.revision,outcome:next.outcome,receipt_mac:''};op.receipt_mac=this.#receiptMac(op);
      this.#db.prepare('UPDATE round_rounds SET revision=?,state_json=?,state_mac=? WHERE round_id=?').run(row.revision,row.state_json,row.state_mac,id);
      this.#db.prepare('INSERT INTO round_ops VALUES(?,?,?,?,?,?)').run(id,opHash,digest,row.revision,next.outcome,op.receipt_mac);
      return {kind:'command-result',applied:true,outcome:next.outcome,snapshot:this.#snapshot(row,next.state)};
    },true) as RoundCommandResult;
  }
  close():void {
    if(this.#closed)return;
    this.#closed=true;
    try{this.#db.close();}catch{throw new Error('round-ledger-close-failed');}finally{this.#wipe();}
  }
}
