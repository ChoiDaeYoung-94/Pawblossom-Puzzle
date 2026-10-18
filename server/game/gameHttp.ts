/** 신뢰된 호스트의 완성된 요청 snapshot 전용. listen/stream/TLS/환경 조회를 하지 않습니다. */
import {types} from 'node:util';
import {GameService} from './gameService.ts';
import {commandSnapshot,exactRecord} from './roundState.ts';
import {strictSessionJson} from '../auth/strictSessionJson.ts';

export interface GameHttpRequest {
  readonly method:unknown;
  readonly target:unknown;
  /** 정규화/병합하기 전 원문 이름·값 쌍. 호스트에서 손실 없이 전달해야 합니다. */
  readonly headers:unknown;
  readonly body:unknown;
  readonly signal?:AbortSignal;
}
export interface GameHttpOptions {readonly allowedOrigins?:readonly string[];}
export interface GameHttpResponse {
  readonly status:200|204|400|401|403|404|405|409|413|415|429|503;
  readonly headers:Readonly<Record<string,string>>;
  readonly body:string;
}
export const GAME_HTTP_LIMITS=Object.freeze({bodyBytes:8192,headerCount:32,headerBytes:16384,headerNameBytes:64,headerValueBytes:8192,targetBytes:128});
export const GAME_HTTP_PATHS=Object.freeze({start:'/v1/rounds/start',get:'/v1/rounds/get',command:'/v1/rounds/command',
  claim:'/v1/rounds/reward/claim',apply:'/v1/rounds/reward/apply'});
type Route=keyof typeof GAME_HTTP_PATHS;
type Result=Awaited<ReturnType<GameService['start'|'get'|'command'|'issueRewardClaim'|'applyReward']>>;
const common=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
const token=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// module 로딩 시 실제 prototype 메서드를 보존합니다. instance override/service-like 객체를 호출하지 않습니다.
const methods=Object.freeze({start:GameService.prototype.start,get:GameService.prototype.get,command:GameService.prototype.command,
  claim:GameService.prototype.issueRewardClaim,apply:GameService.prototype.applyReward});
