import {afterEach,describe,expect,it,vi} from 'vitest';
import {Agent,createServer,request,type IncomingMessage,type ServerOptions,type ServerResponse} from 'node:http';
import {createConnection,type Socket} from 'node:net';
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import {createGameNodeListener,type GameNodeAdapter,type GameNodeListenerOptions} from '../server/game/gameNodeListener';
import {createGameHttpAdapter,type GameHttpRequest,type GameHttpResponse} from '../server/game/gameHttp';
import {GameService} from '../server/game/gameService';

const ok:GameHttpResponse={status:200,headers:{'content-type':'application/json'},body:'{"ok":true}'};
const cleanups:(()=>Promise<void>)[]=[],releases:(()=>void)[]=[];
function deferred(){
  let resolve!:(value:GameHttpResponse)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<GameHttpResponse>((yes,no)=>{resolve=yes;reject=no;});
  releases.push(()=>resolve(ok));return {promise,resolve,reject};
}
async function host(adapter:GameNodeAdapter,options:GameNodeListenerOptions={},optimizeEmptyRequests=false){
  const calls:GameHttpRequest[]=[],operations:Promise<GameHttpResponse>[]=[],sockets=new Set<Socket>(),clients=new Set<Socket>(),agents:Agent[]=[];
  const boundary=createGameNodeListener(input=>{calls.push(input);const p=adapter(input);operations.push(p);void p.catch(()=>{});return p;},options);
  const observed:{req:IncomingMessage;res:ServerResponse}[]=[];
  // 크기 경계는 listener를 검사하도록 parser 상한을 넓힙니다. 공개 호스트 설정을 제안하는 값이 아닙니다.
  const config:ServerOptions&{optimizeEmptyRequests:boolean}={maxHeaderSize:65536,rejectNonStandardBodyWrites:true,optimizeEmptyRequests};
  const server=createServer(config,(req,res)=>{observed.push({req,res});boundary.listener(req,res);});
  server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('검사 포트 오류');
  const port=address.port;
  cleanups.push(async()=>{
    boundary.close();for(const agent of agents)agent.destroy();for(const socket of clients)socket.destroy();for(const socket of sockets)socket.destroy();
    await Promise.allSettled(operations);await new Promise<void>(resolve=>server.close(()=>resolve()));
  });
  function track(socket:Socket){clients.add(socket);socket.once('close',()=>clients.delete(socket));}
  function agent(){const value=new Agent({keepAlive:true,maxSockets:1});agents.push(value);return value;}
  function send(body='{}',extra:{method?:string;headers?:Record<string,string>;agent?:Agent;path?:string}={}){
    return new Promise<{status:number;headers:IncomingMessage['headers'];body:string;socket:Socket|null}>((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port,path:extra.path??'/v1/rounds/get',method:extra.method??'POST',agent:extra.agent??false,
        headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),...extra.headers}},res=>{
        const chunks:Buffer[]=[];const socket=res.socket;res.on('data',c=>chunks.push(c));res.on('error',reject);
        res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks).toString(),socket}));
      });req.on('socket',track);req.on('error',reject);req.end(body);
    });
  }
  async function raw(){
    const socket=createConnection({host:'127.0.0.1',port}),chunks:Buffer[]=[];
    track(socket);
    socket.on('error',()=>{});socket.on('data',chunk=>chunks.push(chunk));
    const done=new Promise<void>(resolve=>socket.once('close',()=>resolve()));
    await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    return {socket,done,text:()=>Buffer.concat(chunks).toString()};
  }
  return {boundary,server,calls,observed,send,raw,agent};
}
afterEach(async()=>{
  for(const release of releases.splice(0))release();
  for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.restoreAllMocks();vi.useRealTimers();
});
const until=async(check:()=>void)=>vi.waitFor(check,{timeout:2000,interval:5});
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const rawPost=(headers:string[]=[],length=2)=>['POST /v1/rounds/get HTTP/1.1','Host: local','Content-Type: application/json','Content-Length: '+length,...headers,'',''].join('\r\n');

