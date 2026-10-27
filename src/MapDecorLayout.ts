import {CAMPAIGN_NODE_STEP,CAMPAIGN_NODE_X} from './CampaignRoute';

export type MapDecorAnchor={side:'left'|'right';y:number};

/** 경로 양쪽에 실제 여유가 있는 칸 사이만 사용합니다. 게임 난수를 소비하지 않습니다. */
export function mapDecorAnchors(chapter:number,count:number):MapDecorAnchor[]{
  if(!Number.isInteger(count)||count<2||count>20)return [];
  const candidates:MapDecorAnchor[]=[];
  for(let gap=0;gap<count-1;gap++){
    const a=CAMPAIGN_NODE_X[gap%CAMPAIGN_NODE_X.length]!,b=CAMPAIGN_NODE_X[(gap+1)%CAMPAIGN_NODE_X.length]!;
    if(Math.min(a,b)>=60)candidates.push({side:'left',y:(gap+1)*CAMPAIGN_NODE_STEP});
    else if(Math.max(a,b)<=50)candidates.push({side:'right',y:(gap+1)*CAMPAIGN_NODE_STEP});
  }
  if(!candidates.length)return [];
  const key=Number.isSafeInteger(chapter)&&chapter>0?chapter-1:0,selected:MapDecorAnchor[]=[];
  // 긴 장의 장식이 초반에 몰리지 않도록 네 구간에서 한 자리씩 고릅니다.
  for(let quarter=0;quarter<4;quarter++){
    const safe=candidates.filter(candidate=>Math.min(3,Math.floor(candidate.y/(count*CAMPAIGN_NODE_STEP)*4))===quarter&&!selected.some(other=>other.side===candidate.side&&Math.abs(other.y-candidate.y)<128));
    const preferred=safe.filter(candidate=>candidate.side===((key+quarter)%2?'right':'left')),pool=preferred.length?preferred:safe;
    if(pool.length)selected.push(pool[(key+quarter)%pool.length]!);
  }
  const rotation=key%Math.max(1,selected.length);
  return selected.slice(rotation).concat(selected.slice(0,rotation));
}

export function mapDecorAttributes(anchors:readonly MapDecorAnchor[],slot:number,delay=0){
  const anchor=anchors[slot];
  return anchor?` data-map-decor="${slot}" data-decor-side="${anchor.side}" style="--decor-y:${anchor.y}px;--decor-left:${anchor.side==='left'?'4%':'auto'};--decor-right:${anchor.side==='right'?'4%':'auto'};--motif-delay:${delay}s"`:' style="display:none"';
}
