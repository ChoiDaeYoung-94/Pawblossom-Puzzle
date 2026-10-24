import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {Worker} from 'node:worker_threads';
import {createSpanClockAnchor,createSpanRecorder,projectTransactionSpans,type SpanClockProvider} from './helpers/ledgerTransactionSpans';
import {createTrace,receiveWorker,withSqliteDiagnostics,workerRow,projectTrace,safeRows} from './helpers/ledgerDiagnostics';
import {retryLedgerOpen} from './helpers/ledgerOpenRetry';
import * as spanHelpers from './helpers/ledgerTransactionSpans';

const connections:DatabaseSync[]=[],workers:Worker[]=[];
const db=()=>{const connection=new DatabaseSync(':memory:');connections.push(connection);return connection;};
const options={transactionSpans:true};
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(workers.splice(0).map(worker=>worker.terminate()));for(const connection of connections.splice(0))try{connection.close();}catch{}});
function deterministic(){let tick=10;return {origin:()=>1000,now:()=>tick++} satisfies SpanClockProvider;}
const anchor={originMs:1000,sentAtProcessMs:1};
function recorder(){return createSpanRecorder(anchor,deterministic());}

describe('선택 transaction 구간·기존 관측 호환',()=>{
  it('기본/null 경로는 새 필드나 clock 관측 없이 기존5개 hook·반환을 유지합니다',()=>{
    const connection=db(),sentinel={},native=vi.spyOn(DatabaseSync.prototype,'exec').mockReturnValue(sentinel as any);
    for(const mode of ['default','disabled','null'] as const){
      const trace=createTrace('reward-worker'),clock=vi.spyOn(performance,'now');
      try{expect(withSqliteDiagnostics(mode==='null'?null:trace,()=>connection.exec('COMMIT'),mode==='default'?undefined:{transactionSpans:mode==='null'}) as unknown).toBe(sentinel);expect(clock).toHaveBeenCalledTimes(mode==='null'?0:2);}finally{clock.mockRestore();}
      expect(trace).not.toHaveProperty('transactionSpans');
      if(mode!=='null')expect(trace.sqliteHook).toEqual({installation:'installed',restoration:'restored',installedMethods:5,restoreFailures:0});
    }
    expect(native).toHaveBeenCalledTimes(3);
  });
  it('reward/round 생성 단계에서만 역할을 붙이고 같은 연결의 소비·적용 및 scope끝 닫힘을 보존합니다',()=>{
    const reward=db(),round=db(),unknown=db(),trace=createTrace('reward-worker');
    withSqliteDiagnostics(trace,()=>{
      for(const [connection,opening,operation] of [[reward,'reward-open','redeem'],[round,'round-open','apply'],[unknown,'redeem','apply']] as const){
        trace.phase=opening;connection.exec('BEGIN IMMEDIATE');connection.exec('COMMIT');
        trace.phase=operation;connection.exec('BEGIN IMMEDIATE');connection.exec('ROLLBACK');connection.close();
      }
    },options);
    const report=trace.transactionSpans!;
    expect(report.spans.map(span=>[span.connectionIndex,span.role,span.roleEvidence,span.endObservation])).toEqual([
      [1,'reward','observed-reward-open','commit-returned'],[1,'reward','observed-reward-open','rollback-returned'],
      [2,'round','observed-round-open','commit-returned'],[2,'round','observed-round-open','rollback-returned'],
      [3,'unknown','unavailable','commit-returned'],[3,'unknown','unavailable','rollback-returned']
    ]);
    expect(report.spans.every(span=>span.connectionAtScopeEnd==='closed'&&span.transactionActiveAtScopeEnd===null)).toBe(true);
    expect(report.spansTruncated||report.connectionsTruncated||report.observationFailed).toBe(false);
    expect(trace.sqliteTransactions).toHaveLength(8);expect(trace.sqliteTransactionsTruncated).toBe(true);
    expect(report.spans[5].rollback?.outcome).toBe('returned');
  });
  it('8구간 뒤 새 구간만 잘리고 이미 보존한 구간의 ROLLBACK은 끝까지 갱신합니다',()=>{
    const trace=createTrace('reward-worker'),batch=Array.from({length:9},db);
    withSqliteDiagnostics(trace,()=>{trace.phase='reward-open';batch.forEach(connection=>connection.exec('BEGIN IMMEDIATE'));batch[0].exec('ROLLBACK');batch.forEach(connection=>connection.close());},options);
    const report=trace.transactionSpans!;
    expect(report.spans).toHaveLength(8);expect(report.connectionsTruncated).toBe(true);
    expect(report.spans[0]).toMatchObject({endObservation:'rollback-returned',rollback:{outcome:'returned'},connectionAtScopeEnd:'closed'});
    expect(report.spans.slice(1).every(span=>span.endObservation==='missing'&&span.rollback===null&&span.connectionAtScopeEnd==='closed')).toBe(true);
    expect(trace.sqliteTransactions).toHaveLength(8);expect(trace.sqliteTransactionsTruncated).toBe(true);
  });
  it('같은 연결의9번째 구간에도8개 요약과 명시적 잘림만 보존합니다',()=>{
    const connection=db(),trace=createTrace('reward-worker');
    withSqliteDiagnostics(trace,()=>{trace.phase='reward-open';for(let i=0;i<9;i++){connection.exec('BEGIN IMMEDIATE');connection.exec('COMMIT');}connection.close();},options);
    expect(trace.transactionSpans?.spans).toHaveLength(8);expect(trace.transactionSpans?.spansTruncated).toBe(true);
    expect(trace.transactionSpans?.spans.every(span=>span.endObservation==='commit-returned'&&span.commit?.outcome==='returned')).toBe(true);
  });
  it('생성자 BEGIN BUSY5·닫힘·25ms 재시도는 변경 없이 별도 연결 두 구간에 남깁니다',()=>{
    const trace=createTrace('reward-worker'),marker=Object.assign(new Error('synthetic-private-busy'),{code:'ERR_SQLITE_ERROR',errcode:5});
    const original=DatabaseSync.prototype.exec;let fail=true;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,...args:unknown[]){if(fail){fail=false;throw marker;}return Reflect.apply(original,this,args);});
    const create=vi.fn(()=>{const connection=db();try{connection.exec('BEGIN IMMEDIATE');connection.exec('COMMIT');return marker;}finally{connection.close();}}),wait=vi.fn();
    expect(withSqliteDiagnostics(trace,()=>retryLedgerOpen(trace,'reward-open',true,create,wait),options)).toBe(marker);
    expect(create).toHaveBeenCalledTimes(2);expect(wait.mock.calls).toEqual([[25]]);
    expect(trace.constructorAttempts.map(row=>[row.attempt,row.opened,row.waitMs])).toEqual([[1,false,25],[2,true,0]]);
    expect(trace.sqliteErrors[0]).toMatchObject({baseCode:5,transactionActive:false,connectionClosed:true});
    // 이 테스트의 exec는 spy입니다. 새 상태 관측은 native brand를 추측하지 않습니다.
    expect(trace.transactionSpans?.spans.map(span=>[span.connectionIndex,span.endObservation,span.connectionAtScopeEnd])).toEqual([[1,'begin-threw','unknown'],[2,'commit-returned','unknown']]);
    expect(trace.sqliteHook.installedMethods).toBe(5);expect(trace.sqliteHook.restoration).toBe('restored');
  });
  it('같은 연결의 중첩 BEGIN 실패는 앞선 성공 구간을 덮지 않습니다',()=>{
    const connection=db(),trace=createTrace('reward-worker');let emitted:unknown,observed:unknown;
    withSqliteDiagnostics(trace,()=>{trace.phase='reward-open';connection.exec('BEGIN IMMEDIATE');try{try{connection.exec('BEGIN IMMEDIATE');}catch(error){emitted=error;throw error;}}catch(error){observed=error;}connection.exec('ROLLBACK');connection.close();},options);
    expect(observed).toBe(emitted);expect(observed).toBeDefined();
    expect(trace.transactionSpans?.spans.map(span=>span.endObservation)).toEqual(['rollback-returned','begin-threw']);
    expect(trace.transactionSpans?.spans[0].rollback?.outcome).toBe('returned');expect(trace.transactionSpans?.spans[1].rollback).toBeNull();
  });
  it.each([false,true])('COMMIT throw 뒤 ROLLBACK throw=%s도 원래 예외·this·인수·복원과 한 구간을 유지합니다',rollbackThrows=>{
    const connection=db(),trace=createTrace('reward-worker'),marker=new Error('synthetic-private-end'),argument={private:'synthetic-private-argument'},original=DatabaseSync.prototype.exec;
    const native=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,...args:unknown[]){if(args[0]==='COMMIT'||rollbackThrows&&args[0]==='ROLLBACK')throw marker;return Reflect.apply(original,this,args);});
    const descriptor=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec');let observed:unknown;
    withSqliteDiagnostics(trace,()=>{trace.phase='reward-open';connection.exec('BEGIN IMMEDIATE');trace.phase='redeem';try{Reflect.apply(DatabaseSync.prototype.exec,connection,['COMMIT',argument]);}catch(error){observed=error;}try{connection.exec('ROLLBACK');}catch(error){expect(error).toBe(marker);}connection.close();},options);
    expect(observed).toBe(marker);expect(native.mock.contexts.every(receiver=>receiver===connection)).toBe(true);
    expect(native.mock.calls[1]).toEqual(['COMMIT',argument]);expect(native).toHaveBeenCalledTimes(3);
    expect(Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')).toEqual(descriptor);
    expect(trace.transactionSpans?.spans).toHaveLength(1);
    expect(trace.transactionSpans?.spans[0]).toMatchObject({commit:{outcome:'threw',transactionActiveAfter:null},rollback:{outcome:rollbackThrows?'threw':'returned'},endObservation:rollbackThrows?'end-threw':'rollback-returned'});
    expect(JSON.stringify(trace)).not.toContain('synthetic-private');
  });
  it.each([false,true])('종료 SQL 없는 scope에서 closed=%s는 종료 누락과 별개로 기록합니다',closed=>{
    const connection=db(),trace=createTrace('reward-worker');
    withSqliteDiagnostics(trace,()=>{trace.phase='reward-open';connection.exec('BEGIN IMMEDIATE');if(closed)connection.close();},options);
    expect(trace.transactionSpans?.spans[0]).toMatchObject({endObservation:'missing',commit:null,rollback:null,connectionAtScopeEnd:closed?'closed':'open',transactionActiveAtScopeEnd:closed?null:true});
  });
  it('관측하지 않은 BEGIN 뒤 종료는 orphan이며 역할을 나중 단계로 추측하지 않습니다',()=>{
    const connection=db(),trace=createTrace('reward-worker');
    withSqliteDiagnostics(trace,()=>{trace.phase='redeem';connection.exec('BEGIN');connection.exec('COMMIT');connection.close();},options);
    expect(trace.transactionSpans?.spans[0]).toMatchObject({begin:null,role:'unknown',roleEvidence:'unavailable',endObservation:'orphan',commit:{outcome:'returned'}});
  });
});

