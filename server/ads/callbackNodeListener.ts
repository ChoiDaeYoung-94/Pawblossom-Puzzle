/**
 * SSV 동기 adapter 전용 제한된 Node listener. 서버/listen/Inbox/worker를 소유하지 않습니다.
 * TLS, parser/slow-header/connection 제한, Expect/clientError/upgrade/CONNECT와 로그 보호는 호스트 책임입니다.
 */
import type {IncomingMessage,RequestListener,ServerResponse} from 'node:http';
import {performance} from 'node:perf_hooks';
import {types} from 'node:util';
import {CALLBACK_PATH,type CallbackRequest,type CallbackResponse} from './callbackHttp.ts';

export type CallbackNodeAdapter=(request:CallbackRequest)=>CallbackResponse;
export interface CallbackNodeListenerOptions {readonly maxConcurrent?:number;readonly deadlineMs?:number;}
export const CALLBACK_NODE_LIMITS=Object.freeze({bodyBytes:0,targetBytes:CALLBACK_PATH.length+1+4096,
  headerCount:32,headerBytes:8192,headerNameBytes:64,headerValueBytes:4096});
const safeHeaders=Object.freeze({'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
const failure=(status:400|413|503):CallbackResponse=>({status,headers:safeHeaders,body:status===503?'unavailable':'rejected'});
const ignoreError=()=>{};
function disconnect(req:IncomingMessage,res:ServerResponse):void {
  // 무한 drain은 하지 않습니다. 조기 종료의 오류 본문 전달/같은 socket의 pipelining은 보장하지 않습니다.
  try{req.pause();}catch{}
  try{res.destroy();}catch{}
  try{req.destroy();}catch{}
}
function write(req:IncomingMessage,res:ServerResponse,method:string|undefined,output:CallbackResponse,closing:boolean):void {
  if(res.headersSent||res.writableEnded||res.destroyed){disconnect(req,res);return;}
  const send=(value:CallbackResponse)=>{
    res.statusCode=value.status;
    for(const [name,header] of Object.entries(value.headers)){
      if(!['content-length','transfer-encoding','connection'].includes(name.toLowerCase()))res.setHeader(name,header);
    }
    if(closing){res.shouldKeepAlive=false;res.setHeader('connection','close');}
    res.setHeader('content-length',Buffer.byteLength(value.body,'utf8'));
    if(method==='HEAD')res.end();else res.end(value.body,'utf8');
  };
  try{send(output);}catch{
    // 미전송 때만 고정 오류로 한 번 복구하며, 부분 응답에 두 번째 본문을 붙이지 않습니다.
    if(!res.headersSent&&!res.writableEnded&&!res.destroyed){
      try{for(const name of res.getHeaderNames())res.removeHeader(name);send(failure(503));return;}catch{}
    }
    disconnect(req,res);
  }
}
function refuse(req:IncomingMessage,res:ServerResponse,method:string|undefined):void {
  req.on('error',ignoreError);res.on('error',ignoreError);
  if(req.closed)req.removeListener('error',ignoreError);
  else req.once('close',()=>req.removeListener('error',ignoreError));
  if(res.closed)res.removeListener('error',ignoreError);
  else res.once('close',()=>res.removeListener('error',ignoreError));
  write(req,res,method,failure(503),true);disconnect(req,res);
}

export function createCallbackNodeListener(adapter:CallbackNodeAdapter,options:CallbackNodeListenerOptions={}):{listener:RequestListener;close():void} {
  let maxConcurrent:number,deadlineMs:number;
  try{
    if(typeof adapter!=='function'||types.isProxy(adapter)||types.isProxy(options)||options===null
      ||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw new Error();
    const config:Record<string,unknown>=Object.create(null);
    for(const key of Reflect.ownKeys(options)){
      if(key!=='maxConcurrent'&&key!=='deadlineMs')throw new Error();
      const descriptor=Object.getOwnPropertyDescriptor(options,key)!;
      if(!('value' in descriptor)||!descriptor.enumerable)throw new Error();
      config[key]=descriptor.value;
    }
    maxConcurrent=config.maxConcurrent===undefined?8:config.maxConcurrent as number;
    deadlineMs=config.deadlineMs===undefined?10000:config.deadlineMs as number;
    if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>32
      ||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>30000)throw new Error();
  }catch{throw new Error('invalid-callback-node-listener-config');}
  let closed=false;
  const active=new Set<{cancel():void}>();
  const listener:RequestListener=(req,res)=>{
    const started=performance.now(),method=req.method,target=req.url;
    if(closed||active.size>=maxConcurrent){refuse(req,res,method);return;}
    let timer:ReturnType<typeof setTimeout>|undefined;
    // Node24 빈 요청 최적화는 이미 closed이며 end/close가 생략됩니다. 성공 판정과 별도입니다.
    let requestDone=req.closed,responseDone=res.closed||res.writableFinished,adapterDone=true;
    let invoked=false,terminal=false,released=false;
    const entry={cancel:()=>terminate(503)};
    active.add(entry);
    const expired=()=>performance.now()-started>=deadlineMs;
    const clearTimer=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
    const release=()=>{
      if(released||!requestDone||!responseDone||!adapterDone)return;
      released=true;active.delete(entry);clearTimer();
      req.removeListener('data',onData);req.removeListener('end',onEnd);res.removeListener('finish',onFinish);
      if(req.closed){req.removeListener('error',onError);req.removeListener('close',onRequestClose);}
      if(res.closed)res.removeListener('error',onError);
    };
    function terminate(status?:400|413|503):void {
      req.removeListener('data',onData);clearTimer();
      if(!terminal){terminal=true;if(status!==undefined)write(req,res,method,failure(status),true);}
      disconnect(req,res);
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
      if(!Buffer.isBuffer(chunk)){terminate(400);return;}
      if(chunk.length!==0)terminate(413);
    }
    function invoke():void {
      if(invoked||terminal)return;
      if(req.aborted||res.destroyed||res.closed||req.socket?.destroyed){terminate();return;}
      if(!req.complete){terminate(400);return;}
      requestDone=true;
      if(expired()){terminate(503);return;}
      if(req.rawTrailers.length){terminate(400);return;}
      invoked=true;adapterDone=false;
      try{
        const output=adapter({method,target,bodyBytes:0});
        // 동기 COMMIT은 이 검사로 rollback되지 않습니다. 이후 동일 원문 재수신으로 수습합니다.
        if(expired()){terminate(503);return;}
        if(terminal)return;
        if(req.aborted||res.destroyed||res.closed||req.socket?.destroyed){terminate();return;}
        terminal=true;write(req,res,method,output,false);
      }catch{if(!terminal){if(expired())terminate(503);else{terminal=true;write(req,res,method,failure(503),false);}}}
      finally{adapterDone=true;release();}
    }
    function onEnd():void {invoke();}
    req.on('error',onError);res.on('error',onError);
    req.once('close',onRequestClose);res.once('close',onResponseClose);res.once('finish',onFinish);
    const armDeadline=()=>{timer=setTimeout(()=>{if(expired())terminate(503);else armDeadline();},Math.max(1,deadlineMs-(performance.now()-started)));};
    armDeadline();
    try{
      // 배열 복사 전에 개수 상한을 검사합니다. 문자열 snapshot은 이 동기 경계 안에서만 사용합니다.
      const raw=req.rawHeaders,limits=CALLBACK_NODE_LIMITS;
      if(typeof target!=='string'||raw.length%2){terminate(400);return;}
      if(target.length>limits.targetBytes||raw.length>limits.headerCount*2){terminate(413);return;}
      let bytes=0,contentLength:string|undefined;
      for(let i=0;i<raw.length;i+=2){
        const name=raw[i],value=raw[i+1],lower=name.toLowerCase();
        if(name.length>limits.headerNameBytes||value.length>limits.headerValueBytes){terminate(413);return;}
        // Node native header 문자열은 byte 보존 latin1입니다. ': '와 CRLF 4byte를 포함합니다.
        bytes+=name.length+value.length+4;if(bytes>limits.headerBytes){terminate(413);return;}
        if(['transfer-encoding','content-encoding','trailer'].includes(lower)){terminate(400);return;}
        if(lower==='content-length'){
          if(contentLength!==undefined||!/^(0|[1-9][0-9]*)$/.test(value)){terminate(400);return;}
          contentLength=value;
        }
      }
      // 중복 CL은 값이 양수여도400입니다. 헤더 전체 판정 뒤 본문 선언 상한을 적용합니다.
      if(contentLength!==undefined&&contentLength!=='0'){terminate(413);return;}
      if(expired()){terminate(503);return;}
      req.on('data',onData);req.once('end',onEnd);
      if(req.readableEnded){
        if(req.complete)invoke();else queueMicrotask(()=>{if(req.readableEnded&&req.complete)invoke();});
      }
    }catch{terminate(400);}
  };
  return {listener,close(){if(closed)return;closed=true;for(const entry of active)entry.cancel();}};
}
