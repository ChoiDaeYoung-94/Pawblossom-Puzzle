import {afterEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {Worker} from 'node:worker_threads';
import {beginRoundCommand} from '../server/game/commandBegin';
import {RoundLedger} from '../server/game/roundLedger';
import {BoardEngine} from '../src/core';

const dirs:string[]=[],dbs:DatabaseSync[]=[],ledgers:RoundLedger[]=[],workers:Worker[]=[];
const owner={ownerId:'synthetic-round-begin-owner'},epoch=1792233000000;
const busy=(errcode=5)=>Object.assign(new Error('synthetic-native-error'),{code:'ERR_SQLITE_ERROR',errcode});
afterEach(async()=>{vi.restoreAllMocks();for(const w of workers.splice(0))await w.terminate();for(const l of ledgers.splice(0))try{l.close();}catch{}for(const d of dbs.splice(0))if(d.isOpen)d.close();for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'paw-round-begin-'));dirs.push(dir);const path=join(dir,'round.sqlite'),now=vi.fn(()=>epoch);
  const ledger=new RoundLedger({databasePath:path,serverKey:new Uint8Array(32).fill(71),environment:'test',now});ledgers.push(ledger);
  const started=ledger.start(owner,{requestId:'begin-round',levelId:1});if(started.kind!=='round-started')throw new Error('fixture-start');
  const snapshot=started.snapshot,engine=new BoardEngine(8,8,()=>{throw new Error('fixture-rng');},snapshot.state as any),move=engine.legalMoves()[0];if(!move)throw new Error('fixture-move');
  now.mockClear();return {ledger,path,now,snapshot,request:{roundId:snapshot.roundId,operationId:'begin-command',expectedRevision:0,command:{type:'swap' as const,...move}}};
}
function rowState(path:string){const db=new DatabaseSync(path);dbs.push(db);return {revision:db.prepare('SELECT revision FROM round_rounds').get()!.revision,operations:db.prepare('SELECT COUNT(*) AS n FROM round_ops').get()!.n};}

