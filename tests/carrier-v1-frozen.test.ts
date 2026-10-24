import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {CarrierEngine} from '../src/experimental/carrier/CarrierEngine';
import {carrierScenarios} from '../src/experimental/carrier/carrierScenarios';

// 공유 함수 추출 전 게임300168d에서 캡처했습니다. 새 버전의 기대값으로 재생성하지 않습니다.
const expected={
  'first-delivery':'4ef17672748467eba2a5905efa01fb5ae4bdbb0394fed65fe0f4ba51f9421195',
  'align-the-exit':'79a3eba5ce85a31364718d9b5360c86079c470815b9171bfe16ffd0eca6d2012',
  'two-garden-paths':'8e36089e279a0e8f4d39179fe1ae446fdf0ae0c17ad348223fa76696183c5059',
  'full-cap-rollback':'0cf0b60104e89c5596a1e31f4c0956c8126fe8571965e8784112a8bdb3601fe4',
};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

describe('공유 해소 함수 추출 전 v1의 전체 관측 동결',()=>{
  it.each(carrierScenarios)('$level.id의 query/실패/모든 frame·ID·RNG·restart를 보존합니다',scenario=>{
    const e=new CarrierEngine(scenario.level),initial=e.snapshot,moves=e.legalMoves(),matches=e.findMatches(),afterQueries=e.snapshot;
    const invalid=e.swap({row:-1,col:0},{row:0,col:0}),afterInvalid=e.snapshot;
    const actions=scenario.authoredPath.map(({a,b})=>e.swap(a,b));
    const observation={initial,moves,matches,afterQueries,invalid,afterInvalid,actions,restart:e.restart()};
    expect(digest(observation)).toBe(expected[scenario.level.id as keyof typeof expected]);
  });
  it('기존 연쇄 한도 초과의 무효 결과와 전체 rollback을 보존합니다',()=>{
    const e=new CarrierEngine({...carrierScenarios[0].level,cascadeLimit:1}),initial=e.snapshot;
    const {a,b}=carrierScenarios[0].authoredPath[0],result=e.swap(a,b);
    expect(digest({initial,result,after:e.snapshot})).toBe(expected['full-cap-rollback']);
  });
});
