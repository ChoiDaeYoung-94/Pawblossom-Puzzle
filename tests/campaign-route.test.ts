import {describe,it,expect} from 'vitest';
import {CAMPAIGN_NODE_STEP,campaignNodePath,routeCurve,travelPoint} from '../src/CampaignRoute';
import {pipWalkArt,PIP_WALK_FRAMES} from '../src/PipWalkArt';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

describe('지도 경로와 걷기 그림의 표시 계약',()=>{
  it('5·10·20판의 길은 모든 발판을 지나고 마지막 구간은 다음 길을 만들지 않습니다',()=>{
    expect(CAMPAIGN_NODE_STEP).toBe(112);
    for(const count of [5,10,20]){
      const normal=campaignNodePath(count,false,false),linked=campaignNodePath(count,true,true);
      expect(normal).toMatch(/^M 50 56/);expect(normal.match(/ Q /g)).toHaveLength(count-1);
      expect(linked).toMatch(/^M 50 0 L 50 56/);expect(linked).toMatch(new RegExp(`50 ${count*112+10}$`));
      expect(normal).not.toMatch(/NaN|Infinity/);
    }
    for(const count of [0,21,1.5,NaN])expect(campaignNodePath(count,true,true)).toBe('');
  });
  it('같은 장의 곡선은 양 끝과 아래 방향을 보존하고 장 경계의 이음점도 연속입니다',()=>{
    const from={x:120,y:100},to={x:180,y:212},seam={x:180,y:165};
    expect(routeCurve(from,to,0)).toEqual(from);expect(routeCurve(from,to,1)).toEqual(to);
    let previous=from.y;
    for(let i=0;i<=100;i++){const point=travelPoint(from,to,i/100,seam);expect(point.y).toBeGreaterThanOrEqual(previous);expect(point.x).toBeGreaterThanOrEqual(120);expect(point.x).toBeLessThanOrEqual(180);previous=point.y;}
    expect(travelPoint(from,to,0,seam)).toEqual(from);expect(travelPoint(from,to,1,seam)).toEqual(to);
    for(const t of [NaN,-3])expect(travelPoint(from,to,t,seam)).toEqual(from);
  });
  it('네 포즈의 출처와 잘림 영역이 원본 안에 있고 SVG 인스턴스 ID가 충돌하지 않습니다',()=>{
    const file=readFileSync(new URL('../public/assets/pip-walk-atlas-v1.png',import.meta.url));
    expect([file.readUInt32BE(16),file.readUInt32BE(20),file[25]]).toEqual([1254,1254,6]);
    expect(createHash('sha256').update(file).digest('hex')).toBe('649d44a3107597c5a1235698abf693dcb4f1c719dccc62ce922cd0478606aa53');
    for(const frame of PIP_WALK_FRAMES){const [x,y,w,h]=frame.crop,[left,top,right,bottom]=frame.bounds;expect(left).toBeGreaterThanOrEqual(x);expect(top).toBeGreaterThanOrEqual(y);expect(right).toBeLessThanOrEqual(x+w);expect(bottom).toBeLessThanOrEqual(y+h);}
    const first=pipWalkArt(1),second=pipWalkArt(2);
    expect(first.match(/data-walk-frame=/g)).toHaveLength(4);expect(first).not.toMatch(/\shref=|<button|<script|NaN|Infinity/);
    const a=[...first.matchAll(/id="([^"]+)"/g)].map(match=>match[1]),b=[...second.matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
    expect(new Set(a).size).toBe(4);expect(a.some(id=>b.includes(id))).toBe(false);
  });
});
