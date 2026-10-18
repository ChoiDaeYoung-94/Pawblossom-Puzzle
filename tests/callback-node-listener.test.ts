import {afterEach,describe,expect,it,vi} from 'vitest';
import {Agent,createServer,request,type IncomingMessage,type ServerOptions,type ServerResponse} from 'node:http';
import {createConnection,type Socket} from 'node:net';
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createCallbackNodeListener,CALLBACK_NODE_LIMITS as limits,type CallbackNodeAdapter,type CallbackNodeListenerOptions} from '../server/ads/callbackNodeListener';
import {CALLBACK_PATH,createCallbackHttpAdapter,type CallbackRequest,type CallbackResponse} from '../server/ads/callbackHttp';
import {CallbackInbox} from '../server/ads/callbackInbox';
import {RewardLedger} from '../server/ads/rewardLedger';
import {callback,epoch,keyResponse,policy} from './helpers/ssvFixture';

const ok:CallbackResponse={status:200,headers:{'content-type':'text/plain; charset=utf-8'},body:'received'};
const cleanups:(()=>void|Promise<void>)[]=[];
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const until=async(check:()=>void)=>vi.waitFor(check,{timeout:2000,interval:5});
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.restoreAllMocks();vi.useRealTimers();});

async function host(adapter:CallbackNodeAdapter,options:CallbackNodeListenerOptions={},optimizeEmptyRequests=false){
  const calls:CallbackRequest[]=[],observed:{req:IncomingMessage;res:ServerResponse}[]=[],sockets=new Set<Socket>(),clients=new Set<Socket>(),agents:Agent[]=[];
  const closes=new WeakMap<Socket,Promise<void>>(),closeEvents:Promise<void>[]=[];
  function track(socket:Socket,set:Set<Socket>){
    if(closes.has(socket))return socket;
    if(socket.closed){closes.set(socket,Promise.resolve());return socket;}
    set.add(socket);socket.on('error',()=>{});
    const done=new Promise<void>(resolve=>socket.once('close',()=>{set.delete(socket);resolve();}));
    closes.set(socket,done);closeEvents.push(done);return socket;
  }
  const boundary=createCallbackNodeListener(input=>{calls.push(input);return adapter(input);},options);
  // listener 상한을 검사하도록 parser 한도를 넓힙니다. 운영 호스트 권장값이 아닙니다.
  const config:ServerOptions&{optimizeEmptyRequests:boolean}={maxHeaderSize:65536,rejectNonStandardBodyWrites:true,optimizeEmptyRequests};
  const server=createServer(config,(req,res)=>{observed.push({req,res});boundary.listener(req,res);});
  // listen/주소 확인 실패 때도 생성한 자원은 afterEach 정리 대상입니다.
  cleanups.push(async()=>{
    boundary.close();for(const agent of agents)agent.destroy();for(const socket of clients)socket.destroy();for(const socket of sockets)socket.destroy();
    await Promise.all(closeEvents);await new Promise<void>(resolve=>server.close(()=>resolve()));
  });
  server.on('connection',socket=>track(socket,sockets));
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('검사 포트 오류');
  const port=address.port;
  function agent(){const value=new Agent({keepAlive:true,maxSockets:1});agents.push(value);return value;}
  function send(path=CALLBACK_PATH+'?x',extra:{method?:string;agent?:Agent}={}){
    return new Promise<{status:number;body:string;headers:IncomingMessage['headers'];socket:Socket|null}>((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port,path,method:extra.method??'GET',agent:extra.agent??false},res=>{
        const chunks:Buffer[]=[],socket=res.socket;res.on('data',c=>chunks.push(c));res.on('error',reject);
        res.on('end',()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString(),headers:res.headers,socket}));
      });req.on('error',reject);req.once('socket',socket=>track(socket,clients));req.end();
    });
  }
  async function raw(){
    const socket=track(createConnection({host:'127.0.0.1',port}),clients),chunks:Buffer[]=[];
    socket.on('data',chunk=>chunks.push(chunk));
    const done=closes.get(socket)!;
    await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    return {socket,done,text:()=>Buffer.concat(chunks).toString()};
  }
  return {boundary,server,calls,observed,agent,send,raw};
}
const rawGet=(path=CALLBACK_PATH+'?x',headers:string[]=[])=>['GET '+path+' HTTP/1.1','Host: local',...headers,'',''].join('\r\n');

