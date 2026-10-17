import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,linkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {GameService,type GameServiceOptions} from '../server/game/gameService';
import {PlayFabSessionAuthenticator,type PlayFabSessionResult} from '../server/auth/playfabSession';
import {RoundLedger,type RoundSnapshot} from '../server/game/roundLedger';
import {RewardLedger} from '../server/ads/rewardLedger';
import {CallbackInbox} from '../server/ads/callbackInbox';
import {BoardEngine} from '../src/core/BoardEngine';
import {callback,epoch,keyResponse,policy} from './helpers/ssvFixture';

// 이전 원장의 실제 서명 fixture에 합성 인증 owner만 재서명합니다. 실제 계정/키/통신 없음.
const fixture=JSON.parse(readFileSync(new URL('./helpers/ledger-v1-fixture.json',import.meta.url),'utf8'));
const ticket='synthetic-private-session-ticket',provider='0123456789ABCDEF';
const dirs:string[]=[],resources:{close():void}[]=[];
const denied=(code:string)=>({kind:'rejected',code});
function authResponse(id=provider){return new Response(JSON.stringify({code:200,status:'OK',data:{IsSessionTicketExpired:false,UserInfo:{PlayFabId:id}}}),{headers:{'content-type':'application/json'}});}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
function mac(key:Uint8Array,domain:string,text:string){return createHmac('sha256',createHmac('sha256',key).update('pawblossom-round-v1\0'+domain).digest()).update(text).digest('hex');}
function seedRound(path:string,key:Uint8Array,ownerId:string){
  const d=new DatabaseSync(path,{enableForeignKeyConstraints:false});try{
    d.exec('BEGIN');
    for(const table of fixture.round)d.exec(table.sql);
    for(const table of fixture.round)for(const row of table.rows)d.prepare('INSERT INTO '+table.name+' VALUES('+Object.keys(row).map(()=>'?').join()+')').run(...Object.values(row) as any[]);
    const profile=d.prepare('SELECT profile FROM round_meta').get()!.profile;
    for(const row of d.prepare('SELECT * FROM round_rounds').all() as any[]){
      row.owner_hash=mac(key,'owner',ownerId);
      row.state_mac=mac(key,'state',JSON.stringify([profile,row.round_id,row.owner_hash,row.create_hash,row.create_digest,row.created_at,row.expires_at,row.revision,row.state_json]));
      d.prepare('UPDATE round_rounds SET owner_hash=?,state_mac=? WHERE round_id=?').run(row.owner_hash,row.state_mac,row.round_id);
    }
    d.exec('COMMIT');
  }finally{d.close();}
}
function setup(gate:GameServiceOptions['allowRewardClaim']=()=>true){
  const dir=mkdtempSync(join(tmpdir(),'pawblossom-game-service-'));dirs.push(dir);let now=epoch;
  const authKey=new Uint8Array(32).fill(53),roundKey=new Uint8Array(32).fill(67),rewardKey=new Uint8Array(32).fill(71);
  const ownerId=createHmac('sha256',authKey).update(JSON.stringify(['pawblossom-session-v1','pawblossom.example','1A2B3','test','owner',provider])).digest('hex');
  const roundPath=join(dir,'round.sqlite'),rewardPath=join(dir,'reward.sqlite');seedRound(roundPath,roundKey,ownerId);
  const transport=vi.fn<typeof fetch>(async()=>authResponse());
  const options:GameServiceOptions={auth:{titleId:'1A2B3',environment:'test',bindingDomain:'pawblossom.example',bindingKey:authKey,getSecretKey:async()=> 'synthetic-secret'},
    authTransport:transport,round:{databasePath:roundPath,serverKey:roundKey,environment:'test',now:()=>now},
    reward:{databasePath:rewardPath,serverKey:rewardKey,policy:{...policy,adUnits:[...policy.adUnits],adNetworks:[...policy.adNetworks]},dependencies:{now:()=>now,transport:async()=>keyResponse()}},
    rewardAdUnit:policy.adUnits[0],...(gate?{allowRewardClaim:gate}:{})};
  function open(){const service=new GameService(options);resources.push(service);return service;}
  function db<T>(path:string,work:(d:DatabaseSync)=>T):T{const d=new DatabaseSync(path);try{return work(d);}finally{d.close();}}
  function rows(table:string,path=rewardPath){return db(path,d=>Number(d.prepare('SELECT count(*) AS n FROM '+table).get()?.n));}
  async function recordClaim(service:GameService){
    const claim=await service.issueRewardClaim({...input,expectedRevision:failed.revision});if(claim.kind!=='claim-issued')throw new Error('합성 claim 실패');
    const inbox=new CallbackInbox({databasePath:join(dir,'inbox.sqlite'),encryptionKey:new Uint8Array(32).fill(79),policy,
      rewardLedger:options.reward,now:()=>now});resources.push(inbox);
    const raw=callback({custom_data:claim.customData,user_id:claim.userId});expect(inbox.receive(raw).kind).toBe('accepted');
    expect(await inbox.processNext()).toEqual({kind:'completed'});return {claim,inbox,raw};
  }
  return {dir,ownerId,options,transport,open,rows,db,recordClaim,setTime:(v:number)=>now=v};
}
const failed=fixture.rounds.failed as RoundSnapshot,input={sessionTicket:ticket,roundId:failed.roundId};
afterEach(()=>{vi.restoreAllMocks();for(const r of resources.splice(0).reverse())try{r.close();}catch{}
  for(const dir of dirs.splice(0)){if(!dir.startsWith(join(tmpdir(),'pawblossom-game-service-')))throw new Error('정리 경로 오류');rmSync(dir,{recursive:true,force:true});}});

