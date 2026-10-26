/** 지도 표시용 좌표이며 퍼즐 규칙·난수·저장에는 사용하지 않습니다. */
export const CAMPAIGN_NODE_STEP=112;
export const CAMPAIGN_NODE_X=Object.freeze([50,69,62,38,29,46,68,60,36,50]);
export type RoutePoint={x:number;y:number};
export function campaignNodePath(count:number,leading:boolean,trailing:boolean){
  if(!Number.isInteger(count)||count<1||count>20)return '';
  const points=Array.from({length:count},(_,index)=>({x:CAMPAIGN_NODE_X[index%CAMPAIGN_NODE_X.length]!,y:CAMPAIGN_NODE_STEP/2+index*CAMPAIGN_NODE_STEP}));
  const first=points[0]!,last=points[points.length-1]!;
  let path=leading?`M ${first.x} 0 L ${first.x} ${first.y}`:`M ${first.x} ${first.y}`;
  points.slice(1).forEach((point,index)=>{path+=` Q ${points[index]!.x} ${point.y} ${point.x} ${point.y}`;});
  if(trailing){const bottom=count*CAMPAIGN_NODE_STEP+10;path+=` Q ${last.x} ${bottom} 50 ${bottom}`;}
  return path;
}
export function routeCurve(from:RoutePoint,to:RoutePoint,t:number):RoutePoint {
  const ratio=Math.min(1,Math.max(0,Number.isFinite(t)?t:0)),rest=1-ratio;
  return {x:rest*rest*from.x+2*rest*ratio*from.x+ratio*ratio*to.x,y:rest*rest*from.y+2*rest*ratio*to.y+ratio*ratio*to.y};
}
export function travelPoint(from:RoutePoint,to:RoutePoint,t:number,seam?:RoutePoint):RoutePoint {
  t=Math.min(1,Math.max(0,Number.isFinite(t)?t:0));
  if(!seam)return routeCurve(from,to,t);
  const first=Math.hypot(seam.x-from.x,seam.y-from.y),second=Math.max(0,to.y-seam.y),split=first/Math.max(1,first+second);
  if(t<split&&split>0)return routeCurve(from,seam,t/split);
  const ratio=Math.min(1,Math.max(0,(t-split)/Math.max(.001,1-split)));
  return {x:seam.x+(to.x-seam.x)*ratio,y:seam.y+(to.y-seam.y)*ratio};
}
