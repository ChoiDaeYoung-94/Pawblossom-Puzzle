import {afterEach,describe,it,expect,vi} from 'vitest';
import {createPipIdle} from '../src/PipIdle';
import {RoundFeedback} from '../src/RoundFeedback';

// 실제 controller의 DOM 소유권을 검사합니다. SVG paint는 별도 브라우저 검수입니다.
class PipNode {
  dataset:Record<string,string>={};attributes:Record<string,string>={};
  children:PipNode[]=[];parent?:PipNode;connected=false;
  innerHTML='';className='';src='';alt='';decoding='';
  classList={add:vi.fn(),remove:vi.fn()};
  constructor(public ownerDocument:Document,public tagName='span'){}
  get isConnected():boolean{return this.parent?this.parent.isConnected:this.connected;}
  set isConnected(value:boolean){this.connected=value;}
  setAttribute(name:string,value:string){this.attributes[name]=value;}
  append(...nodes:PipNode[]){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=undefined;this.connected=false;}
  replaceChildren(...nodes:PipNode[]){for(const child of [...this.children])child.remove();this.append(...nodes);}
  querySelector(selector:string):PipNode|null {for(const child of this.children){if(child.tagName===selector)return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
}
function makeDocument():Document {
  const document={createElement:(tag:string)=>new PipNode(document as unknown as Document,tag)};
  return document as unknown as Document;
}
class ImageStub extends PipNode {
  static created:ImageStub[]=[];
  onload:null|(()=>void)=null;onerror:null|(()=>void)=null;
  decode=vi.fn(()=>Promise.resolve());
  constructor(document=makeDocument()){super(document,'img');ImageStub.created.push(this);}
}
const dom=(node:PipNode)=>node as unknown as HTMLElement;
function setup(){
  const document=makeDocument(),pip=new PipNode(document),face=new PipNode(document),base=new PipNode(document,'img');
  pip.connected=true;base.src='/existing-fallback.webp';pip.append(face);face.append(base);
  const images:ImageStub[]=[];
  const createImage=()=>{const image=new ImageStub(document);images.push(image);return image as unknown as HTMLImageElement;};
  const idle=createPipIdle(dom(pip),createImage);
  return {pip,face,base,images,idle,createImage};
}
async function settle(){for(let i=0;i<10;i++)await Promise.resolve();}
async function load(images:ImageStub[]){for(const image of images)image.onload?.();await settle();}
const rigs=(pip:PipNode)=>pip.children.filter(node=>node.className==='pip-idle-rig');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();ImageStub.created=[];});

