import type Phaser from 'phaser';
import type { LeafHit, Position, ResolveStep } from './core';
import { reducedMotion } from './reducedMotion';

type EffectObject=Phaser.GameObjects.Graphics|Phaser.GameObjects.Image|Phaser.GameObjects.Text;
const point=(p:Position)=>({x:44+p.col*56,y:44+p.row*56});

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
  leafHit(hit:LeafHit){
    const {x,y}=point(hit),cleared=hit.after===0,reduced=reducedMotion();
    const pulse=this.scene.add.graphics().setDepth(11).setName('leaf-hit-pulse');
    pulse.lineStyle(3,cleared?0x9ebf7a:0xe3aa65,1);pulse.strokeRoundedRect(x-25,y-25,50,50,11);
    this.animate(pulse,{alpha:0,duration:reduced?180:420});
    if(cleared){
    const label=this.scene.add.text(x,y-12,'✓',{
      fontFamily:'Arial, sans-serif',fontSize:'26px',fontStyle:'bold',color:'#426c37',
      backgroundColor:'#fff8e5',padding:{x:4,y:2},stroke:'#fff8e5',strokeThickness:2,
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
      const {x,y}=point(p),spark=this.scene.add.graphics().setDepth(8).setName('match-spark');
      spark.lineStyle(2,chain>1?0xf4bc65:0xfff8df,1);
      spark.lineBetween(x-5,y,x+5,y);spark.lineBetween(x,y-5,x,y+5);
      this.animate(spark,{y:-12,alpha:0,duration:300+i%3*35,ease:'Sine.easeOut'});
    });
  }
  special(step:ResolveStep){
    if(reducedMotion())return;
    const drawn=new Set<string>();
    for(const p of step.effects??[]){
      const key=p.special==='row'?`r${p.row}`:p.special==='column'?`c${p.col}`:`${p.row},${p.col}`;
      if(drawn.has(key))continue;drawn.add(key);
      if(drawn.size>8)break;
      const {x,y}=point(p);
      if(p.special==='row'||p.special==='column'){
        const across=p.special==='row',beam=this.scene.add.graphics().setDepth(12).setName('special-sweep');
        beam.fillStyle(0xfff6cc,.9);beam.fillRoundedRect(-9,-9,18,18,6);
        beam.setPosition(across?16:x,across?y:16);
        this.animate(beam,{...(across?{x:464}:{y:464}),alpha:0,duration:360,ease:'Sine.easeInOut'});
      }else{
        const ring=this.scene.add.graphics().setDepth(12).setPosition(x,y).setName('special-ripple');
        ring.lineStyle(3,p.special==='bomb'?0xf0a9bd:0xcbb0ef,.85);ring.strokeCircle(0,0,18);
        this.animate(ring,{scaleX:p.special==='bomb'?3:2.4,scaleY:p.special==='bomb'?3:2.4,alpha:0,duration:430,ease:'Cubic.easeOut'});
      }
    }
  }
}
