import {SaveStore,type SaveData} from './state';
import {LEVEL_COUNT} from './levels';
import {freshToolProgress} from './puzzleTools';

export const LAB_PREFIX='pawblossom.progress-lab.v1:';
type StorageAccess=()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>;

/** primary/backup/reset을 모두 별도 이름으로 매핑합니다. 정상 저장은 읽거나 쓰지 않습니다. */
export function createLabStore(access:StorageAccess=()=>localStorage):SaveStore {
  return new SaveStore(()=>({
    getItem:key=>access().getItem(LAB_PREFIX+key),
    setItem:(key,value)=>access().setItem(LAB_PREFIX+key,value),
    removeItem:key=>access().removeItem(LAB_PREFIX+key),
  }));
}

export function freshLabProgress(preferences:Pick<SaveData,'language'|'music'|'sfx'>):SaveData {
  return {version:2,puzzleTools:freshToolProgress(),language:preferences.language,music:preferences.music,sfx:preferences.sfx,highestLevel:1,completed:[],stars:0,coins:0,garden:0,tutorialSeen:true};
}

/** 시험 전용 합성 진행입니다. 이미 완료한 판의 보상과 소비 내역을 되돌리지 않습니다. */
export function completeLabThrough(source:SaveData,level:number):{save:SaveData;added:number[]} {
  if(!Number.isInteger(level)||level<1||level>LEVEL_COUNT)throw new RangeError('Invalid lab level');
  const next:SaveData=JSON.parse(JSON.stringify(source)),completed=new Set(next.completed),added:number[]=[];
  for(let id=1;id<=level;id++)if(!completed.has(id)){completed.add(id);added.push(id);}
  next.completed=[...completed].sort((a,b)=>a-b);
  next.highestLevel=Math.min(LEVEL_COUNT,Math.max(next.highestLevel,level+1));
  next.stars=Math.min(LEVEL_COUNT,next.stars+added.length);
  next.coins=Math.min(1_000_000,next.coins+40*added.length);
  delete next.inProgress;
  return {save:next,added};
}
