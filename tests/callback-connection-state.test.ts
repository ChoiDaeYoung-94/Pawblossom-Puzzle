import {describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {createCallbackConnectionProbe,readCallbackConnectionState} from './helpers/callbackConnectionState';
import {createSpanRecorder,projectTransactionSpans} from './helpers/ledgerTransactionSpans';

const nativeExec=DatabaseSync.prototype.exec;
const state=(isOpen:boolean,isTransaction:boolean|null)=>({isOpen,isOpenReason:null,isTransaction,isTransactionReason:isOpen?null:'closed'});
describe('테스트 수신함 최초 claim 연결 상태',()=>{
  it('선택 span의 BEGIN/COMMIT/ROLLBACK 숫자도 원래 예외와 한 번의 native 호출에서 수집합니다',()=>{
    const spans=createSpanRecorder(),probe=createCallbackConnectionProbe(true,{recorder:spans,phase:()=>'inbox-process'}),db=new DatabaseSync(':memory:');let calls=0;
    const exec=(sql:string)=>probe.observe(sql,db,[sql],invoke=>{calls++;return invoke();});
    try{
      exec('BEGIN IMMEDIATE');
      for(const sql of ['BEGIN IMMEDIATE','COMMIT','ROLLBACK']){
        if(sql==='COMMIT')exec('ROLLBACK');
        let original:unknown,caught:unknown;
        try{probe.observe(sql,db,[sql],invoke=>{calls++;try{return invoke();}catch(error){original=error;throw error;}});}catch(error){caught=error;}
        expect(caught).toBeDefined();expect(caught).toBe(original);
      }
      db.close();spans.finish();
      const failed=spans.report.spans.flatMap(span=>[span.begin,span.commit,span.rollback]).filter(call=>call?.outcome==='threw');
      expect(failed).toHaveLength(3);expect(failed.every(call=>call?.sqliteError?.primaryCode===1&&call.sqliteError.extendedCode===1)).toBe(true);expect(calls).toBe(5);
      const projected=projectTransactionSpans(spans.report)!;
      expect(projected.spans.flatMap(span=>[span.begin,span.commit,span.rollback]).filter(call=>call?.outcome==='threw').map(call=>call?.sqliteError)).toEqual(Array.from({length:3},()=>({primaryCode:1,extendedCode:1})));
      expect(spans.report.spans[0].begin).not.toHaveProperty('sqliteError');
    }finally{if(db.isOpen)db.close();}
  });
  it('검증된 한 연결의 BEGIN과 기존 close 뒤 상태가 같은 영수증에 남습니다',()=>{
    const probe=createCallbackConnectionProbe(true),db=new DatabaseSync(':memory:');
    const exec=(sql:string)=>probe.observe(sql,db,[sql],invoke=>invoke());
    try{
      exec('PRAGMA user_version');expect(probe.receipt?.afterBegin.isOpenReason).toBe('not-reached');
      probe.arm();exec('BEGIN IMMEDIATE');expect(probe.receipt?.afterBegin).toEqual(state(true,true));
      const dto={claimConnection:probe.receipt};exec('ROLLBACK');db.close();probe.afterClose();
      expect(JSON.parse(JSON.stringify(dto))).toEqual({claimConnection:{afterBegin:state(true,true),afterClose:state(false,null)}});
      const first=JSON.stringify(dto);probe.arm();probe.afterClose();expect(JSON.stringify(dto)).toBe(first);
    }finally{if(db.isOpen)db.close();}
  });
  it('먼저 검증된 연결의 BEGIN throw도 같은 예외·현재 transaction 상태를 유지합니다',()=>{
    const probe=createCallbackConnectionProbe(true),db=new DatabaseSync(':memory:');let original:unknown,caught:unknown,calls=0;
    try{
      probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>invoke());probe.arm();
      try{probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>{calls++;try{return invoke();}catch(error){original=error;throw error;}});}catch(error){caught=error;}
      expect(caught).toBe(original);expect(calls).toBe(1);expect(probe.receipt?.afterBegin).toEqual(state(true,true));
      db.exec('ROLLBACK');db.close();probe.afterClose();expect(probe.receipt?.afterClose).toEqual(state(false,null));
    }finally{if(db.isOpen)db.close();}
  });
  it('닫힌 연결을 false transaction으로 오인하지 않습니다',()=>{
    const probe=createCallbackConnectionProbe(true),db=new DatabaseSync(':memory:');
    probe.observe('PRAGMA user_version',db,['PRAGMA user_version'],invoke=>invoke());db.close();probe.arm();
    expect(()=>probe.observe('BEGIN IMMEDIATE',db,['BEGIN IMMEDIATE'],invoke=>invoke())).toThrow();
    expect(probe.receipt?.afterBegin).toEqual(state(false,null));
  });
  it('무호출 callback이 원본·bound 함수 참조를 반환해도 임의 getter를 호출하지 않습니다',()=>{
    const getter=vi.fn(()=>{throw Error('private getter');}),receiver={};
    Object.defineProperties(receiver,{isOpen:{get:getter,configurable:false},isTransaction:{get:getter,configurable:false}});
    for(const returned of [42,nativeExec,nativeExec.bind(receiver),{executed:nativeExec}]){
      const probe=createCallbackConnectionProbe(true),operation=vi.fn(()=>returned);probe.arm();
      expect(probe.observe('BEGIN IMMEDIATE',receiver,['BEGIN IMMEDIATE'],operation)).toBe(returned);probe.afterClose();
      expect(operation).toHaveBeenCalledOnce();expect(probe.receipt?.afterBegin.isOpenReason).toBe('unverified');
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('최초 claim receiver를 이후 다른 연결로 바꾸지 않습니다',()=>{
    const probe=createCallbackConnectionProbe(true),first=new DatabaseSync(':memory:'),second=new DatabaseSync(':memory:');
    const exec=(db:DatabaseSync,sql:string)=>probe.observe(sql,db,[sql],invoke=>invoke());
    try{exec(first,'PRAGMA user_version');probe.arm();exec(first,'BEGIN IMMEDIATE');exec(first,'ROLLBACK');first.close();probe.arm();exec(second,'BEGIN IMMEDIATE');probe.afterClose();expect(probe.receipt?.afterClose).toEqual(state(false,null));}
    finally{if(first.isOpen)first.close();second.close();}
  });
  it('비진단은 추가 관측 없이 원래 호출·반환·예외를 보존합니다',()=>{
    const probe=createCallbackConnectionProbe(false),operation=vi.fn(()=>42),error={secret:'not-exported'};probe.arm();
    expect(probe.observe('BEGIN IMMEDIATE',null,['BEGIN IMMEDIATE'],operation)).toBe(42);expect(operation).toHaveBeenCalledOnce();probe.afterClose();expect(probe.receipt).toBeUndefined();
    let caught;try{probe.observe('BEGIN IMMEDIATE',null,['BEGIN IMMEDIATE'],()=>{throw error;});}catch(value){caught=value;}expect(caught).toBe(error);
  });
  it('비진단에서도 같은 native receiver·인수로 정확히 한 번 실행합니다',()=>{
    const probe=createCallbackConnectionProbe(false),db=new DatabaseSync(':memory:'),around=vi.fn((invoke:()=>unknown)=>invoke());
    try{
      const sql='CREATE TABLE one_call (n INTEGER); INSERT INTO one_call VALUES (7)';
      expect(probe.observe(sql,db,[sql],around)).toBeUndefined();expect(around).toHaveBeenCalledOnce();
      expect(db.prepare('SELECT n FROM one_call').all()).toEqual([{n:7}]);expect(probe.receipt).toBeUndefined();
    }finally{db.close();}
  });
  it('관측 영수증 쓰기 실패가 원래 반환·예외를 덮지 않습니다',()=>{
    const probe=createCallbackConnectionProbe(true),error={exact:true};Object.freeze(probe.receipt);probe.arm();let caught;
    try{probe.observe('BEGIN IMMEDIATE',null,['BEGIN IMMEDIATE'],()=>{throw error;});}catch(value){caught=value;}probe.afterClose();expect(caught).toBe(error);
  });
  it('미지원·읽기실패·비boolean과 닫힘을 구분하고 불필요한 getter는 호출하지 않습니다',()=>{
    const transaction=vi.fn(()=>true),failed=()=>{throw Error('private path / SQL');};
    expect(readCallbackConnectionState(undefined,transaction).isOpenReason).toBe('unsupported');
    expect(readCallbackConnectionState(failed,transaction).isOpenReason).toBe('read-failed');
    expect(readCallbackConnectionState(()=>1,transaction).isOpenReason).toBe('read-failed');
    expect(readCallbackConnectionState(()=>false,transaction)).toEqual(state(false,null));expect(transaction).not.toHaveBeenCalled();
    expect(readCallbackConnectionState(()=>true,undefined).isTransactionReason).toBe('unsupported');
    expect(readCallbackConnectionState(()=>true,failed).isTransactionReason).toBe('read-failed');
    expect(readCallbackConnectionState(()=>true,()=>0).isTransactionReason).toBe('read-failed');
    expect(JSON.stringify(readCallbackConnectionState(failed,transaction))).not.toMatch(/private|path|SQL/);
  });
});
