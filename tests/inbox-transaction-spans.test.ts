import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import type {Worker} from 'node:worker_threads';
import {createInboxSpanTrace,prepareInboxSpanGo,receiveInboxSpanResult,inboxSpanEnvelope,inboxSpanContext,wrapInboxSpanWorker} from './helpers/inboxTransactionSpans';
import {createSpanRecorder,type SpanClockAnchor,type TransactionSpans} from './helpers/ledgerTransactionSpans';
import {createCallbackConnectionProbe} from './helpers/callbackConnectionState';

const original={kind:'completed',diagnostic:{close:{outcome:'returned'}}};
function setup(count=1){let tick=10;const clock={origin:()=>1234,now:()=>tick};return {trace:createInboxSpanTrace(count,true,clock),clock,set:(n:number)=>{tick=n;}};}
function go(trace:ReturnType<typeof createInboxSpanTrace>,index=0){const value=prepareInboxSpanGo(trace,index);if(value==='go')throw new Error('missing-test-anchor');return value.spanClockAnchor;}
function report(a:SpanClockAnchor):TransactionSpans {
  const start=a.sentAtProcessMs!+1,end=start+1;
  return {schema:1,clock:{status:'verified',reason:'verified',originMs:a.originMs,parentOriginMs:a.originMs,parentSentAtProcessMs:a.sentAtProcessMs,workerStartedAtProcessMs:start,workerFinishedAtProcessMs:end,parentReceivedAtProcessMs:null},
    spans:[{connectionIndex:1,role:'inbox',roleEvidence:'observed-inbox-statement',phase:'inbox-process',begin:{startedAtProcessMs:start,finishedAtProcessMs:start,outcome:'returned',transactionActiveAfter:true},commit:{startedAtProcessMs:end,finishedAtProcessMs:end,outcome:'returned',transactionActiveAfter:false},rollback:null,endObservation:'commit-returned',endAttemptsTruncated:false,connectionAtScopeEnd:'closed',transactionActiveAtScopeEnd:null}],spansTruncated:false,connectionsTruncated:false,observationFailed:false};
}
function envelope(a:SpanClockAnchor,raw:unknown=report(a)){return {kind:'synthetic-inbox-spans',result:original,transactionSpans:raw};}
const dbs:DatabaseSync[]=[],folders:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const db of dbs.splice(0))if(db.isOpen)db.close();for(const folder of folders.splice(0)){expect(dirname(resolve(folder))).toBe(resolve(tmpdir()));expect(resolve(folder).startsWith(join(resolve(tmpdir()),'pawblossom-inbox-span-'))).toBe(true);rmSync(folder,{recursive:true,force:true});}});

