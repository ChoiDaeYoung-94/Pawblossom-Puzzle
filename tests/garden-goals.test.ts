import {describe,it,expect} from 'vitest';
import {gardenGoals,goalNextStep,nextGardenGoal,newlyReadyGardenGoal,type GoalState} from '../src/GardenGoals';
import {freshGardenDesign} from '../src/gardenDesign';
import {freshGardenSpaces} from '../src/gardenSpaces';
import {journeyProjectSpecs} from '../src/journeyGarden';
const fresh=():GoalState=>({plots:0,pip:{growth:0,affection:0},clears:0,stars:0,coins:0});
describe('저장과 소비 없는 공동 정원 목표',()=>{
  it('구 저장의 optional 부재·입력 객체를 렌더/조회로 채우지 않고 완료 소유도 추측하지 않습니다',()=>{
    const state=Object.freeze({...fresh(),pip:Object.freeze({growth:100,affection:100}),plots:5,clears:100,stars:100,coins:2000});
    const before=JSON.stringify(state),goals=gardenGoals(state);expect(goals).toHaveLength(36);expect(goals.filter(g=>g.done)).toHaveLength(5);expect(nextGardenGoal(goals)?.id).toBe('bench');expect(JSON.stringify(state)).toBe(before);expect('design' in state).toBe(false);
  });
  it('가능한 행동을 먼저 권하고 잔액이 없으면 첫 부족 조건과 퍼즐 이동을 제시합니다',()=>{
    const state=fresh(),goals=gardenGoals(state);expect(nextGardenGoal(goals)?.id).toBe('bed-1');expect(goalNextStep(goals[0])).toMatchObject({destination:'map',missing:{kind:'stars',current:0,required:2}});
    state.stars=2;expect(goalNextStep(nextGardenGoal(gardenGoals(state))!)).toEqual({destination:'flowers',missing:undefined});
    for(const goal of gardenGoals(state).filter(g=>g.kind==='bed'&&g.name!=='1'))expect(goalNextStep(goal)?.missing?.kind).toBe('plots');
    state.plots=1;state.stars=0;state.coins=10;expect(goalNextStep(nextGardenGoal(gardenGoals(state))!)).toMatchObject({destination:'pip',missing:{kind:'growth',current:0,required:20}});
  });
  it('성장·친밀도·다양성·코인 부족을 실제 spec 순서대로 읽고 조건 충족만으로 소유를 만들지 않습니다',()=>{
    const state={...fresh(),plots:3,pip:{growth:80,affection:20},design:freshGardenDesign(),coins:20};
    state.design.owned=['bench','butterflies'];const lantern=()=>gardenGoals(state).find(g=>g.id==='lantern')!;
    expect(goalNextStep(lantern())).toMatchObject({destination:'pip',missing:{kind:'affection',required:80}});
    state.pip.affection=80;expect(goalNextStep(lantern())).toMatchObject({destination:'flowers',missing:{kind:'diversity',required:3}});
    state.design.flowers=['meadow','daisy','violet','meadow','meadow'];state.coins=19;expect(goalNextStep(lantern())).toMatchObject({destination:'map',missing:{kind:'coins',required:20}});
    state.coins=20;expect(goalNextStep(lantern())).toEqual({destination:'flowers',missing:undefined});expect(lantern().done).toBe(false);
  });
  it('복원2단계는 기초 선행과 서로 다른 첫 완료·별을 검사하고 실제 단계만 완료로 표시합니다',()=>{
    const state={...fresh(),plots:5,clears:100,stars:100,design:{...freshGardenDesign(),spaces:freshGardenSpaces()}};
    const pond=()=>gardenGoals(state).find(g=>g.id==='pond-2')!;
    expect(goalNextStep(pond())).toMatchObject({destination:'pond',missing:{kind:'foundation',required:1}});
    state.design.spaces.pond.phase=1;state.clears=59;expect(goalNextStep(pond())).toMatchObject({destination:'map',missing:{kind:'clears',required:60}});
    state.clears=60;state.stars=11;expect(goalNextStep(pond())).toMatchObject({destination:'map',missing:{kind:'stars',required:12}});
    state.stars=12;expect(goalNextStep(pond())?.missing).toBeUndefined();state.design.spaces.pond.phase=2;expect(pond().done).toBe(true);expect(goalNextStep(pond())).toBeUndefined();
  });
  it('초반 정원을 마쳐도 여행 복원을 남겨두고 실제36단계 소유 뒤에만 계획을 끝냅니다',()=>{
    const design={...freshGardenDesign(),owned:['bench','butterflies','lantern'] as const,ownedThemes:['sunset','starlight'] as const,spaces:freshGardenSpaces()};
    const state:GoalState={plots:5,pip:{growth:100,affection:100},design:{...design,owned:[...design.owned],ownedThemes:[...design.ownedThemes]},clears:100,coins:0,stars:0};
    for(const space of Object.values(state.design!.spaces!))space.phase=2;
    const goals=gardenGoals(state);expect(goals.filter(g=>g.done)).toHaveLength(16);expect(nextGardenGoal(goals)?.id).toBe('journey-conservatory-1');
    state.clears=500;state.design!.journeyProjects=Object.fromEntries(journeyProjectSpecs.map(s=>[s.id,{phase:2,altOwned:false,style:'base'}]));
    expect(gardenGoals(state)).toHaveLength(36);expect(gardenGoals(state).every(g=>g.done)).toBe(true);expect(nextGardenGoal(gardenGoals(state))).toBeUndefined();
  });
  it('여행은100판부터 보이며 기초·현재완료·별 순서로 실제 작품에 연결하고 재플레이 수입을 약속하지 않습니다',()=>{
    const state:GoalState={...fresh(),clears:99,stars:30};
    expect(gardenGoals(state)).toHaveLength(16);state.clears=100;
    const goal=(phase:1|2)=>gardenGoals(state).find(g=>g.id===`journey-lotus-${phase}`)!;
    expect(gardenGoals(state)).toHaveLength(36);expect(goal(1)).toMatchObject({project:'lotus',done:false});
    expect(goalNextStep(goal(1))).toMatchObject({destination:'map',missing:{kind:'clears',required:160}});
    expect(goalNextStep(goal(2))).toMatchObject({destination:'journey',missing:{kind:'foundation',required:1}});
    state.clears=180;state.design={...freshGardenDesign(),journeyProjects:{lotus:{phase:1,altOwned:false,style:'base'}}};state.stars=24;
    expect(goal(1).done).toBe(true);expect(goalNextStep(goal(2))).toMatchObject({destination:'map',missing:{kind:'stars',required:25}});
    state.stars=25;expect(goalNextStep(goal(2))).toEqual({destination:'journey',missing:undefined});
    state.clears=500;state.stars=0;expect(goalNextStep(goal(2))).toMatchObject({destination:'journey',unavailableIncome:true});
  });
  it('100판 이후 새보상을 안내하고500판 소진 뒤 재플레이 수입을 약속하지 않습니다',()=>{
    const state:GoalState={...fresh(),plots:5,pip:{growth:100,affection:100},clears:500,design:{...freshGardenDesign(),flowers:['meadow','daisy','violet','meadow','meadow'],owned:['bench','butterflies']}};
    const earlier=gardenGoals({...state,clears:100}).find(g=>g.id==='lantern')!;expect(goalNextStep(earlier)).toMatchObject({destination:'map',missing:{kind:'coins'}});expect(goalNextStep(earlier)).not.toHaveProperty('unavailableIncome');
    const lantern=gardenGoals(state).find(g=>g.id==='lantern')!;expect(goalNextStep(lantern)).toMatchObject({destination:'flowers',unavailableIncome:true,missing:{kind:'coins'}});
    const pond=gardenGoals(state).find(g=>g.id==='pond-1')!;expect(goalNextStep(pond)).toMatchObject({destination:'flowers',unavailableIncome:true,missing:{kind:'stars'}});
    state.pip={growth:0,affection:0};state.plots=1;state.design=undefined;
    expect(goalNextStep(gardenGoals(state).find(g=>g.id==='bench')!)).toMatchObject({destination:'flowers',unavailableIncome:true,missing:{kind:'coins',required:10}});
  });
});


