// 검사 전용 선택 관측입니다. 원문 SQL·경로·native receiver는 DTO에 넣지 않습니다.
import {performance} from 'node:perf_hooks';
import {DatabaseSync,StatementSync} from 'node:sqlite';

// 모듈 적재 때 원본 함수/공식 prototype accessor만 보존합니다. DB를 만들거나 SQL을 실행하지 않습니다.
const nativeExec=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')?.value;
const nativePrepare=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'prepare')?.value;
const nativeGet=Object.getOwnPropertyDescriptor(StatementSync.prototype,'get')?.value;
const nativePrototypeAccessors={
  isOpen:Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'isOpen')?.get,
  isTransaction:Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'isTransaction')?.get
};
const limit=8;
const roles=['reward','round','inbox','unknown'] as const;
const evidence=['observed-reward-open','observed-round-open','observed-reward-statement','observed-inbox-statement','unavailable'] as const;
const phases=['reward-open','redeem','round-open','apply','adapter-call','inbox-open','inbox-receive','inbox-process','inbox-close','unknown'] as const;
const outcomes=['unknown','returned','threw'] as const;
const ends=['missing','begin-threw','commit-returned','rollback-returned','end-threw','orphan','repeated-end','superseded'] as const;
const connectionStates=['open','closed','unknown'] as const;
const clockReasons=['parent-unverified','missing','read-failed','invalid','origin-mismatch','outside-window','verified'] as const;
const journalModes=['delete','wal','unavailable'] as const;
type Site='begin'|'commit'|'rollback';
type Outcome=typeof outcomes[number];
export interface SpanSqliteError {primaryCode:number|null;extendedCode:number|null;}
export interface SpanCall {startedAtProcessMs:number|null;finishedAtProcessMs:number|null;outcome:Outcome;transactionActiveAfter:boolean|null;sqliteError?:SpanSqliteError;}
export interface TransactionSpan {
  connectionIndex:number|null;role:typeof roles[number];roleEvidence:typeof evidence[number];phase:typeof phases[number];
  begin:SpanCall|null;commit:SpanCall|null;rollback:SpanCall|null;
  endObservation:typeof ends[number];endAttemptsTruncated:boolean;
  connectionAtScopeEnd:typeof connectionStates[number];transactionActiveAtScopeEnd:boolean|null;
  /** 이 구간 이전의 기존 native 조회값입니다. 부재는 미관측이며 현재 mode/잠금 owner 증명이 아닙니다. */
  journalMode?:typeof journalModes[number];
}
export interface SpanClockAnchor {originMs:number|null;sentAtProcessMs:number|null;}
export interface SpanClock {
  status:'verified'|'unavailable';reason:typeof clockReasons[number];
  originMs:number|null;parentOriginMs:number|null;parentSentAtProcessMs:number|null;
  workerStartedAtProcessMs:number|null;workerFinishedAtProcessMs:number|null;parentReceivedAtProcessMs:number|null;
}
export interface TransactionSpans {
  schema:1;clock:SpanClock;spans:TransactionSpan[];spansTruncated:boolean;connectionsTruncated:boolean;observationFailed:boolean;
}
export interface SpanClockProvider {origin:()=>unknown;now:()=>unknown;}
const defaultClock:SpanClockProvider={origin:()=>performance.timeOrigin,now:()=>performance.now()};
const own=(value:unknown,key:string):unknown=>{try{if(value===null||(typeof value!=='object'&&typeof value!=='function'))return;const d=Object.getOwnPropertyDescriptor(value,key);return d&&'value' in d?d.value:undefined;}catch{return;}};
const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER?value:null;
const bool=(value:unknown):boolean|null=>typeof value==='boolean'?value:null;
const unknownSqliteError=():SpanSqliteError=>({primaryCode:null,extendedCode:null});
function sqliteCodes(extended:unknown,primary:unknown):SpanSqliteError {
  if(typeof extended!=='number'||!Number.isInteger(extended)||extended<1||extended>65535)return unknownSqliteError();
  const base=extended&255;
  return base>=1&&base<=28&&primary===base?{primaryCode:base,extendedCode:extended}:unknownSqliteError();
}
function nativeSqliteError(error:unknown):SpanSqliteError {
  if(own(error,'code')!=='ERR_SQLITE_ERROR')return unknownSqliteError();
  const extended=own(error,'errcode');
  return sqliteCodes(extended,typeof extended==='number'?extended&255:null);
}
function choice<T extends string>(value:unknown,values:readonly T[],fallback:T):T {return typeof value==='string'&&values.includes(value as T)?value as T:fallback;}
function readClock(read:()=>unknown):number|null {try{return finite(read());}catch{return null;}}
export function createSpanClockAnchor(clock:SpanClockProvider=defaultClock):SpanClockAnchor {
  return {originMs:readClock(()=>clock.origin()),sentAtProcessMs:readClock(()=>clock.now())};
}
type NativeAccessors=Partial<Record<'isOpen'|'isTransaction',()=>unknown>>;
function siteOf(sql:unknown):Site|null {return sql==='BEGIN IMMEDIATE'?'begin':sql==='COMMIT'?'commit':sql==='ROLLBACK'?'rollback':null;}
interface Connection {index:number;receiver:WeakRef<object>;role:TransactionSpan['role'];roleEvidence:TransactionSpan['roleEvidence'];active?:TransactionSpan;}
export interface SpanToken {span:TransactionSpan;call:SpanCall|null;site:Site;connection?:Connection;receiver:object|null;}
export interface SpanRecorder {report:TransactionSpans;before(sql:unknown,receiver:unknown,phase:unknown):SpanToken|null;after(token:SpanToken|null,outcome:'returned'|'threw',executed?:unknown,error?:unknown):void;nativeReturned?(operation:'exec'|'prepare',sql:unknown,receiver:unknown,executed:unknown):void;journalReturned?(operation:'prepare'|'get',receiver:unknown,executed:unknown,result:unknown,sql?:unknown):void;finish():void;}

