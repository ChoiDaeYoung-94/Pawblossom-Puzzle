import type Phaser from 'phaser';
import type { LeafHit, Position, ResolveStep, Special } from './core';
import { reducedMotion } from './reducedMotion';
import {BOARD_RENDER_SCALE} from './BoardDisplay';

type EffectObject=Phaser.GameObjects.Graphics|Phaser.GameObjects.Image|Phaser.GameObjects.Text;
const point=(p:Position)=>({x:44+p.col*56,y:44+p.row*56});
const colors=[0xf65a72,0xffa635,0x8285ed,0xd5a34f,0x8bcc4b,0xf28bbc];
const specialColor=(special:Special)=>special==='row'?0x8be8ff:special==='column'?0xa8f1ca:special==='bomb'?0xffb686:0xe3b2ff;
// 같은 단계의 겹치는 행·열은 한 번만 그리며 연쇄에도 추가 난수를 쓰지 않습니다.
const uniqueEffects=(step:ResolveStep)=>{
  const seen=new Set<string>();
  return (step.effects??[]).filter(p=>{
    const key=p.special==='row'?`r${p.row}`:p.special==='column'?`c${p.col}`:`${p.row},${p.col}`;
    if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,8);
};

/** 룰·난수·카메라 위치에 영향을 주지 않는 짧은 보드 연출입니다. */
export class BoardEffects {
  private objects=new Set<EffectObject>();
  constructor(private scene:Phaser.Scene){}
  get activeCount(){return this.objects.size;}
  private finish(item:EffectObject){if(this.objects.delete(item))item.destroy();}
  private animate(item:EffectObject,config:Omit<Phaser.Types.Tweens.TweenBuilderConfig,'targets'|'onComplete'>){
    if(this.objects.size>=120){item.destroy();return;}
    this.objects.add(item);
    this.scene.tweens.add({...config,targets:item,onComplete:()=>this.finish(item)});
  }
  clear(){for(const item of this.objects){this.scene.tweens.killTweensOf(item);item.destroy();}this.objects.clear();}
  /** 실제 제거 범위의 표시도 파편과 같은 상한·종료 정리 안에서 관리합니다. */
  trackOverlay(overlay:Phaser.GameObjects.Graphics){this.animate(overlay,{alpha:0,delay:180,duration:130});}
  anticipate(step:ResolveStep){
    if(reducedMotion())return;
    for(const p of uniqueEffects(step)){
      const {x,y}=point(p),pulse=this.scene.add.graphics().setPosition(x,y).setDepth(12).setName('special-charge');
      pulse.fillStyle(specialColor(p.special),.3);pulse.fillRoundedRect(-23,-23,46,46,p.special==='bomb'||p.special==='rainbow'?23:10);
      pulse.lineStyle(3,0xfff9e4,.95);pulse.strokeCircle(0,0,17);
      this.animate(pulse,{scaleX:1.18,scaleY:1.18,alpha:0,duration:110,ease:'Sine.easeIn'});
    }
  }
  private fragment(x:number,y:number,color:number,index:number,distance:number){
    const directions=[[-1,-.65],[1,-.65],[-.65,1],[.65,1],[-1,.15],[1,.15],[.15,-1],[-.15,1]];
    const [dx,dy]=directions[index%directions.length];
    const chip=this.scene.add.graphics().setPosition(x,y).setDepth(12).setAngle(index*31).setName('tile-fragment');
    chip.fillStyle(color,1);chip.fillRoundedRect(-3,-3,6,6,2);
    chip.lineStyle(1,0xfff7de,.9);chip.lineBetween(-2,-2,2,-2);
    this.animate(chip,{x:x+dx*distance,y:y+dy*distance,angle:index*31+110,alpha:0,scaleX:.35,scaleY:.35,duration:270+index%3*25,ease:'Cubic.easeOut'});
  }
  /** 실제 상자 타격 칸에만 표시하며 낙하·보상·해소 대기를 추가하지 않습니다. */
  crateHit(hit:Position){
    if(this.objects.size>=120)return;
    const {x,y}=point(hit),reduced=reducedMotion();
    const pulse=this.scene.add.graphics().setPosition(x,y).setDepth(11).setName('crate-hit-pulse');
    pulse.lineStyle(3,0xffe5aa,.95);pulse.strokeRoundedRect(-25,-25,50,50,10);
    pulse.lineStyle(2,0xfff8de,.85);pulse.lineBetween(-17,-17,17,17);pulse.lineBetween(17,-17,-17,17);
    this.animate(pulse,{alpha:0,duration:reduced?180:230});
    if(reduced)return;
    const paths=[[-14,-10,-31,-26,-55],[14,-10,31,-24,55],[-12,12,-27,29,-35],[14,12,31,28,45]];
    for(let i=0;i<paths.length&&this.objects.size<120;i++){
      const [sx,sy,dx,dy,angle]=paths[i];
      const chip=this.scene.add.graphics().setPosition(x+sx,y+sy).setDepth(12).setAngle(angle/2).setName('crate-wood-chip');
      chip.fillStyle(i%2?0xc58d4c:0xe3b16b);chip.fillRoundedRect(-6,-2,12,4,1.5);
      chip.lineStyle(1,0xffe2a5,.9);chip.lineBetween(-4,-1,4,-1);
      // 이동은 빠르게 펼치되 마지막까지 읽히도록 투명도만 늦게 줄입니다.
      this.animate(chip,{x:x+dx,y:y+dy,angle,alpha:{value:0,ease:'Sine.easeIn'},scaleX:.45,scaleY:.65,duration:250+i*15,ease:'Cubic.easeOut'});
    }
  }
  leafHit(hit:LeafHit){
    const {x,y}=point(hit),cleared=hit.after===0,reduced=reducedMotion();
    const pulse=this.scene.add.graphics().setDepth(11).setName('leaf-hit-pulse');
    pulse.lineStyle(3,cleared?0x9ebf7a:0xe3aa65,1);pulse.strokeRoundedRect(x-25,y-25,50,50,11);
    this.animate(pulse,{alpha:0,duration:reduced?180:420});
    if(cleared){
    const label=this.scene.add.text(x,y-12,'✓',{
      fontFamily:'Arial, sans-serif',fontSize:'26px',fontStyle:'bold',color:'#426c37',
      backgroundColor:'#fff8e5',padding:{x:4,y:2},stroke:'#fff8e5',strokeThickness:2,resolution:BOARD_RENDER_SCALE,
    }).setOrigin(.5).setDepth(14).setName('leaf-hit-label');
    this.animate(label,{...(reduced?{}:{y:y-28}),alpha:0,delay:reduced?240:300,duration:reduced?160:300,ease:'Sine.easeOut'});
    }
    if(reduced)return;
    const count=cleared?4:2;
    for(let i=0;i<count;i++){
      const direction=i%2?-1:1,chip=this.scene.add.image(x+direction*8,y+8,'leaf-single').setDisplaySize(18,18).setDepth(12).setAngle(i*35-30).setName('leaf-chip');
      this.animate(chip,{x:x+direction*(27+i*6),y:y-24-i*5,angle:direction*(80+i*35),alpha:0,displayWidth:8,displayHeight:8,duration:480+i*25,ease:'Cubic.easeOut'});
    }
  }
  match(step:ResolveStep,chain:number){
    if(reducedMotion())return;
    // 64칸 제거에도 최대 12개만 만들어 모바일의 중첩 비용을 제한합니다.
    const stride=Math.max(1,Math.ceil(step.removed.length/12));
    step.removed.filter((_,i)=>i%stride===0).forEach((p,i)=>{
      const {x,y}=point(p),spark=this.scene.add.graphics().setPosition(x,y).setDepth(8).setName('match-spark');
      spark.lineStyle(2,chain>1?0xf4bc65:0xfff8df,1);
      spark.lineBetween(-5,0,5,0);spark.lineBetween(0,-5,0,5);
      this.animate(spark,{y:y-12,alpha:0,duration:220+i%3*25,ease:'Sine.easeOut'});
      if(i<8){
        const color=colors[step.before[p.row]?.[p.col]?.kind??i%colors.length];
        this.fragment(x,y,color,i,22+Math.min(chain,4)*3);
        this.fragment(x,y,color,i+1,22+Math.min(chain,4)*3);
      }
    });
  }
  special(step:ResolveStep){
    if(reducedMotion())return;
    const effects=uniqueEffects(step);
    // 색 폭발과 같은 해결 단계의 실제 제거 칸만 연결합니다. 다른 특수와 겹친 칸도 포함됩니다.
    // Graphics 하나 안의 선 수도 제한하여 객체 상한과 별도로 그리기 비용을 관리합니다.
    const rainbow=effects.find(p=>p.special==='rainbow'&&step.before[p.row]?.[p.col]);
    if(rainbow){
      const seen=new Set<string>(),targets=step.removed.filter(p=>{
        const key=`${p.row},${p.col}`;
        if(seen.has(key)||p.row===rainbow.row&&p.col===rainbow.col||!step.before[p.row]?.[p.col])return false;
        seen.add(key);return true;
      });
      if(targets.length){
        const origin=point(rainbow),threads=this.scene.add.graphics().setDepth(11).setName('special-color-connections');
        const count=Math.min(12,targets.length);
        for(let i=0;i<count;i++){
          const p=targets[count===1?0:Math.round(i*(targets.length-1)/(count-1))],end=point(p);
          threads.lineStyle(7,colors[step.before[p.row][p.col]!.kind],.45);threads.lineBetween(origin.x,origin.y,end.x,end.y);
          threads.lineStyle(2,0xfff9e6,.95);threads.lineBetween(origin.x,origin.y,end.x,end.y);
          threads.strokeCircle(end.x,end.y,7);
        }
        this.animate(threads,{alpha:0,duration:260,ease:'Cubic.easeOut'});
      }
    }
    for(const p of effects){
      const {x,y}=point(p);
      if(p.special==='row'||p.special==='column'){
        const across=p.special==='row',beam=this.scene.add.graphics().setPosition(x,y).setDepth(12).setName('special-sweep');
        beam.fillStyle(specialColor(p.special),.6);
        beam.fillRoundedRect(across?16-x:-11,across?-11:16-y,across?448:22,across?22:448,10);
        beam.fillStyle(0xfffce7,.98);
        beam.fillRoundedRect(across?16-x:-3,across?-3:16-y,across?448:6,across?6:448,3);
        this.animate(beam,{...(across?{scaleY:.45}:{scaleX:.45}),alpha:0,duration:210,ease:'Cubic.easeOut'});
        for(const edge of [16,464]){
          const mote=this.scene.add.graphics().setPosition(x,y).setDepth(13).setName('special-line-mote');
          mote.lineStyle(6,specialColor(p.special),.6);mote.lineBetween(-7,0,7,0);mote.lineBetween(0,-7,0,7);
          mote.lineStyle(2,0xfffbe7,1);mote.lineBetween(-7,0,7,0);mote.lineBetween(0,-7,0,7);
          this.animate(mote,{...(across?{x:edge}:{y:edge}),alpha:0,scaleX:.35,scaleY:.35,duration:260,ease:'Cubic.easeOut'});
        }
      }else{
        const ring=this.scene.add.graphics().setDepth(12).setPosition(x,y).setName('special-ripple');
        ring.lineStyle(5,specialColor(p.special),.95);ring.strokeCircle(0,0,18);
        ring.lineStyle(2,0xfffbe4,.95);ring.strokeCircle(0,0,24);
        this.animate(ring,{scaleX:p.special==='bomb'?3.2:2.6,scaleY:p.special==='bomb'?3.2:2.6,alpha:0,duration:300,ease:'Cubic.easeOut'});
      }
      const count=p.special==='bomb'?8:p.special==='rainbow'?6:4;
      for(let i=0;i<count;i++)this.fragment(x,y,p.special==='rainbow'?colors[i%colors.length]:specialColor(p.special),i,p.special==='bomb'?60:40);
    }
  }
}
