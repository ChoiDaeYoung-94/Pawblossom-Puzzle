import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fork} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {BoardEngine} from '../src/core/BoardEngine';
import {RoundLedger,type RoundLedgerOptions,type RoundSnapshot,type RoundCommandRequest} from '../server/game/roundLedger';
import {advanceState,publicState,startState,type RoundState} from '../server/game/roundState';
import {PlayFabSessionAuthenticator} from '../server/auth/playfabSession';
const key=new Uint8Array(32).fill(67),epoch=1_792_233_000_000,owner={ownerId:'synthetic-round-owner-private'};
const dirs:string[]=[],ledgers:RoundLedger[]=[],dbs:DatabaseSync[]=[],workers:Worker[]=[];
const workerUrl=new URL('./helpers/round-ledger-worker.mjs',import.meta.url);
const denied=(code:string)=>({kind:'rejected',code}),unavailable={kind:'service-error',code:'storage-unavailable'};
function file(){const p=mkdtempSync(join(tmpdir(),'pawblossom-round-'));dirs.push(p);return join(p,'round.sqlite');}
function open(path=file(),patch:Partial<RoundLedgerOptions>={}){
  let now=epoch;const options:RoundLedgerOptions={databasePath:path,serverKey:key,environment:'test',now:()=>now,...patch};
  const ledger=new RoundLedger(options);ledgers.push(ledger);return {ledger,path,options,setNow:(v:number)=>now=v};
}
function db(path:string){const d=new DatabaseSync(path);dbs.push(d);return d;}
function close(ledger:RoundLedger){ledger.close();ledgers.splice(ledgers.indexOf(ledger),1);}
function start(ledger:RoundLedger,request={requestId:'start-1',levelId:4},context=owner):RoundSnapshot{const r=ledger.start(context,request);if(r.kind!=='round-started')throw new Error('fixture-start');return r.snapshot;}
function command(ledger:RoundLedger,s:RoundSnapshot,extra:Partial<RoundCommandRequest>={}):RoundCommandRequest{
  const engine=new BoardEngine(8,8,()=>{throw new Error();},s.state as any),m=engine.legalMoves()[0];
  return {roundId:s.roundId,operationId:'op-'+s.revision,expectedRevision:s.revision,command:{type:'swap',...m},...extra};
}
function apply(ledger:RoundLedger,r:RoundCommandRequest){const v=ledger.command(owner,r);if(v.kind!=='command-result')throw new Error('fixture-command:'+JSON.stringify(v));return v;}
function invalid(s:RoundSnapshot){const e=new BoardEngine(8,8,()=>{throw new Error();},s.state as any),legal=e.legalMoves();for(let r=0;r<8;r++)for(let c=0;c<7;c++){const a={row:r,col:c},b={row:r,col:c+1};if(!legal.some(m=>JSON.stringify(m)===JSON.stringify({a,b})))return {type:'swap' as const,a,b};}throw new Error();}
function data(path:string,action:string,request:unknown){return {path,action,request,key:[...key],now:epoch,owner};}
async function child(input:ReturnType<typeof data>){
  // 기존 엔진의 parameter property는 유지하며 Node22/24 타입 변환으로 실행합니다.
  const process=fork(workerUrl,[],{execArgv:['--experimental-transform-types'],stdio:['ignore','ignore','ignore','ipc']});
  const done=new Promise<void>(resolve=>process.once('exit',()=>resolve()));
  const output=new Promise<any>((resolve,reject)=>{process.once('message',resolve);process.once('error',reject);process.once('exit',code=>{if(code)reject(new Error('child-failed'));});});
  try{process.send(input);const v=await output;await done;return v;}finally{if(process.exitCode===null){process.kill();await done;}}
}
async function concurrent(inputs:ReturnType<typeof data>[]){
  const batch=inputs.map(value=>new Worker(workerUrl,{workerData:value,execArgv:['--experimental-transform-types']}));workers.push(...batch);
  const outputs:Promise<any>[]=[];
  await Promise.all(batch.map(w=>new Promise<void>((resolve,reject)=>{
    let receive!:(v:any)=>void;outputs.push(new Promise((yes,no)=>{receive=yes;w.on('error',no);}));
    w.on('message',v=>v==='ready'?resolve():receive(v));w.on('error',reject);
  })));
  batch.forEach(w=>w.postMessage('go'));return Promise.all(outputs);
}
function mac(domain:string,value:string){const derived=createHmac('sha256',key).update('pawblossom-round-v1\0'+domain).digest();return createHmac('sha256',derived).update(value).digest('hex');}
function signRow(d:DatabaseSync,patch:(s:any)=>void){
  const r:any=d.prepare('SELECT * FROM round_rounds').get(),s=JSON.parse(r.state_json);patch(s);r.state_json=JSON.stringify(s);
  const profile=d.prepare('SELECT profile FROM round_meta').get()?.profile;
  const signature=mac('state',JSON.stringify([profile,r.round_id,r.owner_hash,r.create_hash,r.create_digest,r.created_at,r.expires_at,r.revision,r.state_json]));
  d.prepare('UPDATE round_rounds SET state_json=?,state_mac=?').run(r.state_json,signature);
}
function seededRound(ledger:RoundLedger,path:string,levelId=30,requestId='seeded-round'){
  const s=start(ledger,{requestId,levelId}),storage=db(path),row:any=storage.prepare('SELECT * FROM round_rounds WHERE round_id=?').get(s.roundId),profile=storage.prepare('SELECT profile FROM round_meta').get()?.profile;
  // 테스트 전용 합성 키로 고정 seed의 정상 초기 상태만 서명합니다. 특수는 이후 실제 교환으로 만듭니다.
  row.state_json=JSON.stringify(startState(levelId,1));row.state_mac=mac('state',JSON.stringify([profile,row.round_id,row.owner_hash,row.create_hash,row.create_digest,row.created_at,row.expires_at,row.revision,row.state_json]));
  storage.prepare('UPDATE round_rounds SET state_json=?,state_mac=? WHERE round_id=?').run(row.state_json,row.state_mac,s.roundId);
  const initial=ledger.get(owner,{roundId:s.roundId});if(initial.kind!=='round-snapshot')throw new Error('fixture-initial');return initial.snapshot;
}
function specialRound(ledger:RoundLedger,path:string){
  const initial=seededRound(ledger,path),snapshot=apply(ledger,command(ledger,initial,{command:{type:'swap',a:{row:3,col:5},b:{row:4,col:5}}})).snapshot,at={row:3,col:2};
  expect(snapshot.state.board[at.row][at.col].special).toBe('row');return {snapshot,at};
}
afterEach(async()=>{
  vi.restoreAllMocks();await Promise.all(workers.splice(0).map(w=>w.terminate()));
  dbs.splice(0).forEach(d=>{try{d.exec('ROLLBACK');}catch{}d.close();});ledgers.splice(0).forEach(l=>l.close());
  dirs.splice(0).forEach(p=>{const root=join(tmpdir(),'pawblossom-round-');if(!p.startsWith(root))throw new Error('unsafe-cleanup');rmSync(p,{recursive:true,force:true});});
});
describe('서버 영구 회차·멱등 명령 원장',()=>{
  it('서버 난수 ID/초기 상태·인증 소유자별 생성·중복은 현재 snapshot',()=>{
    const {ledger,path}=open(),s=start(ledger);expect(s.roundId).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(s.revision).toBe(0);expect(s.state).toMatchObject({moves:26,score:0,status:'active',shuffles:1});
    const newer=apply(ledger,command(ledger,s)).snapshot;
    expect(ledger.start(owner,{requestId:'start-1',levelId:4})).toEqual({kind:'round-started',created:false,snapshot:newer});
    expect(ledger.start(owner,{requestId:'start-1',levelId:5})).toEqual(denied('request-conflict'));
    const other=start(ledger,{requestId:'start-1',levelId:4},{ownerId:'different-owner'});expect(other.roundId).not.toBe(s.roundId);
    expect(db(path).prepare('SELECT count(*) AS n FROM round_rounds').get()?.n).toBe(2);
  });
  it('생성 요청과 회차가 다르면 같은 opID도 독립',()=>{
    const {ledger}=open(),a=start(ledger),b=start(ledger,{requestId:'start-2',levelId:4});
    expect(a.roundId).not.toBe(b.roundId);expect(a.state.board).not.toEqual(b.state.board);
    expect(apply(ledger,command(ledger,a)).applied).toBe(true);expect(apply(ledger,command(ledger,b)).applied).toBe(true);
  });
  it('타인/없는 회차 모두 not-found·owner 추가 필드로 소유자 변경 불가',()=>{
    const {ledger}=open(),s=start(ledger),r=command(ledger,s),other={ownerId:'different-owner'};
    expect(ledger.get(other,{roundId:s.roundId})).toEqual(denied('not-found'));expect(ledger.command(other,r)).toEqual(denied('not-found'));
    expect(ledger.get(owner,{roundId:'A'.repeat(43)})).toEqual(denied('not-found'));
    expect(ledger.command(owner,{...r,ownerId:owner.ownerId} as any)).toEqual(denied('invalid-input'));
  });
  it('같은 명령 ID/내용은 1회 적용·다른 명령/revision은 충돌·현재 상태 반환',()=>{
    const {ledger,path}=open(),s=start(ledger),r=command(ledger,s),first=apply(ledger,r),second=apply(ledger,command(ledger,first.snapshot));
    expect(apply(ledger,r)).toEqual({kind:'command-result',applied:false,outcome:first.outcome,snapshot:second.snapshot});
    expect(ledger.command(owner,{...r,expectedRevision:1})).toEqual(denied('request-conflict'));
    expect(ledger.command(owner,{...r,command:{type:'abandon'}})).toEqual(denied('request-conflict'));
    expect(ledger.command(owner,{...r,operationId:'other'})).toEqual(denied('revision-conflict'));
    expect(db(path).prepare('SELECT count(*) AS n FROM round_ops').get()?.n).toBe(2);
  });
  it('불성립 교환도 영구 영수증/revision 기록·이동/보드/RNG 유지',()=>{
    const {ledger,path}=open(),s=start(ledger),r=command(ledger,s,{command:invalid(s)}),first=apply(ledger,r);
    expect(first.outcome).toBe('invalid-swap');expect(first.snapshot.state).toEqual(s.state);expect(first.snapshot.revision).toBe(1);
    const newer=apply(ledger,command(ledger,first.snapshot)).snapshot;expect(apply(ledger,r).snapshot).toEqual(newer);expect(apply(ledger,r).applied).toBe(false);
    expect(db(path).prepare('SELECT outcome FROM round_ops WHERE revision=1').get()?.outcome).toBe('invalid-swap');
  });
  it('실제 교환으로 만든 특수 탭·기준 엔진 결과·파일 재시작/오래된 중복의 현재 snapshot',async()=>{
    const {ledger,path}=open(),{snapshot:s,at}=specialRound(ledger,path),storage=db(path),internal=JSON.parse(String(storage.prepare('SELECT state_json FROM round_rounds').get()?.state_json)),r=command(ledger,s,{command:{type:'activate',at}}),reference=advanceState(internal,r.command),actual=apply(ledger,r);
    expect(actual.outcome).toBe('valid-activation');expect(actual.snapshot.state).toEqual(publicState(reference.state));expect(actual.snapshot.state.moves).toBe(s.state.moves-1);expect(actual.snapshot.revision).toBe(s.revision+1);
    expect(JSON.parse(String(storage.prepare('SELECT state_json FROM round_rounds').get()?.state_json)).rngState).toBe(reference.state.rngState);
    const newer=apply(ledger,command(ledger,actual.snapshot,{command:{type:'shuffle'}})).snapshot;
    expect(apply(ledger,r)).toEqual({kind:'command-result',applied:false,outcome:'valid-activation',snapshot:newer});
    expect(ledger.command(owner,{...r,command:{type:'activate',at:{row:0,col:0}}})).toEqual(denied('request-conflict'));
    close(ledger);expect(await child(data(path,'command',r))).toEqual({kind:'command-result',applied:false,outcome:'valid-activation',snapshot:newer});
    expect(open(path).ledger.get(owner,{roundId:s.roundId})).toEqual({kind:'round-snapshot',snapshot:newer});
  });
  it('일반 타일 탭은 영수증/revision만 저장하고 보드/이동/RNG 불변·중복 재적용 없음',()=>{
    const {ledger,path}=open(),s=start(ledger),storage=db(path),before=storage.prepare('SELECT state_json FROM round_rounds').get()?.state_json,r=command(ledger,s,{command:{type:'activate',at:{row:0,col:0}}}),actual=apply(ledger,r);
    expect(actual).toMatchObject({outcome:'invalid-activation',applied:true,snapshot:{revision:1,state:s.state}});expect(storage.prepare('SELECT state_json FROM round_rounds').get()?.state_json).toBe(before);
    const newer=apply(ledger,command(ledger,actual.snapshot)).snapshot;expect(apply(ledger,r)).toEqual({kind:'command-result',applied:false,outcome:'invalid-activation',snapshot:newer});
    expect(storage.prepare('SELECT outcome FROM round_ops WHERE revision=1').get()?.outcome).toBe('invalid-activation');
  });
  it('8worker 동일 특수 탭은 정확히 1회만 차감·영수증 적용',async()=>{
    const {ledger,path}=open(),{snapshot:s,at}=specialRound(ledger,path),r=command(ledger,s,{command:{type:'activate',at}});close(ledger);
    const results=await concurrent(Array.from({length:8},()=>data(path,'command',r)));
    expect(results).toEqual(Array.from({length:8},()=>expect.objectContaining({kind:'command-result',outcome:'valid-activation'})));expect(results.filter(r=>r.applied).length).toBe(1);
    expect(results.every(r=>r.snapshot.revision===s.revision+1&&r.snapshot.state.moves===s.state.moves-1)).toBe(true);
    expect(db(path).prepare('SELECT count(*) AS n FROM round_ops').get()?.n).toBe(2);expect(open(path).ledger.get(owner,{roundId:s.roundId}).kind).toBe('round-snapshot');
  });
  it('특수 탭과 유효 교환이 같은 revision에서 경쟁하면 한 명령만 적용',async()=>{
    const {ledger,path}=open(),{snapshot:s,at}=specialRound(ledger,path),activation=command(ledger,s,{operationId:'activation-race',command:{type:'activate',at}}),swap=command(ledger,s,{operationId:'swap-race'});close(ledger);
    const results=await concurrent([data(path,'command',activation),data(path,'command',swap)]);
    expect(results.filter(r=>r.kind==='command-result'&&r.applied).length).toBe(1);expect(results.filter(r=>r.code==='revision-conflict').length).toBe(1);
    const current=open(path).ledger.get(owner,{roundId:s.roundId});expect(current).toMatchObject({kind:'round-snapshot',snapshot:{revision:s.revision+1,state:{moves:s.state.moves-1}}});
  });
  it.each(['valid-activation','invalid-activation'])('서명된 %s 영수증도 실제 차감 수와 다르면 닫음',outcome=>{
    const {ledger,path}=open(),setup=outcome==='valid-activation'?{snapshot:start(ledger),at:{row:0,col:0}}:specialRound(ledger,path),r=command(ledger,setup.snapshot,{command:{type:'activate',at:setup.at}}),actual=apply(ledger,r),storage=db(path),receipt:any=storage.prepare('SELECT * FROM round_ops WHERE revision=?').get(actual.snapshot.revision),profile=storage.prepare('SELECT profile FROM round_meta').get()?.profile;
    expect(actual.outcome).not.toBe(outcome);receipt.outcome=outcome;
    receipt.receipt_mac=mac('receipt',JSON.stringify([profile,receipt.round_id,receipt.op_hash,receipt.request_digest,receipt.revision,receipt.outcome]));
    storage.prepare('UPDATE round_ops SET outcome=?,receipt_mac=? WHERE revision=?').run(outcome,receipt.receipt_mac,receipt.revision);
    expect(ledger.get(owner,{roundId:setup.snapshot.roundId})).toEqual(unavailable);
  });
  it('특수 탭 추가필드/좌표/getter는 영수증을 만들지 않고 거절',()=>{
    const {ledger,path}=open(),s=start(ledger),getter=vi.fn();
    for(const c of [{type:'activate',at:{row:0,col:0},score:99},{type:'activate',at:{row:8,col:0}},{type:'activate',at:{row:0,col:0,owner:'x'}},{type:'activate',get at(){getter();throw new Error('private');}}])expect(ledger.command(owner,command(ledger,s,{command:c as any}))).toEqual(denied('invalid-input'));
    expect(getter).not.toHaveBeenCalled();expect(db(path).prepare('SELECT count(*) AS n FROM round_ops').get()?.n).toBe(0);
  });
  it('파일 reopen·별도 프로세스·RNG 정확 연속/중복 명령',async()=>{
    const {ledger,path}=open(),s=start(ledger),r=command(ledger,s),first=apply(ledger,r),d=db(path),raw:any=d.prepare('SELECT state_json FROM round_rounds').get();
    const internal:RoundState=JSON.parse(raw.state_json),nextRequest=command(ledger,first.snapshot),reference=advanceState(internal,nextRequest.command);
    close(ledger);const restarted=await child(data(path,'command',nextRequest));expect(restarted.kind).toBe('command-result');expect(restarted.snapshot.state).toEqual(publicState(reference.state));
    const replay=await child(data(path,'command',r));expect(replay).toMatchObject({kind:'command-result',applied:false,snapshot:restarted.snapshot});
    const read=open(path).ledger;expect(read.get(owner,{roundId:s.roundId})).toEqual({kind:'round-snapshot',snapshot:restarted.snapshot});
    expect(JSON.parse(String(d.prepare('SELECT state_json FROM round_rounds').get()?.state_json)).rngState).toBe(reference.state.rngState);
  });
  it('8worker 동시 생성 중복은 생성 1회·owner+requestID 영구 공유',async()=>{
    const {ledger,path}=open();close(ledger);const outputs=await concurrent(Array.from({length:8},()=>data(path,'start',{requestId:'concurrent',levelId:30})));
    expect(outputs.every(r=>r.kind==='round-started')).toBe(true);expect(outputs.filter(r=>r.created).length).toBe(1);expect(new Set(outputs.map(r=>r.snapshot.roundId)).size).toBe(1);
    expect(db(path).prepare('SELECT count(*) AS n FROM round_rounds').get()?.n).toBe(1);
  });
  it('8worker 동일 명령은 1회 적용·같은 현재 revision',async()=>{
    const {ledger,path}=open(),s=start(ledger),r=command(ledger,s);close(ledger);
    const outputs=await concurrent(Array.from({length:8},()=>data(path,'command',r)));
    expect(outputs.every(r=>r.kind==='command-result')).toBe(true);expect(outputs.filter(r=>r.applied).length).toBe(1);
    expect(outputs.every(r=>r.snapshot.revision===1&&r.snapshot.state.moves===s.state.moves-1)).toBe(true);
    expect(db(path).prepare('SELECT count(*) AS n FROM round_ops').get()?.n).toBe(1);
  });
  it('8worker 다른 명령이 같은 revision에서 경쟁하면 1회만 적용',async()=>{
    const {ledger,path}=open(),s=start(ledger),r=command(ledger,s);close(ledger);
    const outputs=await concurrent(Array.from({length:8},(_,n)=>data(path,'command',{...r,operationId:'compete-'+n,command:n%2?{type:'shuffle'}:r.command})));
    expect(outputs.filter(r=>r.kind==='command-result'&&r.applied).length).toBe(1);expect(outputs.filter(r=>r.code==='revision-conflict').length).toBe(7);
    const stored=db(path).prepare('SELECT revision FROM round_rounds').get();expect(stored?.revision).toBe(1);
  });
  it('셔플 1회·moves 유지·중복은 한도 뒤에도 반환·terminal 후 조작 차단',()=>{
    const {ledger}=open(),s=start(ledger),r=command(ledger,s,{command:{type:'shuffle'}}),shuffled=apply(ledger,r);
    expect(shuffled.snapshot.state.moves).toBe(s.state.moves);expect(shuffled.snapshot.state.shuffles).toBe(0);
    expect(ledger.command(owner,command(ledger,shuffled.snapshot,{command:{type:'shuffle'}}))).toEqual(denied('shuffle-used'));
    const end=apply(ledger,command(ledger,shuffled.snapshot,{command:{type:'abandon'}}));expect(end.snapshot.state.status).toBe('abandoned');
    expect(ledger.command(owner,command(ledger,end.snapshot))).toEqual(denied('round-terminal'));
    expect(apply(ledger,r).snapshot).toEqual(end.snapshot);expect(apply(ledger,r).applied).toBe(false);
  });
  it('고정 seed 합성 초기 상태로 파일 원장의 won/failed/failed→abandon을 확정 검증',()=>{
    const {ledger,path}=open();let won=0,failed=0;
    for(let n=0;n<2;n++){
      let s=seededRound(ledger,path,n===0?1:30,'game-'+n);
      while(s.state.status==='active')s=apply(ledger,command(ledger,s)).snapshot;
      expect(s.state.status).toBe(n===0?'won':'failed');
      expect(ledger.command(owner,command(ledger,s))).toEqual(denied('round-terminal'));
      expect(ledger.command(owner,command(ledger,s,{command:{type:'activate',at:{row:0,col:0}}}))).toEqual(denied('round-terminal'));
      if(s.state.status==='won')won++;else{failed++;expect(ledger.get(owner,{roundId:s.roundId})).toEqual({kind:'round-snapshot',snapshot:s});const abandoned=apply(ledger,command(ledger,s,{command:{type:'abandon'}})).snapshot;expect(abandoned.state.status).toBe('abandoned');}
    }
    expect(won).toBe(1);expect(failed).toBe(1);
  });
  it('snapshot 전체 깊은 복제/동결·caller 키 변경 뒤에도 저장 상태 유지',()=>{
    const inputKey=new Uint8Array(key),{ledger}=open(undefined,{serverKey:inputKey});inputKey.fill(0);
    const s=start(ledger);expect(Object.isFrozen(s)).toBe(true);expect(Object.isFrozen(s.state.board[0][0])).toBe(true);expect(Object.isFrozen(s.state.level.leaves?.[0])).toBe(true);
    expect(()=>{(s.state.collected as any)[0]=99;}).toThrow();const read=ledger.get(owner,{roundId:s.roundId});expect(read).toEqual({kind:'round-snapshot',snapshot:s});if(read.kind==='round-snapshot')expect(read.snapshot.state.board).not.toBe(s.state.board);
  });
  it.each([undefined,null,{},[],{requestId:'x',levelId:0},{requestId:'x',levelId:31},{requestId:'x',levelId:1.1},{requestId:'',levelId:1},{requestId:'x'.repeat(129),levelId:1},{requestId:'x y',levelId:1},{requestId:'x',levelId:1,score:99},{requestId:'x',levelId:1,board:[]},{requestId:'x',levelId:1,rng:42},{requestId:'x',levelId:1,owner:'x'}])('생성 입력 엄격 검사 %j',r=>{const {ledger}=open();expect(ledger.start(owner,r as any)).toEqual(denied('invalid-input'));});
  it.each([null,{},[],{ownerId:''},{ownerId:'x y'},{ownerId:'x\n'},{ownerId:'x'.repeat(257)},{ownerId:'x',roundId:'x'}])('신뢰 context 구조 검사 %j',context=>{const {ledger}=open();expect(ledger.start(context as any,{requestId:'x',levelId:1})).toEqual(denied('invalid-input'));});
  it.each(['round','op','revision','command','score','board','rng','owner','coordinate'])('명령 %s의 잘못된 입력 거절',mode=>{
    const {ledger}=open(),s=start(ledger),r:any=command(ledger,s);
    if(mode==='round')r.roundId='bad';if(mode==='op')r.operationId='\n';if(mode==='revision')r.expectedRevision=NaN;
    if(mode==='command')r.command={type:'activate'};if(['score','board','rng','owner'].includes(mode))r[mode]=1;
    if(mode==='coordinate')r.command.a={row:0,col:0,owner:'x'};
    expect(ledger.command(owner,r)).toEqual(denied('invalid-input'));expect(ledger.get(owner,{roundId:s.roundId})).toEqual({kind:'round-snapshot',snapshot:s});
  });
  it('getter/toJSON/symbol/상속/Proxy 예외를 읽지 않고 고정 결과 반환',()=>{
    const {ledger}=open(),s=start(ledger),getter=vi.fn(()=> 'secret'),r=command(ledger,s);
    expect(ledger.start(owner,{get requestId(){return getter();},levelId:1})).toEqual(denied('invalid-input'));
    expect(ledger.get({get ownerId(){return getter();}},{roundId:s.roundId})).toEqual(denied('invalid-input'));
    expect(ledger.command(owner,{...r,command:{get type(){return getter();}}} as any)).toEqual(denied('invalid-input'));
    for(const input of [{requestId:'x',levelId:1,[Symbol()]:1},Object.assign(Object.create({}),{requestId:'x',levelId:1}),new Proxy({},{ownKeys(){throw new Error('private');}})])expect(ledger.start(owner,input as any)).toEqual(denied('invalid-input'));
    expect(getter).not.toHaveBeenCalled();
  });
  it('행수는 회차+명령 합계·종료 포함·기존 중복은 상한에서도 조회',()=>{
    const {ledger,path}=open(undefined,{maxRows:3}),a=start(ledger),b=start(ledger,{requestId:'b',levelId:1});
    const r=command(ledger,a,{command:{type:'abandon'}}),end=apply(ledger,r);expect(end.snapshot.state.status).toBe('abandoned');
    expect(ledger.start(owner,{requestId:'c',levelId:1})).toEqual(denied('capacity'));expect(ledger.command(owner,command(ledger,b))).toEqual(denied('capacity'));
    expect(apply(ledger,r).applied).toBe(false);expect(ledger.start(owner,{requestId:'start-1',levelId:4})).toMatchObject({kind:'round-started',created:false});
    expect(db(path).prepare('SELECT (SELECT count(*) FROM round_rounds)+(SELECT count(*) FROM round_ops) AS n').get()?.n).toBe(3);
  });
  it('명령 한도는 불성립 교환/포기도 포함·재시도에는 현재 상태 응답',()=>{
    const {ledger}=open(undefined,{maxOperations:1}),s=start(ledger),r=command(ledger,s,{command:invalid(s)}),result=apply(ledger,r);
    expect(ledger.command(owner,command(ledger,result.snapshot,{command:{type:'abandon'}}))).toEqual(denied('operation-limit'));expect(apply(ledger,r).applied).toBe(false);
  });
  it('만료 경계·재시작·중복에도 만료 뒤 상태 반환 차단',()=>{
    const {ledger,path,setNow}=open(undefined,{ttlMs:1000}),s=start(ledger),r=command(ledger,s);apply(ledger,r);setNow(epoch+1000);
    expect(ledger.get(owner,{roundId:s.roundId})).toEqual(denied('expired'));expect(ledger.command(owner,r)).toEqual(denied('expired'));expect(ledger.start(owner,{requestId:'start-1',levelId:4})).toEqual(denied('expired'));
    close(ledger);expect(open(path,{ttlMs:1000,now:()=>epoch+1000}).ledger.get(owner,{roundId:s.roundId})).toEqual(denied('expired'));
  });
  it.each([NaN,-1,1.1,Number.MAX_SAFE_INTEGER,999999999999,10_000_000_000_000])('비정상 시계 %s에서 생성/조작 차단',time=>{const {ledger}=open(undefined,{now:()=>time});expect(ledger.start(owner,{requestId:'x',levelId:1})).toEqual(denied('invalid-time'));});
  it('high-water는 다른 인스턴스/프로세스/재시작에도 시계 후퇴 거절',async()=>{
    const {ledger,path,setNow}=open(),s=start(ledger);setNow(epoch+1);expect(ledger.get(owner,{roundId:s.roundId}).kind).toBe('round-snapshot');
    const other=open(path).ledger;expect(other.get(owner,{roundId:s.roundId})).toEqual(denied('invalid-time'));close(ledger);close(other);
    expect(await child(data(path,'get',{roundId:s.roundId}))).toEqual(denied('invalid-time'));
    expect(open(path,{now:()=>epoch+1}).ledger.get(owner,{roundId:s.roundId}).kind).toBe('round-snapshot');
  });
  it.each([1000,3_600_000,86_400_000])('시계 상한에서 TTL %s의 생성/만료 시각은 같은 인스턴스와 재시작에 일치',ttlMs=>{
    const upper=9_999_999_999_999-ttlMs,{ledger,path}=open(undefined,{ttlMs,now:()=>upper}),s=start(ledger);
    expect(s.expiresAt).toBe(9_999_999_999_999);expect(ledger.get(owner,{roundId:s.roundId}).kind).toBe('round-snapshot');
    close(ledger);expect(open(path,{ttlMs,now:()=>upper}).ledger.get(owner,{roundId:s.roundId}).kind).toBe('round-snapshot');
    expect(open(undefined,{ttlMs,now:()=>upper+1}).ledger.start(owner,{requestId:'x',levelId:1})).toEqual(denied('invalid-time'));
  });
  it('선택형 인증 성공 context는 서버 내부 ownerId projection 후에만 전달',async()=>{
    const auth=new PlayFabSessionAuthenticator({titleId:'1A2B3',environment:'test',bindingDomain:'pawblossom-round-test',bindingKey:new Uint8Array(32).fill(53),getSecretKey:async()=> 'synthetic-secret'},
      async()=>new Response(JSON.stringify({code:200,status:'OK',data:{IsSessionTicketExpired:false,UserInfo:{PlayFabId:'0123456789ABCDEF'}}}),{headers:{'content-type':'application/json'}}));
    try{
      const authenticated=await auth.authenticate({sessionTicket:'synthetic-ticket'});expect(authenticated.kind).toBe('authenticated');if(authenticated.kind!=='authenticated')throw new Error('fixture-auth');
      const {ledger}=open();expect(ledger.start(authenticated.context,{requestId:'x',levelId:1})).toEqual(denied('invalid-input'));
      const internalOwner={ownerId:authenticated.context.ownerId},s=start(ledger,{requestId:'x',levelId:1},internalOwner);
      expect(ledger.get(internalOwner,{roundId:s.roundId})).toEqual({kind:'round-snapshot',snapshot:s});
      expect(ledger.get(owner,{roundId:s.roundId})).toEqual(denied('not-found'));
    }finally{auth.close();}
  });
  it('COMMIT 잠금 오류는 상태/영수증/시계 전체 rollback 후 같은 인스턴스로 재시도',()=>{
    const {ledger,path,setNow}=open(),s=start(ledger),r=command(ledger,s),d=db(path),before=d.prepare('SELECT * FROM round_meta').get();
    d.exec('BEGIN');d.prepare('SELECT * FROM round_rounds').all();setNow(epoch+1);
    expect(ledger.command(owner,r)).toEqual(unavailable);
    d.exec('ROLLBACK');expect(d.prepare('SELECT revision FROM round_rounds').get()?.revision).toBe(0);expect(d.prepare('SELECT count(*) AS n FROM round_ops').get()?.n).toBe(0);expect(d.prepare('SELECT * FROM round_meta').get()).toEqual(before);
    expect(apply(ledger,r).applied).toBe(true);expect(apply(ledger,r).applied).toBe(false);
  });
  it('BEGIN 잠금 오류는 실패 결과를 반환하고 잠금 해제 뒤 동일 인스턴스 재시도',()=>{
    const {ledger,path}=open(),s=start(ledger),d=db(path);d.exec('BEGIN IMMEDIATE');
    expect(ledger.get(owner,{roundId:s.roundId})).toEqual(unavailable);d.exec('ROLLBACK');expect(ledger.start(owner,{requestId:'start-1',levelId:4})).toMatchObject({kind:'round-started',created:false});
    expect(open(path).ledger.get(owner,{roundId:s.roundId}).kind).toBe('round-snapshot');
  });
  it('close 반복과 모든 API 차단·시계 예외는 비공개 저장 오류',()=>{
    const {ledger}=open(),s=start(ledger),r=command(ledger,s);ledger.close();ledger.close();expect(ledger.get(owner,{roundId:s.roundId})).toEqual(unavailable);expect(ledger.command(owner,r)).toEqual(unavailable);expect(ledger.start(owner,{requestId:'x',levelId:1})).toEqual(unavailable);
    expect(open(undefined,{now:()=>{throw new Error('secret-clock');}}).ledger.start(owner,{requestId:'x',levelId:1})).toEqual(unavailable);
  });
  it.each(['key','environment','rows','operations','ttl','profile','engine','content','schema','unique','meta','extra','trigger','otherdb'])('metadata/schema %s 변경은 reopen 거절',mode=>{
    const {ledger,path}=open();start(ledger);close(ledger);const d=db(path);let patch:Partial<RoundLedgerOptions>={};
    if(mode==='key')patch={serverKey:new Uint8Array(32).fill(68)};if(mode==='environment')patch={environment:'production'};if(mode==='rows')patch={maxRows:999};if(mode==='operations')patch={maxOperations:128};if(mode==='ttl')patch={ttlMs:1000};
    if(['profile','engine','content'].includes(mode)){const m:any=d.prepare('SELECT * FROM round_meta').get(),p=JSON.parse(m.profile);p[mode==='profile'?'version':mode]=999;d.prepare('UPDATE round_meta SET profile=?').run(JSON.stringify(p));}
    if(mode==='schema')d.exec('ALTER TABLE round_rounds ADD COLUMN extra TEXT');if(mode==='unique')d.exec('DROP TABLE round_ops; CREATE TABLE round_ops(round_id TEXT,op_hash TEXT,request_digest TEXT,revision INTEGER,outcome TEXT,receipt_mac TEXT) STRICT');
    if(mode==='meta')d.exec('DELETE FROM round_meta');if(mode==='extra'||mode==='otherdb')d.exec('CREATE TABLE unknown_meta(id INTEGER)');if(mode==='trigger')d.exec('CREATE TRIGGER unexpected AFTER INSERT ON round_ops BEGIN SELECT 1; END');
    expect(()=>open(path,patch)).toThrow('round-ledger-open-failed');
  });
  it.each(['state','owner','request','digest','revision','expires','mac','opdigest','opmac','missingop','injectedop','meta','clock','schema'])('실행 중 DB %s 변조는 고정 storageerror·이후닫힘',mode=>{
    const {ledger,path}=open(),s=start(ledger),first=apply(ledger,command(ledger,s)),d=db(path);
    if(mode==='state')d.prepare('UPDATE round_rounds SET state_json=?').run('{}');if(mode==='owner')d.prepare('UPDATE round_rounds SET owner_hash=?').run('a'.repeat(64));
    if(mode==='request')d.prepare('UPDATE round_rounds SET create_hash=?').run('a'.repeat(64));if(mode==='digest')d.prepare('UPDATE round_rounds SET create_digest=?').run('a'.repeat(64));if(mode==='revision')d.exec('UPDATE round_rounds SET revision=2');
    if(mode==='expires')d.exec('UPDATE round_rounds SET expires_at=expires_at+1');if(mode==='mac')d.prepare('UPDATE round_rounds SET state_mac=?').run('a'.repeat(64));
    if(mode==='opdigest')d.prepare('UPDATE round_ops SET request_digest=?').run('a'.repeat(64));if(mode==='opmac')d.prepare('UPDATE round_ops SET receipt_mac=?').run('a'.repeat(64));
    if(mode==='missingop')d.exec('DELETE FROM round_ops');if(mode==='injectedop')d.prepare('INSERT INTO round_ops VALUES(?,?,?,?,?,?)').run(s.roundId,'a'.repeat(64),'b'.repeat(64),2,'invalid-swap','c'.repeat(64));
    if(mode==='meta')d.prepare('UPDATE round_meta SET meta_mac=?').run('a'.repeat(64));if(mode==='clock')d.exec('UPDATE round_meta SET high_water=0');if(mode==='schema')d.exec('ALTER TABLE round_rounds ADD COLUMN extra TEXT');
    expect(ledger.get(owner,{roundId:s.roundId})).toEqual(unavailable);expect(ledger.command(owner,command(ledger,first.snapshot))).toEqual(unavailable);
  });
  it.each(['tile','leaf','status','collected','level','moves','jsonduplicate','jsonspace','opscount'])('유효 HMAC이 있어도 구조/불변 조건 %s 오류는 닫힘',mode=>{
    const {ledger,path}=open(),s=start(ledger),d=db(path);
    if(['jsonduplicate','jsonspace'].includes(mode)){
      const row:any=d.prepare('SELECT * FROM round_rounds').get();row.state_json=mode==='jsonspace'?' '+row.state_json:row.state_json.replace('"score":0','"score":1,"score":0');
      const profile=d.prepare('SELECT profile FROM round_meta').get()?.profile;
      row.state_mac=mac('state',JSON.stringify([profile,row.round_id,row.owner_hash,row.create_hash,row.create_digest,row.created_at,row.expires_at,row.revision,row.state_json]));d.prepare('UPDATE round_rounds SET state_json=?,state_mac=?').run(row.state_json,row.state_mac);
    }else signRow(d,state=>{if(mode==='tile')state.board[0][0].kind=6;if(mode==='leaf')state.leaves[0][0]=2;if(mode==='status')state.status='won';if(mode==='collected')state.collected[0]=-1;if(mode==='level')state.level.moves=100;if(mode==='moves')state.moves--;if(mode==='opscount')state.shuffles=0;});
    expect(ledger.get(owner,{roundId:s.roundId})).toEqual(unavailable);
  });
  it('서명되지않은중복영수증주입으로appliedfalse위조불가',()=>{
    const {ledger,path}=open(),s=start(ledger),r=command(ledger,s),d=db(path),opHash=mac('operation',JSON.stringify([s.roundId,r.operationId]));
    const digest=createHash('sha256').update(JSON.stringify([s.roundId,r.operationId,r.expectedRevision,r.command])).digest('hex');
    d.prepare('INSERT INTO round_ops VALUES(?,?,?,?,?,?)').run(s.roundId,opHash,digest,1,'valid-swap','0'.repeat(64));expect(ledger.command(owner,r)).toEqual(unavailable);
  });
  it.each(['empty','with-command','row-resigned'])('동일 master 키여도 test→production 행/영수증 이식 %s 거절',mode=>{
    const source=open(),target=open(undefined,{environment:'production'}),s=start(source.ledger);
    if(mode!=='empty')apply(source.ledger,command(source.ledger,s));
    close(source.ledger);close(target.ledger);const from=db(source.path),to=db(target.path),row:any=from.prepare('SELECT * FROM round_rounds').get();
    if(mode==='row-resigned'){
      // 행만 대상 profile로 재서명해 영수증 자체도 profile에 묶였는지 독립 확인합니다.
      const profile=to.prepare('SELECT profile FROM round_meta').get()?.profile;
      row.state_mac=mac('state',JSON.stringify([profile,row.round_id,row.owner_hash,row.create_hash,row.create_digest,row.created_at,row.expires_at,row.revision,row.state_json]));
    }
    to.prepare('INSERT INTO round_rounds VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(row) as any);
    for(const receipt of from.prepare('SELECT * FROM round_ops').all())to.prepare('INSERT INTO round_ops VALUES(?,?,?,?,?,?)').run(...Object.values(receipt) as any);
    expect(()=>open(target.path,{environment:'production'})).toThrow('round-ledger-open-failed');
    expect(open(source.path).ledger.get(owner,{roundId:s.roundId}).kind).toBe('round-snapshot');
  });
  it('DB/응답/log에원본owner/request/opID/key없음·응답에seed/RNG없음',()=>{
    const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')],{ledger,path}=open(),s=start(ledger,{requestId:'private-start-request',levelId:4}),r=command(ledger,s,{operationId:'private-operation'}),result=apply(ledger,r);
    const text=JSON.stringify(result);expect(text).not.toMatch(/rngState|seed|owner|serverKey/);close(ledger);
    const bytes=readdirSync(join(path,'..')).map(f=>readFileSync(join(path,'..',f)));
    for(const secret of [owner.ownerId,'private-start-request','private-operation',Buffer.from(key).toString('hex')]){expect(text).not.toContain(secret);bytes.forEach(v=>expect(v.includes(Buffer.from(secret))).toBe(false));}
    logs.forEach(l=>expect(l).not.toHaveBeenCalled());
  });
  it.each([{databasePath:'relative.sqlite'},{databasePath:'C:/no.txt'},{serverKey:new Uint8Array(31)},{environment:'bad'},{now:1},{maxRows:0},{maxRows:10001},{maxOperations:0},{maxOperations:129},{ttlMs:999},{ttlMs:86400001},{maxRows:NaN},{maxRows:1.1},{maxOperations:null}])('잘못된 구성 %j는 고정 오류',patch=>expect(()=>open(undefined,patch as any)).toThrow('invalid-round-config'));
  it('config getter/extra필드거절·constructor실패/close가caller키를지우지않음',()=>{
    const getter=vi.fn();expect(()=>new RoundLedger({get databasePath(){getter();throw new Error('private');}} as any)).toThrow('invalid-round-config');expect(getter).not.toHaveBeenCalled();
    expect(()=>open(undefined,{extra:1} as any)).toThrow('invalid-round-config');const inputKey=new Uint8Array(key);expect(()=>open(undefined,{serverKey:inputKey,maxRows:0})).toThrow('invalid-round-config');expect(inputKey).toEqual(key);
    const {ledger}=open(undefined,{serverKey:inputKey});close(ledger);expect(inputKey).toEqual(key);
  });
});
