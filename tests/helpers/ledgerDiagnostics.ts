// 검사 전용 관측입니다. 원문 입력/결과/오류는 metadata에 복사하지 않습니다.
import {performance} from 'node:perf_hooks';
import type {Worker} from 'node:worker_threads';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {projectSchedulerSummary,projectScheduling,schedulerField,unavailableScheduling,type SchedulerProbe,type SchedulerSummary,type Scheduling} from './ledgerSchedulerProbe.ts';

const phases=['unknown','fixture','service-open','adapter-create','adapter-call','prepare','workers','reward-open','redeem','round-open','apply','start','command','get','close','open','seed','retry','invalid-limits','child-create','child-send','child-result','child-exit','reconcile','verify','reprofile','eligibility'] as const;
type Phase=typeof phases[number];
const kinds=['voucher-redeemed','reward-result','round-started','round-snapshot','command-result','rejected','service-error','worker-error','other'] as const;
const codes=['storage-unavailable','invalid-input','invalid-time','voucher-missing','round-closed','round-limit','expired','invalid-grant','reward-used','not-found','request-conflict','revision-conflict','round-terminal','shuffle-used','capacity','operation-limit','other'] as const;
const names=['Error','TypeError','RangeError','SyntaxError','AbortError','AggregateError','other'] as const;
const errorCodes=['ERR_SQLITE_ERROR','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_ERROR','SQLITE_IOERR','SQLITE_FULL','SQLITE_CORRUPT','SQLITE_CONSTRAINT','ERR_WORKER_OUT_OF_MEMORY','ERR_WORKER_INIT_FAILED','ERR_IPC_CHANNEL_CLOSED','other'] as const;
const sqliteOperations=['database-exec','database-prepare','statement-run','statement-get','statement-all','unknown'] as const;
// site는 정적 SQL의 종류이며 호출자 위치나 잠금 소유자를 판정하지 않습니다.
const sqliteSites=['unknown','transaction-begin','transaction-commit','transaction-rollback','pragma-synchronous-full'] as const;
const transactionSites=['unknown','transaction-begin','transaction-commit','transaction-rollback'] as const;
const transactionOutcomes=['unknown','returned','threw'] as const;
interface SqliteTransactionRow {connectionIndex:number|null;phase:Phase;site:typeof transactionSites[number];startedAtProcessMs:number|null;finishedAtProcessMs:number|null;outcome:typeof transactionOutcomes[number];scheduling?:Scheduling;}
interface SqliteErrorRow {operation:typeof sqliteOperations[number];site:typeof sqliteSites[number];phase:Phase;errorCode:ReturnType<typeof safeError>['errorCode'];extendedCode:number|null;baseCode:number|null;transactionActive:boolean|null;connectionClosed:boolean|null;}
export interface ConstructorAttempt {attempt:number;opened:boolean;nativeCount:number;closeObserved:boolean;closeSucceeded:boolean;closeFailed:boolean;closeHookInstalled:boolean;closeHookRestored:boolean;retryScheduled:boolean;waitMs:number;}
const hookInstallStates=['not-requested','pending','installed','failed','unknown'] as const,hookRestoreStates=['not-needed','pending','restored','failed','unknown'] as const;
interface SqliteHookState {installation:typeof hookInstallStates[number];restoration:typeof hookRestoreStates[number];installedMethods:number;restoreFailures:number;}
function allowed<T extends string>(value:unknown,values:readonly T[],fallback:T):T{return typeof value==='string'&&values.includes(value as T)?value as T:fallback;}
function field(value:unknown,key:string):unknown {try{return value!==null&&(typeof value==='object'||typeof value==='function')?Reflect.get(value,key):undefined;}catch{return undefined;}}
function number(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
export function safeResult(value:unknown){return {kind:allowed(field(value,'kind'),kinds,'other'),code:field(value,'code')===undefined?null:allowed(field(value,'code'),codes,'other')};}
export function safeError(value:unknown){return {errorName:allowed(field(value,'name'),names,'other'),errorCode:field(value,'code')===undefined?null:allowed(field(value,'code'),errorCodes,'other')};}
export interface PhaseTrace {
  phase:Phase; elapsedMs:number; resultPhase:Phase|null; errorPhase:Phase|null;
  errorName:ReturnType<typeof safeError>['errorName']|null; errorCode:ReturnType<typeof safeError>['errorCode'];
  steps:{phase:Phase;startedAtMs:number;durationMs:number|null}[];
  sqliteErrors:SqliteErrorRow[];sqliteErrorsTruncated:boolean;
  sqliteTransactions:SqliteTransactionRow[];sqliteTransactionsTruncated:boolean;sqliteTransactionObservationFailed:boolean;
  sqliteHook:SqliteHookState;
  constructorAttempts:ConstructorAttempt[];
  schedulerProbe?:SchedulerSummary;
}
export interface WorkerRow extends ReturnType<typeof safeResult> {
  index:number;readyAtMs:number|null;goAtMs:number|null;resultAtMs:number|null;exitAtMs:number|null;exitCode:number|null;
  terminationRequested:boolean;terminationRequestedAtMs:number|null;diagnostic:PhaseTrace|null;
  errorName:ReturnType<typeof safeError>['errorName']|null;errorCode:ReturnType<typeof safeError>['errorCode'];
}
export interface ChildRow {index:number;createdAtMs:number|null;sentAtMs:number|null;resultAtMs:number|null;exitAtMs:number|null;exitCode:number|null;terminationRequested:boolean;errorName:ReturnType<typeof safeError>['errorName']|null;errorCode:ReturnType<typeof safeError>['errorCode'];}
export interface LedgerTrace extends PhaseTrace {
  family:'reward-worker'|'round-worker'|'reward-parallel'|'round-parallel'|'http-body'|'purchase-restart'|'purchase-batch'|'reward-capacity';
  workers:WorkerRow[];children:ChildRow[];caseIndex:number|null;status:number|null;authCallCount:number|null;
}
declare module 'vitest' {interface TaskMeta {ledgerDiagnostic?:LedgerTrace;}}
const starts=new WeakMap<PhaseTrace,number>();
export function createTrace(family:LedgerTrace['family']):LedgerTrace {
  const trace:LedgerTrace={family,phase:'unknown',elapsedMs:0,resultPhase:null,errorPhase:null,errorName:null,errorCode:null,steps:[],sqliteErrors:[],sqliteErrorsTruncated:false,sqliteTransactions:[],sqliteTransactionsTruncated:false,sqliteTransactionObservationFailed:false,sqliteHook:{installation:'not-requested',restoration:'not-needed',installedMethods:0,restoreFailures:0},constructorAttempts:[],workers:[],children:[],caseIndex:null,status:null,authCallCount:null};
  starts.set(trace,performance.now());return trace;
}
export function elapsed(trace:PhaseTrace):number {return Math.max(0,performance.now()-starts.get(trace)!);}
export function beginPhase(trace:PhaseTrace,phase:Phase):()=>void {
  trace.phase=phase;trace.elapsedMs=elapsed(trace);const row={phase,startedAtMs:trace.elapsedMs,durationMs:null as number|null};trace.steps.push(row);
  return ()=>{trace.elapsedMs=elapsed(trace);row.durationMs=Math.max(0,trace.elapsedMs-row.startedAtMs);};
}
export function step<T>(trace:PhaseTrace|null,phase:Phase,work:()=>T):T {if(!trace)return work();const done=beginPhase(trace,phase);try{return work();}finally{done();}}
export async function asyncStep<T>(trace:PhaseTrace,phase:Phase,work:()=>Promise<T>):Promise<T> {const done=beginPhase(trace,phase);try{return await work();}finally{done();}}
export function recordError(trace:PhaseTrace,error:unknown):void {if(trace.errorPhase===null){trace.errorPhase=trace.phase;Object.assign(trace,safeError(error));}}
export function resultAt<T>(trace:PhaseTrace|null,result:T):T {if(trace)trace.resultPhase=trace.phase;return result;}
function sqliteCode(value:unknown):{extendedCode:number|null;baseCode:number|null} {
  if(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=65535){const baseCode=value&255;if(baseCode>=1&&baseCode<=28)return {extendedCode:value,baseCode};}
  return {extendedCode:null,baseCode:null};
}
// 실제 native receiver는 이 WeakMap 밖으로 반환/직렬화하지 않습니다.
const nativeDatabases=new WeakMap<SqliteErrorRow,object>();
function nativeBoolean(database:object,key:'isOpen'|'isTransaction'):boolean|null {
  try{const getter=Object.getOwnPropertyDescriptor(database,key)?.get??Object.getOwnPropertyDescriptor(DatabaseSync.prototype,key)?.get;if(!getter)return null;const value=Reflect.apply(getter,database,[]);return typeof value==='boolean'?value:null;}catch{return null;}
}
export function matchesFailedConnection(trace:PhaseTrace,from:number,database:unknown):boolean {return trace.sqliteErrors.slice(from).some(row=>nativeDatabases.get(row)===database);}
export function refreshClosedConnections(trace:PhaseTrace,from:number):void {for(const row of trace.sqliteErrors.slice(from)){const database=nativeDatabases.get(row),open=database?nativeBoolean(database,'isOpen'):null;row.connectionClosed=open===null?null:!open;}}
function sqliteSite(operation:SqliteErrorRow['operation'],input:unknown):SqliteErrorRow['site'] {
  if(operation!=='database-exec'||typeof input!=='string')return 'unknown';
  switch(input){case 'BEGIN IMMEDIATE':return 'transaction-begin';case 'COMMIT':return 'transaction-commit';case 'ROLLBACK':return 'transaction-rollback';case 'PRAGMA synchronous=FULL':return 'pragma-synchronous-full';default:return 'unknown';}
}
// 연결은 약한 참조로만 대응하고 번호는 trace 안의 1..8입니다. 실제 receiver는 행에 저장하지 않습니다.
const transactionConnections=new WeakMap<PhaseTrace,{ids:WeakMap<object,number>;next:number}>();
function transactionObservationFailed(trace:PhaseTrace):void {try{trace.sqliteTransactionObservationFailed=true;}catch{}}
function beginTransactionObservation(trace:PhaseTrace,input:unknown,receiver:unknown):SqliteTransactionRow|null {
  try{
    const site=sqliteSite('database-exec',input);if(site!=='transaction-begin'&&site!=='transaction-commit'&&site!=='transaction-rollback')return null;
    if(trace.sqliteTransactions.length>=8){trace.sqliteTransactionsTruncated=true;return null;}
    let connectionIndex:number|null=null;
    if(receiver!==null&&(typeof receiver==='object'||typeof receiver==='function')){
      let connections=transactionConnections.get(trace);if(!connections){connections={ids:new WeakMap(),next:1};transactionConnections.set(trace,connections);}
      connectionIndex=connections.ids.get(receiver)??null;
      if(connectionIndex===null){if(connections.next>8){trace.sqliteTransactionsTruncated=true;return null;}connectionIndex=connections.next++;connections.ids.set(receiver,connectionIndex);}
    }
    // performance.now는 프로세스 시작 기준이며 기존 elapsed/step의 trace 상대 시간과 다릅니다.
    const startedAtProcessMs=number(performance.now());if(startedAtProcessMs===null)transactionObservationFailed(trace);
    const row:SqliteTransactionRow={connectionIndex,phase:trace.phase,site,startedAtProcessMs,finishedAtProcessMs:null,outcome:'unknown'};
    trace.sqliteTransactions.push(row);return row;
  }catch{transactionObservationFailed(trace);return null;}
}
function finishTransactionObservation(trace:PhaseTrace,row:SqliteTransactionRow|null,outcome:'returned'|'threw'):void {
  if(!row)return;
  try{
    row.outcome=outcome;const finished=number(performance.now()),started=row.startedAtProcessMs;
    row.finishedAtProcessMs=finished!==null&&started!==null&&finished>=started?finished:null;
    if(row.finishedAtProcessMs===null)transactionObservationFailed(trace);
  }catch{transactionObservationFailed(trace);}
}
// 단발 worker의 동기 execute 범위에서만 사용합니다.
// SQL은 고정 literal과의 완전 일치만 분류하며 원문·인자·errstr·원문 오류는 저장/출력하지 않습니다.
export function withSqliteDiagnostics<T>(trace:PhaseTrace|null,work:()=>T,options?:{schedulerProbe?:SchedulerProbe}):T {
  if(!trace)return work();
  const scheduler=schedulerField(options,'schedulerProbe') as SchedulerProbe|undefined;let schedulingCount=0;
  if(scheduler)try{const summary=projectSchedulerSummary(schedulerField(scheduler,'summary'));if(summary)trace.schedulerProbe=summary;}catch{}
  const finishScheduling=(row:SqliteTransactionRow|null,attempted:boolean,sampled:boolean,sample:unknown)=>{
    if(!attempted||!row)return;
    try{
      let dto=unavailableScheduling();
      if(sampled)try{dto=scheduler!.after(sample,{startedAtProcessMs:row.startedAtProcessMs,finishedAtProcessMs:row.finishedAtProcessMs});}catch{}
      row.scheduling=projectScheduling(dto,{startedAtProcessMs:row.startedAtProcessMs,finishedAtProcessMs:row.finishedAtProcessMs})??unavailableScheduling();
    }catch{transactionObservationFailed(trace);}
  };
  const targets:[object,string,SqliteErrorRow['operation']][]=[[DatabaseSync.prototype,'exec','database-exec'],[DatabaseSync.prototype,'prepare','database-prepare'],[StatementSync.prototype,'run','statement-run'],[StatementSync.prototype,'get','statement-get'],[StatementSync.prototype,'all','statement-all']];
  const state=trace.sqliteHook,saved:{prototype:object;key:string;operation:SqliteErrorRow['operation'];descriptor:PropertyDescriptor}[]=[];
  let attempted=false,installed=false;state.installation='pending';state.restoration='not-needed';state.installedMethods=0;state.restoreFailures=0;
  const restore=()=>{
    state.restoration='pending';let failures=0;
    // 한 항목이 실패해도 나머지를 모두 복원하고 원래 work의 return/throw를 덮지 않습니다.
    for(const {prototype,key,descriptor} of [...saved].reverse())try{Object.defineProperty(prototype,key,descriptor);}catch{failures++;}
    state.restoreFailures=failures;state.restoration=failures?'failed':'restored';
  };
  try{
    for(const [prototype,key,operation] of targets){const descriptor=Object.getOwnPropertyDescriptor(prototype,key);if(!descriptor||typeof descriptor.value!=='function'||!descriptor.configurable)throw new Error('검사 SQLite 관측 준비 실패');saved.push({prototype,key,operation,descriptor});}
    attempted=true;
    for(const {prototype,key,operation,descriptor} of saved){Object.defineProperty(prototype,key,{...descriptor,value:function(this:unknown,...args:unknown[]){
      let schedulingAttempted=false,sampled=false,sample:unknown;
      try{if(scheduler?.active===true&&operation==='database-exec'&&(trace.phase==='round-open'||trace.phase==='command')&&(args[0]==='BEGIN IMMEDIATE'||args[0]==='COMMIT')&&trace.sqliteTransactions.length<8&&schedulingCount<8){schedulingAttempted=true;schedulingCount++;sample=scheduler.before();sampled=true;}}catch{}
      const transaction=operation==='database-exec'?beginTransactionObservation(trace,args[0],this):null;
      try{const result=Reflect.apply(descriptor.value,this,args);finishTransactionObservation(trace,transaction,'returned');finishScheduling(transaction,schedulingAttempted,sampled,sample);return result;}
      catch(error){
        finishTransactionObservation(trace,transaction,'threw');
        finishScheduling(transaction,schedulingAttempted,sampled,sample);
        // 수집 실패도 원래 예외의 종류/참조를 바꾸지 않습니다.
        try{if(trace.sqliteErrors.length<8){const errorCode=safeError(error).errorCode;const row:SqliteErrorRow={operation,site:sqliteSite(operation,args[0]),phase:trace.phase,errorCode,...sqliteCode(errorCode==='ERR_SQLITE_ERROR'?field(error,'errcode'):undefined),transactionActive:operation==='database-exec'?nativeBoolean(this as object,'isTransaction'):null,connectionClosed:null};if(operation==='database-exec'&&this!==null&&typeof this==='object')nativeDatabases.set(row,this);trace.sqliteErrors.push(row);}else trace.sqliteErrorsTruncated=true;}catch{}
        throw error;
      }
    }});state.installedMethods++;}
    state.installation='installed';installed=true;
  }catch{state.installation='failed';if(attempted)restore();}
  // 준비/설치 실패도 실제 동작은 원래대로 한 번 실행합니다. 진단은 성공으로 표시하지 않습니다.
  try{return work();}finally{if(installed)restore();}
}
function methodCount(value:unknown):number {return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=5?value:0;}
export function projectTrace(value:unknown):PhaseTrace {
  const steps=field(value,'steps'),sqliteErrors=field(value,'sqliteErrors'),transactions=field(value,'sqliteTransactions'),hook=field(value,'sqliteHook'),attempts=field(value,'constructorAttempts');
  const schedulerProbe=projectSchedulerSummary(schedulerField(value,'schedulerProbe'));
  return {phase:allowed(field(value,'phase'),phases,'unknown'),elapsedMs:number(field(value,'elapsedMs'))??0,
    resultPhase:field(value,'resultPhase')===null?null:allowed(field(value,'resultPhase'),phases,'unknown'),errorPhase:field(value,'errorPhase')===null?null:allowed(field(value,'errorPhase'),phases,'unknown'),
    errorName:field(value,'errorName')===null?null:allowed(field(value,'errorName'),names,'other'),errorCode:field(value,'errorCode')===null?null:allowed(field(value,'errorCode'),errorCodes,'other'),
    steps:Array.isArray(steps)?steps.slice(0,8).map(row=>({phase:allowed(field(row,'phase'),phases,'unknown'),startedAtMs:number(field(row,'startedAtMs'))??0,durationMs:number(field(row,'durationMs'))})):[],
    sqliteErrors:Array.isArray(sqliteErrors)?sqliteErrors.slice(0,8).map(row=>{const operation=allowed(field(row,'operation'),sqliteOperations,'unknown'),errorCode=field(row,'errorCode')===null?null:allowed(field(row,'errorCode'),errorCodes,'other');return {operation,site:operation==='database-exec'?allowed(field(row,'site'),sqliteSites,'unknown'):'unknown',phase:allowed(field(row,'phase'),phases,'unknown'),errorCode,...sqliteCode(errorCode==='ERR_SQLITE_ERROR'?field(row,'extendedCode'):undefined),transactionActive:booleanOrNull(field(row,'transactionActive')),connectionClosed:booleanOrNull(field(row,'connectionClosed'))};}):[],sqliteErrorsTruncated:field(value,'sqliteErrorsTruncated')===true||(Array.isArray(sqliteErrors)&&sqliteErrors.length>8),
    sqliteTransactions:Array.isArray(transactions)?transactions.slice(0,8).map(row=>{const connection=field(row,'connectionIndex'),startedAtProcessMs=number(field(row,'startedAtProcessMs')),finished=number(field(row,'finishedAtProcessMs')),scheduling=projectScheduling(schedulerField(row,'scheduling'),{startedAtProcessMs,finishedAtProcessMs:finished});return {connectionIndex:typeof connection==='number'&&Number.isInteger(connection)&&connection>=1&&connection<=8?connection:null,phase:allowed(field(row,'phase'),phases,'unknown'),site:allowed(field(row,'site'),transactionSites,'unknown'),startedAtProcessMs,finishedAtProcessMs:startedAtProcessMs!==null&&finished!==null&&finished>=startedAtProcessMs?finished:null,outcome:allowed(field(row,'outcome'),transactionOutcomes,'unknown'),...(scheduling?{scheduling}:{})};}):[],
    sqliteTransactionsTruncated:field(value,'sqliteTransactionsTruncated')===true||(Array.isArray(transactions)&&transactions.length>8),sqliteTransactionObservationFailed:field(value,'sqliteTransactionObservationFailed')===true,
    sqliteHook:{installation:allowed(field(hook,'installation'),hookInstallStates,'unknown'),restoration:allowed(field(hook,'restoration'),hookRestoreStates,'unknown'),installedMethods:methodCount(field(hook,'installedMethods')),restoreFailures:methodCount(field(hook,'restoreFailures'))},
    constructorAttempts:Array.isArray(attempts)?attempts.slice(0,3).map(row=>({attempt:boundedCount(field(row,'attempt'),3),opened:field(row,'opened')===true,nativeCount:boundedCount(field(row,'nativeCount'),8),closeObserved:field(row,'closeObserved')===true,closeSucceeded:field(row,'closeSucceeded')===true,closeFailed:field(row,'closeFailed')===true,closeHookInstalled:field(row,'closeHookInstalled')===true,closeHookRestored:field(row,'closeHookRestored')===true,retryScheduled:field(row,'retryScheduled')===true,waitMs:field(row,'waitMs')===25?25:0})):[],...(schedulerProbe?{schedulerProbe}:{})};
}
function booleanOrNull(value:unknown):boolean|null {return typeof value==='boolean'?value:null;}
function boundedCount(value:unknown,max:number):number {return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=max?value:0;}
export function workerRow(index:number):WorkerRow {return {index,readyAtMs:null,goAtMs:null,resultAtMs:null,exitAtMs:null,exitCode:null,terminationRequested:false,terminationRequestedAtMs:null,kind:'other',code:null,diagnostic:null,errorName:null,errorCode:null};}
export function childRow(index:number):ChildRow {return {index,createdAtMs:null,sentAtMs:null,resultAtMs:null,exitAtMs:null,exitCode:null,terminationRequested:false,errorName:null,errorCode:null};}
// envelope 전체를 문자열화하지 않고 기존 결과와 안전한 진단을 분리합니다.
export function receiveWorker(value:any,row:WorkerRow):any {
  const wrapped=field(value,'kind')==='synthetic-worker-report';const result=wrapped?field(value,'result'):value;
  Object.assign(row,safeResult(result));if(wrapped)row.diagnostic=projectTrace(field(value,'diagnostic'));return result;
}
export function safeRows(trace:LedgerTrace):string {return JSON.stringify(trace.workers);}
const observations=new WeakMap<Worker,{trace:LedgerTrace;row:WorkerRow}>();
export function observeWorker(worker:Worker,trace:LedgerTrace,row:WorkerRow):void {
  observations.set(worker,{trace,row});
  worker.on('error',error=>Object.assign(row,safeError(error)));
  worker.on('exit',code=>{row.exitCode=code;row.exitAtMs=elapsed(trace);});
}
export function terminateWorker(worker:Worker):Promise<number> {
  // 이미 관측한 자연 종료를 정리 요청에 따른 종료로 덮지 않습니다. terminate 호출 자체는 기존대로 유지합니다.
  const observation=observations.get(worker);if(observation&&observation.row.exitAtMs===null){observation.row.terminationRequested=true;observation.row.terminationRequestedAtMs=elapsed(observation.trace);}
  return worker.terminate();
}
export function workerFailure(error:unknown,trace?:LedgerTrace):unknown {return trace?new Error('합성 worker 실행 오류 '+safeRows(trace)):error;}