/** native parser 결과와 구별하여 이벤트/쓰기 실패·미완료 수명을 제어합니다. */
function fixture(adapter:CallbackNodeAdapter,options:CallbackNodeListenerOptions={},autoFinish=true){
  const boundary=createCallbackNodeListener(adapter,options),req=new EventEmitter() as IncomingMessage,res=new EventEmitter() as ServerResponse;
  Object.assign(req,{method:'GET',url:CALLBACK_PATH+'?x',rawHeaders:[],rawTrailers:[],complete:false,readableEnded:false,destroyed:false,closed:false,aborted:false,socket:{destroyed:false}});
  Object.assign(res,{headersSent:false,writableEnded:false,writableFinished:false,destroyed:false,closed:false,statusCode:200});
  const output:string[]=[],headers=new Map<string,number|string|readonly string[]>();
  req.pause=()=>req;req.destroy=()=>{if(!req.destroyed){Object.assign(req,{destroyed:true});queueMicrotask(()=>{Object.assign(req,{closed:true});req.emit('close');});}return req;};
  res.setHeader=(name,value)=>{headers.set(name.toLowerCase(),value);return res;};res.getHeaderNames=()=>[...headers.keys()];res.removeHeader=name=>{headers.delete(name.toLowerCase());};
  const finish=()=>{Object.assign(res,{writableFinished:true});res.emit('finish');queueMicrotask(()=>{Object.assign(res,{closed:true});res.emit('close');});};
  res.writeHead=(()=>{Object.assign(res,{headersSent:true});return res;}) as ServerResponse['writeHead'];
  res.end=((value?:string)=>{if(res.writableEnded)throw new Error('double-end');res.writeHead(res.statusCode);Object.assign(res,{writableEnded:true});if(value)output.push(value);if(autoFinish)queueMicrotask(finish);return res;}) as ServerResponse['end'];
  res.destroy=()=>{if(!res.destroyed){Object.assign(res,{destroyed:true});queueMicrotask(()=>{Object.assign(res,{closed:true});res.emit('close');});}return res;};
  function enter(){boundary.listener(req,res);}
  function end(complete=true){Object.assign(req,{complete,readableEnded:true});req.emit('end');Object.assign(req,{closed:true,destroyed:true});req.emit('close');}
  cleanups.push(async()=>{boundary.close();await Promise.resolve();});
  return {boundary,req,res,output,headers,enter,end,finish};
}
function inboxFixture(){
  const dir=mkdtempSync(join(tmpdir(),'pawblossom-node-ssv-')),path=join(dir,'inbox.sqlite'),rewardPath=join(dir,'reward.sqlite');
  const boxes:CallbackInbox[]=[],dbs:DatabaseSync[]=[];
  let key:Buffer|undefined,rewardKey:Buffer|undefined,ledger:RewardLedger|undefined;
  // 폴더 생성 직후 등록하여 키/원장/claim/Inbox 초기화 실패에서도 생성된 자원을 정리합니다.
  cleanups.push(()=>{
    let failed=false;const attempt=(action:()=>void)=>{try{action();}catch{failed=true;}};
    dbs.forEach(d=>attempt(()=>d.close()));boxes.forEach(b=>attempt(()=>b.close()));attempt(()=>ledger?.close());
    key?.fill(0);rewardKey?.fill(0);attempt(()=>rmSync(dir,{recursive:true,force:true}));if(failed)throw new Error('검사 자원 정리 실패');
  });
  const inboxKey=key=randomBytes(32),ledgerKey=rewardKey=randomBytes(32);let now=epoch;
  const transport=vi.fn<typeof fetch>(async()=>keyResponse());
  const rewardOptions={databasePath:rewardPath,serverKey:ledgerKey,policy,dependencies:{now:()=>now,transport}};
  ledger=new RewardLedger(rewardOptions);const owner={ownerId:'synthetic-node-owner',roundId:'synthetic-node-round'};
  const claim=ledger.issueClaim(owner,policy.adUnits[0]);if(claim.kind!=='claim-issued')throw new Error('검사 claim 오류');
  const raw=callback({custom_data:claim.customData,user_id:claim.userId});
  function open(maxRows=100){const box=new CallbackInbox({databasePath:path,encryptionKey:inboxKey,policy,now:()=>now,maxRows,rewardLedger:rewardOptions});boxes.push(box);return box;}
  function db(p=path){const value=new DatabaseSync(p);dbs.push(value);return value;}
  return {open,db,raw,owner,ledger,transport,rewardPath,setTime:(value:number)=>now=value};
}

