import type { Language } from './i18n';
import { LEVEL_COUNT, levels, type Level } from './levels';
import { BoardEngine, type BoardSnapshot, type Tile, type Special } from './core';
export interface RoundCheckpoint extends BoardSnapshot {
  schema: 1; levelId: number; levelSignature: string; moves: number; score: number;
  collected: number[]; shuffles: number; clearedLeaves: number;
}
export interface SaveData { version: 1; language: Language; highestLevel: number; completed: number[]; stars: number; coins: number; garden: number; music: boolean; sfx: boolean; tutorialSeen: boolean; inProgress?: RoundCheckpoint; }
export const SAVE_KEY = 'pawblossom.save.v1';
export const BACKUP_KEY = `${SAVE_KEY}.backup`;
export const RESET_KEY = `${SAVE_KEY}.reset`;
const defaults = (): SaveData => ({version:1, language:'ko', highestLevel:1, completed:[], stars:0, coins:0, garden:0, music:true, sfx:true, tutorialSeen:false});
const safeNumber = (x: unknown, fallback: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : fallback;
// 기존 ID·목표·이동 수·고정 낙엽 구성이 달라진 저장은 복원하지 않습니다.
export function levelSignature(level:Level):string {
  return JSON.stringify([level.id,level.moves,level.goals.map(g=>[g.kind,g.count]),(level.leaves??[]).map(p=>[p.row,p.col,p.layers])]);
}
const integer=(x:unknown,max:number):x is number=>typeof x==='number'&&Number.isInteger(x)&&x>=0&&x<=max;
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
const grid=(x:unknown):x is unknown[][]=>Array.isArray(x)&&x.length===8&&x.every(row=>Array.isArray(row)&&row.length===8);
/** 작은 고정 크기만 순회하며 진행 중 회차가 손상돼도 영구 기록은 보존합니다. */
export function validateCheckpoint(value:unknown,highestLevel:number):RoundCheckpoint|undefined {
  if(!record(value)||value.schema!==1||!integer(value.levelId,LEVEL_COUNT)||value.levelId<1||value.levelId>highestLevel)return;
  const level=levels[value.levelId-1];
  if(value.levelSignature!==levelSignature(level)||!integer(value.moves,level.moves)||value.moves<1||!integer(value.score,100_000_000)||!integer(value.shuffles,1))return;
  if(!Array.isArray(value.collected)||value.collected.length!==6||!value.collected.every(n=>integer(n,1_000_000)))return;
  if(!grid(value.board)||!grid(value.leaves))return;
  const board:Tile[][]=[];
  const leafMax=Array.from({length:8},()=>Array(8).fill(0));
  for(const pile of level.leaves??[])leafMax[pile.row][pile.col]=pile.layers;
  let remaining=0;
  for(let row=0;row<8;row++){
    board[row]=[];
    for(let col=0;col<8;col++){
      const tile=value.board[row][col],layers=value.leaves[row][col];
      if(!record(tile)||!integer(tile.kind,5)||(tile.special!==undefined&&!['row','column','bomb','rainbow'].includes(tile.special as string)))return;
      board[row][col]={kind:tile.kind,...(tile.special!==undefined?{special:tile.special as Special}:{})};
      if(!integer(layers,leafMax[row][col]))return;
      if(layers>0)remaining++;
    }
  }
  const total=level.leaves?.length??0;
  if(value.clearedLeaves!==total-remaining||level.goals.every(g=>(value.collected as number[])[g.kind]>=g.count)&&remaining===0)return;
  const leaves=(value.leaves as number[][]).map(row=>row.slice());
  // 초기 생성 없이 조회하므로 실제 게임의 보충 난수를 소비하지 않습니다.
  const engine=new BoardEngine(8,8,()=>{throw Error('저장 검증 중 난수 사용');},{board,leaves});
  if(engine.findMatches().length||!engine.hasMoves())return;
  return {schema:1,levelId:level.id,levelSignature:levelSignature(level),board,leaves,moves:value.moves,score:value.score,
    collected:value.collected.slice() as number[],shuffles:value.shuffles,clearedLeaves:total-remaining};
}
/** 구형 v1의 선택 필드는 정규화하되, 영구 기록의 필수 구조는 추측하지 않습니다. */
function normalizeSave(x:unknown,backup=false):SaveData|undefined {
    if(!record(x)||x.version!==1||!Array.isArray(x.completed)||x.completed.length>LEVEL_COUNT*4||
      !integer(x.highestLevel,LEVEL_COUNT)||x.highestLevel<1||!integer(x.stars,LEVEL_COUNT)||!integer(x.coins,1_000_000)||!integer(x.garden,5))return;
    if((x.language!==undefined&&x.language!=='ko'&&x.language!=='en')||
      ['music','sfx','tutorialSeen'].some(k=>x[k]!==undefined&&typeof x[k]!=='boolean'))return;
    if(backup&&(x.language===undefined||['music','sfx','tutorialSeen'].some(k=>typeof x[k]!=='boolean')))return;
    const completed:number[]=Array.isArray(x.completed)? [...new Set<number>(x.completed.slice(0,LEVEL_COUNT*4).filter((n: unknown): n is number => typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=LEVEL_COUNT))]:[];
    // 기존 마지막 스테이지까지 완료한 저장도 새 콘텐츠의 첫 미완료 스테이지로 이어집니다.
    let frontier=1;while(frontier<LEVEL_COUNT&&completed.includes(frontier))frontier++;
    const highestLevel=Math.max(frontier,safeNumber(x.highestLevel,1,LEVEL_COUNT));
    const inProgress=validateCheckpoint(x.inProgress,highestLevel);
    if(backup&&(completed.length!==x.completed.length||!x.completed.every(n=>integer(n,LEVEL_COUNT)&&n>=1)||(x.inProgress!==undefined&&!inProgress)))return;
    return {version:1,language:x.language==='en'?'en':'ko', highestLevel,completed,
      stars:safeNumber(x.stars,0,LEVEL_COUNT), coins:safeNumber(x.coins,0,1000000), garden:safeNumber(x.garden,0,5),
      music:x.music!==false,sfx:x.sfx!==false,tutorialSeen:typeof x.tutorialSeen==='boolean'?x.tutorialSeen:completed.length>0,...(inProgress?{inProgress}:{})};
}
type LoadState='new'|'loaded'|'recovered'|'corrupt'|'unsupported'|'read-error'|'conflict';
type WriteState='idle'|'saved'|'blocked'|'failed'|'backup-failed'|'reset-failed';
export interface SaveStatus { load:LoadState; write:WriteState; resetPending:boolean; }
type StorageAccess=()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>;
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
  private blocked=true;
  private state:SaveStatus={load:'new',write:'idle',resetPending:false};
  constructor(private readonly access:StorageAccess=()=>localStorage){}
  get status():SaveStatus{return {...this.state};}
  load():SaveData {
    this.baseline=undefined;this.blocked=true;this.state={load:'new',write:'idle',resetPending:false};
    try {
      const storage=this.access();
      // 초기화 의도가 먼저 영속화됩니다. 중간 종료/실패 뒤 과거 primary·backup을 복원하지 않습니다.
      const marker=storage.getItem(RESET_KEY);
      if(marker!==null){
        if(marker!=='1'){this.state.load='unsupported';return defaults();}
        this.blocked=false;this.state.resetPending=true;return defaults();
      }
      const primary=decode(storage.getItem(SAVE_KEY));
      if(primary.kind==='valid'){
        this.baseline=JSON.stringify(primary.data);
        // 정상 primary로 플레이하더라도 읽지 못한/미래 형식 사본을 자동 교체하지 않습니다.
        try{
          if(decode(storage.getItem(BACKUP_KEY),true).kind==='unsupported'){this.state.load='unsupported';return primary.data;}
        }catch{this.state.load='read-error';return primary.data;}
        this.blocked=false;this.state.load='loaded';return primary.data;
      }
      // 미래 형식의 primary는 구형 backup으로 롤백하지 않습니다.
      if(primary.kind==='unsupported'){this.state.load='unsupported';return defaults();}
      const backup=decode(storage.getItem(BACKUP_KEY),true);
      if(backup.kind==='valid'){this.baseline=JSON.stringify(backup.data);this.blocked=false;this.state.load='recovered';return backup.data;}
      if(backup.kind==='unsupported'){this.state.load='unsupported';return defaults();}
      if(primary.kind==='missing'&&backup.kind==='missing'){this.blocked=false;return defaults();}
      this.state.load='corrupt';return defaults();
    }catch{this.state.load='read-error';return defaults();}
  }
  save(data:SaveData):boolean {
    if(this.blocked){this.state.write='blocked';return false;}
    const valid=normalizeSave(data,true);
    if(!valid){this.state.write='failed';return false;}
    const raw=JSON.stringify(valid);
    try {
      const storage=this.access();
      // 실패하면 primary를 건드리지 않습니다. baseline은 성공한 쓰기/검증한 로드에서만 갱신합니다.
      try{storage.setItem(BACKUP_KEY,this.state.resetPending?raw:(this.baseline??raw));}
      catch{this.state.write='backup-failed';return false;}
      storage.setItem(SAVE_KEY,raw);
      if(this.state.resetPending)storage.removeItem(RESET_KEY);
      this.baseline=raw;this.state.resetPending=false;this.state.write='saved';return true;
    }catch{this.state.write='failed';return false;}
  }
  retry(data:SaveData):boolean {
    if(this.blocked){
      // 재검증은 디스크를 덮지 않으며, 반환된 옛 진행을 현재 메모리에 대입하지 않습니다.
      const known=this.baseline;
      this.load();
      // 재검증만 한 기록을 현재 메모리의 출발점으로 승격하지 않습니다.
      if(this.blocked){this.baseline=known;this.state.write='blocked';return false;}
      if((this.state.load==='loaded'||this.state.load==='recovered')&&(known===undefined||known!==this.baseline)){
        this.baseline=known;this.blocked=true;this.state.load='conflict';this.state.write='blocked';return false;
      }
    }
    return this.save(data);
  }
  reset():SaveData|undefined {
    try{this.access().setItem(RESET_KEY,'1');}
    catch{this.state.write='reset-failed';return;}
    const data=defaults();this.baseline=undefined;this.blocked=false;
    this.state={load:'new',write:'idle',resetPending:true};
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
export { levels, LEVEL_COUNT, chapters, chapterForLevel } from './levels';
