// 검사 전용 callback 분류입니다. 원문 입력/결과/오류·native DB receiver를 복사하지 않고 선택한 고정 DTO만 투영합니다.
import {createTrace,refreshClosedConnections,withSqliteDiagnosticsAsync,type PhaseTrace} from './ledgerDiagnostics.ts';
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
  workers:(CallbackOutcome&{index:number;report:'missing'|'received'|'invalid';sqlite?:CallbackSqliteObservation})[];
  truncated:boolean;observationFailed:boolean;
}
declare module 'vitest' {interface TaskMeta {callbackOutcomeDiagnostic?:CallbackOutcomeTrace;}}
const failures=new WeakSet<object>();
const sqliteExpected=new WeakSet<object>();
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
export function callbackOutcomeEnvelope(result:unknown,trace:CallbackOutcome,sqliteDiagnostic?:unknown){
  const legacy={kind:'synthetic-callback-outcome',result,diagnostic:projectCallbackOutcome(trace)};
  return arguments.length<3?legacy:{...legacy,sqliteDiagnostic:projectCallbackSqliteDiagnostic(sqliteDiagnostic)};
}
export function createCallbackOutcomeTrace(count:number,options?:{sqliteDiagnostics?:boolean}):CallbackOutcomeTrace {
  const bounded=Number.isSafeInteger(count)&&count>=0?Math.min(count,8):0;
  const trace:CallbackOutcomeTrace={workers:Array.from({length:bounded},(_,index)=>({...createCallbackOutcome(),index,report:'missing'})),truncated:count>8,observationFailed:bounded===0&&count!==0};
  if(options?.sqliteDiagnostics===true){sqliteExpected.add(trace);for(const row of trace.workers)row.sqlite={report:'missing',diagnostic:null};}
  return trace;
}
// result의 원래 참조를 반환하며 envelope/diagnostic의 getter·투영 실패를 업무 예외로 바꾸지 않습니다.
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
    const row:CallbackOutcomeTrace['workers'][number]={...projectCallbackOutcome(diagnostic),index,report};
    if(sqliteExpected.has(trace)){
      try{const descriptor=report==='received'?Object.getOwnPropertyDescriptor(value,'sqliteDiagnostic'):undefined;row.sqlite=report==='invalid'?{report:'invalid',diagnostic:null}:!descriptor?{report:'missing',diagnostic:null}:'value' in descriptor?sqliteObservation(descriptor.value):{report:'invalid',diagnostic:null};}
      catch{row.sqlite={report:'invalid',diagnostic:null};}
    }
    if(report==='missing')row.observationFailed=false;
    trace.workers[index]=row;
  }catch{failed(trace);}
  return result;
}
export function callbackOutcomeContext(trace:CallbackOutcomeTrace):string {
  try{
    const rows=trace.workers,truncated=trace.truncated,observationFailed=trace.observationFailed;
    if(!Array.isArray(rows))throw new Error();
    return JSON.stringify({workers:Array.from({length:Math.min(rows.length,8)},(_,index)=>{const row=rows[index];return {...projectCallbackOutcome(row),index,report:allowed(row.report,['missing','received','invalid'],'invalid'),...(sqliteExpected.has(trace)?{sqlite:projectSqliteObservation(row)}:{})};}),
      truncated:truncated===true||rows.length>8,observationFailed:observationFailed!==false||typeof truncated!=='boolean'||failures.has(trace)});
  }
  catch{return '{"workers":[],"truncated":false,"observationFailed":true}';}
}

