import {pipWalkArt,PIP_WALK_SOURCE} from './PipWalkArt';
import {travelPoint,type RoutePoint} from './CampaignRoute';

let instance=0;
export function createMapTravel(scroll:HTMLElement,from:HTMLElement,to:HTMLElement,pip:HTMLElement,owns:()=>boolean,onPlaying:(playing:boolean)=>void=()=>{}){
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let phase:'armed'|'loading'|'walking'|'done'='armed',active=false,disposed=false;
  let ghost:HTMLElement|undefined,image:HTMLImageElement|undefined,frame:number|undefined,timer:number|undefined;
  let origin:RoutePoint,destination:RoutePoint,seam:RoutePoint|undefined,duration=2000,started:number|undefined,facingX:number|undefined;
  let route:{point:RoutePoint;distance:number}[]=[],length=0;
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
  function displayPoint(t:number){
    const point=travelPoint(origin,destination,t,seam),join=(1+Math.cos(2*Math.PI*t))/2;
    // 버튼 옆 대기 위치에서 점선에 합류하고 양 끝에서는 원래 발밑으로 돌아옵니다.
    return {x:point.x-40*join,y:point.y+18*join};
  }
  function routePoint(distance:number){
    const index=route.findIndex(sample=>sample.distance>=distance);
    if(index<=0)return route[0]!.point;
    const a=route[index-1]!,b=route[index]!,ratio=(distance-a.distance)/Math.max(.001,b.distance-a.distance);
    return {x:a.point.x+(b.point.x-a.point.x)*ratio,y:a.point.y+(b.point.y-a.point.y)*ratio};
  }
  function draw(distance:number){
    if(!ghost)return;
    const point=routePoint(distance),delta=facingX===undefined?routePoint(Math.min(length,distance+2)).x-point.x:point.x-facingX;
    // 발판 옆에서 길로 합류하는 가로 이동까지 반영하고 미세 이동은 누적합니다.
    if(facingX===undefined||Math.abs(delta)>=.25){ghost.dataset.facing=delta<0?'left':'right';facingX=point.x;}
    ghost.style.transform=`translate3d(${point.x-36}px,${point.y-600/627*72}px,0)`;
  }
  function tick(now:number){
    frame=undefined;if(!alive()||phase!=='walking'){finish();return;}
    started??=now;const elapsed=Math.max(0,now-started),raw=Math.min(1,Math.max(0,(elapsed-120)/duration));
    // 짧게 출발·정지하고 중간은 일정한 보행 속도로 이동합니다.
    const ramp=.12,t=raw<ramp?raw*raw/(2*ramp*(1-ramp)):raw>1-ramp?1-(1-raw)**2/(2*ramp*(1-ramp)):(raw-ramp/2)/(1-ramp);
    const distance=length*t;
    ghost!.dataset.frame=String(raw===0||raw===1?0:Math.floor(distance/10)%4);draw(distance);
    if(elapsed>=duration+280)finish();else frame=requestAnimationFrame(tick);
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
    route=Array.from({length:41},(_,i)=>({point:displayPoint(i/40),distance:0}));
    length=0;route.forEach((sample,i)=>{if(i)length+=Math.hypot(sample.point.x-route[i-1]!.point.x,sample.point.y-route[i-1]!.point.y);sample.distance=length;});
    duration=Math.min(3400,Math.max(1800,length*12));
    phase='loading';ghost=document.createElement('span');ghost.className='map-pip-walk';ghost.setAttribute('aria-hidden','true');ghost.dataset.frame='0';
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
