/** 핍 육성은 누적형입니다. 접속하지 않아도 수치가 줄지 않습니다. */
export type PipDecoration = 'ribbon' | 'wateringCan';
export interface PipCare {
  growth:number;
  affection:number;
  owned:PipDecoration[];
  equipped:PipDecoration|'none';
}
export type PipAction = 'feed'|'play'|'buyRibbon'|'buyWateringCan'|'equipNone'|'equipRibbon'|'equipWateringCan';
export const freshPip = ():PipCare => ({growth:0,affection:0,owned:[],equipped:'none'});
export const pipLevel = (pip:PipCare):1|2|3 => pip.growth>=60?3:pip.growth>=20?2:1;
export const careCost = (pip:PipCare) => pip.growth===100&&pip.affection===100?0:10;
const bounded=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=100;
export function validatePip(value:unknown):PipCare|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  const p=value as Record<string,unknown>;
  if(!bounded(p.growth)||!bounded(p.affection)||!Array.isArray(p.owned)||p.owned.length>2
    ||p.owned.some(item=>item!=='ribbon'&&item!=='wateringCan')||new Set(p.owned).size!==p.owned.length
    ||!['none','ribbon','wateringCan'].includes(p.equipped as string))return;
  const owned=p.owned.slice() as PipDecoration[];
  if((owned.includes('ribbon')&&p.growth<20)||(owned.includes('wateringCan')&&p.growth<60)
    ||(p.equipped!=='none'&&!owned.includes(p.equipped as PipDecoration)))return;
  return {growth:p.growth,affection:p.affection,owned,equipped:p.equipped as PipCare['equipped']};
}
/** 가격·효과·소유 조건을 함께 계산하며, 호출한 쪽의 객체와 원래 배열은 변경하지 않습니다. */
export function preparePipAction(coins:number,current:PipCare,action:PipAction):{coins:number;pip:PipCare;cost:number}|undefined {
  const pip={...current,owned:current.owned.slice()};
  let cost=0;
  if(action==='feed'||action==='play'){
    cost=careCost(pip);
    pip.growth=Math.min(100,pip.growth+(action==='feed'?10:4));
    pip.affection=Math.min(100,pip.affection+(action==='feed'?4:10));
  }else if(action==='buyRibbon'||action==='buyWateringCan'){
    const item=action==='buyRibbon'?'ribbon':'wateringCan',required=item==='ribbon'?2:3;
    if(pipLevel(pip)<required||pip.owned.includes(item))return;
    cost=item==='ribbon'?40:80;pip.owned.push(item);pip.equipped=item;
  }else{
    const item=action==='equipNone'?'none':action==='equipRibbon'?'ribbon':action==='equipWateringCan'?'wateringCan':undefined;
    if(!item||pip.equipped===item||(item!=='none'&&!pip.owned.includes(item)))return;
    pip.equipped=item;
  }
  if(!Number.isInteger(coins)||coins<cost)return;
  return {coins:coins-cost,pip,cost};
}
