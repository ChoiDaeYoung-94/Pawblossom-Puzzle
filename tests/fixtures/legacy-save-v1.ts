/** Frozen v1 app at60de8a8;only relative imports rebased for old-writer compatibility tests. */
import type { Language } from '../../src/i18n';
import { LEVEL_COUNT, levels, type Level } from '../../src/levels';
import { BoardEngine, type BoardSnapshot, type Cell, type Special } from '../../src/core';
import { validatePip, type PipCare } from '../../src/pipCare';
import { validateGardenDesign, type GardenDesign } from '../../src/gardenDesign';
export interface RoundCheckpoint extends BoardSnapshot {
  schema: 1; levelId: number; levelSignature: string; moves: number; score: number;
  collected: number[]; shuffles: number; clearedLeaves: number;
  paidShuffleUsed?:boolean; continueUsed?:boolean;
  clearedCrates?:number;
}
export interface SaveData { version: 1; language: Language; highestLevel: number; completed: number[]; stars: number; coins: number; garden: number; music: boolean; sfx: boolean; tutorialSeen: boolean; pip?:PipCare; gardenDesign?:GardenDesign; inProgress?: RoundCheckpoint; }
export const SAVE_KEY = 'pawblossom.save.v1';
export const BACKUP_KEY = `${SAVE_KEY}.backup`;
export const RESET_KEY = `${SAVE_KEY}.reset`;
const defaults = (): SaveData => ({version:1, language:'ko', highestLevel:1, completed:[], stars:0, coins:0, garden:0, music:true, sfx:true, tutorialSeen:false});
const safeNumber = (x: unknown, fallback: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : fallback;
// 기존 ID·목표·이동 수·고정 낙엽 구성이 달라진 저장은 복원하지 않습니다.
export function levelSignature(level:Level):string {
  const parts:unknown[]=[level.id,level.moves,level.goals.map(g=>[g.kind,g.count]),(level.leaves??[]).map(p=>[p.row,p.col,p.layers])];
  if(level.mask)parts.push(level.mask); // mask 없는 기존 서명은 바이트 그대로 보존합니다.
  if(level.crates)parts.push(level.crates.map(p=>[p.row,p.col]));
  return JSON.stringify(parts);
}
const integer=(x:unknown,max:number):x is number=>typeof x==='number'&&Number.isInteger(x)&&x>=0&&x<=max;
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
const grid=(x:unknown):x is unknown[][]=>Array.isArray(x)&&x.length===8&&x.every(row=>Array.isArray(row)&&row.length===8);
/** 작은 고정 크기만 순회하며 진행 중 회차가 손상돼도 영구 기록은 보존합니다. */
export function validateCheckpoint(value:unknown,highestLevel:number):RoundCheckpoint|undefined {
  if(!record(value)||value.schema!==1||!integer(value.levelId,LEVEL_COUNT)||value.levelId<1||value.levelId>highestLevel)return;
  const ruleVersion=value.ruleVersion===undefined?1:value.ruleVersion;
  if(ruleVersion!==1&&ruleVersion!==2)return;
  const level=levels[value.levelId-1];
  if((level.mask||level.crates)&&ruleVersion!==2)return;
  if(value.levelSignature!==levelSignature(level)||!integer(value.moves,level.moves)||value.moves<1||!integer(value.score,100_000_000)||!integer(value.shuffles,1))return;
  if(['paidShuffleUsed','continueUsed'].some(key=>value[key]!==undefined&&typeof value[key]!=='boolean')
    ||value.paidShuffleUsed===true&&value.shuffles!==0||value.continueUsed===true&&value.moves>5)return;
  if(!Array.isArray(value.collected)||value.collected.length!==6||!value.collected.every(n=>integer(n,1_000_000)))return;
  if(!grid(value.board)||!grid(value.leaves))return;
  const crateTotal=level.crates?.length??0;
  if(crateTotal?(!grid(value.crates)||!integer(value.clearedCrates,crateTotal)):(value.crates!==undefined||value.clearedCrates!==undefined))return;
  const crates=crateTotal?(value.crates as number[][]).map(row=>row.slice()):undefined;
  let remainingCrates=0;
  const board:Cell[][]=[];
  const leafMax=Array.from({length:8},()=>Array(8).fill(0));
  for(const pile of level.leaves??[])leafMax[pile.row][pile.col]=pile.layers;
  let remaining=0;
  for(let row=0;row<8;row++){
    board[row]=[];
    for(let col=0;col<8;col++){
      const tile=value.board[row][col],layers=value.leaves[row][col];
      const crate=crates?crates[row][col]:0;
      if(!integer(crate,1)||crate===1&&!level.crates?.some(p=>p.row===row&&p.col===col))return;
      if(level.mask?.[row][col]===false||crate){if(tile!==null||layers!==0)return;board[row][col]=null;remainingCrates+=crate;continue;}
      if(!record(tile)||!integer(tile.kind,5)||(tile.special!==undefined&&!['row','column','bomb','rainbow'].includes(tile.special as string)))return;
      board[row][col]={kind:tile.kind,...(tile.special!==undefined?{special:tile.special as Special}:{})};
      if(!integer(layers,leafMax[row][col]))return;
      if(layers>0)remaining++;
    }
  }
  const total=level.leaves?.length??0;
  if(crateTotal&&value.clearedCrates!==crateTotal-remainingCrates)return;
  if(value.clearedLeaves!==total-remaining||level.goals.every(g=>(value.collected as number[])[g.kind]>=g.count)&&remaining===0&&remainingCrates===0)return;
  const leaves=(value.leaves as number[][]).map(row=>row.slice());
  // 초기 생성 없이 조회하므로 실제 게임의 보충 난수를 소비하지 않습니다.
  const engine=new BoardEngine(8,8,()=>{throw Error('저장 검증 중 난수 사용');},{board,leaves,ruleVersion,...(crates?{crates}:{})},undefined,level.mask,level.crates);
  if(engine.findMatches().length||!engine.hasMoves())return;
  return {schema:1,...(value.ruleVersion===undefined?{}:{ruleVersion}),levelId:level.id,levelSignature:levelSignature(level),board,leaves,moves:value.moves,score:value.score,
    collected:value.collected.slice() as number[],shuffles:value.shuffles,clearedLeaves:total-remaining,...(crates?{crates,clearedCrates:crateTotal-remainingCrates}:{}),
    ...(value.paidShuffleUsed===undefined?{}:{paidShuffleUsed:value.paidShuffleUsed as boolean}),...(value.continueUsed===undefined?{}:{continueUsed:value.continueUsed as boolean})};
}
/** 구형 v1의 선택 필드는 정규화하되, 영구 기록의 필수 구조는 추측하지 않습니다. */
function normalizeSave(x:unknown,backup=false):SaveData|undefined {
    if(!record(x)||x.version!==1||!Array.isArray(x.completed)||x.completed.length>LEVEL_COUNT*4||
      !integer(x.highestLevel,LEVEL_COUNT)||x.highestLevel<1||!integer(x.stars,LEVEL_COUNT)||!integer(x.coins,1_000_000)||!integer(x.garden,5))return;
    if((x.language!==undefined&&x.language!=='ko'&&x.language!=='en')||
      ['music','sfx','tutorialSeen'].some(k=>x[k]!==undefined&&typeof x[k]!=='boolean'))return;
    if(backup&&(x.language===undefined||['music','sfx','tutorialSeen'].some(k=>typeof x[k]!=='boolean')))return;
    // 구형 저장은 핍 필드 없이 그대로 보존합니다. 첫 육성 때 기본 상태에서 확장합니다.
    const pip=x.pip===undefined?undefined:validatePip(x.pip);
    if(x.pip!==undefined&&!pip)return;
    const completed:number[]=Array.isArray(x.completed)? [...new Set<number>(x.completed.slice(0,LEVEL_COUNT*4).filter((n: unknown): n is number => typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=LEVEL_COUNT))]:[];
    const gardenDesign=x.gardenDesign===undefined?undefined:validateGardenDesign(x.gardenDesign,x.garden,pip??{growth:0,affection:0},completed.length);
    if(x.gardenDesign!==undefined&&!gardenDesign)return;
    // 기존 마지막 스테이지까지 완료한 저장도 새 콘텐츠의 첫 미완료 스테이지로 이어집니다.
    let frontier=1;while(frontier<LEVEL_COUNT&&completed.includes(frontier))frontier++;
    const highestLevel=Math.max(frontier,safeNumber(x.highestLevel,1,LEVEL_COUNT));
    const inProgress=validateCheckpoint(x.inProgress,highestLevel);
    if(backup&&(completed.length!==x.completed.length||!x.completed.every(n=>integer(n,LEVEL_COUNT)&&n>=1)||(x.inProgress!==undefined&&!inProgress)))return;
    return {version:1,language:x.language==='en'?'en':'ko', highestLevel,completed,
      stars:safeNumber(x.stars,0,LEVEL_COUNT), coins:safeNumber(x.coins,0,1000000), garden:safeNumber(x.garden,0,5),
      music:x.music!==false,sfx:x.sfx!==false,tutorialSeen:typeof x.tutorialSeen==='boolean'?x.tutorialSeen:completed.length>0,...(pip?{pip}:{}),...(gardenDesign?{gardenDesign}:{}),...(inProgress?{inProgress}:{})};
}
type LoadState='new'|'loaded'|'recovered'|'corrupt'|'unsupported'|'read-error'|'conflict';
type WriteState='idle'|'saved'|'blocked'|'failed'|'backup-failed'|'reset-failed';
export interface SaveStatus { load:LoadState; write:WriteState; resetPending:boolean; }
type StorageAccess=()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const sourceKeys=[RESET_KEY,SAVE_KEY,BACKUP_KEY] as const;
type Source=Partial<Record<typeof sourceKeys[number],string|null>>;
type Decoded={kind:'valid';data:SaveData}|{kind:'missing'|'corrupt'|'unsupported'};
function decode(raw:string|null,backup=false):Decoded {
  if(raw===null)return {kind:'missing'};
  try {
    const value:unknown=JSON.parse(raw);
    if(record(value)&&value.version!==undefined&&value.version!==1)return {kind:'unsupported'};
    const data=normalizeSave(value,backup);return data?{kind:'valid',data}:{kind:'corrupt'};
  }catch{return {kind:'corrupt'};}
}
/** localStorage의 여러 키는 원자적이지 않습니다. 백업을 확보한 뒤에만 primary를 교체합니다. */
export class SaveStore {
  private baseline?:string;
  // 정규화한 백업과 원문 관찰값은 다릅니다. undefined는 읽지 못함, null은 실제 부재입니다.
  private source:Source={};
  private memoryKnown=false;
  private blocked=true;
  private state:SaveStatus={load:'new',write:'idle',resetPending:false};
  constructor(private readonly access:StorageAccess=()=>localStorage){}
  get status():SaveStatus{return {...this.state};}
  private read(storage:ReturnType<StorageAccess>,key:typeof sourceKeys[number]):string|null {
    const raw=storage.getItem(key);this.source[key]=raw;return raw;
  }
  private conflict():false {
    this.blocked=true;this.state.load='conflict';this.state.write='blocked';return false;
  }
  load():SaveData {
    this.baseline=undefined;this.source={};this.memoryKnown=false;this.blocked=true;this.state={load:'new',write:'idle',resetPending:false};
    try {
      const storage=this.access();
      // 초기화 의도가 먼저 영속화됩니다. 중간 종료/실패 뒤 과거 primary·backup을 복원하지 않습니다.
      const marker=this.read(storage,RESET_KEY);
      if(marker!==null){
        if(marker!=='1'){this.state.load='unsupported';return defaults();}
        this.memoryKnown=true;this.state.resetPending=true;
        // 초기화 대상의 옛 payload도 원문으로 관찰해 이후 외부 변경과 구분합니다.
        this.read(storage,SAVE_KEY);this.read(storage,BACKUP_KEY);
        this.blocked=false;return defaults();
      }
      const primary=decode(this.read(storage,SAVE_KEY));
      if(primary.kind==='valid'){
        this.baseline=JSON.stringify(primary.data);this.memoryKnown=true;
        // 정상 primary로 플레이하더라도 읽지 못한/미래 형식 사본을 자동 교체하지 않습니다.
        try{
          if(decode(this.read(storage,BACKUP_KEY),true).kind==='unsupported'){this.state.load='unsupported';return primary.data;}
        }catch{this.state.load='read-error';return primary.data;}
        this.blocked=false;this.state.load='loaded';return primary.data;
      }
      // 미래 형식의 primary는 구형 backup으로 롤백하지 않습니다.
      if(primary.kind==='unsupported'){this.state.load='unsupported';return defaults();}
      const backup=decode(this.read(storage,BACKUP_KEY),true);
      if(backup.kind==='valid'){this.baseline=JSON.stringify(backup.data);this.memoryKnown=true;this.blocked=false;this.state.load='recovered';return backup.data;}
      if(backup.kind==='unsupported'){this.state.load='unsupported';return defaults();}
      if(primary.kind==='missing'&&backup.kind==='missing'){this.memoryKnown=true;this.blocked=false;return defaults();}
      this.state.load='corrupt';return defaults();
    }catch{this.state.load='read-error';return defaults();}
  }
  save(data:SaveData):boolean {
    if(this.blocked){this.state.write='blocked';return false;}
    const valid=normalizeSave(data,true);
    if(!valid){this.state.write='failed';return false;}
    const raw=JSON.stringify(valid);
    let storage:ReturnType<StorageAccess>;
    try {
      storage=this.access();
      // 저장 전에 이미 달라진 원문을 감지합니다. 비교→쓰기 사이 경쟁이나 ABA는 막지 못합니다.
      for(const key of sourceKeys)if(storage.getItem(key)!==this.source[key])return this.conflict();
    }catch{this.blocked=true;this.state.load='read-error';this.state.write='blocked';return false;}
    try {
      // 실패하면 primary를 건드리지 않습니다. baseline은 성공한 쓰기/검증한 로드에서만 갱신합니다.
      const backup=this.state.resetPending?raw:(this.baseline??raw);
      try{storage.setItem(BACKUP_KEY,backup);this.source[BACKUP_KEY]=backup;}
      catch{this.state.write='backup-failed';return false;}
      storage.setItem(SAVE_KEY,raw);
      this.source[SAVE_KEY]=raw;
      if(this.state.resetPending){storage.removeItem(RESET_KEY);this.source[RESET_KEY]=null;}
      this.baseline=raw;this.state.resetPending=false;this.state.write='saved';return true;
    }catch{this.state.write='failed';return false;}
  }
  retry(data:SaveData):boolean {
    // 확정된 충돌은 재시도나 외부 삭제로 해제하지 않습니다. 명시 load/reset만 허용합니다.
    if(this.state.load==='conflict'){this.state.write='blocked';return false;}
    if(this.blocked){
      // 재검증은 디스크를 덮지 않으며, 반환된 옛 진행을 현재 메모리에 대입하지 않습니다.
      const probe=new SaveStore(this.access);probe.load();
      for(const key of sourceKeys)if(this.source[key]!==undefined&&probe.source[key]!==undefined&&this.source[key]!==probe.source[key])return this.conflict();
      if(probe.blocked){this.state.load=probe.state.load;this.state.write='blocked';return false;}
      // 읽지 못했던 외부 진행/초기화 의도를 현재 메모리의 출발점으로 승격하지 않습니다.
      if(!this.memoryKnown&&(probe.state.load!=='new'||probe.state.resetPending))return this.conflict();
      this.source={...probe.source};this.memoryKnown=true;this.blocked=false;
      this.state.load=probe.state.load;this.state.resetPending=probe.state.resetPending;
    }
    return this.save(data);
  }
  reset():SaveData|undefined {
    let storage:ReturnType<StorageAccess>;
    try{storage=this.access();storage.setItem(RESET_KEY,'1');}
    catch{this.state.write='reset-failed';return;}
    const data=defaults();this.baseline=undefined;this.source={[RESET_KEY]:'1'};this.memoryKnown=true;this.blocked=false;
    this.state={load:'new',write:'idle',resetPending:true};
    try{this.read(storage,SAVE_KEY);this.read(storage,BACKUP_KEY);}
    catch{this.blocked=true;this.state.load='read-error';}
    // 다음 회차 checkpoint가 한 번만 기록합니다. marker만 있어도 과거 사본은 부활하지 않습니다.
    return data;
  }
}
const store=new SaveStore();
export function loadSave():SaveData{return store.load();}
export function saveData(data:SaveData):boolean{return store.save(data);}
export function retrySave(data:SaveData):boolean{return store.retry(data);}
export function saveStatus():SaveStatus{return store.status;}
export function clearSave():SaveData|undefined{return store.reset();}
export { levels, LEVEL_COUNT, chapters, chapterForLevel } from '../../src/levels';
