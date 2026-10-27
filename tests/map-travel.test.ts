import {afterEach,describe,it,expect,vi} from 'vitest';
import {createMapTravel} from '../src/MapTravel';

class PaintImage {
  attrs:Record<string,string>={};
  setAttribute(key:string,value:string){this.attrs[key]=value;}
  removeAttribute(key:string){delete this.attrs[key];}
}
class Node extends EventTarget {
  dataset:Record<string,string>={};style:Record<string,string>={};attrs:Record<string,string>={};
  className='';innerHTML='';isConnected=true;parent?:Node;children:Node[]=[];section?:Node;
  classes=new Set(['original']);classList={add:(value:string)=>{this.classes.add(value);},remove:(value:string)=>{this.classes.delete(value);}};
  paint=Array.from({length:4},()=>new PaintImage());
  scrollTop=100;scrollLeft=0;clientLeft=0;clientTop=0;clientHeight=500;scrollHeight=2500;
  rect={left:10,top:20,width:400,height:500,bottom:520};
  setAttribute(key:string,value:string){this.attrs[key]=value;}
  append(node:Node){node.parent=this;this.children.push(node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=undefined;this.isConnected=false;}
  querySelectorAll(selector:string){return selector==='image'?this.paint:[];}
  getBoundingClientRect(){return this.rect;}
  closest(){return this.section;}
}
const dom=(node:Node)=>node as unknown as HTMLElement;
async function settle(){for(let i=0;i<4;i++)await Promise.resolve();}
function setup(){
  vi.useFakeTimers();
  const media=Object.assign(new EventTarget(),{matches:false}),win=Object.assign(new EventTarget(),{matchMedia:()=>media,setTimeout:(callback:()=>void,ms:number)=>setTimeout(callback,ms)});
  const doc=Object.assign(new EventTarget(),{hidden:false,createElement:()=>new Node()}),scroll=new Node(),from=new Node(),to=new Node(),pip=new Node(),decoration=new Node();
  from.rect={left:100,top:100,width:72,height:72,bottom:172};to.rect={left:220,top:212,width:72,height:72,bottom:284};
  scroll.append(decoration);const section=new Node();section.rect.bottom=220;from.section=section;to.section=section;
  const images:ImageStub[]=[],frames=new Map<number,(now:number)=>void>();let nextFrame=0,owns=true;
  class ImageStub {
    onload:null|(()=>void)=null;onerror:null|(()=>void)=null;src='';removed=false;
    resolve!:()=>void;reject!:(reason:Error)=>void;
    promise=new Promise<void>((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    decode=vi.fn(()=>this.promise);
    constructor(){images.push(this);}
    removeAttribute(){this.removed=true;this.src='';}
  }
  vi.stubGlobal('window',win);vi.stubGlobal('document',doc);vi.stubGlobal('Image',ImageStub);
  vi.stubGlobal('requestAnimationFrame',(callback:(now:number)=>void)=>{frames.set(++nextFrame,callback);return nextFrame;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const notifications:boolean[]=[],travel=createMapTravel(dom(scroll),dom(from),dom(to),dom(pip),()=>owns,value=>notifications.push(value));
  return {scroll,from,to,pip,decoration,images,media,win,doc,frames,notifications,travel,setOwner(value:boolean){owns=value;},
    start(){travel.setActive(true);travel.start();},ghost(){return scroll.children.find(node=>node!==decoration);},
    frame(now:number){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(now));},
    clean(){expect(scroll.children).toEqual([decoration]);expect(pip.classes).toEqual(new Set(['original']));expect(frames.size).toBe(0);expect(vi.getTimerCount()).toBe(0);expect(travel.playing).toBe(false);}};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('핍 지도 걷기의 실제 수명',()=>{
  it.each([false,true])('왼쪽 목적지라도 길 합류의 실제 가로 이동을 따라 얼굴을 바꿉니다 (장 경계 %s)',async crossChapter=>{
    const h=setup();h.to.rect.left=70;if(crossChapter)h.to.section=new Node();h.start();const ghost=h.ghost()!;expect(ghost.dataset.facing).toBe('right');
    h.images[0].resolve();await settle();h.frame(0);const x=()=>Number(ghost.style.transform.match(/translate3d\(([-\d.]+)px/)![1]),start=x();
    h.frame(1);h.frame(2);expect(ghost.dataset.facing).toBe('right');h.frame(650);const middle=x();expect(middle).toBeGreaterThan(start);expect(ghost.dataset.facing).toBe('right');
    h.frame(1650);expect(x()).toBeLessThan(middle);expect(ghost.dataset.facing).toBe('left');h.travel.dispose();h.clean();
  });
  it('그림 decode 전에는 href가 없고 한 번만 네 포즈를 재생한 뒤 소유 자원만 정리합니다',async()=>{
    const h=setup();h.start();const ghost=h.ghost()!;expect(ghost.attrs['aria-hidden']).toBe('true');expect(h.pip.classes.has('map-pip-suspended')).toBe(true);
    expect(ghost.paint.every(image=>!image.attrs.href)).toBe(true);expect(h.frames.size).toBe(0);expect(vi.getTimerCount()).toBe(1);
    h.images[0].resolve();await settle();expect(ghost.dataset.ready).toBe('true');expect(ghost.paint.every(image=>image.attrs.href==='/assets/pip-walk-atlas-v1.png')).toBe(true);expect(vi.getTimerCount()).toBe(0);
    h.frame(0);const first=ghost.style.transform;h.frame(400);expect(ghost.style.transform).not.toBe(first);expect(ghost.dataset.facing).toBe('right');
    h.travel.start();expect(h.images).toHaveLength(1);h.frame(4000);h.clean();expect(h.notifications).toEqual([true,false]);expect(ghost.paint.every(image=>!image.attrs.href)).toBe(true);expect(h.images[0].removed).toBe(true);
    h.travel.start();h.travel.setActive(true);expect(h.images).toHaveLength(1);h.travel.dispose();h.travel.dispose();h.clean();
  });
  it('출발 때 잠깐 발을 디딘 뒤 네 포즈로 2초 이상 걷고 목적지에서 멈춥니다',async()=>{
    const h=setup();h.start();const ghost=h.ghost()!;h.images[0].resolve();await settle();
    h.frame(0);const start=ghost.style.transform;h.frame(100);expect(ghost.style.transform).toBe(start);
    const poses=new Set<string>();let arrival:string|undefined;
    for(let time=150;time<=2250;time+=50){h.frame(time);expect(h.travel.playing).toBe(true);poses.add(ghost.dataset.frame);arrival=ghost.style.transform;}
    expect(poses).toEqual(new Set(['0','1','2','3']));expect(arrival).not.toBe(start);
    h.frame(3600);expect(ghost.dataset.frame).toBe('0');const destination=ghost.style.transform;
    // 목적지 중앙246에서 대기 위치40과그림반폭36을 뺀 원래 위치입니다.
    expect(destination).toContain('translate3d(170px,');h.frame(4000);h.clean();
    expect(h.notifications).toEqual([true,false]);
  });
  it.each(['pointerdown','wheel','touchstart','keydown','resize','hidden','reduced','inactive','dispose','timeout'] as const)('%s 취소 뒤 늦은 decode가 연출을 되살리거나 입력을 막지 않습니다',async(reason)=>{
    const h=setup();h.start();const image=h.images[0];
    if(['pointerdown','wheel','touchstart','keydown'].includes(reason)){const event=new Event(reason,{cancelable:true});h.scroll.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);}
    else if(reason==='resize')h.win.dispatchEvent(new Event('resize'));
    else if(reason==='hidden'){h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));}
    else if(reason==='reduced'){h.media.matches=true;h.media.dispatchEvent(new Event('change'));}
    else if(reason==='inactive')h.travel.setActive(false);
    else if(reason==='dispose')h.travel.dispose();
    else vi.advanceTimersByTime(800);
    h.clean();image.resolve();await settle();h.travel.setActive(true);h.travel.start();h.clean();expect(h.images).toHaveLength(1);expect(image.onload).toBeNull();expect(image.onerror).toBeNull();
  });
  it.each(['owner','detached'] as const)('재생 중 %s 이탈은 다음 프레임에서 정리됩니다',async(reason)=>{
    const h=setup();h.start();h.images[0].resolve();await settle();h.frame(0);
    if(reason==='owner')h.setOwner(false);else h.to.isConnected=false;
    h.frame(100);h.clean();
  });
  it.each(['load','decode','constructor','src'] as const)('%s 실패는 현재 핍을 돌려놓고 새 요청을 만들지 않습니다',async(reason)=>{
    const h=setup();
    if(reason==='constructor')vi.stubGlobal('Image',class{constructor(){throw new Error('image unavailable');}});
    if(reason==='src')vi.stubGlobal('Image',class{set src(_value:string){throw new Error('source unavailable');}removeAttribute(){}});
    h.start();if(reason==='load')h.images[0].onerror!();if(reason==='decode')h.images[0].reject(new Error('decode unavailable'));await settle();h.clean();
    const count=h.images.length;h.travel.start();expect(h.images).toHaveLength(count);
  });
  it.each(['short','reduced','detached','inactive'] as const)('처음부터 %s 상태이면 그림 요청과 카메라 이동을 만들지 않습니다',reason=>{
    const h=setup(),top=h.scroll.scrollTop;
    if(reason==='short')h.scroll.rect.height=100;if(reason==='reduced')h.media.matches=true;if(reason==='detached')h.from.isConnected=false;
    if(reason==='inactive')h.travel.start();else h.start();
    h.clean();expect(h.images).toHaveLength(0);expect(h.scroll.scrollTop).toBe(top);
  });
  it('decode 미지원의 동기 load도 대기 타이머를 남기지 않습니다',()=>{
    const h=setup();vi.stubGlobal('Image',class{onload:null|(()=>void)=null;onerror:null|(()=>void)=null;set src(_value:string){this.onload?.();}removeAttribute(){}});
    h.start();expect(h.ghost()!.dataset.ready).toBe('true');expect(vi.getTimerCount()).toBe(0);expect(h.frames.size).toBe(1);h.travel.dispose();h.clean();
  });
});
