import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {GameService,type GameServiceOptions} from '../server/game/gameService';
import {createGameHttpAdapter,GAME_HTTP_PATHS as paths,GAME_HTTP_LIMITS as limits,type GameHttpRequest,type GameHttpOptions} from '../server/game/gameHttp';
import {PlayFabSessionAuthenticator} from '../server/auth/playfabSession';
import {RoundLedger,type RoundSnapshot} from '../server/game/roundLedger';
import {CallbackInbox} from '../server/ads/callbackInbox';
import {callback,epoch,keyResponse,policy} from './helpers/ssvFixture';

const fixture=JSON.parse(readFileSync(new URL('./helpers/ledger-v1-fixture.json',import.meta.url),'utf8'));
const failed=fixture.rounds.failed as RoundSnapshot;
const ticket='synthetic-private-session-ticket',provider='0123456789ABCDEF';
const dirs:string[]=[],resources:{close():void}[]=[];
const bytes=(value:unknown)=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
function request(route:keyof typeof paths='get',value:unknown={roundId:failed.roundId}):GameHttpRequest {
  return {method:'POST',target:paths[route],headers:[['Content-Type','application/json'],['Authorization','Bearer '+ticket]],body:bytes(value)};
}
function authResponse(id=provider){return new Response(JSON.stringify({code:200,status:'OK',data:{IsSessionTicketExpired:false,UserInfo:{PlayFabId:id}}}),{headers:{'content-type':'application/json'}});}
function mac(key:Uint8Array,domain:string,text:string){return createHmac('sha256',createHmac('sha256',key).update('pawblossom-round-v1\0'+domain).digest()).update(text).digest('hex');}
function setup(gate=true){
  const dir=mkdtempSync(join(tmpdir(),'pawblossom-game-http-'));dirs.push(dir);let now=epoch;
  const authKey=new Uint8Array(32).fill(53),roundKey=new Uint8Array(32).fill(67),rewardKey=new Uint8Array(32).fill(71);
  const ownerId=createHmac('sha256',authKey).update(JSON.stringify(['pawblossom-session-v1','pawblossom.example','1A2B3','test','owner',provider])).digest('hex');
  const roundPath=join(dir,'round.sqlite'),rewardPath=join(dir,'reward.sqlite');
  const db=new DatabaseSync(roundPath,{enableForeignKeyConstraints:false});try{
    db.exec('BEGIN');
    for(const table of fixture.round)db.exec(table.sql);
    for(const table of fixture.round)for(const row of table.rows)db.prepare('INSERT INTO '+table.name+' VALUES('+Object.keys(row).map(()=>'?').join()+')').run(...Object.values(row) as any[]);
    const profile=db.prepare('SELECT profile FROM round_meta').get()!.profile;
    for(const row of db.prepare('SELECT * FROM round_rounds').all() as any[]){
      row.owner_hash=mac(roundKey,'owner',ownerId);
      row.state_mac=mac(roundKey,'state',JSON.stringify([profile,row.round_id,row.owner_hash,row.create_hash,row.create_digest,row.created_at,row.expires_at,row.revision,row.state_json]));
      db.prepare('UPDATE round_rounds SET owner_hash=?,state_mac=? WHERE round_id=?').run(row.owner_hash,row.state_mac,row.round_id);
    }db.exec('COMMIT');
  }finally{db.close();}
  const transport=vi.fn<typeof fetch>(async()=>authResponse());
  const options:GameServiceOptions={auth:{titleId:'1A2B3',environment:'test',bindingDomain:'pawblossom.example',bindingKey:authKey,getSecretKey:async()=> 'synthetic-secret'},
    authTransport:transport,round:{databasePath:roundPath,serverKey:roundKey,environment:'test',now:()=>now},
    reward:{databasePath:rewardPath,serverKey:rewardKey,policy,dependencies:{now:()=>now,transport:async()=>keyResponse()}},
    rewardAdUnit:policy.adUnits[0],allowRewardClaim:()=>gate};
  function open(config?:GameHttpOptions){const service=new GameService(options);resources.push(service);return {service,http:createGameHttpAdapter(service,config)};}
  return {dir,transport,options,open,setTime:(v:number)=>now=v};
}
afterEach(()=>{vi.restoreAllMocks();for(const r of resources.splice(0).reverse())try{r.close();}catch{}
  for(const dir of dirs.splice(0)){if(!dir.startsWith(join(tmpdir(),'pawblossom-game-http-')))throw new Error('정리 경로 오류');rmSync(dir,{recursive:true,force:true});}});

