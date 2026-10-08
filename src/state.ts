import type { Language } from './i18n';
export interface SaveData { version: 1; language: Language; highestLevel: number; completed: number[]; stars: number; coins: number; garden: number; music: boolean; sfx: boolean; }
const key = 'pawblossom.save.v1';
const defaults = (): SaveData => ({version:1, language:'en', highestLevel:1, completed:[], stars:0, coins:0, garden:0, music:true, sfx:true});
const safeNumber = (x: unknown, fallback: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : fallback;
export function loadSave(): SaveData {
  try {
    const x = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!x || x.version !== 1) return defaults();
    return {version:1,language:x.language==='ko'?'ko':'en', highestLevel:Math.max(1,safeNumber(x.highestLevel,1,10)),
      completed:Array.isArray(x.completed)? [...new Set(x.completed.filter((n: unknown): n is number => typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=10))] as number[]:[],
      stars:safeNumber(x.stars,0,10), coins:safeNumber(x.coins,0,1000000), garden:safeNumber(x.garden,0,5),
      music:x.music!==false,sfx:x.sfx!==false};
  } catch { return defaults(); }
}
export function saveData(data: SaveData): boolean { try {localStorage.setItem(key, JSON.stringify(data)); return true;}catch{return false;} }
export function clearSave(): SaveData { const data = defaults(); saveData(data); return data; }
export const levels = Array.from({length:10},(_,i)=>({id:i+1,moves: i<3 ? 22 : 24,goals:[{kind:i%6,count:12+Math.floor(i/2)*2},{kind:(i+1)%6,count:10+Math.floor(i/3)*2}]}));
