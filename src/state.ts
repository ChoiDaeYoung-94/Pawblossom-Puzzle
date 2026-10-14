import type { Language } from './i18n';
import { LEVEL_COUNT } from './levels';
export interface SaveData { version: 1; language: Language; highestLevel: number; completed: number[]; stars: number; coins: number; garden: number; music: boolean; sfx: boolean; tutorialSeen: boolean; }
const key = 'pawblossom.save.v1';
const defaults = (): SaveData => ({version:1, language:'ko', highestLevel:1, completed:[], stars:0, coins:0, garden:0, music:true, sfx:true, tutorialSeen:false});
const safeNumber = (x: unknown, fallback: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : fallback;
export function loadSave(): SaveData {
  try {
    const x = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!x || x.version !== 1) return defaults();
    const completed:number[]=Array.isArray(x.completed)? [...new Set<number>(x.completed.filter((n: unknown): n is number => typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=LEVEL_COUNT))]:[];
    // 기존 마지막 스테이지까지 완료한 저장도 새 콘텐츠의 첫 미완료 스테이지로 이어집니다.
    let frontier=1;while(frontier<LEVEL_COUNT&&completed.includes(frontier))frontier++;
    return {version:1,language:x.language==='en'?'en':'ko', highestLevel:Math.max(frontier,safeNumber(x.highestLevel,1,LEVEL_COUNT)),completed,
      stars:safeNumber(x.stars,0,LEVEL_COUNT), coins:safeNumber(x.coins,0,1000000), garden:safeNumber(x.garden,0,5),
      music:x.music!==false,sfx:x.sfx!==false,tutorialSeen:typeof x.tutorialSeen==='boolean'?x.tutorialSeen:completed.length>0};
  } catch { return defaults(); }
}
export function saveData(data: SaveData): boolean { try {localStorage.setItem(key, JSON.stringify(data)); return true;}catch{return false;} }
export function clearSave(): SaveData { const data = defaults(); saveData(data); return data; }
export { levels, LEVEL_COUNT, chapters, chapterForLevel } from './levels';