describe('SSV 실제 Node wire와 최적화 빈 요청',()=>{
  it.each([false,true])('최적화=%s × CL 없음/0, 정상 req.closed 뒤 같은 keep-alive 재사용',async optimize=>{
    const h=await host(()=>ok,{},optimize),agent=h.agent(),a=await h.send(''+CALLBACK_PATH+'?x',{agent}),b=await h.send(CALLBACK_PATH+'?x',{agent});
    expect(a.status).toBe(200);expect(b.status).toBe(200);expect(a.socket).toBe(b.socket);expect(h.calls).toHaveLength(2);
    const r=await h.raw();r.socket.write(rawGet(undefined,['Content-Length: 0','Connection: close']));await r.done;
    expect(h.calls).toHaveLength(3);expect(h.calls.every(v=>v.method==='GET'&&v.bodyBytes===0)).toBe(true);expect(r.text()).toContain('200 OK');
    expect(h.observed.every(v=>v.req.complete)).toBe(true);
  });
  it.each(['target','headers'])('최적화 조기 %s 거절은 close 생략 req의 슬롯을 반환',async kind=>{
    const h=await host(()=>ok,{maxConcurrent:1},true),r=await h.raw();
    r.socket.write(rawGet(kind==='target'?'/'+ 'a'.repeat(limits.targetBytes):undefined,kind==='headers'?Array.from({length:32},(_,i)=>'X-'+i+': v'):[]));await r.done;
    await until(()=>expect(h.observed[0].res.closed).toBe(true));expect(h.calls).toHaveLength(0);expect((await h.send()).status).toBe(200);
  });
  it.each(['socket','factory'])('최적화 microtask 전 %s 종료는 adapter0',async mode=>{
    const h=await host(()=>ok,{maxConcurrent:1},true);h.server.once('request',req=>{if(mode==='socket')req.socket.destroy();else h.boundary.close();});
    const r=await h.raw();r.socket.write(rawGet());await r.done;expect(h.calls).toHaveLength(0);expect(h.server.listening).toBe(true);
    if(mode==='socket'){await until(()=>expect(h.observed[0].res.closed).toBe(true));expect((await h.send()).status).toBe(200);}
  });
  it('raw target 순서·signature bytes 보존, snapshot 이후 재가공 없음',async()=>{
    const raw=callback(),h=await host(()=>ok),r=await h.raw(),target=CALLBACK_PATH+'?'+raw;
    r.socket.write(rawGet(target,['x-Mixed: one','X-mIXED: two','Connection: close']));await r.done;
    expect(h.calls).toHaveLength(1);expect(h.calls[0].target===target).toBe(true);expect(Object.keys(h.calls[0]).sort()).toEqual(['bodyBytes','method','target']);
  });
  it.each(['Transfer-Encoding: chunked','Content-Encoding: identity','Trailer: X-End'])('wire %s는 adapter 전에 거절',async header=>{
    const h=await host(()=>ok),r=await h.raw();r.socket.write(rawGet(undefined,[header])+(header.startsWith('Transfer')?'0\r\n\r\n':''));await r.done;
    expect(h.observed).toHaveLength(1);expect(h.calls).toHaveLength(0);
  });
  it.each(['Content-Length: 1','Content-Length: 999999999999999999999'])('wire 양수 %s는 본문 없이 즉시 거절',async header=>{
    const h=await host(()=>ok),r=await h.raw();r.socket.write(rawGet(undefined,[header]));await r.done;expect(h.calls).toHaveLength(0);
  });
  it.each([
    {headers:['Content-Length: 0','Content-Length: 0']},{headers:['Content-Length: 0','Transfer-Encoding: chunked']},{headers:['Content-Length: invalid']},
  ])('native parser framing 거절 %#는 listener와 구분',async({headers})=>{
    const h=await host(()=>ok),r=await h.raw();r.socket.write(rawGet(undefined,headers));await r.done;
    expect(h.observed).toHaveLength(0);expect(h.calls).toHaveLength(0);expect(r.text()).toContain('400 Bad Request');
  });
  it.each(['target','count','name','value','total'])('wire %s 상한+1은 adapter0',async kind=>{
    const h=await host(()=>ok),r=await h.raw();let headers:string[]=[];
    if(kind==='count')headers=Array.from({length:32},(_,i)=>'X-'+i+': v');
    if(kind==='name')headers=['X'.repeat(65)+': v'];if(kind==='value')headers=['X: '+'v'.repeat(4097)];
    if(kind==='total')headers=['X: '+'a'.repeat(4096),'Y: '+'b'.repeat(4096)];
    r.socket.write(rawGet(kind==='target'?'/'+ 'x'.repeat(limits.targetBytes):undefined,headers));await r.done;
    expect(h.observed).toHaveLength(1);expect(h.calls).toHaveLength(0);
  });
  it.each(['target','count','name','value','total'])('실제wire %s 상한-1/정확상한/상한+1',async kind=>{
    const bound=kind==='target'?limits.targetBytes:kind==='count'?limits.headerCount:kind==='name'?limits.headerNameBytes:kind==='value'?limits.headerValueBytes:limits.headerBytes;
    const h=await host(()=>ok);
    for(const delta of [-1,0,1]){
      const r=await h.raw(),n=bound+delta;let headers:string[]=['Connection: close'];
      if(kind==='count')headers.push(...Array.from({length:n-2},(_,i)=>'X-'+i+': v'));
      if(kind==='name')headers.push('X'.repeat(n)+': v');if(kind==='value')headers.push('X: '+'v'.repeat(n));
      // Host: local(13), Connection: close(19), X/Y overhead(10) 합계를 포함합니다.
      if(kind==='total')headers.push('X: '+'a'.repeat(4090),'Y: '+'b'.repeat(n-4132));
      const before=h.calls.length;r.socket.write(rawGet(kind==='target'?'/'+ 'x'.repeat(n-1):undefined,headers));await r.done;
      expect(h.calls.length-before).toBe(delta===1?0:1);if(delta!==1)expect(r.text()).toContain('200 OK');
    }
  });
  it('잘린 헤더는 host/parser 범위이며 listener 호출 전 단절',async()=>{
    const h=await host(()=>ok),r=await h.raw();r.socket.write('GET '+CALLBACK_PATH+'?x HTTP/1.1\r\nHost:');await pause(10);r.socket.destroy();await r.done;
    expect(h.observed).toHaveLength(0);expect(h.calls).toHaveLength(0);
  });
  it('실제 end 내부 writeHead 예외는 평문503으로 한 번 복구',async()=>{
    const h=await host(()=>ok);h.server.prependListener('request',(_req,res)=>{
      const original=res.writeHead;let first=true;
      res.writeHead=(function(this:ServerResponse,...args:unknown[]){if(first){first=false;throw new Error('synthetic-private');}return original.apply(this,args as Parameters<ServerResponse['writeHead']>);}) as ServerResponse['writeHead'];
    });
    const result=await h.send();expect(result.status).toBe(503);expect(result.body).toBe('unavailable');
  });
  it('HEAD의405는 UTF8 CL만 보내며 본문 없음·CORS 없음',async()=>{
    const f=inboxFixture(),box=f.open(),h=await host(createCallbackHttpAdapter(box)),result=await h.send(CALLBACK_PATH,{method:'HEAD'});
    expect(result.status).toBe(405);expect(result.body).toBe('');expect(result.headers.allow).toBe('GET');expect(result.headers['content-length']).toBe('8');
    expect(result.headers).not.toHaveProperty('access-control-allow-origin');
  });
});

