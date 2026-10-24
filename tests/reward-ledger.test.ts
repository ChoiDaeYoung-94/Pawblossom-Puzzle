import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {fork} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {RewardLedger,type RewardLedgerOptions,type TrustedRewardRound} from '../server/ads/rewardLedger';
import {policy,epoch,keyEntry,keyResponse,callback,malleate} from './helpers/ssvFixture';
import {createCallbackOutcomeTrace,receiveCallbackOutcome,callbackOutcomeContext,type CallbackOutcomeTrace} from './helpers/callbackOutcomeDiagnostics';
const key=new Uint8Array(32).fill(71),owner={ownerId:'synthetic-owner-private',roundId:'synthetic-round-private'};
const folders:string[]=[],ledgers:RewardLedger[]=[],connections:DatabaseSync[]=[],workers:Worker[]=[];
const workerUrl=new URL('./helpers/reward-ledger-worker.mjs',import.meta.url);
const denied=(code:string)=>({kind:'rejected',code}), unavailable={kind:'service-error',code:'storage-unavailable'};
function dbPath(){const dir=mkdtempSync(join(tmpdir(),'pawblossom-reward-'));folders.push(dir);return join(dir,'reward.sqlite');}
function open(path=dbPath(),patch:Partial<RewardLedgerOptions>={}) {
  let now=epoch;
  const transport=vi.fn<typeof fetch>(async()=>keyResponse());
  const options:RewardLedgerOptions={databasePath:path,serverKey:key,policy,dependencies:{transport,now:()=>now},...patch};
  const ledger=new RewardLedger(options);ledgers.push(ledger);
  return {ledger,path,options,transport,setNow:(t:number)=>now=t};
}
function db(path:string){const d=new DatabaseSync(path);connections.push(d);return d;}
function close(l:RewardLedger){l.close();ledgers.splice(ledgers.indexOf(l),1);}
function claim(l:RewardLedger,c:TrustedRewardRound=owner,unit=policy.adUnits[0]){const r=l.issueClaim(c,unit);if(r.kind!=='claim-issued')throw new Error('fixture-claim-failed');return r;}
function query(c:ReturnType<typeof claim>,patch:Record<string,string>={}){return callback({custom_data:c.customData,user_id:c.userId,...patch});}
function input(path:string,query:string,extra={}){return {path,query,key:[...key],policy,entries:[keyEntry()],now:epoch,context:owner,...extra};}
async function child(data:ReturnType<typeof input>){
  const p=fork(workerUrl,[],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','ignore','ipc']});
  const done=new Promise<void>(resolve=>p.once('exit',()=>resolve()));
  const output=new Promise<any>((resolve,reject)=>{p.once('message',resolve);p.once('error',reject);p.once('exit',code=>{if(code)reject(new Error('child-failed'));});});
  try{p.send(data);const result=await output;await done;return result;}finally{if(p.exitCode===null){p.kill();await done;}}
}
async function concurrent(data:ReturnType<typeof input>[],trace?:CallbackOutcomeTrace){
  const batch=data.map(value=>new Worker(workerUrl,{workerData:value,execArgv:['--experimental-strip-types']}));workers.push(...batch);
  const outputs:Promise<any>[]=[];
  const ready=batch.map((worker,index)=>new Promise<void>((resolve,reject)=>{
    let receive!:(v:any)=>void;
    outputs.push(new Promise(r=>receive=r));
    worker.on('message',v=>v==='ready'?resolve():receive(trace?receiveCallbackOutcome(v,trace,index):v));worker.on('error',reject);
  }));
  await Promise.all(ready);batch.forEach(w=>w.postMessage('go'));return Promise.all(outputs);
}
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(workers.splice(0).map(w=>w.terminate()));connections.splice(0).forEach(d=>d.close());ledgers.splice(0).forEach(l=>l.close());folders.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
describe('서버 claim binding·보상권 (게임 지급 아님)',()=>{
  it('발급은 opaque 값만 caller 반환·유효서명 보상권·중복 0회',async()=>{
    const {ledger,path}=open(),c=claim(ledger);expect(c.customData).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(c.userId).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(c.expiresAt).toBe(epoch+900000);
    const raw=query(c);expect(await ledger.processCallback(raw)).toEqual({kind:'voucher-recorded',newGrant:true});expect(await ledger.processCallback(raw)).toEqual({kind:'voucher-recorded',newGrant:false});
    expect(ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:true});expect(db(path).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('서명 있는 미발급 nonce/user도 owner 임의 지정 불가',async()=>{const {ledger}=open();expect(await ledger.processCallback(callback())).toEqual(denied('invalid-claim'));expect(ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:false});});
  it.each(['other-owner','other-round'])('%s와 다른 binding 보상권은 독립',async mode=>{
    const {ledger}=open(),c=claim(ledger),other=mode==='other-owner'?{...owner,ownerId:'another-owner'}:{...owner,roundId:'another-round'};
    const d=claim(ledger,other);expect(await ledger.processCallback(query(c,{user_id:d.userId}))).toEqual(denied('invalid-claim'));
    expect(await ledger.processCallback(query(c))).toEqual({kind:'voucher-recorded',newGrant:true});expect(ledger.hasVoucher(other)).toEqual({kind:'voucher-status',present:false});
    expect(await ledger.processCallback(query(d,{transaction_id:'dead'.repeat(8)}))).toEqual({kind:'voucher-recorded',newGrant:true});
  });
  it('다른 allowlisted adunit에도 claim은 결합됨',async()=>{const {ledger}=open(),c=claim(ledger);expect(await ledger.processCallback(query(c,{ad_unit:policy.adUnits[1]}))).toEqual(denied('invalid-claim'));});
  it.each([{reward_amount:'6'},{reward_item:'coins'},{ad_network:'123'},{ad_unit:'999'}] as Record<string,string>[])('다른 정책 %j 미기록',async patch=>{const {ledger,path}=open(),c=claim(ledger);expect((await ledger.processCallback(query(c,patch))).kind).toBe('rejected');expect(db(path).prepare('SELECT state FROM reward_claims').get()?.state).toBe('pending');});
  it('세 시도까지 허용하되 같은 round 다른 transaction은 보상권1회',async()=>{
    const {ledger,path}=open(),a=claim(ledger),b=claim(ledger),c=claim(ledger);
    expect(new Set([a.customData,b.customData,c.customData]).size).toBe(3);expect(ledger.issueClaim(owner,policy.adUnits[0])).toEqual(denied('round-limit'));
    expect(await ledger.processCallback(query(b))).toEqual({kind:'voucher-recorded',newGrant:true});expect(await ledger.processCallback(query(a,{transaction_id:'dead'.repeat(8)}))).toEqual(denied('round-closed'));
    expect(ledger.issueClaim(owner,policy.adUnits[0])).toEqual(denied('round-closed'));expect(db(path).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('실제 transaction ID 전역 중복 방지·다른 round claim은 미소비',async()=>{
    const {ledger,path}=open(),a=claim(ledger),b=claim(ledger,{...owner,roundId:'other-round'});
    await ledger.processCallback(query(a));expect(await ledger.processCallback(query(b))).toEqual(denied('duplicate-transaction'));
    expect(db(path).prepare("SELECT count(*) AS n FROM reward_claims WHERE state='pending'").get()?.n).toBe(1);
  });
  it('ECDSA malleability·padding·다시 sign해도 transaction 중복 우회 불가',async()=>{
    const {ledger,path}=open(),c=claim(ledger),raw=query(c);await ledger.processCallback(raw);
    expect(await ledger.processCallback(malleate(raw))).toEqual({kind:'voucher-recorded',newGrant:false});expect(await ledger.processCallback(query(c))).toEqual({kind:'voucher-recorded',newGrant:false});expect(db(path).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('verified fact 객체를 받지 않음',async()=>{const {ledger,transport}=open();expect(await ledger.processCallback({verified:true,fields:{}})).toEqual(denied('invalid-callback'));expect(transport).not.toHaveBeenCalled();});
  it('caller/구성 async 변조는 처리 binding에 영향 없음',async()=>{
    let resolve!:(r:Response)=>void;const p={...policy,adUnits:[...policy.adUnits]},deps={transport:(()=>new Promise<Response>(r=>resolve=r)) as typeof fetch,now:()=>epoch},secret=new Uint8Array(key),{ledger}=open(undefined,{policy:p,dependencies:deps,serverKey:secret});
    const c=claim(ledger),pending=ledger.processCallback(query(c));p.adUnits[0]='999';secret.fill(0);deps.transport=async()=>{throw new Error('secret')};resolve(keyResponse());expect(await pending).toEqual({kind:'voucher-recorded',newGrant:true});
  });
  it.each([{ownerId:'',roundId:'x'},{ownerId:'x',roundId:''},{ownerId:'x\r\n',roundId:'x'},{ownerId:'x'.repeat(257),roundId:'x'},null])('context 경계 %j',c=>{const {ledger}=open();expect(ledger.issueClaim(c as any,policy.adUnits[0])).toEqual(denied('invalid-input'));expect(ledger.closeRound(c as any)).toEqual(denied('invalid-input'));expect(ledger.hasVoucher(c as any)).toEqual(denied('invalid-input'));});
});
describe('회차 취소·시간 정책·재시작',()=>{
  it('영구 close가 기존3claim과 후속 발급 차단·재시작 보존',async()=>{
    const {ledger,path}=open(),claims=[claim(ledger),claim(ledger),claim(ledger)];expect(ledger.closeRound(owner)).toEqual({kind:'round-closed'});
    for(const c of claims)expect(await ledger.processCallback(query(c))).toEqual(denied('round-closed'));close(ledger);
    const reopened=open(path).ledger;expect(reopened.issueClaim(owner,policy.adUnits[0])).toEqual(denied('round-closed'));expect(await reopened.processCallback(query(claims[0]))).toEqual(denied('round-closed'));
  });
  it('미발급 round도 영구 close·다른 round/owner 영향 없음',()=>{const {ledger}=open();ledger.closeRound(owner);expect(ledger.issueClaim(owner,policy.adUnits[0])).toEqual(denied('round-closed'));expect(ledger.issueClaim({...owner,ownerId:'other'},policy.adUnits[0]).kind).toBe('claim-issued');});
  it.each([
    ['발급이전31초',-30001,0,'invalid-time'],['발급이전30초',-30000,0,'ok'],['미래31초',30001,0,'invalid-time'],['미래30초',30000,0,'ok'],
    ['eventTTL경계',900000,900000,'ok'],['eventTTL초과',900001,900001,'invalid-time'],['arrival경계',900000,1200000,'ok'],['arrival초과',900000,1200001,'expired'],['eventage초과',0,1200001,'invalid-time'],['늦은SSV허용',600000,1100000,'ok'],
  ])('%s',async(_name,eventDelta,arrivalDelta,expected)=>{const {ledger,setNow}=open(),c=claim(ledger);setNow(epoch+Number(arrivalDelta));const result=await ledger.processCallback(query(c,{timestamp:String(epoch+Number(eventDelta))}));expect(result).toEqual(expected==='ok'?{kind:'voucher-recorded',newGrant:true}:denied(String(expected)));});
  it('파일 restart 후 stale callback 거절',async()=>{const {ledger,path}=open(),c=claim(ledger);close(ledger);const next=open(path,{dependencies:{now:()=>epoch+1200001,transport:async()=>keyResponse()}}).ledger;expect((await next.processCallback(query(c))).kind).toBe('rejected');expect(next.hasVoucher(owner)).toEqual({kind:'voucher-status',present:false});});
  it('별도 프로세스 최초처리·재시작 중복 영구 유지',async()=>{const {ledger,path}=open(),c=claim(ledger),raw=query(c);close(ledger);expect(await child(input(path,raw))).toEqual({kind:'voucher-recorded',newGrant:true});expect(await child(input(path,raw))).toEqual({kind:'voucher-recorded',newGrant:false});});
  it('시계 high-water는 파일 재시작 뒤도 유지',()=>{const {ledger,path,setNow}=open();claim(ledger);setNow(epoch+1000);ledger.closeRound({...owner,roundId:'other'});close(ledger);const next=open(path).ledger;expect(next.issueClaim({...owner,roundId:'next'},policy.adUnits[0])).toEqual(denied('invalid-time'));});
  it('같은 인스턴스 clock 역행 발급/close 차단',()=>{const {ledger,setNow}=open();claim(ledger);setNow(epoch-1);expect(ledger.issueClaim({...owner,roundId:'other'},policy.adUnits[0])).toEqual(denied('invalid-time'));expect(ledger.closeRound(owner)).toEqual(denied('invalid-time'));});
});
describe('원자 저장·동시 worker·오류 비노출',()=>{
  it('동시 8 worker 동일 callback 신규 보상권 정확히1회',async({task})=>{
    const trace=task.meta.callbackOutcomeDiagnostic=createCallbackOutcomeTrace(8);
    const {ledger,path}=open(),c=claim(ledger),raw=query(c);close(ledger);const results=await concurrent(Array.from({length:8},()=>input(path,raw,{diagnostics:true})),trace);
    expect(results.filter(r=>r.kind==='voucher-recorded'&&r.newGrant).length,callbackOutcomeContext(trace)).toBe(1);expect(results.filter(r=>r.kind==='voucher-recorded'&&!r.newGrant).length,callbackOutcomeContext(trace)).toBe(7);expect(db(path).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n,callbackOutcomeContext(trace)).toBe(1);
  });
  it('동시 다른claim/transaction 같은round 신규1회',async({task})=>{
    const trace=task.meta.callbackOutcomeDiagnostic=createCallbackOutcomeTrace(3);
    const {ledger,path}=open(),a=claim(ledger),b=claim(ledger),c=claim(ledger);close(ledger);const results=await concurrent([a,b,c].map((c,i)=>input(path,query(c,{transaction_id:String(i+1).repeat(32)}),{diagnostics:true})),trace);
    expect(results.filter(r=>r.kind==='voucher-recorded'&&r.newGrant).length,callbackOutcomeContext(trace)).toBe(1);expect(results.filter(r=>r.kind==='rejected'&&r.code==='round-closed').length,callbackOutcomeContext(trace)).toBe(2);
  });
  it('cancel/callback 경합 순서와 무관하게 후속 지급/발급 차단',async()=>{
    const {ledger,path}=open(),c=claim(ledger),raw=query(c);close(ledger);const results=await concurrent([input(path,raw),input(path,raw,{action:'close'})]);
    expect(results[1]).toEqual({kind:'round-closed'});expect(['rejected','voucher-recorded']).toContain(results[0].kind);
    const next=open(path).ledger;expect(next.issueClaim(owner,policy.adUnits[0])).toEqual(denied('round-closed'));expect(await next.processCallback(raw)).toEqual(denied('round-closed'));expect(Number(db(path).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n)).toBeLessThanOrEqual(1);
  });
  it('voucher INSERT 실패는 claim state까지 rollback·재시도 가능',async()=>{
    const {ledger,path}=open(),c=claim(ledger),d=db(path);d.exec("CREATE TRIGGER fail_voucher BEFORE INSERT ON reward_vouchers BEGIN SELECT RAISE(ABORT,'secret-storage'); END");
    expect(await ledger.processCallback(query(c))).toEqual(unavailable);expect(d.prepare('SELECT state,tx_hash FROM reward_claims').get()).toEqual({state:'pending',tx_hash:null});expect(d.prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(0);
    d.exec('DROP TRIGGER fail_voucher');expect(await ledger.processCallback(query(c))).toEqual({kind:'voucher-recorded',newGrant:true});
  });
  it('스토리지 lock은 성공/미보상 상태로 숨기지 않음',async()=>{
    const {ledger,path}=open(),c=claim(ledger),d=db(path);d.exec('BEGIN IMMEDIATE');expect(await ledger.processCallback(query(c))).toEqual(unavailable);expect(ledger.issueClaim({...owner,roundId:'other'},policy.adUnits[0])).toEqual(unavailable);expect(ledger.closeRound(owner)).toEqual(unavailable);d.exec('ROLLBACK');expect(await ledger.processCallback(query(c))).toEqual({kind:'voucher-recorded',newGrant:true});
  });
  it('closed/async close 이후 fetch·저장 차단·조회오류 구분',async()=>{
    let resolve!:(r:Response)=>void;const {ledger,transport}=open(undefined,{dependencies:{now:()=>epoch,transport:()=>new Promise(r=>resolve=r)}}),c=claim(ledger),pending=ledger.processCallback(query(c));close(ledger);resolve(keyResponse());expect(await pending).toEqual(unavailable);
    expect(await ledger.processCallback(query(c))).toEqual(unavailable);expect(ledger.issueClaim(owner,policy.adUnits[0])).toEqual(unavailable);expect(ledger.closeRound(owner)).toEqual(unavailable);expect(ledger.hasVoucher(owner)).toEqual(unavailable);expect(transport).not.toHaveBeenCalled();
  });
  it('SQL 읽기 오류는 absent로 숨기지 않음',()=>{const {ledger,path}=open();db(path).exec('DROP TABLE reward_vouchers');expect(ledger.hasVoucher(owner)).toEqual(unavailable);});
  it.each(['environment','key','adunit','missing-profile','purchase-db','schema'])('다른 %s DB reopen 차단',mode=>{
    const {ledger,path}=open();claim(ledger);close(ledger);
    let patch:Partial<RewardLedgerOptions>={};
    if(mode==='environment')patch={policy:{...policy,environment:'production'}};
    if(mode==='key')patch={serverKey:new Uint8Array(32).fill(72)};
    if(mode==='adunit')patch={policy:{...policy,adUnits:['9']}};
    if(mode==='missing-profile')db(path).exec('DELETE FROM reward_meta');
    if(mode==='purchase-db')db(path).exec('CREATE TABLE ledger_meta(id INTEGER)');
    if(mode==='schema')db(path).exec('ALTER TABLE reward_claims ADD COLUMN unexpected TEXT');
    expect(()=>open(path,patch)).toThrow('reward-ledger-open-failed');
  });
  it('다른 환경에는 발급 claim 원장 자체가 없음',async()=>{const {ledger}=open(),c=claim(ledger),other=open(undefined,{policy:{...policy,environment:'production'}}).ledger;expect(await other.processCallback(query(c))).toEqual(denied('invalid-claim'));});
  it.each(['relative.sqlite','/not-a-database.txt'])('잘못된 path %s',databasePath=>{expect(()=>open(databasePath)).toThrow('invalid-reward-config');});
  it('DB/log/일반 결과에 원문 callback·서명·nonce/user·owner/round·키 없음',async()=>{
    const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')],{ledger,path}=open(),c=claim(ledger),raw=query(c),signature=raw.match(/signature=([^&]+)/)![1];
    const result=await ledger.processCallback(raw);close(ledger);
    const bytes=readdirSync(join(path,'..')).map(f=>readFileSync(join(path,'..',f))),output=JSON.stringify(result);
    for(const secret of [raw,c.customData,c.userId,owner.ownerId,owner.roundId,signature,Buffer.from(key).toString('hex')]){expect(output).not.toContain(secret);bytes.forEach(b=>expect(b.includes(Buffer.from(secret))).toBe(false));}
    logs.forEach(l=>expect(l).not.toHaveBeenCalled());
  });
  it.each([NaN,-1,1.1,Number.MAX_SAFE_INTEGER,999999999999])('잘못된 서버시각 %s 발급 거절',now=>{const {ledger}=open(undefined,{dependencies:{now:()=>now,transport:async()=>keyResponse()}});expect(ledger.issueClaim(owner,policy.adUnits[0])).toEqual(denied('invalid-time'));});
  it('열 이름이 같아도 UNIQUE 누락 스키마 차단',()=>{
    const {ledger,path}=open();close(ledger);const d=db(path);d.exec('DROP TABLE reward_vouchers; CREATE TABLE reward_vouchers(tx_hash TEXT PRIMARY KEY,round_hash TEXT,nonce_hash TEXT,recorded_at INTEGER,amount INTEGER,item TEXT) STRICT');expect(()=>open(path)).toThrow('reward-ledger-open-failed');
  });
  it('구성 getter 예외·잘못된 주입은 고정 오류',()=>{
    expect(()=>new RewardLedger({get databasePath(){throw new Error('secret-path');}} as any)).toThrow('invalid-reward-config');
    expect(()=>open(undefined,{policy:{get environment(){throw new Error('secret-policy');}} as any})).toThrow('invalid-reward-config');
    expect(()=>open(undefined,{dependencies:{transport:'not-function' as any}})).toThrow('invalid-reward-config');
  });
  it('취소 시점이 key 조회 대기 중이면 저장 이전 abort 거절',async()=>{
    let resolve!:(r:Response)=>void;const {ledger,path}=open(undefined,{dependencies:{now:()=>epoch,transport:()=>new Promise(r=>resolve=r)}}),c=claim(ledger),a=new AbortController(),work=ledger.processCallback(query(c),a.signal);a.abort();expect(await work).toEqual(denied('aborted'));resolve(keyResponse());await new Promise(r=>setTimeout(r,0));expect(db(path).prepare('SELECT state FROM reward_claims').get()?.state).toBe('pending');
  });
});
