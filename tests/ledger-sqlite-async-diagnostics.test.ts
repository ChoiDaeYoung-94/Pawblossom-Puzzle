import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {createTrace,withSqliteDiagnostics,withSqliteDiagnosticsAsync} from './helpers/ledgerDiagnostics';
import {createCallbackOutcome,projectCallbackSqliteDiagnostic,runObservedCallbackWithSqlite} from './helpers/callbackOutcomeDiagnostics';

const targets:[object,string][]=[[DatabaseSync.prototype,'exec'],[DatabaseSync.prototype,'prepare'],[StatementSync.prototype,'run'],[StatementSync.prototype,'get'],[StatementSync.prototype,'all']];
const snapshot=()=>targets.map(([prototype,key])=>Object.getOwnPropertyDescriptor(prototype,key)!);
const originals=snapshot(),connections:DatabaseSync[]=[];
const nativeDefine=Object.defineProperty;
function database(){const connection=new DatabaseSync(':memory:');connections.push(connection);return connection;}
afterEach(()=>{
  vi.restoreAllMocks();targets.forEach(([prototype,key],index)=>nativeDefine(prototype,key,originals[index]));
  for(const connection of connections.splice(0))if(connection.isOpen){try{connection.exec('ROLLBACK');}catch{}connection.close();}
});

