import {describe,it,expect,vi,afterEach} from 'vitest';
import {journeyProjectSpecs,JOURNEY_STAR_COSTS,journeyProjectFor,previewJourneyAction,prepareJourneyAction,validateJourneyProjects,type JourneyProjects} from '../src/journeyGarden';
import {freshGardenDesign,gardenDesignFor,prepareGardenAction,validateGardenDesign} from '../src/gardenDesign';
import {freshGardenSpaces,prepareSpaceAction,validateGardenSpaces} from '../src/gardenSpaces';
import {previewGardenPreset} from '../src/GardenPresets';
import {SaveStore,SAVE_KEY,BACKUP_KEY} from '../src/state';
const complete={phase:2,altOwned:true,style:'alt'} as const;
const grown={growth:100,affection:100};
afterEach(()=>vi.unstubAllGlobals());

describe('500판 여정 정원의 별 예산·소유·호환',()=>{
  it('기존94별을모두썼어도각해금시점에기초/완성할수있고500판뒤6별이남습니다',()=>{
    let stars=100-94,clears=100,projects:JourneyProjects|undefined,coins=0;
    for(const spec of journeyProjectSpecs)for(const phase of [0,1] as const){
      stars+=spec.clears[phase]-clears;clears=spec.clears[phase];const result=prepareJourneyAction(stars,coins,projects,{kind:'restore',project:spec.id},clears)!;
      expect(result.costStars).toBe(JOURNEY_STAR_COSTS[phase]);expect(result.costCoins).toBe(0);({stars,coins,projects}=result);expect(stars).toBe(phase===0?11:6);expect(projects![spec.id]!.phase).toBe(phase+1);
    }
    expect(clears).toBe(500);expect(stars).toBe(6);expect(coins).toBe(0);expect(Object.keys(projects!)).toHaveLength(10);expect(journeyProjectSpecs.reduce((sum)=>sum+JOURNEY_STAR_COSTS[0]+JOURNEY_STAR_COSTS[1],94)).toBe(494);
  });
  it.each(journeyProjectSpecs)('$id는각완료경계와잔액을검사하고다른작품구매를강제하지않습니다',spec=>{
    const action={kind:'restore',project:spec.id} as const;
    const preview=previewJourneyAction(undefined,action,spec.clears[0]-1)!;expect(preview.after.phase).toBe(1);expect(preview.costStars).toBe(15);
    expect(prepareJourneyAction(500,0,undefined,action,spec.clears[0]-1)).toBeUndefined();expect(prepareJourneyAction(14,0,undefined,action,spec.clears[0])).toBeUndefined();
    const first=prepareJourneyAction(15,0,undefined,action,spec.clears[0])!;expect(first.stars).toBe(0);expect(Object.keys(first.projects)).toEqual([spec.id]);
    const before=JSON.stringify(first.projects);expect(prepareJourneyAction(25,0,first.projects,action,spec.clears[1]-1)).toBeUndefined();expect(prepareJourneyAction(24,0,first.projects,action,spec.clears[1])).toBeUndefined();
    const second=prepareJourneyAction(25,0,first.projects,action,spec.clears[1])!;expect(second.stars).toBe(0);expect(second.projects[spec.id]!.phase).toBe(2);expect(JSON.stringify(first.projects)).toBe(before);expect(prepareJourneyAction(500,0,second.projects,action,500)).toBeUndefined();
  });
  it.each(journeyProjectSpecs)('$id의선택스타일은코인을한번만쓰고영구소유/무료교체합니다',spec=>{
    const current:JourneyProjects={[spec.id]:{phase:2,altOwned:false,style:'base'}};const before=JSON.stringify(current),action={kind:'style',project:spec.id,style:'alt'} as const;
    expect(prepareJourneyAction(0,spec.altCoins-1,current,action,500)).toBeUndefined();const purchased=prepareJourneyAction(0,spec.altCoins,current,action,500)!;expect(purchased.coins).toBe(0);expect(purchased.costCoins).toBe(spec.altCoins);expect(purchased.projects[spec.id]).toEqual(complete);expect(JSON.stringify(current)).toBe(before);
    expect(prepareJourneyAction(0,0,purchased.projects,action,500)).toBeUndefined();const base=prepareJourneyAction(0,0,purchased.projects,{kind:'style',project:spec.id,style:'base'},500)!;expect(base.costCoins).toBe(0);expect(base.projects[spec.id]!.altOwned).toBe(true);expect(prepareJourneyAction(0,0,base.projects,action,500)!.costCoins).toBe(0);
  });
  it('미보유기본값조회는저장을만들지않고원래필드부재를옛행동도보존합니다',()=>{
    const design=freshGardenDesign();expect(journeyProjectFor(design.journeyProjects,'conservatory')).toEqual({phase:0,altOwned:false,style:'base'});expect(design).not.toHaveProperty('journeyProjects');
    expect(gardenDesignFor(design)).not.toHaveProperty('journeyProjects');expect(validateGardenDesign(design,0,{growth:0,affection:0},0)).not.toHaveProperty('journeyProjects');expect(prepareGardenAction(0,1,grown,design,{kind:'flower',plot:0,flower:'daisy'},500)!.design).not.toHaveProperty('journeyProjects');
  });
  it('꽃·코디·테마·옛공간과복사뒤에도새소유를독립보존하고legacy3공간검증을늘리지않습니다',()=>{
    const projects:JourneyProjects={conservatory:complete},spaces=freshGardenSpaces();const design={...freshGardenDesign(),owned:['bench','butterflies','lantern'] as const,placed:[] as const,ownedThemes:['sunset','starlight'] as const,theme:'starlight' as const,journeyProjects:projects,spaces};
    const valid=validateGardenDesign(design,5,grown,500)!;expect(valid.journeyProjects).toEqual(projects);expect(valid.journeyProjects).not.toBe(projects);expect(valid.journeyProjects!.conservatory).not.toBe(projects.conservatory);
    const copy=gardenDesignFor(valid);copy.journeyProjects!.conservatory!.style='base';expect(valid.journeyProjects!.conservatory!.style).toBe('alt');
    const flower=prepareGardenAction(1000,5,grown,valid,{kind:'flower',plot:0,flower:'daisy'},500)!.design;expect(flower.journeyProjects).toEqual(projects);
    expect(previewGardenPreset('sunny',valid,5,grown,500)!.design!.journeyProjects).toEqual(projects);expect(prepareGardenAction(1000,5,grown,valid,{kind:'selectTheme',theme:'meadow'},500)!.design.journeyProjects).toEqual(projects);
    const space=prepareSpaceAction(500,1000,valid.spaces,{kind:'restore',space:'pond'},500)!;expect({...gardenDesignFor(valid),spaces:space.spaces}.journeyProjects).toEqual(projects);expect(validateGardenSpaces({...spaces,journeyProjects:{}},500)).toBeUndefined();
  });
  it.each([undefined,null,[],new Date(),{unknown:{phase:0,altOwned:false,style:'base'}},{conservatory:undefined},{conservatory:{phase:1,altOwned:false,style:'base',cost:0}},{conservatory:{phase:3,altOwned:false,style:'base'}},{conservatory:{phase:0,altOwned:true,style:'base'}},{conservatory:{phase:1,altOwned:false,style:'alt'}},{conservatory:{phase:2,altOwned:false,style:'alt'}}])('잘못된선택필드를조용히삭제해구매분을잃게하지않습니다: %j',value=>{
    expect(validateJourneyProjects(value,500)).toBeUndefined();expect(validateGardenDesign({...freshGardenDesign(),journeyProjects:value},0,{growth:0,affection:0},500)).toBeUndefined();
  });
  it('조기소유·잘못된금액·추가가격필드·단계건너뛰기를거절합니다',()=>{
    expect(validateJourneyProjects({conservatory:{phase:1,altOwned:false,style:'base'}},119)).toBeUndefined();expect(validateJourneyProjects({conservatory:complete},139)).toBeUndefined();
    for(const n of [-1,.5,NaN,Infinity,501])expect(prepareJourneyAction(n,0,undefined,{kind:'restore',project:'conservatory'},500)).toBeUndefined();
    expect(previewJourneyAction(undefined,{kind:'restore',project:'conservatory',cost:0} as any,500)).toBeUndefined();expect(prepareJourneyAction(500,1000,undefined,{kind:'style',project:'conservatory',style:'alt'},500)).toBeUndefined();
  });
  it('구저장필드부재와백업의이전확정소유·잔액복구를보존합니다',()=>{
    const base={version:1,language:'ko',highestLevel:140,completed:Array.from({length:140},(_,i)=>i+1),stars:100,coins:700,garden:0,music:true,sfx:true,tutorialSeen:true,gardenDesign:freshGardenDesign()};
    const raw=JSON.stringify(base),disk=new Map([[SAVE_KEY,raw]]),port={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value);},removeItem:(key:string)=>{disk.delete(key);}};
    const store=new SaveStore(()=>port),legacy=store.load();expect(legacy.highestLevel).toBe(141);expect(legacy.gardenDesign).not.toHaveProperty('journeyProjects');expect([...disk]).toEqual([[SAVE_KEY,raw]]);
    const next={...legacy,gardenDesign:{...gardenDesignFor(legacy.gardenDesign),journeyProjects:{conservatory:complete}}};expect(store.save(next)).toBe(true);expect(JSON.parse(disk.get(SAVE_KEY)!).gardenDesign.journeyProjects).toEqual({conservatory:complete});expect(JSON.parse(disk.get(BACKUP_KEY)!).gardenDesign).not.toHaveProperty('journeyProjects');
    expect(store.save({...next,language:'en'})).toBe(true);expect(JSON.parse(disk.get(BACKUP_KEY)!).gardenDesign.journeyProjects).toEqual({conservatory:complete});
    disk.set(SAVE_KEY,'{');const recovered=store.load();expect(store.status.load).toBe('recovered');expect(recovered.language).toBe('ko');expect(recovered.gardenDesign?.journeyProjects).toEqual({conservatory:complete});expect(recovered.stars).toBe(100);expect(recovered.coins).toBe(700);
    const invalid=JSON.stringify({...base,gardenDesign:{...base.gardenDesign,journeyProjects:{conservatory:{phase:2,altOwned:false,style:'alt'}}}});disk.set(SAVE_KEY,invalid);disk.set(BACKUP_KEY,invalid);const blocked=store.load();expect(store.status.load).toBe('corrupt');expect(store.save(blocked)).toBe(false);expect(disk.get(SAVE_KEY)).toBe(invalid);expect(disk.get(BACKUP_KEY)).toBe(invalid);
  });
});
