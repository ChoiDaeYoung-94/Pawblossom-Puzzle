import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {createCallbackOutcome,createCallbackOutcomeTrace,prepareCallbackWorkerGo,callbackOutcomeEnvelope,receiveCallbackOutcome,callbackOutcomeContext,runObservedCallbackWithSqlite} from './helpers/callbackOutcomeDiagnostics';
import {createTrace,withSqliteDiagnosticsAsync} from './helpers/ledgerDiagnostics';
import type {SpanClockAnchor,TransactionSpans} from './helpers/ledgerTransactionSpans';

const result={kind:'voucher-recorded',newGrant:true};
const enabled=(count=1)=>createCallbackOutcomeTrace(count,{sqliteDiagnostics:true,transactionSpans:true});
function anchor(trace:ReturnType<typeof enabled>,index=0):SpanClockAnchor {
  const go=prepareCallbackWorkerGo(trace,index);if(go==='go')throw new Error('fixture-anchor-missing');return go.spanClockAnchor;
}
function spans(a:SpanClockAnchor):TransactionSpans {
  const start=a.sentAtProcessMs;
  return {schema:1,clock:{status:'verified',reason:'verified',originMs:a.originMs,parentOriginMs:a.originMs,parentSentAtProcessMs:start,workerStartedAtProcessMs:start,workerFinishedAtProcessMs:start,parentReceivedAtProcessMs:null},
    spans:[{connectionIndex:1,role:'reward',roleEvidence:'observed-reward-open',phase:'adapter-call',begin:{startedAtProcessMs:start,finishedAtProcessMs:start,outcome:'returned',transactionActiveAfter:true},commit:{startedAtProcessMs:start,finishedAtProcessMs:start,outcome:'returned',transactionActiveAfter:false},rollback:null,endObservation:'commit-returned',endAttemptsTruncated:false,connectionAtScopeEnd:'closed',transactionActiveAtScopeEnd:null}],spansTruncated:false,connectionsTruncated:false,observationFailed:false};
}
const context=(trace:ReturnType<typeof enabled>)=>JSON.parse(callbackOutcomeContext(trace));
const envelope=(a:SpanClockAnchor,value:unknown=spans(a))=>callbackOutcomeEnvelope(result,createCallbackOutcome(),undefined,{value,anchor:a});
const prototypes=()=>[[DatabaseSync.prototype,'exec'],[DatabaseSync.prototype,'prepare'],[StatementSync.prototype,'run'],[StatementSync.prototype,'get'],[StatementSync.prototype,'all']] as const;
afterEach(()=>vi.restoreAllMocks());