describe('핍 관절의 실제 controller 소유권',()=>{
  it('두 원본 모두 decode한 뒤 한 rig만 붙이고 늦은 성공은 비활성 상태를 바꾸지 않습니다',async()=>{
    const h=setup();let complete!:()=>void;
    h.images[1].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    expect(h.images.map(image=>image.src)).toEqual(['/assets/pip-idle-open-v2.webp','/assets/pip-idle-blink-v2.webp']);
    h.idle.setActive(true);h.images[0].onload!();await settle();expect(rigs(h.pip)).toHaveLength(0);
    h.images[1].onload!();await settle();h.idle.setActive(false);complete();await settle();
    expect(h.pip.dataset).toEqual({idleReady:'true',idleActive:'false'});expect(rigs(h.pip)).toHaveLength(1);
    expect(h.face.children).toEqual([h.base]);expect(h.base.src).toBe('/existing-fallback.webp');
    h.idle.setActive(true);expect(h.pip.dataset.idleActive).toBe('true');
    expect(h.images.every(image=>image.onload===null&&image.onerror===null)).toBe(true);
  });
  it.each([[0,'load'],[1,'load'],[0,'decode'],[1,'decode']] as const)('원본%s의 %s 실패는 기본 얼굴만 유지하고 재요청하지 않습니다',async(index,mode)=>{
    const h=setup();h.idle.setActive(true);
    if(mode==='load')h.images[index].onerror!();else{h.images[index].decode.mockRejectedValueOnce(new Error('decode'));for(const image of h.images)image.onload!();}
    await settle();h.idle.setActive(false);h.idle.setActive(true);await settle();
    expect(h.pip.children).toEqual([h.face]);expect(h.face.children).toEqual([h.base]);
    expect(h.pip.dataset.idleReady).toBeUndefined();expect(h.images).toHaveLength(2);
    expect(h.images.every(image=>image.onload===null&&image.onerror===null)).toBe(true);
  });
  it('생성과 토글에는 타이머가 없고 dispose는 소유 SVG만 제거하며 반복 호출도 안전합니다',async()=>{
    const timer=vi.spyOn(globalThis,'setTimeout'),h=setup();await load(h.images);
    const rig=rigs(h.pip)[0];h.face.dataset.mood='happy';h.idle.setActive(true);h.idle.dispose();h.idle.dispose();h.idle.setActive(true);
    expect(h.pip.dataset).toEqual({});expect(h.pip.children).toEqual([h.face]);expect(rig.isConnected).toBe(false);
    expect(h.face.dataset.mood).toBe('happy');expect(h.face.children).toEqual([h.base]);expect(timer).not.toHaveBeenCalled();
  });
  it('dispose 뒤 추출된 load 콜백과 분리 뒤 decode 완료는 rig를 되살리지 않습니다',async()=>{
    const h=setup(),late=h.images.map(image=>image.onload!);h.idle.dispose();late.forEach(callback=>callback());await settle();
    expect(h.pip.children).toEqual([h.face]);expect(h.pip.dataset).toEqual({});expect(h.images.every(image=>image.decode.mock.calls.length===0)).toBe(true);
    const detached=setup();let complete!:()=>void;
    detached.images[1].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    await load(detached.images);detached.pip.connected=false;complete();await settle();
    expect(rigs(detached.pip)).toHaveLength(0);expect(detached.pip.dataset.idleReady).toBeUndefined();
  });
  it('같은 호스트의 새 controller를 이전 decode·dispose·setActive가 덮어쓰지 않습니다',async()=>{
    const h=setup();let complete!:()=>void;
    h.images[0].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));await load(h.images);
    const oldImages=h.images.slice(),replacement=createPipIdle(dom(h.pip),h.createImage),newImages=h.images.slice(2);
    replacement.setActive(true);await load(newImages);const rig=rigs(h.pip)[0];
    h.idle.dispose();h.idle.setActive(false);complete();await settle();
    expect(rigs(h.pip)).toEqual([rig]);expect(h.pip.dataset).toEqual({idleReady:'true',idleActive:'true'});
    expect(oldImages.every(image=>image.onload===null&&image.onerror===null)).toBe(true);
    replacement.dispose();expect(h.pip.children).toEqual([h.face]);
  });
  it('이미 표시한 호스트의 재생성과 다른 호스트 사이에 마스크 ID나 소유권이 겹치지 않습니다',async()=>{
    const h=setup(),other=setup();await load(h.images);await load(other.images);
    const oldRig=rigs(h.pip)[0],otherRig=rigs(other.pip)[0];
    const replacement=createPipIdle(dom(h.pip),h.createImage);expect(oldRig.isConnected).toBe(false);expect(h.pip.dataset.idleReady).toBeUndefined();
    await load(h.images.slice(2));const newRig=rigs(h.pip)[0];
    const ids=[oldRig,newRig,otherRig].flatMap(rig=>[...rig.innerHTML.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
    expect(ids).toHaveLength(15);expect(new Set(ids).size).toBe(ids.length);
    replacement.dispose();expect(rigs(other.pip)).toEqual([otherRig]);expect(other.pip.dataset.idleReady).toBe('true');
  });
  it('실제 RoundFeedback은 내부 반응만 교체하고 취소 뒤에도 외곽·기본 얼굴·rig를 보존합니다',async()=>{
    const h=setup();await load(h.images);h.idle.setActive(true);const rig=rigs(h.pip)[0];
    vi.stubGlobal('Image',ImageStub);
    const feedback=new RoundFeedback({pip:dom(h.face),layer:dom(new PipNode(h.pip.ownerDocument)),canvas:()=>null,goal:()=>null,active:()=>true,reduced:()=>true});
    feedback.beginMove([{key:'0',remaining:1,src:'/goal.webp'}]);
    feedback.show({cascade:2,removed:[{kind:0,x:44,y:44}],clearedLeaves:[],specialActivated:false,specialCreated:false});
    expect(h.face.dataset.mood).toBe('happy');expect(h.pip.dataset.mood).toBeUndefined();
    const happy=ImageStub.created.at(-1)!;happy.onload!();await settle();
    expect(h.face.children).toEqual([happy]);expect(h.pip.children).toEqual([h.face,rig]);
    feedback.cancel();expect(h.face.children).toEqual([h.base]);expect(h.face.dataset.mood).toBeUndefined();
    expect(h.pip.children).toEqual([h.face,rig]);expect(h.pip.dataset).toEqual({idleReady:'true',idleActive:'true'});
  });
});