const typedArray=Object.getPrototypeOf(Uint8Array.prototype);
const byteLength=Object.getOwnPropertyDescriptor(typedArray,'byteLength')!.get!;
const byteOffset=Object.getOwnPropertyDescriptor(typedArray,'byteOffset')!.get!;
const buffer=Object.getOwnPropertyDescriptor(typedArray,'buffer')!.get!;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!;
class InputError extends Error {
  constructor(readonly status:GameHttpResponse['status'],readonly code:string){super('game-http-input');}
}
function fail(status:GameHttpResponse['status'],code:string):never {throw new InputError(status,code);}
function response(status:GameHttpResponse['status'],body:unknown,origin?:string,preflight=false):GameHttpResponse {
  const headers={...common,...(status===405?{allow:'POST, OPTIONS'}:{}),...(status===401?{'www-authenticate':'Bearer realm="pawblossom"'}:{}),
    // 명시 Origin만 반사하며 credentials/wildcard는 허용하지 않습니다.
    vary:preflight?'Origin, Access-Control-Request-Method, Access-Control-Request-Headers':'Origin',...(origin?{'access-control-allow-origin':origin}:{}),
    ...(status===204?{'access-control-allow-methods':'POST','access-control-allow-headers':'authorization, content-type','access-control-max-age':'0'}:{})};
  return Object.freeze({status,headers:Object.freeze(headers),body:status===204?'':JSON.stringify(body)});
}
function arraySnapshot(value:unknown,max:number,oversize:400|413=413):unknown[] {
  if(types.isProxy(value)||!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail(400,'invalid-request');
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(length)||length<0)fail(400,'invalid-request');
  if(length>max)fail(oversize,oversize===413?'request-too-large':'invalid-request');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==length+1)fail(400,'invalid-request');
  const out:unknown[]=[];
  for(let i=0;i<length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d||!('value' in d)||!d.enumerable)fail(400,'invalid-request');out.push(d.value);
  }
  return out;
}
function headerSnapshot(raw:unknown):Map<string,string> {
  const out=new Map<string,string>();let bytes=0;
  for(const entry of arraySnapshot(raw,GAME_HTTP_LIMITS.headerCount)){
    const pair=arraySnapshot(entry,2,400);if(pair.length!==2)fail(400,'invalid-request');
    const [name,value]=pair;
    if(typeof name!=='string'||typeof value!=='string')fail(400,'invalid-request');
    if(name.length>GAME_HTTP_LIMITS.headerNameBytes||value.length>GAME_HTTP_LIMITS.headerValueBytes)fail(413,'request-too-large');
    // obs-text/obs-fold도 받지 않는 자체 ASCII profile입니다. 바깥 OWS는 값별로 처리합니다.
    if(!token.test(name)||!/^[\x20-\x7e\t]*$/.test(value))fail(400,'invalid-request');
    bytes+=name.length+value.length+4;if(bytes>GAME_HTTP_LIMITS.headerBytes)fail(413,'request-too-large');
    const key=name.toLowerCase();if(out.has(key))fail(400,'invalid-request');out.set(key,value);
  }
  return out;
}
function originSnapshot(value:unknown):string {
  if(typeof value!=='string'||value.length>256||!/^https:\/\//.test(value))throw new Error();
  const url=new URL(value);
  if(url.origin!==value||url.username||url.password||url.protocol!=='https:'||url.hostname.includes('*'))throw new Error();
  return value;
}
function bodySnapshot(value:unknown,headers:Map<string,string>,max:number):Uint8Array {
  if(types.isProxy(value)||!types.isUint8Array(value))fail(400,'invalid-request');
  // 사용자 정의 getter/iterator/species를 실행하지 않고 실제 view byte만 제한·복제합니다.
  const source=buffer.call(value) as ArrayBuffer;
  const size=byteLength.call(value) as number,offset=byteOffset.call(value) as number;
  if(types.isSharedArrayBuffer(source))fail(400,'invalid-request');
  if(size>max)fail(413,'request-too-large');
  const body=new Uint8Array(new Uint8Array(source,offset,size));
  const length=headers.get('content-length');
  if(length!==undefined){
    if(!/^(0|[1-9][0-9]{0,9})$/.test(length))fail(400,'invalid-request');
    if(Number(length)>max)fail(413,'request-too-large');
    if(Number(length)!==body.byteLength)fail(400,'invalid-request');
  }
  return body;
}
function preflightHeaders(headers:Map<string,string>):void {
  const method=headers.get('access-control-request-method');
  if(method===undefined||!token.test(method))fail(400,'invalid-request');
  if(method!=='POST')fail(405,'method-not-allowed');
  const value=headers.get('access-control-request-headers');
  if(value===undefined||value.length>128)fail(400,'invalid-request');
  const names=value.split(',').map(v=>v.replace(/^[ \t]+|[ \t]+$/g,'').toLowerCase());
  if(names.length<1||names.length>2||names.some(n=>!token.test(n))||new Set(names).size!==names.length)fail(400,'invalid-request');
  if(names.some(n=>!['authorization','content-type'].includes(n)))fail(403,'preflight-denied');
}
function project(result:Result,route:Route):{status:GameHttpResponse['status'];body:unknown} {
  // HTTP 오류에는 provider 세부 code도 그대로 내보내지 않습니다.
  if(result.kind==='session-error'){
    if(result.code==='unauthenticated'||result.code==='session-expired')return {status:401,body:{code:'unauthenticated'}};
    if(result.code==='forbidden')return {status:403,body:{code:'forbidden'}};
    if(result.code==='aborted')return {status:400,body:{code:'aborted'}};
    if(result.code==='invalid-input')return {status:400,body:{code:'invalid-request'}};
    if(result.code==='busy'||result.code==='rate-limited')return {status:429,body:{code:'temporarily-limited'}};
    return {status:503,body:{code:'unavailable'}};
  }
  if(result.kind==='service-error')return {status:503,body:{code:'unavailable'}};
  if(result.kind==='rejected'){
    if(result.code==='not-found')return {status:404,body:{code:'not-found'}};
    if(result.code==='invalid-input')return {status:400,body:{code:'invalid-request'}};
    if(result.code==='aborted')return {status:400,body:{code:'aborted'}};
    if(result.code==='ads-unavailable')return {status:403,body:{code:'ads-unavailable'}};
    if(result.code==='capacity')return {status:503,body:{code:'unavailable'}};
    const conflicts=['request-conflict','revision-conflict','round-terminal','shuffle-used','expired','operation-limit','reward-used','voucher-missing','round-closed','round-limit'];
    if(conflicts.includes(result.code))return {status:409,body:{code:result.code}};
    return {status:503,body:{code:'unavailable'}};
  }
  if(route==='claim'&&result.kind==='claim-issued')return {status:200,body:{kind:result.kind,customData:result.customData,userId:result.userId,expiresAt:result.expiresAt}};
  if(result.kind==='claim-issued')throw new Error();
  // 서비스만 만든 공개 snapshot을 명시적으로 선택합니다. RNG·owner·grant·provider context는 포함하지 않습니다.
  const s=result.snapshot,state=s.state;
  const snapshot={roundId:s.roundId,revision:s.revision,createdAt:s.createdAt,expiresAt:s.expiresAt,state:{
    level:state.level,board:state.board,leaves:state.leaves,moves:state.moves,collected:state.collected,score:state.score,
    shuffles:state.shuffles,clearedLeaves:state.clearedLeaves,status:state.status}};
  if(route==='start'&&result.kind==='round-started')return {status:200,body:{kind:result.kind,created:result.created,snapshot}};
  if(route==='get'&&result.kind==='round-snapshot')return {status:200,body:{kind:result.kind,snapshot}};
  if(route==='apply'&&result.kind==='reward-result')return {status:200,body:{kind:result.kind,applied:result.applied,snapshot}};
  if(route==='command'&&result.kind==='command-result')return {status:200,body:{kind:result.kind,applied:result.applied,outcome:result.outcome,snapshot,
    ...(result.rewardCleanup?{rewardCleanup:result.rewardCleanup}:{})}};
  throw new Error();
}

export function createGameHttpAdapter(service:GameService,options:GameHttpOptions={}) {
  let origins:ReadonlySet<string>;
  try{
    if(types.isProxy(service)||!(service instanceof GameService))throw new Error();
    if(types.isProxy(options))throw new Error();
    const keys=Reflect.ownKeys(options);if(keys.some(k=>k!=='allowedOrigins'))throw new Error();
    const o=exactRecord(options,keys as string[]);
    const values=o.allowedOrigins===undefined?[]:arraySnapshot(o.allowedOrigins,16);
    const copy=values.map(originSnapshot);if(new Set(copy).size!==copy.length)throw new Error();origins=new Set(copy);
  }catch{throw new Error('invalid-game-http-config');}
  return async (input:GameHttpRequest):Promise<GameHttpResponse>=>{
    let origin:string|undefined,preflight=false;
    try{
      if(types.isProxy(input))fail(400,'invalid-request');
      const keys=Reflect.ownKeys(input);if(keys.some(k=>!['method','target','headers','body','signal'].includes(String(k))))fail(400,'invalid-request');
      const r=exactRecord(input,['method','target','headers','body',...(Object.hasOwn(input,'signal')?['signal']:[])]);
      const {method,target}=r;
      preflight=method==='OPTIONS';
      if(typeof method!=='string'||!token.test(method)||typeof target!=='string')fail(400,'invalid-request');
      if(target.length>GAME_HTTP_LIMITS.targetBytes)fail(413,'request-too-large');
      if(!/^\/[A-Za-z0-9/_-]+$/.test(target))fail(400,'invalid-request');
      const route=(Object.keys(GAME_HTTP_PATHS) as Route[]).find(k=>GAME_HTTP_PATHS[k]===target);
      if(!route)fail(404,'not-found');if(method!=='POST'&&!preflight)fail(405,'method-not-allowed');
      const headers=headerSnapshot(r.headers);
      const suppliedOrigin=headers.get('origin');
      if(suppliedOrigin!==undefined){if(!origins.has(suppliedOrigin))fail(403,'origin-denied');origin=suppliedOrigin;}
      if(headers.has('transfer-encoding')||headers.has('content-encoding')||headers.has('trailer'))fail(400,'invalid-request');
      const signal=r.signal;
      if(signal!==undefined){
        if(types.isProxy(signal)||!(signal instanceof AbortSignal)||Object.getPrototypeOf(signal)!==AbortSignal.prototype
          ||Reflect.ownKeys(signal).some(k=>typeof k==='string'))fail(400,'invalid-request');
        if(aborted.call(signal))fail(400,'aborted');
      }
      if(preflight){
        if(origin===undefined)fail(403,'origin-denied');
        bodySnapshot(r.body,headers,0);preflightHeaders(headers);
        return response(204,undefined,origin,true);
      }
      if(!/^application\/json(?:; charset=utf-8)?$/i.test(headers.get('content-type')??''))fail(415,'unsupported-media-type');
      const body=bodySnapshot(r.body,headers,GAME_HTTP_LIMITS.bodyBytes);
      const authorization=headers.get('authorization');
      if(authorization===undefined)fail(401,'unauthenticated');
      // RFC6750 b64token/token68: scheme 대소문자를 구분하지 않고 1*SP만 허용합니다. 앞뒤 OWS/HTAB은 자체 거절합니다.
      const match=/^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization);
      if(!match||match[1].length>4096)fail(400,'invalid-request');
      // ignoreBOM=true로 BOM을 보존해 JSON.parse에서 거절합니다. fatal UTF-8·escape 등가 중복 키·깊이32도 검사합니다.
      const parsed=strictSessionJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(body));
      const fields=route==='start'?['requestId','levelId']:route==='command'?['roundId','operationId','expectedRevision','command']:
        route==='claim'?['roundId','expectedRevision']:['roundId'];
      const payload=exactRecord(parsed,fields);
      if(route==='command')payload.command=commandSnapshot(payload.command);
      // 실제 서비스도 ID/값/명령을 await 전에 검사합니다. 외부 입력은 여기까지 모두 로컬 사본입니다.
      const request={...payload,sessionTicket:match[1],...(signal===undefined?{}:{signal})};
      let result:Result;
      try{
        const invoke=methods[route] as (this:GameService,request:unknown)=>Promise<Result>;
        result=await invoke.call(service,request);
      }catch{return response(503,{code:'unavailable'},origin);}
      try{const output=project(result,route);return response(output.status,output.body,origin);}
      catch{return response(503,{code:'unavailable'},origin);}
    }catch(error){
      if(error instanceof InputError)return response(error.status,{code:error.code},origin,preflight);
      // decode/JSON/record/native signal getter 예외도 원문 없는 입력 오류입니다.
      return response(400,{code:'invalid-request'},origin,preflight);
    }
  };
}
