import {describe,expect,it} from 'vitest';
import {mountCarrierParcelArt} from '../src/experimental/carrier/CarrierParcelArt';

function deferred(){let resolve!:()=>void,reject!:(reason:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class Node {
  parentElement:Node|null=null;children:Node[]=[];isConnected=true;className='';alt='';src='';draggable=true;
  naturalWidth=128;naturalHeight=128;attrs=new Map<string,string>();ready=deferred();
  constructor(readonly tag:string,readonly ownerDocument:DocumentFixture){}
  append(node:Node){node.remove();node.parentElement=this;this.children.push(node);}
  remove(){if(this.parentElement){const list=this.parentElement.children;list.splice(list.indexOf(this),1);this.parentElement=null;}}
  setAttribute(name:string,value:string){this.attrs.set(name,value);}
  removeAttribute(name:string){this.attrs.delete(name);}
  decode(){return this.ready.promise;}
}
class DocumentFixture {
  nodes:Node[]=[];
  createElement(tag:string):Node{const node=new Node(tag,this);this.nodes.push(node);return node;}
}
function fixture(){
  const doc=new DocumentFixture(),owner=doc.createElement('div'),fallback=doc.createElement('svg');owner.append(fallback);
  let current=true;const mount=()=>mountCarrierParcelArt(owner as unknown as HTMLElement,()=>current);
  const images=()=>doc.nodes.filter(node=>node.tag==='img');
  const ready=()=>owner.attrs.has('data-parcel-illustrated');
  return {doc,owner,fallback,mount,images,ready,setCurrent:(value:boolean)=>{current=value;}};
}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

describe('씨앗 꾸러미 그림의 준비/이탈 경계',()=>{
  it('세 부품을 모두 해독한 뒤에만 현재 그림을 공개합니다',async()=>{
    const f=fixture();f.mount();const images=f.images();
    images[0].ready.resolve();images[1].ready.resolve();await flush();expect(f.ready()).toBe(false);
    images[2].ready.resolve();await flush();expect(f.ready()).toBe(true);expect(f.fallback.parentElement).toBe(f.owner);
  });
  it('한 부품의 해독 실패는 벡터 대체를 유지합니다',async()=>{
    const f=fixture();f.mount();const images=f.images();images[0].ready.resolve();images[1].ready.reject(new Error('decode'));images[2].ready.resolve();
    await flush();expect(f.ready()).toBe(false);expect(f.fallback.parentElement).toBe(f.owner);
  });
  it('해제 뒤 늦은 해독은 그림을 다시 공개하지 않으며 반복 해제는 안전합니다',async()=>{
    const f=fixture(),stop=f.mount();stop();stop();for(const image of f.images())image.ready.resolve();
    await flush();expect(f.ready()).toBe(false);expect(f.owner.children).toEqual([f.fallback]);
  });
  it('회차에서 이미 제거된 조각과 연결이 끊긴 DOM은 공개하지 않습니다',async()=>{
    const a=fixture();a.mount();a.setCurrent(false);for(const image of a.images())image.ready.resolve();
    const b=fixture();b.mount();b.owner.isConnected=false;for(const image of b.images())image.ready.resolve();
    await flush();expect(a.ready()).toBe(false);expect(b.ready()).toBe(false);
  });
  it('같은 조각의 새 소유자가 준비된 뒤 이전 완료/해제는 새 그림을 지우지 않습니다',async()=>{
    const f=fixture(),oldStop=f.mount(),old=f.images().slice();f.mount();const next=f.images().slice(3);
    for(const image of next)image.ready.resolve();await flush();expect(f.ready()).toBe(true);
    for(const image of old)image.ready.resolve();oldStop();await flush();expect(f.ready()).toBe(true);expect(f.owner.children).toHaveLength(2);
  });
  it('분리된 표시 계층이나 다른 부모로 옮겨진 부품을 준비 완료로 취급하지 않습니다',async()=>{
    const a=fixture(),stopA=a.mount();a.owner.children[1].remove();for(const image of a.images())image.ready.resolve();
    const b=fixture(),stopB=b.mount();b.doc.createElement('div').append(b.images()[0]);for(const image of b.images())image.ready.resolve();
    await flush();expect(a.ready()).toBe(false);expect(b.ready()).toBe(false);
    stopA();stopB();expect(a.images().every(image=>image.parentElement===null)).toBe(true);expect(b.images().every(image=>image.parentElement===null)).toBe(true);
  });
  it('decode가 끝나도 실제 크기가 없는 그림은 대체를 유지합니다',async()=>{
    const f=fixture();f.mount();f.images()[1].naturalWidth=0;for(const image of f.images())image.ready.resolve();
    await flush();expect(f.ready()).toBe(false);
  });
  it('공개 후 해제도 그림 계층만 없애고 기존 벡터를 남깁니다',async()=>{
    const f=fixture(),stop=f.mount();for(const image of f.images())image.ready.resolve();await flush();expect(f.ready()).toBe(true);
    stop();expect(f.ready()).toBe(false);expect(f.owner.children).toEqual([f.fallback]);
  });
});
