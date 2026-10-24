import {describe,it,expect} from 'vitest';
import {previewGardenPreset} from '../src/GardenPresets';
import {gardenPresetPreview} from '../src/GardenPresetsUI';
import {freshGardenDesign,type GardenDesign} from '../src/gardenDesign';
import {freshGardenSpaces} from '../src/gardenSpaces';
import {gardenArt} from '../src/GardenArt';
const grown={growth:100,affection:100};
const owned=():GardenDesign=>({...freshGardenDesign(),flowers:['meadow','daisy','violet','daisy','meadow'],owned:['bench','butterflies','lantern'],placed:['bench'],ownedThemes:['sunset','starlight'],theme:'sunset',spaces:freshGardenSpaces()});
describe('소유물만 쓰는 무료 정원 코디',()=>{
  it('보기는 원본·선택필드를 바꾸지 않고 열린 꽃밭만 바꾸며 반복 적용은 no-op입니다',()=>{
    const source=freshGardenDesign(),raw=JSON.stringify(source);Object.freeze(source.flowers);Object.freeze(source);
    const plan=previewGardenPreset('sunny',source,2,grown,0)!;
    expect(JSON.stringify(source)).toBe(raw);expect(plan.design?.flowers).toEqual(['daisy','meadow','meadow','meadow','meadow']);expect(plan.design).not.toHaveProperty('theme');expect(plan.design).not.toHaveProperty('spaces');
    expect(plan.changed).toBe(true);expect(previewGardenPreset('sunny',plan.design,2,grown,0)?.changed).toBe(false);
  });
  it('꽃밭·나비·풍경·등불의 실제 소유를 요구하고 미소유 예상 디자인을 만들지 않습니다',()=>{
    expect(previewGardenPreset('sunny',undefined,0,grown,0)).toMatchObject({missing:['plot'],changed:false});
    expect(previewGardenPreset('butterfly',undefined,3,grown,40)).toMatchObject({missing:['butterflies']});
    const plan=previewGardenPreset('starlight',undefined,5,grown,40)!;
    expect(plan.missing).toEqual(['starlight','lantern']);expect(plan.design).toBeUndefined();
    expect(previewGardenPreset('nope' as never,undefined,3,grown,40)).toBeUndefined();
    expect(previewGardenPreset('sunny',undefined,6,grown,40)).toBeUndefined();
  });
  it('소유물 획득·숨김 없이 지시한 장식만 놓고 공간 원본은 독립 복사합니다',()=>{
    const source=owned(),raw=JSON.stringify(source),plan=previewGardenPreset('starlight',source,5,grown,40)!;
    expect(plan.design).toMatchObject({theme:'starlight',lanternPlot:4,owned:source.owned,placed:['bench','lantern'],ownedThemes:source.ownedThemes,spaces:source.spaces});
    expect(plan.design?.spaces).not.toBe(source.spaces);expect(plan.design?.flowers).toEqual(['violet','daisy','violet','daisy','violet']);
    expect(JSON.stringify(source)).toBe(raw);const butterflies=previewGardenPreset('butterfly',plan.design,5,grown,40)!;
    expect(butterflies.design?.placed).toEqual(['bench','lantern','butterflies']);expect(butterflies.design?.lanternPlot).toBe(4);
  });
  it('소유 요구 하나라도 빠지면 잠기고 꽃 다양성 변경으로 이미 얻은 나비를 회수하지 않습니다',()=>{
    const source=owned();source.ownedThemes=[];delete source.theme;
    expect(previewGardenPreset('starlight',source,5,grown,40)?.missing).toEqual(['starlight']);
    source.flowers=Array(5).fill('meadow');expect(previewGardenPreset('butterfly',source,5,grown,40)?.design?.placed).toContain('butterflies');
  });
  it('미리보기의 SVG ID는 기본 그림 및 다른 미리보기와 충돌하지 않습니다',()=>{
    const base=gardenArt(2),one=gardenArt(2,false,undefined,{idPrefix:'look-one'}),two=gardenArt(2,false,undefined,{idPrefix:'look-two'});
    const ids=(s:string)=>[...s.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
    expect(ids(base).length).toBeGreaterThan(0);expect(ids(one).every(id=>!ids(base).includes(id)&&!ids(two).includes(id))).toBe(true);
    for(const url of one.matchAll(/url\(#([^)]+)\)/g))expect(ids(one)).toContain(url[1]);
    expect(()=>gardenArt(2,false,undefined,{idPrefix:'bad"id'})).toThrow();
  });
  it('한영 화면은 미소유 코디 적용을 막고 무료·공통 풍경·현재/변경 구분을 표시합니다',()=>{
    for(const language of ['ko','en'] as const){
      const html=gardenPresetPreview(language,undefined,2,grown,0,'starlight',false,false,false);
      expect(html).toMatch(/id="garden-look-confirm"[^>]+disabled/);expect(html).toMatch(/id="garden-look-current"[^>]+aria-pressed="true"/);expect(html).toMatch(/id="garden-look-after"[^>]+disabled/);
      const ready=gardenPresetPreview(language,owned(),5,grown,40,'starlight',false,false,true);expect(ready).not.toMatch(/id="garden-look-confirm"[^>]+disabled/);expect(ready).toContain('space-preview-demo');
    }
  });
});
