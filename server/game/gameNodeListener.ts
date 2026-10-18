/**
 * 신뢰된 게임 adapter 앞의 제한된 Node request listener입니다. 서버 생성/listen/환경 조회는 하지 않습니다.
 * TLS, parser/header/connection 제한, Expect/clientError/upgrade/CONNECT와 공개 rate limit은 호스트 책임입니다.
 */
import type {IncomingMessage,RequestListener,ServerResponse} from 'node:http';
import {performance} from 'node:perf_hooks';
import {types} from 'node:util';
import {GAME_HTTP_LIMITS as limits,type GameHttpRequest,type GameHttpResponse} from './gameHttp.ts';
import {exactRecord} from './roundState.ts';

export type GameNodeAdapter=(request:GameHttpRequest)=>Promise<GameHttpResponse>;
export interface GameNodeListenerOptions {readonly maxConcurrent?:number;readonly deadlineMs?:number;}
const safeHeaders=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
function failure(status:400|413|503):GameHttpResponse {
  return {status,headers:safeHeaders,body:JSON.stringify({code:status===413?'request-too-large':status===400?'invalid-request':'unavailable'})};
}
const ignoreError=()=>{};
function disconnect(req:IncomingMessage,res:ServerResponse):void {
  // 미완성/초과 본문은 drain하지 않습니다. 오류 JSON 및 같은 socket의 pipelining 보존을 보장하지 않습니다.
  try{req.pause();}catch{}
  try{res.destroy();}catch{}
  try{req.destroy();}catch{}
}
function write(req:IncomingMessage,res:ServerResponse,method:string|undefined,output:GameHttpResponse,closing:boolean):void {
  if(res.headersSent||res.writableEnded||res.destroyed){disconnect(req,res);return;}
  const send=(value:GameHttpResponse)=>{
    res.statusCode=value.status;
    for(const [name,valueHeader] of Object.entries(value.headers)){
      // 프레이밍은 listener가 소유합니다. trusted adapter도 CL/TE를 지정하지 않습니다.
      if(!['content-length','transfer-encoding','connection'].includes(name.toLowerCase()))res.setHeader(name,valueHeader);
    }
    if(closing){res.shouldKeepAlive=false;res.setHeader('connection','close');}
    if(value.status===204){res.removeHeader('content-length');res.removeHeader('transfer-encoding');res.end();}
    else{
      res.setHeader('content-length',Buffer.byteLength(value.body,'utf8'));
      if(method==='HEAD')res.end();else res.end(value.body,'utf8');
    }
  };
  try{send(output);}catch{
    // 헤더 미전송 때만 원문 없는 고정 오류를 한 번 시도합니다. 부분 응답에 JSON을 덧붙이지 않습니다.
    if(!res.headersSent&&!res.writableEnded&&!res.destroyed){
      try{for(const name of res.getHeaderNames())res.removeHeader(name);send(failure(503));return;}catch{}
    }
    disconnect(req,res);
  }
}
function refuse(req:IncomingMessage,res:ServerResponse,method:string|undefined,status:400|413|503):void {
  req.on('error',ignoreError);res.on('error',ignoreError);
  req.once('close',()=>req.removeListener('error',ignoreError));
  res.once('close',()=>res.removeListener('error',ignoreError));
  write(req,res,method,failure(status),true);disconnect(req,res);
}

