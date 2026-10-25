import {describe,it,expect} from 'vitest';
import {campaignClearCount,campaignProgress,campaignMilestone} from '../src/CampaignProgress';
import {campaignMilestoneCard,milestoneCopy} from '../src/CampaignMilestone';
import {chapterForLevel} from '../src/levels';
import {campaignWorldPostcard} from '../src/CampaignScenery';
import {existsSync} from 'node:fs';
const completed=(count:number)=>Array.from({length:count},(_,i)=>i+1);
describe('25풍경의실제고유완료와엽서표시',()=>{
  it.each(Array.from({length:25},(_,i)=>i))('%i풍경은정확히자기20판만세고최초일반완주에서만표시합니다',index=>{
    const first=index*20+1,last=first+19,ids=Array.from({length:20},(_,i)=>first+i);
    expect(campaignProgress(ids,last)).toEqual({index,first,last,done:20,total:20});expect(campaignProgress(ids.slice(0,19),last)!.done).toBe(19);expect(campaignMilestone(ids.slice(0,19),last,true,false,true)).toBeUndefined();
    const card=campaignMilestone(ids,last,true,false,true)!;expect(card).toEqual({index,first,last,done:20,total:20,journeyComplete:false});
    for(const [reward,test,won] of [[false,false,true],[true,true,true],[true,false,false]])expect(campaignMilestone(ids,last,reward,test,won)).toBeUndefined();
    const html=campaignMilestoneCard('ko',card,index);expect(html).toContain('20/20');expect(html).toContain('id="result-world-picture"');expect(html).not.toMatch(/<button|data-level=|\shref=/);for(const m of html.matchAll(/data-map-src="([^\"]+)"/g))expect(existsSync(new URL('../public'+m[1],import.meta.url))).toBe(true);
  });
  it('중복/범위밖/분수는완료수를늘리지않고함수는기존목록을바꾸지않습니다',()=>{
    const ids=[1,1,2,20,21,500,0,-1,501,1.5,NaN,Infinity],before=ids.slice();expect(campaignClearCount(ids)).toBe(5);expect(campaignProgress(ids,1)!.done).toBe(3);expect(campaignProgress(ids,500)!.done).toBe(1);expect(ids).toEqual(before);for(const id of [0,-1,501,.5,NaN,Infinity])expect(campaignProgress(ids,id)).toBeUndefined();
  });
  it('500번하나나중복500개를전체완료로세지않고500고유판이필요합니다',()=>{
    expect(campaignClearCount(Array(500).fill(500))).toBe(1);expect(campaignMilestone([500],500,true,false,true)).toBeUndefined();expect(campaignMilestone(completed(500),500,true,false,true)!.journeyComplete).toBe(true);expect(campaignMilestone(completed(499),500,true,false,true)).toBeUndefined();
  });
  it('비연속으로남아있던중간판을처음완료해20개가되더라도정확한풍경을표시합니다',()=>{
    expect(campaignMilestone(completed(20),7,true,false,true)?.first).toBe(1);expect(campaignMilestone(completed(20),21,true,false,true)).toBeUndefined();
  });
  it('모든25엽서clip은지도/정원과다른namespace이고인접셀을자릅니다',()=>{
    const ids=new Set<string>();for(let index=0;index<25;index++){const chapter=chapterForLevel(index*20+1).id,art=campaignWorldPostcard(chapter,8);expect(art).toContain('clipPathUnits="userSpaceOnUse"');expect(art).not.toMatch(/\shref=|<button|https?:/);ids.add(art.match(/clipPath id="([^"]+)"/)![1]);}expect(ids.size).toBe(25);
  });
  it.each(['ko','en'] as const)('%s엽서는현재풍경/최종풍경안내만표시하며추가보상이나새입력을만들지않습니다',language=>{
    const first=campaignMilestone(completed(20),20,true,false,true)!,last=campaignMilestone(completed(500),500,true,false,true)!;
    expect(milestoneCopy(language,first).name).toContain('1–20');expect(milestoneCopy(language,last).name).toContain('481–500');expect(milestoneCopy(language,last).note).not.toBe(milestoneCopy(language,first).note);expect(campaignMilestoneCard(language,undefined,1)).toBe('');
  });
});
