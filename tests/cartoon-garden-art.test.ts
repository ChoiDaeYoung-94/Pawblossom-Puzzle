import {describe,expect,it} from 'vitest';
import {gardenArt,FLOWER_GARDEN_RENDERER} from '../src/GardenArt';
import {freshGardenDesign,type GardenTheme} from '../src/gardenDesign';

const themes:GardenTheme[]=['meadow','sunset','starlight'];
const plots=['158 153','285 141','413 153','218 222','351 222'];

describe('기본 꽃밭의 자체 카툰 SVG 표시',()=>{
  it.each(themes.flatMap(theme=>[0,1,5].map(stage=>({theme,stage}))))('$theme 성장$stage의 꽃밭·소유 장식·입력 불변',({theme,stage})=>{
    const design={...freshGardenDesign(),theme,flowers:['meadow','daisy','violet','meadow','daisy'] as const};
    const current={...design,flowers:[...design.flowers],owned:stage===5?['bench','butterflies','lantern'] as const:stage===1?['bench'] as const:[]};
    const saved={...current,owned:[...current.owned],placed:[...current.owned]},before=JSON.stringify(saved);
    const art=gardenArt(stage,false,saved,{renderer:FLOWER_GARDEN_RENDERER});
    expect(art).toContain('data-renderer="cartoon-v1"');expect(art).toContain(`data-stage="${stage}"`);
    if(theme==='meadow')expect(art).not.toContain('data-sky=');else expect(art).toContain(`data-sky="${theme}"`);
    expect(art).toContain('viewBox="0 0 480 280"');
    expect(art.match(/class="garden-plot"/g)).toHaveLength(5);
    expect(art.match(/data-planted="true"/g)??[]).toHaveLength(stage);
    for(const [index,position] of plots.entries())expect(art).toContain(`data-plot="${index}" data-flower="${saved.flowers[index]}" data-planted="${index<stage}" transform="translate(${position})"`);
    for(const decoration of ['bench','butterflies','lantern'])expect(art.includes(`data-decoration="${decoration}"`)).toBe(saved.placed.includes(decoration as typeof saved.placed[number]));
    expect(art).not.toMatch(/<image|https?:\/\/(?!www\.w3\.org)|NaN|undefined/);
    expect(JSON.stringify(saved)).toBe(before);
  });
  it('실제 꽃밭과 두 미리보기의 SVG 정의/참조가 서로 충돌하지 않습니다',()=>{
    const design=freshGardenDesign();
    const html=gardenArt(5,false,design,{renderer:FLOWER_GARDEN_RENDERER})
      +gardenArt(5,false,{...design,theme:'sunset'},{renderer:FLOWER_GARDEN_RENDERER,idPrefix:'theme-preview-1'})
      +gardenArt(5,false,{...design,theme:'starlight'},{renderer:FLOWER_GARDEN_RENDERER,idPrefix:'look-1'});
    const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]),references=Array.from(html.matchAll(/url\(#([^)]+)\)/g),m=>m[1]);
    expect(ids.length).toBeGreaterThan(0);expect(new Set(ids).size).toBe(ids.length);
    expect(references.every(id=>ids.includes(id))).toBe(true);
  });
  it('유효하지 않은 성장값·ID를 기존 표시 계약대로 처리합니다',()=>{
    for(const value of [NaN,Infinity,-1])expect(gardenArt(value,false,undefined,{renderer:FLOWER_GARDEN_RENDERER})).toContain('data-stage="0"');
    expect(gardenArt(50,false,undefined,{renderer:FLOWER_GARDEN_RENDERER})).toContain('data-stage="5"');
    expect(()=>gardenArt(1,false,undefined,{renderer:FLOWER_GARDEN_RENDERER,idPrefix:'bad prefix'})).toThrow('invalid-garden-art-prefix');
  });
  it('등불의 다섯 배치 위치와 옛 기본 위치를 보존합니다',()=>{
    const design={...freshGardenDesign(),owned:['lantern'] as const,placed:['lantern'] as const};
    for(const [plot,position] of ['211 173','338 161','454 178','270 244','405 244'].entries()){
      const art=gardenArt(5,false,{...design,owned:[...design.owned],placed:[...design.placed],lanternPlot:plot},{renderer:FLOWER_GARDEN_RENDERER});
      expect(art).toContain(`data-decoration="lantern" transform="translate(${position})"`);
    }
    expect(gardenArt(5,false,{...design,owned:[...design.owned],placed:[...design.placed]},{renderer:FLOWER_GARDEN_RENDERER})).toContain('data-decoration="lantern" transform="translate(419 217)"');
  });
  it('나비는 같은 몸통/좌표의 SVG 날개만 움직일 수 있게 그립니다',()=>{
    const design={...freshGardenDesign(),owned:['butterflies'] as const,placed:['butterflies'] as const};
    const art=gardenArt(5,false,{...design,owned:[...design.owned],placed:[...design.placed]},{renderer:FLOWER_GARDEN_RENDERER});
    expect(art.match(/data-garden-vector-butterfly="true"/g)).toHaveLength(3);
    expect(art.match(/class="garden-cartoon-wings"/g)).toHaveLength(3);
    expect(art).not.toContain('butterfly.webp');expect(art).not.toContain('<animate');
  });
});
