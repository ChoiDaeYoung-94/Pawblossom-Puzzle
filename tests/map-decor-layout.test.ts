import {describe,it,expect} from 'vitest';
import {mapDecorAnchors,mapDecorAttributes} from '../src/MapDecorLayout';
import {CAMPAIGN_NODE_STEP,CAMPAIGN_NODE_X} from '../src/CampaignRoute';

describe('지도 오브젝트의 경로 안전 슬롯',()=>{
  it('모든 장 길이에서 레벨과 현재 핍의 반대쪽 여유 공간을 쓰고 같은 쪽 장식이 겹치지 않습니다',()=>{
    for(const count of [5,10,20])for(let chapter=1;chapter<=31;chapter++){
      const anchors=mapDecorAnchors(chapter,count);
      expect(anchors.length).toBeGreaterThan(0);expect(anchors.length).toBeLessThanOrEqual(4);
      if(count===20)expect(Math.max(...anchors.map(a=>a.y))-Math.min(...anchors.map(a=>a.y))).toBeGreaterThanOrEqual(12*CAMPAIGN_NODE_STEP);
      expect(new Set(anchors.map(a=>a.side+':'+a.y)).size).toBe(anchors.length);
      for(const anchor of anchors){
        const gap=anchor.y/CAMPAIGN_NODE_STEP-1;
        expect(gap).toBeGreaterThanOrEqual(0);expect(gap).toBeLessThan(count-1);
        const a=CAMPAIGN_NODE_X[gap%CAMPAIGN_NODE_X.length]!,b=CAMPAIGN_NODE_X[(gap+1)%CAMPAIGN_NODE_X.length]!;
        if(anchor.side==='left')expect(Math.min(a,b)).toBeGreaterThanOrEqual(60);
        else expect(Math.max(a,b)).toBeLessThanOrEqual(50);
        for(const other of anchors)if(other!==anchor&&other.side===anchor.side)expect(Math.abs(anchor.y-other.y)).toBeGreaterThanOrEqual(128);
      }
    }
  });
  it('같은 장은 같은 위치를 유지하고 장별 위치는 달라지며 잘못된 길이는 배치하지 않습니다',()=>{
    const first=mapDecorAnchors(1,10);
    expect(mapDecorAnchors(1,10)).toEqual(first);expect(mapDecorAnchors(2,10)).not.toEqual(first);
    const snapshot=JSON.stringify(first);expect(mapDecorAttributes(first,0)).toContain('data-map-decor="0"');
    expect(mapDecorAttributes(first,99)).toBe(' style="display:none"');expect(JSON.stringify(first)).toBe(snapshot);
    for(const count of [0,1,21,2.5,NaN,Infinity])expect(mapDecorAnchors(1,count)).toEqual([]);
    for(const chapter of [0,-1,NaN,Infinity,Number.MAX_VALUE])expect(mapDecorAnchors(chapter,10)).toEqual(first);
  });
});
