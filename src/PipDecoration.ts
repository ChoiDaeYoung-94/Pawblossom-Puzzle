import type {PipCare} from './pipCare';
/** 현재 장착 상태의 표시만 담당하며 소유·저장·수명을 바꾸지 않습니다. */
export function pipDecorationArt(view:'village'|'journal',equipped:PipCare['equipped'],tending=false){
  if(equipped==='ribbon'&&!tending)return `<span id="${view}-pip-accessory" class="pip-accessory pip-ribbon" data-pip-accessory="ribbon" aria-hidden="true"><svg class="pip-accessory-fallback" viewBox="0 0 80 36"><path d="M35 16Q8-6 5 9Q-1 31 35 23M45 16Q72-6 75 9Q81 31 45 23" fill="#e7a4b5" stroke="#965e74" stroke-width="3"/><rect x="33" y="13" width="14" height="14" rx="5" fill="#f5c7d2" stroke="#965e74" stroke-width="3"/></svg></span>`;
  if(equipped==='wateringCan'||tending)return `<span id="${view}-pip-accessory" class="pip-accessory pip-watering-can ${view==='journal'&&tending?'pip-tending-can':''}" data-pip-accessory="wateringCan" aria-hidden="true"><svg class="pip-accessory-fallback" viewBox="0 0 76 70"><path d="M48 27Q73 7 68 34Q65 45 51 43M19 33 7 19 1 23 18 47" fill="none" stroke="#527c70" stroke-width="7"/><path d="M16 26Q33 21 51 26L54 59Q35 66 14 59Z" fill="#91b8a0" stroke="#456b5b" stroke-width="3"/><path d="M25 25V16Q34 11 43 16V25" fill="none" stroke="#456b5b" stroke-width="4"/><path d="M26 40h17m-8-8v17" stroke="#f6e6ad" stroke-width="4" stroke-linecap="round"/></svg></span>`;
  return '';
}
