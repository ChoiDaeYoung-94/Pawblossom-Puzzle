import {afterEach,describe,expect,it,vi} from 'vitest';
import {BoardEffects} from '../src/BoardEffects';
import type {ResolveStep} from '../src/core';

class ObjectStub {
  destroyed=false;name='';x=0;y=0;
  constructor(public kind:string,public value=''){}
  setDepth(){return this;}setName(name:string){this.name=name;return this;}setOrigin(){return this;}
  setPosition(x:number,y:number){this.x=x;this.y=y;return this;}setDisplaySize(){return this;}setAngle(){return this;}
  lineStyle(){return this;}fillStyle(){return this;}strokeRoundedRect(){return this;}fillRoundedRect(){return this;}
  lineBetween(){return this;}strokeCircle(){return this;}destroy(){this.destroyed=true;}
}
function harness(){
  const objects:ObjectStub[]=[],tweens:Record<string,unknown>[]=[],killed:unknown[]=[];
  const add=(kind:string,value='')=>{const obj=new ObjectStub(kind,value);objects.push(obj);return obj;};
  const scene={add:{graphics:()=>add('graphics'),text:(_x:number,_y:number,text:string)=>add('text',text),image:(_x:number,_y:number,key:string)=>add('image',key)},
    tweens:{add:(config:Record<string,unknown>)=>tweens.push(config),killTweensOf:(target:unknown)=>killed.push(target)}};
  const effects=new BoardEffects(scene as never);
  const finish=()=>tweens.forEach(config=>(config.onComplete as ()=>void)());
  return {effects,objects,tweens,killed,finish};
}
const step:ResolveStep={before:[],after:[],removed:Array.from({length:64},(_,i)=>({row:Math.floor(i/8),col:i%8})),effects:[{row:2,col:2,special:'row'},{row:4,col:4,special:'bomb'}]};
afterEach(()=>vi.unstubAllGlobals());
describe('낙엽과 퍼즐 임시 연출',()=>{
  it('겹 감소와 완전 제거를 서로 다른 기호로 표시하고 실제 변경 값만 사용합니다',()=>{
    const h=harness();h.effects.leafHit({row:2,col:2,before:2,after:1});
    expect(h.objects.filter(obj=>obj.kind==='text').map(obj=>obj.value)).toEqual(['2 → 1']);
    expect(h.objects.filter(obj=>obj.name==='leaf-chip')).toHaveLength(2);
    h.effects.leafHit({row:3,col:3,before:2,after:0});
    expect(h.objects.filter(obj=>obj.kind==='text').at(-1)?.value).toBe('✓');
    expect(h.objects.filter(obj=>obj.name==='leaf-chip')).toHaveLength(6);
    h.finish();expect(h.effects.activeCount).toBe(0);expect(h.objects.every(obj=>obj.destroyed)).toBe(true);
  });
  it('대량 제거와 특수 연쇄에도 임시 객체 상한을 지키고 종료 시 tween을 정리합니다',()=>{
    const h=harness();for(let i=0;i<40;i++)h.effects.leafHit({row:i%8,col:0,before:2,after:0});
    expect(h.effects.activeCount).toBeLessThanOrEqual(120);
    expect(h.objects.filter(obj=>!obj.destroyed)).toHaveLength(h.effects.activeCount);
    h.effects.clear();expect(h.killed).toHaveLength(120);expect(h.effects.activeCount).toBe(0);
    expect(h.objects.every(obj=>obj.destroyed)).toBe(true);h.finish();expect(h.effects.activeCount).toBe(0);
  });
  it('64칸 매치는 장식 수를 제한하고 특수 범위가 중복돼도 한 번만 쓸어갑니다',()=>{
    const h=harness();h.effects.match(step,3);expect(h.objects.filter(obj=>obj.name==='match-spark').length).toBeLessThanOrEqual(12);
    h.effects.special({...step,effects:[...step.effects!,{row:2,col:5,special:'row'}]});
    expect(h.objects.filter(obj=>obj.name==='special-sweep')).toHaveLength(1);
    expect(h.objects.filter(obj=>obj.name==='special-ripple')).toHaveLength(1);
    h.finish();expect(h.effects.activeCount).toBe(0);
  });
  it('움직임 줄이기에서는 겹 숫자와 완료 표시는 남기고 날림·이동 장식을 생략합니다',()=>{
    vi.stubGlobal('window',{matchMedia:()=>({matches:true})});
    const h=harness();h.effects.leafHit({row:1,col:1,before:2,after:1});h.effects.match(step,1);h.effects.special(step);
    expect(h.objects.map(obj=>obj.name)).toEqual(['leaf-hit-pulse','leaf-hit-label']);
    expect(h.tweens.every(config=>config.x===undefined&&config.y===undefined&&config.angle===undefined)).toBe(true);
    expect(h.objects[1].value).toBe('2 → 1');h.finish();expect(h.effects.activeCount).toBe(0);
  });
});
