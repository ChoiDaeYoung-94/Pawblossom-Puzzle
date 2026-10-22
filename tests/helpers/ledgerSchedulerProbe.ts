// 검사 전용 opt-in입니다. 누적값·파일 경로·OS thread 식별자는 DTO에 넣지 않습니다.
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';

const cpuStatuses=['ok','unsupported','missing','read-failed','invalid'] as const;
const schedStatuses=['ok','unsupported','missing','read-failed','invalid','all-zero','nonmonotonic'] as const;
const windowStatuses=['ok','unsupported','read-failed','invalid'] as const;
export interface SchedulerSummary {mode:'linux-thread-v1';platform:'linux'|'unsupported';schedSysctl:'0'|'1'|'unavailable';}
export interface Scheduling {
  cpuStatus:typeof cpuStatuses[number];schedStatus:typeof schedStatuses[number];windowStatus:typeof windowStatuses[number];
  envelopeMs:number|null;outsideMs:number|null;cpuUserMs:number|null;cpuSystemMs:number|null;schedRuntimeMs:number|null;runqueueMs:number|null;timeslices:number|null;
}
export interface SchedulerProvider {platform:string;readSched:()=>unknown;readSysctl:()=>unknown;threadCpu?:(()=>unknown);clock:()=>number;}
type SchedSample={status:typeof schedStatuses[number];value?:readonly bigint[]};
type CpuSample={status:typeof cpuStatuses[number];user?:number;system?:number};
interface ProbeSample {outerStart:number|null;sched:SchedSample;cpu:CpuSample;}
export interface SchedulerProbe {
  readonly active:boolean;readonly summary:SchedulerSummary;
  before():unknown;
  after(sample:unknown,inner:{startedAtProcessMs:number|null;finishedAtProcessMs:number|null}):Scheduling;
}
const own=(value:unknown,key:string):unknown=>{try{if(value===null||(typeof value!=='object'&&typeof value!=='function'))return;const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value' in descriptor?descriptor.value:undefined;}catch{return;}};
const nonnegative=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER?value:null;
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const status=<T extends string>(value:unknown,values:readonly T[],fallback:T):T=>typeof value==='string'&&values.includes(value as T)?value as T:fallback;
export function unavailableScheduling(reason:'unsupported'|'read-failed'='read-failed'):Scheduling {
  return {cpuStatus:reason,schedStatus:reason,windowStatus:reason,envelopeMs:null,outsideMs:null,cpuUserMs:null,cpuSystemMs:null,schedRuntimeMs:null,runqueueMs:null,timeslices:null};
}
function readFailure(error:unknown):'missing'|'read-failed' {return own(error,'code')==='ENOENT'?'missing':'read-failed';}
function schedSample(read:()=>unknown):SchedSample {
  try{
    const raw=read();if(raw===undefined||raw===null)return {status:'missing'};
    // proc_pid_schedstat의 정확한 세 필드. 무제한 BigInt 파싱도 피합니다.
    if(typeof raw!=='string'||raw.length>64)return {status:'invalid'};
    const match=/^([0-9]{1,20}) ([0-9]{1,20}) ([0-9]{1,20})\n?$/.exec(raw);if(!match||match[0]!==raw)return {status:'invalid'};
    const value=match.slice(1).map(text=>BigInt(text));if(value.some(n=>n>0xffffffffffffffffn))return {status:'invalid'};
    return value.every(n=>n===0n)?{status:'all-zero'}:{status:'ok',value};
  }catch(error){return {status:readFailure(error)};}
}
function cpuSample(read:SchedulerProvider['threadCpu']):CpuSample {
  if(typeof read!=='function')return {status:'unsupported'};
  try{const value=read();if(value===undefined||value===null)return {status:'missing'};const user=own(value,'user'),system=own(value,'system');return integer(user)&&integer(system)?{status:'ok',user,system}:{status:'invalid'};}
  catch(error){return {status:readFailure(error)};}
}
function clock(read:()=>number):number|null {try{return nonnegative(read());}catch{return null;}}
const nsDelta=(delta:bigint):number|null=>delta>=0n&&delta<=BigInt(Number.MAX_SAFE_INTEGER)?Number(delta)/1_000_000:null;
function defaultProvider():SchedulerProvider {
  return {platform:process.platform,readSched:()=>readFileSync('/proc/thread-self/schedstat','utf8'),readSysctl:()=>readFileSync('/proc/sys/kernel/sched_schedstats','utf8'),
    threadCpu:typeof process.threadCpuUsage==='function'?()=>process.threadCpuUsage():undefined,clock:()=>performance.now()};
}
export function createSchedulerProbe(provider:SchedulerProvider=defaultProvider()):SchedulerProbe {
  const active=provider.platform==='linux';let schedSysctl:SchedulerSummary['schedSysctl']='unavailable';
  if(active)try{const value=provider.readSysctl();if(value==='0'||value==='0\n')schedSysctl='0';else if(value==='1'||value==='1\n')schedSysctl='1';}catch{}
  const summary:SchedulerSummary={mode:'linux-thread-v1',platform:active?'linux':'unsupported',schedSysctl};
  return {active,summary,
    before(){if(!active)return undefined;const outerStart=clock(provider.clock),sched=schedSample(provider.readSched),cpu=cpuSample(provider.threadCpu);return {outerStart,sched,cpu} satisfies ProbeSample;},
    after(value,inner){
      if(!active)return unavailableScheduling('unsupported');
      const sample=value as ProbeSample,cpu=cpuSample(provider.threadCpu),sched=schedSample(provider.readSched),outerEnd=clock(provider.clock);
      const result=unavailableScheduling();
      const start=nonnegative(sample?.outerStart),begin=nonnegative(inner.startedAtProcessMs),end=nonnegative(inner.finishedAtProcessMs);
      if(start===null||outerEnd===null||begin===null||end===null||start>begin||begin>end||end>outerEnd){result.windowStatus='invalid';result.cpuStatus='invalid';result.schedStatus='invalid';return result;}
      result.windowStatus='ok';result.envelopeMs=outerEnd-start;result.outsideMs=result.envelopeMs-(end-begin);
      if(nonnegative(result.envelopeMs)===null||nonnegative(result.outsideMs)===null){result.windowStatus='invalid';result.cpuStatus='invalid';result.schedStatus='invalid';result.envelopeMs=null;result.outsideMs=null;return result;}
      const firstCpu=sample.cpu,firstSched=sample.sched;
      result.cpuStatus=firstCpu.status!=='ok'?firstCpu.status:cpu.status;
      if(result.cpuStatus==='ok'){
        const user=cpu.user!-firstCpu.user!,system=cpu.system!-firstCpu.system!;
        if(!integer(user)||!integer(system)||!integer(user+system)||(user+system)/1000>result.envelopeMs)result.cpuStatus='invalid';
        else {result.cpuUserMs=user/1000;result.cpuSystemMs=system/1000;}
      }
      result.schedStatus=firstSched.status!=='ok'?firstSched.status:sched.status;
      if(result.schedStatus==='ok'){
        const deltas=sched.value!.map((n,i)=>n-firstSched.value![i]);
        if(deltas.some(n=>n<0n))result.schedStatus='nonmonotonic';
        else {
          const runtime=nsDelta(deltas[0]),runqueue=nsDelta(deltas[1]),timeslices=deltas[2]<=BigInt(Number.MAX_SAFE_INTEGER)?Number(deltas[2]):null;
          // runtime의 갱신은 늦을 수 있습니다. runtime<=E나 thread CPU와의 동일성을 요구하지 않습니다.
          if(runtime===null||runqueue===null||timeslices===null||runqueue>result.envelopeMs)result.schedStatus='invalid';
          else {result.schedRuntimeMs=runtime;result.runqueueMs=runqueue;result.timeslices=timeslices;}
        }
      }
      return result;
    }};
}
export function projectSchedulerSummary(value:unknown):SchedulerSummary|undefined {
  if(value===undefined)return;
  return {mode:'linux-thread-v1',platform:own(value,'mode')==='linux-thread-v1'&&own(value,'platform')==='linux'?'linux':'unsupported',schedSysctl:status(own(value,'schedSysctl'),['0','1','unavailable'],'unavailable')};
}
export function projectScheduling(value:unknown,inner?:{startedAtProcessMs:number|null;finishedAtProcessMs:number|null}):Scheduling|undefined {
  if(value===undefined)return;
  let cpuStatus=status(own(value,'cpuStatus'),cpuStatuses,'invalid'),schedStatus=status(own(value,'schedStatus'),schedStatuses,'invalid');
  let windowStatus=status(own(value,'windowStatus'),windowStatuses,'invalid');
  let envelopeMs=nonnegative(own(value,'envelopeMs')),outsideMs=nonnegative(own(value,'outsideMs'));
  if(inner&&windowStatus==='ok'){
    const start=nonnegative(inner.startedAtProcessMs),end=nonnegative(inner.finishedAtProcessMs);
    if(start===null||end===null||end<start||envelopeMs===null||envelopeMs<end-start||outsideMs!==envelopeMs-(end-start))windowStatus='invalid';
  }
  if(windowStatus!=='ok'||envelopeMs===null||outsideMs===null||outsideMs>envelopeMs){if(windowStatus==='ok')windowStatus='invalid';envelopeMs=null;outsideMs=null;}
  let cpuUserMs=cpuStatus==='ok'?nonnegative(own(value,'cpuUserMs')):null,cpuSystemMs=cpuStatus==='ok'?nonnegative(own(value,'cpuSystemMs')):null;
  let schedRuntimeMs=schedStatus==='ok'?nonnegative(own(value,'schedRuntimeMs')):null,runqueueMs=schedStatus==='ok'?nonnegative(own(value,'runqueueMs')):null;
  const slices=own(value,'timeslices');let timeslices=schedStatus==='ok'&&integer(slices)?slices:null;
  if(cpuStatus==='ok'&&(windowStatus!=='ok'||cpuUserMs===null||cpuSystemMs===null||cpuUserMs+cpuSystemMs>envelopeMs!)){cpuStatus='invalid';cpuUserMs=null;cpuSystemMs=null;}
  if(schedStatus==='ok'&&(windowStatus!=='ok'||schedRuntimeMs===null||runqueueMs===null||timeslices===null||runqueueMs>envelopeMs!)){schedStatus='invalid';schedRuntimeMs=null;runqueueMs=null;timeslices=null;}
  return {cpuStatus,schedStatus,windowStatus,envelopeMs,outsideMs,cpuUserMs,cpuSystemMs,schedRuntimeMs,runqueueMs,timeslices};
}
/** 확장 필드는 own data property만 읽어 getter/proxy 오류를 진단 문자열로 복사하지 않습니다. */
export const schedulerField=own;