describe('선택 callback의 async SQLite 수명',()=>{
  it('실제 생성·await 이후·close 안 transaction을 같은 수명으로 관측하고 원래 receiver/인수/값을 유지합니다',async()=>{
    const connection=database(),before=snapshot(),outcome=createCallbackOutcome(),query={private:'synthetic-private-query'},result={kind:'voucher-recorded',newGrant:true};
    const processCallback=vi.fn(async(input:unknown)=>{expect(input).toBe(query);await Promise.resolve();connection.exec('BEGIN IMMEDIATE');connection.exec('COMMIT');return result;});
    const close=vi.fn(()=>{connection.exec('BEGIN IMMEDIATE');connection.exec('ROLLBACK');connection.close();}),ledger={processCallback,close};
    const create=vi.fn(()=>{connection.exec('BEGIN IMMEDIATE');connection.exec('ROLLBACK');return ledger;});
    const envelope=await runObservedCallbackWithSqlite(create,query,outcome),sqlite=projectCallbackSqliteDiagnostic(Reflect.get(envelope,'sqliteDiagnostic'))!;
    expect(envelope.result).toBe(result);expect(create).toHaveBeenCalledTimes(1);expect(processCallback).toHaveBeenCalledExactlyOnceWith(query);expect(close).toHaveBeenCalledTimes(1);
    expect(processCallback.mock.contexts[0]).toBe(ledger);expect(close.mock.contexts[0]).toBe(ledger);expect(connection.isOpen).toBe(false);
    expect(sqlite.sqliteTransactions.map(row=>[row.phase,row.site,row.outcome])).toEqual([
      ['reward-open','transaction-begin','returned'],['reward-open','transaction-rollback','returned'],
      ['adapter-call','transaction-begin','returned'],['adapter-call','transaction-commit','returned'],
      ['close','transaction-begin','returned'],['close','transaction-rollback','returned'],
    ]);
    expect(sqlite.sqliteHook).toEqual({installation:'installed',restoration:'restored',installedMethods:5,restoreFailures:0});
    expect(sqlite.sqliteErrors).toEqual([]);expect(outcome.nativeObservation).toBe('not-observed');expect(snapshot()).toEqual(before);
    expect(JSON.stringify(sqlite)).not.toContain('synthetic-private');
  });

  it.each(['resolve','sync-throw','reject'] as const)('%s의 원래 값/오류와 업무 호출1회를 유지하고5개를 복원합니다',async mode=>{
    const trace=createTrace('reward-worker'),before=snapshot(),value={private:'synthetic-private-result'},error=new Error('synthetic-private-business');
    const work=vi.fn(()=>{if(mode==='sync-throw')throw error;return mode==='reject'?Promise.reject(error):Promise.resolve(value);});
    let returned:unknown,thrown:unknown;try{returned=await withSqliteDiagnosticsAsync(trace,work);}catch(value){thrown=value;}
    expect(work).toHaveBeenCalledTimes(1);expect(mode==='resolve'?returned===value&&thrown===undefined:thrown===error&&returned===undefined).toBe(true);
    expect(snapshot()).toEqual(before);expect(trace.sqliteHook.restoration).toBe('restored');
  });

  it.each([false,true])('close throw는 callback 실패=%s의 기존 outcome과 SQLite 복원을 덮지 않습니다',async callbackFails=>{
    const connection=database(),before=snapshot(),outcome=createCallbackOutcome(),value={kind:'rejected',code:'invalid-signature'};
    const processCallback=vi.fn(async()=>{await Promise.resolve();connection.exec('BEGIN IMMEDIATE');connection.exec('ROLLBACK');if(callbackFails)throw new Error('synthetic-callback');return value;});
    const close=vi.fn(()=>{connection.close();throw new Error('synthetic-close');});
    const envelope=await runObservedCallbackWithSqlite(()=>({processCallback,close}),null,outcome);
    expect(callbackFails?envelope.result:value===envelope.result).toEqual(callbackFails?{kind:'worker-error'}:true);
    expect(processCallback).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);expect(outcome.closeOutcome).toBe('threw');
    expect(projectCallbackSqliteDiagnostic(Reflect.get(envelope,'sqliteDiagnostic'))!.sqliteHook.restoration).toBe('restored');expect(snapshot()).toEqual(before);
  });

  it('await 뒤 실제 prepare 오류를 close 뒤 닫힘으로 표시하되 원래 callback 거절 의미를 유지합니다',async()=>{
    const connection=database(),outcome=createCallbackOutcome(),value={kind:'service-error',code:'storage-unavailable'};
    const envelope=await runObservedCallbackWithSqlite(()=>({async processCallback(){await Promise.resolve();try{connection.prepare('SELECT value FROM qa_missing_async');}catch{return value;}throw new Error('expected-sql-error');},close(){connection.close();}}),null,outcome);
    expect(envelope.result).toBe(value);expect(outcome).toMatchObject({resultStage:'callback',errorStage:null,closeOutcome:'returned',nativeObservation:'not-observed'});
    expect(projectCallbackSqliteDiagnostic(Reflect.get(envelope,'sqliteDiagnostic'))!.sqliteErrors[0]).toMatchObject({operation:'database-prepare',phase:'adapter-call',transactionActive:null,connectionClosed:true});
  });

  it.each(['function','attributes','deleted'] as const)('async의 foreign %s는 보존·실패 표시하며 보관된 wrapper의 늦은 호출은 수집하지 않습니다',async mode=>{
    const value={native:true},native=vi.spyOn(DatabaseSync.prototype,'exec').mockReturnValue(value as never),before=snapshot(),trace=createTrace('reward-worker');
    let wrapper!:Function,foreign:PropertyDescriptor|undefined;
    await withSqliteDiagnosticsAsync(trace,async()=>{
      wrapper=DatabaseSync.prototype.exec;await Promise.resolve();
      if(mode==='deleted')delete (DatabaseSync.prototype as unknown as Record<string,unknown>).exec;
      else nativeDefine(DatabaseSync.prototype,'exec',{...Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')!,...(mode==='function'?{value:function(this:unknown,...args:unknown[]){return Reflect.apply(wrapper,this,args);}}:{enumerable:!Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')!.enumerable})});
      foreign=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec');
    });
    expect(Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')).toEqual(foreign);
    expect(snapshot().slice(1)).toEqual(before.slice(1));expect(trace.sqliteHook).toMatchObject({restoration:'failed',restoreFailures:1});expect(trace.sqliteTransactionObservationFailed).toBe(true);
    const frozen=JSON.stringify(trace),receiver={},args=['COMMIT','synthetic-private-argument'];
    expect(Reflect.apply(foreign?.value??wrapper,receiver,args)).toBe(value);expect(JSON.stringify(trace)).toBe(frozen);
    expect(native).toHaveBeenCalledExactlyOnceWith(...args);expect(native.mock.contexts[0]).toBe(receiver);
  });

  it.each(['return','throw'] as const)('부분 설치 실패도 업무 %s를 보존하고 설치한 나머지를 복원합니다',async mode=>{
    const before=snapshot(),trace=createTrace('reward-worker'),value={},error=new Error('synthetic-business');
    vi.spyOn(Object,'defineProperty').mockImplementation((target,key,descriptor)=>{
      if(target===DatabaseSync.prototype&&key==='prepare'&&descriptor.value!==before[1].value)throw new Error('synthetic-install');
      return Reflect.apply(nativeDefine,Object,[target,key,descriptor]);
    });
    const work=vi.fn(()=>{expect(snapshot()).toEqual(before);if(mode==='throw')throw error;return value;});
    let returned:unknown,thrown:unknown;try{returned=await withSqliteDiagnosticsAsync(trace,work);}catch(value){thrown=value;}
    expect(mode==='throw'?thrown===error:returned===value).toBe(true);expect(work).toHaveBeenCalledTimes(1);expect(snapshot()).toEqual(before);
    expect(trace.sqliteHook).toMatchObject({installation:'failed',restoration:'restored',installedMethods:1});expect(trace.sqliteTransactionObservationFailed).toBe(true);
  });

  it('한 descriptor 복원 실패 뒤에도 나머지를 복원하고 원래 결과를 유지합니다',async()=>{
    const before=snapshot(),trace=createTrace('reward-worker'),value={};
    vi.spyOn(Object,'defineProperty').mockImplementation((target,key,descriptor)=>{
      if(target===StatementSync.prototype&&key==='get'&&descriptor.value===before[3].value)throw new Error('synthetic-restore');
      return Reflect.apply(nativeDefine,Object,[target,key,descriptor]);
    });
    expect(await withSqliteDiagnosticsAsync(trace,async()=>value)).toBe(value);
    expect(snapshot().filter((_,index)=>index!==3)).toEqual(before.filter((_,index)=>index!==3));
    expect(trace.sqliteHook).toMatchObject({restoration:'failed',restoreFailures:1});expect(trace.sqliteTransactionObservationFailed).toBe(true);
  });

  it.each(['clock-before','clock-after','clock-invalid','push','frozen-row','error-push','frozen-hook'] as const)('관측 %s 실패가 원래 native 호출1회·값/오류·복원을 바꾸지 않습니다',async mode=>{
    const trace=createTrace('reward-worker'),value={},error=Object.assign(new Error('synthetic-native'),{code:'ERR_SQLITE_ERROR',errcode:5}),receiver=database();
    const native=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(()=>{if(mode==='error-push')throw error;return value as never;}),before=snapshot();
    trace.phase='adapter-call';
    if(mode.startsWith('clock')){let count=0;vi.spyOn(performance,'now').mockImplementation(()=>{if(mode==='clock-invalid')return NaN;if(mode==='clock-before'||count++>0)throw new Error('synthetic-clock');return 10;});}
    if(mode==='push')vi.spyOn(trace.sqliteTransactions,'push').mockImplementation(()=>{throw new Error('synthetic-push');});
    if(mode==='frozen-row'){const push=trace.sqliteTransactions.push;vi.spyOn(trace.sqliteTransactions,'push').mockImplementation(function(this:unknown,...rows){rows.forEach(Object.freeze);return Reflect.apply(push,this,rows);});}
    if(mode==='error-push')vi.spyOn(trace.sqliteErrors,'push').mockImplementation(()=>{throw new Error('synthetic-error-push');});
    if(mode==='frozen-hook')Object.freeze(trace.sqliteHook);
    let returned:unknown,thrown:unknown;try{returned=await withSqliteDiagnosticsAsync(trace,()=>Reflect.apply(DatabaseSync.prototype.exec,receiver,['COMMIT','synthetic-private']));}catch(value){thrown=value;}
    expect(mode==='error-push'?thrown===error:returned===value).toBe(true);expect(native).toHaveBeenCalledExactlyOnceWith('COMMIT','synthetic-private');expect(native.mock.contexts[0]).toBe(receiver);
    expect(trace.sqliteTransactionObservationFailed).toBe(true);expect(snapshot()).toEqual(before);
  });

  it('async도 transaction8개 상한 뒤 잘림을 표시하고 scheduler를 추가하지 않습니다',async()=>{
    const trace=createTrace('reward-worker'),receiver=database(),native=vi.spyOn(DatabaseSync.prototype,'exec').mockReturnValue(undefined);
    await withSqliteDiagnosticsAsync(trace,async()=>{for(let index=0;index<10;index++){await Promise.resolve();receiver.exec('BEGIN IMMEDIATE');}});
    expect(native).toHaveBeenCalledTimes(10);expect(trace.sqliteTransactions).toHaveLength(8);expect(trace.sqliteTransactionsTruncated).toBe(true);expect(trace.schedulerProbe).toBeUndefined();
  });

  it('Sync는 Promise 참조·즉시 복원·foreign 무조건 복원이라는 기존 계약을 유지합니다',async()=>{
    const trace=createTrace('reward-worker'),before=snapshot(),value={},promise=Promise.resolve(value);
    const returned=withSqliteDiagnostics(trace,()=>{nativeDefine(DatabaseSync.prototype,'exec',{...Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')!,value:()=>{throw new Error('foreign');}});return promise;});
    expect(returned).toBe(promise);expect(snapshot()).toEqual(before);expect(await returned).toBe(value);expect(trace.sqliteHook.restoration).toBe('restored');
    const plain=Promise.resolve(value);expect(await withSqliteDiagnosticsAsync(null,()=>plain)).toBe(value);expect(snapshot()).toEqual(before);
  });
});
