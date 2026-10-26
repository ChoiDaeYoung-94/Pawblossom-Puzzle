import {afterEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RoundLedger} from '../server/game/roundLedger';
import {RewardLedger,readRedeemedGrant} from '../server/ads/rewardLedger';
import {policy,epoch,keyResponse} from './helpers/ssvFixture';

const legacy=JSON.parse(readFileSync(new URL('./helpers/ledger-v1-fixture.json',import.meta.url),'utf8'));
const owner={ownerId:'synthetic-redemption-owner-private'},dirs:string[]=[],ledgers:{close():void}[]=[],dbs:DatabaseSync[]=[];
const busy=(errcode=5)=>Object.assign(new Error('synthetic-native-busy'),{code:'ERR_SQLITE_ERROR',errcode});
const unavailable={kind:'service-error',code:'storage-unavailable'};
afterEach(()=>{vi.restoreAllMocks();for(const l of ledgers.splice(0))try{l.close();}catch{}for(const d of dbs.splice(0))if(d.isOpen)d.close();for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});});

function fixture(mode:'start'|'redeem'){
  const directory=mkdtempSync(join(tmpdir(),'paw-idempotent-begin-'));dirs.push(directory);const path=join(directory,'ledger.sqlite'),now=vi.fn(()=>epoch);
  if(mode==='redeem'){
    const d=new DatabaseSync(path,{enableForeignKeyConstraints:false});dbs.push(d);d.exec('BEGIN');
    for(const t of legacy.reward){d.exec(t.sql);for(const row of t.rows)d.prepare('INSERT INTO '+t.name+' VALUES('+Object.keys(row).map(()=>'?').join()+')').run(...Object.values(row) as any[]);}
    d.exec('COMMIT');d.close();
  }
  const ledger=mode==='start'?new RoundLedger({databasePath:path,serverKey:new Uint8Array(32).fill(67),environment:'test',now})
    :new RewardLedger({databasePath:path,serverKey:new Uint8Array(32).fill(71),policy,dependencies:{now,transport:async()=>keyResponse()}});
  ledgers.push(ledger);now.mockClear();const context={...owner,roundId:legacy.rounds.failed.roundId};
  const call=()=>ledger instanceof RoundLedger?ledger.start(owner,{requestId:'begin-idempotent',levelId:1}):ledger.redeemVoucher(context);
  const inspect=new DatabaseSync(path);dbs.push(inspect);const table=mode==='start'?'round_rounds':'reward_redemptions';
  const count=()=>Number(inspect.prepare('SELECT COUNT(*) AS n FROM '+table).get()!.n);
  const image=()=>JSON.stringify(inspect.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>[row.name,inspect.prepare('SELECT * FROM '+row.name).all()]));
  return {ledger,path,now,context,call,count,image};
}

describe.each(['start','redeem'] as const)('%s의 멱등 업무 전 진입',mode=>{
  it('첫 BUSY5 뒤 본문·시계·COMMIT은 한 번이며 같은 요청은 재생성/재소비하지 않습니다',()=>{
    const h=fixture(mode),native=DatabaseSync.prototype.exec;let begins=0,commits=0,rollbacks=0;
    const spy=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){
      if(sql==='BEGIN IMMEDIATE'){begins++;if(begins===1){expect(h.now).not.toHaveBeenCalled();throw busy();}}
      if(sql==='COMMIT')commits++;if(sql==='ROLLBACK')rollbacks++;return native.call(this,sql);
    });
    const result=h.call();expect(result.kind).toBe(mode==='start'?'round-started':'voucher-redeemed');
    expect({begins,commits,rollbacks}).toEqual({begins:2,commits:1,rollbacks:0});expect(h.now).toHaveBeenCalledTimes(1);expect(h.count()).toBe(1);
    spy.mockRestore();const again=h.call();
    if(result.kind==='round-started'&&again.kind==='round-started'){expect(result.created).toBe(true);expect(again.created).toBe(false);expect(again.snapshot).toEqual(result.snapshot);}
    else if(result.kind==='voucher-redeemed'&&again.kind==='voucher-redeemed'){expect(result.consumed).toBe(true);expect(again.consumed).toBe(false);expect(again.grant).toEqual(result.grant);expect(again.grant).not.toBe(result.grant);expect(readRedeemedGrant(result.grant,h.context,'test')).toEqual(result.grant);}
    else throw new Error('fixture result mismatch');
    expect(h.count()).toBe(1);
  });
  it('두 번째 BEGIN도 BUSY면 정확2회로 끝내고 본문·rollback·영구행은 바꾸지 않습니다',()=>{
    const h=fixture(mode),before=h.image(),calls:string[]=[];
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql:string){calls.push(sql);throw busy();});
    expect(h.call()).toEqual(unavailable);expect(calls).toEqual(['BEGIN IMMEDIATE','BEGIN IMMEDIATE']);expect(h.now).not.toHaveBeenCalled();expect(h.count()).toBe(0);expect(h.image()===before).toBe(true);
  });
  it('COMMIT BUSY에는 본문/BEGIN을 반복하지 않고 기존 rollback으로 행을 되돌립니다',()=>{
    const h=fixture(mode),before=h.image(),native=DatabaseSync.prototype.exec;let begins=0,commits=0,rollbacks=0;
    const spy=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='BEGIN IMMEDIATE')begins++;if(sql==='COMMIT'){commits++;throw busy();}if(sql==='ROLLBACK')rollbacks++;return native.call(this,sql);});
    expect(h.call()).toEqual(unavailable);expect({begins,commits,rollbacks}).toEqual({begins:1,commits:1,rollbacks:1});expect(h.now).toHaveBeenCalledTimes(1);expect(h.count()).toBe(0);expect(h.image()===before).toBe(true);
    spy.mockRestore();expect(h.call().kind).toBe(mode==='start'?'round-started':'voucher-redeemed');expect(h.count()).toBe(1);
  });
  it('확장 BUSY261은 재진입하지 않고 본문과 행을 그대로 둡니다',()=>{
    const h=fixture(mode),before=h.image(),calls:string[]=[];
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql:string){calls.push(sql);throw busy(261);});
    expect(h.call()).toEqual(unavailable);expect(calls).toEqual(['BEGIN IMMEDIATE']);expect(h.now).not.toHaveBeenCalled();expect(h.image()===before).toBe(true);
  });
});
