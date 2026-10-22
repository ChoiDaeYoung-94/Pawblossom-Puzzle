import {describe,it,expect} from 'vitest';
import {freshGardenDesign,gardenDesignFor,gardenProjects,projectReady,prepareGardenAction,validateGardenDesign,flowerDiversity,type GardenDesign} from '../src/gardenDesign';
import {gardenArt,flowerArt} from '../src/GardenArt';
import {SaveStore,SAVE_KEY,BACKUP_KEY} from '../src/state';
const grown={growth:100,affection:100};
const diverse=():GardenDesign=>({...freshGardenDesign(),flowers:['meadow','daisy','violet','meadow','meadow']});
describe('선택하는 꽃과 영구 정원 작품',()=>{
  it('다섯 칸의 독립 기본값과 읽기 전용 fallback을 제공합니다',()=>{
    const original=freshGardenDesign(),copy=gardenDesignFor(original);copy.flowers[0]='daisy';copy.owned.push('bench');
    expect(original).toEqual(freshGardenDesign());expect(gardenDesignFor()).toEqual(freshGardenDesign());
  });
  it('열린 칸만 무료 교체하고 같은 선택·닫힌 칸·잘못된 위치는 거절합니다',()=>{
    const design=freshGardenDesign(),before=JSON.stringify(design);
    const next=prepareGardenAction(0,1,grown,design,{kind:'flower',plot:0,flower:'daisy'})!;
    expect(next.coins).toBe(0);expect(next.cost).toBe(0);expect(next.design.flowers).toEqual(['daisy','meadow','meadow','meadow','meadow']);expect(JSON.stringify(design)).toBe(before);
    for(const plot of [-1,.5,1,5])expect(prepareGardenAction(40,1,grown,design,{kind:'flower',plot,flower:'daisy'})).toBeUndefined();
    expect(prepareGardenAction(40,1,grown,design,{kind:'flower',plot:0,flower:'meadow'})).toBeUndefined();
  });
  it.each(gardenProjects)('$id의 꽃밭·성장·친밀도·다양성 경계를 모두 확인합니다',project=>{
    const design=diverse(),pip={growth:project.growth,affection:project.affection};
    expect(projectReady(project,project.plots,pip,design)).toBe(true);
    expect(projectReady(project,project.plots-1,pip,design)).toBe(false);
    expect(projectReady(project,project.plots,{...pip,growth:pip.growth-1},design)).toBe(false);
    expect(projectReady(project,project.plots,{...pip,affection:pip.affection-1},design)).toBe(false);
    if(project.diversity>1)expect(projectReady(project,project.plots,pip,freshGardenDesign())).toBe(false);
  });
  it('꽃 다양성은 열린 칸에서만 계산하며 한 꽃밭을 여러 번 바꿔도 한 종류입니다',()=>{
    expect(flowerDiversity(diverse(),1)).toBe(1);expect(flowerDiversity(diverse(),2)).toBe(2);expect(flowerDiversity(diverse(),3)).toBe(3);
  });
  it('무료 두 작품과 20코인 등불을 한번만 소유하며 표시 전환과 이후 꽃 교체는 무료입니다',()=>{
    let design=diverse(),coins=20;
    for(const project of gardenProjects){const result=prepareGardenAction(coins,3,grown,design,{kind:'claim',project:project.id})!;expect(result.cost).toBe(project.cost);design=result.design;coins=result.coins;expect(prepareGardenAction(coins,3,grown,design,{kind:'claim',project:project.id})).toBeUndefined();}
    expect(coins).toBe(0);expect(design.owned).toEqual(['bench','butterflies','lantern']);
    const hidden=prepareGardenAction(0,3,grown,design,{kind:'toggle',project:'lantern'})!;expect(hidden.design.placed).not.toContain('lantern');expect(design.placed).toContain('lantern');
    const shown=prepareGardenAction(0,3,grown,hidden.design,{kind:'toggle',project:'lantern'})!;expect(shown.design.placed).toContain('lantern');expect(shown.cost).toBe(0);
    design=prepareGardenAction(0,3,grown,design,{kind:'flower',plot:1,flower:'meadow'})!.design;
    design=prepareGardenAction(0,3,grown,design,{kind:'flower',plot:2,flower:'meadow'})!.design;
    expect(validateGardenDesign(design,3,grown)?.owned).toEqual(['bench','butterflies','lantern']);
    expect(prepareGardenAction(19,3,grown,diverse(),{kind:'claim',project:'lantern'})).toBeUndefined();
    expect(prepareGardenAction(50,3,grown,freshGardenDesign(),{kind:'toggle',project:'lantern'})).toBeUndefined();
  });
  it('잘못된 schema/꽃/배열 hole/중복·미소유배치/불가능 소유 조건을 엄격히 거절합니다',()=>{
    const flowers=freshGardenDesign().flowers;delete flowers[0];const owned=Array(1),placed=Array(1);
    for(const value of [null,[],{}, {...freshGardenDesign(),schema:2},{...freshGardenDesign(),extra:true},{...freshGardenDesign(),flowers:[]},{...freshGardenDesign(),flowers:['bad','meadow','meadow','meadow','meadow']},{...freshGardenDesign(),flowers},{...freshGardenDesign(),owned},{...freshGardenDesign(),placed},
      {...freshGardenDesign(),owned:['bench','bench']},{...freshGardenDesign(),owned:['unknown']},{...freshGardenDesign(),placed:['bench']},{...freshGardenDesign(),owned:['bench'],placed:['bench','bench']}])expect(validateGardenDesign(value,5,grown)).toBeUndefined();
    expect(validateGardenDesign({...freshGardenDesign(),owned:['bench']},0,grown)).toBeUndefined();
    expect(validateGardenDesign({...freshGardenDesign(),owned:['bench']},1,{growth:19,affection:20})).toBeUndefined();
    expect(validateGardenDesign({...freshGardenDesign(),owned:['lantern']},3,{growth:80,affection:79})).toBeUndefined();
    expect(validateGardenDesign(diverse(),1,grown)).toBeUndefined();
    for(const pip of [{growth:NaN,affection:20},{growth:20,affection:101}])
      for(const current of [undefined,freshGardenDesign()])expect(prepareGardenAction(20,1,pip,current,{kind:'flower',plot:0,flower:'daisy'})).toBeUndefined();
  });
  it('꽃은 색뿐 아니라 모양이 다르고 소유·배치와 열린 칸만 그림에 반영합니다',()=>{
    const design=diverse();design.owned=['bench','butterflies','lantern'];design.placed=['bench','lantern'];const before=JSON.stringify(design),svg=gardenArt(3,false,design);
    expect(svg.match(/data-planted="true"/g)).toHaveLength(3);expect(svg).toContain('data-flower="daisy"');expect(svg).toContain('data-flower="violet"');expect(svg).toContain('data-decoration="bench"');expect(svg).toContain('data-decoration="lantern"');expect(svg).not.toContain('data-decoration="butterflies"');
    expect(flowerArt('meadow').match(/<ellipse/g)).toHaveLength(5);expect(flowerArt('daisy').match(/<ellipse/g)).toHaveLength(10);expect(flowerArt('violet')).toContain('<path');expect(flowerArt('violet')).not.toContain('<ellipse');expect(JSON.stringify(design)).toBe(before);
    for(const color of ['#e9a9b1','#efcd79','#b9add8','#e7afa0','#d7b1d1'])expect(gardenArt(5)).toContain(`fill="${color}"`);
  });
});
describe('선택 필드와 기존 저장 보호',()=>{
  const legacy={version:1,language:'ko',highestLevel:3,completed:[1,2],stars:0,coins:70,garden:1,music:false,sfx:true,tutorialSeen:true};
  const setup=(primary:unknown,backup?:unknown)=>{const disk=new Map([[SAVE_KEY,JSON.stringify(primary)],...(backup?[[BACKUP_KEY,JSON.stringify(backup)]]:[])] as [string,string][]);let writes=0;const store=new SaveStore(()=>({getItem:key=>disk.get(key)??null,setItem:(key,value)=>{writes++;disk.set(key,value);},removeItem:key=>{disk.delete(key);}}));return {store,disk,writes:()=>writes};};
  it('구 저장과 백업은 로드/렌더/재저장만으로 gardenDesign을 삽입하지 않습니다',()=>{
    for(const recover of [false,true]){const h=setup(recover?null:legacy,recover?legacy:undefined),raw=h.disk.get(SAVE_KEY),save=h.store.load();expect(save).toEqual(legacy);gardenArt(save.garden,false,save.gardenDesign);expect(h.writes()).toBe(0);expect(h.disk.get(SAVE_KEY)).toBe(raw);expect(h.store.save(save)).toBe(true);expect(JSON.parse(h.disk.get(SAVE_KEY)!)).not.toHaveProperty('gardenDesign');}
  });
  it('선택/소유/배치는 reload로 복원하며 꽃 변경으로 다양성이 줄어도 소유를 잃지 않습니다',()=>{
    const h=setup(legacy),save=h.store.load(),design=freshGardenDesign();design.owned=['bench'];design.placed=['bench'];expect(h.store.save({...save,pip:{growth:20,affection:20,owned:[],equipped:'none'},gardenDesign:design})).toBe(true);expect(h.store.load().gardenDesign).toEqual(design);
  });
  it('손상된 선택 primary는 유효 backup을 읽고 원문을 보존하며 손상 backup 저장은 거절합니다',()=>{
    const bad={...legacy,gardenDesign:{...freshGardenDesign(),placed:['lantern']}},h=setup(bad,legacy),raw=h.disk.get(SAVE_KEY);expect(h.store.load()).toEqual(legacy);expect(h.store.status.load).toBe('recovered');expect(h.disk.get(SAVE_KEY)).toBe(raw);expect(h.store.save(bad as never)).toBe(false);
  });
});