describe('실제 Node HTTP/parser wire',()=>{
  it('정상 req.close/destroyed 뒤 지연 성공과 같은 keep-alive 연결의 두 번째 요청',async()=>{
    const gate=deferred();let first=true;
    const h=await host(async()=>{if(first){first=false;return gate.promise;}return ok;}),agent=h.agent();
    const pending=h.send('{}',{agent});void pending.catch(()=>{});
    await until(()=>{expect(h.calls).toHaveLength(1);expect(h.observed[0].req.closed).toBe(true);});
    expect(h.observed[0].req.destroyed).toBe(true);expect(h.calls[0].signal?.aborted).toBe(false);
    gate.resolve(ok);const a=await pending,b=await h.send('{}',{agent});
    expect(a.status).toBe(200);expect(b.status).toBe(200);expect(a.socket).toBe(b.socket);
    expect(h.observed[0].req.socket).toBe(h.observed[1].req.socket);
  });
  it('rawHeaders의 쌍·순서·대소문자·중복 및 raw target을 보존',async()=>{
    const h=await host(async()=>ok),r=await h.raw();
    r.socket.write(rawPost(['Authorization: Bearer synthetic-a','aUtHoRiZaTiOn: Bearer synthetic-b','Connection: close'])+'{}');await r.done;
    expect(h.calls[0].headers).toEqual([['Host','local'],['Content-Type','application/json'],['Content-Length','2'],
      ['Authorization','Bearer synthetic-a'],['aUtHoRiZaTiOn','Bearer synthetic-b'],['Connection','close']]);
    expect(h.calls[0].target).toBe('/v1/rounds/get');expect(Buffer.from(h.calls[0].body as Uint8Array).toString()).toBe('{}');
  });
  it('실제 기존 adapter가 중복 Authorization을 서비스 호출 없이 거절',async()=>{
    // 입력 거절 전용 prototype fixture입니다. 실제 service 초기화/DB/인증 성공 검사가 아닙니다.
    const service=Object.create(GameService.prototype) as GameService,adapter=createGameHttpAdapter(service);
    const h=await host(adapter),r=await h.raw();
    r.socket.write(rawPost(['Authorization: Bearer synthetic-a','AUTHORIZATION: Bearer synthetic-b','Connection: close'])+'{}');await r.done;
    expect(r.text()).toContain('400 Bad Request');expect(r.text()).toContain('invalid-request');expect(r.text()).not.toContain('synthetic-a');
  });
  it('8192 bytes를 분할 수신하고 end/complete 전에는 adapter를 호출하지 않음',async()=>{
    const h=await host(async()=>ok),r=await h.raw();r.socket.write(rawPost(['Connection: close'],8192)+'a'.repeat(4096));
    await until(()=>expect(h.observed).toHaveLength(1));await pause(15);expect(h.calls).toHaveLength(0);
    r.socket.write('b'.repeat(4096));await r.done;expect(h.calls).toHaveLength(1);
    expect(Buffer.from(h.calls[0].body as Uint8Array)).toEqual(Buffer.from('a'.repeat(4096)+'b'.repeat(4096)));expect(h.observed[0].req.complete).toBe(true);
  });
  it('선언8193은 본문을 기다리지 않고 거절·실제 분할 초과는 합성 fixture에서 확인',async()=>{
    const h=await host(async()=>ok),r=await h.raw();r.socket.write(rawPost([],8193));await r.done;expect(h.calls).toHaveLength(0);
  });
  it.each(['Transfer-Encoding: chunked','Content-Encoding: gzip','Trailer: X-End'])('%s는 변환 없이 거절',async header=>{
    const h=await host(async()=>ok),r=await h.raw();
    // TE+CL parser 거절과 별개로, TE 단독의 listener 경로를 검사합니다.
    const message=header.startsWith('Transfer')?['POST /v1/rounds/get HTTP/1.1','Host: local',header,'','','0\r\n\r\n'].join('\r\n'):rawPost([header])+'{}';
    r.socket.write(message);await r.done;expect(h.calls).toHaveLength(0);expect(h.observed).toHaveLength(1);
  });
  it('TE와 CL 동시 지정은 실제 Node parser가 listener 이전에 거절',async()=>{
    const h=await host(async()=>ok),r=await h.raw();r.socket.write(rawPost(['Transfer-Encoding: chunked'])+'0\r\n\r\n');await r.done;
    expect(h.observed).toHaveLength(0);expect(h.calls).toHaveLength(0);expect(r.text()).toContain('400 Bad Request');
  });
  it.each([
    ['target','/'+ 'a'.repeat(128)],['count',''],['name','x'.repeat(65)],['value','v'.repeat(8193)],['total',''],
  ])('실제 wire %s 상한을 거절',async(kind,value)=>{
    const h=await host(async()=>ok),r=await h.raw();let lines:string[]=[];
    if(kind==='count')lines=Array.from({length:30},(_,i)=>'X-'+i+': v');
    if(kind==='name')lines=[value+': v'];if(kind==='value')lines=['X: '+value];if(kind==='total')lines=['X: '+'a'.repeat(8190),'Y: '+'b'.repeat(8190)];
    let message=rawPost(lines)+'{}';if(kind==='target')message=message.replace('/v1/rounds/get',value);
    r.socket.write(message);await r.done;expect(h.observed).toHaveLength(1);expect(h.calls).toHaveLength(0);
  });
  it.each(['target','count','name','value','total'])('실제 wire %s 정확한 상한은 수락',async kind=>{
    const h=await host(async()=>ok),r=await h.raw();let lines=['Connection: close'];
    if(kind==='count')lines.push(...Array.from({length:28},(_,i)=>'X-'+i+': v'));
    if(kind==='name')lines.push('x'.repeat(64)+': v');if(kind==='value')lines.push('X: '+'v'.repeat(8192));
    if(kind==='total')lines.push('X: '+'a'.repeat(8192),'Y: '+'b'.repeat(8099));
    let message=rawPost(lines)+'{}';if(kind==='target')message=message.replace('/v1/rounds/get','/'+ 'a'.repeat(127));
    r.socket.write(message);await r.done;expect(h.calls).toHaveLength(1);expect(r.text()).toContain('200 OK');
  });
  it.each([false,true])('빈 body optimizeEmptyRequests=%s는 complete 경로로 한 번 호출',async optimize=>{
    const h=await host(async()=>({...ok,status:204,body:''}),{},optimize),r=await h.raw();
    r.socket.write('OPTIONS /v1/rounds/get HTTP/1.1\r\nHost: local\r\nConnection: close\r\n\r\n');await r.done;
    expect(h.calls).toHaveLength(1);expect((h.calls[0].body as Uint8Array).byteLength).toBe(0);
    expect(r.text()).toContain('204 No Content');expect(r.text().toLowerCase()).not.toContain('content-length');expect(r.text().split('\r\n\r\n')[1]).toBe('');
  });
  it.each(['target','headers'])('최적화 빈 요청 %s 조기 거절 뒤 슬롯1개를 회수',async kind=>{
    const h=await host(async()=>ok,{maxConcurrent:1},true),r=await h.raw();
    const path=kind==='target'?'/'+ 'a'.repeat(128):'/v1/rounds/get';
    const extra=kind==='headers'?Array.from({length:32},(_,i)=>'X-'+i+': v\r\n').join(''):'';
    r.socket.write('OPTIONS '+path+' HTTP/1.1\r\nHost: local\r\n'+extra+'\r\n');await r.done;
    await until(()=>expect(h.observed[0].res.closed).toBe(true));expect(h.calls).toHaveLength(0);expect((await h.send()).status).toBe(200);expect(h.calls).toHaveLength(1);
  });
  it('최적화 빈 요청의 microtask 전 실제 socket 중단은 adapter 미호출·슬롯 반환',async()=>{
    const h=await host(async()=>ok,{maxConcurrent:1},true);h.server.once('request',req=>req.socket.destroy());const r=await h.raw();
    r.socket.write('OPTIONS /v1/rounds/get HTTP/1.1\r\nHost: local\r\n\r\n');await r.done;
    await until(()=>expect(h.observed[0].res.closed).toBe(true));expect(h.calls).toHaveLength(0);expect((await h.send()).status).toBe(200);
  });
  it('최적화 빈 요청의 microtask 전 close는 adapter를 호출하지 않음',async()=>{
    const h=await host(async()=>ok,{},true);h.server.once('request',()=>h.boundary.close());const r=await h.raw();
    r.socket.write('OPTIONS /v1/rounds/get HTTP/1.1\r\nHost: local\r\n\r\n');await r.done;expect(h.calls).toHaveLength(0);expect(h.server.listening).toBe(true);
  });
  it('204/HEAD는 rejectNonStandardBodyWrites에서도 본문을 쓰지 않고 UTF8 CL은 byte 길이',async()=>{
    const h=await host(async input=>({...ok,status:input.method==='OPTIONS'?204:200,body:'한글🌸'}));
    const normal=await h.send(),head=await h.send('',{method:'HEAD'}),empty=await h.send('',{method:'OPTIONS'});
    expect(normal.body).toBe('한글🌸');expect(normal.headers['content-length']).toBe('10');expect(head.body).toBe('');
    expect(head.headers['content-length']).toBe('10');expect(empty.body).toBe('');expect(empty.headers).not.toHaveProperty('content-length');
  });
  it('본문 중 단절은 adapter를 호출하지 않고 다음 요청 슬롯을 반환',async()=>{
    const h=await host(async()=>ok,{maxConcurrent:1}),r=await h.raw();r.socket.write(rawPost([],20)+'{');
    await until(()=>expect(h.observed).toHaveLength(1));r.socket.destroy();await r.done;
    await until(()=>expect(h.observed[0].res.destroyed).toBe(true));await pause(5);expect(h.calls).toHaveLength(0);expect((await h.send()).status).toBe(200);
  });
  it.each(['resolve','reject'])('본문 완료 뒤 단절·늦은 %s 전에는 슬롯을 재사용하지 않음',async mode=>{
    const gate=deferred();let count=0;
    const h=await host(async()=>++count===1?gate.promise:ok,{maxConcurrent:1}),r=await h.raw();r.socket.write(rawPost()+'{}');
    await until(()=>expect(h.calls).toHaveLength(1));r.socket.destroy();await r.done;
    await until(()=>expect(h.calls[0].signal?.aborted).toBe(true));
    const saturated=h.send().catch(()=>null);const rejected=await saturated;if(rejected)expect(rejected.status).toBe(503);expect(h.calls).toHaveLength(1);
    if(mode==='resolve')gate.resolve(ok);else gate.reject(new Error('synthetic-private-error'));await pause(10);
    expect((await h.send()).status).toBe(200);expect(h.calls).toHaveLength(2);
  });
  it('호스트 부분 응답 주입 뒤 실제 peer 단절은 조기 res.close로 취소',async()=>{
    const gate=deferred(),h=await host(async()=>gate.promise);
    // loopback OS 버퍼 크기에 의존하지 않도록 호스트가 실제 wire에 부분 응답을 먼저 씁니다.
    h.server.prependListener('request',(_req,res)=>{res.writeHead(200,{'content-length':'10'});res.write('first');});
    const r=await h.raw();r.socket.write(rawPost()+'{}');
    await until(()=>{expect(h.calls).toHaveLength(1);expect(r.text()).toContain('first');expect(h.observed[0].res.writableFinished).toBe(false);});
    r.socket.destroy();await r.done;await until(()=>expect(h.calls[0].signal?.aborted).toBe(true));gate.resolve(ok);
  });
  it('실제 ServerResponse.end 내부 writeHead 첫 예외는 고정 오류로 복구',async()=>{
    const h=await host(async()=>ok);
    h.server.prependListener('request',(_req,res)=>{
      const original=res.writeHead;let first=true;
      res.writeHead=(function(this:ServerResponse,...args:unknown[]){if(first){first=false;throw new Error('synthetic-private');}return original.apply(this,args as Parameters<ServerResponse['writeHead']>);}) as ServerResponse['writeHead'];
    });
    const result=await h.send();expect(result.status).toBe(503);expect(result.body).toBe('{"code":"unavailable"}');
  });
  it('느린 본문 chunk가 절대 기한을 연장하지 않음',async()=>{
    const h=await host(async()=>ok,{deadlineMs:90}),r=await h.raw();const started=performance.now();r.socket.write(rawPost([],20)+'a');
    await until(()=>expect(h.observed).toHaveLength(1));await pause(35);r.socket.write('b');await pause(35);r.socket.write('c');await r.done;
    expect(h.calls).toHaveLength(0);expect(performance.now()-started).toBeLessThan(1500);
  });
  it.each(['resolve','reject'])('timeout 뒤 늦은 %s까지 슬롯 유지·두 번째 응답 없음',async mode=>{
    const gate=deferred();let count=0;
    const h=await host(async()=>++count===1?gate.promise:ok,{maxConcurrent:1,deadlineMs:60}),r=await h.raw();r.socket.write(rawPost()+'{}');
    await until(()=>expect(h.calls).toHaveLength(1));await r.done;expect(h.calls[0].signal?.aborted).toBe(true);const text=r.text();
    await h.send().catch(()=>null);expect(h.calls).toHaveLength(1);
    if(mode==='resolve')gate.resolve(ok);else gate.reject(new Error('synthetic-private-error'));await pause(10);
    expect(r.text()).toBe(text);expect(text).not.toContain('synthetic-private');expect((await h.send()).status).toBe(200);
  });
  it('수신 단계부터 포화·대기열0이며 완료 뒤 새 요청을 수락',async()=>{
    const h=await host(async()=>ok,{maxConcurrent:1}),r=await h.raw();r.socket.write(rawPost(['Connection: close'],4)+'a');
    await until(()=>expect(h.observed).toHaveLength(1));await h.send().catch(()=>null);expect(h.calls).toHaveLength(0);
    r.socket.write('bcd');await r.done;expect(h.calls).toHaveLength(1);expect((await h.send()).status).toBe(200);
  });
  it('멱등 close는 활성 취소/신규 거절만 하고 외부 server와 service를 닫지 않음',async()=>{
    const gate=deferred(),external={close:vi.fn()},h=await host(async()=>{void external;return gate.promise;}),r=await h.raw();r.socket.write(rawPost()+'{}');
    await until(()=>expect(h.calls).toHaveLength(1));h.boundary.close();h.boundary.close();await r.done;
    expect(h.calls[0].signal?.aborted).toBe(true);expect(h.server.listening).toBe(true);expect(external.close).not.toHaveBeenCalled();
    await h.send().catch(()=>null);expect(h.calls).toHaveLength(1);gate.resolve(ok);await pause(5);expect(h.server.listening).toBe(true);
  });
});

