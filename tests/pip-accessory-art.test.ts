import {afterEach,describe,expect,it,vi} from 'vitest';
import {createPipAccessoryArt,type PipAccessoryKind} from '../src/PipAccessoryArt';

class VisualNode {
  dataset:Record<string,string>={};children:VisualNode[]=[];parent?:VisualNode;
  connected=false;className='';src='';alt='';decoding='';
  get isConnected():boolean{return this.parent?this.parent.isConnected:this.connected;}
  append(node:VisualNode){node.remove();node.parent=this;this.children.push(node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=undefined;this.connected=false;}
}
class ImageStub extends VisualNode {
  onload:null|(()=>void)=null;onerror:null|(()=>void)=null;
  decode=vi.fn(()=>Promise.resolve());
}
function setup(kind:PipAccessoryKind='ribbon'){
  const slot=new VisualNode(),vector=new VisualNode(),images:ImageStub[]=[];slot.connected=true;slot.append(vector);
  const createImage=()=>{const image=new ImageStub();images.push(image);return image as unknown as HTMLImageElement;};
  const art=createPipAccessoryArt(slot as unknown as HTMLElement,kind,createImage);
  return {slot,vector,images,art,createImage};
}
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
afterEach(()=>vi.restoreAllMocks());

describe('착용 SVG 슬롯의 표시 전용 그림',()=>{
  it.each(['ribbon','wateringCan'] as const)('%s decode가 끝날 때만 그림을 붙이고 늦은 완료는 활동을 재개하지 않습니다',async kind=>{
    const h=setup(kind);let complete!:()=>void;
    h.images[0].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    expect(h.images[0].src).toBe(`/assets/pip-accessories-v1/${kind==='ribbon'?'ribbon':'watering-can'}.webp`);
    h.art.setActive(true);h.images[0].onload!();await settle();expect(h.slot.children).toEqual([h.vector]);
    h.art.setActive(false);complete();await settle();
    expect(h.slot.children).toEqual([h.vector,h.images[0]]);expect(h.slot.dataset).toEqual({artActive:'false',artReady:'true'});
    expect(h.images[0].className).toBe('pip-accessory-painted');expect(h.images[0].alt).toBe('');
  });
  it.each([['ribbon','load'],['ribbon','decode'],['wateringCan','load'],['wateringCan','decode']] as const)('%s %s 실패에는 SVG와 슬롯을 보존하고 반복 요청하지 않습니다',async(kind,mode)=>{
    const h=setup(kind),image=h.images[0];
    if(mode==='load')image.onerror!();else{image.decode.mockRejectedValueOnce(new Error('decode'));image.onload!();}
    await settle();h.art.setActive(true);h.art.setActive(false);await settle();
    expect(h.slot.children).toEqual([h.vector]);expect(h.slot.dataset.artReady).toBeUndefined();
    expect(h.images).toHaveLength(1);expect(image.onload).toBeNull();expect(image.onerror).toBeNull();
  });
  it('해제 뒤 load와 분리 뒤 decode가 SVG를 바꾸거나 소품을 되살리지 않습니다',async()=>{
    const h=setup(),late=h.images[0].onload!;h.art.dispose();late();await settle();
    expect(h.images[0].decode).not.toHaveBeenCalled();expect(h.slot.children).toEqual([h.vector]);expect(h.slot.dataset).toEqual({});
    const detached=setup();let complete!:()=>void;
    detached.images[0].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));detached.images[0].onload!();await settle();
    detached.slot.connected=false;complete();await settle();expect(detached.slot.children).toEqual([detached.vector]);expect(detached.slot.dataset.artReady).toBeUndefined();
  });
  it('동일 슬롯의 새 착용 그림을 이전 decode·dispose·토글이 덮어쓰지 않습니다',async()=>{
    const h=setup();let complete!:()=>void;
    h.images[0].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));h.images[0].onload!();await settle();
    const replacement=createPipAccessoryArt(h.slot as unknown as HTMLElement,'wateringCan',h.createImage);
    replacement.setActive(true);h.images[1].onload!();await settle();h.art.dispose();h.art.setActive(false);complete();await settle();
    expect(h.slot.children).toEqual([h.vector,h.images[1]]);expect(h.slot.dataset).toEqual({artReady:'true',artActive:'true'});
    replacement.dispose();expect(h.slot.children).toEqual([h.vector]);expect(h.slot.dataset).toEqual({});
  });
  it('타이머 없이 자신이 붙인 그림만 제거하고 다른 actor의 슬롯은 건드리지 않습니다',async()=>{
    const timer=vi.spyOn(globalThis,'setTimeout'),h=setup(),other=setup('wateringCan');
    h.images[0].onload!();other.images[0].onload!();await settle();
    h.art.setActive(true);h.art.dispose();h.art.dispose();h.art.setActive(true);
    expect(h.slot.children).toEqual([h.vector]);expect(other.slot.children).toEqual([other.vector,other.images[0]]);
    expect(other.slot.dataset.artReady).toBe('true');expect(timer).not.toHaveBeenCalled();
  });
});
