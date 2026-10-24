import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash,createHmac} from 'node:crypto';
import {fork} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {isDeepStrictEqual} from 'node:util';
import {RewardLedger,readRedeemedGrant,type RewardLedgerOptions,type RedeemedGrant} from '../server/ads/rewardLedger';
import {RoundLedger,type RoundLedgerOptions,type RoundSnapshot} from '../server/game/roundLedger';
import {CallbackInbox} from '../server/ads/callbackInbox';
import {BoardEngine} from '../src/core/BoardEngine';
import {policy,epoch,callback,keyResponse} from './helpers/ssvFixture';
import {createTrace,step,asyncStep,elapsed,workerRow,observeWorker,receiveWorker,terminateWorker,workerFailure,safeRows,withSqliteDiagnostics,type LedgerTrace} from './helpers/ledgerDiagnostics';
import {retryLedgerOpen} from './helpers/ledgerOpenRetry';
import {squareRoundFixture} from './helpers/squareRoundFixture';
import {createSpanClockAnchor} from './helpers/ledgerTransactionSpans';

// d867e32의 실제 v1 코드로 한 번 생성한 DDL·서명 행입니다. CI는 Git 과거 이력에 의존하지 않습니다.
const legacyFixture=JSON.parse(readFileSync(new URL('./helpers/ledger-v1-fixture.json',import.meta.url),'utf8'));
const roundKey=new Uint8Array(32).fill(67),rewardKey=new Uint8Array(32).fill(71),owner={ownerId:'synthetic-redemption-owner-private'};
// 보상 v1 원본은 유지합니다. 회차 통합은 별도로 새 V2 상태/실제 명령 영수증에서 생성합니다.
const currentFixture=squareRoundFixture(legacyFixture,roundKey,owner,epoch);
const fixture={...legacyFixture,round:currentFixture.round,rounds:currentFixture.rounds};
const failed=fixture.rounds.failed as RoundSnapshot,context={...owner,roundId:failed.roundId},request={roundId:failed.roundId};
const dirs:string[]=[],resources:{close():void}[]=[],dbs:DatabaseSync[]=[],workers:Worker[]=[];
const url=new URL('./helpers/reward-redemption-worker.mjs',import.meta.url);
const denied=(code:string)=>({kind:'rejected',code}),unavailable={kind:'service-error',code:'storage-unavailable'};
function path(name:string){const p=mkdtempSync(join(tmpdir(),'pawblossom-redemption-'));dirs.push(p);return join(p,name+'.sqlite');}
function db(p:string){const d=new DatabaseSync(p,{enableForeignKeyConstraints:false});dbs.push(d);return d;}
function load(p:string,tables:any[]){const d=db(p);d.exec('BEGIN');for(const t of tables)d.exec(t.sql);for(const t of tables)for(const r of t.rows)d.prepare('INSERT INTO '+t.name+' VALUES('+Object.keys(r).map(()=>'?').join()+')').run(...Object.values(r) as any[]);d.exec('COMMIT');return d;}
function reward(p=path('reward'),patch:Partial<RewardLedgerOptions>={}){const l=new RewardLedger({databasePath:p,serverKey:rewardKey,policy,dependencies:{now:()=>epoch,transport:async()=>keyResponse()},...patch});resources.push(l);return l;}
function round(p=path('round'),patch:Partial<RoundLedgerOptions>={}){const l=new RoundLedger({databasePath:p,serverKey:roundKey,environment:'test',now:()=>epoch,...patch});resources.push(l);return l;}
function setup(roundPatch:Partial<RoundLedgerOptions>={}){const rewardPath=path('reward'),roundPath=path('round');load(rewardPath,fixture.reward);load(roundPath,fixture.round);return {rewardPath,roundPath,reward:reward(rewardPath),round:round(roundPath,roundPatch)};}
function redeem(l:RewardLedger,c=context){const r=l.redeemVoucher(c);if(r.kind!=='voucher-redeemed')throw new Error('합성 소비 실패:'+JSON.stringify(r));return r;}
function apply(l:RoundLedger,g:RedeemedGrant){const r=l.applyReward(owner,request,g);if(r.kind!=='reward-result')throw new Error('합성 적용 실패:'+JSON.stringify(r));return r;}
function move(l:RoundLedger,s:RoundSnapshot,activation=false){
  const engine=new BoardEngine(8,8,()=>{throw new Error();},s.state as any),at=s.state.board.flatMap((row,r)=>row.map((t,c)=>t!.special?{row:r,col:c}:undefined)).find(Boolean);
  const command=activation&&at?{type:'activate' as const,at}:{type:'swap' as const,...engine.legalMoves()[0]};
  const r=l.command(owner,{roundId:s.roundId,operationId:'after-'+s.revision,expectedRevision:s.revision,command});if(r.kind!=='command-result')throw new Error('합성 이동 실패');return r;
}
function input(f:ReturnType<typeof setup>,action='apply',extra:{retryConstructorBusy?:boolean;notifyConstructorBusy?:boolean;constructorReleaseGate?:SharedArrayBuffer}={}){return {action,rewardPath:f.rewardPath,roundPath:f.roundPath,rewardKey:[...rewardKey],roundKey:[...roundKey],policy,now:epoch,context,...extra};}
async function child(data:ReturnType<typeof input>){
  const p=fork(url,[],{execArgv:['--experimental-transform-types'],stdio:['ignore','ignore','ignore','ipc']});const done=new Promise<void>(r=>p.once('exit',()=>r()));
  const output=new Promise<any>((r,j)=>{p.once('message',r);p.once('error',j);p.once('exit',c=>{if(c)j(new Error('별도 프로세스 실패'));});});
  try{p.send(data);const result=await output;await done;return result;}finally{if(p.exitCode===null){p.kill();await done;}}
}
async function parallel(data:ReturnType<typeof input>[],trace?:LedgerTrace,onConstructorBusy?:()=>void){
  const spanClockAnchor=trace?createSpanClockAnchor():undefined;
  const batch=data.map((d,index)=>{const row=trace?workerRow(index):undefined;if(row)trace!.workers.push(row);const worker=new Worker(url,{workerData:trace?{...d,diagnostics:true,spanClockAnchor}:d,execArgv:['--experimental-transform-types']});if(row)observeWorker(worker,trace!,row);return worker;});workers.push(...batch);const outputs:Promise<any>[]=[];
  await Promise.all(batch.map((w,index)=>new Promise<void>((r,j)=>{let receive!:(v:any)=>void;const row=trace?.workers[index];outputs.push(new Promise((yes,no)=>{receive=yes;w.on('error',error=>no(workerFailure(error,trace)));}));w.on('message',v=>{if(v==='ready'){if(row)row.readyAtMs=elapsed(trace!);r();}else if(v?.kind==='synthetic-open-busy'){onConstructorBusy?.();}else{if(row)row.resultAtMs=elapsed(trace!);receive(row?receiveWorker(v,row,spanClockAnchor):v);}});w.on('error',error=>j(workerFailure(error,trace)));})));batch.forEach((w,index)=>{if(trace)trace.workers[index].goAtMs=elapsed(trace);w.postMessage('go');});return Promise.all(outputs);
}
function dump(d:DatabaseSync){return d.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t=>({...t,rows:d.prepare('SELECT * FROM '+t.name+' ORDER BY 1').all()}));}
function roundMac(domain:string,value:string){return createHmac('sha256',createHmac('sha256',roundKey).update('pawblossom-round-v1\0'+domain).digest()).update(value).digest('hex');}
function reprofile(d:DatabaseSync,patch:Record<string,number>){
  const m:any=d.prepare('SELECT * FROM round_meta').get();m.profile=JSON.stringify({...JSON.parse(m.profile),...patch});
  d.prepare('UPDATE round_meta SET profile=?,meta_mac=?').run(m.profile,roundMac('meta',JSON.stringify([m.profile,m.high_water])));
  for(const r of d.prepare('SELECT * FROM round_rounds').all() as any[])d.prepare('UPDATE round_rounds SET state_mac=? WHERE round_id=?').run(roundMac('state',JSON.stringify([m.profile,r.round_id,r.owner_hash,r.create_hash,r.create_digest,r.created_at,r.expires_at,r.revision,r.state_json])),r.round_id);
  for(const r of d.prepare('SELECT * FROM round_ops').all() as any[])d.prepare('UPDATE round_ops SET receipt_mac=? WHERE round_id=? AND op_hash=?').run(roundMac('receipt',JSON.stringify([m.profile,r.round_id,r.op_hash,r.request_digest,r.revision,r.outcome])),r.round_id,r.op_hash);
}
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(workers.splice(0).map(terminateWorker));dbs.splice(0).forEach(d=>{try{d.exec('ROLLBACK');}catch{}d.close();});resources.splice(0).forEach(l=>l.close());dirs.splice(0).forEach(p=>{if(!p.startsWith(join(tmpdir(),'pawblossom-redemption-')))throw new Error('정리 경로 오류');rmSync(p,{recursive:true,force:true});});});