describe('게임 HTTP·실제 인증/SQLite/SSV 통합',()=>{
  it('5개 경로의 공개 응답·매 요청 인증·명령/생성 멱등성',async()=>{
    const f=setup(),{http}=f.open();expect(f.transport).not.toHaveBeenCalled();
    const start=await http(request('start',{requestId:'http-game',levelId:1}));expect(start.status).toBe(200);
    const body=JSON.parse(start.body);expect(Object.keys(body)).toEqual(['kind','created','snapshot']);
    expect(JSON.parse((await http(request('start',{requestId:'http-game',levelId:1}))).body)).toEqual({...body,created:false});
    expect(JSON.parse((await http(request('get',{roundId:body.snapshot.roundId}))).body)).toEqual({kind:'round-snapshot',snapshot:body.snapshot});
    const command={roundId:body.snapshot.roundId,operationId:'http-shuffle',expectedRevision:0,command:{type:'shuffle'}};
    const moved=await http(request('command',command));expect(moved.status).toBe(200);expect(JSON.parse(moved.body)).toMatchObject({kind:'command-result',applied:true,outcome:'shuffled'});
    expect(JSON.parse((await http(request('command',command))).body)).toEqual({...JSON.parse(moved.body),applied:false});
    expect(f.transport).toHaveBeenCalledTimes(5);
    const text=start.body+moved.body;for(const secret of [ticket,provider,'synthetic-secret','ownerId','rngState','opaqueGrantId','serverKey','bindingKey'])expect(text).not.toContain(secret);
    expect(start.headers).toMatchObject({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',vary:'Origin'});
    expect(start.headers).not.toHaveProperty('access-control-allow-origin');expect(Object.isFrozen(start)).toBe(true);expect(Object.isFrozen(start.headers)).toBe(true);
  });
  it('실패 회차 claim→별도 Inbox의 유효 SSV→+5→중복/재시작 applied:false',async()=>{
    const f=setup(),{http,service}=f.open();expect(JSON.parse((await http(request())).body)).toEqual({kind:'round-snapshot',snapshot:failed});
    expect(await http(request('apply'))).toMatchObject({status:409,body:'{"code":"voucher-missing"}'});
    const response=await http(request('claim',{roundId:failed.roundId,expectedRevision:failed.revision}));expect(response.status).toBe(200);
    const claim=JSON.parse(response.body);expect(Object.keys(claim).sort()).toEqual(['kind','customData','userId','expiresAt'].sort());
    const inbox=new CallbackInbox({databasePath:join(f.dir,'inbox.sqlite'),encryptionKey:new Uint8Array(32).fill(79),policy,rewardLedger:f.options.reward,now:()=>epoch});resources.push(inbox);
    expect(inbox.receive(callback({custom_data:claim.customData,user_id:claim.userId})).kind).toBe('accepted');expect(await inbox.processNext()).toEqual({kind:'completed'});
    const applied=await http(request('apply'));expect(applied.status).toBe(200);const body=JSON.parse(applied.body);
    expect(body).toEqual({kind:'reward-result',applied:true,snapshot:{...failed,revision:failed.revision+1,state:{...failed.state,moves:5,status:'active'}}});
    expect(JSON.parse((await http(request('apply'))).body)).toEqual({...body,applied:false});service.close();
    expect(JSON.parse((await f.open().http(request('apply'))).body)).toEqual({...body,applied:false});
  });
  it('타 owner는 존재 여부를 공개하지 않으며 revision/TTL/gate/저장 오류를 고정 매핑',async()=>{
    const f=setup(false),{http,service}=f.open();f.transport.mockImplementation(async()=>authResponse('FEDCBA9876543210'));
    for(const route of ['get','claim','apply'] as const)expect(await http(request(route,route==='claim'?{roundId:failed.roundId,expectedRevision:failed.revision}:{roundId:failed.roundId}))).toMatchObject({status:404,body:'{"code":"not-found"}'});
    f.transport.mockImplementation(async()=>authResponse());
    expect(await http(request('claim',{roundId:failed.roundId,expectedRevision:0}))).toMatchObject({status:409,body:'{"code":"revision-conflict"}'});
    expect(await http(request('claim',{roundId:failed.roundId,expectedRevision:failed.revision}))).toMatchObject({status:403,body:'{"code":"ads-unavailable"}'});
    const db=new DatabaseSync(f.options.round.databasePath);try{db.exec('BEGIN IMMEDIATE');expect(await http(request())).toMatchObject({status:503,body:'{"code":"unavailable"}'});}finally{db.exec('ROLLBACK');db.close();}
    f.setTime(failed.expiresAt);expect(await http(request())).toMatchObject({status:409,body:'{"code":"expired"}'});
    service.close();expect(await http(request())).toMatchObject({status:503,body:'{"code":"unavailable"}'});
  });
  it('생성 충돌과 명령 revision 충돌·포기 정리 결과를 HTTP 계약으로 보존',async()=>{
    const f=setup(),{http}=f.open();
    expect((await http(request('start',{requestId:'same',levelId:1}))).status).toBe(200);
    expect(await http(request('start',{requestId:'same',levelId:2}))).toMatchObject({status:409,body:'{"code":"request-conflict"}'});
    expect(await http(request('command',{roundId:failed.roundId,operationId:'end',expectedRevision:0,command:{type:'abandon'}}))).toMatchObject({status:409,body:'{"code":"revision-conflict"}'});
    const cmd=request('command',{roundId:failed.roundId,operationId:'end',expectedRevision:failed.revision,command:{type:'abandon'}});
    const ended=await http(cmd);expect(ended.status).toBe(200);expect(JSON.parse(ended.body)).toMatchObject({kind:'command-result',applied:true,outcome:'abandoned',rewardCleanup:'closed'});
    expect(JSON.parse((await http(cmd)).body)).toEqual({...JSON.parse(ended.body),applied:false});
  });
  it.each([401,403,429,500])('합성 인증 HTTP %i 세부 원문 비노출',async status=>{
    const f=setup(),{http}=f.open();f.transport.mockImplementation(async()=>new Response('private-provider-error '+ticket,{status}));
    const result=await http(request());expect(result.status).toBe(status===500?503:status);expect(result.body).not.toContain(ticket);expect(result.body).not.toContain('provider');
    if(status===401)expect(result.headers['www-authenticate']).toBe('Bearer realm="pawblossom"');
  });
  it.each(['abort','close'])('%s 이후 늦은 실제 합성 인증 응답으로 라운드를 생성하지 않음',async mode=>{
    const f=setup(),{http,service}=f.open(),controller=new AbortController();let release!:(r:Response)=>void;
    f.transport.mockImplementation(()=>new Promise(r=>release=r));
    const operation=http({...request('start',{requestId:'late',levelId:1}),signal:controller.signal});
    await vi.waitFor(()=>expect(f.transport).toHaveBeenCalledOnce());
    if(mode==='abort')controller.abort();else service.close();release(authResponse());
    expect(await operation).toMatchObject({status:mode==='abort'?400:503,body:mode==='abort'?'{"code":"aborted"}':'{"code":"unavailable"}'});
    const db=new DatabaseSync(f.options.round.databasePath);try{expect(db.prepare('SELECT count(*) AS n FROM round_rounds').get()?.n).toBe(fixture.round.find((t:any)=>t.name==='round_rounds').rows.length);}finally{db.close();}
  });
});

describe('원문 경로·헤더·실제 본문 제한',()=>{
  it.each(['GET','post','DELETE'])('%s 미지원·405 Allow POST, OPTIONS',async method=>{
    const f=setup(),{http}=f.open();expect(await http({...request(),method})).toMatchObject({status:405,headers:{allow:'POST, OPTIONS'},body:'{"code":"method-not-allowed"}'});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['/v1/rounds/get?access_token=private','/v1/rounds/%67et','/v1/rounds/get#x','https://example.com/v1/rounds/get','//v1/rounds/get','/callbacks/admob','/v1/rounds/get/','/v2/rounds/get'])('원문 target %s를 정규화 없이 거절',async target=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),target})).status).toBe(/^[\/A-Za-z0-9_-]+$/.test(target)?404:400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['authorization','content-type','content-length','origin','host','x-custom'])('대소문자 혼합 중복 %s 헤더 거절',async name=>{
    const f=setup(),{http}=f.open();const headers=[['Content-Type','application/json'],['Authorization','Bearer '+ticket]];
    if(!['authorization','content-type'].includes(name))headers.push([name,'x']);headers.push([name.toUpperCase(),'x']);
    expect(await http({...request(),headers})).toMatchObject({status:400});expect(f.transport).not.toHaveBeenCalled();
  });
  const badHeaders:unknown[]=[{},[['Content-Type','application/json','extra']],[[1,'x']],[['bad name','x']],[['x','line\r\nname: x']],
    [['x','\u0000']],[['x','한글']],[['','x']],[['x',1]],Array(2),new Proxy([],{})];
  it.each(badHeaders.map((value,i)=>({value,i})))('잘못된 raw header 형태 $i 거절',async({value})=>{
    const f=setup(),{http}=f.open();expect(await http({...request(),headers:value})).toMatchObject({status:400});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([
    {headers:Array.from({length:limits.headerCount+1},(_,i)=>['x-'+i,'v'])},
    {headers:[['x'.repeat(limits.headerNameBytes+1),'x']]},
    {headers:[['x','v'.repeat(limits.headerValueBytes+1)]]},
    {headers:[['x','v'.repeat(8192)],['y','v'.repeat(8192)]]},
    {body:new Uint8Array(limits.bodyBytes+1)},
    {target:'/'+ 'x'.repeat(limits.targetBytes)},
    {headers:[['Content-Type','application/json'],['Content-Length','8193']]},
  ])('크기 제한 %#는 413',async patch=>{
    const f=setup(),{http}=f.open();expect(await http({...request(),...patch})).toMatchObject({status:413,body:'{"code":"request-too-large"}'});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['0','+54',' 54','054','1, 1','1e2','-1','9007199254740991'])('Content-Length %s 형식·실제 byte 불일치 거절',async value=>{
    const f=setup(),{http}=f.open();expect(await http({...request(),headers:[...(request().headers as string[][]),['Content-Length',value]]})).toMatchObject({status:400});expect(f.transport).not.toHaveBeenCalled();
  });
  it('실제 view byte만 복제하며 Buffer/subarray와 정확한 content-length·8KiB 허용',async()=>{
    const f=setup(),{http}=f.open(),raw=request(),body=raw.body as Uint8Array;
    const padded=Buffer.concat([Buffer.from('ignore'),Buffer.from(body),Buffer.from('ignore')]);
    expect((await http({...raw,body:padded.subarray(6,6+body.length),headers:[...(raw.headers as string[][]),['Content-Length',String(body.length)]]})).status).toBe(200);
    const full=bytes(JSON.stringify({roundId:failed.roundId})+' '.repeat(8192-body.length));expect(full.byteLength).toBe(8192);
    expect((await http({...raw,body:full})).status).toBe(200);
  });
  it('typed array 사용자 iterator/getter를 실행하지 않고 실제 크기를 검사',async()=>{
    const f=setup(),{http}=f.open(),get=vi.fn(()=>{throw new Error('비공개');});const body=bytes({roundId:failed.roundId});
    Object.defineProperties(body,{byteLength:{get},buffer:{get},[Symbol.iterator]:{value:get}});
    expect((await http({...request(),body})).status).toBe(200);expect(get).not.toHaveBeenCalled();
    const huge=new Uint8Array(8193);Object.defineProperty(huge,'byteLength',{value:1});expect((await http({...request(),body:huge})).status).toBe(413);
  });
  it('분리된 buffer는 원문 예외 없이 malformed로 거절',async()=>{
    const f=setup(),{http}=f.open(),body=bytes({roundId:failed.roundId});structuredClone(body.buffer,{transfer:[body.buffer]});
    expect(await http({...request(),body})).toMatchObject({status:400,body:'{"code":"invalid-request"}'});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([new Uint8Array(new SharedArrayBuffer(2)),new Proxy(new Uint8Array(2),{}),new Uint16Array(2),'{}',{},null])('실제 단독 Uint8Array 외 본문 %# 거절',async body=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),body})).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['transfer-encoding','content-encoding','trailer'])('호스트에서 해결해야 할 %s 거절',async name=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),headers:[...(request().headers as string[][]),[name,'x']]})).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['text/plain','application/json; charset=iso-8859-1','application/json; charset="utf-8"','application/json; x=y',''])('자체 Content-Type profile %s 거절',async value=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),headers:[['Content-Type',value],['Authorization','Bearer '+ticket]]})).status).toBe(415);expect(f.transport).not.toHaveBeenCalled();
  });
});