describe('인증된 내부 게임 서비스·실제 원장 통합',()=>{
  it('생성 무통신·매 작업 인증·owner projection·생성/명령 멱등성',async()=>{
    const f=setup(),s=f.open();expect(f.transport).not.toHaveBeenCalled();
    const start=await s.start({sessionTicket:ticket,requestId:'new-game',levelId:1});expect(start.kind).toBe('round-started');if(start.kind!=='round-started')throw new Error();
    expect(await s.start({sessionTicket:ticket,requestId:'new-game',levelId:1})).toEqual({...start,created:false});
    expect(await s.get({...input,roundId:start.snapshot.roundId})).toEqual({kind:'round-snapshot',snapshot:start.snapshot});
    const command={...input,roundId:start.snapshot.roundId,operationId:'shuffle',expectedRevision:0,command:{type:'shuffle' as const}};
    const result=await s.command(command);expect(result).toMatchObject({kind:'command-result',applied:true,outcome:'shuffled'});
    expect(await s.command(command)).toEqual({...result,applied:false});expect(f.transport).toHaveBeenCalledTimes(5);
  });
  it('auth→실패 회차→claim→별도 Inbox SSV→+5→중복/재시작/후속 이동 현재 상태',async()=>{
    const f=setup(),s=f.open();expect(await s.get(input)).toEqual({kind:'round-snapshot',snapshot:failed});
    const {claim,inbox,raw}=await f.recordClaim(s);expect(Object.keys(claim).sort()).toEqual(['kind','customData','userId','expiresAt'].sort());
    const result=await s.applyReward(input);expect(result).toEqual({kind:'reward-result',applied:true,snapshot:{...failed,revision:failed.revision+1,state:{...failed.state,moves:5,status:'active'}}});
    expect(await s.applyReward(input)).toEqual({...result,applied:false});inbox.close();s.close();
    const next=f.open();expect(await next.applyReward(input)).toEqual({...result,applied:false});if(result.kind!=='reward-result')throw new Error();
    const engine=new BoardEngine(8,8,()=>{throw new Error();},result.snapshot.state as any);
    const move=await next.command({...input,operationId:'after-reward',expectedRevision:result.snapshot.revision,command:{type:'swap',...engine.legalMoves()[0]}});
    expect(move).toMatchObject({kind:'command-result',applied:true});if(move.kind!=='command-result')throw new Error();
    expect(move.snapshot.state.moves).toBe(4);expect(await next.applyReward(input)).toEqual({kind:'reward-result',applied:false,snapshot:move.snapshot});
    expect(f.rows('reward_redemptions')).toBe(1);expect(f.rows('round_rewards',f.options.round.databasePath)).toBe(1);
    const reopened=new CallbackInbox({databasePath:join(f.dir,'inbox.sqlite'),encryptionKey:new Uint8Array(32).fill(79),policy,rewardLedger:f.options.reward,now:()=>epoch});resources.push(reopened);
    expect(reopened.receive(raw).kind).toBe('accepted');expect(await reopened.processNext()).toEqual({kind:'idle'});
  });
  it('신규 광고 gate가 바뀌어도 이미 받은 보상은 적용·종료 후 동일 재시도 가능',async()=>{
    let allow=true;const f=setup(()=>allow),s=f.open();await f.recordClaim(s);allow=false;
    const result=await s.applyReward(input);expect(result.kind).toBe('reward-result');if(result.kind!=='reward-result')throw new Error();
    const ended=await s.command({...input,operationId:'end-after-reward',expectedRevision:result.snapshot.revision,command:{type:'abandon'}});
    expect(ended).toMatchObject({kind:'command-result',rewardCleanup:'closed'});if(ended.kind!=='command-result')throw new Error();
    expect(await s.applyReward(input)).toEqual({kind:'reward-result',applied:false,snapshot:ended.snapshot});
  });
  it('보상권 없음을 성공으로 표시하지 않고 소비하지 않음',async()=>{
    const f=setup(),s=f.open();expect(await s.applyReward(input)).toEqual(denied('voucher-missing'));expect(f.rows('reward_redemptions')).toBe(0);
  });
  it('실제 소비 commit 후 적용 실패→서비스 재시작은 같은 소비로 복구',async()=>{
    const f=setup(),s=f.open();await f.recordClaim(s);
    const apply=vi.spyOn(RoundLedger.prototype,'applyReward').mockReturnValueOnce({kind:'service-error',code:'storage-unavailable'});
    expect(await s.applyReward(input)).toEqual({kind:'service-error',code:'storage-unavailable'});expect(f.rows('reward_redemptions')).toBe(1);
    expect(f.rows('round_rewards',f.options.round.databasePath)).toBe(0);s.close();apply.mockRestore();
    expect(await f.open().applyReward(input)).toMatchObject({kind:'reward-result',applied:true,snapshot:{state:{moves:5}}});expect(f.rows('reward_redemptions')).toBe(1);
  });
  it('실제 보상 DB 잠금의 소비 실패를 성공으로 숨기지 않고 재시도',async()=>{
    const f=setup(),s=f.open();await f.recordClaim(s);const d=new DatabaseSync(f.options.reward.databasePath);
    try{d.exec('BEGIN IMMEDIATE');expect(await s.applyReward(input)).toEqual({kind:'service-error',code:'storage-unavailable'});}finally{d.exec('ROLLBACK');d.close();}
    expect(f.rows('reward_redemptions')).toBe(0);expect(await s.applyReward(input)).toMatchObject({kind:'reward-result',applied:true});
  });
  it.each(['active','won','abandoned'] as const)('%s 회차의 최초 소비 거절',async status=>{
    const f=setup(),s=f.open(),redeem=vi.spyOn(RewardLedger.prototype,'redeemVoucher');
    expect(await s.applyReward({...input,roundId:fixture.rounds[status].roundId})).toEqual(denied('round-terminal'));expect(redeem).not.toHaveBeenCalled();
  });
  it('만료와 타 소유자·인증 실패는 소비와 claim 발급을 막음',async()=>{
    const f=setup(),s=f.open();f.transport.mockImplementation(async()=>authResponse('FEDCBA9876543210'));
    expect(await s.get(input)).toEqual(denied('not-found'));expect(await s.applyReward(input)).toEqual(denied('not-found'));
    expect(await s.issueRewardClaim({...input,expectedRevision:failed.revision})).toEqual(denied('not-found'));
    f.transport.mockImplementation(async()=>new Response('',{status:401}));expect(await s.applyReward(input)).toEqual({kind:'session-error',code:'unauthenticated'});
    f.transport.mockImplementation(async()=>authResponse());f.setTime(failed.expiresAt);expect(await s.applyReward(input)).toEqual(denied('expired'));expect(f.rows('reward_redemptions')).toBe(0);
  });
});