export function createGameNodeListener(adapter:GameNodeAdapter,options:GameNodeListenerOptions={}):{listener:RequestListener;close():void} {
  let maxConcurrent:number,deadlineMs:number;
  try{
    if(typeof adapter!=='function'||types.isProxy(adapter)||types.isProxy(options))throw new Error();
    const keys=Reflect.ownKeys(options);if(keys.some(k=>k!=='maxConcurrent'&&k!=='deadlineMs'))throw new Error();
    const config=exactRecord(options,keys as string[]);
    maxConcurrent=config.maxConcurrent===undefined?8:config.maxConcurrent as number;
    deadlineMs=config.deadlineMs===undefined?10000:config.deadlineMs as number;
    if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>32||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>30000)throw new Error();
  }catch{throw new Error('invalid-game-node-listener-config');}
  let closed=false;
  const active=new Set<{cancel():void}>();
  const listener:RequestListener=(req,res)=>{
    const started=performance.now(),method=req.method,target=req.url;
    if(closed||active.size>=maxConcurrent){refuse(req,res,method,503);return;}
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined,body:Buffer|undefined,size=0;
    // 최적화된 빈 요청은 이미 closed이며 이후 close 이벤트도 생략됩니다. adapter의 complete 검사는 별도입니다.
    let requestDone=req.closed,responseDone=res.closed||res.writableFinished,adapterSettled=true,invoked=false,terminal=false,released=false;
    const entry={cancel:()=>terminate(503)};
    active.add(entry);
    const expired=()=>performance.now()-started>=deadlineMs;
    const clearTimer=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
    const release=()=>{
      if(released||!requestDone||!responseDone||!adapterSettled)return;
      released=true;active.delete(entry);body=undefined;clearTimer();
      req.removeListener('data',onData);req.removeListener('end',onEnd);res.removeListener('finish',onFinish);
      // 각 stream의 close까지 error를 관찰합니다. 정상 finish 뒤에도 keep-alive를 파괴하지 않습니다.
      if(req.closed){req.removeListener('error',onError);req.removeListener('close',onRequestClose);}
      if(res.closed)res.removeListener('error',onError);
    };
    function terminate(status?:400|413|503):void {
      controller.abort();body=undefined;req.removeListener('data',onData);clearTimer();
      if(!terminal){terminal=true;if(status!==undefined)write(req,res,method,failure(status),true);}
      disconnect(req,res);
      // 이미 닫힌 stream은 close를 다시 기다리지 않습니다. 나머지는 실제 close/finish까지 유지합니다.
      requestDone ||= req.closed;responseDone ||= res.closed||res.writableFinished;release();
    }
    function onError():void {terminate();}
    function onRequestClose():void {
      if(!req.complete)terminate();
      requestDone=true;req.removeListener('error',onError);release();
    }
    function onResponseClose():void {
      responseDone=true;if(!res.writableFinished)terminate();
      res.removeListener('error',onError);release();
    }
    function onFinish():void {responseDone=true;release();}
    function onData(chunk:Buffer):void {
      if(terminal)return;
      if(expired()){terminate(503);return;}
      // 문자 변환·압축 해제 없이 실제 chunk byte를 복사 전에 제한합니다.
      if(!Buffer.isBuffer(chunk)){terminate(400);return;}
      if(chunk.length>limits.bodyBytes-size){terminate(413);return;}
      body??=Buffer.allocUnsafe(limits.bodyBytes);chunk.copy(body,size);size+=chunk.length;
    }
    let headers:string[][]=[];
    async function invoke():Promise<void> {
      if(invoked||terminal)return;
      if(res.destroyed||req.socket?.destroyed){terminate();return;}
      if(!req.complete){terminate(400);return;}
      requestDone=true;
      if(expired()){terminate(503);return;}
      if(req.rawTrailers.length){terminate(400);return;}
      invoked=true;adapterSettled=false;
      const snapshot={method,target,headers,body:body?.subarray(0,size)??Buffer.alloc(0),signal:controller.signal};
      body=undefined;headers=[];
      try{
        if(expired()){terminate(503);return;}
        const output=await adapter(snapshot);
        if(expired()){terminate(503);return;}
        if(terminal)return;
        // await 뒤에도 쓰기 직전에 절대 기한을 다시 확인합니다.
        if(expired()){terminate(503);return;}
        terminal=true;write(req,res,method,output,false);
      }catch{if(!terminal){if(expired())terminate(503);else{terminal=true;write(req,res,method,failure(503),false);}}}
      finally{adapterSettled=true;release();}
    }
    function onEnd():void {void invoke();}
    req.on('error',onError);res.on('error',onError);
    req.once('close',onRequestClose);res.once('close',onResponseClose);res.once('finish',onFinish);
    const armDeadline=()=>{timer=setTimeout(()=>{if(expired())terminate(503);else armDeadline();},Math.max(1,deadlineMs-(performance.now()-started)));};
    armDeadline();
    try{
      // native rawHeaders의 교대 배열을 쌍으로 복사합니다. 정규화된 req.headers는 참조하지 않습니다.
      const raw=req.rawHeaders;
      if(raw.length%2){terminate(400);return;}
      if(typeof target!=='string'){terminate(400);return;}
      if(raw.length>limits.headerCount*2||target.length>limits.targetBytes){terminate(413);return;}
      let headerBytes=0;
      for(let i=0;i<raw.length;i+=2){
        const name=raw[i],value=raw[i+1];
        if(name.length>limits.headerNameBytes||value.length>limits.headerValueBytes){terminate(413);return;}
        headerBytes+=name.length+value.length+4;if(headerBytes>limits.headerBytes){terminate(413);return;}
        headers.push([name,value]);
        if(['transfer-encoding','content-encoding','trailer'].includes(name.toLowerCase())){terminate(400);return;}
        if(name.toLowerCase()==='content-length'){
          if(!/^(0|[1-9][0-9]{0,9})$/.test(value)){terminate(400);return;}
          if(Number(value)>limits.bodyBytes){terminate(413);return;}
        }
      }
      if(expired()){terminate(503);return;}
      req.on('data',onData);req.once('end',onEnd);
      // Node24 optimizeEmptyRequests:true에서 data/end가 발생하지 않는 빈 body도 처리합니다.
      if(req.readableEnded){
        // Node는 request callback 뒤 parserOnMessageComplete에서 complete를 설정할 수 있습니다.
        if(req.complete)void invoke();else queueMicrotask(()=>{if(req.readableEnded&&req.complete)void invoke();});
      }
    }catch{terminate(400);}
  };
  return {listener,close(){if(closed)return;closed=true;for(const entry of active)entry.cancel();}};
}