export type CallbackSqliteDiagnostic={schema:1}&Pick<PhaseTrace,'sqliteErrors'|'sqliteErrorsTruncated'|'sqliteTransactions'|'sqliteTransactionsTruncated'|'sqliteTransactionObservationFailed'|'sqliteHook'>;
export interface CallbackSqliteObservation {report:'missing'|'received'|'invalid';diagnostic:CallbackSqliteDiagnostic|null;}
const sqlitePhases=['reward-open','adapter-call','close','unknown'] as const;
const sqliteOperations=['database-exec','database-prepare','statement-run','statement-get','statement-all','unknown'] as const;
const sqliteSites=['unknown','transaction-begin','transaction-commit','transaction-rollback','pragma-synchronous-full'] as const;
const transactionSites=['unknown','transaction-begin','transaction-commit','transaction-rollback'] as const;
const sqliteCodes=['ERR_SQLITE_ERROR','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_ERROR','SQLITE_IOERR','SQLITE_FULL','SQLITE_CORRUPT','SQLITE_CONSTRAINT','ERR_WORKER_OUT_OF_MEMORY','ERR_WORKER_INIT_FAILED','ERR_IPC_CHANNEL_CLOSED','other'] as const;
// 새 경계는 기존 projectTrace의 getter 읽기를 재사용하지 않습니다. Proxy descriptor trap 실패도 불량으로 남깁니다.
function ownData(value:unknown,key:string):unknown {
  if(value===null||(typeof value!=='object'&&typeof value!=='function'))throw new Error('invalid-sqlite-diagnostic');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!('value' in descriptor))throw new Error('invalid-sqlite-diagnostic');
  return descriptor.value;
}
function sqliteEnum<T extends string>(value:unknown,choices:readonly T[]):T {if(typeof value==='string'&&choices.includes(value as T))return value as T;throw new Error('invalid-sqlite-diagnostic');}
function sqliteBoolean(value:unknown):boolean {if(typeof value==='boolean')return value;throw new Error('invalid-sqlite-diagnostic');}
function sqliteNullableBoolean(value:unknown):boolean|null {return value===null?null:sqliteBoolean(value);}
function sqliteNumber(value:unknown):number {if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return value;throw new Error('invalid-sqlite-diagnostic');}
function sqliteNullableNumber(value:unknown):number|null {return value===null?null:sqliteNumber(value);}
function sqliteInteger(value:unknown,min:number,max:number):number {const n=sqliteNumber(value);if(Number.isInteger(n)&&n>=min&&n<=max)return n;throw new Error('invalid-sqlite-diagnostic');}
function sqliteNullableInteger(value:unknown,min:number,max:number):number|null {return value===null?null:sqliteInteger(value,min,max);}
function sqliteRows<T>(value:unknown,project:(row:unknown)=>T):{rows:T[];truncated:boolean} {
  if(!Array.isArray(value))throw new Error('invalid-sqlite-diagnostic');
  const length=sqliteInteger(ownData(value,'length'),0,0xffffffff),rows:T[]=[];
  for(let index=0;index<Math.min(length,8);index++)rows.push(project(ownData(value,String(index))));
  return {rows,truncated:length>8};
}
/** 원문을 stringify하지 않고 own data의 고정 DTO만 새 객체에 복사합니다. null은 유효한 빈 관측이 아닙니다. */
export function projectCallbackSqliteDiagnostic(value:unknown):CallbackSqliteDiagnostic|null {
  try{
    if(ownData(value,'schema')!==1)return null;
    const errors=sqliteRows(ownData(value,'sqliteErrors'),row=>{
      const code=ownData(row,'errorCode'),operation=sqliteEnum(ownData(row,'operation'),sqliteOperations),site=sqliteEnum(ownData(row,'site'),sqliteSites),errorCode=code===null?null:sqliteEnum(code,sqliteCodes),extendedCode=sqliteNullableInteger(ownData(row,'extendedCode'),1,65535),baseCode=sqliteNullableInteger(ownData(row,'baseCode'),1,28),transactionActive=sqliteNullableBoolean(ownData(row,'transactionActive'));
      if(operation!=='database-exec'&&(site!=='unknown'||transactionActive!==null))throw new Error('invalid-sqlite-diagnostic');
      if(errorCode!=='ERR_SQLITE_ERROR'&&(extendedCode!==null||baseCode!==null)||extendedCode===null&&baseCode!==null||extendedCode!==null&&baseCode!==(extendedCode&255))throw new Error('invalid-sqlite-diagnostic');
      return {operation,site,phase:sqliteEnum(ownData(row,'phase'),sqlitePhases),errorCode,extendedCode,baseCode,transactionActive,connectionClosed:sqliteNullableBoolean(ownData(row,'connectionClosed'))};
    });
    const transactions=sqliteRows(ownData(value,'sqliteTransactions'),row=>{
      const startedAtProcessMs=sqliteNullableNumber(ownData(row,'startedAtProcessMs')),finishedAtProcessMs=sqliteNullableNumber(ownData(row,'finishedAtProcessMs'));
      if(finishedAtProcessMs!==null&&(startedAtProcessMs===null||finishedAtProcessMs<startedAtProcessMs))throw new Error('invalid-sqlite-diagnostic');
      return {connectionIndex:sqliteNullableInteger(ownData(row,'connectionIndex'),1,8),phase:sqliteEnum(ownData(row,'phase'),sqlitePhases),site:sqliteEnum(ownData(row,'site'),transactionSites),startedAtProcessMs,finishedAtProcessMs,outcome:sqliteEnum(ownData(row,'outcome'),['unknown','returned','threw'] as const)};
    });
    const hook=ownData(value,'sqliteHook');
    return {schema:1,sqliteErrors:errors.rows,sqliteErrorsTruncated:sqliteBoolean(ownData(value,'sqliteErrorsTruncated'))||errors.truncated,sqliteTransactions:transactions.rows,sqliteTransactionsTruncated:sqliteBoolean(ownData(value,'sqliteTransactionsTruncated'))||transactions.truncated,sqliteTransactionObservationFailed:sqliteBoolean(ownData(value,'sqliteTransactionObservationFailed')),
      sqliteHook:{installation:sqliteEnum(ownData(hook,'installation'),['not-requested','pending','installed','failed','unknown'] as const),restoration:sqliteEnum(ownData(hook,'restoration'),['not-needed','pending','restored','failed','unknown'] as const),installedMethods:sqliteInteger(ownData(hook,'installedMethods'),0,5),restoreFailures:sqliteInteger(ownData(hook,'restoreFailures'),0,5)}};
  }catch{return null;}
}
function sqliteObservation(value:unknown):CallbackSqliteObservation {const diagnostic=projectCallbackSqliteDiagnostic(value);return {report:diagnostic?'received':'invalid',diagnostic};}
function projectSqliteObservation(row:unknown):CallbackSqliteObservation {
  try{const value=ownData(row,'sqlite'),report=ownData(value,'report');if(report==='missing')return {report:'missing',diagnostic:null};if(report==='received')return sqliteObservation(ownData(value,'diagnostic'));}catch{}
  return {report:'invalid',diagnostic:null};
}