describe('이번 보상으로 준비된 작업',()=>{
  it('별1→2로 가능한 첫 꽃밭을 고르고 이미 가능했던 계획·완료 작업은 안내하지 않는다',()=>{
    const before=gardenGoals({...fresh(),clears:1,stars:1,coins:40}),after=gardenGoals({...fresh(),clears:2,stars:2,coins:80});
    expect(newlyReadyGardenGoal(before,after)?.id).toBe('bed-1');expect(newlyReadyGardenGoal(after,after)).toBeUndefined();
    expect(newlyReadyGardenGoal(before,gardenGoals({...fresh(),plots:1,clears:2,stars:0,coins:80}))).toBeUndefined();
  });
  it('여러 새 작업은 기존 계획 순서로 하나만 고르며 전후 목록을 변경하지 않는다',()=>{
    const state:GoalState={...fresh(),plots:3,pip:{growth:80,affection:80},design:{...freshGardenDesign(),flowers:['meadow','daisy','violet','meadow','meadow']}};
    const before=gardenGoals({...state,clears:49,stars:43,coins:0}),after=gardenGoals({...state,clears:50,stars:44,coins:40});
    const original=JSON.stringify({before,after});expect(after.filter(g=>!g.done&&!goalNextStep(g)?.missing).length).toBeGreaterThan(1);
    expect(newlyReadyGardenGoal(before,after)?.id).toBe('lantern');expect(newlyReadyGardenGoal(before,after.filter(goal=>goal.id!=='lantern'))?.id).toBe('pond-1');expect(JSON.stringify({before,after})).toBe(original);
  });
});
