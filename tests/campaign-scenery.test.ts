import {describe,it,expect,vi} from 'vitest';
import {createCampaignScenery,campaignScenery,campaignWorld,campaignWorldName,campaignIsland,campaignGatewayBranches,campaignWorldPaint,campaignMusicTheme} from '../src/CampaignScenery';
import {levels,chapters} from '../src/levels';
import {existsSync,readFileSync} from 'node:fs';
import {campaignMemory,campaignMemoryArt} from '../src/CampaignMemories';
import {journeyArtSource} from '../src/JourneyGardenArt';

function setup(assetPaths:string[]=[],sourceChapters:number[]=[]){
  const frames=new Map<number,FrameRequestCallback>();let serial=0;
  const listeners=new Map<string,EventListener>(),windowListeners=new Map<string,EventListener>(),mediaListeners=new Map<string,EventListener>();
  const media={matches:false,addEventListener:(k:string,f:EventListener)=>mediaListeners.set(k,f),removeEventListener:(k:string)=>mediaListeners.delete(k)};
  const win={requestAnimationFrame:(f:FrameRequestCallback)=>{frames.set(++serial,f);return serial;},cancelAnimationFrame:(id:number)=>frames.delete(id),matchMedia:()=>media,addEventListener:(k:string,f:EventListener)=>windowListeners.set(k,f),removeEventListener:(k:string)=>windowListeners.delete(k)};
  const positions=[{top:0,bottom:950},{top:950,bottom:1900},{top:1900,bottom:2850}];
  const chapters=positions.map((rect,i)=>({dataset:{chapter:String(i+1)} as Record<string,string>,style:{setProperty:vi.fn()},getBoundingClientRect:()=>rect}));
  const sources=assetPaths.map((path,index)=>({closest:()=>chapters[sourceChapters[index]??0],isConnected:true,attrs:{'data-map-src':path} as Record<string,string>,getAttribute(k:string){return this.attrs[k]??null;},hasAttribute(k:string){return k in this.attrs;},setAttribute(k:string,v:string){this.attrs[k]=v;},removeAttribute(k:string){delete this.attrs[k];}}));
  const scroll={dataset:{} as Record<string,string>,isConnected:true,ownerDocument:{defaultView:win},getBoundingClientRect:()=>({top:0,bottom:600,height:600}),querySelectorAll:(selector:string)=>selector==='.campaign-chapter'?chapters:sources,contains:(node:unknown)=>sources.includes(node as typeof sources[number]),addEventListener:(k:string,f:EventListener)=>listeners.set(k,f),removeEventListener:(k:string)=>listeners.delete(k)};
  const images:{src:string;alt:string;decoding:string;onload:(()=>void)|null;onerror:(()=>void)|null;decode:ReturnType<typeof vi.fn>}[]=[];
  const createImage=()=>{const image={src:'',alt:'',decoding:'',onload:null as (()=>void)|null,onerror:null as (()=>void)|null,decode:vi.fn(()=>Promise.resolve())};images.push(image);return image as unknown as HTMLImageElement;};
  const selected=vi.fn(),controller=createCampaignScenery(scroll as unknown as HTMLElement,selected,createImage);
  const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(f=>f(0));};
  const event=(collection:Map<string,EventListener>,name:string)=>collection.get(name)?.({} as Event);
  return {controller,scroll,chapters,positions,frames,media,listeners,windowListeners,mediaListeners,selected,flush,event,images,createImage,sources};
}
describe('지도 풍경의 실제 수명과 스크롤 경계',()=>{
  it('후반20지역의 발판은 각 고유셀을 쓰고 기존100판11장의 HTML은 그대로입니다',()=>{
    const legacy=JSON.parse(readFileSync(new URL('./fixtures/islands-100-d5713c8.json',import.meta.url),'utf8'));
    for(let chapter=1;chapter<=11;chapter++)expect(campaignIsland(chapter)).toBe(legacy.chapters[String(chapter)]);
    const cells=new Set<string>(),sources=new Set<string>();
    for(let index=5;index<25;index++){
      const chapter=index+7,art=campaignIsland(chapter),source=art.match(/data-map-src="([^"]+)"/)![1],box=art.match(/height="100" viewBox="([^"]+)"/)![1];
      expect(art).toContain(`data-island-world="${campaignWorld(chapter)}"`);expect(art).toContain('x="18" width="100" height="100"');expect(art).toContain('overflow="hidden"');expect(art).not.toMatch(/\shref=|<button|<a |https?:/);
      expect(box.split(' ').map(Number)).toEqual([(index-5)%2*627,Math.floor((index-5)%4/2)*627,627,627]);
      const png=readFileSync(new URL('../public'+source,import.meta.url));expect([png.readUInt32BE(16),png.readUInt32BE(20),png[25]]).toEqual([1254,1254,6]);cells.add(source+' '+box);sources.add(source);
    }
    expect(cells.size).toBe(20);expect(sources.size).toBe(5);
  });
  it('신규20풍경은여행정원의정확한원본/스타일한개만연결하고기존5풍경은변경하지않습니다',()=>{
    const seen=new Set<string>();
    for(let index=0;index<5;index++){expect(campaignMemory(index)).toBeUndefined();expect(campaignMemoryArt(index,index+1)).toBe('');}
    for(let index=5;index<25;index++){
      const memory=campaignMemory(index)!,source=journeyArtSource(memory.project,memory.alt),html=campaignScenery(index+7,20);seen.add(memory.project+':'+memory.alt);
      expect(html.match(/data-map-memory=/g)).toHaveLength(1);expect(html).toContain(`data-map-src="${source.path}"`);expect(html).toContain(`rect x="${source.x}" y="${source.y}" width="${source.width}" height="${source.height}"`);expect(html).toContain(`id="map-memory-${index+7}"`);expect(html).not.toMatch(/\shref=|<button|<a |tabindex=|https?:/);
    }
    expect(seen.size).toBe(20);expect(campaignMemory(11)).toEqual({project:'moonbridge',alt:true});expect(campaignMemory(12)).toEqual({project:'moonbridge',alt:false});
  });
  it('3배경띠·20발판·입구·새작품도현재장안에서같은파일을한번만해독합니다',async()=>{
    const paths=[...campaignWorldPaint(12).matchAll(/data-map-src="([^\"]+)"/g),...Array.from({length:20},()=>[...campaignIsland(12).matchAll(/data-map-src="([^\"]+)"/g)][0]),...campaignGatewayBranches().matchAll(/data-map-src="([^\"]+)"/g),...campaignScenery(12,20).matchAll(/data-map-src="([^\"]+)"/g)].map(match=>match[1]);
    const h=setup(paths);h.controller.setActive(true);h.flush();expect(h.images).toHaveLength(new Set(paths).size);expect(h.images).toHaveLength(4);
    h.images.forEach(image=>image.onload?.());for(let i=0;i<12;i++)await Promise.resolve();expect(h.sources.every(source=>source.getAttribute('href')===source.getAttribute('data-map-src'))).toBe(true);
    h.controller.setActive(false);expect(h.sources.every(source=>!source.hasAttribute('href'))).toBe(true);expect(h.frames.size).toBe(0);
  });
  it('발판·입구는 내부 원본과 정확한 crop을 쓰며 해독 전에 주소나 입력 요소를 공개하지 않습니다',()=>{
    for(const chapter of [1,3,6,8,10]){const art=campaignIsland(chapter);expect(art).toContain('overflow="hidden"');expect(art).not.toMatch(/\shref=|<button|<a |https?:/);for(const match of art.matchAll(/data-map-src="([^"]+)"/g))expect(existsSync(new URL('../public'+match[1],import.meta.url))).toBe(true);}
    expect(campaignIsland(3)).toContain('x="18" width="100" height="100" viewBox="0 0 627 627"');expect(campaignIsland(10)).toContain('viewBox="627 627 627 627"');
    const branches=campaignGatewayBranches();expect(branches.match(/map-gateway-branch map-/g)).toHaveLength(2);expect(branches).toContain('viewBox="887 0 887 887"');expect(branches).not.toMatch(/\shref=|<button|<a /);
    for(const [name,w,h] of [['level-worlds-atlas-v1.png',1254,1254],['gateway-branches-v1.png',1774,887]] as const){const png=readFileSync(new URL('../public/assets/campaign/'+name,import.meta.url));expect([png.readUInt32BE(16),png.readUInt32BE(20),png[25]]).toEqual([w,h,6]);}
  });
  it('기존100레벨·11장ID를 보존하면서 큰 풍경은 정확히20레벨마다 바뀝니다',()=>{
    const counts=new Map<string,number>();
    for(const level of levels.slice(0,100)){const chapter=chapters.find(c=>c.first<=level.id&&c.last>=level.id)!;const world=campaignWorld(chapter.id);counts.set(world,(counts.get(world)??0)+1);}
    expect([...counts.values()]).toEqual([20,20,20,20,20]);
    const all=new Map<string,number>();for(const c of chapters)all.set(campaignWorld(c.id),(all.get(campaignWorld(c.id))??0)+c.last-c.first+1);expect(all.size).toBe(25);expect([...all.values()]).toEqual(Array(25).fill(20));
    expect(campaignWorldName(12,'ko')).toBe('라벤더 테라스 · 101–120');expect(campaignWorldName(31,'en')).toBe('Grand Blossom Fair · 481–500');
    for(const c of chapters){expect(campaignMusicTheme(c.id)).toMatch(c.id<=11?/^(meadow|brook|orchard|woodland|lantern)$/:/^(meadow|brook|orchard|woodland|lantern|garden|winter|tide|dream|clockwork|festival)$/);for(const m of campaignWorldPaint(c.id).matchAll(/data-map-src="([^"]+)"/g))expect(existsSync(new URL('../public'+m[1],import.meta.url))).toBe(true);}expect(campaignWorld(3)).toBe(campaignWorld(5));
    expect(campaignWorldName(11,'ko')).toBe('등불 언덕 · 81–100');expect(campaignWorldName(1,'en')).toBe('Blossom Meadow · 1–20');
  });
  it('새세계의음악은세계분위기에연결하고기존100판5곡배정은그대로입니다',()=>{
    expect(Array.from({length:11},(_,i)=>campaignMusicTheme(i+1))).toEqual(['meadow','meadow','brook','brook','brook','orchard','orchard','woodland','woodland','lantern','lantern']);
    expect([17,15,18,28,31].map(campaignMusicTheme)).toEqual(['winter','tide','dream','clockwork','festival']);
  });
  it('같은 풍경 내부에서는 재입장하지 않고 큰 풍경 경계에만 일회 반응하며 숨김·모션 감소는 지웁니다',()=>{
    const h=setup();h.controller.setActive(true);h.flush();expect(h.chapters.every(c=>!c.dataset.arrival)).toBe(true);
    Object.assign(h.positions[0],{top:-950,bottom:0});Object.assign(h.positions[1],{top:0,bottom:950});h.event(h.listeners,'scroll');h.flush();expect(h.scroll.dataset.world).toBe('meadow');expect(h.chapters[1].dataset.arrival).toBeUndefined();
    Object.assign(h.positions[1],{top:-950,bottom:0});Object.assign(h.positions[2],{top:0,bottom:950});h.event(h.listeners,'scroll');h.flush();expect(h.scroll.dataset.world).toBe('brook');expect(h.chapters[2].dataset.arrival).toBe('a');
    h.event(h.listeners,'scroll');h.flush();expect(h.chapters[2].dataset.arrival).toBe('a');h.media.matches=true;h.event(h.mediaListeners,'change');h.flush();expect(h.chapters[2].dataset.arrival).toBeUndefined();
    h.controller.setActive(false);expect(h.frames.size).toBe(0);h.controller.dispose();expect(h.scroll.dataset.world).toBeUndefined();
  });
  it('화면 절반 경계의 작은 왕복으로 구간 선택이 흔들리지 않습니다',()=>{
    const h=setup();h.controller.setActive(true);h.flush();Object.assign(h.positions[0],{top:-660,bottom:290});Object.assign(h.positions[1],{top:290,bottom:1240});h.event(h.listeners,'scroll');h.flush();expect(h.selected).toHaveBeenLastCalledWith(1);
    Object.assign(h.positions[0],{top:-750,bottom:200});Object.assign(h.positions[1],{top:200,bottom:1150});h.event(h.listeners,'scroll');h.flush();expect(h.selected).toHaveBeenLastCalledWith(2);
  });
  it('진입한 장을 완전히 벗어났다가 같은 물가의 이전 장으로 돌아와도 입장을 재생하지 않습니다',()=>{
    const h=setup();h.chapters.forEach((c,i)=>c.dataset.chapter=String(i+2));h.controller.setActive(true);h.flush();
    Object.assign(h.positions[0],{top:-950,bottom:0});Object.assign(h.positions[1],{top:0,bottom:950});h.event(h.listeners,'scroll');h.flush();expect(h.chapters[1].dataset.arrival).toBe('a');
    Object.assign(h.positions[1],{top:-950,bottom:0});Object.assign(h.positions[2],{top:0,bottom:950});h.event(h.listeners,'scroll');h.flush();expect(h.chapters[1].dataset.arrival).toBeUndefined();
    Object.assign(h.positions[1],{top:0,bottom:950});Object.assign(h.positions[2],{top:950,bottom:1900});h.event(h.listeners,'scroll');h.flush();expect(h.chapters[1].dataset.arrival).toBeUndefined();expect(h.scroll.dataset.arrival).toBe('a');
    h.controller.setActive(false);expect(h.scroll.dataset.arrival).toBeUndefined();
  });
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
  it('풍경 배치는 장마다 재현 가능하게 달라지고 모든 장에 같은 보조 소품을 강제하지 않습니다',()=>{
    const layouts=new Set<string>();
    for(let chapter=1;chapter<=31;chapter++){
      const html=campaignScenery(chapter,chapter===4||chapter===5?5:20);
      expect(html).toBe(campaignScenery(chapter,chapter===4||chapter===5?5:20));
      layouts.add(html.match(/data-scenery-layout="(\d+)"/)![1]);
      for(const source of html.matchAll(/data-map-src="([^"]+)"/g))expect(existsSync(new URL('../public'+source[1],import.meta.url))).toBe(true);
    }
    expect(layouts.size).toBe(6);expect(campaignScenery(1)).not.toContain('/bench.webp');
    expect(campaignScenery(4,5)).not.toContain('map-landmark-two');expect(campaignScenery(2)).toContain('map-landmark-two');
  });
  it('지도 활성화 전에는 원본을 해독하지 않고 전부 준비한 현재 owner만 회화 그림을 공개합니다',async()=>{
    const h=setup(['/assets/campaign/windmill-rig-v1.png','/assets/garden-structures-v1/pond-base.webp']);
    expect(h.images).toHaveLength(0);expect(h.sources.every(node=>!node.hasAttribute('href'))).toBe(true);h.controller.setActive(true);h.flush();expect(h.images).toHaveLength(2);
    let ready!:()=>void;h.images[1].decode.mockImplementation(()=>new Promise<void>(resolve=>ready=resolve));h.images.forEach(image=>image.onload!());for(let n=0;n<10;n++)await Promise.resolve();
    expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();h.controller.setActive(false);ready();for(let n=0;n<10;n++)await Promise.resolve();
    expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();expect(h.sources[0].getAttribute('href')).toBeNull();expect(h.chapters.every(c=>c.dataset.sceneryActive==='false')).toBe(true);h.controller.setActive(true);h.flush();expect(h.images).toHaveLength(4);h.images.slice(2).forEach(image=>image.onload!());for(let n=0;n<10;n++)await Promise.resolve();expect(h.chapters[0].dataset.sceneryArtReady).toBe('true');
    h.controller.dispose();expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();expect(h.images.every(image=>image.onload===null&&image.onerror===null)).toBe(true);
  });
  it('보이는 모달에서는 그림과 위치를 유지하고 모션·선택·도착만 멈춥니다',async()=>{
    const path='/assets/campaign/windmill-rig-v1.png',h=setup([path]);h.controller.setActive(true);h.flush();h.images[0].onload!();for(let n=0;n<10;n++)await Promise.resolve();
    const writes=h.chapters[0].style.setProperty.mock.calls.slice(),world=h.scroll.dataset.world;h.selected.mockClear();
    h.controller.setActive(false,true);h.flush();
    expect(h.sources[0].getAttribute('href')).toBe(path);expect(h.chapters[0].dataset.sceneryArtReady).toBe('true');expect(h.chapters.every(c=>c.dataset.sceneryActive==='false'&&!c.dataset.arrival)).toBe(true);
    expect(h.selected).not.toHaveBeenCalled();expect(h.scroll.dataset.world).toBe(world);expect(h.chapters[0].style.setProperty.mock.calls).toEqual(writes);expect(h.frames.size).toBe(0);
    h.controller.setActive(true);h.flush();expect(h.images).toHaveLength(1);expect(h.scroll.dataset.arrival).toBeUndefined();
    h.controller.setActive(false);expect(h.sources[0].getAttribute('href')).toBeNull();expect(h.chapters[0].dataset.sceneryArtReady).toBeUndefined();
  });
  it('보이는 모달 중 decode는 완료되지만 실제 숨김/폐기 뒤 늦은 완료는 소유하지 않습니다',async()=>{
    const path='/assets/campaign/windmill-rig-v1.png';
    for(const end of ['visible','hidden','disposed'] as const){
      const h=setup([path]);h.controller.setActive(true);h.flush();let ready!:()=>void;
      h.images[0].decode.mockImplementation(()=>new Promise<void>(resolve=>ready=resolve));h.images[0].onload!();await Promise.resolve();
      h.controller.setActive(false,true);h.flush();if(end==='hidden')h.controller.setActive(false);if(end==='disposed')h.controller.dispose();
      ready();for(let n=0;n<10;n++)await Promise.resolve();
      expect(h.sources[0].getAttribute('href')).toBe(end==='visible'?path:null);expect(h.chapters[0].dataset.sceneryArtReady).toBe(end==='visible'?'true':undefined);
      expect(h.chapters.every(c=>c.dataset.sceneryActive==='false')).toBe(true);expect(h.images).toHaveLength(1);h.controller.dispose();
    }
  });
  it('보이는 모달의 첫 정적그림과 resize는 현재 구간만 관리하고 세계 선택은 바꾸지 않습니다',async()=>{
    const a='/assets/campaign/worlds-expansion-a-v1.png',b='/assets/campaign/worlds-expansion-b-v1.png',h=setup([a,b],[0,1]);
    h.controller.setActive(false,true);h.flush();expect(h.images.map(i=>i.src)).toEqual([a]);h.images[0].onload!();for(let n=0;n<10;n++)await Promise.resolve();expect(h.sources[0].getAttribute('href')).toBe(a);expect(h.selected).not.toHaveBeenCalled();expect(h.scroll.dataset.world).toBeUndefined();
    Object.assign(h.positions[0],{top:-950,bottom:0});Object.assign(h.positions[1],{top:0,bottom:950});h.event(h.windowListeners,'resize');h.flush();
    expect(h.sources[0].getAttribute('href')).toBeNull();expect(h.images.map(i=>i.src)).toEqual([a,b]);h.images[1].onload!();for(let n=0;n<10;n++)await Promise.resolve();expect(h.sources[1].getAttribute('href')).toBe(b);
    h.media.matches=true;h.event(h.mediaListeners,'change');h.flush();expect(h.selected).not.toHaveBeenCalled();expect(h.chapters.every(c=>c.dataset.sceneryActive==='false'&&!c.dataset.arrival)).toBe(true);expect(h.frames.size).toBe(0);
    h.controller.setActive(false);expect(h.sources.every(node=>!node.hasAttribute('href'))).toBe(true);
  });
  it('실패·폐기·owner 교체 뒤 늦은 decode는 회화 그림을 되살리거나 재요청하지 않습니다',async()=>{
    const h=setup(['/assets/campaign/windmill-rig-v1.png']);h.controller.setActive(true);h.flush();let ready!:()=>void;
    h.images[0].decode.mockImplementation(()=>new Promise<void>(resolve=>ready=resolve));h.images[0].onload!();await Promise.resolve();
    const next=createCampaignScenery(h.scroll as unknown as HTMLElement,h.selected,h.createImage);next.setActive(true);h.flush();h.controller.dispose();ready();for(let n=0;n<10;n++)await Promise.resolve();expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();
    h.images[1].onerror!();for(let n=0;n<10;n++)await Promise.resolve();next.setActive(false);next.setActive(true);expect(h.images).toHaveLength(2);expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();next.dispose();
  });
  it('신규20풍경은입력없는부분연출을가지며전역타이머나외부그림을추가하지않습니다',()=>{
    for(let chapter=12;chapter<=31;chapter++){const art=campaignScenery(chapter,20);expect(art).toContain('data-world-weather=');expect(art.match(/class="map-world-motif /g)).toHaveLength(3);expect(art).not.toMatch(/<button|<a |https?:|<script|setInterval/);}
    expect(campaignScenery(13)).toContain('motif-wings');expect(campaignScenery(17)).toContain('data-world-weather="snow"');expect(campaignScenery(28)).toContain('motif-gear');
  });
  it('500판카탈로그에서도보이는장의원본만해독하고떠난장의소유href를해제합니다',async()=>{
    const h=setup(['/assets/campaign/worlds-expansion-a-v1.png','/assets/campaign/worlds-expansion-b-v1.png'],[0,1]);
    h.controller.setActive(true);h.flush();expect(h.images.map(i=>i.src)).toEqual(['/assets/campaign/worlds-expansion-a-v1.png']);
    h.images[0].onload!();for(let n=0;n<10;n++)await Promise.resolve();expect(h.chapters[0].dataset.sceneryArtReady).toBe('true');expect(h.chapters[1].dataset.sceneryArtReady).toBeUndefined();
    Object.assign(h.positions[0],{top:-950,bottom:0});Object.assign(h.positions[1],{top:0,bottom:950});h.event(h.listeners,'scroll');h.flush();
    expect(h.sources[0].getAttribute('href')).toBeNull();expect(h.chapters[0].dataset.sceneryArtReady).toBeUndefined();expect(h.images.map(i=>i.src)).toEqual(['/assets/campaign/worlds-expansion-a-v1.png','/assets/campaign/worlds-expansion-b-v1.png']);
    h.images[1].onload!();for(let n=0;n<10;n++)await Promise.resolve();expect(h.chapters[1].dataset.sceneryArtReady).toBe('true');h.controller.setActive(false);expect(h.sources.every(node=>!node.hasAttribute('href'))).toBe(true);expect(h.chapters.every(c=>!c.dataset.sceneryArtReady)).toBe(true);
  });
  it('준비 중 다른 코드가 같은 주소를 넣었더라도 미소유 href는 공개/폐기에서 제거하지 않습니다',async()=>{
    const path='/assets/campaign/windmill-rig-v1.png',h=setup([path]);h.controller.setActive(true);h.flush();h.sources[0].setAttribute('href',path);h.images[0].onload!();for(let n=0;n<10;n++)await Promise.resolve();
    expect(h.scroll.dataset.sceneryArtReady).toBeUndefined();h.controller.dispose();expect(h.sources[0].getAttribute('href')).toBe(path);
  });
});
