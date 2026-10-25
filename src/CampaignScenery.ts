import {worldAtmosphere} from './WorldAtmosphere';
import {campaignMemoryArt} from './CampaignMemories';
import type {MusicTheme} from './audio/AudioManager';
export const CAMPAIGN_WORLDS=["meadow", "brook", "orchard", "woodland", "lantern", "lavender", "honey", "lotus", "coast", "autumn", "snow", "aurora", "bamboo", "tea", "mushroom", "coral", "oasis", "crystal", "cloud", "firefly", "rose", "clock", "falls", "stars", "celebration"] as const;
export type CampaignWorld=typeof CAMPAIGN_WORLDS[number];
// 기존11장ID를 유지하고 신규20세계는 각20판/한 장으로 명시합니다.
export function campaignWorldIndex(chapter:number){return chapter<=2?0:chapter<=5?1:chapter<=7?2:chapter<=9?3:chapter<=11?4:Math.min(24,Math.max(5,chapter-7));}
export function campaignWorld(chapter:number):CampaignWorld{return CAMPAIGN_WORLDS[campaignWorldIndex(chapter)]!;}
const WORLD_KO=["꽃바람 초원", "햇살 물가", "꽃잎 과수원", "이끼 숲길", "등불 언덕", "라벤더 테라스", "꿀빛 언덕", "연꽃 물뜰", "진주 해변", "단풍 과수원", "눈꽃 정원", "오로라 호수", "대나무 달길", "차나무 언덕", "버섯 숲속", "산호 물빛", "햇살 오아시스", "수정 꽃동굴", "구름 산책로", "반딧불 습지", "장미 온실", "태엽 꽃마을", "무지개 폭포", "별유리 언덕", "꽃빛 대축제"];
const WORLD_EN=["Blossom Meadow", "Sunlit Brook", "Petal Orchard", "Mosswood Trail", "Lantern Hills", "Lavender Terraces", "Honey Hills", "Lotus Courtyard", "Pearl Coast", "Amber Orchard", "Snowblossom Garden", "Aurora Lake", "Bamboo Moonwalk", "Tea Terraces", "Mushroom Grove", "Coral Lagoon", "Sunlit Oasis", "Crystal Bloom Cave", "Cloud Promenade", "Firefly Marsh", "Rose Conservatory", "Clockwork Blossoms", "Rainbow Falls", "Starglass Hills", "Grand Blossom Fair"];
export function campaignWorldName(chapter:number,language:'ko'|'en'){
  const index=campaignWorldIndex(chapter);return `${(language==='ko'?WORLD_KO:WORLD_EN)[index]} · ${index*20+1}–${index*20+20}`;
}
const WORLD_MUSIC:readonly MusicTheme[]=['meadow','brook','orchard','woodland','lantern','orchard','meadow','tide','tide','orchard','winter','dream','woodland','meadow','dream','tide','meadow','dream','dream','dream','garden','clockwork','tide','dream','festival'];
export function campaignMusicTheme(chapter:number):MusicTheme{return WORLD_MUSIC[campaignWorldIndex(chapter)]!;}
/** 원본정사각형을3장의그림띠로연결해20판긴장에서도가장자리풍경을지나치게확대하지않습니다. */
export function campaignWorldPaint(chapter:number){
  const index=campaignWorldIndex(chapter);if(index===0)return '';
  if(index<5){const cell=index-1;return `<svg class="map-world-paint" viewBox="${cell%2*627} ${Math.floor(cell/2)*627} 627 627" preserveAspectRatio="xMidYMid slice"><image class="map-painted-image" data-map-src="/assets/campaign/worlds-atlas-v1.png" width="1254" height="1254"/></svg>`;}
  const cell=(index-5)%4,group=String.fromCharCode(97+Math.floor((index-5)/4));
  return [0,1,2].map(part=>`<svg class="map-world-paint map-expansion-paint map-expansion-paint-${part}" viewBox="${cell%2*627} ${Math.floor(cell/2)*627} 627 627" preserveAspectRatio="xMidYMid slice"><image class="map-painted-image" data-map-src="/assets/campaign/worlds-expansion-${group}-v1.png" width="1254" height="1254"/></svg>`).join('');
}
/** 번호/상태를 그림에 굽지 않습니다. 원본비율 유지·기존 owner 해독 게이트를 공유합니다. */
export function campaignIsland(chapter:number){
  const index=([0,1,2,3,4,2,0,1,1,2,4,4,3,0,3,1,0,4,4,4,2,2,1,4,2][campaignWorldIndex(chapter)]??0)-1;
  const box=index<0?'0 0 1506 1044':`${index%2*627} ${Math.floor(index/2)*627} 627 627`;
  return `<svg class="campaign-island" viewBox="0 0 136 100" aria-hidden="true"><svg x="${index<0?0:18}" width="${index<0?136:100}" height="100" viewBox="${box}" preserveAspectRatio="xMidYMid meet" overflow="hidden"><image class="map-painted-image" data-map-src="/assets/campaign/${index<0?'level-island-v1.png':'level-worlds-atlas-v1.png'}" width="${index<0?1506:1254}" height="${index<0?1044:1254}"/></svg></svg>`;
}
export function campaignGatewayBranches(){
  return [0,1].map(side=>`<svg class="map-gateway-branch map-gateway-branch-${side?'right':'left'}" viewBox="${side*887} 0 887 887" preserveAspectRatio="xMidYMid meet"><image class="map-painted-image" data-map-src="/assets/campaign/gateway-branches-v1.png" width="1774" height="887"/></svg>`).join('');
}
/** 자체 제작한 작은 풍경입니다. 진행·난수·저장에 관여하지 않는 장식 레이어입니다. */
export function campaignScenery(chapter:number,stageCount=10){
  if(campaignWorldIndex(chapter)>=5)return `<div class="campaign-scenery" aria-hidden="true">${campaignMemoryArt(campaignWorldIndex(chapter),chapter)}${worldAtmosphere(campaignWorldIndex(chapter))}</div>`;
  const world=campaignMusicTheme(chapter),water=world==='brook',festival=world==='lantern',hills=world==='woodland';
  const crown=(x:number,y:number,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})"><ellipse cy="28" rx="24" ry="5" fill="#365b3820"/><path d="M-3 24L0-27L5 24" fill="#95704a"/><g class="map-tree-crown"><path d="M-4-58C-30-62-38-35-27-23C-45-4-22 13-4 5C13 21 39-2 25-19C43-40 21-68-4-58Z" fill="#68966a"/><path d="M-4-58C-24-58-30-41-25-29C-9-41 5-20 19-32C30-45 13-63-4-58Z" fill="#97b27b"/><path d="M-21-18Q-5-29 18-11" fill="none" stroke="#b8c88b" stroke-width="3" stroke-linecap="round"/></g></g>`;
  const windmill=`<g transform="translate(43 90)"><ellipse cy="29" rx="29" ry="5" fill="#365b3820"/><path d="M-13 27L-9-25H11L17 27Z" fill="#e1c38f" stroke="#a6835b" stroke-width="2"/><path d="M-17-24L1-47L20-24Z" fill="#a96b54"/><path d="M-3 27V12Q3 6 9 12V27" fill="#807558"/><g class="map-windmill-blades"><path d="M0-2L-7-29L2-36L5-4M2 0L29-7L36 2L4 5M0 2L7 29L-2 36L-5 4M-2 0L-29 7L-36-2L-4-5" fill="#fff0ca" stroke="#b49a6d" stroke-width="1.5"/><circle r="5" fill="#c38b5e"/></g></g>`;
  const pond=`<g transform="translate(42 74)"><ellipse rx="40" ry="22" fill="#91ae83"/><ellipse cy="-2" rx="35" ry="18" fill="#91bdba"/><path d="M-29-8Q-13-20 10-14" fill="none" stroke="#d5e8ce" stroke-width="3" stroke-linecap="round"/><g class="map-pond-rings" fill="none" stroke="#e6f0d7" stroke-width="1.5"><ellipse cx="9" cy="3" rx="12" ry="4"/><ellipse cx="9" cy="3" rx="19" ry="7"/></g><ellipse cx="-15" cy="4" rx="9" ry="4" fill="#6e9c75"/><path d="M-16 2Q-25-9-16-7Q-10-17-8-5Q0-4-9 2Z" fill="#f2d9bc"/></g>`;
  const arch=`<g transform="translate(43 65)"><ellipse cy="31" rx="33" ry="6" fill="#365b3820"/><path d="M-26 31V-8Q0-46 26-8V31M-21 31V-8Q0-37 21-8V31" fill="none" stroke="#bd9870" stroke-width="5"/><path d="M-29-3Q-22-40 0-32T29-3" fill="none" stroke="#78996b" stroke-width="10"/><g fill="#eebf9e"><circle cx="-22" cy="-18" r="5"/><circle cy="-34" r="5"/><circle cx="22" cy="-18" r="5"/></g></g>`;
  const landmark=water?pond:festival||world==='orchard'?arch:hills?crown(43,85,1.15):windmill;
  const atlas='/assets/campaign/windmill-rig-v1.png';
  const image=(file:string,x=1,y=22,width=84,height=100)=>`<image class="map-painted-image" data-map-src="/assets/garden-structures-v1/${file}.webp" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
  const paintedWindmill=`<svg x="-20" y="12" width="100" height="100" viewBox="0 0 887 887" overflow="hidden"><image class="map-painted-image" data-map-src="${atlas}" width="1774" height="887"/></svg><g transform="translate(51.5 57)"><g class="map-windmill-rotor"><svg x="-39" y="-43" width="78" height="78" viewBox="887 0 887 887" overflow="hidden"><image class="map-painted-image" data-map-src="${atlas}" width="1774" height="887"/></svg></g></g>`;
  const paintedMain=water?image('pond-base')+`<g transform="translate(40 72)"><g class="map-pond-rings" fill="none" stroke="#ecf3dd" stroke-width="1.2"><ellipse cx="9" cy="3" rx="12" ry="4"/><ellipse cx="9" cy="3" rx="19" ry="7"/></g></g>`:festival?image('arch-alt'):world==='orchard'?image('arch-base'):hills?image('shelter-base'):paintedWindmill;
  const sideFile=chapter===1?'bench':chapter===2?'shelter-base':chapter===3?'lantern':chapter===4?'lily':chapter===5?'shelter-foundation':chapter===6?'arch-base':chapter===7?'bridge':chapter===8?'lantern':chapter===9?'arch-alt':chapter===10?'shelter-alt':'lantern';
  const paintedSide=image(sideFile,2,30,82,98);
  const flower=(x:number,y:number,color:string)=>`<g transform="translate(${x} ${y})"><path d="M0 0V13M0 9Q-10 0-9 8Z" fill="#6f915c" stroke="#6f915c"/><g class="map-flower-head" fill="${color}"><circle cx="-4" cy="-3" r="4"/><circle cx="4" cy="-3" r="4"/><circle cy="-7" r="4"/><circle cy="1" r="4"/><circle cy="-3" r="2.5" fill="#f9e3a6"/></g></g>`;
  const butterfly=`<g transform="translate(52 23)"><g class="map-butterfly-flight"><path class="map-butterfly-wing" d="M0 1C-9-19-22-11-14-1C-25 10-8 17 0 3Z" fill="#e8ae92" stroke="#b78771" stroke-width=".8"/><path class="map-butterfly-wing" d="M0 1C9-19 22-11 14-1C25 10 8 17 0 3Z" fill="#f0dba0" stroke="#b69c71" stroke-width=".8"/><path d="M0-5V7M0-4L-3-8M0-4L3-8" fill="none" stroke="#72654e" stroke-width="1.7" stroke-linecap="round"/></g></g>`;
  const grove=(side:'left'|'right',style:'meadow'|'daisy'|'violet')=>`<svg data-map-grove="${side}" class="map-landmark map-mid-grove map-mid-grove-${side}" viewBox="0 0 86 112"><ellipse cx="43" cy="90" rx="35" ry="6" fill="#54764a18"/><g class="map-landmark-fallback">${flower(22,75,'#efd1a9')}${flower(43,85,'#ddb1b1')}${flower(65,74,'#eaddad')}</g><g class="map-landmark-painted"><image class="map-painted-image" data-map-src="/assets/garden-v4/flowers-${style}.webp" x="3" y="28" width="80" height="72" preserveAspectRatio="xMidYMid meet"/></g>${butterfly}</svg>`;
  // 짧은5판 장은 원래 두 랜드마크만 둡니다. 바깥 배치는 CSS, 부분 움직임은 안쪽 그룹이 소유합니다.
  const groves=Number.isInteger(stageCount)&&stageCount>=8?grove('right',water?'violet':festival?'daisy':'meadow')+grove('left',chapter%2===0?'daisy':'violet'):'';
  return `<div class="campaign-scenery" data-map-theme="${water?'water':festival?'festival':hills?'hills':'meadow'}" aria-hidden="true"><div class="map-distant"></div><div class="map-cloud map-cloud-one"><i></i><i></i><i></i></div><div class="map-cloud map-cloud-two"><i></i><i></i><i></i></div><svg class="map-landmark map-landmark-one" viewBox="0 0 86 140"><g class="map-landmark-fallback">${landmark}</g><g class="map-landmark-painted">${paintedMain}</g>${flower(16,119,'#e8b5a0')}${flower(65,125,'#f1d88c')}</svg><svg class="map-landmark map-landmark-two" viewBox="0 0 86 140"><g class="map-landmark-fallback">${crown(43,85,hills?1.15:.95)}</g><g class="map-landmark-painted">${paintedSide}</g>${flower(16,126,'#d9bbd0')}${flower(70,118,'#f2d88d')}</svg>${groves}<div class="map-fireflies"><i></i><i></i><i></i></div></div>`;
}

interface Scenery {setActive(active:boolean):void;dispose():void}
const owners=new WeakMap<HTMLElement,Scenery>();
/** 스크롤을 가로채지 않고 이벤트 묶음마다 한 프레임만 예약합니다. 숨은 장·다른 탭에서는 멈춥니다. */
export function createCampaignScenery(scroll:HTMLElement,onChapter:(id:number)=>void,createImage:()=>HTMLImageElement=()=>new Image()):Scenery {
  owners.get(scroll)?.dispose();
  const win=scroll.ownerDocument.defaultView!;
  const chapters=Array.from(scroll.querySelectorAll<HTMLElement>('.campaign-chapter'));
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let active=false,disposed=false,frame:number|undefined;
  let lastWorld:CampaignWorld|undefined,arrival=false,lastSelected=0;
  type ArtSlot={node:SVGImageElement;src:string};
  type ArtGroup={element:HTMLElement;slots:ArtSlot[];images:HTMLImageElement[];assigned:Map<SVGImageElement,string>;run:number;wanted:boolean;status:'idle'|'loading'|'ready'|'failed'};
  const groups:ArtGroup[]=chapters.map(element=>({element,slots:[],images:[],assigned:new Map(),run:0,wanted:false,status:'idle'}));
  for(const node of Array.from(scroll.querySelectorAll<SVGImageElement>('.map-painted-image'))){
    const src=node.getAttribute('data-map-src'),group=groups.find(group=>group.element===node.closest('.campaign-chapter'));
    if(src?.startsWith('/assets/')&&group)group.slots.push({node,src});
  }
  const current=()=>!disposed&&owners.get(scroll)===scenery&&scroll.isConnected;
  const cancel=()=>{if(frame!==undefined)win.cancelAnimationFrame(frame);frame=undefined;};
  const reflectReady=()=>{if(!current())return;if(groups.some(g=>g.status==='ready'))scroll.dataset.sceneryArtReady='true';else delete scroll.dataset.sceneryArtReady;};
  const clearLoads=(group:ArtGroup)=>{for(const image of group.images)image.onload=image.onerror=null;group.images.length=0;};
  const release=(group:ArtGroup)=>{
    group.run++;group.wanted=false;clearLoads(group);
    for(const [node,src] of group.assigned)if(node.getAttribute('href')===src)node.removeAttribute('href');group.assigned.clear();
    delete group.element.dataset.sceneryArtReady;if(group.status!=='failed')group.status='idle';
  };
  const prepareArt=(group:ArtGroup)=>{
    if(group.status!=='idle'||!group.slots.length)return;group.status='loading';const run=++group.run;
    const owns=()=>current()&&active&&group.wanted&&group.run===run;
    const sources=[...new Set(group.slots.map(slot=>slot.src))];
    void Promise.all(sources.map(src=>new Promise<void>((resolve,reject)=>{
      const image=createImage();group.images.push(image);image.decoding='async';image.alt='';
      image.onload=()=>{image.onload=image.onerror=null;void Promise.resolve().then(()=>{if(!owns())throw new Error('map-art-inactive-owner');return image.decode();}).then(resolve,reject);};
      image.onerror=()=>reject(new Error('map-art-image-failed'));image.src=src;
    }))).then(()=>{
      if(!owns())return;clearLoads(group);
      if(!group.slots.every(({node,src})=>node.isConnected&&scroll.contains(node)&&node.getAttribute('data-map-src')===src&&!node.hasAttribute('href'))){group.status='failed';reflectReady();return;}
      for(const {node,src} of group.slots){node.setAttribute('href',src);group.assigned.set(node,src);}group.status='ready';group.element.dataset.sceneryArtReady='true';reflectReady();
    }).catch(()=>{if(!owns())return;clearLoads(group);group.status='failed';reflectReady();});
  };
  const reset=()=>{delete scroll.dataset.arrival;for(const group of groups)release(group);reflectReady();for(const chapter of chapters){chapter.dataset.sceneryActive='false';delete chapter.dataset.arrival;chapter.style.setProperty('--map-drift','0px');chapter.style.setProperty('--map-scroll-progress','0');}};
  const paint=()=>{
    frame=undefined;if(!current()||!active)return;
    const bounds=scroll.getBoundingClientRect();if(bounds.height<=0){reset();return;}
    let largest=0,selected=0,previousOverlap=0;
    for(const chapter of chapters){
      const rect=chapter.getBoundingClientRect(),visible=rect.bottom>bounds.top&&rect.top<bounds.bottom;
      const group=groups.find(group=>group.element===chapter)!;
      if(visible){group.wanted=true;prepareArt(group);}else if(group.wanted||group.status==='ready'||group.status==='loading')release(group);
      if(media?.matches||!visible)delete chapter.dataset.arrival;
      chapter.dataset.sceneryActive=String(visible&&!media?.matches);
      const drift=visible&&!media?.matches?Math.max(-30,Math.min(30,(bounds.top+bounds.height*.5-rect.top)*.045)):0;
      chapter.style.setProperty('--map-scroll-progress',visible&&!media?.matches?String(Math.max(0,Math.min(1,(bounds.top+bounds.height-rect.top)/(rect.bottom-rect.top+bounds.height)))):'0');
      chapter.style.setProperty('--map-drift',`${drift.toFixed(2)}px`);
      const overlap=Math.max(0,Math.min(rect.bottom,bounds.bottom)-Math.max(rect.top,bounds.top));
      if(Number(chapter.dataset.chapter)===lastSelected)previousOverlap=overlap;
      if(overlap>largest){largest=overlap;selected=Number(chapter.dataset.chapter);}
    }
    reflectReady();
    // 경계에서 손가락이 조금 흔들릴 때 입장 연출·곡이 계속 왕복하지 않도록 여유를 둡니다.
    if(previousOverlap>0&&largest-previousOverlap<bounds.height*.12)selected=lastSelected;
    if(Number.isInteger(selected)&&selected>0){
      const world=campaignWorld(selected),changed=lastWorld!==undefined&&lastWorld!==world;
      if(media?.matches)delete scroll.dataset.arrival;
      if(changed&&!media?.matches){
        for(const chapter of chapters)delete chapter.dataset.arrival;
        const destination=chapters.find(chapter=>Number(chapter.dataset.chapter)===selected);
        const token=(arrival=!arrival)?'a':'b';scroll.dataset.arrival=token;
        if(destination)destination.dataset.arrival=token;
      }
      lastSelected=selected;lastWorld=world;scroll.dataset.world=world;onChapter(selected);
    }
  };
  const schedule=()=>{if(current()&&active&&frame===undefined)frame=win.requestAnimationFrame(paint);};
  const scenery:Scenery={setActive(value){if(!current())return;active=value;cancel();if(active){schedule();}else reset();},dispose(){if(disposed)return;disposed=true;cancel();scroll.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);media?.removeEventListener('change',schedule);if(owners.get(scroll)===scenery){reset();delete scroll.dataset.sceneryArtReady;delete scroll.dataset.world;owners.delete(scroll);}}};
  owners.set(scroll,scenery);reset();scroll.addEventListener('scroll',schedule,{passive:true});win.addEventListener('resize',schedule);media?.addEventListener('change',schedule);
  return scenery;
}