describe('inbox worker 선택 공통 시간축',()=>{
  it('기본 off는 같은 worker/result/go와 getter 미접근',()=>{
    let reads=0;const trace=createInboxSpanTrace(1),value={kind:'completed'};
    Object.defineProperty(value,'transactionSpans',{get(){reads++;throw Error('synthetic-private');}});
    const worker={} as Worker;expect(wrapInboxSpanWorker(worker,trace,0)).toBe(worker);expect(prepareInboxSpanGo(trace,0)).toBe('go');
    expect(receiveInboxSpanResult(value,trace,0)).toBe(value);expect(inboxSpanContext(trace)).toBeUndefined();expect(reads).toBe(0);
  });
  it('worker 투영/부모 최초수신/formatter의 고정 시간과 원결과 참조',()=>{
    const s=setup(),a=go(s.trace);s.set(13);expect(receiveInboxSpanResult(inboxSpanEnvelope(original,report(a),a),s.trace,0)).toBe(original);
    s.set(999);const row=inboxSpanContext(s.trace)!.workers[0];expect(row.report).toBe('received');expect(row.diagnostic!.clock).toMatchObject({status:'verified',parentReceivedAtProcessMs:13});
    expect(row.diagnostic!.spans[0]).toMatchObject({role:'inbox',phase:'inbox-process',connectionIndex:1});
  });
  it('worker별 같은 connectionIndex는 합치지 않음',()=>{
    const s=setup(2),a=go(s.trace,0),b=go(s.trace,1);s.set(14);
    receiveInboxSpanResult(envelope(a),s.trace,0);receiveInboxSpanResult(envelope(b),s.trace,1);
    expect(inboxSpanContext(s.trace)!.workers.map(row=>[row.index,row.diagnostic!.spans[0].connectionIndex])).toEqual([[0,1],[1,1]]);
  });
  it('GO 사본/worker 주장으로 private anchor를 교체하지 않음',()=>{
    const s=setup(),a=go(s.trace);a.sentAtProcessMs=100;s.set(200);receiveInboxSpanResult(envelope(a),s.trace,0);
    expect(inboxSpanContext(s.trace)!.workers[0].diagnostic!.clock).toMatchObject({status:'unavailable',reason:'outside-window',parentSentAtProcessMs:10});
    const first=inboxSpanContext(s.trace);receiveInboxSpanResult(envelope({originMs:1234,sentAtProcessMs:10}),s.trace,0);
    expect(inboxSpanContext(s.trace)).toEqual(first);
  });
  it('중복 GO가 private anchor를 다시 만들지 않음',()=>{
    const s=setup(),a=go(s.trace);s.set(50);expect(prepareInboxSpanGo(s.trace,0)).toBe('go');s.set(60);receiveInboxSpanResult(envelope(a),s.trace,0);
    expect(inboxSpanContext(s.trace)).toMatchObject({observationFailed:true,workers:[{diagnostic:{clock:{parentSentAtProcessMs:10}}}]});
  });
  it('GO 없는 검증 주장은 parent-unverified',()=>{
    const s=setup(),fake={originMs:1234,sentAtProcessMs:10};s.set(20);receiveInboxSpanResult(envelope(fake),s.trace,0);
    expect(inboxSpanContext(s.trace)!.workers[0].diagnostic!.clock.status).toBe('unavailable');
  });
  it('최초 결과 뒤 중복은 보고/시계를 덮지 않음',()=>{
    const s=setup(),a=go(s.trace);s.set(13);receiveInboxSpanResult(envelope(a),s.trace,0);const before=inboxSpanContext(s.trace);
    s.set(900);expect(receiveInboxSpanResult(envelope(a,{schema:0}),s.trace,0)).toBe(original);expect(inboxSpanContext(s.trace)).toEqual(before);
  });
  it('미래 종료시각은 formatter 호출을 늦춰도 승격되지 않음',()=>{
    const s=setup(),a=go(s.trace),raw=report(a);raw.clock.workerFinishedAtProcessMs=50;raw.spans[0].commit!.startedAtProcessMs=50;raw.spans[0].commit!.finishedAtProcessMs=50;
    s.set(20);receiveInboxSpanResult(envelope(a,raw),s.trace,0);s.set(1000);
    expect(inboxSpanContext(s.trace)!.workers[0].diagnostic!.clock).toMatchObject({status:'unavailable',reason:'outside-window',parentReceivedAtProcessMs:20});
  });
  it('missing/accessor/schema 오류와 유효한 빈 관측 구분',()=>{
    const s=setup(4),anchors=Array.from({length:4},(_,i)=>go(s.trace,i));s.set(20);let reads=0;
    const getter={kind:'synthetic-inbox-spans',result:original};Object.defineProperty(getter,'transactionSpans',{get(){reads++;throw Error('synthetic-private');}});
    const missing={kind:'synthetic-inbox-spans',result:original};receiveInboxSpanResult(missing,s.trace,0);receiveInboxSpanResult(getter,s.trace,1);receiveInboxSpanResult(envelope(anchors[2],{schema:0}),s.trace,2);
    const empty=report(anchors[3]);empty.spans=[];receiveInboxSpanResult(envelope(anchors[3],empty),s.trace,3);
    expect(inboxSpanContext(s.trace)!.workers.map(row=>row.report)).toEqual(['missing','invalid','invalid','received']);expect(inboxSpanContext(s.trace)!.workers[3].diagnostic!.spans).toEqual([]);expect(reads).toBe(0);
  });
  it('descriptor 실패를 누락으로 숨기지 않고 결과 참조 유지',()=>{
    const s=setup();go(s.trace);s.set(20);const bad=new Proxy({},{getOwnPropertyDescriptor(){throw Error('synthetic-private');}});
    expect(receiveInboxSpanResult(bad,s.trace,0)).toBe(bad);expect(inboxSpanContext(s.trace)).toMatchObject({observationFailed:true,workers:[{report:'invalid'}]});
    expect(JSON.stringify(inboxSpanContext(s.trace))).not.toContain('synthetic-private');
  });
  it('span descriptor 실패에서도 이미 읽은 원결과 참조를 유지',()=>{
    const s=setup(),a=go(s.trace);s.set(20);
    const bad=new Proxy(envelope(a),{getOwnPropertyDescriptor(target,key){if(key==='transactionSpans')throw Error('synthetic-private');return Reflect.getOwnPropertyDescriptor(target,key);}});
    expect(receiveInboxSpanResult(bad,s.trace,0)).toBe(original);expect(inboxSpanContext(s.trace)).toMatchObject({observationFailed:true,workers:[{report:'invalid'}]});
    expect(JSON.stringify(inboxSpanContext(s.trace))).not.toContain('synthetic-private');
  });
  it('범위 밖 index·8개 초과와 원문 추가필드는 제한',()=>{
    const s=setup(10);expect(s.trace.workers).toHaveLength(8);const a=go(s.trace);s.set(20);
    const raw={...report(a),sql:'synthetic-private',path:'synthetic-private'};receiveInboxSpanResult({...envelope(a,raw),key:'synthetic-private'},s.trace,0);receiveInboxSpanResult(original,s.trace,8);
    const formatted=inboxSpanContext(s.trace)!;expect(formatted.truncated).toBe(true);expect(formatted.observationFailed).toBe(true);expect(JSON.stringify(formatted)).not.toContain('synthetic-private');
  });
  it('잘림과 관측 실패 flag를 성공으로 바꾸지 않음',()=>{
    const s=setup(),a=go(s.trace),raw=report(a);raw.spansTruncated=true;raw.connectionsTruncated=true;raw.observationFailed=true;s.set(20);receiveInboxSpanResult(envelope(a,raw),s.trace,0);
    expect(inboxSpanContext(s.trace)!.workers[0].diagnostic).toMatchObject({spansTruncated:true,connectionsTruncated:true,observationFailed:true,clock:{status:'unavailable'}});
  });
  it('facade는 ready/go/result 1회와 terminate/exit를 그대로 전달',async()=>{
    const s=setup(),events=new EventEmitter(),sent:unknown[]=[],terminate=vi.fn(async()=>0);
    const worker=Object.assign(events,{postMessage:(v:unknown)=>{sent.push(v);},terminate}) as unknown as Worker;
    const wrapped=wrapInboxSpanWorker(worker,s.trace,0),values:unknown[]=[],exits:number[]=[];
    wrapped.on('message',v=>values.push(v));wrapped.once('exit',code=>exits.push(code));events.emit('message','ready');wrapped.postMessage('go');
    const a=(sent[0]as {spanClockAnchor:SpanClockAnchor}).spanClockAnchor;s.set(20);events.emit('message',envelope(a));events.emit('exit',0);await wrapped.terminate();
    expect(sent).toHaveLength(1);expect(values).toEqual(['ready',original]);expect(values[1]).toBe(original);expect(exits).toEqual([0]);expect(terminate).toHaveBeenCalledOnce();
  });
});

