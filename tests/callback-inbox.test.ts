import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {fork} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {createCipheriv,randomBytes} from 'node:crypto';
import {CallbackInbox,type CallbackInboxOptions} from '../server/ads/callbackInbox';
import {RewardLedger} from '../server/ads/rewardLedger';
import {isAdmobCallbackStructure} from '../server/ads/admobSsv';
import {createCallbackHttpAdapter,CALLBACK_PATH} from '../server/ads/callbackHttp';
import {callback,epoch,keyEntry,keyResponse,policy,malleate} from './helpers/ssvFixture';
const key=randomBytes(32),rewardKey=randomBytes(32),owner={ownerId:'synthetic-private-owner',roundId:'synthetic-private-round'};
const dirs:string[]=[],inboxes:CallbackInbox[]=[],ledgers:RewardLedger[]=[],dbs:DatabaseSync[]=[],workers:Worker[]=[];
const workerUrl=new URL('./helpers/callback-inbox-worker.mjs',import.meta.url);
const storage={kind:'unavailable',code:'storage'},clock={kind:'unavailable',code:'clock'};
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'pawblossom-inbox-'));dirs.push(dir);
  const path=join(dir,'inbox.sqlite'),rewardPath=join(dir,'reward.sqlite');let time=epoch;
  const transport=vi.fn<typeof fetch>(async()=>keyResponse());
  const rewardOptions={databasePath:rewardPath,serverKey:rewardKey,policy,dependencies:{now:()=>time,transport}};
  const ledger=new RewardLedger(rewardOptions);ledgers.push(ledger);
  const claim=ledger.issueClaim(owner,policy.adUnits[0]);if(claim.kind!=='claim-issued')throw new Error('fixture-failed');
  const raw=callback({custom_data:claim.customData,user_id:claim.userId});
  const options:CallbackInboxOptions={databasePath:path,encryptionKey:key,policy,now:()=>time,maxRows:100,maxAttempts:3,maxAgeMs:1000,
    leaseMs:100,backoffMs:10,maxBackoffMs:20,rewardLedger:rewardOptions};
  function open(patch:Partial<CallbackInboxOptions>={}){const box=new CallbackInbox({...options,...patch});inboxes.push(box);return box;}
  function conn(p=path){const d=new DatabaseSync(p);dbs.push(d);return d;}
  function input(extra={}){return {path,rewardPath,key:[...key],rewardKey:[...rewardKey],policy,entries:[keyEntry()],now:time,query:raw,...extra};}
  return {path,rewardPath,dir,options,raw,claim,ledger,transport,open,conn,input,setTime:(n:number)=>time=n};
}
function close(b:CallbackInbox){b.close();inboxes.splice(inboxes.indexOf(b),1);}
async function child(data:ReturnType<ReturnType<typeof fixture>['input']>) {
  const p=fork(workerUrl,[],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','ignore','ipc']});
  const done=new Promise<void>(r=>p.once('exit',()=>r()));
  const result=new Promise<any>((r,j)=>{p.once('message',r);p.once('error',j);p.once('exit',c=>{if(c)j(new Error('worker-failed'));});});
  try{p.send(data);const output=await result;await done;return output;}finally{if(p.exitCode===null){p.kill();await done;}}
}
async function parallel(data:unknown[]) {
  const batch=data.map(d=>new Worker(workerUrl,{workerData:d,execArgv:['--experimental-strip-types']}));workers.push(...batch);
  const outputs:Promise<any>[]=[];
  await Promise.all(batch.map(w=>new Promise<void>((r,j)=>{
    let receive!:(x:any)=>void;outputs.push(new Promise(resolve=>receive=resolve));
    w.on('message',v=>v==='ready'?r():receive(v));w.on('error',j);
  })));batch.forEach(w=>w.postMessage('go'));return Promise.all(outputs);
}
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(workers.splice(0).map(w=>w.terminate()));dbs.splice(0).forEach(d=>d.close());inboxes.splice(0).forEach(b=>b.close());ledgers.splice(0).forEach(l=>l.close());dirs.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
describe('암호화 수신·원장 내부검증·재시작',()=>{
  it('durable receipt, 동일원문 dedup·terminal tombstone·실원장 신규1회',async()=>{
    const f=fixture(),b=f.open(),a=b.receive(f.raw);expect(a.kind).toBe('accepted');expect(b.receive(f.raw)).toEqual(a);
    const d=f.conn(),before=d.prepare('SELECT * FROM callback_inbox').get()!;expect(before.attempts).toBe(0);expect(before.ciphertext).not.toBeNull();
    expect(f.ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:false});expect(await b.processNext()).toEqual({kind:'completed'});
    expect(f.ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:true});expect(b.receive(f.raw)).toEqual(a);
    const row=d.prepare('SELECT state,ciphertext,tag,attempts,token FROM callback_inbox').get();expect(row).toEqual({state:'completed',ciphertext:null,tag:null,attempts:1,token:null});
    close(b);const next=f.open();expect(next.receive(f.raw)).toEqual(a);expect(await next.processNext()).toEqual({kind:'idle'});
    expect(f.conn(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('별도프로세스 저장/재시작 처리, 별도 원문 서명변형은 원장 중복 처리',async()=>{
    const f=fixture();expect((await child(f.input({action:'receive'}))).kind).toBe('accepted');
    expect(await child(f.input())).toEqual({kind:'completed'});const b=f.open();expect(b.receive(malleate(f.raw)).kind).toBe('accepted');expect(await b.processNext()).toEqual({kind:'completed'});
    expect(f.conn(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('원장commit 후 finalize실패/재시작/lease회수에도 실제 신규 보상권1개',async()=>{
    const f=fixture(),b=f.open(),d=f.conn();b.receive(f.raw);
    d.exec("CREATE TRIGGER fail_finalize BEFORE UPDATE ON callback_inbox WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'private-error'); END");
    expect(await b.processNext()).toEqual(storage);expect(f.ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:true});
    expect(d.prepare('SELECT state,attempts FROM callback_inbox').get()).toEqual({state:'processing',attempts:1});close(b);d.exec('DROP TRIGGER fail_finalize');f.setTime(epoch+100);
    expect(await child(f.input())).toEqual({kind:'completed'});expect(f.conn(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
    expect(d.prepare('SELECT state,attempts FROM callback_inbox').get()).toEqual({state:'completed',attempts:2});
  });
  it('8worker 동일수신 row1/receipt1, 동시처리는 원자선점1회',async()=>{
    const f=fixture(),received=await parallel(Array.from({length:8},()=>f.input({action:'receive'})));
    expect(received.every(r=>r.kind==='accepted')).toBe(true);expect(new Set(received.map(r=>r.receipt)).size).toBe(1);
    const results=await parallel(Array.from({length:8},()=>f.input()));expect(results.filter(r=>r.kind==='completed')).toHaveLength(1);expect(results.filter(r=>r.kind==='idle')).toHaveLength(7);
    expect(f.conn().prepare('SELECT attempts FROM callback_inbox').get()?.attempts).toBe(1);expect(f.conn(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('외부 verified/event 객체와 processor 주입으로 지급할 수 없음',async()=>{
    const f=fixture(),fake=vi.fn(async()=>({kind:'voucher-recorded',newGrant:true})),b=f.open({processor:fake} as any);
    expect(b.receive({verified:true,event:{}})).toEqual({kind:'rejected',code:'invalid-callback'});b.receive(callback());expect(await b.processNext()).toEqual({kind:'discarded'});expect(fake).not.toHaveBeenCalled();
    expect(f.ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:false});
  });
  it.each(['policy','signature','claim','closed','time','transaction'])('실원장 %s 거절은 재시도 없이 폐기',async mode=>{
    const f=fixture(),b=f.open();let raw=f.raw;
    if(mode==='policy')raw=callback({custom_data:f.claim.customData,user_id:f.claim.userId,reward_amount:'6'});
    if(mode==='signature')raw=f.raw.replace('reward_item=moves','reward_item=other');
    if(mode==='claim')raw=callback();
    if(mode==='closed')f.ledger.closeRound(owner);
    if(mode==='time')raw=callback({custom_data:f.claim.customData,user_id:f.claim.userId,timestamp:String(epoch+31_000)});
    if(mode==='transaction') {
      expect((await f.ledger.processCallback(f.raw)).kind).toBe('voucher-recorded');
      const c=f.ledger.issueClaim({...owner,roundId:'other-round'},policy.adUnits[0]);if(c.kind!=='claim-issued')throw new Error('fixture-failed');
      raw=callback({custom_data:c.customData,user_id:c.userId});
    }
    b.receive(raw);expect(await b.processNext()).toEqual({kind:'discarded'});expect(await b.processNext()).toEqual({kind:'idle'});
    expect(f.conn().prepare('SELECT state,attempts,ciphertext FROM callback_inbox').get()).toEqual({state:'discarded',attempts:1,ciphertext:null});
  });
});
describe('lease·제한 backoff·시간·장애',()=>{
  it('키 일시실패는 due 전 idle, 복구 뒤 내부 재검증',async()=>{
    const f=fixture();f.transport.mockImplementation(async()=>{throw new Error('private-transport');});const b=f.open();b.receive(f.raw);
    expect(await b.processNext()).toEqual({kind:'retry'});expect(await b.processNext()).toEqual({kind:'idle'});expect(f.conn().prepare('SELECT next_at,attempts FROM callback_inbox').get()).toEqual({next_at:epoch+10,attempts:1});
    close(b);f.transport.mockImplementation(async()=>keyResponse());f.setTime(epoch+10);expect(await f.open().processNext()).toEqual({kind:'completed'});
  });
  it('동일instance 기본 backoff/8시도와 verifier60초cooldown에서63초에 실제복구',async()=>{
    const f=fixture();f.transport.mockRejectedValueOnce(new Error('private-transport'));
    const b=f.open({maxRows:undefined,maxAttempts:undefined,maxAgeMs:undefined,leaseMs:undefined,backoffMs:undefined,maxBackoffMs:undefined});b.receive(f.raw);
    for(const at of [0,1000,3000,7000,15000,31000]){f.setTime(epoch+at);expect(await b.processNext()).toEqual({kind:'retry'});}
    expect(f.transport).toHaveBeenCalledTimes(1);f.setTime(epoch+63000);expect(await b.processNext()).toEqual({kind:'completed'});expect(f.transport).toHaveBeenCalledTimes(2);
    expect(f.conn().prepare('SELECT attempts FROM callback_inbox').get()?.attempts).toBe(7);expect(f.ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:true});
  });
  it('지수 backoff cap·최대시도 뒤 terminal·재수신에도 재등록 없음',async()=>{
    const f=fixture();f.transport.mockImplementation(async()=>{throw new Error();});const b=f.open(),r=b.receive(f.raw);
    expect(await b.processNext()).toEqual({kind:'retry'});f.setTime(epoch+10);expect(await b.processNext()).toEqual({kind:'retry'});expect(f.conn().prepare('SELECT next_at FROM callback_inbox').get()?.next_at).toBe(epoch+30);
    f.setTime(epoch+30);expect(await b.processNext()).toEqual({kind:'discarded'});expect(b.receive(f.raw)).toEqual(r);expect(await b.processNext()).toEqual({kind:'idle'});
  });
  it('backoff 상한 도달 뒤 더늘지 않음, 보존기한에 닿는 retry도 폐기',async()=>{
    const f=fixture();f.transport.mockImplementation(async()=>{throw new Error();});const b=f.open({maxAttempts:5,maxAgeMs:60});b.receive(f.raw);
    for(const [at,next] of [[0,10],[10,30],[30,50]]){f.setTime(epoch+at);expect(await b.processNext()).toEqual({kind:'retry'});expect(f.conn().prepare('SELECT next_at FROM callback_inbox').get()?.next_at).toBe(epoch+next);}
    f.setTime(epoch+50);expect(await b.processNext()).toEqual({kind:'discarded'});expect(f.conn().prepare('SELECT attempts FROM callback_inbox').get()?.attempts).toBe(4);
  });
  it('오래된 pending은 원장 호출 없이 폐기·TTL 연장 없음',async()=>{
    const f=fixture(),b=f.open();b.receive(f.raw);f.setTime(epoch+1000);expect(await b.processNext()).toEqual({kind:'idle'});expect(f.transport).not.toHaveBeenCalled();expect(f.conn().prepare('SELECT state,ciphertext FROM callback_inbox').get()).toEqual({state:'discarded',ciphertext:null});
  });
  it('원래 원장15분+5분 지연기한을 넘으면 더긴 수신함에서도 거절',async()=>{
    const f=fixture(),b=f.open({maxAgeMs:86_400_000});b.receive(f.raw);f.setTime(epoch+20*60_000+1);expect(await b.processNext()).toEqual({kind:'discarded'});expect(f.ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:false});
  });
  it('crashed processing의 시도한도 도달/lease만료는 재호출 없이 폐기',async()=>{
    const f=fixture(),b=f.open({maxAttempts:1}),d=f.conn();b.receive(f.raw);d.exec("UPDATE callback_inbox SET state='processing',token='old',attempts=1,lease_until="+(epoch+100));
    expect(await b.processNext()).toEqual({kind:'idle'});f.setTime(epoch+100);expect(await b.processNext()).toEqual({kind:'idle'});expect(d.prepare('SELECT state FROM callback_inbox').get()?.state).toBe('discarded');expect(f.transport).not.toHaveBeenCalled();
  });
  it('늦은worker fencing: 새worker가 finalize한 뒤 원장 중복 호출도 신규1회',async()=>{
    const f=fixture();let finish!:(r:Response)=>void;f.transport.mockImplementation(()=>new Promise(r=>finish=r));const slow=f.open();slow.receive(f.raw);const work=slow.processNext();
    f.setTime(epoch+100);const fast=f.open({rewardLedger:{...f.options.rewardLedger,dependencies:{now:()=>epoch+100,transport:async()=>keyResponse()}}});
    expect(await fast.processNext()).toEqual({kind:'completed'});finish(keyResponse());expect(await work).toEqual({kind:'stale'});
    expect(f.conn().prepare('SELECT state,attempts FROM callback_inbox').get()).toEqual({state:'completed',attempts:2});expect(f.conn(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('동일instance 동시 processNext는 다른 소유권 침범 없음',async()=>{
    const f=fixture();let finish!:(r:Response)=>void;f.transport.mockImplementation(()=>new Promise(r=>finish=r));const b=f.open();b.receive(f.raw);const first=b.processNext();expect(await b.processNext()).toEqual({kind:'idle'});finish(keyResponse());expect(await first).toEqual({kind:'completed'});
  });
  it('처리대기중 close·재시작회수, close후 읽기/쓰기 차단',async()=>{
    const f=fixture();let finish!:(r:Response)=>void;f.transport.mockImplementation(()=>new Promise(r=>finish=r));const b=f.open();b.receive(f.raw);const work=b.processNext();close(b);finish(keyResponse());expect(await work).toEqual(storage);expect(b.receive(f.raw)).toEqual(storage);expect(await b.processNext()).toEqual(storage);b.close();
    f.transport.mockImplementation(async()=>keyResponse());f.setTime(epoch+100);expect(await f.open().processNext()).toEqual({kind:'completed'});
  });
  it('시계 역행은 instance·DB 재시작·다른worker에서도 차단',async()=>{
    const f=fixture(),b=f.open();f.setTime(epoch+20);b.receive(f.raw);f.setTime(epoch+19);expect(b.receive(f.raw)).toEqual(clock);expect(await b.processNext()).toEqual(clock);close(b);expect(await f.open().processNext()).toEqual(clock);
    expect(await child(f.input())).toEqual(clock);
  });
  it.each([NaN,-1,1.1,Number.MAX_SAFE_INTEGER,999999999999])('잘못된 시계 %s',async n=>{const f=fixture(),b=f.open({now:()=>n});expect(b.receive(f.raw)).toEqual(clock);expect(await b.processNext()).toEqual(clock);});
  it('시계 getter/실행예외는 고정 오류',async()=>{const f=fixture(),b=f.open({now:()=>{throw new Error('private-clock');}});expect(b.receive(f.raw)).toEqual(storage);expect(await b.processNext()).toEqual(storage);});
  it('용량은 terminal 포함·기존digest는 가득차도 같은receipt',async()=>{const f=fixture(),b=f.open({maxRows:1}),r=b.receive(f.raw);expect(await b.processNext()).toEqual({kind:'completed'});expect(b.receive(callback())).toEqual({kind:'unavailable',code:'capacity'});expect(b.receive(f.raw)).toEqual(r);expect(f.conn().prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(1);});
  it('수신INSERT/COMMIT실패와 lock은 성공금지·원장storage실패는 재시도',async()=>{
    const f=fixture(),b=f.open(),d=f.conn();d.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON callback_inbox BEGIN SELECT RAISE(ABORT,'private-error'); END");expect(b.receive(f.raw)).toEqual(storage);expect(d.prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(0);d.exec('DROP TRIGGER fail_insert');
    d.exec('BEGIN IMMEDIATE');expect(b.receive(f.raw)).toEqual(storage);expect(await b.processNext()).toEqual(storage);d.exec('ROLLBACK');b.receive(f.raw);
    const reward=f.conn(f.rewardPath);reward.exec('BEGIN IMMEDIATE');expect(await b.processNext()).toEqual({kind:'retry'});reward.exec('ROLLBACK');f.setTime(epoch+10);expect(await b.processNext()).toEqual({kind:'completed'});
  });
  it('실제 COMMIT 제약실패는 rollback 뒤 HTTP503, durable성공 전200 금지',()=>{
    const f=fixture(),b=f.open(),d=f.conn(),h=createCallbackHttpAdapter(b),request={method:'GET',target:CALLBACK_PATH+'?'+f.raw,bodyBytes:0};
    // 즉시 INSERT는 성공하지만 COMMIT에서만 실패하는 deferred FK를 테스트 DB에 주입합니다.
    d.exec("CREATE TABLE commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_child(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail_commit AFTER INSERT ON callback_inbox BEGIN INSERT INTO commit_child VALUES(1); END");
    expect(h(request).status).toBe(503);expect(d.prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(0);expect(d.prepare('SELECT high_water FROM callback_meta').get()?.high_water).toBe(0);
    d.exec('DROP TRIGGER fail_commit; DROP TABLE commit_child; DROP TABLE commit_parent');expect(h(request).status).toBe(200);
  });
});
describe('스키마·환경·키·암호 비노출',()=>{
  it.each(['ciphertext','tag','iv','receipt','digest','received_at'])('%s 변조는 GCM/AAD/digest검사로 terminal',async field=>{
    const f=fixture(),b=f.open(),d=f.conn();b.receive(f.raw);const value=field==='received_at'?epoch-1:['receipt','digest'].includes(field)?'0'.repeat(48):randomBytes(field==='iv'?12:field==='tag'?16:32);
    d.prepare(`UPDATE callback_inbox SET ${field}=?`).run(value);expect(await b.processNext()).toEqual({kind:'discarded'});expect(f.transport).not.toHaveBeenCalled();expect(d.prepare('SELECT ciphertext FROM callback_inbox').get()?.ciphertext).toBeNull();
  });
  it('유효암호이지만 저장digest와 다른원문도 거절',async()=>{
    const f=fixture(),b=f.open(),d=f.conn();b.receive(f.raw);const r=d.prepare('SELECT * FROM callback_inbox').get()!,profile=d.prepare('SELECT profile FROM callback_meta').get()!.profile;
    const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(JSON.stringify([profile,r.receipt,r.digest,r.received_at])));const encrypted=Buffer.concat([c.update(callback(),'utf8'),c.final()]);d.prepare('UPDATE callback_inbox SET iv=?,tag=?,ciphertext=?').run(iv,c.getAuthTag(),encrypted);
    expect(await b.processNext()).toEqual({kind:'discarded'});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['environment','policy','key','rows','age','attempts','lease','backoff','schema','meta','wrong-db'])('%s reopen 차단',mode=>{
    const f=fixture(),b=f.open();b.receive(f.raw);close(b);const d=f.conn();let patch:Partial<CallbackInboxOptions>={};
    if(mode==='environment')patch={policy:{...policy,environment:'production'}};if(mode==='policy')patch={policy:{...policy,adUnits:['9']}};if(mode==='key')patch={encryptionKey:randomBytes(32)};if(mode==='rows')patch={maxRows:101};if(mode==='age')patch={maxAgeMs:1001};if(mode==='attempts')patch={maxAttempts:4};if(mode==='lease')patch={leaseMs:101};if(mode==='backoff')patch={backoffMs:11};
    if(mode==='schema')d.exec('ALTER TABLE callback_inbox ADD COLUMN unexpected TEXT');if(mode==='meta')d.exec('DELETE FROM callback_meta');if(mode==='wrong-db')d.exec('CREATE TABLE reward_meta(id INTEGER)');
    expect(()=>f.open(patch)).toThrow('callback-inbox-open-failed');
  });
  it('실행중 metadata 오류도 failclosed, 재시도무한 없음',async()=>{const f=fixture(),b=f.open();b.receive(f.raw);f.conn().exec("UPDATE callback_meta SET profile='private-error'");expect(await b.processNext()).toEqual(storage);expect(b.receive(f.raw)).toEqual(storage);expect(f.transport).not.toHaveBeenCalled();});
  it.each(['path','key'])('대상 원장 %s 변경은 저장callback 폐기전에 reopen 거절',mode=>{
    const f=fixture(),b=f.open();b.receive(f.raw);close(b);
    const rewardLedger={...f.options.rewardLedger,...(mode==='path'?{databasePath:join(f.dir,'other.sqlite')}:{serverKey:randomBytes(32)})};
    expect(()=>f.open({rewardLedger})).toThrow('callback-inbox-open-failed');expect(f.conn().prepare('SELECT state,attempts FROM callback_inbox').get()).toEqual({state:'pending',attempts:0});
  });
  it.each([{maxRows:0},{maxRows:100001},{maxAttempts:33},{maxAgeMs:0},{leaseMs:0},{backoffMs:0},{backoffMs:21,maxBackoffMs:20},{now:4},{databasePath:'relative.sqlite'},{encryptionKey:new Uint8Array(31)}])('잘못된구성 %#',patch=>{const f=fixture();expect(()=>f.open(patch as any)).toThrow('invalid-callback-inbox-config');});
  it('원장키·DB분리 강제, getter 고정오류',()=>{const f=fixture();expect(()=>f.open({encryptionKey:rewardKey})).toThrow('invalid-callback-inbox-config');expect(()=>f.open({databasePath:f.rewardPath})).toThrow('invalid-callback-inbox-config');expect(()=>new CallbackInbox({get databasePath(){throw new Error('private-config');}} as any)).toThrow('invalid-callback-inbox-config');});
  it('구성·배열·key·dependencies 변경은 이미생성된인스턴스에 영향없음',async()=>{
    const f=fixture(),p={...policy,adUnits:[...policy.adUnits],adNetworks:[...policy.adNetworks]},k=Buffer.from(key),rk=Buffer.from(rewardKey),deps={now:()=>epoch,transport:async()=>keyResponse()};
    const options={...f.options,encryptionKey:k,policy:p,rewardLedger:{databasePath:f.rewardPath,serverKey:rk,dependencies:deps}};const b=f.open(options);
    k.fill(0);rk.fill(0);p.adUnits[0]='9';p.adNetworks[0]='9';deps.transport=async()=>{throw new Error();};options.maxRows=0;options.now=()=>-1;
    expect(b.receive(f.raw).kind).toBe('accepted');expect(await b.processNext()).toEqual({kind:'completed'});
  });
  it('DB파일·journal·로그·결과·예외에 원문/nonce/user/signature/키 없음, IV는 행마다다름',async()=>{
    const f=fixture(),logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')],b=f.open(),result=b.receive(f.raw);b.receive(callback());
    const rows=f.conn().prepare('SELECT iv FROM callback_inbox').all();expect(new Set(rows.map(r=>Buffer.from(r.iv as Uint8Array).toString('hex'))).size).toBe(2);
    const work=await b.processNext();close(b);const bytes=readdirSync(f.dir).map(p=>readFileSync(join(f.dir,p))),output=JSON.stringify([result,work]);
    for(const secret of [f.raw,f.claim.customData,f.claim.userId,owner.ownerId,owner.roundId,f.raw.match(/signature=([^&]+)/)![1],key.toString('hex'),rewardKey.toString('hex')]) {
      // 실패시에도 secret을 expect 출력에 포함시키지 않습니다.
      expect(output.includes(secret)).toBe(false);expect(bytes.some(b=>b.includes(Buffer.from(secret)))).toBe(false);
    }expect(bytes.some(b=>b.includes(key)||b.includes(rewardKey))).toBe(false);logs.forEach(l=>expect(l).not.toHaveBeenCalled());
  });
});
describe('pure HTTP GET adapter·boolean 구조검사',()=>{
  it('성공200은 durable수신만 의미, receipt/query echo 없음·동결 응답',()=>{const f=fixture(),b=f.open(),handle=createCallbackHttpAdapter(b),r=handle({method:'GET',target:CALLBACK_PATH+'?'+f.raw,bodyBytes:0});expect(r.status).toBe(200);expect(r.body).toBe('received');expect(Object.isFrozen(r)&&Object.isFrozen(r.headers)).toBe(true);expect(f.transport).not.toHaveBeenCalled();expect(f.ledger.hasVoucher(owner)).toEqual({kind:'voucher-status',present:false});});
  it.each([
    ['POST',CALLBACK_PATH,0,405],['get',CALLBACK_PATH,0,405],['GET','/other?x',0,404],['GET','https://x'+CALLBACK_PATH+'?x',0,404],['GET',CALLBACK_PATH,0,400],
    ['GET',CALLBACK_PATH+'?',0,400],['GET',CALLBACK_PATH+'?x',1,413],['GET',CALLBACK_PATH+'?'+ 'x'.repeat(4097),0,413],['GET',{},0,400],['GET',CALLBACK_PATH,-1,400],['GET',CALLBACK_PATH,NaN,400],['GET',CALLBACK_PATH,'0',400],
  ])('method/path/body/bounds %#',(method,target,bodyBytes,status)=>{const f=fixture(),b=f.open(),r=createCallbackHttpAdapter(b)({method,target,bodyBytes});expect(r.status).toBe(status);if(status===405){expect(r.headers.allow).toBe('GET');expect(Object.isFrozen(r.headers)).toBe(true);}expect(f.conn().prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(0);});
  it.each(['?','%20','+','#','\r\n','한','&extra=x'])('query 원문 %s 변환없이 거절',suffix=>{const f=fixture(),b=f.open();expect(createCallbackHttpAdapter(b)({method:'GET',target:CALLBACK_PATH+'?'+f.raw+suffix,bodyBytes:0}).status).toBe(400);expect(isAdmobCallbackStructure(f.raw+suffix)).toBe(false);});
  it('고정503 mapping: insert실패·용량·close·시계·getter 예외',()=>{
    const f=fixture(),b=f.open({maxRows:1}),h=createCallbackHttpAdapter(b),request={method:'GET',target:CALLBACK_PATH+'?'+f.raw,bodyBytes:0};const d=f.conn();d.exec("CREATE TRIGGER fail BEFORE INSERT ON callback_inbox BEGIN SELECT RAISE(ABORT,'private-error'); END");expect(h(request).status).toBe(503);d.exec('DROP TRIGGER fail');expect(h(request).status).toBe(200);
    expect(h({...request,target:CALLBACK_PATH+'?'+callback()}).status).toBe(503);f.setTime(epoch-1);expect(h(request).status).toBe(503);close(b);expect(h(request).status).toBe(503);expect(h({get method(){throw new Error('private-error');}} as any)).toEqual(h(request));
  });
  it('request getter를각각1번 snapshot·inbox method monkeypatch 무시',()=>{const f=fixture(),b=f.open(),h=createCallbackHttpAdapter(b);b.receive=()=>{throw new Error('private-error');};const method=vi.fn(()=>'GET'),target=vi.fn(()=>CALLBACK_PATH+'?'+f.raw),bodyBytes=vi.fn(()=>0);const r=h({get method(){return method();},get target(){return target();},get bodyBytes(){return bodyBytes();}});expect(r.status).toBe(200);[method,target,bodyBytes].forEach(g=>expect(g).toHaveBeenCalledTimes(1));});
  it('구조검사 반환에는 원문필드 없음',()=>{const f=fixture();expect(isAdmobCallbackStructure(f.raw)).toBe(true);expect(isAdmobCallbackStructure({verified:true})).toBe(false);expect(()=>createCallbackHttpAdapter({receive:()=>({kind:'accepted'})} as any)).toThrow('invalid-callback-http-config');});
});
