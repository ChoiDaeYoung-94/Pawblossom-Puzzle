import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MAP_PROP_ATLAS,MAP_PROP_FRAMES} from '../src/CampaignProps';
import {campaignMemoryArt} from '../src/CampaignMemories';

describe('자체 자연 소품 원본과 보기 영역',()=>{
  it('20개 고유 소품은 기록한 RGBA 원본 안에서 서로 겹치지 않는 영역을 사용합니다',()=>{
    const png=readFileSync(new URL('../public'+MAP_PROP_ATLAS.path,import.meta.url)),record=JSON.parse(readFileSync(new URL('../docs/art/map-natural-props-v1.json',import.meta.url),'utf8'));
    expect([png.readUInt32BE(16),png.readUInt32BE(20),png[25]]).toEqual([MAP_PROP_ATLAS.width,MAP_PROP_ATLAS.height,6]);
    expect(createHash('sha256').update(png).digest('hex')).toBe(record.sha256);
    expect(MAP_PROP_FRAMES).toHaveLength(20);expect(new Set(MAP_PROP_FRAMES.map(p=>p.world)).size).toBe(20);
    MAP_PROP_FRAMES.forEach((prop,i)=>{
      const [x,y,w,h]=prop.crop;expect(prop).toEqual({world:record.cells[i].world,crop:record.cells[i].crop});
      expect(Math.min(x,y)).toBeGreaterThanOrEqual(0);expect(Math.min(w,h)).toBeGreaterThan(0);expect(x+w).toBeLessThanOrEqual(MAP_PROP_ATLAS.width);expect(y+h).toBeLessThanOrEqual(MAP_PROP_ATLAS.height);
      for(const other of MAP_PROP_FRAMES.slice(i+1)){const [a,b,c,d]=other.crop;expect(x<a+c&&x+w>a&&y<b+d&&y+h>b).toBe(false);}
      const html=campaignMemoryArt(i+5,i+12);expect(html).toContain(`data-map-prop="${prop.world}"`);expect(html).toContain(`viewBox="${prop.crop.join(' ')}"`);expect(html).toContain('overflow="hidden"');expect(html).not.toMatch(/\shref=|<button|<script|NaN|Infinity/);
      // meet의 여백에서도 인접 셀이 비치지 않도록 실제 원본 좌표를 자릅니다.
      expect(html).toContain(`<clipPath id="map-prop-${i+12}" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);
      expect(html).toContain(`clip-path="url(#map-prop-${i+12})"`);
    });
  });
});