describe('inbox의 실제 native 호출 지점 구간 관측',()=>{
  it('기존 ConnectionProbe 안의 실제 exec·prepare로 역할/닫힘을 기록',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);const recorder=createSpanRecorder(),probe=createCallbackConnectionProbe(true,{recorder,phase:()=> 'inbox-open'});
    const exec=(sql:string)=>probe.observe(sql,db,[sql],invoke=>invoke());exec('BEGIN IMMEDIATE');exec('CREATE TABLE callback_meta (id INTEGER)');exec('COMMIT');
    db.close();recorder.finish();expect(recorder.report.spans[0]).toMatchObject({role:'inbox',roleEvidence:'observed-inbox-statement',phase:'inbox-open',endObservation:'commit-returned',connectionAtScopeEnd:'closed'});
  });
  it('기존 reward DB의 고정 meta prepare로 먼저 열린 구간을 구분',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);db.exec('CREATE TABLE reward_meta (id INTEGER,profile TEXT)');
    const recorder=createSpanRecorder(),probe=createCallbackConnectionProbe(true,{recorder,phase:()=> 'inbox-open'});
    probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>invoke());db.prepare('SELECT profile FROM reward_meta WHERE id=1');recorder.nativeReturned!('prepare','SELECT profile FROM reward_meta WHERE id=1',db,DatabaseSync.prototype.prepare);
    probe.observe('COMMIT',db,['COMMIT'],invoke=>invoke());db.close();recorder.finish();expect(recorder.report.spans[0]).toMatchObject({role:'reward',roleEvidence:'observed-reward-statement',connectionAtScopeEnd:'closed'});
  });
  it('실제 native 호출 없는 around 반환은 span을 만들지 않음',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);const recorder=createSpanRecorder(),probe=createCallbackConnectionProbe(true,{recorder,phase:()=> 'inbox-process'});
    expect(probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],()=>original)).toBe(original);expect(recorder.report.spans).toEqual([]);expect(db.isTransaction).toBe(false);
  });
  it('관측기 예외·고장난 report도 실제 exec 결과/오류를 바꾸지 않음',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);const broken={get report(){throw Error('synthetic-private');},before(){throw Error('synthetic-private');},after(){throw Error('synthetic-private');},finish(){}} as unknown as ReturnType<typeof createSpanRecorder>;
    const probe=createCallbackConnectionProbe(true,{recorder:broken,phase:()=> 'inbox-process'});
    expect(probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>invoke())).toBeUndefined();expect(db.isTransaction).toBe(true);
    probe.observe('ROLLBACK',db,['ROLLBACK'],invoke=>invoke());let nativeError:unknown;
    try{probe.observe('synthetic-invalid-sql',db,['synthetic-invalid-sql'],invoke=>{try{return invoke();}catch(error){nativeError=error;throw error;}});}catch(error){expect(error).toBe(nativeError);}
    expect(nativeError).toMatchObject({code:'ERR_SQLITE_ERROR'});
  });
  it('off는 제공된 observer getter도 읽지 않음',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);let reads=0;
    const options={get recorder():ReturnType<typeof createSpanRecorder>{reads++;throw Error('synthetic-private');},phase:()=> 'inbox-process'};
    const probe=createCallbackConnectionProbe(false,options);probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>invoke());probe.observe('ROLLBACK',db,['ROLLBACK'],invoke=>invoke());expect(reads).toBe(0);
  });
  it('서로 다른 역할 증거는 unknown/관측실패로 남김',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);db.exec('CREATE TABLE reward_meta (id INTEGER,profile TEXT)');db.exec('CREATE TABLE callback_meta (id INTEGER)');
    const recorder=createSpanRecorder(),probe=createCallbackConnectionProbe(true,{recorder,phase:()=> 'inbox-open'});
    probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>invoke());db.prepare('SELECT profile FROM reward_meta WHERE id=1');recorder.nativeReturned!('prepare','SELECT profile FROM reward_meta WHERE id=1',db,DatabaseSync.prototype.prepare);
    db.prepare('SELECT * FROM callback_meta WHERE id=1');recorder.nativeReturned!('prepare','SELECT * FROM callback_meta WHERE id=1',db,DatabaseSync.prototype.prepare);probe.observe('ROLLBACK',db,['ROLLBACK'],invoke=>invoke());db.close();recorder.finish();
    expect(recorder.report.observationFailed).toBe(true);expect(recorder.report.spans[0]).toMatchObject({role:'unknown',roleEvidence:'unavailable'});
  });
  it('bound/mock 함수와 미인식 SQL은 역할 증거가 아님',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);db.exec('CREATE TABLE callback_meta (id INTEGER)');
    const recorder=createSpanRecorder(),probe=createCallbackConnectionProbe(true,{recorder,phase:()=> 'inbox-process'});
    probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>invoke());
    db.prepare('SELECT * FROM callback_meta WHERE id=1');recorder.nativeReturned!('prepare','SELECT * FROM callback_meta WHERE id=1',db,DatabaseSync.prototype.prepare.bind(db));
    recorder.nativeReturned!('prepare','SELECT * FROM callback_meta WHERE id=1',db,()=>undefined);
    db.prepare('SELECT * FROM callback_meta WHERE id=1 -- synthetic-private');recorder.nativeReturned!('prepare','SELECT * FROM callback_meta WHERE id=1 -- synthetic-private',db,DatabaseSync.prototype.prepare);
    probe.observe('ROLLBACK',db,['ROLLBACK'],invoke=>invoke());db.close();recorder.finish();
    expect(recorder.report.spans[0]).toMatchObject({role:'unknown',roleEvidence:'unavailable'});expect(JSON.stringify(recorder.report)).not.toContain('synthetic-private');
  });
  it('실제 BUSY BEGIN은 원예외/호출1회/닫힘을 보존',()=>{
    const folder=mkdtempSync(join(tmpdir(),'pawblossom-inbox-span-'));folders.push(folder);const file=join(folder,'synthetic.sqlite');
    const holder=new DatabaseSync(file),contender=new DatabaseSync(file);dbs.push(holder,contender);
    contender.exec('CREATE TABLE callback_meta (id INTEGER)');contender.exec('PRAGMA busy_timeout=500');holder.exec('BEGIN IMMEDIATE');
    const recorder=createSpanRecorder(),probe=createCallbackConnectionProbe(true,{recorder,phase:()=> 'inbox-process'});
    recorder.nativeReturned!('exec','CREATE TABLE callback_meta (id INTEGER)',contender,DatabaseSync.prototype.exec);
    let originalError:unknown,calls=0;
    try{probe.observe('BEGIN IMMEDIATE',contender,['BEGIN IMMEDIATE'],invoke=>{calls++;try{return invoke();}catch(error){originalError=error;throw error;}});}catch(error){expect(error).toBe(originalError);}
    expect(calls).toBe(1);expect(originalError).toMatchObject({code:'ERR_SQLITE_ERROR',errcode:expect.any(Number)});expect((originalError as {errcode:number}).errcode&255).toBe(5);holder.exec('ROLLBACK');contender.close();holder.close();recorder.finish();
    expect(recorder.report.spans[0]).toMatchObject({role:'inbox',phase:'inbox-process',begin:{outcome:'threw',transactionActiveAfter:false},endObservation:'begin-threw',connectionAtScopeEnd:'closed'});
    expect(JSON.stringify(recorder.report)).not.toContain(file);
  });
});