describe('신규 광고 발급 정책·엄격한 요청 경계',()=>{
  it.each(['absent','false','throw','promise','reject'])('gate %s는 기본 거절·claim0',async mode=>{
    const gate=mode==='absent'?undefined:mode==='false'?()=>false:mode==='throw'?()=>{throw new Error('비공개 정책');}:()=> (mode==='reject'?Promise.reject(new Error('비공개 정책')):Promise.resolve(true)) as any;
    const f=setup(gate);if(mode==='absent')delete (f.options as any).allowRewardClaim;const s=f.open();expect(await s.issueRewardClaim({...input,expectedRevision:failed.revision})).toEqual(denied('ads-unavailable'));expect(f.rows('reward_claims')).toBe(0);
  });
  it('최신 revision·failed0을 확인하고 고정 서버 adunit만 사용',async()=>{
    const gate=vi.fn<NonNullable<GameServiceOptions['allowRewardClaim']>>(()=>true),f=setup(gate),s=f.open();
    expect(await s.issueRewardClaim({...input,expectedRevision:failed.revision-1})).toEqual(denied('revision-conflict'));expect(gate).not.toHaveBeenCalled();
    expect(await s.issueRewardClaim({...input,roundId:fixture.rounds.active.roundId,expectedRevision:0})).toEqual(denied('round-terminal'));
    expect((await s.issueRewardClaim({...input,expectedRevision:failed.revision})).kind).toBe('claim-issued');
    expect(gate).toHaveBeenCalledWith({ownerId:f.ownerId},failed);expect(Object.isFrozen(gate.mock.calls[0][0])).toBe(true);
    expect(f.db(f.options.reward.databasePath,d=>d.prepare('SELECT ad_unit FROM reward_claims').get()?.ad_unit)).toBe(policy.adUnits[0]);
  });
  it.each(['ownerId','context','board','score','grant','adUnit','consent','age','verified','rawQuery'])('추가 필드 %s를 모든 작업에서 거절',async field=>{
    const f=setup(),s=f.open(),extra={[field]:true};
    expect(await s.start({sessionTicket:ticket,requestId:'x',levelId:1,...extra})).toEqual(denied('invalid-input'));
    expect(await s.get({...input,...extra})).toEqual(denied('invalid-input'));
    expect(await s.command({...input,operationId:'x',expectedRevision:failed.revision,command:{type:'abandon'},...extra})).toEqual(denied('invalid-input'));
    expect(await s.issueRewardClaim({...input,expectedRevision:failed.revision,...extra})).toEqual(denied('invalid-input'));
    expect(await s.applyReward({...input,...extra})).toEqual(denied('invalid-input'));expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([null,[],{},Object.create(input),{...input,[Symbol('extra')]:1},{...input,sessionTicket:''},{...input,roundId:'x'},{...input,signal:{}},new Proxy(input,{ownKeys(){throw new Error('비공개');}})])('잘못된 입력/상속/symbol/proxy 거절 %#',async value=>{
    const f=setup(),s=f.open();expect(await s.get(value as any)).toEqual(denied('invalid-input'));expect(f.transport).not.toHaveBeenCalled();
  });
  it('getter와 중첩 getter를 실행하지 않고 거절',async()=>{
    const f=setup(),s=f.open(),get=vi.fn(()=>ticket),req={get sessionTicket(){return get();},roundId:failed.roundId};
    expect(await s.get(req)).toEqual(denied('invalid-input'));expect(get).not.toHaveBeenCalled();
    expect(await s.command({...input,operationId:'x',expectedRevision:failed.revision,command:{type:'activate',at:{get row(){get();return 0;},col:0}}})).toEqual(denied('invalid-input'));expect(get).not.toHaveBeenCalled();
  });
  it.each([Object.create(AbortSignal.prototype),new Proxy(new AbortController().signal,{})])('위조/Proxy signal은 Promise reject 없이 입력 거절 %#',async signal=>{
    const f=setup(),s=f.open();await expect(s.get({...input,signal})).resolves.toEqual(denied('invalid-input'));expect(f.transport).not.toHaveBeenCalled();
  });
  it('await 전에 ticket/ID/revision/중첩 좌표 snapshot',async()=>{
    const f=setup(),s=f.open(),wait=deferred<PlayFabSessionResult>();vi.spyOn(PlayFabSessionAuthenticator.prototype,'authenticate').mockReturnValue(wait.promise);
    const spy=vi.spyOn(RoundLedger.prototype,'command');const req={...input,roundId:fixture.rounds.active.roundId,operationId:'original',expectedRevision:fixture.rounds.active.revision,command:{type:'swap' as const,a:{row:0,col:0},b:{row:0,col:1}}};
    const result=s.command(req);req.sessionTicket='mutated';req.roundId='x';req.operationId='changed';req.expectedRevision=128;req.command.a.row=7;
    wait.resolve({kind:'authenticated',context:{ownerId:f.ownerId,expectedObfuscatedAccountId:'private-unused'}});await result;
    expect(spy).toHaveBeenCalledWith({ownerId:f.ownerId},{roundId:fixture.rounds.active.roundId,operationId:'original',expectedRevision:fixture.rounds.active.revision,command:{type:'swap',a:{row:0,col:0},b:{row:0,col:1}}});
  });
});

describe('게임 포기 commit·보상 정리·중단 수명',()=>{
  it('포기 정리 실패는 게임 결과 보존·명시 retry-required·같은 명령 재시도 정리',async()=>{
    const f=setup(),s=f.open(),close=vi.spyOn(RewardLedger.prototype,'closeRound');close.mockReturnValueOnce({kind:'service-error',code:'storage-unavailable'});
    const command={...input,operationId:'abandon',expectedRevision:failed.revision,command:{type:'abandon' as const}};
    const first=await s.command(command);expect(first).toMatchObject({kind:'command-result',applied:true,rewardCleanup:'retry-required',snapshot:{state:{status:'abandoned'}}});
    expect(await s.command(command)).toEqual({...first,applied:false,rewardCleanup:'closed'});expect(close).toHaveBeenCalledTimes(2);
  });
  it('실제 보상 DB lock으로 cleanup 실패해도 게임 commit·동일 재시도 복구',async()=>{
    const f=setup(),s=f.open(),d=new DatabaseSync(f.options.reward.databasePath);const command={...input,operationId:'locked-abandon',expectedRevision:failed.revision,command:{type:'abandon' as const}};
    let first:Awaited<ReturnType<GameService['command']>>;try{d.exec('BEGIN IMMEDIATE');first=await s.command(command);expect(first).toMatchObject({kind:'command-result',applied:true,rewardCleanup:'retry-required'});}finally{d.exec('ROLLBACK');d.close();}
    expect(await s.command(command)).toEqual({...first!,applied:false,rewardCleanup:'closed'});
  });
  it('게임 revision conflict/타 owner에서는 보상 회차를 닫지 않음',async()=>{
    const f=setup(),s=f.open(),close=vi.spyOn(RewardLedger.prototype,'closeRound');
    expect(await s.command({...input,operationId:'bad-abandon',expectedRevision:0,command:{type:'abandon'}})).toEqual(denied('revision-conflict'));expect(close).not.toHaveBeenCalled();expect(f.rows('reward_rounds')).toBe(0);
  });
  it.each(['close','abort'])('%s 뒤 늦게 성공한 인증은 DB 변경 불가',async mode=>{
    const f=setup(),s=f.open(),wait=deferred<PlayFabSessionResult>(),controller=new AbortController();
    vi.spyOn(PlayFabSessionAuthenticator.prototype,'authenticate').mockReturnValue(wait.promise);const call=s.start({sessionTicket:ticket,signal:controller.signal,requestId:'late',levelId:1});
    if(mode==='close')s.close();else controller.abort();wait.resolve({kind:'authenticated',context:{ownerId:f.ownerId,expectedObfuscatedAccountId:'unused'}});
    expect(await call).toEqual(mode==='close'?{kind:'service-error',code:'closed'}:denied('aborted'));
    expect(f.rows('round_rounds',f.options.round.databasePath)).toBe(fixture.round.find((t:any)=>t.name==='round_rounds').rows.length);
  });
  it.each(['close','abort'])('실제 인증 transport 대기 중 %s·늦은 응답은 신규 회차 생성 불가',async mode=>{
    const f=setup(),response=deferred<Response>(),entered=deferred<void>(),controller=new AbortController();
    f.transport.mockImplementation(async()=>{entered.resolve();return response.promise;});const s=f.open();
    const call=s.start({sessionTicket:ticket,signal:controller.signal,requestId:'late-real-auth',levelId:1});await entered.promise;
    if(mode==='close')s.close();else controller.abort();expect(await call).toEqual(mode==='close'?{kind:'service-error',code:'closed'}:denied('aborted'));
    response.resolve(authResponse());await new Promise(r=>setTimeout(r,0));
    expect(f.rows('round_rounds',f.options.round.databasePath)).toBe(fixture.round.find((t:any)=>t.name==='round_rounds').rows.length);
  });
  it('이미 중단·닫힘은 인증도 시작하지 않고 close는 멱등',async()=>{
    const f=setup(),s=f.open(),c=new AbortController();c.abort();expect(await s.get({...input,signal:c.signal})).toEqual(denied('aborted'));s.close();s.close();expect(await s.get(input)).toEqual({kind:'service-error',code:'closed'});expect(f.transport).not.toHaveBeenCalled();
  });
  it('close 하나가 실패해도 나머지 소유 자원을 정리·오류 원문 숨김',()=>{
    const f=setup(),s=f.open(),a=vi.spyOn(PlayFabSessionAuthenticator.prototype,'close').mockImplementation(()=>{throw new Error('secret-private');}),r=vi.spyOn(RoundLedger.prototype,'close'),w=vi.spyOn(RewardLedger.prototype,'close');
    expect(()=>s.close()).toThrow(/^game-service-close-failed$/);expect(a).toHaveBeenCalled();expect(r).toHaveBeenCalled();expect(w).toHaveBeenCalled();s.close();
  });
});

describe('신뢰된 구성 snapshot·독립 키/DB·실패 정리·비노출',()=>{
  it.each(['auth-round','auth-reward','round-reward','environment','reward-environment','same-path','relative','adunit','gate'])('잘못된 구성 %s 거절',mode=>{
    const f=setup(),o=f.options as any;
    if(mode==='auth-round')o.round.serverKey=o.auth.bindingKey;if(mode==='auth-reward')o.reward.serverKey=o.auth.bindingKey;if(mode==='round-reward')o.reward.serverKey=o.round.serverKey;
    if(mode==='environment')o.round.environment='production';if(mode==='reward-environment')o.reward.policy.environment='production';
    if(mode==='same-path')o.reward.databasePath=o.round.databasePath;if(mode==='relative')o.reward.databasePath='reward.sqlite';if(mode==='adunit')o.rewardAdUnit='999';if(mode==='gate')o.allowRewardClaim=true;
    expect(()=>new GameService(o)).toThrow(/^game-service-open-failed$/);expect(f.transport).not.toHaveBeenCalled();
  });
  it('별명 hardlink DB도 같은 실제 파일로 거절',()=>{
    const f=setup(),alias=join(f.dir,'alias.sqlite');linkSync(f.options.round.databasePath,alias);expect(()=>new GameService({...f.options,reward:{...f.options.reward,databasePath:alias}})).toThrow(/^game-service-open-failed$/);
  });
  it('생성 실패는 이미 만든 auth/round를 닫고 caller 키는 보존',()=>{
    const f=setup(),r=vi.spyOn(RoundLedger.prototype,'close'),a=vi.spyOn(PlayFabSessionAuthenticator.prototype,'close');writeFileSync(f.options.reward.databasePath,'invalid synthetic database');
    expect(()=>new GameService(f.options)).toThrow(/^game-service-open-failed$/);expect(r).toHaveBeenCalledOnce();expect(a).toHaveBeenCalledOnce();expect([...f.options.auth.bindingKey].every(v=>v===53)).toBe(true);
    const reopened=new RoundLedger(f.options.round);resources.push(reopened);expect(reopened.get({ownerId:f.ownerId},{roundId:failed.roundId}).kind).toBe('round-snapshot');
  });
  it('외부 key/정책/경로/함수 변경은 생성된 서비스 구성에 영향 없음',async()=>{
    const f=setup(),s=f.open(),o=f.options as any;
    o.auth.bindingKey.fill(0);o.round.serverKey.fill(0);o.reward.serverKey.fill(0);o.auth.titleId='BAD';o.auth.bindingDomain='changed';o.auth.getSecretKey=()=>{throw new Error();};
    o.round.databasePath=join(f.dir,'changed-round.sqlite');o.reward.databasePath=join(f.dir,'changed-reward.sqlite');o.reward.policy.adUnits[0]='999';o.reward.dependencies.now=()=>0;o.allowRewardClaim=()=>false;o.rewardAdUnit='999';
    expect(await s.get(input)).toEqual({kind:'round-snapshot',snapshot:failed});expect((await s.issueRewardClaim({...input,expectedRevision:failed.revision})).kind).toBe('claim-issued');
    expect(readdirSync(f.dir)).not.toContain('changed-round.sqlite');expect(readdirSync(f.dir)).not.toContain('changed-reward.sqlite');
  });
  it('응답/DB에 ticket/provider/비밀/내부 grant·외부 오류 원문 없음·일반 SSV API 없음',async()=>{
    const f=setup(),s=f.open();await f.recordClaim(s);const result=await s.applyReward(input);
    const text=JSON.stringify(result);for(const value of [ticket,provider,'synthetic-secret','ownerId','opaqueGrantId','expectedObfuscatedAccountId'])expect(text).not.toContain(value);
    for(const name of ['round.sqlite','reward.sqlite']){const bytes=readFileSync(join(f.dir,name));for(const value of [ticket,provider,'synthetic-secret'])expect(bytes.includes(Buffer.from(value))).toBe(false);}
    expect(Object.getOwnPropertyNames(GameService.prototype).sort()).toEqual(['constructor','start','get','command','issueRewardClaim','applyReward','close'].sort());
    f.transport.mockImplementation(async()=>{throw new Error('비공개 오류 원문');});expect(await s.get(input)).toEqual({kind:'session-error',code:'transport-error'});
  });
});
