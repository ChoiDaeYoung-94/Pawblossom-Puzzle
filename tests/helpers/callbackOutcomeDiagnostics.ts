// 검사 전용 callback 결과 분류입니다. 원문 입력/결과/오류와 native DB 정보는 복사하지 않습니다.
const stages=['constructor','callback','close','unknown'] as const;
const kinds=['voucher-recorded','rejected','service-error','worker-error','unknown'] as const;
const codes=['invalid-input','invalid-claim','voucher-missing','round-closed','round-limit','expired','invalid-time','duplicate-transaction','aborted','invalid-callback','policy-mismatch','invalid-signature','key-unavailable','storage-unavailable','unknown'] as const;
const closes=['not-observed','not-opened','returned','threw'] as const;
type Stage=typeof stages[number];
export interface CallbackOutcome {
  stage:Stage;resultStage:Stage|null;errorStage:Stage|null;
  kind:typeof kinds[number];code:typeof codes[number]|null;newGrant:boolean|null;
  closeOutcome:typeof closes[number];observationFailed:boolean;nativeObservation:'not-observed';
}
export interface CallbackOutcomeTrace {
  workers:(CallbackOutcome&{index:number;report:'missing'|'received'|'invalid'})[];
  truncated:boolean;observationFailed:boolean;
}
declare module 'vitest' {interface TaskMeta {callbackOutcomeDiagnostic?:CallbackOutcomeTrace;}}
const failures=new WeakSet<object>();
function failed(value:object){failures.add(value);try{Reflect.set(value,'observationFailed',true);}catch{}}
function read(value:unknown,key:string,onFailure:()=>void):unknown {try{return value!==null&&(typeof value==='object'||typeof value==='function')?Reflect.get(value,key):undefined;}catch{onFailure();return undefined;}}
function allowed<T extends string>(value:unknown,values:readonly T[],fallback:T):T{return typeof value==='string'&&values.includes(value as T)?value as T:fallback;}
export function createCallbackOutcome():CallbackOutcome{return {stage:'unknown',resultStage:null,errorStage:null,kind:'unknown',code:null,newGrant:null,closeOutcome:'not-observed',observationFailed:false,nativeObservation:'not-observed'};}
function update(trace:CallbackOutcome,patch:Partial<CallbackOutcome>){try{Object.assign(trace,patch);}catch{failed(trace);}}
export function projectCallbackOutcome(value:unknown):CallbackOutcome {
  let bad=false;const get=(key:string)=>read(value,key,()=>{bad=true;});
  const stage=allowed(get('stage'),stages,'unknown'),result=get('resultStage'),error=get('errorStage'),kind=allowed(get('kind'),kinds,'unknown'),code=get('code'),grant=get('newGrant');
  const closeOutcome=allowed(get('closeOutcome'),closes,'not-observed'),reportedFailure=get('observationFailed');
  const knownObject=value!==null&&(typeof value==='object'||typeof value==='function');
  return {stage,resultStage:result===null?null:allowed(result,stages,'unknown'),errorStage:error===null?null:allowed(error,stages,'unknown'),kind,
    code:code===null||code===undefined?null:allowed(code,codes,'unknown'),newGrant:kind==='voucher-recorded'&&typeof grant==='boolean'?grant:null,
    closeOutcome,observationFailed:bad||!knownObject||reportedFailure!==false||(knownObject&&failures.has(value as object)),nativeObservation:'not-observed'};
}
function resultAt(trace:CallbackOutcome,result:unknown){
  let bad=false;const get=(key:string)=>read(result,key,()=>{bad=true;});
  const kind=allowed(get('kind'),kinds,'unknown'),code=kind==='rejected'||kind==='service-error'?get('code'):undefined,grant=kind==='voucher-recorded'?get('newGrant'):undefined;
  update(trace,{resultStage:projectCallbackOutcome(trace).stage,kind,code:code===undefined?null:allowed(code,codes,'unknown'),newGrant:typeof grant==='boolean'?grant:null});
  if(bad)failed(trace);
}
interface CallbackLedger {processCallback(query:unknown):unknown;close():void;}
// opt-in worker만 사용합니다. 생성/처리/close는 각각 원래 한 번이며 close 예외는 기존처럼 삼킵니다.
export async function runObservedCallback(create:()=>CallbackLedger,query:unknown,trace:CallbackOutcome):Promise<unknown> {
  let ledger:CallbackLedger|undefined;
  try {
    update(trace,{stage:'constructor'});ledger=create();update(trace,{stage:'callback'});
    const result=await ledger.processCallback(query);resultAt(trace,result);return result;
  }catch{update(trace,{errorStage:projectCallbackOutcome(trace).stage});const result={kind:'worker-error'};resultAt(trace,result);return result;}
  finally {
    update(trace,{stage:'close'});
    try{ledger?.close();update(trace,{closeOutcome:ledger?'returned':'not-opened'});}catch{update(trace,{closeOutcome:'threw'});}
  }
}
export function callbackOutcomeEnvelope(result:unknown,trace:CallbackOutcome){return {kind:'synthetic-callback-outcome',result,diagnostic:projectCallbackOutcome(trace)};}
export function createCallbackOutcomeTrace(count:number):CallbackOutcomeTrace {
  const bounded=Number.isSafeInteger(count)&&count>=0?Math.min(count,8):0;
  return {workers:Array.from({length:bounded},(_,index)=>({...createCallbackOutcome(),index,report:'missing'})),truncated:count>8,observationFailed:bounded===0&&count!==0};
}
// resultは元の参照のまま返します。envelope/diagnosticのgetterや投影失敗を業務例外にしません。
export function receiveCallbackOutcome(value:unknown,trace:CallbackOutcomeTrace,index:number):unknown {
  let result=value,report:'missing'|'received'|'invalid'='missing',diagnostic:unknown;
  try {
    const marker=Object.getOwnPropertyDescriptor(value,'kind');
    if(marker&&'value' in marker&&marker.value==='synthetic-callback-outcome'){
      const raw=Object.getOwnPropertyDescriptor(value,'result');
      if(raw&&'value' in raw){result=raw.value;report='received';diagnostic=read(value,'diagnostic',()=>{report='invalid';});}else report='invalid';
    }
  }catch{report='invalid';}
  try {
    if(!Number.isInteger(index)||index<0||index>=8||index>=trace.workers.length){trace.truncated=true;return result;}
    const row={...projectCallbackOutcome(diagnostic),index,report};
    if(report==='missing')row.observationFailed=false;
    trace.workers[index]=row;
  }catch{failed(trace);}
  return result;
}
export function callbackOutcomeContext(trace:CallbackOutcomeTrace):string {
  try{
    const rows=trace.workers,truncated=trace.truncated,observationFailed=trace.observationFailed;
    if(!Array.isArray(rows))throw new Error();
    return JSON.stringify({workers:Array.from({length:Math.min(rows.length,8)},(_,index)=>{const row=rows[index];return {...projectCallbackOutcome(row),index,report:allowed(row.report,['missing','received','invalid'],'invalid')};}),
      truncated:truncated===true||rows.length>8,observationFailed:observationFailed!==false||typeof truncated!=='boolean'||failures.has(trace)});
  }
  catch{return '{"workers":[],"truncated":false,"observationFailed":true}';}
}
