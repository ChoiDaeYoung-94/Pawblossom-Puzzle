/** 자체 제작한 작은 풍경입니다. 진행·난수·저장에 관여하지 않는 장식 레이어입니다. */
export function campaignScenery(chapter:number){
  const water=chapter===4||chapter===7,festival=chapter===11,hills=chapter===8||chapter===10;
  const sky=water?'#d9eee4':festival?'#eee4d5':hills?'#e0e8d4':'#e9efd3';
  const crown=(x:number,y:number,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})"><ellipse cy="28" rx="24" ry="5" fill="#365b3820"/><path d="M-3 24L0-27L5 24" fill="#95704a"/><g class="map-tree-crown"><path d="M-4-58C-30-62-38-35-27-23C-45-4-22 13-4 5C13 21 39-2 25-19C43-40 21-68-4-58Z" fill="#68966a"/><path d="M-4-58C-24-58-30-41-25-29C-9-41 5-20 19-32C30-45 13-63-4-58Z" fill="#97b27b"/><path d="M-21-18Q-5-29 18-11" fill="none" stroke="#b8c88b" stroke-width="3" stroke-linecap="round"/></g></g>`;
  const windmill=`<g transform="translate(43 90)"><ellipse cy="29" rx="29" ry="5" fill="#365b3820"/><path d="M-13 27L-9-25H11L17 27Z" fill="#e1c38f" stroke="#a6835b" stroke-width="2"/><path d="M-17-24L1-47L20-24Z" fill="#a96b54"/><path d="M-3 27V12Q3 6 9 12V27" fill="#807558"/><g class="map-windmill-blades"><path d="M0-2L-7-29L2-36L5-4M2 0L29-7L36 2L4 5M0 2L7 29L-2 36L-5 4M-2 0L-29 7L-36-2L-4-5" fill="#fff0ca" stroke="#b49a6d" stroke-width="1.5"/><circle r="5" fill="#c38b5e"/></g></g>`;
  const pond=`<g transform="translate(42 74)"><ellipse rx="40" ry="22" fill="#91ae83"/><ellipse cy="-2" rx="35" ry="18" fill="#91bdba"/><path d="M-29-8Q-13-20 10-14" fill="none" stroke="#d5e8ce" stroke-width="3" stroke-linecap="round"/><g class="map-pond-rings" fill="none" stroke="#e6f0d7" stroke-width="1.5"><ellipse cx="9" cy="3" rx="12" ry="4"/><ellipse cx="9" cy="3" rx="19" ry="7"/></g><ellipse cx="-15" cy="4" rx="9" ry="4" fill="#6e9c75"/><path d="M-16 2Q-25-9-16-7Q-10-17-8-5Q0-4-9 2Z" fill="#f2d9bc"/></g>`;
  const arch=`<g transform="translate(43 65)"><ellipse cy="31" rx="33" ry="6" fill="#365b3820"/><path d="M-26 31V-8Q0-46 26-8V31M-21 31V-8Q0-37 21-8V31" fill="none" stroke="#bd9870" stroke-width="5"/><path d="M-29-3Q-22-40 0-32T29-3" fill="none" stroke="#78996b" stroke-width="10"/><g fill="#eebf9e"><circle cx="-22" cy="-18" r="5"/><circle cy="-34" r="5"/><circle cx="22" cy="-18" r="5"/></g></g>`;
  const landmark=water?pond:festival?arch:windmill;
  const atlas='/assets/campaign/windmill-rig-v1.png';
  const image=(file:string,x=1,y=22,width=84,height=100)=>`<image class="map-painted-image" href="/assets/garden-structures-v1/${file}.webp" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
  const paintedWindmill=`<svg x="-20" y="12" width="100" height="100" viewBox="0 0 887 887" overflow="hidden"><image class="map-painted-image" href="${atlas}" width="1774" height="887"/></svg><g transform="translate(51.5 57)"><g class="map-windmill-rotor"><svg x="-39" y="-43" width="78" height="78" viewBox="887 0 887 887" overflow="hidden"><image class="map-painted-image" href="${atlas}" width="1774" height="887"/></svg></g></g>`;
  const paintedMain=water?image('pond-base')+`<g transform="translate(40 72)"><g class="map-pond-rings" fill="none" stroke="#ecf3dd" stroke-width="1.2"><ellipse cx="9" cy="3" rx="12" ry="4"/><ellipse cx="9" cy="3" rx="19" ry="7"/></g></g>`:festival?image('arch-alt'):paintedWindmill;
  const sideFile=chapter===1?'bench':chapter===2?'shelter-base':chapter===3?'lantern':chapter===4?'lily':chapter===5?'shelter-foundation':chapter===6?'arch-base':chapter===7?'bridge':chapter===8?'lantern':chapter===9?'arch-alt':chapter===10?'shelter-alt':'lantern';
  const paintedSide=image(sideFile,2,30,82,98);
  const flower=(x:number,y:number,color:string)=>`<g transform="translate(${x} ${y})"><path d="M0 0V13M0 9Q-10 0-9 8Z" fill="#6f915c" stroke="#6f915c"/><g class="map-flower-head" fill="${color}"><circle cx="-4" cy="-3" r="4"/><circle cx="4" cy="-3" r="4"/><circle cy="-7" r="4"/><circle cy="1" r="4"/><circle cy="-3" r="2.5" fill="#f9e3a6"/></g></g>`;
  return `<div class="campaign-scenery" data-map-theme="${water?'water':festival?'festival':hills?'hills':'meadow'}" aria-hidden="true"><svg class="map-distant" viewBox="0 0 480 900" preserveAspectRatio="none"><path d="M0 0H480V900H0Z" fill="${sky}" opacity=".35"/><path d="M0 140Q55 45 135 157T310 125T480 160V260Q400 185 300 250T110 235T0 280Z" fill="#9db990" opacity=".2"/><path d="M0 710Q100 620 200 705T480 675V820Q330 735 250 810T0 840Z" fill="#9db990" opacity=".2"/></svg><div class="map-cloud map-cloud-one"><i></i><i></i><i></i></div><div class="map-cloud map-cloud-two"><i></i><i></i><i></i></div><svg class="map-landmark map-landmark-one" viewBox="0 0 86 140"><g class="map-landmark-fallback">${landmark}</g><g class="map-landmark-painted">${paintedMain}</g>${flower(16,119,'#e8b5a0')}${flower(65,125,'#f1d88c')}</svg><svg class="map-landmark map-landmark-two" viewBox="0 0 86 140"><g class="map-landmark-fallback">${crown(43,85,hills?1.15:.95)}</g><g class="map-landmark-painted">${paintedSide}</g>${flower(16,126,'#d9bbd0')}${flower(70,118,'#f2d88d')}</svg><div class="map-fireflies"><i></i><i></i><i></i></div></div>`;
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
  let prepared=false;
  const images:HTMLImageElement[]=[];
  const sources=[...new Set(Array.from(scroll.querySelectorAll<SVGImageElement>('.map-painted-image'),node=>node.getAttribute('href')).filter((path):path is string=>Boolean(path?.startsWith('/assets/'))))];
  const current=()=>!disposed&&owners.get(scroll)===scenery&&scroll.isConnected;
  const cancel=()=>{if(frame!==undefined)win.cancelAnimationFrame(frame);frame=undefined;};
  const clearLoads=()=>{for(const image of images)image.onload=image.onerror=null;images.length=0;};
  const prepareArt=()=>{
    if(prepared||!sources.length)return;prepared=true;
    void Promise.all(sources.map(src=>new Promise<void>((resolve,reject)=>{
      const image=createImage();images.push(image);image.decoding='async';image.alt='';
      image.onload=()=>{image.onload=image.onerror=null;void Promise.resolve().then(()=>{if(!current())throw new Error('map-art-inactive-owner');return image.decode();}).then(resolve,reject);};
      image.onerror=()=>reject(new Error('map-art-image-failed'));image.src=src;
    }))).then(()=>{clearLoads();if(current())scroll.dataset.sceneryArtReady='true';}).catch(()=>{clearLoads();if(current())delete scroll.dataset.sceneryArtReady;});
  };
  const reset=()=>{for(const chapter of chapters){chapter.dataset.sceneryActive='false';chapter.style.setProperty('--map-drift','0px');}};
  const paint=()=>{
    frame=undefined;if(!current()||!active)return;
    const bounds=scroll.getBoundingClientRect();if(bounds.height<=0){reset();return;}
    let largest=0,selected=0;
    for(const chapter of chapters){
      const rect=chapter.getBoundingClientRect(),visible=rect.bottom>bounds.top&&rect.top<bounds.bottom;
      chapter.dataset.sceneryActive=String(visible&&!media?.matches);
      const drift=visible&&!media?.matches?Math.max(-30,Math.min(30,(bounds.top+bounds.height*.5-rect.top)*.045)):0;
      chapter.style.setProperty('--map-drift',`${drift.toFixed(2)}px`);
      const overlap=Math.max(0,Math.min(rect.bottom,bounds.bottom)-Math.max(rect.top,bounds.top));
      if(overlap>largest){largest=overlap;selected=Number(chapter.dataset.chapter);}
    }
    if(Number.isInteger(selected)&&selected>0)onChapter(selected);
  };
  const schedule=()=>{if(current()&&active&&frame===undefined)frame=win.requestAnimationFrame(paint);};
  const scenery:Scenery={setActive(value){if(!current())return;active=value;cancel();if(active){prepareArt();schedule();}else reset();},dispose(){if(disposed)return;disposed=true;cancel();clearLoads();scroll.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);media?.removeEventListener('change',schedule);if(owners.get(scroll)===scenery){reset();delete scroll.dataset.sceneryArtReady;owners.delete(scroll);}}};
  owners.set(scroll,scenery);reset();scroll.addEventListener('scroll',schedule,{passive:true});win.addEventListener('resize',schedule);media?.addEventListener('change',schedule);
  return scenery;
}
