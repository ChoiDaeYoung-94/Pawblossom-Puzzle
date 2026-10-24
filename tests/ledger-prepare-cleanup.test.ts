import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {createTrace,matchesFailedConnection,refreshClosedConnections,withSqliteDiagnostics} from './helpers/ledgerDiagnostics';
import {retryLedgerOpen} from './helpers/ledgerOpenRetry';

const databases:DatabaseSync[]=[],folders:string[]=[];
const targets:[object,string][]=[[DatabaseSync.prototype,'exec'],[DatabaseSync.prototype,'prepare'],[StatementSync.prototype,'run'],[StatementSync.prototype,'get'],[StatementSync.prototype,'all'],[DatabaseSync.prototype,'close']];
const descriptors=()=>targets.map(([prototype,key])=>Object.getOwnPropertyDescriptor(prototype,key));
function database(path=':memory:'){const connection=new DatabaseSync(path,{timeout:500});databases.push(connection);return connection;}
function location(){const folder=mkdtempSync(join(tmpdir(),'pawblossom-prepare-cleanup-'));folders.push(folder);return join(folder,'probe.sqlite');}
const own=(value:unknown,key:string)=>value!==null&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
afterEach(()=>{
  vi.restoreAllMocks();
  for(const connection of databases.splice(0)){if(!connection.isOpen)continue;try{connection.exec('ROLLBACK');}catch{}connection.close();}
  for(const folder of folders.splice(0)){
    const target=resolve(folder),temporaryRoot=resolve(tmpdir());
    if(dirname(target)!==temporaryRoot||!basename(target).startsWith('pawblossom-prepare-cleanup-'))throw new Error('unsafe-test-cleanup-path');
    rmSync(target,{recursive:true,force:true});
  }
});

