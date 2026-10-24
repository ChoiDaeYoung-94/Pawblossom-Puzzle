import {describe,it,expect,vi} from 'vitest';
import {createCampaignScenery,campaignScenery} from '../src/CampaignScenery';

function setup(){
  const frames=new Map<number,FrameRequestCallback>();let serial=0;
  const listeners=new Map<string,EventListener>(),windowListeners=new Map<string,EventListener>(),mediaListeners=new Map<string,EventListener>();
  const media={matches:false,addEventListener:(k:string,f:EventListener)=>mediaListeners.set(k,f),removeEventListener:(k:string)=>mediaListeners.delete(k)};
  const win={requestAnimationFrame:(f:FrameRequestCallback)=>{frames.set(++serial,f);return serial;},cancelAnimationFrame:(id:number)=>frames.delete(id),matchMedia:()=>media,addEventListener:(k:string,f:EventListener)=>windowListeners.set(k,f),removeEventListener:(k:string)=>windowListeners.delete(k)};
  const positions=[{top:0,bottom:950},{top:950,bottom:1900},{top:1900,bottom:2850}];
  const chapters=positions.map((rect,i)=>({dataset:{chapter:String(i+1)} as Record<string,string>,style:{setProperty:vi.fn()},getBoundingClientRect:()=>rect}));
  const scroll={isConnected:true,ownerDocument:{defaultView:win},getBoundingClientRect:()=>({top:0,bottom:600,height:600}),querySelectorAll:()=>chapters,addEventListener:(k:string,f:EventListener)=>listeners.set(k,f),removeEventListener:(k:string)=>listeners.delete(k)};
  const selected=vi.fn(),controller=createCampaignScenery(scroll as unknown as HTMLElement,selected);
  const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(f=>f(0));};
  const event=(collection:Map<string,EventListener>,name:string)=>collection.get(name)?.({} as Event);
  return {controller,scroll,chapters,positions,frames,media,listeners,windowListeners,mediaListeners,selected,flush,event};
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
  it('물·축제·초원은 서로 다른 자체 부품을 표시하고 조작 요소나 외부 파일을 추가하지 않습니다',()=>{
    expect(campaignScenery(4)).toContain('map-pond-rings');expect(campaignScenery(11)).not.toContain('map-windmill-blades');expect(campaignScenery(1)).toContain('map-windmill-blades');
    for(const id of [1,4,7,8,11]){const art=campaignScenery(id);expect(art).toContain('aria-hidden="true"');expect(art).not.toMatch(/<button|<a |<image|<script/);}
  });
});
