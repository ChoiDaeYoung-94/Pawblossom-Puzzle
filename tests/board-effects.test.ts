import {afterEach,describe,expect,it,vi} from 'vitest';
import {BoardEffects} from '../src/BoardEffects';
import type {ResolveStep} from '../src/core';

class ObjectStub {
  destroyed=false;name='';x=0;y=0;
  rectangles:number[][]=[];lines:number[][]=[];strokes:number[][]=[];
  constructor(public kind:string,public value=''){}
  setDepth(){return this;}setName(name:string){this.name=name;return this;}setOrigin(){return this;}
  setPosition(x:number,y:number){this.x=x;this.y=y;return this;}setDisplaySize(){return this;}setAngle(){return this;}
  lineStyle(){return this;}fillStyle(){return this;}strokeRoundedRect(...values:number[]){this.strokes.push(values);return this;}fillRoundedRect(...values:number[]){this.rectangles.push(values);return this;}
  lineBetween(...values:number[]){this.lines.push(values);return this;}strokeCircle(){return this;}destroy(){this.destroyed=true;}
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
const colorStep=():ResolveStep=>({...step,before:Array.from({length:8},(_,row)=>Array.from({length:8},(_,col)=>({kind:(row+col)%6}))),effects:[{row:0,col:0,special:'rainbow'},{row:1,col:1,special:'rainbow'}]});
afterEach(()=>vi.unstubAllGlobals());
describe('낙엽과 퍼즐 임시 연출',()=>{
  it('실제 상자 칸의 짧은 선·목재 조각은 원본 좌표와 난수를 바꾸지 않고 완료 정리합니다',()=>{
    const h=harness(),hit=Object.freeze({row:3,col:6}),before=JSON.stringify(hit),random=vi.spyOn(Math,'random');
    try{
      h.effects.crateHit(hit);
      const pulse=h.objects.find(obj=>obj.name==='crate-hit-pulse')!;
      expect([pulse.x,pulse.y]).toEqual([380,212]);expect(pulse.strokes).toEqual([[-25,-25,50,50,10]]);
      const chips=h.objects.filter(obj=>obj.name==='crate-wood-chip');expect(chips).toHaveLength(4);
      expect(chips.every(obj=>obj.rectangles[0][2]>obj.rectangles[0][3])).toBe(true);
      expect(h.tweens.every(config=>(config.duration as number)<=300)).toBe(true);
      expect(h.effects.activeCount).toBe(5);expect(random).not.toHaveBeenCalled();expect(JSON.stringify(hit)).toBe(before);
    }finally{random.mockRestore();}
    h.finish();expect(h.effects.activeCount).toBe(0);expect(h.objects.every(obj=>obj.destroyed)).toBe(true);
  });
  it('다중 상자·다른 연출은120개 상한을 공유하고 중간 취소·늦은 완료도 객체를 되살리지 않습니다',()=>{
    const h=harness();for(let i=0;i<40;i++)h.effects.crateHit({row:Math.floor(i/8),col:i%8});
    h.effects.match(step,2);h.effects.special(step);h.effects.leafHit({row:0,col:0,before:1,after:0});
    expect(h.effects.activeCount).toBe(120);expect(h.objects.filter(obj=>!obj.destroyed)).toHaveLength(120);
    h.effects.clear();expect(h.killed).toHaveLength(120);expect(h.objects.every(obj=>obj.destroyed)).toBe(true);
    h.finish();h.effects.clear();expect(h.effects.activeCount).toBe(0);
  });
  it('모션 감소의 상자 타격은 이동·회전·크기 변화 없는 짧은 정적 선만 남깁니다',()=>{
    vi.stubGlobal('window',{matchMedia:()=>({matches:true})});
    const h=harness();h.effects.crateHit({row:1,col:2});
    expect(h.objects.map(obj=>obj.name)).toEqual(['crate-hit-pulse']);expect(h.tweens).toHaveLength(1);
    expect(h.tweens[0]).toMatchObject({alpha:0,duration:180});
    for(const key of ['x','y','angle','scaleX','scaleY'])expect(h.tweens[0]).not.toHaveProperty(key);
    h.finish();expect(h.effects.activeCount).toBe(0);
  });
  it('한 겹 감소는 추가 숫자 팝업 없이 날림만, 완전 제거는 체크를 표시합니다',()=>{
    const h=harness();h.effects.leafHit({row:2,col:2,before:2,after:1});
    expect(h.objects.filter(obj=>obj.kind==='text')).toEqual([]);
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
  it('전조와 짧고 넓은 빔은 실제 행·열을 따르고 겹치는 줄을 중복 표시하지 않습니다',()=>{
    const h=harness(),source={...step,effects:[{row:2,col:1,special:'row' as const},{row:2,col:5,special:'row' as const},{row:3,col:4,special:'column' as const}]};
    const original=JSON.stringify(source);h.effects.anticipate(source);h.effects.special(source);
    expect(h.objects.filter(obj=>obj.name==='special-charge')).toHaveLength(2);
    const beams=h.objects.filter(obj=>obj.name==='special-sweep');expect(beams).toHaveLength(2);
    expect(beams[0].rectangles[0]).toEqual([16-beams[0].x,-11,448,22,10]);
    expect(beams[1].rectangles[0]).toEqual([-11,16-beams[1].y,22,448,10]);
    expect(h.tweens.filter(config=>beams.includes(config.targets as ObjectStub)).every(config=>(config.duration as number)<=250)).toBe(true);
    expect(JSON.stringify(source)).toBe(original);h.finish();expect(h.effects.activeCount).toBe(0);
  });
  it('대량 제거·전조·특수 파편·범위 표시를 같은 상한 안에 넣고 중간 종료도 정리합니다',()=>{
    const h=harness(),overlay=new ObjectStub('graphics');h.objects.push(overlay);
    for(let i=0;i<4;i++){h.effects.anticipate(step);h.effects.match(step,4);h.effects.special(step);}
    h.effects.trackOverlay(overlay as never);
    expect(h.effects.activeCount).toBeLessThanOrEqual(120);
    expect(h.objects.filter(obj=>!obj.destroyed)).toHaveLength(h.effects.activeCount);
    expect(h.objects.some(obj=>obj.name==='tile-fragment')).toBe(true);
    h.effects.clear();expect(h.killed).toHaveLength(120);expect(h.objects.every(obj=>obj.destroyed)).toBe(true);
    h.finish();expect(h.effects.activeCount).toBe(0);
  });
  it('행·열 빛은 원래 칸에서 올바른 축의 양 끝으로만 이동하고 같은 행을 중복하지 않습니다',()=>{
    const h=harness();h.effects.special({...step,effects:[{row:2,col:1,special:'row'},{row:2,col:5,special:'row'},{row:3,col:4,special:'column'}]});
    const motes=h.objects.filter(obj=>obj.name==='special-line-mote');expect(motes).toHaveLength(4);
    const paths=motes.map(obj=>({obj,tween:h.tweens.find(tween=>tween.targets===obj)!}));
    expect(paths.slice(0,2).map(({obj,tween})=>[obj.x,obj.y,tween.x,tween.y])).toEqual([[100,156,16,undefined],[100,156,464,undefined]]);
    expect(paths.slice(2).map(({obj,tween})=>[obj.x,obj.y,tween.x,tween.y])).toEqual([[268,212,undefined,16],[268,212,undefined,464]]);
    expect(paths.every(({tween})=>(tween.duration as number)<=300)).toBe(true);
    h.finish();expect(h.effects.activeCount).toBe(0);expect(motes.every(obj=>obj.destroyed)).toBe(true);
  });
  it('색 연결은 단계당 하나로 제한하고 실제 제거된 타일만 중복·원점 없이 최대 12칸 연결합니다',()=>{
    const h=harness(),source=colorStep();source.before[0][2]=null;
    source.removed=[{row:0,col:0},{row:0,col:1},{row:0,col:1},{row:0,col:2},{row:7,col:7}];
    const original=JSON.stringify(source),random=vi.spyOn(Math,'random');
    try{
      h.effects.special(source);
      const threads=h.objects.filter(obj=>obj.name==='special-color-connections');expect(threads).toHaveLength(1);
      expect(threads[0].lines).toEqual([[44,44,100,44],[44,44,100,44],[44,44,436,436],[44,44,436,436]]);
      expect(random).not.toHaveBeenCalled();expect(JSON.stringify(source)).toBe(original);
    }finally{random.mockRestore();}
    h.finish();expect(h.effects.activeCount).toBe(0);
    const large=harness(),many=colorStep();many.effects=Array.from({length:8},(_,col)=>({row:0,col,special:'rainbow'}));
    large.effects.special(many);
    const threads=large.objects.filter(obj=>obj.name==='special-color-connections');expect(threads).toHaveLength(1);
    const ends=new Set(threads[0].lines.map(line=>`${line[2]},${line[3]}`));expect(ends.size).toBe(12);expect(ends.has('44,44')).toBe(false);
    for(const line of threads[0].lines)expect(many.removed.some(p=>many.before[p.row]?.[p.col]&&44+p.col*56===line[2]&&44+p.row*56===line[3])).toBe(true);
    expect(threads[0].lines).toHaveLength(24);
    for(let i=0;i<4;i++){large.effects.special(many);large.effects.match(many,4);}
    expect(large.effects.activeCount).toBeLessThanOrEqual(120);large.effects.clear();large.finish();
    expect(large.effects.activeCount).toBe(0);expect(large.objects.every(obj=>obj.destroyed)).toBe(true);
  });
  it('유효한 색 특수 원점이나 제거 타일이 없으면 연결 장식을 만들지 않습니다',()=>{
    const h=harness();h.effects.special({...colorStep(),removed:[]});h.effects.special({...colorStep(),before:[]});
    expect(h.objects.some(obj=>obj.name==='special-color-connections')).toBe(false);
    h.effects.clear();h.finish();expect(h.effects.activeCount).toBe(0);
  });
  it('움직임 줄이기에서는 겹 숫자와 완료 표시는 남기고 날림·이동 장식을 생략합니다',()=>{
    vi.stubGlobal('window',{matchMedia:()=>({matches:true})});
    const h=harness();h.effects.leafHit({row:1,col:1,before:2,after:1});h.effects.anticipate(step);h.effects.match(step,1);h.effects.special(step);h.effects.special(colorStep());
    expect(h.objects.map(obj=>obj.name)).toEqual(['leaf-hit-pulse']);
    h.effects.leafHit({row:1,col:1,before:1,after:0});
    expect(h.tweens.every(config=>config.x===undefined&&config.y===undefined&&config.angle===undefined)).toBe(true);
    expect(h.objects.at(-1)?.value).toBe('✓');h.finish();expect(h.effects.activeCount).toBe(0);
  });
});
