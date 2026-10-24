// 검사 전용 선택 관측입니다. 원문 SQL·경로·native receiver는 DTO에 넣지 않습니다.
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';

// 모듈 적재 때 원본 함수/공식 prototype accessor만 보존합니다. DB를 만들거나 SQL을 실행하지 않습니다.
const nativeExec=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')?.value;
const nativePrototypeAccessors={
  isOpen:Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'isOpen')?.get,
  isTransaction:Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'isTransaction')?.get
};
const limit=8;
const roles=['reward','round','unknown'] as const;
const evidence=['observed-reward-open','observed-round-open','unavailable'] as const;
const phases=['reward-open','redeem','round-open','apply','unknown'] as const;
const outcomes=['unknown','returned','threw'] as const;
const ends=['missing','begin-threw','commit-returned','rollback-returned','end-threw','orphan','repeated-end','superseded'] as const;
const connectionStates=['open','closed','unknown'] as const;
const clockReasons=['parent-unverified','missing','read-failed','invalid','origin-mismatch','outside-window','verified'] as const;
type Site='begin'|'commit'|'rollback';
type Outcome=typeof outcomes[number];
export interface SpanCall {startedAtProcessMs:number|null;finishedAtProcessMs:number|null;outcome:Outcome;transactionActiveAfter:boolean|null;}
export interface TransactionSpan {
  connectionIndex:number|null;role:typeof roles[number];roleEvidence:typeof evidence[number];phase:typeof phases[number];
  begin:SpanCall|null;commit:SpanCall|null;rollback:SpanCall|null;
  endObservation:typeof ends[number];endAttemptsTruncated:boolean;
  connectionAtScopeEnd:typeof connectionStates[number];transactionActiveAtScopeEnd:boolean|null;
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
function choice<T extends string>(value:unknown,values:readonly T[],fallback:T):T {return typeof value==='string'&&values.includes(value as T)?value as T:fallback;}
function readClock(read:()=>unknown):number|null {try{return finite(read());}catch{return null;}}
export function createSpanClockAnchor(clock:SpanClockProvider=defaultClock):SpanClockAnchor {
  return {originMs:readClock(()=>clock.origin()),sentAtProcessMs:readClock(()=>clock.now())};
}
type NativeAccessors=Partial<Record<'isOpen'|'isTransaction',()=>unknown>>;
function siteOf(sql:unknown):Site|null {return sql==='BEGIN IMMEDIATE'?'begin':sql==='COMMIT'?'commit':sql==='ROLLBACK'?'rollback':null;}
interface Connection {index:number;receiver:WeakRef<object>;role:TransactionSpan['role'];roleEvidence:TransactionSpan['roleEvidence'];active?:TransactionSpan;}
export interface SpanToken {span:TransactionSpan;call:SpanCall|null;site:Site;connection?:Connection;receiver:object|null;}
export interface SpanRecorder {report:TransactionSpans;before(sql:unknown,receiver:unknown,phase:unknown):SpanToken|null;after(token:SpanToken|null,outcome:'returned'|'threw',executed?:unknown):void;finish():void;}

/** BEGIN/끝 호출을 한 행에 보존합니다. 관측 오류는 원래 SQLite 동작을 바꾸지 않습니다. */
export function createSpanRecorder(anchor?:unknown,clock:SpanClockProvider=defaultClock):SpanRecorder {
  const report:TransactionSpans={schema:1,clock:{status:'unavailable',reason:'parent-unverified',originMs:readClock(()=>clock.origin()),parentOriginMs:finite(own(anchor,'originMs')),parentSentAtProcessMs:finite(own(anchor,'sentAtProcessMs')),workerStartedAtProcessMs:readClock(()=>clock.now()),workerFinishedAtProcessMs:null,parentReceivedAtProcessMs:null},spans:[],spansTruncated:false,connectionsTruncated:false,observationFailed:false};
  const known=new WeakMap<object,Connection>(),connections:Connection[]=[];
  const verified=new WeakMap<object,NativeAccessors>();
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
          const role=phase==='reward-open'?'reward':phase==='round-open'?'round':'unknown';
          connection={index:connections.length+1,receiver:new WeakRef(object),role,roleEvidence:role==='reward'?'observed-reward-open':role==='round'?'observed-round-open':'unavailable'};
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
    after(token,outcome,executed){
      if(!token)return;
      try{
        const {span,call,connection,site,receiver}=token;
        if(receiver&&outcome==='returned')verifyReceiver(receiver,executed);
        if(call){
          call.outcome=outcome;const end=now(),start=call.startedAtProcessMs;
          call.finishedAtProcessMs=start!==null&&end!==null&&end>=start?end:null;if(call.finishedAtProcessMs===null)fail();
          call.transactionActiveAfter=receiver?nativeState(receiver,'isTransaction'):null;
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
  return {startedAtProcessMs:start,finishedAtProcessMs:start!==null&&end!==null&&end>=start?end:null,outcome:choice(own(value,'outcome'),outcomes,'unknown'),transactionActiveAfter:bool(own(value,'transactionActiveAfter'))};
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
        const raw=own(rawSpans,String(i)),index=own(raw,'connectionIndex'),role=choice(own(raw,'role'),roles,'unknown'),source=choice(own(raw,'roleEvidence'),evidence,'unavailable');
        const proven=role==='reward'&&source==='observed-reward-open'||role==='round'&&source==='observed-round-open';
        projected.spans.push({connectionIndex:typeof index==='number'&&Number.isInteger(index)&&index>=1&&index<=limit?index:null,role:proven?role:'unknown',roleEvidence:proven?source:'unavailable',phase:choice(own(raw,'phase'),phases,'unknown'),begin:projectCall(own(raw,'begin')),commit:projectCall(own(raw,'commit')),rollback:projectCall(own(raw,'rollback')),endObservation:choice(own(raw,'endObservation'),ends,'missing'),endAttemptsTruncated:own(raw,'endAttemptsTruncated')===true,connectionAtScopeEnd:choice(own(raw,'connectionAtScopeEnd'),connectionStates,'unknown'),transactionActiveAtScopeEnd:bool(own(raw,'transactionActiveAtScopeEnd'))});
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