describe('구간 관측 실패·보안·제한',()=>{
  it.each(['create','before','after','finish','phase'] as const)('%s 외부 관측 예외도 native 성공/동일 throw와 전체 hook 복원을 덮지 않습니다',mode=>{
    const connection=db(),marker=new Error('synthetic-private-span-boundary'),sentinel={};let nativeThrows=false;
    const native=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(()=>{if(nativeThrows)throw marker;return sentinel as any;}),descriptor=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec');
    const original=spanHelpers.createSpanRecorder;
    if(mode!=='phase')vi.spyOn(spanHelpers,'createSpanRecorder').mockImplementation((...args)=>{
      if(mode==='create')throw marker;const observer=original(...args);observer[mode]=()=>{throw marker;};return observer;
    });
    for(const throws of [false,true]){
      nativeThrows=throws;const trace=createTrace('reward-worker');let returned:unknown,thrown:unknown;const count=native.mock.calls.length;
      try{returned=withSqliteDiagnostics(trace,()=>{if(mode==='phase')Object.defineProperty(trace,'phase',{get(){throw marker;}});return connection.exec('COMMIT');},options);}catch(error){thrown=error;}
      expect(throws?thrown===marker&&returned===undefined:returned===sentinel&&thrown===undefined).toBe(true);
      expect(native.mock.calls.length-count).toBe(1);expect(Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')).toEqual(descriptor);
      expect(trace.sqliteHook).toEqual({installation:'installed',restoration:'restored',installedMethods:5,restoreFailures:0});
      expect(trace.sqliteTransactionObservationFailed).toBe(true);if(mode!=='create')expect(trace.transactionSpans?.observationFailed).toBe(true);
      expect(JSON.stringify(projectTrace(trace))).not.toContain('synthetic-private');
    }
  });
  it.each(['before-clock','after-clock','invalid-clock','backward-clock','push','frozen-call','frozen-span'] as const)('%s 관측 실패는 성공/throw의 원래 native1회와5개 descriptor 복원을 유지합니다',mode=>{
    const connection=db(),sentinel={},marker=new Error('synthetic-private-observation');let nativeThrows=false;
    const native=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(()=>{if(nativeThrows)throw marker;return sentinel as any;});
    const targets:[object,string][]=[[DatabaseSync.prototype,'exec'],[DatabaseSync.prototype,'prepare'],[StatementSync.prototype,'run'],[StatementSync.prototype,'get'],[StatementSync.prototype,'all']],descriptors=targets.map(([prototype,key])=>Object.getOwnPropertyDescriptor(prototype,key));
    for(const throws of [false,true]){
      nativeThrows=throws;const trace=createTrace('reward-worker');let observed:unknown,returned:unknown,spanClockReads=0;
      const originalNow=performance.now.bind(performance),clock=vi.spyOn(performance,'now').mockImplementation(()=>{
        // legacy 이벤트와 새 span 모두 같은 provider를 쓰므로 fail 시점은 실제 호출 경계로 검사합니다.
        spanClockReads++;if(mode==='before-clock'&&spanClockReads===1||mode==='after-clock'&&spanClockReads===5)throw marker;
        return mode==='invalid-clock'?NaN:mode==='backward-clock'?100-spanClockReads:originalNow();
      });
      const start=native.mock.calls.length;
      try{
        try{returned=withSqliteDiagnostics(trace,()=>{
          const spans=trace.transactionSpans!;
          if(mode==='push')vi.spyOn(spans.spans,'push').mockImplementation(()=>{throw marker;});
          if(mode==='frozen-call'||mode==='frozen-span'){
            const push=spans.spans.push;vi.spyOn(spans.spans,'push').mockImplementation(function(this:unknown,...rows){for(const row of rows){if(mode==='frozen-span')Object.freeze(row);else Object.defineProperty(row,'commit',{set(value:unknown){Object.freeze(value);},get(){return null;}});}return Reflect.apply(push,this,rows);});
          }
          return Reflect.apply(DatabaseSync.prototype.exec,connection,['COMMIT',sentinel]);
        },options);}catch(error){observed=error;}
      }finally{clock.mockRestore();}
      expect(throws?observed===marker&&returned===undefined:returned===sentinel&&observed===undefined).toBe(true);
      expect(native.mock.calls.length-start).toBe(1);expect(native.mock.calls.at(-1)).toEqual(['COMMIT',sentinel]);
      expect(targets.map(([prototype,key])=>Object.getOwnPropertyDescriptor(prototype,key))).toEqual(descriptors);
      expect(trace.sqliteHook).toEqual({installation:'installed',restoration:'restored',installedMethods:5,restoreFailures:0});
      expect(trace.transactionSpans?.observationFailed).toBe(true);expect(JSON.stringify(projectTrace(trace))).not.toContain('synthetic-private');
    }
  });
  it('같은 종료의 반복은 고정 필드를 덮지 않고 누락을 표시하며 구간/JSON을 제한합니다',()=>{
    const observer=recorder(),receiver={};
    observer.after(observer.before('BEGIN IMMEDIATE',receiver,'reward-open'),'returned');
    observer.after(observer.before('COMMIT',receiver,'redeem'),'threw');
    for(let i=0;i<50;i++)observer.after(observer.before('COMMIT',receiver,'redeem'),'threw');
    observer.after(observer.before('ROLLBACK',receiver,'redeem'),'returned');observer.finish();
    expect(observer.report.spans).toHaveLength(1);expect(observer.report.spans[0]).toMatchObject({commit:{outcome:'threw'},rollback:{outcome:'returned'},endAttemptsTruncated:true});
    expect(JSON.stringify(observer.report).length).toBeLessThan(2000);
  });
  it('native 상태 getter 부재/throw와 scope끝 쓰기 실패도 관측 외 동작을 만들지 않습니다',()=>{
    const observer=recorder(),getter=vi.fn(()=>{throw Error('synthetic-private-native');}),receiver={};
    Object.defineProperty(receiver,'isOpen',{get:getter});Object.defineProperty(receiver,'isTransaction',{get:getter});
    observer.after(observer.before('BEGIN IMMEDIATE',receiver,'reward-open'),'returned');observer.finish();
    expect(observer.report.spans[0]).toMatchObject({connectionAtScopeEnd:'unknown',transactionActiveAtScopeEnd:null,begin:{transactionActiveAfter:null}});
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(observer.report)).not.toContain('synthetic-private');
    const frozen=recorder();frozen.after(frozen.before('COMMIT',{},'apply'),'returned');Object.freeze(frozen.report.spans[0]);expect(()=>frozen.finish()).not.toThrow();expect(frozen.report.observationFailed).toBe(true);
  });
  it('실제 native wrong receiver 예외1회에는 임의 own getter를 읽거나 brand를 추측하지 않습니다',()=>{
    const observer=recorder(),receiver={},getter=vi.fn(()=>{throw Error('synthetic-private-own-getter');});
    Object.defineProperty(receiver,'isOpen',{get:getter,configurable:false});Object.defineProperty(receiver,'isTransaction',{get:getter,configurable:false});
    const native=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')!.value,token=observer.before('BEGIN IMMEDIATE',receiver,'reward-open');
    let calls=0,emitted:unknown,observed:unknown;
    try{try{calls++;Reflect.apply(native,receiver,['BEGIN IMMEDIATE']);}catch(error){emitted=error;observer.after(token,'threw',native);throw error;}}catch(error){observed=error;}
    observer.finish();expect(calls).toBe(1);expect(observed).toBeDefined();expect(observed).toBe(emitted);expect(getter).not.toHaveBeenCalled();
    expect(observer.report.spans[0]).toMatchObject({endObservation:'begin-threw',begin:{outcome:'threw',transactionActiveAfter:null},connectionAtScopeEnd:'unknown',transactionActiveAtScopeEnd:null});
    expect(JSON.stringify(observer.report)).not.toContain('synthetic-private');
  });
  it.each(['mock','bound'] as const)('%s 성공 반환도 원본 native exec 정체성이 없으면 own getter를 cache하지 않습니다',mode=>{
    const observer=recorder(),receiver={},getter=vi.fn(()=>true),connection=db(),native=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')!.value;
    Object.defineProperty(receiver,'isOpen',{get:getter,configurable:false});Object.defineProperty(receiver,'isTransaction',{get:getter,configurable:false});
    const execute=mode==='mock'?vi.fn(()=>undefined):native.bind(connection),token=observer.before('BEGIN IMMEDIATE',receiver,'reward-open');
    Reflect.apply(execute,receiver,['BEGIN IMMEDIATE']);observer.after(token,'returned',execute);observer.finish();
    if(mode==='mock')expect(execute).toHaveBeenCalledTimes(1);expect(getter).not.toHaveBeenCalled();
    expect(observer.report.spans[0]).toMatchObject({begin:{outcome:'returned',transactionActiveAfter:null},connectionAtScopeEnd:'unknown',transactionActiveAtScopeEnd:null});
  });
  it('원본 native 성공 뒤 cache한 공식 accessor만 후속 BEGIN throw·close 뒤에도 사용합니다',()=>{
    const observer=recorder(),connection=db(),native=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')!.value;
    const invoke=(sql:string)=>{const token=observer.before(sql,connection,'reward-open');try{Reflect.apply(native,connection,[sql]);observer.after(token,'returned',native);}catch(error){observer.after(token,'threw',native);throw error;}};
    invoke('BEGIN IMMEDIATE');expect(()=>invoke('BEGIN IMMEDIATE')).toThrow();invoke('ROLLBACK');connection.close();observer.finish();
    expect(observer.report.spans[0]).toMatchObject({begin:{transactionActiveAfter:true},rollback:{transactionActiveAfter:false},endObservation:'rollback-returned',connectionAtScopeEnd:'closed'});
    expect(observer.report.spans[1]).toMatchObject({begin:{outcome:'threw',transactionActiveAfter:true},endObservation:'begin-threw',connectionAtScopeEnd:'closed'});
  });
  it('검증 전에 닫힌 실제 receiver의 최초 native 실패도 상태를 unknown으로 유지합니다',()=>{
    const observer=recorder(),connection=db(),native=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')!.value;connection.close();
    const token=observer.before('BEGIN IMMEDIATE',connection,'reward-open');let thrown:unknown;
    try{Reflect.apply(native,connection,['BEGIN IMMEDIATE']);}catch(error){thrown=error;observer.after(token,'threw',native);}observer.finish();
    expect(thrown).toBeDefined();expect(observer.report.spans[0]).toMatchObject({begin:{outcome:'threw',transactionActiveAfter:null},connectionAtScopeEnd:'unknown',transactionActiveAtScopeEnd:null});
  });
  it('위조·getter·proxy·추가 필드는 허용 enum/유한수만 투영하며 8개 이후 잘립니다',()=>{
    const privateValue='synthetic-private-dto',getter=vi.fn(()=>{throw new Error(privateValue);}),raw:any={schema:1,clock:{status:'verified',reason:'verified'},spans:Array.from({length:10},(_,i)=>({connectionIndex:i?9:1,role:'reward',roleEvidence:i?'observed-round-open':'observed-reward-open',phase:privateValue,begin:{startedAtProcessMs:-1,finishedAtProcessMs:Infinity,outcome:privateValue,transactionActiveAfter:privateValue,sql:privateValue},commit:null,rollback:null,endObservation:privateValue,endAttemptsTruncated:privateValue,connectionAtScopeEnd:privateValue,transactionActiveAtScopeEnd:privateValue,path:privateValue,owner:privateValue,key:privateValue}))};
    Object.defineProperty(raw.spans[0],'commit',{get:getter});Object.defineProperty(raw.clock,'originMs',{get:getter});
    const projected=projectTransactionSpans(raw)!;expect(projected.spans).toHaveLength(8);expect(projected.spansTruncated).toBe(true);
    expect(projected.spans[0]).toMatchObject({connectionIndex:1,role:'reward',roleEvidence:'observed-reward-open',phase:'unknown',commit:null,begin:{startedAtProcessMs:null,finishedAtProcessMs:null,outcome:'unknown',transactionActiveAfter:null}});
    expect(projected.spans.slice(1).every(span=>span.connectionIndex===null&&span.role==='unknown'&&span.roleEvidence==='unavailable')).toBe(true);
    expect(projected.clock.status).toBe('unavailable');expect(getter).not.toHaveBeenCalled();expect(JSON.stringify(projected)).not.toContain(privateValue);
    const proxy=new Proxy({},{getOwnPropertyDescriptor:getter});expect(()=>projectTransactionSpans(proxy)).not.toThrow();expect(JSON.stringify(projectTransactionSpans(proxy))).not.toContain(privateValue);
    const trace=createTrace('reward-parallel'),row=workerRow(0),result={kind:'reward-result',snapshot:{privateValue}};trace.workers.push(row);
    expect(receiveWorker({kind:'synthetic-worker-report',result,diagnostic:{transactionSpans:raw}},row)).toBe(result);expect(safeRows(trace)).not.toContain(privateValue);expect(row).not.toHaveProperty('result');
  });
});