/** 실제 parser 검사가 아닌, 쓰기/이벤트 실패를 제어하는 합성 transport입니다. */
function fixture(adapter:GameNodeAdapter,options:GameNodeListenerOptions={},autoFinish=true){
  const boundary=createGameNodeListener(adapter,options),req=new EventEmitter() as IncomingMessage,res=new EventEmitter() as ServerResponse;
  Object.assign(req,{method:'POST',url:'/v1/rounds/get',rawHeaders:['Content-Length','2'],rawTrailers:[],complete:false,readableEnded:false,destroyed:false,closed:false});
  const output:string[]=[],headers=new Map<string,number|string|readonly string[]>();
  Object.assign(res,{headersSent:false,writableEnded:false,writableFinished:false,destroyed:false,closed:false,statusCode:200});
  req.pause=()=>req;req.destroy=()=>{if(!req.destroyed){Object.assign(req,{destroyed:true});queueMicrotask(()=>{Object.assign(req,{closed:true});req.emit('close');});}return req;};
  res.setHeader=(name,value)=>{headers.set(name.toLowerCase(),value);return res;};res.getHeaderNames=()=>[...headers.keys()];res.removeHeader=name=>{headers.delete(name.toLowerCase());};
  const finish=()=>{Object.assign(res,{writableFinished:true});res.emit('finish');queueMicrotask(()=>{Object.assign(res,{closed:true});res.emit('close');});};
  res.writeHead=(()=>{Object.assign(res,{headersSent:true});return res;}) as ServerResponse['writeHead'];
  res.end=((value?:string)=>{if(res.writableEnded)throw new Error('double-end');res.writeHead(res.statusCode);Object.assign(res,{writableEnded:true});if(value)output.push(value);if(autoFinish)queueMicrotask(finish);return res;}) as ServerResponse['end'];
  res.destroy=()=>{if(!res.destroyed){Object.assign(res,{destroyed:true});queueMicrotask(()=>{Object.assign(res,{closed:true});res.emit('close');});}return res;};
  function enter(){boundary.listener(req,res);}
  function data(chunk:Buffer|string){req.emit('data',chunk);}
  function end(complete=true){Object.assign(req,{complete,readableEnded:true});req.emit('end');Object.assign(req,{closed:true,destroyed:true});req.emit('close');}
  cleanups.push(async()=>{boundary.close();await Promise.resolve();});
  return {boundary,req,res,output,headers,enter,data,end,finish};
}

