import {describe,it,expect,vi} from 'vitest';
import {createCampaignScenery,campaignScenery} from '../src/CampaignScenery';
import {existsSync} from 'node:fs';

function setup(assetPaths:string[]=[]){
  const frames=new Map<number,FrameRequestCallback>();let serial=0;
  const listeners=new Map<string,EventListener>(),windowListeners=new Map<string,EventListener>(),mediaListeners=new Map<string,EventListener>();
  const media={matches:false,addEventListener:(k:string,f:EventListener)=>mediaListeners.set(k,f),removeEventListener:(k:string)=>mediaListeners.delete(k)};
  const win={requestAnimationFrame:(f:FrameRequestCallback)=>{frames.set(++serial,f);return serial;},cancelAnimationFrame:(id:number)=>frames.delete(id),matchMedia:()=>media,addEventListener:(k:string,f:EventListener)=>windowListeners.set(k,f),removeEventListener:(k:string)=>windowListeners.delete(k)};
  const positions=[{top:0,bottom:950},{top:950,bottom:1900},{top:1900,bottom:2850}];
  const chapters=positions.map((rect,i)=>({dataset:{chapter:String(i+1)} as Record<string,string>,style:{setProperty:vi.fn()},getBoundingClientRect:()=>rect}));
  const sources=assetPaths.map(path=>({isConnected:true,attrs:{'data-map-src':path} as Record<string,string>,getAttribute(k:string){return this.attrs[k]??null;},hasAttribute(k:string){return k in this.attrs;},setAttribute(k:string,v:string){this.attrs[k]=v;},removeAttribute(k:string){delete this.attrs[k];}}));
  const scroll={dataset:{} as Record<string,string>,isConnected:true,ownerDocument:{defaultView:win},getBoundingClientRect:()=>({top:0,bottom:600,height:600}),querySelectorAll:(selector:string)=>selector==='.campaign-chapter'?chapters:sources,contains:(node:unknown)=>sources.includes(node as typeof sources[number]),addEventListener:(k:string,f:EventListener)=>listeners.set(k,f),removeEventListener:(k:string)=>listeners.delete(k)};
  const images:{src:string;alt:string;decoding:string;onload:(()=>void)|null;onerror:(()=>void)|null;decode:ReturnType<typeof vi.fn>}[]=[];
  const createImage=()=>{const image={src:'',alt:'',decoding:'',onload:null as (()=>void)|null,onerror:null as (()=>void)|null,decode:vi.fn(()=>Promise.resolve())};images.push(image);return image as unknown as HTMLImageElement;};
  const selected=vi.fn(),controller=createCampaignScenery(scroll as unknown as HTMLElement,selected,createImage);
  const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(f=>f(0));};
  const event=(collection:Map<string,EventListener>,name:string)=>collection.get(name)?.({} as Event);
  return {controller,scroll,chapters,positions,frames,media,listeners,windowListeners,mediaListeners,selected,flush,event,images,createImage,sources};
}
describe('지도 풍경의 실제 수명과 스크롤 경계',()=>{
  it('이벤트를 한 프레임으로 모으고 실제 보이는 장만 움직이며 가까운 장을 알립니다',()=>{
    const h=setup();h.controller.setActive(true);h.event(h.listeners,'scroll');h.event(h.listeners,'scroll');expect(h.frames.size).toBe(1);h.flush();
    expect(h.chapters.map(c=>c.dataset.sceneryActive)).toEqual(['true','false','false']);expect(h.selected).toHaveBeenLastCalledWith(1);
    h.positions[0]={top:-920,bottom:30};h.positions[1]={top:30,bottom:980};h.positions[2]={top:980,bottom:1930};
    // 참조를 유지한 실제 DOM rect 변화를 흉내 냅니다.
    h.chapters.forEach((c,i)=>c.getBoundingClientRect=()=>h.positions[i]);h.event(h.listeners,'scroll');h.flush();
    expect(h.selected).toHaveBeenLastCalledWith(2);expect(h.chapters[2].dataset.sceneryActive).toBe('false');
    expect(h.chapters[0].style.setProperty).toHaveBeenLastCalledWith('--map-drift','30.00px');
  });
  it('모션 감소 변경은 시차와 애니메이션을 없애되 보고 있는 장은 계속 알립니다',()=>{
    const h=setup();h.controller.setActive(true);h.flush();h.media.matches=true;h.event(h.mediaListeners,'change');h.flush();
    expect(h.chapters.every(c=>c.dataset.sceneryActive==='false')).toBe(true);expect(h.chapters[0].style.setProperty).toHaveBeenLastCalledWith('--map-drift','0.00px');expect(h.selected).toHaveBeenLastCalledWith(1);
  });
  it('다음 장이 조금 보이더라도 화면을 가장 많이 차지하는 현재 장을 유지합니다',()=>{
    const h=setup();Object.assign(h.positions[0],{top:-500,bottom:450});Object.assign(h.positions[1],{top:450,bottom:1400});h.controller.setActive(true);h.flush();expect(h.selected).toHaveBeenLastCalledWith(1);
  });
  it('비활성·교체·폐기는 예약과 리스너를 정리하고 추출된 콜백도 재활성화하지 않습니다',()=>{
    const h=setup();h.controller.setActive(true);const late=[...h.frames.values()][0];h.controller.setActive(false);late(0);
    expect(h.frames.size).toBe(0);expect(h.selected).not.toHaveBeenCalled();expect(h.chapters.every(c=>c.dataset.sceneryActive==='false')).toBe(true);
    const next=createCampaignScenery(h.scroll as unknown as HTMLElement,h.selected);next.setActive(true);h.controller.dispose();h.controller.setActive(true);expect(h.frames.size).toBe(1);h.flush();expect(h.selected).toHaveBeenCalledTimes(1);
    next.dispose();next.dispose();expect(h.listeners.size+h.windowListeners.size+h.mediaListeners.size).toBe(0);h.event(h.listeners,'scroll');expect(h.frames.size).toBe(0);
  });
  it('분리된 DOM과 높이 없는 숨은 화면에서는 관측이나 무한 프레임을 만들지 않습니다',()=>{
    const h=setup();h.controller.setActive(true);h.scroll.isConnected=false;h.flush();expect(h.selected).not.toHaveBeenCalled();expect(h.frames.size).toBe(0);
    h.scroll.isConnected=true;h.scroll.getBoundingClientRect=()=>({top:0,bottom:0,height:0});h.controller.setActive(true);h.flush();expect(h.chapters.every(c=>c.dataset.sceneryActive==='false')).toBe(true);expect(h.selected).not.toHaveBeenCalled();
  });
  it('물·축제·초원은 서로 다른 자체 부품을 표시하고 조작 요소나 외부 주소를 추가하지 않습니다',()=>{
    expect(campaignScenery(4)).toContain('map-pond-rings');expect(campaignScenery(11)).not.toContain('map-windmill-blades');expect(campaignScenery(1)).toContain('map-windmill-blades');
    for(const id of [1,4,7,8,11]){const art=campaignScenery(id);expect(art).toContain('aria-hidden="true"');expect(art).not.toMatch(/<button|<a |https?:|<script/);expect(art).toContain('map-landmark-fallback');
      for(const match of art.matchAll(/data-map-src="([^"]+)"/g))expect(existsSync(new URL('../public'+match[1],import.meta.url))).toBe(true);
    }
    expect(campaignScenery(1,10).match(/data-map-grove=/g)).toHaveLength(2);
    for(const count of [0,5,7,NaN])expect(campaignScenery(4,count)).not.toContain('data-map-grove=');
  });
  it('지도 활성화 전에는 원본을 해독하지 않고 전부 준비한 현재 owner만 회화 그림을 공개합니다',async()=>{
    const h=setup(['/assets/campaign/windmill-rig-v1.png','/assets/garden-structures-v1/pond-base.webp']);
    expect(h.images).toHaveLength(0);expect(h.sources.every(node=>!node.hasAttribute('href'))).toBe(true);h.controller.setActive(true);expect(h.images).toHaveLength(2);
    let ready!:()=>void;h.images[1].decode.mockImplementation(()=>new Promise<void>(resolve=>ready=resolve));h.images.forEach(image=>image.onload!());for(let n=0;n<10;n++)await Promise.resolve();
    expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();h.controller.setActive(false);ready();for(let n=0;n<10;n++)await Promise.resolve();
    expect(h.scroll.dataset.sceneryArtReady).toBe('true');expect(h.sources[0].getAttribute('href')).toBe('/assets/campaign/windmill-rig-v1.png');expect(h.chapters.every(c=>c.dataset.sceneryActive==='false')).toBe(true);h.controller.setActive(true);expect(h.images).toHaveLength(2);
    h.controller.dispose();expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();expect(h.images.every(image=>image.onload===null&&image.onerror===null)).toBe(true);
  });
  it('실패·폐기·owner 교체 뒤 늦은 decode는 회화 그림을 되살리거나 재요청하지 않습니다',async()=>{
    const h=setup(['/assets/campaign/windmill-rig-v1.png']);h.controller.setActive(true);let ready!:()=>void;
    h.images[0].decode.mockImplementation(()=>new Promise<void>(resolve=>ready=resolve));h.images[0].onload!();await Promise.resolve();
    const next=createCampaignScenery(h.scroll as unknown as HTMLElement,h.selected,h.createImage);next.setActive(true);h.controller.dispose();ready();for(let n=0;n<10;n++)await Promise.resolve();expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();
    h.images[1].onerror!();for(let n=0;n<10;n++)await Promise.resolve();next.setActive(false);next.setActive(true);expect(h.images).toHaveLength(2);expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();next.dispose();
  });
  it('준비 중 다른 코드가 같은 주소를 넣었더라도 미소유 href는 공개/폐기에서 제거하지 않습니다',async()=>{
    const path='/assets/campaign/windmill-rig-v1.png',h=setup([path]);h.controller.setActive(true);h.sources[0].setAttribute('href',path);h.images[0].onload!();for(let n=0;n<10;n++)await Promise.resolve();
    expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();h.controller.dispose();expect(h.sources[0].getAttribute('href')).toBe(path);
  });
});