describe('callback 선택 공통 시간축 관측',()=>{
  it('미요청은 기존 go literal·새 필드와 getter 미접근',()=>{
    let reads=0;const trace=createCallbackOutcomeTrace(1,{sqliteDiagnostics:true});
    const payload=callbackOutcomeEnvelope(result,createCallbackOutcome());Object.defineProperty(payload,'transactionSpans',{get(){reads++;throw new Error('synthetic-private');}});
    expect(prepareCallbackWorkerGo(trace,0)).toBe('go');expect(receiveCallbackOutcome(payload,trace,0)).toBe(result);
    Object.defineProperty(trace.workers[0],'transactionSpans',{get(){reads++;throw new Error('synthetic-private');}});
    expect(context(trace).workers[0]).not.toHaveProperty('transactionSpans');expect(reads).toBe(0);
  });
  it('SQLite opt-in 없이 span flag만으로 활성화하지 않음',()=>{
    const trace=createCallbackOutcomeTrace(1,{transactionSpans:true});expect(prepareCallbackWorkerGo(trace,0)).toBe('go');expect(context(trace).workers[0]).not.toHaveProperty('transactionSpans');
  });
  it('worker 투영→부모 수신→formatter까지 실제 anchor·시계 유지',()=>{
    const trace=enabled(),a=anchor(trace);expect(receiveCallbackOutcome(envelope(a),trace,0)).toBe(result);
    const row=context(trace).workers[0];expect(row.transactionSpans.report).toBe('received');expect(row.transactionSpans.diagnostic.clock.status).toBe('verified');
    expect(row.transactionSpans.diagnostic.spans[0]).toMatchObject({connectionIndex:1,phase:'adapter-call',endObservation:'commit-returned'});
  });
  it('같은 connectionIndex도 worker index별로 보존',()=>{
    const trace=enabled(2),a=anchor(trace,0),b=anchor(trace,1);receiveCallbackOutcome(envelope(a),trace,0);receiveCallbackOutcome(envelope(b),trace,1);
    expect(context(trace).workers.map((row:any)=>[row.index,row.transactionSpans.diagnostic.spans[0].connectionIndex,row.transactionSpans.diagnostic.clock.status])).toEqual([[0,1,'verified'],[1,1,'verified']]);
  });
  it('요청했지만 없는 span·getter·불량 schema를 구분하고 getter 실행0',()=>{
    let reads=0;const trace=enabled(3);const a=anchor(trace,0),b=anchor(trace,1),c=anchor(trace,2);
    receiveCallbackOutcome(callbackOutcomeEnvelope(result,createCallbackOutcome()),trace,0);
    const getter=callbackOutcomeEnvelope(result,createCallbackOutcome());Object.defineProperty(getter,'transactionSpans',{get(){reads++;throw new Error('synthetic-private');}});receiveCallbackOutcome(getter,trace,1);
    receiveCallbackOutcome(envelope(c,{schema:0,sql:'synthetic-private'}),trace,2);
    expect(context(trace).workers.map((row:any)=>row.transactionSpans.report)).toEqual(['missing','invalid','invalid']);expect(reads).toBe(0);expect(a.originMs).toBe(b.originMs);expect(callbackOutcomeContext(trace)).not.toContain('synthetic-private');
  });
  it('유효한 빈 관측은 missing과 구분',()=>{
    const trace=enabled(),a=anchor(trace),value=spans(a);value.spans=[];receiveCallbackOutcome(envelope(a,value),trace,0);
    expect(context(trace).workers[0].transactionSpans).toMatchObject({report:'received',diagnostic:{spans:[],clock:{status:'verified'}}});
  });
  it('GO 사본을 바꾸거나 다른 worker anchor를 주장해도 private anchor 불변',()=>{
    const trace=enabled(),a=anchor(trace);a.sentAtProcessMs=(a.sentAtProcessMs??0)+1000;receiveCallbackOutcome(envelope(a),trace,0);
    expect(context(trace).workers[0].transactionSpans.diagnostic.clock).toMatchObject({status:'unavailable',reason:'outside-window'});
  });
  it('최초 anchor 불일치는 formatter·정상 중복 결과로 승격되지 않음',()=>{
    const clock=vi.spyOn(performance,'now').mockReturnValue(10),trace=enabled(),a=anchor(trace),privateAnchor={...a};
    a.sentAtProcessMs=100;clock.mockReturnValue(200);expect(receiveCallbackOutcome(envelope(a),trace,0)).toBe(result);
    expect(trace.workers[0].transactionSpans!.diagnostic!.clock).toMatchObject({status:'unavailable',reason:'outside-window',parentSentAtProcessMs:10});
    expect(context(trace).workers[0].transactionSpans.diagnostic.clock).toMatchObject({status:'unavailable',reason:'outside-window',parentSentAtProcessMs:10});
    receiveCallbackOutcome(envelope(privateAnchor),trace,0);
    expect(context(trace).workers[0].transactionSpans.diagnostic.clock).toMatchObject({status:'unavailable',reason:'outside-window',parentReceivedAtProcessMs:200});
  });
  it('부모가 등록하지 않은 anchor의 verified 표시는 신뢰하지 않음',()=>{
    const trace=enabled(),fake={originMs:performance.timeOrigin,sentAtProcessMs:performance.now()};receiveCallbackOutcome(envelope(fake),trace,0);
    expect(context(trace).workers[0].transactionSpans.diagnostic.clock.status).toBe('unavailable');
  });
  it('수신 뒤에 만들어진 종료시각은 formatter 시점에도 유효해지지 않음',()=>{
    const trace=enabled(),a=anchor(trace),value=spans(a);
    const payload:any={kind:'synthetic-callback-outcome',result,transactionSpans:value};
    Object.defineProperty(payload,'diagnostic',{get(){const end=performance.now()+2;while(performance.now()<end){}value.clock.workerFinishedAtProcessMs=performance.now();return createCallbackOutcome();}});
    receiveCallbackOutcome(payload,trace,0);const first=context(trace).workers[0].transactionSpans.diagnostic.clock;
    expect(first).toMatchObject({status:'unavailable',reason:'outside-window'});
    expect(context(trace).workers[0].transactionSpans.diagnostic.clock.parentReceivedAtProcessMs).toBe(first.parentReceivedAtProcessMs);
  });
  it('중복 GO·결과가 최초 private anchor/수신시각을 교체하지 않음',()=>{
    const trace=enabled(),a=anchor(trace);receiveCallbackOutcome(envelope(a),trace,0);const first=context(trace).workers[0].transactionSpans.diagnostic.clock;
    expect(prepareCallbackWorkerGo(trace,0)).toBe('go');const late=spans(a);late.clock.workerFinishedAtProcessMs=(first.parentReceivedAtProcessMs??0)+10000;receiveCallbackOutcome(envelope(a,late),trace,0);
    const next=context(trace);expect(next.observationFailed).toBe(true);expect(next.workers[0].transactionSpans.diagnostic.clock.parentReceivedAtProcessMs).toBe(first.parentReceivedAtProcessMs);expect(next.workers[0].transactionSpans.diagnostic.clock.status).toBe('unavailable');
  });
  it('잘림·수집 실패 표시와 SQL/path/key/stack 비노출 유지',()=>{
    const trace=enabled(),a=anchor(trace),value:any=spans(a);value.spansTruncated=true;value.connectionsTruncated=true;value.spans[0].endAttemptsTruncated=true;
    Object.assign(value,{sql:'synthetic-private-sql',path:'synthetic-private-path',key:'synthetic-private-key',stack:'synthetic-private-stack'});value.spans[0].sql='synthetic-private-span';
    receiveCallbackOutcome(envelope(a,value),trace,0);expect(context(trace).workers[0].transactionSpans.diagnostic).toMatchObject({spansTruncated:true,connectionsTruncated:true,spans:[{endAttemptsTruncated:true}]});expect(callbackOutcomeContext(trace)).not.toContain('synthetic-private');
    const failed=callbackOutcomeEnvelope(result,createCallbackOutcome(),undefined,{value:spans(a),anchor:a,observationFailed:true});receiveCallbackOutcome(failed,trace,0);expect(context(trace).workers[0].transactionSpans).toMatchObject({report:'invalid',diagnostic:{observationFailed:true,clock:{status:'unavailable'}}});
  });
  it('실제 async callback·close1회·hook복원 뒤 native span을 전달',async()=>{
    const before=prototypes().map(([p,k])=>Object.getOwnPropertyDescriptor(p,k)),parent=enabled(),a=anchor(parent),trace=createCallbackOutcome();let db:DatabaseSync|undefined;const close=vi.fn(()=>db!.close());
    const wrapped=await runObservedCallbackWithSqlite(()=>{db=new DatabaseSync(':memory:');db.exec('BEGIN IMMEDIATE');db.exec('COMMIT');return {processCallback:async()=>{await Promise.resolve();db!.exec('BEGIN IMMEDIATE');db!.exec('COMMIT');return result;},close};},'synthetic-private-query',trace,{transactionSpans:true,spanClockAnchor:a});
    expect(close).toHaveBeenCalledTimes(1);expect(db!.isOpen).toBe(false);expect(receiveCallbackOutcome(wrapped,parent,0)).toBe(result);
    const row=context(parent).workers[0];expect(row.sqlite.diagnostic.sqliteHook.restoration).toBe('restored');expect(row.transactionSpans).toMatchObject({report:'received',diagnostic:{clock:{status:'verified'},observationFailed:false}});
    expect(row.transactionSpans.diagnostic.spans.some((s:any)=>s.phase==='adapter-call'&&s.commit?.outcome==='returned'&&s.connectionAtScopeEnd==='closed')).toBe(true);
    expect(prototypes().map(([p,k])=>Object.getOwnPropertyDescriptor(p,k))).toEqual(before);expect(callbackOutcomeContext(parent)).not.toContain('synthetic-private');
  });
  it('Async 옵션은 scheduler를 열지 않고 원예외·늦은wrapper 비수집 유지',async()=>{
    const trace=createTrace('reward-worker'),a={originMs:performance.timeOrigin,sentAtProcessMs:performance.now()},error=new Error('synthetic-private-error');trace.phase='adapter-call';let schedulerReads=0;let retired:Function|undefined;const db=new DatabaseSync(':memory:');
    try{await expect(withSqliteDiagnosticsAsync(trace,async()=>{retired=DatabaseSync.prototype.exec;db.exec('BEGIN IMMEDIATE');await Promise.resolve();db.exec('ROLLBACK');throw error;},{transactionSpans:true,spanClockAnchor:a,get schedulerProbe(){schedulerReads++;throw error;}} as any)).rejects.toBe(error);
      const count=trace.transactionSpans!.spans.length;Reflect.apply(retired!,db,['BEGIN IMMEDIATE']);db.exec('ROLLBACK');expect(trace.transactionSpans!.spans.length).toBe(count);expect(schedulerReads).toBe(0);expect(trace.sqliteHook.restoration).toBe('restored');
    }finally{db.close();}
  });
});