describe('실제 Inbox 내구 ACK와 서명/보상 분리',()=>{
  it('COMMIT에서만 실패하면503·신규행0, 복구200은 수신뿐',async()=>{
    const f=inboxFixture(),box=f.open(),d=f.db(),h=await host(createCallbackHttpAdapter(box));
    d.exec("CREATE TABLE commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_child(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail_commit AFTER INSERT ON callback_inbox BEGIN INSERT INTO commit_child VALUES(1); END");
    expect((await h.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(503);expect(d.prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(0);
    expect(d.prepare('SELECT high_water FROM callback_meta').get()?.high_water).toBe(0);
    d.exec('DROP TRIGGER fail_commit; DROP TABLE commit_child; DROP TABLE commit_parent');
    const result=await h.send(CALLBACK_PATH+'?'+f.raw);expect(result.status).toBe(200);expect(result.body).toBe('received');expect(f.transport).not.toHaveBeenCalled();
    expect(f.ledger.hasVoucher(f.owner)).toEqual({kind:'voucher-status',present:false});
  });
  it('실제 Inbox 재시작 뒤 terminal 중복200·행/attempt/보상권 증가0',async()=>{
    const f=inboxFixture(),first=f.open(),h=await host(createCallbackHttpAdapter(first));
    expect((await h.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(200);expect(await first.processNext()).toEqual({kind:'completed'});first.close();
    const next=f.open(),h2=await host(createCallbackHttpAdapter(next));expect((await h2.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(200);
    const d=f.db();expect(d.prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(1);expect(d.prepare('SELECT attempts FROM callback_inbox').get()?.attempts).toBe(1);
    expect(f.db(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(1);
  });
  it('구조 적합 오서명200→worker discarded·실원장 보상0',async()=>{
    const f=inboxFixture(),box=f.open(),h=await host(createCallbackHttpAdapter(box)),bad=f.raw.replace('reward_item=moves','reward_item=other');
    expect((await h.send(CALLBACK_PATH+'?'+bad)).status).toBe(200);expect(f.transport).not.toHaveBeenCalled();expect(await box.processNext()).toEqual({kind:'discarded'});
    expect(f.db().prepare('SELECT state,attempts FROM callback_inbox').get()).toEqual({state:'discarded',attempts:1});
    expect(f.ledger.hasVoucher(f.owner)).toEqual({kind:'voucher-status',present:false});expect(f.db(f.rewardPath).prepare('SELECT count(*) AS n FROM reward_vouchers').get()?.n).toBe(0);
  });
  it.each(['%20','+','&extra=x','?','#'])('query suffix %s와 순서 변경은 변환 없이400',async suffix=>{
    const f=inboxFixture(),box=f.open(),h=await host(createCallbackHttpAdapter(box)),r=await h.raw();r.socket.write(rawGet(CALLBACK_PATH+'?'+f.raw+suffix,['Connection: close']));await r.done;
    expect(r.text()).toContain('400 Bad Request');expect(f.db().prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(0);
  });
  it('query 필드 순서 변경400·path404·GET이외405 유지',async()=>{
    const f=inboxFixture(),box=f.open(),h=await host(createCallbackHttpAdapter(box)),parts=f.raw.split('&');[parts[0],parts[1]]=[parts[1],parts[0]];
    expect((await h.send(CALLBACK_PATH+'?'+parts.join('&'))).status).toBe(400);expect((await h.send('/other?x')).status).toBe(404);
    expect((await h.send(CALLBACK_PATH,{method:'POST'})).status).toBe(405);expect((await h.send(CALLBACK_PATH)).status).toBe(400);
  });
  it('capacity·clock·closed Inbox503, factory close는 외부 Inbox/server 생존',async()=>{
    const f=inboxFixture(),box=f.open(1),h=await host(createCallbackHttpAdapter(box));expect((await h.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(200);
    expect((await h.send(CALLBACK_PATH+'?'+callback())).status).toBe(503);expect((await h.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(200);
    f.setTime(epoch-1);expect((await h.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(503);f.setTime(epoch);
    h.boundary.close();h.boundary.close();expect(h.server.listening).toBe(true);expect(box.receive(f.raw).kind).toBe('accepted');
    const h2=await host(createCallbackHttpAdapter(box));box.close();expect((await h2.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(503);
  });
  it('실제 COMMIT 뒤 절대기한 초과는503이어도 저장행 유지·동일원문 복구',async()=>{
    const f=inboxFixture(),box=f.open(),adapter=createCallbackHttpAdapter(box);
    const transport=fixture(input=>{const result=adapter(input),until=performance.now()+20;while(performance.now()<until){}return result;},{deadlineMs:5});
    transport.req.url=CALLBACK_PATH+'?'+f.raw;transport.enter();transport.end();expect(transport.res.statusCode).toBe(503);
    expect(f.db().prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(1);const h=await host(adapter);
    expect((await h.send(CALLBACK_PATH+'?'+f.raw)).status).toBe(200);expect(f.db().prepare('SELECT count(*) AS n FROM callback_inbox').get()?.n).toBe(1);
  });
  it('원문·서명·계정필드·오류는 응답/console에 노출하지 않음',async()=>{
    const f=inboxFixture(),box=f.open(),logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')],h=await host(createCallbackHttpAdapter(box));
    const a=await h.send(CALLBACK_PATH+'?'+f.raw),b=await h.send(CALLBACK_PATH+'?bad');
    expect([a.body,b.body]).toEqual(['received','rejected']);logs.forEach(log=>expect(log).not.toHaveBeenCalled());
  });
});

describe('동기 adapter 수명·기한·상한·쓰기 합성 경계',()=>{
  it.each([0,33,1.5,NaN,Infinity,'8',null])('maxConcurrent=%s 거절',value=>{expect(()=>createCallbackNodeListener(()=>ok,{maxConcurrent:value as number})).toThrow('invalid-callback-node-listener-config');});
  it.each([0,30001,1.5,NaN,Infinity,'10000',null])('deadlineMs=%s 거절',value=>{expect(()=>createCallbackNodeListener(()=>ok,{deadlineMs:value as number})).toThrow('invalid-callback-node-listener-config');});
  it.each([null,[],{extra:1},new Proxy({},{}),Object.create({deadlineMs:1}),Object.defineProperty({},'deadlineMs',{get:()=>{throw new Error('private');}})])('구성 형태 %# 거절',options=>{
    expect(()=>createCallbackNodeListener(()=>ok,options as CallbackNodeListenerOptions)).toThrow('invalid-callback-node-listener-config');
  });
  it('구성 snapshot/양끝/default, 함수proxy·비함수는 거절',()=>{
    for(const options of [{},{maxConcurrent:1,deadlineMs:1},{maxConcurrent:32,deadlineMs:30000}]){const b=createCallbackNodeListener(()=>ok,options);b.close();b.close();}
    for(const adapter of [null,new Proxy(()=>ok,{})])expect(()=>createCallbackNodeListener(adapter as CallbackNodeAdapter)).toThrow('invalid-callback-node-listener-config');
    const options={maxConcurrent:1,deadlineMs:10000},f=fixture(()=>ok,options,false);options.maxConcurrent=32;f.enter();f.end();const g=fixture(()=>ok);f.boundary.listener(g.req,g.res);expect(g.res.statusCode).toBe(503);
  });
  it.each([Buffer.alloc(1),Buffer.alloc(8192),'x'])('실제 nonzero/string chunk %#는 adapter 전 거절',chunk=>{
    const adapter=vi.fn(()=>ok),f=fixture(adapter);f.enter();f.req.emit('data',chunk);f.end();expect(adapter).not.toHaveBeenCalled();expect(f.res.statusCode).toBe(typeof chunk==='string'?400:413);
  });
  it.each(['1','999999999999999999999999999999999999'])('양수 CL %s는413',value=>{const a=vi.fn(()=>ok),f=fixture(a);f.req.rawHeaders=['Content-Length',value];f.enter();expect(f.res.statusCode).toBe(413);expect(a).not.toHaveBeenCalled();});
  it.each(['00','01','+0','-0',' 0','0 ','0, 0','x',''])('비정상 CL %s는400',value=>{const a=vi.fn(()=>ok),f=fixture(a);f.req.rawHeaders=['Content-Length',value];f.enter();expect(f.res.statusCode).toBe(400);expect(a).not.toHaveBeenCalled();});
  it.each([['0','0'],['1','1'],['1','0'],['0','1']])('중복 CL %s/%s는양수선언보다우선400',(first,second)=>{
    const a=vi.fn(()=>ok),f=fixture(a);f.req.rawHeaders=['Content-Length',first,'content-length',second];f.enter();expect(f.res.statusCode).toBe(400);expect(a).not.toHaveBeenCalled();
  });
  it('중복 CL0/홀수헤더/누락target/트레일러/미완성end/abort 거절',()=>{
    for(const kind of ['duplicate','odd','target','trailer','incomplete','abort']){
      const a=vi.fn(()=>ok),f=fixture(a);if(kind==='duplicate')f.req.rawHeaders=['Content-Length','0','content-length','0'];if(kind==='odd')f.req.rawHeaders=['Host'];
      if(kind==='target')f.req.url=undefined;if(kind==='trailer')f.req.rawTrailers=['X','v'];if(kind==='abort')f.req.aborted=true;
      f.enter();f.end(kind!=='incomplete');expect(a).not.toHaveBeenCalled();expect(f.res.destroyed).toBe(true);
    }
  });
  it.each(['target','count','name','value','total'])('%s 상한-1/정확상한 통과·+1 거절',kind=>{
    const bound=kind==='target'?limits.targetBytes:kind==='count'?limits.headerCount:kind==='name'?limits.headerNameBytes:kind==='value'?limits.headerValueBytes:limits.headerBytes;
    for(const delta of [-1,0,1]){
      const a=vi.fn(()=>ok),f=fixture(a),n=bound+delta;
      if(kind==='target')f.req.url='x'.repeat(n);if(kind==='count')f.req.rawHeaders=Array.from({length:n},()=>['X','v']).flat();
      if(kind==='name')f.req.rawHeaders=['X'.repeat(n),'v'];if(kind==='value')f.req.rawHeaders=['X','v'.repeat(n)];
      if(kind==='total')f.req.rawHeaders=['X','a'.repeat(4090),'Y','b'.repeat(n-4100)];
      f.enter();f.end();expect(a.mock.calls.length).toBe(delta===1?0:1);if(delta===1)expect(f.res.statusCode).toBe(413);
    }
  });
  it('raw method/target/header는진입snapshot, 헤더변경은프레이밍판정에영향없음',()=>{
    const a=vi.fn<CallbackNodeAdapter>(()=>ok),f=fixture(a);f.req.rawHeaders=['Content-Length','0'];f.enter();f.req.method='POST';f.req.url='/changed';f.req.rawHeaders[1]='9';f.req.emit('data',Buffer.alloc(0));f.end();
    expect(a).toHaveBeenCalledOnce();expect(a.mock.calls[0][0]).toEqual({method:'GET',target:CALLBACK_PATH+'?x',bodyBytes:0});
  });
  it('기본8슬롯/queue0, 수신완료 전 미호출·완료 뒤 반환',async()=>{
    const a=vi.fn(()=>ok),boundary=createCallbackNodeListener(a),requests=Array.from({length:9},()=>fixture(()=>ok));
    cleanups.push(()=>boundary.close());for(const f of requests)boundary.listener(f.req,f.res);expect(a).not.toHaveBeenCalled();expect(requests[8].res.statusCode).toBe(503);
    requests[0].end();await Promise.resolve();const next=fixture(()=>ok);boundary.listener(next.req,next.res);next.end();expect(a).toHaveBeenCalledTimes(2);
  });
  it('동기adapter 종료 뒤 응답finish 전 슬롯유지·timeout두번째응답없음',async()=>{
    const a=vi.fn(()=>ok),f=fixture(a,{maxConcurrent:1,deadlineMs:20},false);f.enter();f.end();expect(a).toHaveBeenCalledOnce();
    const g=fixture(()=>ok);f.boundary.listener(g.req,g.res);expect(g.res.statusCode).toBe(503);await pause(35);expect(f.res.destroyed).toBe(true);expect(f.output).toEqual(['received']);
    const next=fixture(()=>ok);f.boundary.listener(next.req,next.res);next.end();expect(a).toHaveBeenCalledTimes(2);
  });
  it('느린/빈chunk는 절대기한을 연장하지 않고 adapter0·slot재사용',async()=>{
    const a=vi.fn(()=>ok),f=fixture(a,{maxConcurrent:1,deadlineMs:50});f.enter();await pause(20);f.req.emit('data',Buffer.alloc(0));await pause(45);
    expect(a).not.toHaveBeenCalled();expect(f.res.destroyed).toBe(true);const g=fixture(()=>ok);f.boundary.listener(g.req,g.res);g.end();expect(a).toHaveBeenCalledOnce();
  });
  it('timer보다늦은end와동기adapter의기한초과를monotonic검사',()=>{
    const a=vi.fn(()=>ok),f=fixture(a,{deadlineMs:5});f.enter();let until=performance.now()+15;while(performance.now()<until){}f.end();expect(a).not.toHaveBeenCalled();expect(f.res.statusCode).toBe(503);
    const g=fixture(()=>{const end=performance.now()+15;while(performance.now()<end){}return ok;},{deadlineMs:5});g.enter();g.end();expect(g.output).toEqual(['unavailable']);
  });
  it('동기adapter 안의 재진입close는 종료까지슬롯보존·200금지',()=>{
    let f:ReturnType<typeof fixture>;const a=vi.fn(()=>{f.boundary.close();f.req.emit('close');f.res.emit('close');return ok;});f=fixture(a);f.enter();f.end();expect(a).toHaveBeenCalledOnce();expect(f.output).toEqual(['unavailable']);
  });
  it('이미closed 최적화에서complete microtask후단1회·중복end무시',async()=>{
    const a=vi.fn(()=>ok),f=fixture(a);Object.assign(f.req,{closed:true,destroyed:true,readableEnded:true});f.enter();expect(a).not.toHaveBeenCalled();f.req.complete=true;await Promise.resolve();f.req.emit('end');expect(a).toHaveBeenCalledOnce();expect(f.output).toEqual(['received']);
  });
  it('microtask후여전히미완료는반복예약없이기한종료',async()=>{
    const a=vi.fn(()=>ok),f=fixture(a,{deadlineMs:15});Object.assign(f.req,{closed:true,destroyed:true,readableEnded:true});f.enter();await Promise.resolve();expect(a).not.toHaveBeenCalled();await pause(25);expect(f.res.destroyed).toBe(true);expect(a).not.toHaveBeenCalled();
  });
  it.each(['setHeader','writeHead','end'])('%s 첫예외복구는고정503/이전헤더제거',method=>{
    const f=fixture(()=>({...ok,headers:{'x-private':'synthetic-private'},body:'synthetic-private'}));
    const original=(f.res as unknown as Record<string,Function>)[method];let first=true;(f.res as unknown as Record<string,unknown>)[method]=function(...args:unknown[]){if(first){first=false;throw new Error('synthetic-private');}return original.apply(f.res,args);};
    f.enter();f.end();expect(f.output).toEqual(['unavailable']);expect(f.headers.has('x-private')).toBe(false);
  });
  it.each(['sent','ended','destroyed'])('%s응답에는추가본문없음',state=>{
    const f=fixture(()=>ok);f.enter();Object.assign(f.res,state==='sent'?{headersSent:true}:state==='ended'?{writableEnded:true}:{destroyed:true});f.end();expect(f.output).toEqual([]);expect(f.res.destroyed).toBe(true);
  });
  it('부분end예외·비동기error·중복close는두번째응답없음',async()=>{
    const f=fixture(()=>ok,{},false);f.res.end=(()=>{Object.assign(f.res,{headersSent:true});throw new Error('synthetic-private');}) as ServerResponse['end'];f.enter();f.end();expect(f.output).toEqual([]);
    const g=fixture(()=>ok,{},false);g.enter();g.end();g.res.emit('error',new Error('synthetic-private'));await Promise.resolve();g.res.emit('close');g.req.emit('close');expect(g.output).toEqual(['received']);expect(g.res.destroyed).toBe(true);
  });
  it('동기throw·UTF8CL·HEAD·프레이밍listener소유·에러비노출',()=>{
    const f=fixture(()=>{throw new Error('synthetic-private');});f.enter();f.end();expect(f.output).toEqual(['unavailable']);
    const g=fixture(()=>({...ok,body:'한글🌸',headers:{'content-length':'999','transfer-encoding':'chunked',connection:'close'}}));g.enter();g.end();expect(g.headers.get('content-length')).toBe(10);expect(g.headers.has('transfer-encoding')).toBe(false);expect(g.headers.has('connection')).toBe(false);
    const head=fixture(()=>ok);head.req.method='HEAD';head.enter();head.end();expect(head.output).toEqual([]);expect(head.headers.get('content-length')).toBe(8);
  });
  it('멱등close와정상finish는타이머0·정상keepalive파괴없음',async()=>{
    vi.useFakeTimers();const f=fixture(()=>ok,{},false);f.enter();f.end();f.finish();vi.runAllTicks();expect(vi.getTimerCount()).toBe(0);expect(f.res.destroyed).toBe(false);
    f.boundary.close();f.boundary.close();expect(f.res.destroyed).toBe(false);const g=fixture(()=>ok);f.boundary.listener(g.req,g.res);expect(g.res.statusCode).toBe(503);await Promise.resolve();
  });
  it('수신중request error/불완전close/response close는adapter0·기한정리',async()=>{
    for(const mode of ['request-error','request-close','response-close']){
      const a=vi.fn(()=>ok),f=fixture(a);f.enter();if(mode==='request-error')f.req.emit('error',new Error('synthetic-private'));if(mode==='request-close')f.req.emit('close');if(mode==='response-close')f.res.emit('close');
      f.end();await Promise.resolve();expect(a).not.toHaveBeenCalled();expect(f.res.destroyed).toBe(true);
    }
  });
});
