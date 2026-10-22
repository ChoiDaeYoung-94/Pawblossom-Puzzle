import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {RoundFeedback,type ResolveVisual} from '../src/RoundFeedback';

class AnimationStub {
  onfinish:(()=>void)|null=null;
  canceled=false;
  cancel(){this.canceled=true;}
  finish(){this.onfinish?.();}
  constructor(public frames:Keyframe[],public options:KeyframeAnimationOptions){}
}
class NodeStub {
  isConnected=true;className='';src='';alt='';decoding='';
  dataset:Record<string,string>={};children:NodeStub[]=[];parent?:NodeStub;
  classes=new Set<string>();animations:AnimationStub[]=[];
  classList={add:(name:string)=>this.classes.add(name),remove:(name:string)=>this.classes.delete(name)};
  rect={left:10,top:20,width:30,height:30};
  append(node:NodeStub){node.isConnected=this.isConnected;node.parent=this;this.children.push(node);}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
  replaceChildren(...nodes:NodeStub[]){for(const node of this.children)node.isConnected=false;this.children=[];for(const node of nodes)this.append(node);}
  querySelector(){return this.children[0]??null;}
  setAttribute(){}
  getBoundingClientRect(){return this.rect;}
  animate(frames:Keyframe[],options:KeyframeAnimationOptions){const animation=new AnimationStub(frames,options);this.animations.push(animation);return animation;}
}
class ImageStub extends NodeStub {
  static created:ImageStub[]=[];
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
  decode=vi.fn(()=>Promise.resolve());
  constructor(){super();ImageStub.created.push(this);}
}
const dom=(node:NodeStub)=>node as unknown as HTMLElement;
const event=(overrides:Partial<ResolveVisual>={}):ResolveVisual=>({cascade:1,removed:[{kind:0,x:44,y:100}],clearedLeaves:[],specialActivated:false,specialCreated:false,...overrides});
const microtasks=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function setup(reduced=false){
  const layer=new NodeStub(),pip=new NodeStub(),base=new NodeStub(),canvas=new NodeStub();pip.append(base);
  canvas.rect={left:100,top:200,width:240,height:240};
  const goals=new Map(Array.from({length:6},(_,kind)=>[String(kind),new NodeStub()]));goals.set('leaves',new NodeStub());
  let active=true,motion=reduced;
  const feedback=new RoundFeedback({layer:dom(layer),pip:dom(pip),canvas:()=>dom(canvas),goal:key=>goals.has(key)?dom(goals.get(key)!):null,active:()=>active,reduced:()=>motion});
  const begin=(remaining=100)=>feedback.beginMove([...goals.keys()].map(key=>({key,remaining,src:`/${key}.svg`})));
  begin();return {feedback,layer,pip,base,canvas,goals,begin,setActive:(value:boolean)=>{active=value;},setReduced:(value:boolean)=>{motion=value;}};
}
beforeEach(()=>{ImageStub.created=[];vi.stubGlobal('Image',ImageStub);vi.stubGlobal('document',{createElement:()=>new NodeStub()});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('이동 잔량 안의 목표 비행과 정산 없는 도착',()=>{
  it('일반 목표도 실제 논리 좌표에서 날리고, 도착 시 교체된 최신 목표만 강조합니다',()=>{
    const h=setup(),random=vi.spyOn(Math,'random'),input=event();const before=JSON.stringify(input);
    h.feedback.show(input);expect(h.layer.children).toHaveLength(1);
    const flight=h.layer.children[0].animations[0];expect(flight.frames[0].transform).toBe('translate(111px,239px) scale(1)');
    const old=h.goals.get('0')!,latest=new NodeStub();h.goals.set('0',latest);old.isConnected=false;
    flight.finish();expect(h.layer.children).toHaveLength(0);expect(old.animations).toHaveLength(0);expect(latest.animations).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);expect(random).not.toHaveBeenCalled();
  });
  it('대표 세 개를 그려도 실제 제거 수만큼 잔량을 차감하고 다음 연쇄/새 DOM 숫자로 초기화하지 않습니다',()=>{
    const h=setup();h.begin(5);
    const removed=Array.from({length:8},(_,i)=>({kind:0,x:44+i*56,y:100}));
    h.feedback.show(event({removed}));expect(h.layer.children).toHaveLength(3);
    for(const node of [...h.layer.children])node.animations[0].finish();
    h.goals.set('0',new NodeStub());h.feedback.show(event({cascade:2,removed}));expect(h.layer.children).toHaveLength(0);
    h.begin(2);h.feedback.show(event({removed}));expect(h.layer.children).toHaveLength(2);
  });
  it('종류별 단계당3/동시12/지연 포함468ms를 넘지 않고 없는 목표·완료 목표는 건너뜁니다',()=>{
    const h=setup();const removed=Array.from({length:30},(_,i)=>({kind:Math.floor(i/5),x:44,y:100}));
    h.feedback.show(event({removed}));expect(h.layer.children).toHaveLength(12);
    expect(h.layer.children.every(node=>{const timing=node.animations[0].options;return Number(timing.duration)+Number(timing.delay)<=480;})).toBe(true);
    h.feedback.show(event({removed}));expect(h.layer.children).toHaveLength(12);
    h.begin(0);h.feedback.show(event());expect(h.layer.children).toHaveLength(0);
    h.begin();h.goals.delete('0');h.feedback.show(event());expect(h.layer.children).toHaveLength(0);
  });
  it('완전 제거 낙엽도 별도 목표로 날리고 이동 시작 인자를 변경하지 않습니다',()=>{
    const h=setup(),goals=[{key:'leaves',remaining:1,src:'/leaf.svg'}];h.feedback.beginMove(goals);
    h.feedback.show(event({clearedLeaves:[{x:44,y:44},{x:100,y:44}]}));
    expect(h.layer.children.map(node=>node.src)).toEqual(['/leaf.svg']);expect(goals[0].remaining).toBe(1);
  });
  it('상자 제거도 별도 목표 잔량·종류당3·468ms 안에서 표시하고 감소 모션/취소를 공유합니다',()=>{
    const h=setup();h.goals.set('crates',new NodeStub());h.begin(4);
    const clearedCrates=Array.from({length:6},(_,i)=>({x:44+i*56,y:100}));
    h.feedback.show(event({removed:[],clearedCrates}));expect(h.layer.children.map(n=>n.src)).toEqual(['/crates.svg','/crates.svg','/crates.svg']);
    expect(h.layer.children.every(n=>Number(n.animations[0].options.duration)+Number(n.animations[0].options.delay)<=468)).toBe(true);
    for(const n of [...h.layer.children])n.animations[0].finish();h.feedback.show(event({removed:[],clearedCrates}));expect(h.layer.children).toHaveLength(0);
    h.setReduced(true);h.begin(2);h.feedback.show(event({removed:[],clearedCrates}));expect(h.layer.children).toHaveLength(0);expect(h.goals.get('crates')!.classes.has('goal-feedback-static')).toBe(true);
    h.feedback.cancel();expect(h.goals.get('crates')!.classes.size).toBe(0);
  });
});

describe('표시 수명과 핍 비동기 경계',()=>{
  it('취소한 비행의 추출된 오래된 도착 콜백도 다음 이동의 목표를 건드리지 않습니다',()=>{
    const h=setup();h.feedback.show(event());const node=h.layer.children[0],animation=node.animations[0],late=animation.onfinish!;
    h.feedback.cancel();h.begin();late();expect(animation.canceled).toBe(true);expect(node.isConnected).toBe(false);expect(h.goals.get('0')!.animations).toHaveLength(0);
    h.feedback.show(event());expect(h.layer.children).toHaveLength(1);
  });
  it('숨김/끊어진 목표/0 크기 캔버스는 지급·비행을 만들지 않고 복귀 후 지난 단계를 재생하지 않습니다',()=>{
    const h=setup();h.setActive(false);h.feedback.show(event());h.setActive(true);h.feedback.show(event());expect(h.layer.children).toHaveLength(0);
    h.begin();h.canvas.rect.width=0;h.feedback.show(event());expect(h.layer.children).toHaveLength(0);
    h.canvas.rect.width=240;h.goals.get('0')!.isConnected=false;h.feedback.show(event());expect(h.layer.children).toHaveLength(0);
  });
  it('모션 감소는 비행·움직임·추가 타이머 없이 정적 목표와 얼굴만 표시하고 취소 때 정리합니다',async()=>{
    const h=setup(true),timer=vi.spyOn(globalThis,'setTimeout');h.feedback.show(event({cascade:2}));
    expect(h.layer.children).toHaveLength(0);expect(h.goals.get('0')!.classes.has('goal-feedback-static')).toBe(true);expect(h.pip.dataset.mood).toBe('happy');
    ImageStub.created[0].onload!();await microtasks();expect(h.pip.children[0]).toBe(ImageStub.created[0]);
    expect(h.pip.animations).toHaveLength(0);expect(h.goals.get('0')!.animations).toHaveLength(0);expect(timer).not.toHaveBeenCalled();
    h.feedback.cancel();expect(h.pip.children).toEqual([h.base]);expect(h.pip.dataset.mood).toBeUndefined();expect(h.goals.get('0')!.classes.size).toBe(0);
  });
  it('이동 중 모션 변경은 기존 비행을 정리하며 잔량과 반응 횟수를 초기화하지 않습니다',()=>{
    const h=setup();h.begin(1);h.feedback.show(event());const old=h.layer.children[0];h.setReduced(true);
    h.feedback.show(event({cascade:2}));expect(old.isConnected).toBe(false);expect(h.layer.children).toHaveLength(0);expect(h.goals.get('0')!.classes.size).toBe(0);
  });
  it('마지막 비행 중 모션 감소를 켜면 도착은 새 애니메이션 대신 정적으로 강조합니다',()=>{
    const h=setup();h.feedback.show(event());const flight=h.layer.children[0].animations[0];
    h.setReduced(true);flight.finish();expect(h.goals.get('0')!.animations).toHaveLength(0);expect(h.goals.get('0')!.classes.has('goal-feedback-static')).toBe(true);
  });
  it('일반 매치에는 핍 요청이 없고 특수/연쇄 반응은 이동당 최대2회이며 다음 이동에서 다시 허용합니다',()=>{
    const h=setup();h.feedback.show(event());expect(ImageStub.created).toHaveLength(0);
    for(let cascade=2;cascade<8;cascade++)h.feedback.show(event({cascade}));
    expect(h.pip.animations).toHaveLength(2);expect(ImageStub.created).toHaveLength(1);
    h.begin();h.feedback.show(event({specialCreated:true}));expect(h.pip.animations).toHaveLength(3);
  });
  it('늦은 decode는 취소/새 이동/분리된 슬롯을 덮지 않으며 해독된 노드는 전용 슬롯에서만 재사용합니다',async()=>{
    const h=setup();h.feedback.show(event({specialActivated:true}));const image=ImageStub.created[0];let decoded!:()=>void;
    image.decode.mockImplementation(()=>new Promise(resolve=>{decoded=resolve;}));image.onload!();await microtasks();
    h.feedback.cancel();h.begin();decoded();await microtasks();expect(h.pip.children).toEqual([h.base]);
    h.pip.isConnected=false;h.feedback.show(event({cascade:2}));await microtasks();expect(h.pip.children).toEqual([h.base]);
    h.pip.isConnected=true;h.begin();h.feedback.show(event({cascade:2}));await microtasks();expect(h.pip.children).toEqual([image]);expect(ImageStub.created).toHaveLength(1);
  });
  it.each(['load','decode'])('아트 %s 실패는 기본 핍을 유지하고 재요청하지 않습니다',async mode=>{
    const h=setup();h.feedback.show(event({cascade:2}));const image=ImageStub.created[0];
    if(mode==='load')image.onerror!();else{image.decode.mockRejectedValue(new Error('decode'));image.onload!();}
    await microtasks();h.begin();h.feedback.show(event({cascade:2}));await microtasks();expect(h.pip.children).toEqual([h.base]);expect(ImageStub.created).toHaveLength(1);
  });
});