describe('검사 전용 생성자 BUSY5 재개방',()=>{
  it.for([{plan:['ok'],calls:1,waits:0},{plan:['busy','ok'],calls:2,waits:1},{plan:['busy','busy','busy'],calls:3,waits:2}])('factory/wait 상한 %#',({plan,calls,waits})=>{
    const trace=createTrace('reward-worker'),marker={kind:'service-error',code:'storage-unavailable'},originalClose=DatabaseSync.prototype.close;
    const nativeError=Object.assign(new Error('synthetic-private-error'),{code:'ERR_SQLITE_ERROR',errcode:5});vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(()=>{throw nativeError;});
    let index=0;const create=vi.fn(()=>{if(plan[index++]==='ok')return marker;const connection=new DatabaseSync(':memory:');try{connection.exec('SELECT 1');throw new Error();}finally{connection.close();}}),wait=vi.fn<(ms:number)=>void>();let returned:unknown,thrown:unknown;
    try{returned=withSqliteDiagnostics(trace,()=>retryLedgerOpen(trace,'reward-open',true,create,wait));}catch(error){thrown=error;}
    expect(create).toHaveBeenCalledTimes(calls);expect(wait.mock.calls).toEqual(Array.from({length:waits},()=>[25]));expect(trace.constructorAttempts).toHaveLength(calls);
    expect(plan.at(-1)==='ok'?returned===marker&&thrown===undefined:thrown===nativeError).toBe(true);expect(DatabaseSync.prototype.close===originalClose).toBe(true);
    expect(trace.sqliteErrors.every(row=>row.transactionActive===false&&row.connectionClosed===true)).toBe(true);
    expect(JSON.stringify(trace).includes('synthetic-private-error')).toBe(false);
  });
  it.for(['locked6','extended261','sqlite1','integrity','missing-native','old-busy','wrong-phase','wrong-operation','wrong-code','truncated','hook-failed','active','unknown-transaction','open-connection','close-missing','close-throw','close-noop','unknown-open-state','close-install-failed','close-restore-failed','disabled'])('비대상 %s는 추가 생성/대기 없음',mode=>{
    const trace=createTrace('reward-worker'),originalExec=DatabaseSync.prototype.exec,originalClose=DatabaseSync.prototype.close,originalDefine=Object.defineProperty,defineDescriptor=Object.getOwnPropertyDescriptor(Object,'defineProperty')!,closeDescriptor=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'close')!,originalGetDescriptor=Object.getOwnPropertyDescriptor,getDescriptorDescriptor=Object.getOwnPropertyDescriptor(Object,'getOwnPropertyDescriptor')!;
    const connections:DatabaseSync[]=[],nativeError=Object.assign(new Error('synthetic-private-failure'),{code:'ERR_SQLITE_ERROR',errcode:mode==='locked6'?6:mode==='extended261'?261:mode==='sqlite1'?1:5});
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(()=>{throw nativeError;});
    if(mode==='old-busy')trace.sqliteErrors.push({operation:'database-exec',site:'unknown',phase:'reward-open',errorCode:'ERR_SQLITE_ERROR',extendedCode:5,baseCode:5,transactionActive:false,connectionClosed:true});
    if(mode==='close-throw')vi.spyOn(DatabaseSync.prototype,'close').mockImplementation(()=>{throw new Error('synthetic-private-close');});
    if(mode==='close-noop')vi.spyOn(DatabaseSync.prototype,'close').mockImplementation(()=>{});
    // native own getter는 수정하지 않습니다. 해당 연결의 관측 조회 실패만 주입합니다.
    if(mode==='unknown-open-state')vi.spyOn(Object,'getOwnPropertyDescriptor').mockImplementation((target,key)=>connections.includes(target as DatabaseSync)&&key==='isOpen'?undefined:Reflect.apply(originalGetDescriptor,Object,[target,key]));
    if(mode==='close-install-failed'||mode==='close-restore-failed')originalDefine(Object,'defineProperty',{...defineDescriptor,value:(target:object,key:PropertyKey,descriptor:PropertyDescriptor)=>{
      if(target===DatabaseSync.prototype&&key==='close'&&((mode==='close-install-failed'&&descriptor.value!==originalClose)||(mode==='close-restore-failed'&&descriptor.value===originalClose)))throw new Error('synthetic-private-descriptor');return originalDefine(target,key,descriptor);
    }});
    const create=vi.fn(()=>{
      if(['integrity','missing-native','old-busy'].includes(mode))throw nativeError;
      const connection=new DatabaseSync(':memory:');connections.push(connection);if(mode==='active')Reflect.apply(originalExec,connection,['BEGIN IMMEDIATE']);
      try{connection.exec('SELECT 1');throw new Error();}
      catch(error){const row=trace.sqliteErrors.at(-1)!;if(mode==='wrong-phase')row.phase='redeem';if(mode==='wrong-operation')row.operation='statement-run';if(mode==='wrong-code')row.errorCode='other';if(mode==='unknown-transaction')row.transactionActive=null;if(mode==='truncated')trace.sqliteErrorsTruncated=true;if(mode==='hook-failed')trace.sqliteHook.installation='failed';throw error;}
      finally{if(mode!=='open-connection')try{if(mode==='close-missing')Reflect.apply(originalClose,connection,[]);else connection.close();}catch{}}
    }),wait=vi.fn<(ms:number)=>void>();let thrown:unknown;
    try{try{withSqliteDiagnostics(trace,()=>retryLedgerOpen(trace,'reward-open',mode!=='disabled',create,wait));}catch(error){thrown=error;}
      expect(thrown===nativeError).toBe(true);expect(create).toHaveBeenCalledTimes(1);expect(wait).not.toHaveBeenCalled();expect(trace.constructorAttempts).toHaveLength(mode==='disabled'?0:1);
      if(mode==='close-noop'||mode==='unknown-open-state'){
        const attempt=trace.constructorAttempts[0];expect(attempt.closeObserved&&attempt.closeSucceeded&&!attempt.closeFailed&&attempt.closeHookInstalled&&attempt.closeHookRestored).toBe(true);
        expect(trace.sqliteErrors[0].transactionActive).toBe(false);expect(trace.sqliteErrors[0].connectionClosed).toBe(mode==='close-noop'?false:null);
      }
      expect(JSON.stringify(trace).includes('synthetic-private')).toBe(false);
    }finally{originalDefine(Object,'defineProperty',defineDescriptor);originalDefine(Object,'getOwnPropertyDescriptor',getDescriptorDescriptor);originalDefine(DatabaseSync.prototype,'close',closeDescriptor);for(const connection of connections)try{Reflect.apply(originalClose,connection,[]);}catch{}}
  });
  it.for(['no-ack','notify-throw','wait-throw'])('대기/해제 관측 실패 %s도 원래 생성자 예외를 보존',mode=>{
    const trace=createTrace('reward-worker'),original=Object.assign(new Error('synthetic-private'),{code:'ERR_SQLITE_ERROR',errcode:5});vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(()=>{throw original;});
    const create=vi.fn(()=>{const connection=new DatabaseSync(':memory:');try{connection.exec('SELECT 1');}finally{connection.close();}}),wait=vi.fn<(ms:number)=>void>(()=>{if(mode==='wait-throw')throw new Error('관측 대기 실패');}),notify=()=>{if(mode==='notify-throw')throw new Error('관측 통지 실패');return mode!=='no-ack';};let thrown:unknown;
    try{withSqliteDiagnostics(trace,()=>retryLedgerOpen(trace,'reward-open',true,create,wait,notify));}catch(error){thrown=error;}expect(thrown===original).toBe(true);expect(create).toHaveBeenCalledTimes(1);expect(wait).toHaveBeenCalledTimes(mode==='wait-throw'?1:0);expect(trace.constructorAttempts[0].retryScheduled).toBe(false);
  });
  it('실제 생성자 BUSY5 신호→부모 해제 뒤 같은worker 복구·소비/적용은1회',async({task})=>{
    const trace=task.meta.ledgerDiagnostic=createTrace('reward-parallel');const f=step(trace,'prepare',()=>{const f=setup();f.reward.close();f.round.close();return f;});const lock=db(f.rewardPath),beforeRound=JSON.parse(String(db(f.roundPath).prepare('SELECT state_json FROM round_rounds WHERE round_id=?').get(context.roundId)?.state_json));
    lock.exec('BEGIN IMMEDIATE');const shared=new SharedArrayBuffer(4),gate=new Int32Array(shared);let signals=0;
    const results=await asyncStep(trace,'workers',()=>parallel([input(f,'apply',{retryConstructorBusy:true,notifyConstructorBusy:true,constructorReleaseGate:shared})],trace,()=>{signals++;lock.exec('ROLLBACK');Atomics.store(gate,0,1);Atomics.notify(gate,0);}));
    expect(signals).toBe(1);expect(results[0].kind,safeRows(trace)).toBe('reward-result');expect(results[0].applied,safeRows(trace)).toBe(true);expect(results[0].snapshot.state.moves).toBe(5);
    const diagnostic=trace.workers[0].diagnostic!;expect(diagnostic.constructorAttempts).toHaveLength(2);expect(diagnostic.constructorAttempts.map(row=>row.waitMs)).toEqual([25,0]);expect(diagnostic.errorPhase).toBeNull();
    expect(diagnostic.steps.filter(row=>row.phase==='redeem')).toHaveLength(1);expect(diagnostic.steps.filter(row=>row.phase==='apply')).toHaveLength(1);expect(diagnostic.sqliteErrors.every(row=>row.extendedCode===5&&row.baseCode===5&&row.transactionActive===false&&row.connectionClosed===true)).toBe(true);
    expect(db(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_redemptions').get()?.n).toBe(1);const roundDb=db(f.roundPath);expect(roundDb.prepare('SELECT count(*) AS n FROM round_rewards').get()?.n).toBe(1);expect(roundDb.prepare("SELECT count(*) AS n FROM round_ops WHERE outcome='reward-applied'").get()?.n).toBe(1);
    expect(isDeepStrictEqual(JSON.parse(String(roundDb.prepare('SELECT state_json FROM round_rounds WHERE round_id=?').get(context.roundId)?.state_json)),{...beforeRound,moves:5,status:'active'}),safeRows(trace)).toBe(true);
  });
  it('실제 생성자 잠금 유지 시3회 소진·소비/적용/행 변화 없음',async({task})=>{
    const trace=task.meta.ledgerDiagnostic=createTrace('reward-parallel');const f=step(trace,'prepare',()=>{const f=setup();f.reward.close();f.round.close();return f;}),lock=db(f.rewardPath),before=dump(lock),roundDb=db(f.roundPath),beforeRound=dump(roundDb);lock.exec('BEGIN IMMEDIATE');
    let results:any[];try{results=await asyncStep(trace,'workers',()=>parallel([input(f,'apply',{retryConstructorBusy:true})],trace));}finally{lock.exec('ROLLBACK');}
    expect(results![0].kind,safeRows(trace)).toBe('worker-error');const diagnostic=trace.workers[0].diagnostic!;expect(diagnostic.constructorAttempts).toHaveLength(3);expect(diagnostic.constructorAttempts.map(row=>row.waitMs)).toEqual([25,25,0]);expect(diagnostic.constructorAttempts.every(row=>row.closeSucceeded&&row.closeHookRestored&&!row.opened)).toBe(true);
    expect(diagnostic.errorPhase).toBe('reward-open');expect(diagnostic.steps.some(row=>row.phase==='redeem'||row.phase==='apply')).toBe(false);expect(isDeepStrictEqual(dump(lock),before),safeRows(trace)).toBe(true);expect(isDeepStrictEqual(dump(roundDb),beforeRound),safeRows(trace)).toBe(true);
  });
  it('실제 무결성 오류는 생성1회·대기/소비/적용 없이 보존',async({task})=>{
    const trace=task.meta.ledgerDiagnostic=createTrace('reward-parallel');const f=step(trace,'prepare',()=>{const f=setup();f.reward.close();f.round.close();return f;}),storage=db(f.rewardPath);storage.exec('ALTER TABLE reward_redemptions ADD COLUMN unexpected TEXT');const before=dump(storage);
    const results=await asyncStep(trace,'workers',()=>parallel([input(f,'apply',{retryConstructorBusy:true})],trace));expect(results[0].kind,safeRows(trace)).toBe('worker-error');const diagnostic=trace.workers[0].diagnostic!;expect(diagnostic.constructorAttempts).toHaveLength(1);expect(diagnostic.constructorAttempts[0].waitMs).toBe(0);expect(diagnostic.steps.some(row=>row.phase==='redeem'||row.phase==='apply')).toBe(false);expect(isDeepStrictEqual(dump(storage),before),safeRows(trace)).toBe(true);
  });
});

describe('실제 보상권 영구 소비·런타임 권한',()=>{
  it('실제 v1 보상권만 소비·불투명 ID/참조·재시작 동일 ID·신규1회',()=>{
    const f=setup(),a=redeem(f.reward),b=redeem(f.reward);expect(a.consumed).toBe(true);expect(b.consumed).toBe(false);expect(a.grant).not.toBe(b.grant);expect(a.grant).toEqual(b.grant);expect(Object.keys(a.grant)).toEqual(['opaqueGrantId']);expect(a.grant.opaqueGrantId).toMatch(/^[a-f0-9]{64}$/);
    expect(readRedeemedGrant(a.grant,context,'test')).toEqual(a.grant);f.reward.close();expect(redeem(reward(f.rewardPath)).grant).toEqual(a.grant);expect(db(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_redemptions').get()?.n).toBe(1);
  });
  it.each(['json','spread','string','verified','empty','null','proxy','prototype'])('위조/직렬화/복사 %s는 권한이 아님',mode=>{
    const f=setup(),g=redeem(f.reward).grant;const fake:Record<string,unknown>={json:JSON.parse(JSON.stringify(g)),spread:{...g},string:g.opaqueGrantId,verified:{verified:true,...g},empty:{},null:null,proxy:new Proxy(g,{}),prototype:Object.create(g)};
    expect(readRedeemedGrant(fake[mode],context,'test')).toBeUndefined();expect(f.round.applyReward(owner,request,fake[mode])).toEqual(denied('invalid-grant'));expect(f.round.rewardEligibility(owner,request).kind).toBe('reward-eligible');
  });
  it.each(['owner','round','environment'])('진짜 참조여도 다른 %s 거절',mode=>{const f=setup(),g=redeem(f.reward).grant,c={...context};if(mode==='owner')c.ownerId='other';if(mode==='round')c.roundId=fixture.rounds.active.roundId;expect(readRedeemedGrant(g,c,mode==='environment'?'production':'test')).toBeUndefined();});
  it.each([null,{},'x',{ownerId:'',roundId:context.roundId},{...context,extra:true},Object.assign(Object.create({}),context)])('잘못된 신뢰 context %j 거절',c=>{const f=setup();expect(f.reward.redeemVoucher(c as any)).toEqual(denied('invalid-input'));});
  it('getter/proxy는 실행·예외 노출 없이 거절',()=>{const f=setup(),get=vi.fn(()=>{throw new Error('비공개');}),c={get ownerId(){return get();},roundId:context.roundId};expect(f.reward.redeemVoucher(c)).toEqual(denied('invalid-input'));expect(get).not.toHaveBeenCalled();expect(readRedeemedGrant(redeem(f.reward).grant,new Proxy(context,{getPrototypeOf(){throw new Error('비공개');}}),'test')).toBeUndefined();});
  it('미발급/다른 owner·round·pending에는 보상권 없음',()=>{const f=setup();for(const c of [{...context,ownerId:'other'},{...context,roundId:'missing'},{...context,roundId:'pending-v1'}])expect(f.reward.redeemVoucher(c)).toEqual(denied('voucher-missing'));});
  it('close 전 소비는 새 소비 차단·기존 영구 소비는 close/원장close 뒤 복구 가능',()=>{
    const a=setup();a.reward.closeRound(context);expect(a.reward.redeemVoucher(context)).toEqual(denied('round-closed'));
    const f=setup(),g=redeem(f.reward).grant;f.reward.closeRound(context);expect(redeem(f.reward)).toEqual({kind:'voucher-redeemed',consumed:false,grant:g});f.reward.close();expect(readRedeemedGrant(g,context,'test')).toEqual(g);expect(apply(f.round,g).applied).toBe(true);
  });
  it('claim TTL은 새 소비 기한이 아니며 이미 기록한 보상권은 보존',()=>{const f=setup();f.reward.close();const l=reward(f.rewardPath,{dependencies:{now:()=>epoch+1_200_001,transport:async()=>keyResponse()}});expect(redeem(l).consumed).toBe(true);});
  it('8worker 동시 소비는 영구1회·같은 ID·전달된 복사본에는 런타임 권한 없음',async({task})=>{const trace=task.meta.ledgerDiagnostic=createTrace('reward-parallel');const f=step(trace,'prepare',()=>{const f=setup();f.reward.close();return f;});const results=await asyncStep(trace,'workers',()=>parallel(Array.from({length:8},()=>input(f,'redeem',{retryConstructorBusy:true})),trace));expect(results.every(r=>r.kind==='voucher-redeemed'),safeRows(trace)).toBe(true);expect(results.filter(r=>r.consumed).length,safeRows(trace)).toBe(1);expect(new Set(results.map(r=>r.grant.opaqueGrantId)).size,safeRows(trace)).toBe(1);expect(readRedeemedGrant(results[0].grant,context,'test')).toBeUndefined();expect(trace.workers.every(row=>row.diagnostic?.resultPhase==='redeem')).toBe(true);});
});

describe('실패 회차 이동+5·원자 기록·중복 복구',()=>{
  it('실패0만 +5/active/revision·보드/RNG/경제/셔플 불변·후속 이동 후 중복 현재 snapshot',()=>{
    const f=setup(),d=db(f.roundPath),before=JSON.parse(String(d.prepare('SELECT state_json FROM round_rounds WHERE round_id=?').get(context.roundId)?.state_json));expect(f.round.rewardEligibility(owner,request)).toEqual({kind:'reward-eligible',snapshot:failed});
    const g=redeem(f.reward).grant,result=apply(f.round,g),after=JSON.parse(String(d.prepare('SELECT state_json FROM round_rounds WHERE round_id=?').get(context.roundId)?.state_json));expect(result.snapshot).toEqual({...failed,revision:failed.revision+1,state:{...failed.state,moves:5,status:'active'}});expect(after).toEqual({...before,moves:5,status:'active'});
    const next=move(f.round,result.snapshot).snapshot;expect(next.state.moves).toBe(4);expect(apply(f.round,g)).toEqual({kind:'reward-result',applied:false,snapshot:next});expect(f.round.rewardEligibility(owner,request)).toEqual(denied('reward-used'));
    expect(d.prepare('SELECT count(*) AS n FROM round_rewards').get()?.n).toBe(1);expect(d.prepare("SELECT count(*) AS n FROM round_ops WHERE outcome='reward-applied'").get()?.n).toBe(1);
  });
  it('유효 특수 탭 차감도 +5 영수증 불변 조건과 함께 복원',()=>{const f=setup(),s=apply(f.round,redeem(f.reward).grant).snapshot,next=move(f.round,s,true);expect(next.outcome).toBe('valid-activation');expect(next.snapshot.state.moves).toBe(4);f.round.close();expect(round(f.roundPath).get(owner,request)).toEqual({kind:'round-snapshot',snapshot:next.snapshot});});
  it.each(['active','won','abandoned'])('%s 회차는 자격/적용 거절',async status=>{
    const f=setup(),s=fixture.rounds[status],c={...owner,roundId:s.roundId},l=reward(),claim=l.issueClaim(c,policy.adUnits[0]);if(claim.kind!=='claim-issued')throw new Error();await l.processCallback(callback({custom_data:claim.customData,user_id:claim.userId}));const g=redeem(l,c).grant;
    expect(f.round.rewardEligibility(owner,{roundId:s.roundId})).toEqual(denied('round-terminal'));expect(f.round.applyReward(owner,{roundId:s.roundId},g)).toEqual(denied('round-terminal'));
  });
  it('같은 회차 다른 실제 grant는 거절·이전 grant로만 재시도',async()=>{const f=setup(),first=redeem(f.reward).grant;apply(f.round,first);const l=reward(),c=l.issueClaim(context,policy.adUnits[0]);if(c.kind!=='claim-issued')throw new Error();await l.processCallback(callback({custom_data:c.customData,user_id:c.userId,transaction_id:'dead'.repeat(8)}));const g=redeem(l).grant;expect(g.opaqueGrantId).not.toBe(first.opaqueGrantId);expect(f.round.applyReward(owner,request,g)).toEqual(denied('reward-used'));});
  it('일반 command의 reward 타입/외부 grant/추가 필드는 권한 생성 불가',()=>{const f=setup(),g=redeem(f.reward).grant;for(const c of [{type:'reward'},{type:'reward-applied'},{type:'applyReward',grant:g},{type:'swap',grant:g}])expect(f.round.command(owner,{roundId:context.roundId,operationId:'fake',expectedRevision:failed.revision,command:c as any})).toEqual(denied('invalid-input'));expect(f.round.applyReward(owner,{...request,grant:g} as any,g)).toEqual(denied('invalid-input'));});
  it('타owner/회차/env 적용은 실제 참조여도 거절',()=>{const f=setup(),g=redeem(f.reward).grant;expect(f.round.applyReward({ownerId:'other'},request,g)).toEqual(denied('invalid-grant'));expect(f.round.applyReward(owner,{roundId:fixture.rounds.active.roundId},g)).toEqual(denied('invalid-grant'));expect(round(undefined,{environment:'production'}).applyReward(owner,request,g)).toEqual(denied('invalid-grant'));});
  it('소비→적용 전 별도 프로세스 종료 후 같은 ID로 복구',async()=>{const f=setup();f.reward.close();f.round.close();const lost=await child(input(f,'consume-stop'));expect(lost.kind).toBe('consumed');const l=reward(f.rewardPath),g=redeem(l);expect(g.consumed).toBe(false);expect(g.grant.opaqueGrantId).toBe(lost.opaqueGrantId);expect(apply(round(f.roundPath),g.grant).applied).toBe(true);});
  it('적용→응답 전 종료·재시작·후속 이동 뒤 별도 프로세스 재전송',async()=>{const f=setup();f.reward.close();f.round.close();expect(await child(input(f,'apply-stop'))).toEqual({kind:'applied-response-lost'});const l=round(f.roundPath),read=l.get(owner,request);if(read.kind!=='round-snapshot')throw new Error();const next=move(l,read.snapshot).snapshot;l.close();expect(await child(input(f))).toEqual({kind:'reward-result',applied:false,snapshot:next});});
  it('8worker 소비+적용 동시 실행은 이동5/적용1회·보상행1·영수증1',async({task})=>{const trace=task.meta.ledgerDiagnostic=createTrace('reward-parallel');const f=step(trace,'prepare',()=>{const f=setup();f.reward.close();f.round.close();return f;});const results=await asyncStep(trace,'workers',()=>parallel(Array.from({length:8},()=>input(f,'apply',{retryConstructorBusy:true})),trace));expect(results.every(r=>r.kind==='reward-result'),safeRows(trace)).toBe(true);expect(results.filter(r=>r.applied).length,safeRows(trace)).toBe(1);expect(results.every(r=>r.snapshot.state.moves===5&&r.snapshot.revision===failed.revision+1),safeRows(trace)).toBe(true);expect(trace.workers.every(row=>row.diagnostic?.resultPhase==='apply')).toBe(true);});
  it.for([0,1,2])('남은 전체 행수 %s: 보상행+영수증 두 행을 정확히 예약',(space,{task})=>{
    const trace=task.meta.ledgerDiagnostic=createTrace('reward-capacity');trace.caseIndex=space;
    return withSqliteDiagnostics(trace,()=>{
      const {p,d,n}=step(trace,'fixture',()=>{const p=path('round'),d=load(p,fixture.round),n=Number(d.prepare('SELECT (SELECT count(*) FROM round_rounds)+(SELECT count(*) FROM round_ops) AS n').get()?.n);return {p,d,n};});
      step(trace,'reprofile',()=>{const m:any=d.prepare('SELECT * FROM round_meta').get();const profile=JSON.parse(m.profile);profile.rows=n+space;m.profile=JSON.stringify(profile);d.prepare('UPDATE round_meta SET profile=?,meta_mac=?').run(m.profile,roundMac('meta',JSON.stringify([m.profile,m.high_water])));for(const r of d.prepare('SELECT * FROM round_rounds').all() as any[])d.prepare('UPDATE round_rounds SET state_mac=? WHERE round_id=?').run(roundMac('state',JSON.stringify([m.profile,r.round_id,r.owner_hash,r.create_hash,r.create_digest,r.created_at,r.expires_at,r.revision,r.state_json])),r.round_id);for(const r of d.prepare('SELECT * FROM round_ops').all() as any[])d.prepare('UPDATE round_ops SET receipt_mac=? WHERE round_id=? AND op_hash=?').run(roundMac('receipt',JSON.stringify([m.profile,r.round_id,r.op_hash,r.request_digest,r.revision,r.outcome])),r.round_id,r.op_hash);});
      const l=step(trace,'round-open',()=>round(p,{maxRows:n+space})),f=step(trace,'prepare',()=>setup()),g=step(trace,'redeem',()=>redeem(f.reward).grant);
      step(trace,'eligibility',()=>{expect(l.rewardEligibility(owner,request).kind).toBe(space<2?'rejected':'reward-eligible');});
      step(trace,'apply',()=>{expect(l.applyReward(owner,request,g)).toMatchObject(space<2?denied('capacity'):{kind:'reward-result',applied:true});});
    });
  });
  it('만료 경계는 자격·새 적용·이미 적용한 중복도 차단',()=>{const f=setup(),g=redeem(f.reward).grant;apply(f.round,g);f.round.close();const l=round(f.roundPath,{now:()=>failed.expiresAt});expect(l.rewardEligibility(owner,request)).toEqual(denied('expired'));expect(l.applyReward(owner,request,g)).toEqual(denied('expired'));});
  it('소비 후 abandon은 적용 차단·소비 기록은 보존',()=>{const f=setup(),g=redeem(f.reward).grant;expect(f.round.command(owner,{roundId:context.roundId,operationId:'abandon-after-consume',expectedRevision:failed.revision,command:{type:'abandon'}}).kind).toBe('command-result');expect(f.round.applyReward(owner,request,g)).toEqual(denied('round-terminal'));expect(redeem(f.reward).consumed).toBe(false);});
});

describe('쓰기 실패·무결성·비노출·v1 파일 이전',()=>{
  it('실제 구엔진 profile DB는 자동 이전/재서명 없이 거절하고 모든 원본 행을 보존합니다',()=>{
    const p=path('legacy-round'),d=load(p,legacyFixture.round),before=dump(d);
    expect(()=>round(p)).toThrow('round-ledger-open-failed');expect(dump(d)).toEqual(before);
    expect(JSON.parse(String(d.prepare('SELECT profile FROM round_meta').get()?.profile)).engine).toBe('pawblossom-board-v1');
  });
  it('실제 옛 square V2 profile DB도 자동 재서명 없이 거절하고 4DDL·행을 보존합니다',()=>{
    const source=JSON.parse(readFileSync(new URL('./helpers/ledger-square-v2-baseline.json',import.meta.url),'utf8'));
    expect(source.engineLfSha256).toBe('c02c8278090d332b3d56f05636158d360947d55e8ef84cddff20aa81c7fd3778');
    const p=path('square-v2-round'),d=load(p,source.round),before=dump(d);
    expect(()=>round(p)).toThrow('round-ledger-open-failed');expect(dump(d)).toEqual(before);
  });
  it.each([0,1])('작업 한도 남음 %s: 보상도 revision 한 번·중복은 소모하지 않음',space=>{
    const p=path('round'),d=load(p,fixture.round),limit=failed.revision+space;reprofile(d,{operations:limit});const l=round(p,{maxOperations:limit}),f=setup(),g=redeem(f.reward).grant;
    expect(l.rewardEligibility(owner,request)).toMatchObject(space?{kind:'reward-eligible'}:denied('operation-limit'));
    expect(l.applyReward(owner,request,g)).toMatchObject(space?{kind:'reward-result',applied:true}:denied('operation-limit'));
    if(space)expect(l.applyReward(owner,request,g)).toMatchObject({kind:'reward-result',applied:false});
  });
  it.each([NaN,0,epoch-1,10_000_000_000_000])('비정상/후퇴 시계 %s는 소비·적용·자격 모두 거절',now=>{
    const f=setup(),g=redeem(f.reward).grant;f.reward.close();f.round.close();const r=reward(f.rewardPath,{dependencies:{now:()=>now,transport:async()=>keyResponse()}}),l=round(f.roundPath,{now:()=>now});
    expect(r.redeemVoucher(context)).toEqual(denied('invalid-time'));expect(l.rewardEligibility(owner,request)).toEqual(denied('invalid-time'));expect(l.applyReward(owner,request,g)).toEqual(denied('invalid-time'));
  });
  it('closed API·이미 발급한 capability 수명·호출자 키 보존',()=>{
    const f=setup(),g=redeem(f.reward).grant;f.reward.close();f.round.close();expect(f.reward.redeemVoucher(context)).toEqual(unavailable);expect(f.round.rewardEligibility(owner,request)).toEqual(unavailable);expect(f.round.applyReward(owner,request,g)).toEqual(unavailable);expect(readRedeemedGrant(g,context,'test')).toEqual(g);expect([...roundKey].every(n=>n===67)).toBe(true);expect([...rewardKey].every(n=>n===71)).toBe(true);
  });
  it.each(['close','open-failure'])('복제 키는 %s에서 0으로 지움·호출자 키 불변',mode=>{
    const original=Buffer.prototype.fill,wiped:Buffer[]=[];vi.spyOn(Buffer.prototype,'fill').mockImplementation(function(this:Buffer,value:any,...rest:any[]){const result=Reflect.apply(original,this,[value,...rest]);if(value===0&&this.length===32)wiped.push(this);return result;} as any);
    if(mode==='close'){const f=setup();f.reward.close();f.round.close();}else {const p=path('bad');db(p).exec('CREATE TABLE wrong(id INTEGER)');expect(()=>reward(p)).toThrow();expect(()=>round(p)).toThrow();}
    expect(wiped.length).toBeGreaterThanOrEqual(9);expect(wiped.every(b=>b.every(n=>n===0))).toBe(true);expect(roundKey[0]).toBe(67);expect(rewardKey[0]).toBe(71);
  });
  it.each([10000,10001])('v1 전체행 %s의 상한은 migration 전에 검사·초과 DB는 v1 보존',size=>{
    const p=path('reward'),d=load(p,fixture.reward),n=Number(d.prepare('SELECT (SELECT count(*) FROM reward_rounds)+(SELECT count(*) FROM reward_claims)+(SELECT count(*) FROM reward_vouchers) AS n').get()?.n);d.exec('BEGIN');for(let i=n;i<size;i++)d.prepare('INSERT INTO reward_rounds VALUES(?,?,0,0)').run(createHash('sha256').update('round-'+i).digest('hex'),'b'.repeat(64));d.exec('COMMIT');
    if(size===10001){expect(()=>reward(p)).toThrow('reward-ledger-open-failed');expect(JSON.parse(String(d.prepare('SELECT profile FROM reward_meta').get()?.profile)).version).toBe(1);expect(d.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='reward_auth'").get()?.n).toBe(0);}
    else {const l=reward(p),before=dump(d);expect(l.redeemVoucher(context)).toEqual(unavailable);expect(dump(d)).toEqual(before);expect(l.closeRound({...context,roundId:'closed-v1'})).toEqual({kind:'round-closed'});}
  });
  it('실제 production 권한은 test 회차에서 거절·환경별 안정 ID 분리',async()=>{
    const f=setup(),testGrant=redeem(f.reward).grant,l=reward(undefined,{policy:{...policy,environment:'production'}}),c=l.issueClaim(context,policy.adUnits[0]);if(c.kind!=='claim-issued')throw new Error();await l.processCallback(callback({custom_data:c.customData,user_id:c.userId}));const g=redeem(l).grant;expect(g.opaqueGrantId).not.toBe(testGrant.opaqueGrantId);expect(readRedeemedGrant(g,context,'production')).toEqual(g);expect(f.round.applyReward(owner,request,g)).toEqual(denied('invalid-grant'));
  });
  it('타인 회차 손상은 SQL 소유자 필터로 not-found·자기 회차 조회를 닫지 않음',async()=>{
    const f=setup(),other={ownerId:'other-owner'},c={...other,roundId:context.roundId},l=reward(),issued=l.issueClaim(c,policy.adUnits[0]);if(issued.kind!=='claim-issued')throw new Error();await l.processCallback(callback({custom_data:issued.customData,user_id:issued.userId}));const grant=redeem(l,c).grant;db(f.roundPath).prepare('UPDATE round_rounds SET state_mac=? WHERE round_id=?').run('a'.repeat(64),context.roundId);expect(f.round.rewardEligibility(other,request)).toEqual(denied('not-found'));expect(f.round.applyReward(other,request,grant)).toEqual(denied('not-found'));expect(f.round.get(owner,{roundId:fixture.rounds.active.roundId}).kind).toBe('round-snapshot');
  });
  it.each(['reward','round'])('%s COMMIT 읽기 잠금은 전체 rollback·소비/적용 재시도 보존',mode=>{const f=setup(),g=mode==='round'?redeem(f.reward).grant:undefined,d=db(mode==='reward'?f.rewardPath:f.roundPath),before=dump(d);d.exec('BEGIN');d.prepare('SELECT * FROM '+(mode==='reward'?'reward_meta':'round_meta')).all();const result=mode==='reward'?f.reward.redeemVoucher(context):f.round.applyReward(owner,request,g);expect(result).toEqual(unavailable);d.exec('ROLLBACK');expect(dump(d)).toEqual(before);if(mode==='reward')expect(redeem(f.reward).consumed).toBe(true);else expect(apply(f.round,g!).applied).toBe(true);});
  it.each(['reward','round'])('%s BEGIN 잠금은 성공으로 숨기지 않고 해제 뒤 복구',mode=>{const f=setup(),g=redeem(f.reward).grant,d=db(mode==='reward'?f.rewardPath:f.roundPath);d.exec('BEGIN IMMEDIATE');expect(mode==='reward'?f.reward.redeemVoucher(context):f.round.applyReward(owner,request,g)).toEqual(unavailable);d.exec('ROLLBACK');expect(apply(f.round,redeem(f.reward).grant).applied).toBe(true);});
  it.each(['grant','time','owner','claim','voucher','meta','auth','schema','trigger'])('보상 %s 변조는 소비 권한을 만들지 못함',mode=>{const f=setup();redeem(f.reward);const d=db(f.rewardPath);if(mode==='grant')d.prepare('UPDATE reward_redemptions SET grant_id=?').run('a'.repeat(64));if(mode==='time')d.exec('UPDATE reward_redemptions SET redeemed_at=redeemed_at+1');if(mode==='owner')d.prepare('UPDATE reward_rounds SET owner_hash=?').run('a'.repeat(64));if(mode==='claim')d.exec('UPDATE reward_claims SET expires_at=expires_at+1');if(mode==='voucher')d.exec('UPDATE reward_vouchers SET recorded_at=recorded_at+1');if(mode==='meta')d.exec('UPDATE reward_meta SET high_water=0');if(mode==='auth')d.prepare('UPDATE reward_auth SET state_mac=?').run('a'.repeat(64));if(mode==='schema')d.exec('ALTER TABLE reward_redemptions ADD COLUMN unexpected TEXT');if(mode==='trigger')d.exec('CREATE TRIGGER malicious AFTER UPDATE ON reward_meta BEGIN UPDATE reward_rounds SET closed=0; END');expect(f.reward.redeemVoucher(context)).toEqual(unavailable);});
  it.each(['grant','revision','mac','missing','receipt'])('회차 보상 %s 변조는 중복/추가 이동 위조 불가',mode=>{const f=setup(),g=redeem(f.reward).grant;apply(f.round,g);const d=db(f.roundPath);if(mode==='grant')d.prepare('UPDATE round_rewards SET grant_id=?').run('a'.repeat(64));if(mode==='revision')d.exec('UPDATE round_rewards SET revision=1');if(mode==='mac')d.prepare('UPDATE round_rewards SET reward_mac=?').run('a'.repeat(64));if(mode==='missing')d.exec('DELETE FROM round_rewards');if(mode==='receipt')d.prepare("UPDATE round_ops SET outcome='invalid-swap' WHERE outcome='reward-applied'").run();expect(f.round.applyReward(owner,request,g)).toEqual(unavailable);});
  it.each(['round','reward'])('현재 엔진 합성 schema1 회차/정적 v1 보상의 %s 이전·reopen 보존',mode=>{const p=path(mode),d=load(p,mode==='round'?currentFixture.schema1:fixture.reward),before=dump(d),l=mode==='round'?round(p):reward(p),after=dump(d);expect(JSON.parse(String(d.prepare('SELECT profile FROM '+mode+'_meta').get()?.profile)).version).toBe(2);expect(after.length).toBe(before.length+(mode==='round'?1:2));if(mode==='round')for(const s of Object.values(fixture.rounds) as RoundSnapshot[])expect((l as RoundLedger).get(owner,{roundId:s.roundId})).toEqual({kind:'round-snapshot',snapshot:s});else expect((l as RewardLedger).hasVoucher(context)).toEqual({kind:'voucher-status',present:true});l.close();expect(()=>mode==='round'?round(p):reward(p)).not.toThrow();});
  it.each(['round','reward'])('v1 %s migration COMMIT 실패는 DDL/profile/행까지 원자 rollback',mode=>{const p=path(mode),d=load(p,mode==='round'?currentFixture.schema1:fixture.reward),before=dump(d);d.exec('BEGIN');d.prepare('SELECT * FROM '+mode+'_meta').all();expect(()=>mode==='round'?round(p):reward(p)).toThrow(mode+'-ledger-open-failed');d.exec('ROLLBACK');expect(dump(d)).toEqual(before);expect(()=>mode==='round'?round(p):reward(p)).not.toThrow();});
  it.each(['key','environment','profile','state','receipt','schema','extra','mixed'])('구 회차 %s 오류는 이전 전 거절·DB 보존',mode=>{const p=path('round'),d=load(p,currentFixture.schema1);let patch:Partial<RoundLedgerOptions>={};if(mode==='key')patch={serverKey:new Uint8Array(32).fill(68)};if(mode==='environment')patch={environment:'production'};if(mode==='profile')d.exec("UPDATE round_meta SET profile=replace(profile,'pawblossom-board-crates-v2','other')");if(mode==='state')d.prepare('UPDATE round_rounds SET state_mac=?').run('a'.repeat(64));if(mode==='receipt')d.prepare('UPDATE round_ops SET receipt_mac=?').run('a'.repeat(64));if(mode==='schema')d.exec('ALTER TABLE round_ops ADD COLUMN extra TEXT');if(mode==='extra')d.exec('CREATE TABLE unknown(id INTEGER)');if(mode==='mixed')d.exec('CREATE TABLE round_rewards(id INTEGER)');const before=dump(d);expect(()=>round(p,patch)).toThrow('round-ledger-open-failed');expect(dump(d)).toEqual(before);});
  it.each(['key','environment','policy','meta','claim','voucher','schema','mixed'])('구 보상 %s 오류는 이전 전 거절·DB 보존',mode=>{const p=path('reward'),d=load(p,fixture.reward);let patch:Partial<RewardLedgerOptions>={};if(mode==='key')patch={serverKey:new Uint8Array(32).fill(72)};if(mode==='environment')patch={policy:{...policy,environment:'production'}};if(mode==='policy')patch={policy:{...policy,adUnits:['9']}};if(mode==='meta')d.exec('UPDATE reward_meta SET high_water=0');if(mode==='claim')d.exec('UPDATE reward_claims SET expires_at=expires_at+1');if(mode==='voucher')d.exec('UPDATE reward_vouchers SET recorded_at=recorded_at+1');if(mode==='schema')d.exec('ALTER TABLE reward_vouchers ADD COLUMN extra TEXT');if(mode==='mixed')d.exec('CREATE TABLE reward_redemptions(id INTEGER)');const before=dump(d);expect(()=>reward(p,patch)).toThrow('reward-ledger-open-failed');expect(dump(d)).toEqual(before);});
  it('수신함 target 경로/키 binding은 v1 보상 이전 뒤에도 동일·재수신 처리 호환',async()=>{const rewardPath=path('reward'),inboxPath=path('inbox'),options={databasePath:inboxPath,encryptionKey:new Uint8Array(32).fill(79),policy,now:()=>epoch,rewardLedger:{databasePath:rewardPath,serverKey:rewardKey,dependencies:{now:()=>epoch,transport:async()=>keyResponse()}}};let b=new CallbackInbox(options);b.close();const d=db(rewardPath);d.exec('DROP TABLE reward_auth; DROP TABLE reward_redemptions; DROP TABLE reward_vouchers; DROP TABLE reward_claims; DROP TABLE reward_rounds; DROP TABLE reward_meta');for(const t of fixture.reward)d.exec(t.sql);for(const t of fixture.reward)for(const r of t.rows)d.prepare('INSERT INTO '+t.name+' VALUES('+Object.keys(r).map(()=>'?').join()+')').run(...Object.values(r) as any[]);b=new CallbackInbox(options);resources.push(b);const l=reward(rewardPath),c=l.issueClaim({...context,roundId:'inbox-after-migration'},policy.adUnits[0]);if(c.kind!=='claim-issued')throw new Error();expect(b.receive(callback({custom_data:c.customData,user_id:c.userId,transaction_id:'1234'.repeat(8)})).kind).toBe('accepted');expect(await b.processNext()).toEqual({kind:'completed'});expect(l.hasVoucher({...context,roundId:'inbox-after-migration'})).toEqual({kind:'voucher-status',present:true});});
  it('DB·일반 결과·로그에 owner/원문nonce/SSV서명/키 추가 노출 없음',()=>{const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')],f=setup(),g=redeem(f.reward),result=apply(f.round,g.grant);f.reward.close();f.round.close();const bytes=[f.rewardPath,f.roundPath].flatMap(p=>readdirSync(join(p,'..')).map(n=>readFileSync(join(p,'..',n))));for(const secret of [owner.ownerId,Buffer.from(roundKey).toString('hex'),Buffer.from(rewardKey).toString('hex')]){expect(JSON.stringify([g,result])).not.toContain(secret);bytes.forEach(b=>expect(b.includes(Buffer.from(secret))).toBe(false));}logs.forEach(l=>expect(l).not.toHaveBeenCalled());});
});
