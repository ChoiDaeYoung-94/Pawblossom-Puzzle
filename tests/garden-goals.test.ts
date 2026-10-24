import {describe,it,expect} from 'vitest';
import {gardenGoals,goalNextStep,nextGardenGoal,type GoalState} from '../src/GardenGoals';
import {freshGardenDesign} from '../src/gardenDesign';
import {freshGardenSpaces} from '../src/gardenSpaces';
const fresh=():GoalState=>({plots:0,pip:{growth:0,affection:0},clears:0,stars:0,coins:0});
describe('저장과 소비 없는 공동 정원 목표',()=>{
  it('구 저장의 optional 부재·입력 객체를 렌더/조회로 채우지 않고 완료 소유도 추측하지 않습니다',()=>{
    const state=Object.freeze({...fresh(),pip:Object.freeze({growth:100,affection:100}),plots:5,clears:100,stars:100,coins:2000});
    const before=JSON.stringify(state),goals=gardenGoals(state);expect(goals).toHaveLength(16);expect(goals.filter(g=>g.done)).toHaveLength(5);expect(nextGardenGoal(goals)?.id).toBe('bench');expect(JSON.stringify(state)).toBe(before);expect('design' in state).toBe(false);
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
  it('소유한 목표는 나중에 꽃을 바꿔도 다시 권하지 않고 모든 복원 뒤 계획을 끝냅니다',()=>{
    const design={...freshGardenDesign(),owned:['bench','butterflies','lantern'] as const,ownedThemes:['sunset','starlight'] as const,spaces:freshGardenSpaces()};
    const state:GoalState={plots:5,pip:{growth:100,affection:100},design:{...design,owned:[...design.owned],ownedThemes:[...design.ownedThemes]},clears:100,coins:0,stars:0};
    for(const space of Object.values(state.design!.spaces!))space.phase=2;
    const goals=gardenGoals(state);expect(goals.every(g=>g.done)).toBe(true);expect(nextGardenGoal(goals)).toBeUndefined();
  });
  it('100판 첫 보상 소진 뒤 부족 재화를 재플레이로 벌 수 있다고 안내하지 않습니다',()=>{
    const state:GoalState={...fresh(),plots:5,pip:{growth:100,affection:100},clears:100,design:{...freshGardenDesign(),flowers:['meadow','daisy','violet','meadow','meadow'],owned:['bench','butterflies']}};
    const lantern=gardenGoals(state).find(g=>g.id==='lantern')!;expect(goalNextStep(lantern)).toMatchObject({destination:'flowers',unavailableIncome:true,missing:{kind:'coins'}});
    const pond=gardenGoals(state).find(g=>g.id==='pond-1')!;expect(goalNextStep(pond)).toMatchObject({destination:'flowers',unavailableIncome:true,missing:{kind:'stars'}});
    state.pip={growth:0,affection:0};state.plots=1;state.design=undefined;
    expect(goalNextStep(gardenGoals(state).find(g=>g.id==='bench')!)).toMatchObject({destination:'flowers',unavailableIncome:true,missing:{kind:'coins',required:10}});
  });
});