describe('합성 transport 수명·쓰기 오류 경계',()=>{
  it.each([0,33,1.5,NaN,Infinity,'8',null])('maxConcurrent=%s 설정은 고정 오류',value=>{
    expect(()=>createGameNodeListener(async()=>ok,{maxConcurrent:value as number})).toThrow('invalid-game-node-listener-config');
  });
  it.each([0,30001,1.5,NaN,Infinity,'10000',null])('deadlineMs=%s 설정은 고정 오류',value=>{
    expect(()=>createGameNodeListener(async()=>ok,{deadlineMs:value as number})).toThrow('invalid-game-node-listener-config');
  });
  it.each([{extra:1},new Proxy({},{}),Object.defineProperty({},'deadlineMs',{get:()=>{throw new Error('private');}})])('허용하지 않은 설정 형태 %#',options=>{
    expect(()=>createGameNodeListener(async()=>ok,options)).toThrow('invalid-game-node-listener-config');
  });
  it('설정 경계와 default factory는 닫을 수 있음',()=>{
    for(const options of [{},{maxConcurrent:1,deadlineMs:1},{maxConcurrent:32,deadlineMs:30000}]){const b=createGameNodeListener(async()=>ok,options);b.close();b.close();}
  });
  it('8192 bytes 수신 후 다음1 byte를 복사 전에 거절',async()=>{
    const adapter=vi.fn(async()=>ok),f=fixture(adapter);f.req.rawHeaders=[];f.enter();f.data(Buffer.alloc(4096));f.data(Buffer.alloc(4096));
    expect(adapter).not.toHaveBeenCalled();f.data(Buffer.alloc(1));f.end();await Promise.resolve();expect(adapter).not.toHaveBeenCalled();expect(f.res.statusCode).toBe(413);
  });
  it('단일8193 chunk와 string chunk를 adapter 전에 거절',async()=>{
    for(const chunk of [Buffer.alloc(8193),'{}']){const adapter=vi.fn(async()=>ok),f=fixture(adapter);f.enter();f.data(chunk);await Promise.resolve();expect(adapter).not.toHaveBeenCalled();expect(f.res.destroyed).toBe(true);}
  });
  it('await 전 method/url/rawHeaders/body 복사본을 유지',async()=>{
    const gate=deferred(),adapter=vi.fn<GameNodeAdapter>(()=>gate.promise),f=fixture(adapter),source=Buffer.from('{}');f.enter();
    f.req.rawHeaders[1]='99';f.req.url='/changed';f.req.method='DELETE';f.data(source);source.fill(120);f.end();
    const snapshot=adapter.mock.calls[0][0] as GameHttpRequest;expect(snapshot).toMatchObject({method:'POST',target:'/v1/rounds/get',headers:[['Content-Length','2']]});
    expect(Buffer.from(snapshot.body as Uint8Array).toString()).toBe('{}');gate.resolve(ok);await gate.promise;
  });
  it.each(['incomplete','trailers'])('%s end는 adapter 미호출',async kind=>{
    const adapter=vi.fn(async()=>ok),f=fixture(adapter);f.enter();f.data(Buffer.from('{}'));if(kind==='trailers')f.req.rawTrailers=['X','y'];f.end(kind!=='incomplete');
    await Promise.resolve();expect(adapter).not.toHaveBeenCalled();expect(f.res.destroyed).toBe(true);
  });
  it.each(['setHeader','writeHead','end'])('동기 %s 실패는 미전송이면 고정 오류만 한 번',async method=>{
    const adapter=vi.fn(async()=>({...ok,headers:{origin:'synthetic-private'},body:'synthetic-private'})),f=fixture(adapter);
    if(method==='setHeader'){const original=f.res.setHeader;let first=true;f.res.setHeader=(...args)=>{if(first){first=false;throw new Error('synthetic-private');}return original(...args);};}
    else if(method==='writeHead'){const original=f.res.writeHead;let first=true;f.res.writeHead=((...args:unknown[])=>{if(first){first=false;throw new Error('synthetic-private');}return (original as Function)(...args);}) as ServerResponse['writeHead'];}
    else{const original=f.res.end;let first=true;f.res.end=((...args:unknown[])=>{if(first){first=false;throw new Error('synthetic-private');}return (original as Function)(...args);}) as ServerResponse['end'];}
    f.enter();f.data(Buffer.from('{}'));f.end();await pause(5);expect(f.output).toEqual(['{"code":"unavailable"}']);expect(f.headers.has('origin')).toBe(false);
  });
  it.each(['sent','ended','destroyed'])('%s 응답에 오류 JSON을 추가하지 않음',async state=>{
    const f=fixture(async()=>ok);f.enter();
    Object.assign(f.res,state==='sent'?{headersSent:true}:state==='ended'?{writableEnded:true}:{destroyed:true});f.data(Buffer.from('{}'));f.end();await pause(5);
    expect(f.output).toEqual([]);expect(f.req.destroyed).toBe(true);
  });
  it('부분 end 예외와 async response error는 두 번째 응답 없이 종료',async()=>{
    const f=fixture(async()=>ok,{},false);f.res.end=(()=>{Object.assign(f.res,{headersSent:true});throw new Error('synthetic-private');}) as ServerResponse['end'];
    f.enter();f.data(Buffer.from('{}'));f.end();await pause(5);expect(f.output).toEqual([]);expect(f.res.destroyed).toBe(true);
    const g=fixture(async()=>ok,{},false);g.enter();g.data(Buffer.from('{}'));g.end();await Promise.resolve();g.res.emit('error',new Error('synthetic-private'));
    await Promise.resolve();expect(g.output).toEqual([ok.body]);expect(g.res.destroyed).toBe(true);
  });
  it('adapter 동기 throw/거절 원문은 응답에 노출하지 않음',async()=>{
    for(const adapter of [()=>{throw new Error('synthetic-private');},async()=>{throw new Error('synthetic-private');}]){
      const f=fixture(adapter);f.enter();f.data(Buffer.from('{}'));f.end();await pause(5);expect(f.output).toEqual(['{"code":"unavailable"}']);
    }
  });
  it('adapter settle 뒤에도 응답 finish 전 슬롯 유지·기한에 종료',async()=>{
    const adapter=vi.fn(async()=>ok),f=fixture(adapter,{maxConcurrent:1,deadlineMs:40},false);f.enter();f.data(Buffer.from('{}'));f.end();await Promise.resolve();
    expect(f.res.writableEnded).toBe(true);expect(f.res.writableFinished).toBe(false);
    const g=fixture(async()=>ok);f.boundary.listener(g.req,g.res);await Promise.resolve();expect(adapter).toHaveBeenCalledOnce();expect(g.res.statusCode).toBe(503);
    await pause(60);expect(f.res.destroyed).toBe(true);expect(f.output).toEqual([ok.body]);
  });
  it('timer callback보다 먼저 도는 지연 adapter 결과도 monotonic 기한으로 거절',async()=>{
    const f=fixture(async()=>{const until=performance.now()+25;while(performance.now()<until){}return ok;},{deadlineMs:10});
    f.enter();f.data(Buffer.from('{}'));f.end();await Promise.resolve();expect(f.output).toEqual(['{"code":"unavailable"}']);
  });
  it('본문 완료가 timer callback보다 늦으면 adapter 미호출',async()=>{
    const adapter=vi.fn(async()=>ok),f=fixture(adapter,{deadlineMs:10});f.enter();f.data(Buffer.from('{}'));
    const until=performance.now()+25;while(performance.now()<until){}f.end();await Promise.resolve();expect(adapter).not.toHaveBeenCalled();expect(f.res.statusCode).toBe(503);
  });
  it('close는 타이머를 정리하지만 미협조 promise drain 완료가 아님',async()=>{
    vi.useFakeTimers();const gate=deferred(),adapter=vi.fn(()=>gate.promise),f=fixture(adapter,{deadlineMs:10000});f.enter();f.data(Buffer.from('{}'));f.end();
    expect(vi.getTimerCount()).toBeGreaterThan(0);f.boundary.close();f.boundary.close();vi.runAllTicks();expect(vi.getTimerCount()).toBe(0);
    gate.reject(new Error('synthetic-private'));await Promise.resolve();expect(f.output).toEqual(['{"code":"unavailable"}']);expect(vi.getTimerCount()).toBe(0);
  });
  it('정상 finish는 타이머를 없애고 요청/응답을 destroy하지 않음',async()=>{
    vi.useFakeTimers();const f=fixture(async()=>ok,{},false);f.enter();f.data(Buffer.from('{}'));f.end();await Promise.resolve();f.finish();vi.runAllTicks();
    expect(vi.getTimerCount()).toBe(0);expect(f.res.destroyed).toBe(false);expect(f.output).toEqual([ok.body]);
  });
  it('기본 슬롯8개를 본문 수신부터 잡고 아홉 번째는 대기 없이 거절',async()=>{
    const boundary=createGameNodeListener(async()=>ok),requests=Array.from({length:9},()=>fixture(async()=>ok));
    for(const f of requests)boundary.listener(f.req,f.res);
    expect(requests.slice(0,8).every(f=>!f.res.writableEnded&&!f.res.destroyed)).toBe(true);
    expect(requests[8].res.statusCode).toBe(503);expect(requests[8].res.destroyed).toBe(true);
    boundary.close();await Promise.resolve();expect(requests.every(f=>f.res.destroyed)).toBe(true);
  });
  it('close는 수신 중 본문도 adapter 호출 없이 중단',async()=>{
    const adapter=vi.fn(async()=>ok),f=fixture(adapter);f.enter();f.data(Buffer.from('{'));f.boundary.close();f.end();await Promise.resolve();
    expect(adapter).not.toHaveBeenCalled();expect(f.res.destroyed).toBe(true);expect(f.res.statusCode).toBe(503);
  });
  it('admission 오류에 Origin을 반사하지 않고 요청 error도 고정 종료',async()=>{
    const adapter=vi.fn(async()=>ok),f=fixture(adapter);f.req.rawHeaders=['Origin','https://synthetic-private.example','Content-Length','8193'];f.enter();
    expect(f.res.statusCode).toBe(413);expect(f.headers.has('access-control-allow-origin')).toBe(false);await Promise.resolve();
    const g=fixture(adapter);g.enter();g.req.emit('error',new Error('synthetic-private'));await Promise.resolve();expect(g.output).toEqual([]);expect(adapter).not.toHaveBeenCalled();
  });
  it.each(['odd','length','missing-target'])('합성 native %s 경계는 안전 거절',async kind=>{
    const adapter=vi.fn(async()=>ok),f=fixture(adapter);
    if(kind==='odd')f.req.rawHeaders=['Host'];if(kind==='length')f.req.rawHeaders=['Content-Length','02'];if(kind==='missing-target')f.req.url=undefined;
    f.enter();await Promise.resolve();expect(f.res.statusCode).toBe(400);expect(adapter).not.toHaveBeenCalled();
  });
});
