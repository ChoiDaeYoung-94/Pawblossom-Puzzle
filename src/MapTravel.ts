import {pipWalkArt,PIP_WALK_SOURCE} from './PipWalkArt';
import {travelPoint,type RoutePoint} from './CampaignRoute';

let instance=0;
export function createMapTravel(scroll:HTMLElement,from:HTMLElement,to:HTMLElement,pip:HTMLElement,owns:()=>boolean,onPlaying:(playing:boolean)=>void=()=>{}){
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let phase:'armed'|'loading'|'walking'|'done'='armed',active=false,disposed=false;
  let ghost:HTMLElement|undefined,image:HTMLImageElement|undefined,frame:number|undefined,timer:number|undefined;
  let origin:RoutePoint,destination:RoutePoint,seam:RoutePoint|undefined,duration=900,started:number|undefined;
  const alive=()=>!disposed&&active&&owns()&&scroll.isConnected&&from.isConnected&&to.isConnected&&pip.isConnected&&!document.hidden&&!reduced.matches;
  const cleanup=()=>{
    if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;
    if(timer!==undefined)clearTimeout(timer);timer=undefined;
    if(image){image.onload=null;image.onerror=null;image.removeAttribute('src');image=undefined;}
    ghost?.querySelectorAll('image').forEach(node=>node.removeAttribute('href'));ghost?.remove();ghost=undefined;
    pip.classList.remove('map-pip-suspended');
    scroll.removeEventListener('pointerdown',cancel,true);scroll.removeEventListener('wheel',cancel,true);scroll.removeEventListener('touchstart',cancel,true);scroll.removeEventListener('keydown',cancel,true);
    window.removeEventListener('resize',cancel);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener?.('change',cancel);
  };
  const finish=()=>{if(phase==='done')return;phase='done';cleanup();onPlaying(false);};
  function cancel(){finish();}
  function visibility(){if(document.hidden)finish();}
  function draw(t:number){
    if(!ghost)return;
    const point=travelPoint(origin,destination,t,seam),side=-40*(1+Math.cos(2*Math.PI*t))/2;
    ghost.style.transform=`translate3d(${point.x+side-36}px,${point.y+18-600/627*72}px,0)`;
  }
  function tick(now:number){
    frame=undefined;if(!alive()||phase!=='walking'){finish();return;}
    started??=now;const raw=Math.min(1,Math.max(0,(now-started)/duration)),t=raw*raw*(3-2*raw);
    ghost!.dataset.frame=String(raw>.9?0:Math.floor((now-started)/120)%4);draw(t);
    if(raw===1)finish();else frame=requestAnimationFrame(tick);
  }
  function ready(){
    if(phase!=='loading')return;
    if(!alive()){finish();return;}
    if(timer!==undefined)clearTimeout(timer);timer=undefined;
    ghost!.querySelectorAll('image').forEach(node=>node.setAttribute('href',PIP_WALK_SOURCE));ghost!.dataset.ready='true';
    phase='walking';frame=requestAnimationFrame(tick);
  }
  function start(){
    if(phase!=='armed')return;
    if(!alive()){finish();return;}
    const viewport=scroll.getBoundingClientRect(),a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
    if(viewport.height<=0||a.width<=0||b.width<=0){finish();return;}
    const point=(rect:DOMRect):RoutePoint=>({x:rect.left+rect.width/2-viewport.left+scroll.scrollLeft-scroll.clientLeft,y:rect.top+rect.height/2-viewport.top+scroll.scrollTop-scroll.clientTop});
    origin=point(a);destination=point(b);
    // 매우 짧은 화면에서는 두 위치를 억지로 가리지 않고 현재 위치를 표시합니다.
    if(destination.y<=origin.y||destination.y-origin.y+88>viewport.height){finish();return;}
    const section=from.closest<HTMLElement>('.campaign-chapter');
    if(section&&section!==to.closest('.campaign-chapter')){
      const y=section.getBoundingClientRect().bottom-viewport.top+scroll.scrollTop-scroll.clientTop;
      if(y>origin.y&&y<destination.y)seam={x:destination.x,y};
    }
    duration=Math.min(1500,Math.max(800,Math.hypot(destination.x-origin.x,destination.y-origin.y)*5));
    phase='loading';ghost=document.createElement('span');ghost.className='map-pip-walk';ghost.setAttribute('aria-hidden','true');ghost.dataset.frame='0';ghost.dataset.facing=destination.x<origin.x?'left':'right';
    ghost.innerHTML=`<span class="pip-walk-facing"><img class="pip-walk-loading" src="/assets/pip-idle-open-v2.webp" alt="">${pipWalkArt(++instance)}</span>`;
    scroll.append(ghost);pip.classList.add('map-pip-suspended');draw(0);
    scroll.scrollTop=Math.max(0,Math.min(scroll.scrollHeight-scroll.clientHeight,(origin.y+destination.y)/2-scroll.clientHeight/2));
    scroll.addEventListener('pointerdown',cancel,true);scroll.addEventListener('wheel',cancel,{capture:true,passive:true});scroll.addEventListener('touchstart',cancel,{capture:true,passive:true});scroll.addEventListener('keydown',cancel,true);
    window.addEventListener('resize',cancel);document.addEventListener('visibilitychange',visibility);reduced.addEventListener?.('change',cancel);onPlaying(true);
    if(!alive()||phase!=='loading'){finish();return;}
    try {
      image=new Image();image.onload=()=>{if(typeof image?.decode!=='function')ready();};image.onerror=finish;
      timer=window.setTimeout(finish,800);image.src=PIP_WALK_SOURCE;
      if(typeof image.decode==='function')void image.decode().then(ready,finish);
    }catch{finish();}
  }
  return {get playing(){return phase!=='done';},start,setActive(value:boolean){active=value;if(!value)finish();},dispose(){if(disposed)return;disposed=true;finish();}};
}
