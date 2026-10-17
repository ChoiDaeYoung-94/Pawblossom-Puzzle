/** 신뢰된 서버가 raw request-target snapshot을 넘기는 pure adapter. listen/body stream 읽기 없음. */
import {CallbackInbox} from './callbackInbox.ts';
export interface CallbackRequest {
  readonly method:unknown;
  readonly target:unknown;
  /** host 계층이 실제 받은 body byte 수를 제한하여 제공해야 합니다. */
  readonly bodyBytes:unknown;
}
export interface CallbackResponse {
  readonly status:200|400|404|405|413|503;
  readonly headers:Readonly<Record<string,string>>;
  readonly body:string;
}
export const CALLBACK_PATH='/callbacks/admob';
const headers=Object.freeze({'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
const methodHeaders=Object.freeze({...headers,allow:'GET'});
function response(status:CallbackResponse['status']):CallbackResponse {
  return Object.freeze({status,headers:status===405?methodHeaders:headers,body:status===200?'received':status===503?'unavailable':'rejected'});
}
export function createCallbackHttpAdapter(inbox:CallbackInbox) {
  if(!(inbox instanceof CallbackInbox))throw new Error('invalid-callback-http-config');
  const receive=CallbackInbox.prototype.receive.bind(inbox);
  return (request:CallbackRequest):CallbackResponse=>{
    try {
      const method=request.method,target=request.target,bodyBytes=request.bodyBytes;
      if(method!=='GET')return response(405);
      if(typeof target!=='string'||!Number.isSafeInteger(bodyBytes)||typeof bodyBytes!=='number'||bodyBytes<0)return response(400);
      if(bodyBytes!==0||target.length>CALLBACK_PATH.length+1+4096)return response(413);
      const at=target.indexOf('?');
      if((at<0?target:target.slice(0,at))!==CALLBACK_PATH)return response(404);
      if(at<0)return response(400);
      const result=receive(target.slice(at+1));
      return response(result.kind==='accepted'?200:result.kind==='rejected'?400:503);
    } catch{return response(503);}
  };
}