describe('prepare 실패 연결의 검사 전용 close 대응',()=>{
  it.each([false,true])('실제 BEGIN/prepare BUSY5 닫힘·생성2회·대기1회를 구간 opt-in=%s에도 유지합니다',transactionSpans=>{
    // 서버 schema/worker 없이 SQLite의 실제 잠금 두 개를 순서대로 만듭니다. 오류 주입이 아닙니다.
    const path=location(),owner=database(path),nativeExec=DatabaseSync.prototype.exec;
    owner.exec('CREATE TABLE qa_prepare_probe(value INTEGER)');owner.exec('BEGIN IMMEDIATE');
    const before=descriptors(),close=vi.spyOn(DatabaseSync.prototype,'close'),observedDescriptors=descriptors();
    const trace=createTrace('reward-worker'),receivers:DatabaseSync[]=[],nativeErrors:unknown[]=[];
    let prepareReached=0,finalError:unknown;
    const create=vi.fn(()=>{
      const connection=database(path);receivers.push(connection);
      try{
        if(receivers.length===1)connection.exec('BEGIN IMMEDIATE');
        else{prepareReached++;connection.prepare('SELECT value FROM qa_prepare_probe');}
        throw new Error('expected-native-busy');
      }catch(error){nativeErrors.push(error);throw error;}
      finally{connection.close();}
    });
    const wait=vi.fn((ms:number)=>{
      expect(ms).toBe(25);expect(receivers[0].isOpen).toBe(false);
      // 부모 fixture의 잠금 전환은 검사 대상 연결/오류 관측과 구분합니다.
      Reflect.apply(nativeExec,owner,['ROLLBACK']);Reflect.apply(nativeExec,owner,['BEGIN EXCLUSIVE']);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
    });
    try{withSqliteDiagnostics(trace,()=>retryLedgerOpen(trace,'reward-open',true,create,wait),{transactionSpans});}catch(error){finalError=error;}
    expect(Object.hasOwn(trace,'transactionSpans')).toBe(transactionSpans);
    expect(prepareReached).toBe(1);expect(receivers).toHaveLength(2);
    expect(nativeErrors.map(error=>[own(error,'code'),own(error,'errcode')])).toEqual([['ERR_SQLITE_ERROR',5],['ERR_SQLITE_ERROR',5]]);
    expect(finalError).toBe(nativeErrors[1]);expect(create).toHaveBeenCalledTimes(2);expect(wait.mock.calls).toEqual([[25]]);
    expect(receivers.map(connection=>connection.isOpen)).toEqual([false,false]);
    expect(close.mock.contexts).toEqual(receivers);expect(close).toHaveBeenCalledTimes(2);
    expect(trace.constructorAttempts).toHaveLength(2);
    expect(trace.constructorAttempts.map(row=>({opened:row.opened,nativeCount:row.nativeCount,closeObserved:row.closeObserved,closeSucceeded:row.closeSucceeded,closeFailed:row.closeFailed,closeHookInstalled:row.closeHookInstalled,closeHookRestored:row.closeHookRestored,retryScheduled:row.retryScheduled,waitMs:row.waitMs}))).toEqual([
      {opened:false,nativeCount:1,closeObserved:true,closeSucceeded:true,closeFailed:false,closeHookInstalled:true,closeHookRestored:true,retryScheduled:true,waitMs:25},
      {opened:false,nativeCount:1,closeObserved:true,closeSucceeded:true,closeFailed:false,closeHookInstalled:true,closeHookRestored:true,retryScheduled:false,waitMs:0},
    ]);
    expect(trace.sqliteErrors).toEqual([
      {operation:'database-exec',site:'transaction-begin',phase:'reward-open',errorCode:'ERR_SQLITE_ERROR',extendedCode:5,baseCode:5,transactionActive:false,connectionClosed:true},
      {operation:'database-prepare',site:'unknown',phase:'reward-open',errorCode:'ERR_SQLITE_ERROR',extendedCode:5,baseCode:5,transactionActive:null,connectionClosed:true},
    ]);
    expect(trace.sqliteHook).toEqual({installation:'installed',restoration:'restored',installedMethods:5,restoreFailures:0});
    expect(descriptors()).toEqual(observedDescriptors);close.mockRestore();expect(descriptors()).toEqual(before);
    for(const value of [path,'qa_prepare_probe','SELECT value','BEGIN IMMEDIATE','BEGIN EXCLUSIVE','receiver'])expect(JSON.stringify(trace)).not.toContain(value);
  });

  it('실제 prepare SQL 오류의 receiver만 대응하며 반환·원래 오류·고정 DTO를 유지합니다',()=>{
    const connection=database(),trace=createTrace('reward-worker'),before=descriptors();let nativeError:unknown,finalError:unknown;
    let prepared:StatementSync|undefined;
    const returned=withSqliteDiagnostics(trace,()=>{prepared=connection.prepare('SELECT 1 AS value');return prepared;});
    expect(returned).toBe(prepared);expect(returned.get()?.value).toBe(1);expect(trace.sqliteErrors).toEqual([]);
    try{withSqliteDiagnostics(trace,()=>{try{connection.prepare('SELECT value FROM qa_missing_prepare');}catch(error){nativeError=error;throw error;}});}catch(error){finalError=error;}
    expect(finalError).toBe(nativeError);expect(own(nativeError,'code')).toBe('ERR_SQLITE_ERROR');
    expect(matchesFailedConnection(trace,0,connection)).toBe(true);connection.close();refreshClosedConnections(trace,0);
    expect(trace.sqliteErrors[0]).toEqual({operation:'database-prepare',site:'unknown',phase:'unknown',errorCode:'ERR_SQLITE_ERROR',extendedCode:1,baseCode:1,transactionActive:null,connectionClosed:true});
    expect(JSON.stringify(trace)).not.toContain('qa_missing_prepare');expect(descriptors()).toEqual(before);
  });

  it('새 own-code 조회 실패도 실제 prepare 오류와 호출 경로를 바꾸지 않습니다',()=>{
    const connection=database(),trace=createTrace('reward-worker'),getDescriptor=Object.getOwnPropertyDescriptor;
    const spy=vi.spyOn(Object,'getOwnPropertyDescriptor').mockImplementation((target,key)=>{
      if(key==='code')throw new Error('synthetic-private-descriptor');
      return Reflect.apply(getDescriptor,Object,[target,key]);
    });
    let original:unknown,finalError:unknown;
    try{withSqliteDiagnostics(trace,()=>{try{connection.prepare('SELECT value FROM qa_missing_observer');}catch(error){original=error;throw error;}});}catch(error){finalError=error;}
    expect(finalError).toBe(original);expect(trace.sqliteErrors).toHaveLength(1);
    expect(matchesFailedConnection(trace,0,connection)).toBe(false);expect(trace.sqliteHook.restoration).toBe('restored');
    expect(JSON.stringify(trace)).not.toContain('synthetic-private');spy.mockRestore();
  });

  it.each(['plain','own-getter','prototype','proxy'] as const)('잘못된 this %s는 native 오류를 보존하고 위조 getter를 호출·대응하지 않습니다',mode=>{
    const getter=vi.fn(()=>true),fake=mode==='prototype'?Object.create(DatabaseSync.prototype):{};
    if(mode==='own-getter')Object.defineProperty(fake,'isOpen',{get:getter,configurable:false});
    const receiver=mode==='proxy'?new Proxy(database(),{get:(_target,key)=>{if(key==='isOpen')return getter();return undefined;}}):fake;
    const trace=createTrace('reward-worker'),before=descriptors();let original:unknown,finalError:unknown;
    try{withSqliteDiagnostics(trace,()=>{try{Reflect.apply(DatabaseSync.prototype.prepare,receiver,['SELECT 1']);}catch(error){original=error;throw error;}});}catch(error){finalError=error;}
    expect(original).toBeInstanceOf(TypeError);expect(finalError).toBe(original);expect(own(original,'code')).not.toBe('ERR_SQLITE_ERROR');
    expect(matchesFailedConnection(trace,0,receiver)).toBe(false);refreshClosedConnections(trace,0);expect(getter).not.toHaveBeenCalled();
    expect(trace.sqliteErrors).toHaveLength(1);expect(trace.sqliteErrors[0]).toMatchObject({operation:'database-prepare',transactionActive:null,connectionClosed:null});
    expect(descriptors()).toEqual(before);
  });

  it('foreign prepare의 합성 SQL 코드 오류는 호출1회·동일 오류지만 DB 대응 근거가 아닙니다',()=>{
    const getter=vi.fn(()=>true),receiver={};Object.defineProperty(receiver,'isOpen',{get:getter,configurable:false});
    const error=Object.assign(new Error('synthetic-private-error'),{code:'ERR_SQLITE_ERROR',errcode:5});
    const foreign=vi.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(()=>{throw error;});
    const before=descriptors(),trace=createTrace('reward-worker');let finalError:unknown;
    try{withSqliteDiagnostics(trace,()=>Reflect.apply(DatabaseSync.prototype.prepare,receiver,['synthetic-private-sql']));}catch(value){finalError=value;}
    expect(finalError).toBe(error);expect(foreign).toHaveBeenCalledExactlyOnceWith('synthetic-private-sql');expect(foreign.mock.contexts[0]).toBe(receiver);
    expect(matchesFailedConnection(trace,0,receiver)).toBe(false);refreshClosedConnections(trace,0);expect(getter).not.toHaveBeenCalled();
    expect(trace.sqliteErrors[0]).toEqual({operation:'database-prepare',site:'unknown',phase:'unknown',errorCode:'ERR_SQLITE_ERROR',extendedCode:5,baseCode:5,transactionActive:null,connectionClosed:null});
    expect(JSON.stringify(trace)).not.toContain('synthetic-private');expect(descriptors()).toEqual(before);
  });

  it('실제 exec 대응과 Statement 오류의 비대응·진단 없는 반환은 기존대로 유지합니다',()=>{
    const connection=database(),execTrace=createTrace('reward-worker'),statementTrace=createTrace('reward-worker'),before=descriptors();
    connection.exec('CREATE TABLE qa_unique(value INTEGER UNIQUE); INSERT INTO qa_unique VALUES(1)');
    let original:unknown,finalError:unknown;
    try{withSqliteDiagnostics(execTrace,()=>{try{connection.exec('invalid native SQL');}catch(error){original=error;throw error;}});}catch(error){finalError=error;}
    expect(finalError).toBe(original);expect(matchesFailedConnection(execTrace,0,connection)).toBe(true);
    const statement=connection.prepare('INSERT INTO qa_unique VALUES(1)');
    try{withSqliteDiagnostics(statementTrace,()=>{try{statement.run();}catch(error){original=error;throw error;}});}catch(error){finalError=error;}
    expect(finalError).toBe(original);expect(matchesFailedConnection(statementTrace,0,statement)).toBe(false);expect(matchesFailedConnection(statementTrace,0,connection)).toBe(false);
    refreshClosedConnections(statementTrace,0);expect(statementTrace.sqliteErrors[0]).toMatchObject({operation:'statement-run',transactionActive:null,connectionClosed:null});
    const sentinel={private:'unserialized'};expect(withSqliteDiagnostics(null,()=>sentinel)).toBe(sentinel);
    expect(descriptors()).toEqual(before);
  });
});
