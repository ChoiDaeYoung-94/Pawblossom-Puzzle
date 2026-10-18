import {describe,it,expect} from 'vitest';
import {SaveStore,SAVE_KEY,BACKUP_KEY,RESET_KEY,levelSignature,type SaveData} from '../src/state';
import {levels} from '../src/levels';
import {BoardEngine,seededRng} from '../src/core';

function fixture():SaveData {
  const level=levels[5],engine=new BoardEngine(8,8,seededRng(42));engine.setLeaves(level.leaves??[]);
  return {version:1,language:'en',highestLevel:6,completed:[1,2,3,4,5],stars:3,coins:200,garden:1,music:false,sfx:true,tutorialSeen:true,
    inProgress:{schema:1,levelId:6,levelSignature:levelSignature(level),board:engine.board,leaves:engine.leaves,moves:24,score:120,collected:[1,2,3,4,5,6],shuffles:0,clearedLeaves:0}};
}
function disk(primary:string|null=JSON.stringify(fixture()),backup?:string){
  const values=new Map<string,string>();if(primary!==null)values.set(SAVE_KEY,primary);if(backup!==undefined)values.set(BACKUP_KEY,backup);
  const calls:string[]=[];let failRead='',failWrite='',failRemove=false;
  const storage={getItem:(key:string)=>{if(failRead===key||failRead==='*')throw Error('read');return values.get(key)??null;},
    setItem:(key:string,value:string)=>{calls.push(key);if(failWrite===key||failWrite==='*')throw Error('write');values.set(key,value);},
    removeItem:(key:string)=>{if(failRemove)throw Error('remove');values.delete(key);}};
  return {values,calls,store:()=>new SaveStore(()=>storage),read:(key:string)=>JSON.parse(values.get(key)??'null'),
    failRead:(key:string)=>{failRead=key;},failWrite:(key:string)=>{failWrite=key;},failRemove:(value:boolean)=>{failRemove=value;}};
}
describe('검증한 로컬 저장 복구와 보호',()=>{
  it('정상 로드한 두 실행 중 최신 진행을 오래된 설정 저장으로 덮지 않습니다',()=>{
    const d=disk(),a=d.store(),b=d.store(),latest=a.load(),stale=b.load();
    latest.completed.push(6);latest.highestLevel=7;latest.coins+=80;delete latest.inProgress;expect(a.save(latest)).toBe(true);
    const before=[...d.values],calls=d.calls.length;stale.language='ko';
    expect(b.save(stale)).toBe(false);expect(b.status).toMatchObject({load:'conflict',write:'blocked'});
    expect([...d.values]).toEqual(before);expect(d.calls).toHaveLength(calls);expect(stale.coins).toBe(200);expect(stale.language).toBe('ko');
    expect(b.retry(stale)).toBe(false);expect([...d.values]).toEqual(before);
    const reloaded=b.load();expect(reloaded).toEqual(latest);reloaded.language='ko';expect(b.save(reloaded)).toBe(true);
  });
  it.each([false,true])('다른 실행의 초기화 완료=%s 뒤 오래된 진행과 회차를 저장하지 않습니다',complete=>{
    const d=disk(),a=d.store(),b=d.store();a.load();const stale=b.load(),reset=a.reset()!;
    if(complete)expect(a.save(reset)).toBe(true);
    const before=[...d.values],calls=d.calls.length;expect(b.save(stale)).toBe(false);expect(b.status.load).toBe('conflict');
    expect(b.retry(stale)).toBe(false);expect([...d.values]).toEqual(before);expect(d.calls).toHaveLength(calls);
    expect(d.store().load().coins).toBe(0);expect(d.store().load().inProgress).toBeUndefined();
  });
  const externalChanges=[
    ['삭제',null],['미래 형식','{"version":2}'],['손상','{'],['정상 진행',JSON.stringify({...fixture(),coins:280})],
    ['동일 의미의 다른 원문',JSON.stringify(fixture(),null,2)],
  ] as const;
  it.each([SAVE_KEY,BACKUP_KEY].flatMap(key=>externalChanges.map(([name,raw])=>[key,name,raw] as const)))('%s 외부 %s 변경은 무쓰기 충돌입니다',(key,_name,raw)=>{
    const d=disk(JSON.stringify(fixture()),JSON.stringify(fixture())),s=d.store(),memory=s.load();memory.coins+=40;
    if(raw===null)d.values.delete(key);else d.values.set(key,raw);
    const before=[...d.values];expect(s.save(memory)).toBe(false);expect(s.status.load).toBe('conflict');
    expect(s.retry(memory)).toBe(false);expect([...d.values]).toEqual(before);expect(d.calls).toEqual([]);expect(memory.coins).toBe(240);
  });
  it.each(['1','2',''])('외부 reset marker %s를 제거하거나 기록을 덮지 않습니다',marker=>{
    const d=disk(),s=d.store(),memory=s.load();d.values.set(RESET_KEY,marker);const before=[...d.values];
    expect(s.save(memory)).toBe(false);expect(s.retry(memory)).toBe(false);expect(s.status.load).toBe('conflict');
    expect([...d.values]).toEqual(before);expect(d.calls).toEqual([]);
  });
  it.each(['복원','전체 삭제'] as const)('충돌 발견 후 외부 %s와 반복 재시도는 보호를 해제하지 않습니다',change=>{
    const d=disk(),s=d.store(),memory=s.load(),original=d.values.get(SAVE_KEY)!;
    d.values.set(BACKUP_KEY,JSON.stringify({...fixture(),coins:280}));expect(s.save(memory)).toBe(false);
    d.values.clear();if(change==='복원')d.values.set(SAVE_KEY,original);
    const before=[...d.values];for(let n=0;n<3;n++){expect(s.retry(memory)).toBe(false);expect(s.save(memory)).toBe(false);}
    expect(s.status.load).toBe('conflict');expect([...d.values]).toEqual(before);expect(d.calls).toEqual([]);
  });
  it('충돌 이후 사용자가 명시한 초기화만 새 저장 의도를 만듭니다',()=>{
    const d=disk(),s=d.store(),stale=s.load();d.values.set(SAVE_KEY,JSON.stringify({...fixture(),coins:280}));
    expect(s.save(stale)).toBe(false);const reset=s.reset()!;reset.coins=40;expect(s.retry(reset)).toBe(true);
    expect(d.store().load()).toEqual(reset);expect(d.read(BACKUP_KEY)).toEqual(reset);expect(d.values.has(RESET_KEY)).toBe(false);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('첫 실행 뒤 외부 %s가 생겨도 오래된 기본 진행을 덮지 않습니다',key=>{
    const d=disk(null),s=d.store(),memory=s.load();memory.coins=40;d.values.set(key,JSON.stringify(fixture()));
    const before=[...d.values];expect(s.save(memory)).toBe(false);expect(s.retry(memory)).toBe(false);expect([...d.values]).toEqual(before);expect(d.calls).toEqual([]);
  });
  it.each([RESET_KEY,SAVE_KEY,BACKUP_KEY])('저장 직전 %s 읽기 실패 뒤 최신 메모리를 유지하며 재시도합니다',key=>{
    const d=disk(),s=d.store(),memory=s.load();memory.coins+=40;d.failRead(key);
    expect(s.save(memory)).toBe(false);expect(s.status.load).toBe('read-error');expect(d.calls).toEqual([]);
    memory.coins+=40;d.failRead('');expect(s.retry(memory)).toBe(true);expect(d.read(SAVE_KEY).coins).toBe(280);
  });
  it.each([SAVE_KEY,BACKUP_KEY,RESET_KEY])('읽기 회복 중 외부 %s 변경을 메모리 기준으로 승격하지 않습니다',key=>{
    const d=disk(),s=d.store(),memory=s.load();d.failRead('*');expect(s.save(memory)).toBe(false);
    d.values.set(key,key===RESET_KEY?'1':JSON.stringify({...fixture(),coins:280}));d.failRead('');const before=[...d.values];
    expect(s.retry(memory)).toBe(false);expect(s.retry(memory)).toBe(false);expect(s.status.load).toBe('conflict');expect([...d.values]).toEqual(before);expect(d.calls).toEqual([]);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('본인 부분 쓰기 후 외부 %s 변경도 보호합니다',key=>{
    const d=disk(),s=d.store(),memory=s.load();memory.coins+=40;d.failWrite(SAVE_KEY);expect(s.save(memory)).toBe(false);
    d.failWrite('');d.values.set(key,JSON.stringify({...fixture(),coins:280}));const before=[...d.values],calls=d.calls.length;
    expect(s.retry(memory)).toBe(false);expect(s.status.load).toBe('conflict');expect([...d.values]).toEqual(before);expect(d.calls).toHaveLength(calls);
  });
  it('첫 primary 실패로 본인이 만든 사본은 외부 진행으로 오판하지 않습니다',()=>{
    const d=disk(null),s=d.store(),memory=s.load();memory.coins=40;d.failWrite(SAVE_KEY);expect(s.save(memory)).toBe(false);
    d.failRead(SAVE_KEY);expect(s.save(memory)).toBe(false);d.failRead('');d.failWrite('');memory.coins=80;
    expect(s.retry(memory)).toBe(true);expect(d.read(SAVE_KEY).coins).toBe(80);expect(d.read(BACKUP_KEY).coins).toBe(80);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('marker1 로드 중 %s 읽기 실패 뒤 초기화 진행으로 재시도합니다',key=>{
    const d=disk();d.values.set(RESET_KEY,'1');d.failRead(key);const s=d.store(),memory=s.load();
    expect(memory.coins).toBe(0);expect(s.status).toMatchObject({load:'read-error',resetPending:true});memory.coins=40;
    expect(s.save(memory)).toBe(false);expect(d.calls).toEqual([]);d.failRead('');expect(s.retry(memory)).toBe(true);
    expect(d.read(SAVE_KEY).coins).toBe(40);expect(d.read(BACKUP_KEY).coins).toBe(40);expect(d.values.has(RESET_KEY)).toBe(false);
  });
  it.each([SAVE_KEY,BACKUP_KEY])('명시 초기화 후 %s 관찰 실패도 marker와 기본 메모리를 보존합니다',key=>{
    const d=disk(),s=d.store();s.load();d.failRead(key);const memory=s.reset()!;expect(memory.coins).toBe(0);
    expect(s.status).toMatchObject({load:'read-error',resetPending:true});expect(d.values.get(RESET_KEY)).toBe('1');
    d.failRead('');memory.coins=40;expect(s.retry(memory)).toBe(true);expect(d.store().load()).toEqual(memory);
  });
  it('marker 읽기부터 실패한 실행은 새로 발견한 초기화를 자기 메모리 기준으로 삼지 않습니다',()=>{
    const d=disk();d.values.set(RESET_KEY,'1');d.failRead(RESET_KEY);const s=d.store(),memory=s.load();memory.coins=40;d.failRead('');
    expect(s.retry(memory)).toBe(false);expect(s.status.load).toBe('conflict');expect(d.values.get(RESET_KEY)).toBe('1');expect(d.calls).toEqual([]);
  });
  it('marker 제거 실패와 다음 읽기 실패 뒤에도 본인 reset payload의 최신 메모리를 저장합니다',()=>{
    const d=disk(),s=d.store();s.load();const memory=s.reset()!;d.failRemove(true);expect(s.save(memory)).toBe(false);
    d.failRead(BACKUP_KEY);expect(s.save(memory)).toBe(false);d.failRead('');d.failRemove(false);memory.coins=40;
    expect(s.retry(memory)).toBe(true);expect(d.store().load()).toEqual(memory);expect(d.read(BACKUP_KEY)).toEqual(memory);
  });
  it('정상 primary가 backup보다 우선이고 로드만으로 디스크를 쓰지 않습니다',()=>{
    const old=fixture();old.coins=80;const d=disk(JSON.stringify(fixture()),JSON.stringify(old)),s=d.store();
    expect(s.load()).toEqual(fixture());expect(s.status.load).toBe('loaded');expect(d.calls).toEqual([]);
  });
  it('저장 없음과 손상·불완전 구조를 구분하고 임의 version:1은 승격하지 않습니다',()=>{
    const d=disk(null),s=d.store();expect(s.load().highestLevel).toBe(1);expect(s.status.load).toBe('new');
    for(const bad of ['{','{}','null','true','"text"','{"version":1}','{"version":1,"completed":[]}','[]']){
      const broken=disk(bad),store=broken.store(),data=store.load();expect(store.status.load).toBe('corrupt');
      expect(store.save(data)).toBe(false);expect(broken.values.get(SAVE_KEY)).toBe(bad);expect(broken.calls).toEqual([]);
    }
  });
  it('구형 primary의 선택 필드·완료 중복은 정규화하되 정상 사본은 완전한 구조만 허용합니다',()=>{
    const old={...fixture(),completed:[1,1,2],music:undefined,sfx:undefined,tutorialSeen:undefined};
    const d=disk(JSON.stringify(old)),s=d.store(),save=s.load();expect(save.completed).toEqual([1,2]);expect(save.tutorialSeen).toBe(true);
    expect(s.save(save)).toBe(true);expect(d.read(BACKUP_KEY)).toEqual(save);
    const broken=disk('{',JSON.stringify(old)),b=broken.store();b.load();expect(b.status.load).toBe('corrupt');
  });
  it.each(['{',null])('primary %s에서 정상 사본의 회차·보상·설정을 복구하고 재실행합니다',raw=>{
    const d=disk(raw,JSON.stringify(fixture())),s=d.store(),save=s.load();expect(save).toEqual(fixture());expect(s.status.load).toBe('recovered');
    expect(s.save(save)).toBe(true);expect(d.store().load()).toEqual(save);
  });
  it.each(['{"version":2}','{"version":999}'])('미래 primary %s는 구형 사본으로 롤백하지 않습니다',raw=>{
    const d=disk(raw,JSON.stringify(fixture())),s=d.store(),save=s.load();expect(s.status.load).toBe('unsupported');
    expect(s.retry(save)).toBe(false);expect(d.values.get(SAVE_KEY)).toBe(raw);expect(d.calls).toEqual([]);
  });
  it('미래 사본과 손상 사본도 기본값으로 덮지 않습니다',()=>{
    for(const raw of ['{"version":2}','{"version":1}',JSON.stringify({...fixture(),inProgress:{schema:1}})]){
      const d=disk('{',raw),s=d.store();expect(s.save(s.load())).toBe(false);expect(d.values.get(BACKUP_KEY)).toBe(raw);
    }
  });
  it('정상 primary를 읽어도 미래 backup은 보호하고 자동 쓰기를 차단합니다',()=>{
    const future='{"version":2,"progress":"future"}',d=disk(JSON.stringify(fixture()),future),s=d.store(),memory=s.load();
    expect(memory).toEqual(fixture());expect(s.status.load).toBe('unsupported');memory.coins+=40;
    expect(s.save(memory)).toBe(false);expect(s.retry(memory)).toBe(false);expect(d.calls).toEqual([]);expect(d.values.get(BACKUP_KEY)).toBe(future);
  });
  it('정상 primary 뒤 backup 읽기 실패는 원본에서 플레이하며 복구 뒤 최신 메모리를 저장합니다',()=>{
    const d=disk(),s=d.store();d.failRead(BACKUP_KEY);const memory=s.load();expect(memory).toEqual(fixture());expect(s.status.load).toBe('read-error');
    memory.coins+=40;expect(s.save(memory)).toBe(false);expect(d.calls).toEqual([]);d.failRead('');expect(s.retry(memory)).toBe(true);
    expect(d.read(SAVE_KEY).coins).toBe(240);expect(d.read(BACKUP_KEY)).toEqual(fixture());
  });
  it.each([RESET_KEY,SAVE_KEY,BACKUP_KEY])('%s 읽기 예외는 자동 쓰기를 차단합니다',key=>{
    const d=disk(key===BACKUP_KEY?'{':JSON.stringify(fixture()),JSON.stringify(fixture()));d.failRead(key);
    const s=d.store(),save=s.load();expect(s.status.load).toBe('read-error');expect(s.save(save)).toBe(false);expect(d.calls).toEqual([]);
  });
  it('최초 읽기만 실패했다가 원본이 보이면 메모리와 원본을 섞거나 덮지 않습니다',()=>{
    const d=disk();d.failRead('*');const s=d.store(),memory=s.load();memory.coins=40;memory.completed=[1];
    expect(s.save(memory)).toBe(false);d.failRead('');expect(s.retry(memory)).toBe(false);expect(s.status.load).toBe('conflict');
    expect(s.retry(memory)).toBe(false);expect(d.read(SAVE_KEY)).toEqual(fixture());expect(memory.coins).toBe(40);expect(d.calls).toEqual([]);
  });
  it('첫 실행 읽기 실패 후 실제 저장이 없으면 현재 메모리를 재시도합니다',()=>{
    const d=disk(null);d.failRead('*');const s=d.store(),memory=s.load();memory.coins=40;d.failRead('');
    expect(s.retry(memory)).toBe(true);expect(d.read(SAVE_KEY).coins).toBe(40);
  });
  it('primary→backup 순차 읽기 실패도 읽기만 한 원본을 메모리 출발점으로 승격하지 않습니다',()=>{
    const d=disk(),s=d.store();d.failRead(SAVE_KEY);const memory=s.load();memory.coins=40;
    d.failRead(BACKUP_KEY);expect(s.retry(memory)).toBe(false);expect(s.status.load).toBe('read-error');
    d.failRead('');expect(s.retry(memory)).toBe(false);expect(s.status.load).toBe('conflict');
    expect(s.retry(memory)).toBe(false);expect(d.calls).toEqual([]);expect(d.read(SAVE_KEY)).toEqual(fixture());expect(memory.coins).toBe(40);
  });
  it('backup 쓰기 실패는 primary와 기존 검증 사본을 유지하고 최신 메모리로 재시도합니다',()=>{
    const old=fixture(),d=disk(JSON.stringify(old),JSON.stringify(old)),s=d.store(),memory=s.load();memory.coins+=40;delete memory.inProgress;
    d.failWrite(BACKUP_KEY);expect(s.save(memory)).toBe(false);expect(s.status.write).toBe('backup-failed');
    expect(d.read(SAVE_KEY)).toEqual(old);expect(d.read(BACKUP_KEY)).toEqual(old);
    memory.coins+=40;d.failWrite('');expect(s.retry(memory)).toBe(true);expect(d.read(SAVE_KEY).coins).toBe(280);expect(d.read(BACKUP_KEY)).toEqual(old);
  });
  it('primary 쓰기 실패 후 연속 진행·보상 재시도는 과거 load로 롤백하지 않습니다',()=>{
    const d=disk(),s=d.store(),memory=s.load();d.failWrite(SAVE_KEY);memory.completed.push(6);memory.highestLevel=7;memory.coins+=40;memory.stars++;delete memory.inProgress;
    expect(s.save(memory)).toBe(false);expect(s.status.write).toBe('failed');expect(d.read(BACKUP_KEY)).toEqual(fixture());
    memory.garden++;memory.stars-=2;d.failWrite('');expect(s.retry(memory)).toBe(true);expect(d.store().load()).toEqual(memory);
    d.values.set(SAVE_KEY,'{');expect(d.store().load()).toEqual(fixture()); // 사본은 직전 정상 기록입니다.
  });
  it('초기화 의도 쓰기 실패는 메모리와 모든 디스크 기록을 유지합니다',()=>{
    const d=disk(JSON.stringify(fixture()),JSON.stringify(fixture())),s=d.store(),memory=s.load(),before=[...d.values];d.failWrite(RESET_KEY);
    expect(s.reset()).toBeUndefined();expect(s.status.write).toBe('reset-failed');expect([...d.values]).toEqual(before);expect(memory).toEqual(fixture());
  });
  it.each([BACKUP_KEY,SAVE_KEY])('초기화 후 %s 실패·종료에도 과거 기록을 부활시키지 않습니다',key=>{
    const d=disk(JSON.stringify(fixture()),JSON.stringify(fixture())),s=d.store();s.load();const reset=s.reset()!;d.failWrite(key);
    expect(s.save(reset)).toBe(false);expect(d.values.get(RESET_KEY)).toBe('1');const relaunched=d.store();expect(relaunched.load().coins).toBe(0);
    d.failWrite('');reset.coins=40;expect(s.retry(reset)).toBe(true);expect(d.values.has(RESET_KEY)).toBe(false);
    d.values.set(SAVE_KEY,'{');expect(d.store().load().coins).toBe(40);
  });
  it('초기화 marker 제거 실패도 재시도 전까지 초기화 의도를 유지합니다',()=>{
    const d=disk(),s=d.store();s.load();const reset=s.reset()!;d.failRemove(true);expect(s.save(reset)).toBe(false);
    expect(s.status.resetPending).toBe(true);expect(d.store().load().highestLevel).toBe(1);
    d.failRemove(false);expect(s.retry(reset)).toBe(true);expect(d.store().load().coins).toBe(0);
  });
  it('성공한 초기화 사본과 marker만 기록한 뒤 종료 모두 이전 회차를 복원하지 않습니다',()=>{
    const d=disk(),s=d.store();s.load();const reset=s.reset()!;expect(d.store().load().inProgress).toBeUndefined();
    expect(s.save(reset)).toBe(true);expect(d.read(BACKUP_KEY)).toEqual(reset);d.values.set(SAVE_KEY,'{');expect(d.store().load()).toEqual(reset);
  });
  it.each(['','0','2','{'])('손상·미지원 초기화 marker %s는 기록을 자동 파괴하지 않습니다',marker=>{
    const d=disk();d.values.set(RESET_KEY,marker);const s=d.store();expect(s.save(s.load())).toBe(false);expect(s.status.load).toBe('unsupported');expect(d.read(SAVE_KEY)).toEqual(fixture());
  });
  it('허용하지 않은 구매 권한/시험 필드는 영속화하지 않습니다',()=>{
    const d=disk(),s=d.store(),data=s.load();Object.assign(data,{entitlement:'owned',testingLevel:30});expect(s.save(data)).toBe(true);
    expect(d.read(SAVE_KEY)).not.toHaveProperty('entitlement');expect(d.read(SAVE_KEY)).not.toHaveProperty('testingLevel');
  });
});