describe('회차 명령의 업무 전 BEGIN 재진입',()=>{
  it('첫 BEGIN BUSY만 재진입하고 업무/시계·COMMIT·영수증을 한 번 실행하며 중복 명령은 재적용하지 않습니다',()=>{
    const h=fixture(),native=DatabaseSync.prototype.exec;let begins=0,commits=0;
    const spy=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){
      if(sql==='BEGIN IMMEDIATE'){begins++;if(begins===1){expect(h.now).not.toHaveBeenCalled();throw busy();}}
      if(sql==='COMMIT')commits++;return native.call(this,sql);
    });
    const result=h.ledger.command(owner,h.request);expect(result).toMatchObject({kind:'command-result',applied:true,snapshot:{revision:1}});expect(begins).toBe(2);expect(commits).toBe(1);expect(h.now).toHaveBeenCalledTimes(1);expect(rowState(h.path)).toEqual({revision:1,operations:1});
    spy.mockRestore();expect(h.ledger.command(owner,h.request)).toMatchObject({kind:'command-result',applied:false,snapshot:{revision:1}});expect(rowState(h.path)).toEqual({revision:1,operations:1});
  });
  it('추가 진입도 BUSY면2회로 끝내고 업무·ROLLBACK·DB변경은 없습니다',()=>{
    const h=fixture(),native=DatabaseSync.prototype.exec;let begins=0,rollbacks=0;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='BEGIN IMMEDIATE'){begins++;throw busy();}if(sql==='ROLLBACK')rollbacks++;return native.call(this,sql);});
    expect(h.ledger.command(owner,h.request)).toEqual({kind:'service-error',code:'storage-unavailable'});expect(begins).toBe(2);expect(rollbacks).toBe(0);expect(h.now).not.toHaveBeenCalled();expect(rowState(h.path)).toEqual({revision:0,operations:0});
  });
  it.each([1,6,261,517])('비대상 오류%s는 추가 진입 없이 원래 실패로 끝냅니다',code=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);const error=busy(code),exec=vi.spyOn(db,'exec').mockImplementation(()=>{throw error;});
    expect(()=>beginRoundCommand(db)).toThrow(error);expect(exec).toHaveBeenCalledTimes(1);expect(db.isTransaction).toBe(false);
  });
  it('오류의 accessor나 문자열을 BUSY로 판정하지 않습니다',()=>{
    const db=new DatabaseSync(':memory:');dbs.push(db);const getter=vi.fn(()=>5),error=Object.assign(new Error('database is locked'),{code:'ERR_SQLITE_ERROR'});Object.defineProperty(error,'errcode',{get:getter});
    const exec=vi.spyOn(db,'exec').mockImplementation(()=>{throw error;});expect(()=>beginRoundCommand(db)).toThrow(error);expect(exec).toHaveBeenCalledTimes(1);expect(getter).not.toHaveBeenCalled();
  });
  it('첫 상태·실패 후·대기 후의 알 수 없는/활성/닫힌 상태에는 추가 진입하지 않습니다',()=>{
    for(const states of [[false,false],[true,false],[undefined,false],['false',false],[false,undefined],[false,false,true]] as unknown[][]){
      let checks=0;const exec=vi.fn(()=>{throw busy();});const db={isOpen:true,get isTransaction(){return states[Math.min(checks++,states.length-1)];},exec};
      expect(()=>beginRoundCommand(db as unknown as DatabaseSync)).toThrow();expect(exec).toHaveBeenCalledTimes(states.length===2&&states.every(s=>s===false)?2:1);
    }
    const exec=vi.fn(()=>{throw busy();}),db={get isOpen(){throw new Error('state-unavailable');},isTransaction:false,exec};expect(()=>beginRoundCommand(db as unknown as DatabaseSync)).toThrow();expect(exec).toHaveBeenCalledTimes(1);
  });
  it('COMMIT BUSY 뒤에는 본문이나 BEGIN을 재실행하지 않고 기존 rollback을 유지합니다',()=>{
    const h=fixture(),native=DatabaseSync.prototype.exec;let begins=0,commits=0,rollbacks=0;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='BEGIN IMMEDIATE')begins++;if(sql==='COMMIT'){commits++;throw busy();}if(sql==='ROLLBACK')rollbacks++;return native.call(this,sql);});
    expect(h.ledger.command(owner,h.request)).toEqual({kind:'service-error',code:'storage-unavailable'});expect({begins,commits,rollbacks}).toEqual({begins:1,commits:1,rollbacks:1});expect(h.now).toHaveBeenCalledTimes(1);expect(rowState(h.path)).toEqual({revision:0,operations:0});
  });
  it('생성자·시작·조회는 명령 전용 재진입 정책을 사용하지 않습니다',()=>{
    const h=fixture(),native=DatabaseSync.prototype.exec;let begins=0;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='BEGIN IMMEDIATE'){begins++;throw busy();}return native.call(this,sql);});
    expect(h.ledger.get(owner,{roundId:h.snapshot.roundId})).toEqual({kind:'service-error',code:'storage-unavailable'});expect(begins).toBe(1);
    expect(h.ledger.start(owner,{requestId:'another-start',levelId:1})).toEqual({kind:'service-error',code:'storage-unavailable'});expect(begins).toBe(2);
    expect(()=>new RoundLedger({databasePath:h.path,serverKey:new Uint8Array(32).fill(71),environment:'test',now:h.now})).toThrow();expect(begins).toBe(3);expect(h.now).not.toHaveBeenCalled();
  });
  it('진입 지연 뒤의 현재 시각으로 만료를 판정하고 지나간 회차를 실행하지 않습니다',()=>{
    const h=fixture(),native=DatabaseSync.prototype.exec;let begins=0;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='BEGIN IMMEDIATE'&&++begins===1){h.now.mockReturnValue(epoch+3_600_000);throw busy();}return native.call(this,sql);});
    expect(h.ledger.command(owner,h.request)).toEqual({kind:'rejected',code:'expired'});expect(begins).toBe(2);expect(h.now).toHaveBeenCalledTimes(1);expect(rowState(h.path)).toEqual({revision:0,operations:0});
  });
  it('실제 다른 연결의 잠금을 첫 BUSY 후 해제하면 같은 명령을1회만 적용합니다',async()=>{
    const h=fixture(),release=new SharedArrayBuffer(4),gate=new Int32Array(release);
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.path,{timeout:500});db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');Atomics.wait(new Int32Array(workerData.release),0,0,4000);db.exec('ROLLBACK');db.close();`,{eval:true,execArgv:[],workerData:{path:h.path,release}});workers.push(worker);const exited=once(worker,'exit');
    expect((await once(worker,'message'))[0]).toBe('locked');const native=DatabaseSync.prototype.exec;let firstBusy=0,begins=0;
    const spy=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='BEGIN IMMEDIATE')begins++;try{return native.call(this,sql);}catch(error){if(sql==='BEGIN IMMEDIATE'&&(error as {errcode?:number}).errcode===5){firstBusy++;expect(h.now).not.toHaveBeenCalled();Atomics.store(gate,0,1);Atomics.notify(gate,0);}throw error;}});
    try{expect(h.ledger.command(owner,h.request)).toMatchObject({kind:'command-result',applied:true,snapshot:{revision:1}});expect({firstBusy,begins}).toEqual({firstBusy:1,begins:2});expect(h.now).toHaveBeenCalledTimes(1);expect(rowState(h.path)).toEqual({revision:1,operations:1});}
    finally{spy.mockRestore();Atomics.store(gate,0,1);Atomics.notify(gate,0);await exited;}
  });
});
