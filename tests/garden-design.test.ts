import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {freshGardenDesign,gardenDesignFor,gardenProjects,gardenThemes,projectReady,themeReady,prepareGardenAction,validateGardenDesign,flowerDiversity,type GardenDesign} from '../src/gardenDesign';
import {gardenArt,flowerArt} from '../src/GardenArt';
import {SaveStore,SAVE_KEY,BACKUP_KEY} from '../src/state';
const grown={growth:100,affection:100};
const diverse=():GardenDesign=>({...freshGardenDesign(),flowers:['meadow','daisy','violet','meadow','meadow']});

describe('20·40 고유 완료의 영구 풍경',()=>{
  it('완료·꽃밭·성장·친밀도 경계와80코인 일회 소유/무료 전환을 검증하고 기존 행동에도 context를 보존합니다',()=>{
    for(const theme of gardenThemes){
      const pip={growth:theme.growth,affection:theme.affection};expect(themeReady(theme,theme.plots,pip,theme.clears)).toBe(true);
      for(const [plots,care,clears] of [[theme.plots-1,pip,theme.clears],[theme.plots,{...pip,growth:pip.growth-1},theme.clears],[theme.plots,{...pip,affection:pip.affection-1},theme.clears],[theme.plots,pip,theme.clears-1]] as const)expect(prepareGardenAction(80,plots,care,undefined,{kind:'buyTheme',theme:theme.id},clears)).toBeUndefined();
      expect(prepareGardenAction(79,theme.plots,pip,undefined,{kind:'buyTheme',theme:theme.id},theme.clears)).toBeUndefined();
      const original=freshGardenDesign(),bought=prepareGardenAction(80,theme.plots,pip,original,{kind:'buyTheme',theme:theme.id},theme.clears)!;
      expect(bought).toMatchObject({coins:0,cost:80,design:{ownedThemes:[theme.id],theme:theme.id}});expect(original).toEqual(freshGardenDesign());
      expect(prepareGardenAction(80,theme.plots,pip,bought.design,{kind:'buyTheme',theme:theme.id},theme.clears)).toBeUndefined();
      expect(prepareGardenAction(0,theme.plots,pip,bought.design,{kind:'selectTheme',theme:theme.id},theme.clears)).toBeUndefined();
      const plain=prepareGardenAction(0,theme.plots,pip,bought.design,{kind:'selectTheme',theme:'meadow'},theme.clears)!;expect(plain.cost).toBe(0);expect(plain.design.ownedThemes).toEqual([theme.id]);
      expect(prepareGardenAction(0,theme.plots,pip,plain.design,{kind:'selectTheme',theme:theme.id},theme.clears)?.design.theme).toBe(theme.id);
      const flowers=prepareGardenAction(0,theme.plots,pip,bought.design,{kind:'flower',plot:0,flower:'daisy'},theme.clears)!;expect(flowers.design.theme).toBe(theme.id);expect(flowers.design.ownedThemes).toEqual([theme.id]);
      expect(prepareGardenAction(0,theme.plots,pip,bought.design,{kind:'flower',plot:0,flower:'daisy'})).toBeUndefined();
      const copy=gardenDesignFor(bought.design);copy.ownedThemes!.push(theme.id==='sunset'?'starlight':'sunset');expect(bought.design.ownedThemes).toEqual([theme.id]);
    }
  });
  it('선택 필드 누락을 유지하고 손상·미소유·불가능 소유·중복/hole 배열을 거절합니다',()=>{
    for(const value of [null,'meadow',['bad'],['sunset','sunset'],['sunset','starlight','sunset'],Array(1)])expect(validateGardenDesign({...freshGardenDesign(),ownedThemes:value},5,grown,40)).toBeUndefined();
    for(const theme of [null,'other','sunset','starlight'])expect(validateGardenDesign({...freshGardenDesign(),theme},5,grown,40)).toBeUndefined();
    expect(validateGardenDesign({...freshGardenDesign(),ownedThemes:['sunset'],theme:'sunset'},5,grown,19)).toBeUndefined();
    expect(validateGardenDesign({...freshGardenDesign(),ownedThemes:['starlight'],theme:'starlight'},5,grown,39)).toBeUndefined();
    expect(validateGardenDesign(freshGardenDesign(),5,grown,40)).not.toHaveProperty('ownedThemes');expect(validateGardenDesign(freshGardenDesign(),5,grown,40)).not.toHaveProperty('theme');
    expect(prepareGardenAction(80,5,grown,undefined,{kind:'selectTheme',theme:'sunset'},40)).toBeUndefined();
  });
  it('기본 초원12출력을 변경 전 SHA로 유지하고 풍경만 바꿔 꽃·장식·위치를 보존합니다',()=>{
    const hashes=['7a4cd2fa1a3e1302a68efa253799ce37b66a5a6c05b7363aa7adaaf43d4349c3','7a4cd2fa1a3e1302a68efa253799ce37b66a5a6c05b7363aa7adaaf43d4349c3','d56b0931e16074d5f2b4bfdc33ec2f5f1d4e5254b03827cc9e165ca2a42b9f84','eb321f77eb4fe81affcad706af94e78ca419dd666dcc7db07a82dd947a7c074b','9b8d0bd19443173d6e6548a7ba8a8c23f745dc165c61a6f63a7dacff7de5e6b2','f1eba1c7b96a88ae473301f1ad004150c1ea32b7c434d08dedba2777fbf04b16','6576965b607f947f9907e826e0fe332f4fe170804b83298e1c4f75260ee475c6','5bffb6642e9b64fab2fd76f2ac13dc875a5c64872a1fe7f426d09b0aecadfa9b','33be60065725a4bdb3f5df7f1d4516090145dd3e8b33ca45736da0f59153b02e','c9b160d470e5107617f5f698e04ab505737e01dd221147490e819366f186c435','cebd99f28cb6430bd0d3cc26266dbd02e69af14eec66f672b79043ec74762143','a551d6382b61f43214922290200c7abf6c58c411e28a67cdb011ab3a77822bda'];
    let index=0;for(let stage=0;stage<=5;stage++)for(const celebrate of [false,true]){const image=gardenArt(stage,celebrate);expect(createHash('sha256').update(image).digest('hex')).toBe(hashes[index++]);expect(gardenArt(stage,celebrate,{...freshGardenDesign(),theme:'meadow'})).toBe(image);}
    for(const theme of gardenThemes){const design:GardenDesign={...diverse(),owned:['bench','lantern'],placed:['bench','lantern'],lanternPlot:4,ownedThemes:[theme.id],theme:theme.id},before=JSON.stringify(design),image=gardenArt(5,false,design);expect(image).toContain(`data-sky="${theme.id}"`);expect(image).toContain(theme.id==='sunset'?'#f8dcbd':'#282b50');expect(image).toContain('data-flower="daisy"');expect(image).toContain('data-flower="violet"');expect(image).toContain('data-decoration="bench"');expect(image).toContain('data-decoration="lantern" transform="translate(405 244)"');expect(JSON.stringify(design)).toBe(before);expect(image).not.toContain('animate');}
  });
});
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
    expect(prepareGardenAction(0,5,grown,undefined,{kind:'placeLantern',plot:4})).toBeUndefined();
    for(let plot=0;plot<5;plot++){
      const before=JSON.stringify(design),moved=prepareGardenAction(0,5,grown,design,{kind:'placeLantern',plot})!;
      expect(moved).toMatchObject({coins:0,cost:0,design:{lanternPlot:plot}});expect(JSON.stringify(design)).toBe(before);
      expect(prepareGardenAction(0,5,grown,moved.design,{kind:'placeLantern',plot})).toBeUndefined();
      const hidden=prepareGardenAction(0,5,grown,moved.design,{kind:'toggle',project:'lantern'})!;
      const restored=prepareGardenAction(0,5,grown,hidden.design,{kind:'placeLantern',plot})!;expect(restored.design.placed).toContain('lantern');expect(restored.design.lanternPlot).toBe(plot);design=restored.design;
    }
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
    const lantern={...freshGardenDesign(),owned:['lantern'],placed:[]} as GardenDesign;
    for(const lanternPlot of [null,NaN,Infinity,-1,.5,3,5,'0',[],Array(1)]){
      expect(validateGardenDesign({...lantern,lanternPlot},3,grown)).toBeUndefined();
      expect(prepareGardenAction(0,3,grown,lantern,{kind:'placeLantern',plot:lanternPlot as number})).toBeUndefined();
    }
    expect(validateGardenDesign({...freshGardenDesign(),lanternPlot:0},3,grown)).toBeUndefined();
    expect(validateGardenDesign({...lantern,lanternPlot:undefined},3,grown)).not.toHaveProperty('lanternPlot');
  });
  it('꽃은 색뿐 아니라 모양이 다르고 소유·배치와 열린 칸만 그림에 반영합니다',()=>{
    const design=diverse();design.owned=['bench','butterflies','lantern'];design.placed=['bench','lantern'];const before=JSON.stringify(design),svg=gardenArt(3,false,design);
    expect(svg.match(/data-planted="true"/g)).toHaveLength(3);expect(svg).toContain('data-flower="daisy"');expect(svg).toContain('data-flower="violet"');expect(svg).toContain('data-decoration="bench"');expect(svg).toContain('data-decoration="lantern"');expect(svg).not.toContain('data-decoration="butterflies"');
    expect(flowerArt('meadow').match(/<ellipse/g)).toHaveLength(5);expect(flowerArt('daisy').match(/<ellipse/g)).toHaveLength(10);expect(flowerArt('violet')).toContain('<path');expect(flowerArt('violet')).not.toContain('<ellipse');expect(JSON.stringify(design)).toBe(before);
    for(const color of ['#e9a9b1','#efcd79','#b9add8','#e7afa0','#d7b1d1'])expect(gardenArt(5)).toContain(`fill="${color}"`);
    expect(svg).toContain('data-decoration="lantern" transform="translate(419 217)"');expect(design).not.toHaveProperty('lanternPlot');
    const positions=[[211,173],[338,161],[454,178],[270,244],[405,244]];
    for(let plot=0;plot<5;plot++){
      const [x,y]=positions[plot],image=gardenArt(5,false,{...design,lanternPlot:plot});expect(image).toContain(`data-decoration="lantern" transform="translate(${x} ${y})"`);
      expect(x).toBeGreaterThanOrEqual(205);expect(x+25).toBeLessThanOrEqual(480);expect(y-43).toBeGreaterThanOrEqual(0);expect(y+16).toBeLessThanOrEqual(280);
    }
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
    expect(h.store.load().gardenDesign).not.toHaveProperty('lanternPlot');
    const lantern:GardenDesign={...freshGardenDesign(),owned:['lantern'],placed:['lantern'],lanternPlot:4};expect(h.store.save({...h.store.load(),garden:5,pip:{growth:100,affection:100,owned:[],equipped:'none'},gardenDesign:lantern})).toBe(true);expect(h.store.load().gardenDesign).toEqual(lantern);
  });
  it('손상된 선택 primary는 유효 backup을 읽고 원문을 보존하며 손상 backup 저장은 거절합니다',()=>{
    const bad={...legacy,gardenDesign:{...freshGardenDesign(),placed:['lantern']}},h=setup(bad,legacy),raw=h.disk.get(SAVE_KEY);expect(h.store.load()).toEqual(legacy);expect(h.store.status.load).toBe('recovered');expect(h.disk.get(SAVE_KEY)).toBe(raw);expect(h.store.save(bad as never)).toBe(false);
    const broken=setup({...legacy,gardenDesign:{...freshGardenDesign(),lanternPlot:null}},legacy),brokenRaw=broken.disk.get(SAVE_KEY);expect(broken.store.load()).toEqual(legacy);expect(broken.disk.get(SAVE_KEY)).toBe(brokenRaw);
  });
  it('풍경 소유는 completed 정규화 뒤 고유 범위 개수를 검증하고 구 필드를 삽입하지 않습니다',()=>{
    const base={...legacy,highestLevel:40,garden:5,coins:200,pip:{...grown,owned:[],equipped:'none'}},theme={...freshGardenDesign(),ownedThemes:['sunset'],theme:'sunset'};
    for(const completed of [Array(20).fill(1),[...Array.from({length:19},(_,i)=>i+1),0,41,1.5,'20']]){const h=setup({...base,completed,gardenDesign:theme},legacy),raw=h.disk.get(SAVE_KEY);expect(h.store.load()).toEqual(legacy);expect(h.store.status.load).toBe('recovered');expect(h.disk.get(SAVE_KEY)).toBe(raw);}
    const h=setup({...base,completed:[...Array.from({length:20},(_,i)=>i+1),1,2,41],gardenDesign:theme}),save=h.store.load();expect(save.completed).toHaveLength(20);expect(save.gardenDesign?.theme).toBe('sunset');expect(h.writes()).toBe(0);expect(h.store.save(save)).toBe(true);expect(h.store.load().gardenDesign?.ownedThemes).toEqual(['sunset']);
    const old=setup({...base,completed:Array.from({length:40},(_,i)=>i+1),gardenDesign:freshGardenDesign()}),oldSave=old.store.load();expect(oldSave.gardenDesign).not.toHaveProperty('ownedThemes');expect(oldSave.gardenDesign).not.toHaveProperty('theme');expect(old.store.save(oldSave)).toBe(true);expect(old.store.load().gardenDesign).not.toHaveProperty('theme');
    const stars=setup({...base,completed:Array.from({length:40},(_,i)=>i+1),gardenDesign:{...theme,ownedThemes:['sunset','starlight'],theme:'starlight'}});expect(stars.store.load().gardenDesign?.theme).toBe('starlight');
  });
});
