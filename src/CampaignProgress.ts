import {LEVEL_COUNT} from './levels';
const valid=(id:number)=>Number.isInteger(id)&&id>=1&&id<=LEVEL_COUNT;
export function campaignClearCount(completed:readonly number[]){return new Set(completed.filter(valid)).size;}
export function campaignProgress(completed:readonly number[],level:number){
  if(!valid(level))return;
  const index=Math.floor((level-1)/20),first=index*20+1,last=Math.min(LEVEL_COUNT,first+19);
  const done=new Set(completed.filter(id=>valid(id)&&id>=first&&id<=last)).size;
  return {index,first,last,done,total:last-first+1};
}
/** 첫 보상을 받은 일반 회차에서 실제 고유20판을 채웠을 때만 표시합니다. 보상/저장을 쓰지 않습니다. */
export function campaignMilestone(completed:readonly number[],level:number,firstReward:boolean,testing:boolean,won:boolean){
  if(!firstReward||testing||!won||!completed.includes(level))return;
  const progress=campaignProgress(completed,level);if(!progress||progress.done!==progress.total)return;
  return {...progress,journeyComplete:campaignClearCount(completed)===LEVEL_COUNT};
}
