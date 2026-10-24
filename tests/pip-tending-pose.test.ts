import {describe,it,expect,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {createPipTendingPose,pipTendingPosePath} from '../src/PipTendingPose';
class Node {
  dataset:Record<string,string>={};children:Node[]=[];parent?:Node;isConnected=true;
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null;src='';alt='';className='';decoding='';attrs:Record<string,string>={};
  decode=vi.fn(()=>Promise.resolve());
  setAttribute(k:string,v:string){this.attrs[k]=v;}
  contains(n:Node):boolean{return this.children.includes(n)||this.children.some(c=>c.contains(n));}
  append(n:Node){n.remove();n.isConnected=true;n.parent=this;this.children.push(n);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=undefined;this.isConnected=false;}
}
const element=(n:Node)=>n as unknown as HTMLElement;
const settle=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function setup(){
  const portrait=new Node(),stage=new Node(),base=new Node(),images:Node[]=[];portrait.append(base);portrait.append(stage);
  let valid=true;const create=()=>{const image=new Node();images.push(image);return image as unknown as HTMLImageElement;};
  const make=()=>createPipTendingPose(element(portrait),element(stage),()=>valid,create);
  return {portrait,stage,base,images,make,invalidate:()=>{valid=false;}};
}
describe('자체 물 주기 포즈의 실제 해독과 표시 소유권',()=>{
  it('완전 해독 후에만 공개하고 원래 얼굴·형제를 바꾸지 않으며 폐기는 멱등입니다',async()=>{
    const f=setup(),pose=f.make(),image=f.images[0];let resolve!:()=>void;image.decode.mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
    image.onload?.();await settle();expect(f.portrait.dataset.tendArtReady).toBeUndefined();expect(f.stage.children).toHaveLength(0);
    resolve();await settle();expect(f.portrait.dataset.tendArtReady).toBe('true');expect(f.stage.children).toEqual([image]);expect(image.src).toBe(pipTendingPosePath);expect(image.attrs['aria-hidden']).toBe('true');
    pose.dispose();pose.dispose();expect(f.stage.children).toHaveLength(0);expect(f.portrait.children).toEqual([f.base,f.stage]);expect(f.portrait.dataset.tendArtReady).toBeUndefined();
  });
  it('교체한 owner의 준비 그림을 늦은 옛 해독/폐기가 제거하지 않습니다',async()=>{
    const f=setup(),old=f.make(),first=f.images[0];let resolve!:()=>void;first.decode.mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));first.onload?.();await settle();
    const current=f.make(),second=f.images[1];second.onload?.();await settle();resolve();await settle();old.dispose();
    expect(f.stage.children).toEqual([second]);expect(f.portrait.dataset.tendArtReady).toBe('true');current.dispose();
  });
  it('로드/해독 실패에는 공개 플래그가 없으며 기존 대체 그림을 보존합니다',async()=>{
    for(const mode of ['load','decode']){
      const f=setup(),pose=f.make(),image=f.images[0];if(mode==='load')image.onerror?.();else{image.decode.mockRejectedValue(new Error('synthetic'));image.onload?.();}
      await settle();expect(f.portrait.dataset.tendArtReady).toBeUndefined();expect(f.stage.children).toHaveLength(0);expect(f.portrait.children).toContain(f.base);pose.dispose();
    }
  });
  it('끝난 반응·사라진 portrait·바뀐 stage·유효성 예외는 뒤늦게 공개하지 않습니다',async()=>{
    for(const mode of ['expired','portrait','stage','moved']){
      const f=setup(),pose=f.make(),image=f.images[0];image.onload?.();
      if(mode==='expired')f.invalidate();if(mode==='portrait')f.portrait.isConnected=false;if(mode==='stage')f.stage.isConnected=false;if(mode==='moved')f.portrait.children=[f.base];
      await settle();expect(f.portrait.dataset.tendArtReady).toBeUndefined();expect(f.stage.children).toHaveLength(0);pose.dispose();
    }
    const f=setup(),image=new Node(),pose=createPipTendingPose(element(f.portrait),element(f.stage),()=>{throw Error('synthetic');},()=>image as unknown as HTMLImageElement);
    image.onload?.();await settle();expect(f.portrait.dataset.tendArtReady).toBeUndefined();pose.dispose();
  });
  it('로딩 중 폐기/뒤늦은 에러는 새 플래그와 무관한 자식을 덮지 않습니다',async()=>{
    const f=setup(),first=f.make(),late=f.images[0].onerror;first.dispose();const second=f.make(),foreign=new Node();f.stage.append(foreign);f.images[1].onload?.();await settle();late?.();await settle();
    expect(f.stage.children).toEqual([foreign,f.images[1]]);expect(f.portrait.dataset.tendArtReady).toBe('true');second.dispose();expect(f.stage.children).toEqual([foreign]);
  });
  it('공개 경로의 자체 PNG와 기록된 크기·alpha 형식이 실제 파일에 존재합니다',()=>{
    const path=new URL('../public'+pipTendingPosePath,import.meta.url),meta=JSON.parse(readFileSync(new URL('../docs/art/pip-tend-held-v1.json',import.meta.url),'utf8'));
    expect(existsSync(path)).toBe(true);const bytes=readFileSync(path);expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual(meta.dimensions);expect(bytes[25]).toBe(6);
  });
});
