import {describe,it,expect} from 'vitest';
import {gardenTendingArt} from '../src/GardenTending';
import {readFileSync} from 'node:fs';
describe('선택 꽃밭 물주기의 표시 경계',()=>{
  it('같은 꽃밭 좌표를 사용하고 유효 범위 밖의 표시나 끝난 행동의 재생을 만들지 않습니다',()=>{
    const art=gardenTendingArt(3,[218,222],900);expect(art).toContain('data-tending-plot="3"');expect(art).toContain('translate(218 204)');expect(art).toContain('translate(198 198)');expect(art).toContain('--garden-tend-elapsed:900ms');expect(art).toContain('aria-hidden="true"');
    for(const [plot,point] of [[-1,[158,153]],[5,[158,153]],[0,[NaN,153]],[0,[158]],[0,[0,0]]] as const)expect(gardenTendingArt(plot,point)).toBe('');
    expect(gardenTendingArt(0,[158,153],Infinity)).toContain('--garden-tend-elapsed:0ms');expect(gardenTendingArt(0,[158,153],5000)).toContain('--garden-tend-elapsed:2400ms');
  });
  it('모션 감소는 물방울을 숨기고 선택 꽃밭의 정적 표시를 유지합니다',()=>{
    const css=readFileSync(new URL('../src/GardenTending.css',import.meta.url),'utf8');expect(css).toMatch(/@media\(prefers-reduced-motion:reduce\)\{\.garden-tending-drop\{display:none;animation:none!important\}/);expect(css).toContain('transform:none!important;opacity:1');expect(css).not.toContain('infinite');
  });
});