/** BEGIN/끝 호출을 한 행에 보존합니다. 관측 오류는 원래 SQLite 동작을 바꾸지 않습니다. */
export function createSpanRecorder(anchor?:unknown,clock:SpanClockProvider=defaultClock):SpanRecorder {
  const report:TransactionSpans={schema:1,clock:{status:'unavailable',reason:'parent-unverified',originMs:readClock(()=>clock.origin()),parentOriginMs:finite(own(anchor,'originMs')),parentSentAtProcessMs:finite(own(anchor,'sentAtProcessMs')),workerStartedAtProcessMs:readClock(()=>clock.now()),workerFinishedAtProcessMs:null,parentReceivedAtProcessMs:null},spans:[],spansTruncated:false,connectionsTruncated:false,observationFailed:false};
  const known=new WeakMap<object,Connection>(),connections:Connection[]=[];
  const statementRoles=new WeakMap<object,{role:TransactionSpan['role'];evidence:TransactionSpan['roleEvidence']}>(),conflicted=new WeakSet<object>();
  const verified=new WeakMap<object,NativeAccessors>();
  const journalStatements=new WeakMap<object,WeakRef<object>>(),journalByConnection=new WeakMap<object,typeof journalModes[number]>();
  const verifyReceiver=(receiver:object,executed:unknown)=>{
    if(typeof nativeExec!=='function'||executed!==nativeExec)return;
    const accessors=verified.get(receiver)??Object.create(null) as NativeAccessors;
    // 원본 native exec의 성공 반환이 brand를 입증한 receiver만 검사합니다.
    // Node22/24의 own nonconfigurable accessor는 이 조건에서만 cache합니다.
    for(const key of ['isOpen','isTransaction'] as const)if(!accessors[key])try{
      const official=nativePrototypeAccessors[key];
      if(official)accessors[key]=official;
      else {const descriptor=Object.getOwnPropertyDescriptor(receiver,key);if(descriptor?.configurable===false&&typeof descriptor.get==='function')accessors[key]=descriptor.get;}
    }catch{}
    verified.set(receiver,accessors);
  };
  const nativeState=(receiver:object,key:'isOpen'|'isTransaction'):boolean|null=>{
    try{const getter=verified.get(receiver)?.[key];return getter?bool(Reflect.apply(getter,receiver,[])):null;}catch{return null;}
  };
  const fail=()=>{try{report.observationFailed=true;}catch{}};
  const now=()=>{const value=readClock(()=>clock.now());if(value===null)fail();return value;};
  const allocate=(connection:Connection|undefined,phase:unknown):TransactionSpan|null=>{
    if(report.spans.length>=limit){report.spansTruncated=true;return null;}
    const span:TransactionSpan={connectionIndex:connection?.index??null,role:connection?.role??'unknown',roleEvidence:connection?.roleEvidence??'unavailable',phase:choice(phase,phases,'unknown'),begin:null,commit:null,rollback:null,endObservation:'missing',endAttemptsTruncated:false,connectionAtScopeEnd:'unknown',transactionActiveAtScopeEnd:null};
    const receiver=connection?.receiver.deref();
    if(receiver&&journalByConnection.has(receiver))span.journalMode=journalByConnection.get(receiver);
    report.spans.push(span);return span;
  };
  return {report,
    before(sql,receiver,phase){
      try{
        const site=siteOf(sql);if(!site)return null;
        const object=receiver!==null&&(typeof receiver==='object'||typeof receiver==='function')?receiver as object:null;
        let connection=object?known.get(object):undefined;
        if(!connection&&object){
          if(connections.length>=limit){report.connectionsTruncated=true;report.spansTruncated=true;return null;}
          const observed=statementRoles.get(object),role=observed?.role??(phase==='reward-open'?'reward':phase==='round-open'?'round':'unknown');
          connection={index:connections.length+1,receiver:new WeakRef(object),role,roleEvidence:observed?.evidence??(role==='reward'?'observed-reward-open':role==='round'?'observed-round-open':'unavailable')};
          connections.push(connection);known.set(object,connection);
        }
        const span=site==='begin'?allocate(connection,phase):connection?.active??allocate(connection,phase);
        if(!span)return null;
        if(site!=='begin'&&!span.begin)span.endObservation='orphan';
        if(span[site]){span.endAttemptsTruncated=true;return {span,call:null,site,connection,receiver:object};}
        const call:SpanCall={startedAtProcessMs:now(),finishedAtProcessMs:null,outcome:'unknown',transactionActiveAfter:null};span[site]=call;
        return {span,call,site,connection,receiver:object};
      }catch{fail();return null;}
    },
    after(token,outcome,executed,error){
      if(!token)return;
      try{
        const {span,call,connection,site,receiver}=token;
        if(receiver&&outcome==='returned')verifyReceiver(receiver,executed);
        if(call){
          call.outcome=outcome;const end=now(),start=call.startedAtProcessMs;
          call.finishedAtProcessMs=start!==null&&end!==null&&end>=start?end:null;if(call.finishedAtProcessMs===null)fail();
          call.transactionActiveAfter=receiver?nativeState(receiver,'isTransaction'):null;
          if(outcome==='threw')call.sqliteError=executed===nativeExec?nativeSqliteError(error):unknownSqliteError();
        }
        if(site==='begin'){
          if(outcome==='threw')span.endObservation='begin-threw';
          else if(connection){if(connection.active&&connection.active!==span)connection.active.endObservation='superseded';connection.active=span;}
        }else{
          span.endObservation=!call?'repeated-end':!span.begin?'orphan':outcome==='threw'?'end-threw':site==='commit'?'commit-returned':'rollback-returned';
          if(connection){if(outcome==='returned')connection.active=undefined;else connection.active=span;}
        }
      }catch{fail();}
    },
    nativeReturned(operation,sql,receiver,executed){
      try{
        if(operation!=='exec'&&operation!=='prepare')return;
        if(executed!==(operation==='exec'?nativeExec:nativePrepare)||typeof sql!=='string'||receiver===null||(typeof receiver!=='object'&&typeof receiver!=='function'))return;
        const object=receiver as object;
        if(operation==='exec')verifyReceiver(object,executed);
        let role:'inbox'|'reward'|undefined;
        if(operation==='exec'){
          if(/^CREATE TABLE(?: IF NOT EXISTS)? callback_(?:meta|inbox) \(/.test(sql))role='inbox';
          else if(/^CREATE TABLE(?: IF NOT EXISTS)? reward_meta \(/.test(sql))role='reward';
        }else if(sql==='SELECT * FROM callback_meta WHERE id=1'||sql==='SELECT profile,high_water FROM callback_meta WHERE id=1')role='inbox';
        else if(sql==='SELECT profile FROM reward_meta WHERE id=1'||sql==='SELECT * FROM reward_meta')role='reward';
        if(!role||conflicted.has(object))return;
        const current=statementRoles.get(object),connection=known.get(object);
        if(current&&current.role!==role||connection&&connection.role!=='unknown'&&connection.role!==role){
          conflicted.add(object);statementRoles.set(object,{role:'unknown',evidence:'unavailable'});fail();
          if(connection){connection.role='unknown';connection.roleEvidence='unavailable';for(const span of report.spans)if(span.connectionIndex===connection.index){span.role='unknown';span.roleEvidence='unavailable';}}
          return;
        }
        const source=role==='inbox'?'observed-inbox-statement':'observed-reward-statement';statementRoles.set(object,{role,evidence:source});
        if(connection){connection.role=role;connection.roleEvidence=source;for(const span of report.spans)if(span.connectionIndex===connection.index){span.role=role;span.roleEvidence=source;}}
      }catch{fail();}
    },
    journalReturned(operation,receiver,executed,result,sql){
      // 신뢰된 wrapper의 실제 Reflect.apply 성공 직후에만 호출합니다. 원본 함수 참조만으로 호출을 증명하지 않습니다.
      try{
        if(receiver===null||(typeof receiver!=='object'&&typeof receiver!=='function'))return;
        if(operation==='prepare'){
          if(executed!==nativePrepare||typeof nativePrepare!=='function'||sql!=='PRAGMA journal_mode'||result===null||(typeof result!=='object'&&typeof result!=='function'))return;
          journalStatements.set(result as object,new WeakRef(receiver as object));
        }else if(operation==='get'&&typeof nativeGet==='function'&&executed===nativeGet){
          const connection=journalStatements.get(receiver as object)?.deref();if(!connection)return;
          journalByConnection.set(connection,choice(own(result,'journal_mode'),journalModes,'unavailable'));
        }
      }catch{fail();}
    },
    finish(){
      try{
        report.clock.workerFinishedAtProcessMs=now();
        const start=report.clock.workerStartedAtProcessMs,end=report.clock.workerFinishedAtProcessMs;
        if(start===null||end===null||end<start){report.clock.reason='invalid';fail();}
        for(const connection of connections){
          const receiver=connection.receiver.deref(),open=receiver?nativeState(receiver,'isOpen'):null;
          const active=open===true&&receiver?nativeState(receiver,'isTransaction'):null;
          for(const span of report.spans)if(span.connectionIndex===connection.index){span.connectionAtScopeEnd=open===null?'unknown':open?'open':'closed';span.transactionActiveAtScopeEnd=active;}
        }
      }catch{fail();}
    }
  };
}

function projectCall(value:unknown):SpanCall|null {
  if(value===null||value===undefined)return null;
  const start=finite(own(value,'startedAtProcessMs')),end=finite(own(value,'finishedAtProcessMs'));
  const outcome=choice(own(value,'outcome'),outcomes,'unknown'),rawError=outcome==='threw'?own(value,'sqliteError'):undefined;
  return {startedAtProcessMs:start,finishedAtProcessMs:start!==null&&end!==null&&end>=start?end:null,outcome,transactionActiveAfter:bool(own(value,'transactionActiveAfter')),...(rawError===undefined?{}:{sqliteError:sqliteCodes(own(rawError,'extendedCode'),own(rawError,'primaryCode'))})};
}
/** worker의 검증 주장은 신뢰하지 않고 실제 부모 anchor/수신 시각으로 다시 판정합니다. */
export function projectTransactionSpans(value:unknown,anchor?:unknown,clock:SpanClockProvider=defaultClock):TransactionSpans|undefined {
  if(value===undefined)return;
  try{
    if(own(value,'schema')!==1)throw new Error('invalid-span-schema');
    const rawClock=own(value,'clock'),rawSpans=own(value,'spans');
    const origin=finite(own(rawClock,'originMs')),sent=finite(own(anchor,'sentAtProcessMs')),parentOrigin=finite(own(anchor,'originMs'));
    const started=finite(own(rawClock,'workerStartedAtProcessMs')),finished=finite(own(rawClock,'workerFinishedAtProcessMs'));
    const currentOrigin=anchor===undefined?null:readClock(()=>clock.origin()),received=anchor===undefined?null:readClock(()=>clock.now());
    const projected:TransactionSpans={schema:1,clock:{status:'unavailable',reason:'parent-unverified',originMs:origin,parentOriginMs:parentOrigin,parentSentAtProcessMs:sent,workerStartedAtProcessMs:started,workerFinishedAtProcessMs:finished,parentReceivedAtProcessMs:received},spans:[],spansTruncated:own(value,'spansTruncated')===true,connectionsTruncated:own(value,'connectionsTruncated')===true,observationFailed:own(value,'observationFailed')===true};
    // Array Proxy의 get('length')도 실행하지 않습니다. descriptor trap 자체는 별도 관측 한계입니다.
    const actualArray=Array.isArray(rawSpans),length=actualArray?own(rawSpans,'length'):undefined;
    if(!actualArray||typeof length!=='number'||!Number.isSafeInteger(length)||length<0)projected.observationFailed=true;
    else{
      if(length>limit)projected.spansTruncated=true;
      for(let i=0;i<Math.min(length,limit);i++){
        const raw=own(rawSpans,String(i)),index=own(raw,'connectionIndex'),role=choice(own(raw,'role'),roles,'unknown'),source=choice(own(raw,'roleEvidence'),evidence,'unavailable'),journal=own(raw,'journalMode');
        const proven=role==='reward'&&(source==='observed-reward-open'||source==='observed-reward-statement')||role==='round'&&source==='observed-round-open'||role==='inbox'&&source==='observed-inbox-statement';
        projected.spans.push({connectionIndex:typeof index==='number'&&Number.isInteger(index)&&index>=1&&index<=limit?index:null,role:proven?role:'unknown',roleEvidence:proven?source:'unavailable',phase:choice(own(raw,'phase'),phases,'unknown'),begin:projectCall(own(raw,'begin')),commit:projectCall(own(raw,'commit')),rollback:projectCall(own(raw,'rollback')),endObservation:choice(own(raw,'endObservation'),ends,'missing'),endAttemptsTruncated:own(raw,'endAttemptsTruncated')===true,connectionAtScopeEnd:choice(own(raw,'connectionAtScopeEnd'),connectionStates,'unknown'),transactionActiveAtScopeEnd:bool(own(raw,'transactionActiveAtScopeEnd')),...(journal===undefined?{}:{journalMode:choice(journal,journalModes,'unavailable')})});
      }
    }
    if(anchor!==undefined){
      let reason:SpanClock['reason']='verified';
      if(projected.observationFailed)reason='invalid';
      else if(currentOrigin===null||received===null)reason='read-failed';
      else if(origin===null||parentOrigin===null||sent===null||started===null||finished===null)reason='missing';
      else if(origin!==parentOrigin||origin!==currentOrigin||finite(own(rawClock,'parentOriginMs'))!==parentOrigin)reason='origin-mismatch';
      else if(finite(own(rawClock,'parentSentAtProcessMs'))!==sent||sent>started||started>finished||finished>received)reason='outside-window';
      else if(projected.spans.some(span=>{
        const calls=[span.begin,span.commit,span.rollback].filter((call):call is SpanCall=>call!==null);
        return calls.some((call,index)=>call.startedAtProcessMs===null||call.finishedAtProcessMs===null||call.startedAtProcessMs<started||call.finishedAtProcessMs>finished||index>0&&call.startedAtProcessMs<calls[index-1].finishedAtProcessMs!);
      }))reason='outside-window';
      projected.clock.reason=reason;projected.clock.status=reason==='verified'?'verified':'unavailable';
    }
    return projected;
  }catch{return {schema:1,clock:{status:'unavailable',reason:'invalid',originMs:null,parentOriginMs:null,parentSentAtProcessMs:null,workerStartedAtProcessMs:null,workerFinishedAtProcessMs:null,parentReceivedAtProcessMs:null},spans:[],spansTruncated:false,connectionsTruncated:false,observationFailed:true};}
}
