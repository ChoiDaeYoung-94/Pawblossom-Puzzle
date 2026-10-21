import { reducedMotion } from './reducedMotion';

export interface VisualPoint { x:number; y:number }
export interface ResolveVisual {
  cascade:number;
  removed:(VisualPoint&{kind:number})[];
  clearedLeaves:VisualPoint[];
  specialActivated:boolean;
  specialCreated:boolean;
}
export interface FeedbackGoal { key:string; remaining:number; src:string }
interface Options {
  layer:HTMLElement;
  pip:HTMLElement;
  canvas:()=>HTMLElement|null;
  goal:(key:string)=>HTMLElement|null;
  active:()=>boolean;
  reduced?:()=>boolean;
}
interface Flight { node:HTMLElement; animation:Animation }

/** 엔진/저장을 모르며, 이동 시작 때 받은 잔량 안에서 표시만 예약합니다. */
export class RoundFeedback {
  private generation=0;
  private enabled=false;
  private motion=false;
  private goals=new Map<string,FeedbackGoal>();
  private flights=new Set<Flight>();
  private accents=new Set<Animation>();
  private marked=new Set<HTMLElement>();
  private reactions=0;
  private strength=0;
  private faceRevision=0;
  private face?:Promise<HTMLImageElement|null>;
  private base:HTMLImageElement|null;
  constructor(private readonly options:Options){this.base=options.pip.querySelector('img');}

  beginMove(goals:FeedbackGoal[]){
    this.cancel();this.enabled=true;this.motion=this.reduced();
    for(const goal of goals)this.goals.set(goal.key,{...goal,remaining:Math.max(0,goal.remaining)});
  }
  cancel(){
    this.clearVisuals();this.enabled=false;this.goals.clear();this.reactions=0;this.strength=0;
  }
  private reduced(){return this.options.reduced?.()??reducedMotion();}
  private clearVisuals(){
    this.generation++;this.faceRevision++;
    for(const flight of this.flights){flight.animation.onfinish=null;flight.animation.cancel();flight.node.remove();}
    this.flights.clear();
    for(const animation of this.accents){animation.onfinish=null;animation.cancel();}
    this.accents.clear();
    for(const element of this.marked)element.classList.remove('goal-feedback-static');
    this.marked.clear();
    delete this.options.pip.dataset.mood;
    if(this.base)this.options.pip.replaceChildren(this.base);
  }
  show(event:ResolveVisual){
    if(!this.enabled)return;
    if(!this.options.active()){this.cancel();return;}
    const reduced=this.reduced();
    if(reduced!==this.motion){this.clearVisuals();this.motion=reduced;}
    const groups=new Map<string,VisualPoint[]>();
    for(const source of event.removed){const key=String(source.kind);const group=groups.get(key)??[];group.push(source);groups.set(key,group);}
    if(event.clearedLeaves.length)groups.set('leaves',event.clearedLeaves);
    for(const [key,sources] of groups){
      const goal=this.goals.get(key);if(!goal||goal.remaining<=0)continue;
      const count=Math.min(goal.remaining,sources.length);
      // 대표 세 개만 그려도 실제 제거 수만큼 잔량을 소모합니다. DOM 숫자는 정산 전 값입니다.
      goal.remaining-=count;
      if(reduced){this.pulse(key,true);continue;}
      for(let i=0;i<Math.min(3,count)&&this.flights.size<12;i++)this.fly(sources[i],goal,i);
    }
    const strength=event.specialActivated||event.cascade>=3?2:event.specialCreated||event.cascade>=2?1:0;
    if(strength&&this.reactions<2&&strength>=this.strength){this.reactions++;this.strength=strength;this.cheer(reduced);}
  }
  private pulse(key:string,reduced:boolean){
    // updateGoals()가 교체한 최신 목표를 조회하며 수치/ARIA 발표를 만들지 않습니다.
    const target=this.options.goal(key);if(!target?.isConnected)return;
    if(reduced||typeof target.animate!=='function'){target.classList.add('goal-feedback-static');this.marked.add(target);return;}
    const animation=target.animate([{filter:'brightness(1)'},{filter:'brightness(1.3)'},{filter:'brightness(1)'}],{duration:170});
    this.track(animation);
  }
  private track(animation:Animation){
    this.accents.add(animation);
    animation.onfinish=()=>{this.accents.delete(animation);};
  }
  private fly(source:VisualPoint,goal:FeedbackGoal,index:number){
    const canvas=this.options.canvas(),target=this.options.goal(goal.key);
    if(!this.options.layer.isConnected||!canvas?.isConnected||!target?.isConnected)return;
    const board=canvas.getBoundingClientRect(),end=target.getBoundingClientRect();
    if(board.width<=0||board.height<=0||end.width<=0||end.height<=0)return;
    const x=board.left+source.x/480*board.width-11,y=board.top+source.y/480*board.height-11;
    const tx=end.left+end.width/2-11,ty=end.top+end.height/2-11;
    const node=document.createElement('img');node.className='goal-flight';node.src=goal.src;node.alt='';node.setAttribute('aria-hidden','true');
    if(typeof node.animate!=='function'){this.pulse(goal.key,true);return;}
    this.options.layer.append(node);
    // 종류 안의 지연도 포함해468ms이며 기존 제거/낙하 대기500ms를 늘리지 않습니다.
    const animation=node.animate([
      {transform:`translate(${x}px,${y}px) scale(1)`,opacity:.95},
      {transform:`translate(${(x+tx)/2+(index-1)*12}px,${Math.min(y,ty)-28}px) scale(.9)`,opacity:1,offset:.55},
      {transform:`translate(${tx}px,${ty}px) scale(.55)`,opacity:.5},
    ],{duration:420,delay:index*24,easing:'cubic-bezier(.25,.65,.35,1)',fill:'both'});
    const flight={node,animation},generation=this.generation;this.flights.add(flight);
    animation.onfinish=()=>{
      if(!this.flights.delete(flight))return;
      node.remove();
      if(generation===this.generation&&this.enabled&&this.options.layer.isConnected&&this.options.active())this.pulse(goal.key,this.reduced());
    };
  }
  private cheer(reduced:boolean){
    const pip=this.options.pip,generation=this.generation,revision=++this.faceRevision;
    pip.dataset.mood='happy';
    if(!reduced&&typeof pip.animate==='function')this.track(pip.animate([
      {transform:'rotate(0deg)'},{transform:'rotate(-7deg)',offset:.3},{transform:'rotate(6deg)',offset:.65},{transform:'rotate(0deg)'},
    ],{duration:380}));
    if(!this.face)this.face=new Promise(resolve=>{
      const image=new Image();image.alt='';image.className='header-pip-image happy';image.decoding='async';
      image.onload=()=>{image.onload=image.onerror=null;void Promise.resolve().then(()=>image.decode()).then(()=>resolve(image),()=>resolve(null));};
      image.onerror=()=>{image.onload=image.onerror=null;resolve(null);};
      image.src='/assets/pip-play-v1.webp';
    });
    void this.face.then(image=>{
      if(image&&generation===this.generation&&revision===this.faceRevision&&this.enabled&&pip.isConnected&&this.options.active())pip.replaceChildren(image);
    });
  }
}
