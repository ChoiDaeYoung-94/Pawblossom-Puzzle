import {describe,it,expect} from 'vitest';
import {previewGardenTheme,gardenThemePreview} from '../src/GardenThemePreview';
import {freshGardenDesign,prepareGardenAction} from '../src/gardenDesign';

describe('구매 전 정원 풍경 비교',()=>{
  it('미소유 풍경도 무료로 볼 수 있지만 소유·재화는 만들지 않습니다',()=>{
    const current=freshGardenDesign(),before=JSON.stringify(current),pip={growth:0,affection:0};
    const preview=previewGardenTheme('starlight',current,0,pip,0,0)!;
    expect(preview).toMatchObject({cost:80,owned:false,ready:false,changed:true,canApply:false});
    expect(preview.after.theme).toBe('starlight');expect(preview.after.ownedThemes).toBeUndefined();expect(JSON.stringify(current)).toBe(before);
    expect(prepareGardenAction(0,0,pip,current,preview.action,0)).toBeUndefined();
  });
  it('확정만 기존 구매 규칙으로80코인을 쓰고, 소유 후 전환은 무료입니다',()=>{
    const current=freshGardenDesign(),pip={growth:100,affection:100};
    const preview=previewGardenTheme('sunset',current,5,pip,40,100)!;expect(preview.canApply).toBe(true);
    const bought=prepareGardenAction(100,5,pip,current,preview.action,40)!;expect(bought.coins).toBe(20);expect(bought.design.ownedThemes).toEqual(['sunset']);
    expect(previewGardenTheme('sunset',bought.design,5,pip,40,20)).toMatchObject({owned:true,cost:0,changed:false,canApply:false});
    const back=previewGardenTheme('meadow',bought.design,5,pip,40,20)!;expect(back).toMatchObject({cost:0,canApply:true});
    expect(prepareGardenAction(20,5,pip,bought.design,back.action,40)?.coins).toBe(20);
  });
  it.each(['ko','en'] as const)('%s 현재와 변경 후 그림을 비교해도 입력 상태와 소유를 바꾸지 않습니다',language=>{
    const current={...freshGardenDesign(),flowers:['daisy','violet','meadow','daisy','violet'] as const},design={...current,flowers:[...current.flowers]},pip={growth:100,affection:100};
    const before=JSON.stringify(design),after=gardenThemePreview(language,design,5,pip,40,100,'starlight',false,false,false),now=gardenThemePreview(language,design,5,pip,40,100,'starlight',true,false,false);
    expect(after).toContain('data-sky="starlight"');expect(now).not.toContain('data-sky="starlight"');expect(after).toContain('garden-look-confirm');expect(after).not.toMatch(/id="garden-look-confirm"[^>]*disabled/);expect(JSON.stringify(design)).toBe(before);
  });
  it('부족코인·미달조건·저장차단은 확정을 거절하고 음수 확정 잔액을 약속하지 않습니다',()=>{
    const pip={growth:100,affection:100};
    for(const [clears,coins,blocked] of [[39,100,false],[40,79,false],[40,100,true]] as const){
      const html=gardenThemePreview('ko',undefined,5,pip,clears,coins,'starlight',false,blocked,false);
      expect(html).toMatch(/id="garden-look-confirm"[^>]*disabled/);expect(html).not.toContain('코인 · -');
      expect(html).toContain('id="garden-look-after"');
    }
    expect(previewGardenTheme('unknown' as never,undefined,5,pip,40,100)).toBeUndefined();expect(previewGardenTheme('sunset',undefined,6,pip,40,100)).toBeUndefined();
  });
});