/** 기존 outcome literal은 유지하고 선택한 단발 worker의 SQLite 수명만 별도로 감쌉니다. */
export async function runObservedCallbackWithSqlite(create:()=>CallbackLedger,query:unknown,trace:CallbackOutcome):Promise<ReturnType<typeof callbackOutcomeEnvelope>> {
  let sqlite:PhaseTrace|null=null;
  try{sqlite=createTrace('reward-worker');}catch{}
  const phase=(value:'reward-open'|'adapter-call'|'close')=>{if(sqlite)try{sqlite.phase=value;}catch{try{sqlite.sqliteTransactionObservationFailed=true;}catch{}}};
  const result=await withSqliteDiagnosticsAsync(sqlite,()=>runObservedCallback(()=>{
    phase('reward-open');const ledger=create();
    return {processCallback(input){phase('adapter-call');return ledger.processCallback(input);},close(){phase('close');ledger.close();}};
  },query,trace));
  // work의 finally close와 hook 복원 뒤, 대응된 실제 연결의 닫힘만 확인합니다. SQL/close 호출을 추가하지 않습니다.
  if(sqlite)try{refreshClosedConnections(sqlite,0);}catch{try{sqlite.sqliteTransactionObservationFailed=true;}catch{}}
  let diagnostic:CallbackSqliteDiagnostic|null=null;
  if(sqlite)try{diagnostic=projectCallbackSqliteDiagnostic({schema:1,sqliteErrors:sqlite.sqliteErrors,sqliteErrorsTruncated:sqlite.sqliteErrorsTruncated,sqliteTransactions:sqlite.sqliteTransactions,sqliteTransactionsTruncated:sqlite.sqliteTransactionsTruncated,sqliteTransactionObservationFailed:sqlite.sqliteTransactionObservationFailed,sqliteHook:sqlite.sqliteHook});}catch{}
  return callbackOutcomeEnvelope(result,trace,diagnostic);
}
