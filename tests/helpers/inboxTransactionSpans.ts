// inbox 시험 worker 전용입니다. 원 결과 참조와 기존 ready/go/result 횟수를 유지합니다.
import type {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {createSpanClockAnchor,projectTransactionSpans,type SpanClockAnchor,type SpanClockProvider,type TransactionSpans} from './ledgerTransactionSpans.ts';

type Report='missing'|'received'|'invalid';
export interface InboxSpanTrace {workers:{index:number;report:Report;diagnostic:TransactionSpans|null}[];truncated:boolean;observationFailed:boolean;}
interface State {anchor?:SpanClockAnchor;received?:SpanClockAnchor;observed:boolean;clockFailure?:TransactionSpans['clock']['reason'];}
const expected=new WeakMap<InboxSpanTrace,{states:Map<number,State>;clock:SpanClockProvider;count:number}>(),failed=new WeakSet<object>();
const realClock:SpanClockProvider={origin:()=>performance.timeOrigin,now:()=>performance.now()};
const own=(value:unknown,key:string):PropertyDescriptor|undefined=>value!==null&&(typeof value==='object'||typeof value==='function')?Object.getOwnPropertyDescriptor(value,key):undefined;
const data=(value:unknown,key:string):unknown=>{const d=own(value,key);return d&&'value'in d?d.value:undefined;};
const fail=(trace:InboxSpanTrace)=>{failed.add(trace);try{trace.observationFailed=true;}catch{}};
export function createInboxSpanTrace(count:number,enabled=false,clock:SpanClockProvider=realClock):InboxSpanTrace {
  enabled=enabled===true;
  const valid=Number.isSafeInteger(count)&&count>=0,bounded=valid?Math.min(count,8):0;
  const trace:InboxSpanTrace={workers:enabled?Array.from({length:bounded},(_,index)=>({index,report:'missing',diagnostic:null})):[],truncated:enabled&&(!valid||count>8),observationFailed:enabled&&!valid};
  if(enabled)expected.set(trace,{states:new Map(),clock,count:bounded});return trace;
}
export function prepareInboxSpanGo(trace:InboxSpanTrace,index:number):'go'|{kind:'go';spanClockAnchor:SpanClockAnchor}{
  const context=expected.get(trace);if(!context)return 'go';
  try{
    if(!Number.isInteger(index)||index<0||index>=context.count||context.states.has(index)){fail(trace);return 'go';}
    const anchor=createSpanClockAnchor(context.clock);context.states.set(index,{anchor:{...anchor},observed:false});
    return {kind:'go',spanClockAnchor:{...anchor}};
  }catch{fail(trace);return 'go';}
}
function fixedClock(state:State):SpanClockProvider{return {origin:()=>state.received?.originMs,now:()=>state.received?.sentAtProcessMs};}
function observation(value:unknown,state:State):{report:Report;diagnostic:TransactionSpans|null}{
  if(value===undefined)return {report:'missing',diagnostic:null};
  if(data(value,'schema')!==1||!Array.isArray(data(value,'spans'))||data(value,'clock')===null||typeof data(value,'clock')!=='object'
    ||!['spansTruncated','connectionsTruncated','observationFailed'].every(key=>typeof data(value,key)==='boolean'))return {report:'invalid',diagnostic:null};
  const projected=projectTransactionSpans(value,state.anchor,fixedClock(state));return projected?{report:'received',diagnostic:projected}:{report:'invalid',diagnostic:null};
}
export function inboxSpanEnvelope(result:unknown,spans:unknown,anchor:unknown){
  return {kind:'synthetic-inbox-spans',result,transactionSpans:projectTransactionSpans(spans,anchor)};
}
/** worker payload의 anchor/검증 주장은 private GO와 최초 실제 수신 시계를 대체하지 못합니다. */
export function receiveInboxSpanResult(value:unknown,trace:InboxSpanTrace,index:number):unknown {
  const context=expected.get(trace);if(!context)return value;
  let result=value,first=false;
  try{
    if(!Number.isInteger(index)||index<0||index>=context.count){fail(trace);try{trace.truncated=true;}catch{}return value;}
    let state=context.states.get(index);
    if(!state){state={observed:false};context.states.set(index,state);}
    if(state.observed){const repeated=data(value,'kind')==='synthetic-inbox-spans'?own(value,'result'):undefined;return repeated&&'value'in repeated?repeated.value:value;}
    state.received=createSpanClockAnchor(context.clock);state.observed=true;first=true;
    const marker=own(value,'kind');let report:Report='missing',diagnostic:TransactionSpans|null=null;
    if(marker&&!('value'in marker)){report='invalid';}
    else if(marker&&'value'in marker&&marker.value==='synthetic-inbox-spans'){
      const raw=own(value,'result');
      if(raw&&'value'in raw){
        result=raw.value;const spans=own(value,'transactionSpans');
        if(!spans)report='missing';else if(!('value'in spans))report='invalid';else({report,diagnostic}=observation(spans.value,state));
      }else report='invalid';
    }
    // 투영은 parent anchor를 덮어쓴 DTO를 만들므로, 최초 부모 거절은 private 상태에 고정합니다.
    if(diagnostic?.clock.status==='unavailable')state.clockFailure=diagnostic.clock.reason;
    trace.workers[index]={index,report,diagnostic};
  }catch{fail(trace);if(first)try{trace.workers[index]={index,report:'invalid',diagnostic:null};}catch{}}
  return result;
}
export function inboxSpanContext(trace:InboxSpanTrace):{workers:InboxSpanTrace['workers'];truncated:boolean;observationFailed:boolean}|undefined {
  const context=expected.get(trace);if(!context)return;
  try{
    const workers=data(trace,'workers'),length=data(workers,'length');
    if(!Array.isArray(workers)||typeof length!=='number'||!Number.isSafeInteger(length)||length<0)throw new Error('invalid-worker-rows');
    const rows=Array.from({length:Math.min(length,8)},(_,index)=>{
      const row=data(workers,String(index)),state=context.states.get(index)??{observed:false};
      const report=data(row,'report'),diagnostic=data(row,'diagnostic');
      if(report==='received'){
        const projected=observation(diagnostic,state);
        if(state.clockFailure&&projected.diagnostic){projected.diagnostic.clock.status='unavailable';projected.diagnostic.clock.reason=state.clockFailure;}
        return {index,...projected};
      }
      return {index,report:report==='missing'?'missing' as const:'invalid' as const,diagnostic:null};
    });
    return {workers:rows,truncated:data(trace,'truncated')===true||length>8,observationFailed:data(trace,'observationFailed')!==false||failed.has(trace)};
  }catch{return {workers:[],truncated:false,observationFailed:true};}
}
/** 기존 Worker의 네 메서드만 전달합니다. 기본 off에서는 같은 Worker 참조를 반환합니다. */
export function wrapInboxSpanWorker(worker:Pick<Worker,'on'|'once'|'postMessage'|'terminate'>,trace:InboxSpanTrace,index:number):Pick<Worker,'on'|'once'|'postMessage'|'terminate'> {
  if(!expected.has(trace))return worker;
  return {
    on:((event:string,listener:(...args:any[])=>void)=>worker.on(event as any,event==='message'?(value:unknown)=>listener(value==='ready'?value:receiveInboxSpanResult(value,trace,index)):listener)) as Worker['on'],
    once:worker.once.bind(worker),postMessage:((value:unknown,transfer:Parameters<Worker['postMessage']>[1])=>worker.postMessage(value==='go'?prepareInboxSpanGo(trace,index):value,transfer)) as Worker['postMessage'],terminate:worker.terminate.bind(worker)
  };
}