describe('Bearer·엄격 JSON·권한 위조·snapshot',()=>{
  it('헤더 없는 native 요청에도 인증 필수·401 challenge',async()=>{
    const f=setup(),{http}=f.open();expect(await http({...request(),headers:[['Content-Type','application/json']]})).toMatchObject({status:401,headers:{'www-authenticate':'Bearer realm="pawblossom"'}});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['Bearer a:b','Bearer a=b','Bearer =','Bearer','Basic abc','Bearer\tabc',' Bearer abc','Bearer abc ','Bearer a b','Bearer a,b','Bearer a!','Bearer 한글','Bearer '+'a'.repeat(4097)])('잘못된 Bearer profile %# 거절',async value=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),headers:[['Content-Type','application/json'],['Authorization',value]]})).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['bearer abc','BEARER  A0-._~+/===','BeArEr '+ 'a'.repeat(4096)])('scheme 대소문자·1*SP·token68 경계 %# 허용',async value=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),headers:[['Content-Type','APPLICATION/JSON; CHARSET=UTF-8'],['Authorization',value]]})).status).toBe(200);
    const sent=JSON.parse(f.transport.mock.calls[0][1]!.body as string);expect(sent.SessionTicket).toBe(value.replace(/^\S+ +/,''));
  });
  it.each(['ownerId','context','board','score','grant','adUnit','consent','age','sessionTicket','access_token','verified','rawQuery'])('추가 권한 필드 %s를 모든 경로에서 인증 전 거절',async field=>{
    const f=setup(),{http}=f.open();
    for(const route of Object.keys(paths) as (keyof typeof paths)[]){
      const payload=route==='start'?{requestId:'x',levelId:1}:route==='command'?{roundId:failed.roundId,operationId:'x',expectedRevision:failed.revision,command:{type:'abandon'}}:route==='claim'?{roundId:failed.roundId,expectedRevision:failed.revision}:{roundId:failed.roundId};
      expect((await http(request(route,{...payload,[field]:true}))).status).toBe(400);
    }expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([
    {route:'start',payload:{requestId:'x',levelId:1.5}},
    {route:'start',payload:{requestId:'x'}},
    {route:'get',payload:{roundId:'invalid'}},
    {route:'apply',payload:{roundId:failed.roundId,expectedRevision:0}},
    {route:'claim',payload:{roundId:failed.roundId,expectedRevision:-1}},
    {route:'command',payload:{roundId:failed.roundId,operationId:'x',expectedRevision:0,command:{type:'activate',at:{row:8,col:0}}}},
  ])('JSON 필드/서비스 값 경계 %#는 400·인증 없음',async({route,payload})=>{
    const f=setup(),{http}=f.open();expect((await http(request(route as keyof typeof paths,payload))).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([
    '{"roundId":"x","roundId":"y"}',String.raw`{"roundId":"x","round\u0049d":"y"}`,
    '{"roundId":'+ '['.repeat(34)+'0'+']'.repeat(34)+'}',
    '[]','null','1','"x"','{}','{"roundId":"x",}','\ufeff{"roundId":"x"}',
  ])('중복/escape 등가/깊이/문법/shape JSON %# 거절',async value=>{
    const f=setup(),{http}=f.open();expect((await http(request('get',value))).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([new Uint8Array([0xc0,0xaf]),new Uint8Array([0xed,0xa0,0x80]),new Uint8Array([0xf4,0x90,0x80,0x80]),new Uint8Array([0xe2,0x82])])('fatal UTF-8 %# 거절',async body=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),body})).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it('중첩 명령 중복 키·추가 좌표·불법 명령 거절',async()=>{
    const f=setup(),{http}=f.open();
    for(const command of [String.raw`{"type":"swap","a":{"row":0,"r\u006fw":1,"col":0},"b":{"row":0,"col":1}}`,'{"type":"activate","at":{"row":0,"col":0,"ownerId":"x"}}','{"type":"grant"}']){
      const raw=`{"roundId":"${failed.roundId}","operationId":"x","expectedRevision":0,"command":${command}}`;
      expect((await http(request('command',raw))).status).toBe(400);
    }expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([Object.create(AbortSignal.prototype),new Proxy(new AbortController().signal,{}),{}])('위조/Proxy signal %# 거절',async signal=>{
    const f=setup(),{http}=f.open();expect((await http({...request(),signal:signal as AbortSignal})).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it('취소 완료 signal은 인증 전 고정 aborted',async()=>{
    const f=setup(),{http}=f.open(),c=new AbortController();c.abort(ticket);expect(await http({...request(),signal:c.signal})).toMatchObject({status:400,body:'{"code":"aborted"}'});expect(f.transport).not.toHaveBeenCalled();
  });
  it('signal own getter를 실행하지 않고 실제 native getter/프로토타입만 허용',async()=>{
    const f=setup(),{http}=f.open(),signal=new AbortController().signal,get=vi.fn(()=>false);Object.defineProperty(signal,'aborted',{get});
    expect((await http({...request(),signal})).status).toBe(400);expect(get).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
  });
  it('입력 accessor/Proxy/추가 필드를 실행하지 않고 거절',async()=>{
    const f=setup(),{http}=f.open(),get=vi.fn(()=>ticket);
    const raw=request();for(const bad of [{...raw,get target(){return get();}},new Proxy(raw,{}),{...raw,ownerId:'x'},Object.create(raw),null])expect((await http(bad as any)).status).toBe(400);
    const headers=[['Content-Type','application/json'],['Authorization','Bearer '+ticket]];Object.defineProperty(headers[1],'1',{get});expect((await http({...raw,headers})).status).toBe(400);
    expect(get).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
  });
  it('await 전 헤더/본문/요청/구성을 복제하고 중첩 명령도 원본 값으로 전달',async()=>{
    const f=setup(),origins=['https://allowed.example'],config={allowedOrigins:origins},{http}=f.open(config);
    let release!:(r:Response)=>void;f.transport.mockImplementation(()=>new Promise(r=>release=r));
    const spy=vi.spyOn(RoundLedger.prototype,'command'),active=fixture.rounds.active;
    const payload={roundId:active.roundId,operationId:'original',expectedRevision:active.revision,command:{type:'swap',a:{row:0,col:0},b:{row:0,col:1}}};
    const raw=request('command',payload) as any;raw.headers.push(['Origin',origins[0]]);const operation=http(raw);
    raw.method='GET';raw.target='/wrong';raw.headers[1][1]='Bearer mutated';raw.body.fill(0);origins[0]='https://evil.example';config.allowedOrigins=[];
    await vi.waitFor(()=>expect(f.transport).toHaveBeenCalledOnce());release(authResponse());
    const result=await operation;expect(result.status).toBe(200);expect(result.headers['access-control-allow-origin']).toBe('https://allowed.example');
    expect(spy.mock.calls[0][1]).toEqual(payload);expect(JSON.parse(f.transport.mock.calls[0][1]!.body as string).SessionTicket).toBe(ticket);
  });
  it('서비스 모양 객체 거절·instance/prototype override 성공을 신뢰하지 않음',async()=>{
    const fake=vi.fn(async()=>({kind:'round-snapshot',snapshot:{private:ticket}}));
    expect(()=>createGameHttpAdapter({get:fake} as any)).toThrow('invalid-game-http-config');
    const f=setup(),{service}=f.open();(service as any).get=fake;
    const spy=vi.spyOn(GameService.prototype,'get').mockImplementation(fake as any);
    expect((await createGameHttpAdapter(service)(request())).status).toBe(200);expect(fake).not.toHaveBeenCalled();expect(spy).not.toHaveBeenCalled();
    const forged=Object.create(GameService.prototype);forged.get=fake;
    expect(await createGameHttpAdapter(forged)(request())).toMatchObject({status:503,body:'{"code":"unavailable"}'});expect(fake).not.toHaveBeenCalled();
    expect(()=>createGameHttpAdapter(new Proxy(service,{}))).toThrow('invalid-game-http-config');
  });
  it('내부 인증 예외 원문을 성공/원문으로 반환하지 않음',async()=>{
    const f=setup(),{http}=f.open();vi.spyOn(PlayFabSessionAuthenticator.prototype,'authenticate').mockRejectedValue(new Error(ticket+' private-provider'));
    expect(await http(request())).toMatchObject({status:503,body:'{"code":"unavailable"}'});
  });
  it('알 수 없는 서비스 내부 결과도 원문 없이 unavailable',async()=>{
    const f=setup(),{http}=f.open();vi.spyOn(RoundLedger.prototype,'get').mockReturnValue({kind:'private',secret:ticket} as any);
    expect(await http(request())).toMatchObject({status:503,body:'{"code":"unavailable"}'});
  });
  it.each(['busy','rate-limited','session-expired','timeout','aborted','invalid-json','secret-unavailable'] as const)('내부 인증 %s 고정 공개 매핑',async code=>{
    const f=setup(),{http}=f.open();vi.spyOn(PlayFabSessionAuthenticator.prototype,'authenticate').mockResolvedValue({kind:'session-error',code});
    const result=await http(request());expect(result.status).toBe(code==='busy'||code==='rate-limited'?429:code==='session-expired'?401:code==='aborted'?400:503);
    expect(result.body).not.toContain('secret');expect(result.body).not.toContain('invalid-json');
  });
});

describe('Origin 기본 거절과 명시 허용 구성',()=>{
  it.each(['https://allowed.example','null','*','https://evil.example','https://allowed.example https://evil.example'])('기본 Origin %s 거절',async value=>{
    const f=setup(),{http}=f.open();expect(await http({...request(),headers:[...(request().headers as string[][]),['Origin',value]]})).toMatchObject({status:403,body:'{"code":"origin-denied"}'});expect(f.transport).not.toHaveBeenCalled();
  });
  it('허용한 HTTPS Origin만 반사·credentials 없음·오류도 no-store',async()=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']});
    const raw={...request(),headers:[['Content-Type','application/json'],['Origin','https://allowed.example']]};
    const result=await http(raw);expect(result).toMatchObject({status:401,headers:{'access-control-allow-origin':'https://allowed.example','cache-control':'no-store',vary:'Origin'}});
    expect(result.headers).not.toHaveProperty('access-control-allow-credentials');expect(result.headers).not.toHaveProperty('access-control-allow-methods');
  });
  it.each([['*'],['null'],['http://example.com'],['https://example.com/'],['https://user:pass@example.com'],['https://*.example.com'],['https://example.com?x'],['https://example.com','https://example.com'],Array(17).fill('https://example.com')].map(origins=>({origins})))('허용 Origin 구성 %# 거절',({origins})=>{
    const f=setup(),{service}=f.open();expect(()=>createGameHttpAdapter(service,{allowedOrigins:origins})).toThrow('invalid-game-http-config');
  });
  it('구성 getter와 Proxy는 실행하지 않고 고정 오류',()=>{
    const f=setup(),{service}=f.open(),get=vi.fn(()=>[]);
    expect(()=>createGameHttpAdapter(service,{get allowedOrigins(){return get();}})).toThrow('invalid-game-http-config');
    expect(()=>createGameHttpAdapter(service,new Proxy({},{}))).toThrow('invalid-game-http-config');expect(get).not.toHaveBeenCalled();
  });
});

describe('제한된 OPTIONS CORS preflight·인증/DB 호출 없음',()=>{
  function preflight(target:string=paths.get):GameHttpRequest {
    return {method:'OPTIONS',target,body:new Uint8Array(),headers:[['Origin','https://allowed.example'],
      ['Access-Control-Request-Method','POST'],['Access-Control-Request-Headers','authorization, content-type']]};
  }
  it.each(Object.values(paths))('%s 경로의 0byte 요청은 204·빈 응답·좁은 허용 헤더',async path=>{
    const f=setup(),{service}=f.open();service.close();const http=createGameHttpAdapter(service,{allowedOrigins:['https://allowed.example']});
    const result=await http(preflight(path));expect(result).toEqual({status:204,body:'',headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',
      vary:'Origin, Access-Control-Request-Method, Access-Control-Request-Headers','access-control-allow-origin':'https://allowed.example',
      'access-control-allow-methods':'POST','access-control-allow-headers':'authorization, content-type','access-control-max-age':'0'}});
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['Authorization, Content-Type',' CONTENT-TYPE\t,\tAUTHORIZATION ','authorization','content-type'])('요청 헤더 목록 %s는 대소문자·OWS 허용',async value=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']}),raw=preflight();
    (raw.headers as string[][])[2][1]=value;expect((await http(raw)).status).toBe(204);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['authorization, Authorization',',authorization','authorization,','authorization,,content-type','', '"authorization"','authorization;content-type','authorization,content-type,x-extra','a'.repeat(129)])('잘못된 요청 헤더 목록 %#는 400',async value=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']}),raw=preflight();(raw.headers as string[][])[2][1]=value;
    expect((await http(raw)).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['x-owner','authorization, x-extra','*'])('미허용 요청 헤더 %s는 403',async value=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']}),raw=preflight();(raw.headers as string[][])[2][1]=value;
    expect(await http(raw)).toMatchObject({status:403,body:'{"code":"preflight-denied"}'});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['GET','DELETE','post'])('미지원 요청 method %s는 405와 실제 Allow',async value=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']}),raw=preflight();(raw.headers as string[][])[1][1]=value;
    expect(await http(raw)).toMatchObject({status:405,headers:{allow:'POST, OPTIONS'},body:'{"code":"method-not-allowed"}'});expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['',' POST','POST,GET','POST\t'])('malformed 요청 method %#는 400',async value=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']}),raw=preflight();(raw.headers as string[][])[1][1]=value;
    expect((await http(raw)).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([0,1,2])('필수 preflight 헤더 %# 누락은 고정 거절',async index=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']}),raw=preflight();(raw.headers as string[][]).splice(index,1);
    expect((await http(raw)).status).toBe(index===0?403:400);expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['origin','access-control-request-method','access-control-request-headers'])('중복 preflight %s는 병합하지 않고 거절',async name=>{
    const f=setup(),{http}=f.open({allowedOrigins:['https://allowed.example']}),raw=preflight();(raw.headers as string[][]).push([name.toUpperCase(),'POST']);
    expect((await http(raw)).status).toBe(400);expect(f.transport).not.toHaveBeenCalled();
  });
  it('기본 비허용·null/다른 Origin·본문/길이·header 크기·경로는 preflight에서도 제한',async()=>{
    const f=setup(),{service}=f.open(),http=createGameHttpAdapter(service,{allowedOrigins:['https://allowed.example']});
    expect((await createGameHttpAdapter(service)(preflight())).status).toBe(403);
    for(const value of ['null','*','https://evil.example']){const raw=preflight();(raw.headers as string[][])[0][1]=value;expect((await http(raw)).status).toBe(403);}
    expect((await http({...preflight(),body:new Uint8Array([0])})).status).toBe(413);
    expect((await http({...preflight(),headers:[...(preflight().headers as string[][]),['Content-Length','1']]})).status).toBe(413);
    expect((await http({...preflight(),headers:[...(preflight().headers as string[][]),['x','v'.repeat(8193)]]})).status).toBe(413);
    expect((await http(preflight('/callbacks/admob'))).status).toBe(404);
    expect((await http(preflight(paths.get+'?access_token=x'))).status).toBe(400);
    expect((await http({...preflight(),headers:[...(preflight().headers as string[][]),['Content-Length','0']]})).status).toBe(204);
    expect(f.transport).not.toHaveBeenCalled();
  });
});
