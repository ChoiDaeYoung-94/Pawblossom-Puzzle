import {describe,it,expect} from 'vitest';
import {freshPip,pipLevel,careCost,preparePipAction,validatePip} from '../src/pipCare';
import {SaveStore,SAVE_KEY,BACKUP_KEY} from '../src/state';

describe('핍 육성과 저장 확장',()=>{
  it('먹이·놀이의 다른 효과와 확정 가격을 적용하고 원본을 보존합니다',()=>{
    const original=freshPip(),feed=preparePipAction(40,original,'feed')!;
    expect(feed).toEqual({coins:30,cost:10,pip:{growth:10,affection:4,owned:[],equipped:'none'}});
    const play=preparePipAction(feed.coins,feed.pip,'play')!;
    expect(play.pip).toMatchObject({growth:14,affection:14});expect(play.coins).toBe(20);
    expect(original).toEqual(freshPip());expect(preparePipAction(9,original,'feed')).toBeUndefined();
  });
  it('성장 단계에서 소품과 반응이 열리고, 중복 구매는 없으며 장착 변경은 무료입니다',()=>{
    expect(pipLevel({...freshPip(),growth:19})).toBe(1);expect(pipLevel({...freshPip(),growth:20})).toBe(2);expect(pipLevel({...freshPip(),growth:60})).toBe(3);
    expect(preparePipAction(100,freshPip(),'buyRibbon')).toBeUndefined();
    const ribbon=preparePipAction(120,{...freshPip(),growth:20},'buyRibbon')!;
    expect(ribbon.coins).toBe(80);expect(ribbon.pip.equipped).toBe('ribbon');
    expect(preparePipAction(120,ribbon.pip,'buyRibbon')).toBeUndefined();
    expect(preparePipAction(120,ribbon.pip,'buyWateringCan')).toBeUndefined();
    const can=preparePipAction(80,{...ribbon.pip,growth:60},'buyWateringCan')!;
    expect(can.coins).toBe(0);expect(can.pip.owned).toEqual(['ribbon','wateringCan']);
    expect(preparePipAction(0,can.pip,'equipRibbon')).toMatchObject({coins:0,cost:0,pip:{equipped:'ribbon'}});
    expect(preparePipAction(0,can.pip,'equipNone')).toMatchObject({coins:0,cost:0,pip:{equipped:'none'}});
  });
  it('수치는 100을 넘지 않고 두 수치가 모두 가득 차면 재화를 쓰지 않습니다',()=>{
    const partial={...freshPip(),growth:99,affection:98};
    expect(careCost(partial)).toBe(10);
    const capped=preparePipAction(10,partial,'feed')!;
    expect(capped.pip).toMatchObject({growth:100,affection:100});
    expect(preparePipAction(0,capped.pip,'play')).toMatchObject({coins:0,cost:0,pip:{growth:100,affection:100}});
    for(const action of ['feed','play'] as const){
      let current=freshPip(),coins=250;
      for(let count=0;count<25;count++){const result=preparePipAction(coins,current,action)!;expect(result.cost).toBe(10);current=result.pip;coins=result.coins;}
      expect({coins,growth:current.growth,affection:current.affection}).toEqual({coins:0,growth:100,affection:100});expect(preparePipAction(coins,current,action)?.cost).toBe(0);
    }
  });
  it('손상된 신규 수치·소유·장착 조건을 허용하지 않습니다',()=>{
    for(const value of [null,[],{...freshPip(),growth:-1},{...freshPip(),growth:1.5},{...freshPip(),affection:101},
      {...freshPip(),owned:['ribbon']},{...freshPip(),growth:60,owned:['ribbon','ribbon']},
      {...freshPip(),growth:60,owned:['unknown']},{...freshPip(),equipped:'ribbon'},
      {...freshPip(),equipped:'unknown'}])expect(validatePip(value)).toBeUndefined();
    expect(validatePip({...freshPip(),growth:60,owned:['wateringCan'],equipped:'wateringCan'})).toBeDefined();
  });
  it('핍 필드가 없는 기존 primary와 backup을 별·코인·꽃밭 손실 없이 읽습니다',()=>{
    const old={version:1,language:'ko',highestLevel:3,completed:[1,2],stars:0,coins:70,garden:1,music:false,sfx:true,tutorialSeen:true};
    for(const recover of [false,true]){
      const disk=new Map([[SAVE_KEY,recover?'{':JSON.stringify(old)],[BACKUP_KEY,JSON.stringify(old)]]);
      const store=new SaveStore(()=>({getItem:key=>disk.get(key)??null,setItem:(key,value)=>{disk.set(key,value);},removeItem:key=>{disk.delete(key);}}));
      const save=store.load();expect(save).toEqual({...old,version:2,puzzleTools:{schema:1,introduced:[],trialUsed:[]}});expect(save.pip??freshPip()).toEqual(freshPip());
      expect(store.save({...save,pip:{...freshPip(),growth:10,affection:4},coins:60})).toBe(true);
      expect(store.load()).toMatchObject({stars:0,garden:1,coins:60,pip:{growth:10,affection:4}});
    }
  });
  it('잘못된 신규 필드가 있는 primary는 유효 backup으로 복구하며 원문을 자동 삭제하지 않습니다',()=>{
    const store=new SaveStore(()=>storage),disk=new Map<string,string>();
    const storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value);},removeItem:(key:string)=>{disk.delete(key);}};
    const good={...store.load(),coins:80,pip:{...freshPip(),growth:20}};
    disk.set(SAVE_KEY,JSON.stringify({...good,pip:{...good.pip,affection:NaN}}));disk.set(BACKUP_KEY,JSON.stringify(good));
    const raw=disk.get(SAVE_KEY);expect(store.load()).toEqual(good);expect(store.status.load).toBe('recovered');expect(disk.get(SAVE_KEY)).toBe(raw);
  });
});