describe('실제 부모-Worker 시간 기준과 unavailable',()=>{
  function sample(){const observer=recorder();observer.after(observer.before('BEGIN IMMEDIATE',{},'reward-open'),'returned');observer.finish();return observer.report;}
  const parent:SpanClockProvider={origin:()=>1000,now:()=>100};
  it('Array Proxy의 일반 get/length getter는 실행하지 않고 own descriptor로만 제한 투영합니다',()=>{
    const report=sample(),get=vi.fn(()=>{throw new Error('synthetic-private-array-get');});
    const raw={...report,spans:new Proxy(report.spans,{get})},projected=projectTransactionSpans(raw,anchor,parent)!;
    expect(get).not.toHaveBeenCalled();expect(projected.spans).toHaveLength(1);expect(projected.observationFailed).toBe(false);expect(projected.clock.status).toBe('verified');
    expect(JSON.stringify(projected)).not.toContain('synthetic-private');
  });
  it.each([undefined,null,{},'synthetic-private-array',0,new Uint8Array(1)])('누락/비배열 spans %j는 불완전 관측이며 clock을 verified로 만들지 않습니다',spans=>{
    const raw={...sample(),spans},projected=projectTransactionSpans(raw,anchor,parent)!;
    expect(projected.spans).toEqual([]);expect(projected.observationFailed).toBe(true);expect(projected.clock).toMatchObject({status:'unavailable',reason:'invalid'});expect(JSON.stringify(projected)).not.toContain('synthetic-private');
  });
  it('array length own descriptor가 없거나 불량이면 일반 get으로 대체하지 않습니다',()=>{
    const get=vi.fn(()=>{throw Error('synthetic-private-length');}),getOwnPropertyDescriptor=vi.fn((target:unknown[],key:string|symbol)=>key==='length'?undefined:Reflect.getOwnPropertyDescriptor(target,key));
    const proxy=new Proxy([],{get,getOwnPropertyDescriptor}),projected=projectTransactionSpans({...sample(),spans:proxy},anchor,parent)!;
    expect(get).not.toHaveBeenCalled();expect(getOwnPropertyDescriptor).toHaveBeenCalledWith(expect.any(Array),'length');
    expect(projected.observationFailed).toBe(true);expect(projected.clock.status).toBe('unavailable');expect(JSON.stringify(projected)).not.toContain('synthetic-private');
  });
  it('동일 origin·부모 송수신·worker/호출 포함관계를 모두 확인한 경우에만 verified입니다',()=>{
    const report=sample(),projected=projectTransactionSpans(report,anchor,parent)!;
    expect(projected.clock).toMatchObject({status:'verified',reason:'verified',originMs:1000,parentOriginMs:1000,parentSentAtProcessMs:1,parentReceivedAtProcessMs:100});
    expect(projectTransactionSpans(report)?.clock).toMatchObject({status:'unavailable',reason:'parent-unverified'});
  });
  it.each(['missing-origin','origin-mismatch','anchor-origin','echo-anchor','before-parent','after-parent','reversed','outside-call','parent-clock','parent-origin'] as const)('%s는 검증 성공/가짜0 대신 unavailable입니다',mode=>{
    const report=sample(),actualAnchor={...anchor};let provider=parent;
    if(mode==='missing-origin')report.clock.originMs=null;if(mode==='origin-mismatch')report.clock.originMs=2000;if(mode==='anchor-origin')actualAnchor.originMs=2000;
    if(mode==='echo-anchor')report.clock.parentSentAtProcessMs=2;if(mode==='before-parent')actualAnchor.sentAtProcessMs=30;if(mode==='after-parent')provider={...parent,now:()=>1};
    if(mode==='reversed')report.clock.workerFinishedAtProcessMs=0;if(mode==='outside-call')report.spans[0].begin!.finishedAtProcessMs=200;
    if(mode==='parent-clock')provider={...parent,now:()=>{throw Error('synthetic-private-clock');}};if(mode==='parent-origin')provider={...parent,origin:()=>NaN};
    const projected=projectTransactionSpans(report,actualAnchor,provider)!;expect(projected.clock.status).toBe('unavailable');expect(projected.clock.reason).not.toBe('verified');expect(JSON.stringify(projected)).not.toContain('synthetic-private');
  });
  it('anchor/관측 clock 실패는 null과 관측 실패를 보존하고 예외를 출력하지 않습니다',()=>{
    const provider={origin:()=>{throw Error('synthetic-private-clock');},now:()=>NaN};
    expect(createSpanClockAnchor(provider)).toEqual({originMs:null,sentAtProcessMs:null});
    const observer=createSpanRecorder(undefined,provider);observer.after(observer.before('BEGIN IMMEDIATE',{},'reward-open'),'returned');observer.finish();
    expect(observer.report.observationFailed).toBe(true);expect(observer.report.spans[0].begin).toMatchObject({startedAtProcessMs:null,finishedAtProcessMs:null});expect(JSON.stringify(observer.report)).not.toContain('synthetic-private');
  });
  it('실제1Worker의 SQLite 구간을 부모 anchor로 검증하며 원문 결과와5개 hook 복원을 유지합니다',async()=>{
    const realAnchor=createSpanClockAnchor(),helper=new URL('./helpers/ledgerDiagnostics.ts',import.meta.url).href;
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');import(workerData.helper).then(({createTrace,withSqliteDiagnostics})=>{const trace=createTrace('reward-worker'),connection=new DatabaseSync(':memory:');const result=withSqliteDiagnostics(trace,()=>{trace.phase='reward-open';connection.exec('BEGIN IMMEDIATE');connection.exec('COMMIT');trace.phase='redeem';connection.exec('BEGIN IMMEDIATE');connection.exec('ROLLBACK');connection.close();return {kind:'reward-result'};},{transactionSpans:true,spanClockAnchor:workerData.anchor});parentPort.postMessage({kind:'synthetic-worker-report',result,diagnostic:trace});});`,{eval:true,workerData:{helper,anchor:realAnchor},execArgv:['--experimental-transform-types']});workers.push(worker);
    const report=await new Promise<any>((resolve,reject)=>{worker.once('message',resolve);worker.once('error',()=>reject(new Error('span-clock-worker-error')));worker.once('exit',code=>{if(code)reject(new Error('span-clock-worker-exit'));});});
    const row=workerRow(0);expect(receiveWorker(report,row,realAnchor)).toBe(report.result);
    expect(row.diagnostic?.transactionSpans?.clock).toMatchObject({status:'verified',reason:'verified'});expect(row.diagnostic?.transactionSpans?.spans).toHaveLength(2);
    expect(row.diagnostic?.transactionSpans?.spans.every(span=>span.role==='reward'&&span.connectionAtScopeEnd==='closed')).toBe(true);
    expect(row.diagnostic?.sqliteHook).toEqual({installation:'installed',restoration:'restored',installedMethods:5,restoreFailures:0});
  });
});
