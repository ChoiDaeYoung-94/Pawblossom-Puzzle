// 배포하지 않는 옛 지도 HTML과 원본의 이력 검사 전용입니다.
import {campaignWorldIndex,CAMPAIGN_WORLDS} from '../../src/CampaignScenery';
/** 번호/상태를 그림에 굽지 않습니다. 원본비율 유지·기존 owner 해독 게이트를 공유합니다. */
export function campaignIsland(chapter:number){
  const worldIndex=campaignWorldIndex(chapter);
  if(worldIndex>=5){
    const cell=(worldIndex-5)%4,group=String.fromCharCode(97+Math.floor((worldIndex-5)/4));
    return `<svg class="campaign-island" data-island-world="${CAMPAIGN_WORLDS[worldIndex]}" viewBox="0 0 136 100" aria-hidden="true"><svg x="18" width="100" height="100" viewBox="${cell%2*627} ${Math.floor(cell/2)*627} 627 627" preserveAspectRatio="xMidYMid meet" overflow="hidden"><image class="map-painted-image" data-map-src="/assets/campaign/level-expansion-${group}-v1.png" width="1254" height="1254"/></svg></svg>`;
  }
  const index=([0,1,2,3,4,2,0,1,1,2,4,4,3,0,3,1,0,4,4,4,2,2,1,4,2][campaignWorldIndex(chapter)]??0)-1;
  const box=index<0?'0 0 1506 1044':`${index%2*627} ${Math.floor(index/2)*627} 627 627`;
  return `<svg class="campaign-island" viewBox="0 0 136 100" aria-hidden="true"><svg x="${index<0?0:18}" width="${index<0?136:100}" height="100" viewBox="${box}" preserveAspectRatio="xMidYMid meet" overflow="hidden"><image class="map-painted-image" data-map-src="/assets/campaign/${index<0?'level-island-v1.png':'level-worlds-atlas-v1.png'}" width="${index<0?1506:1254}" height="${index<0?1044:1254}"/></svg></svg>`;
}
export function campaignGatewayBranches(){
  return [0,1].map(side=>`<svg class="map-gateway-branch map-gateway-branch-${side?'right':'left'}" viewBox="${side*887} 0 887 887" preserveAspectRatio="xMidYMid meet"><image class="map-painted-image" data-map-src="/assets/campaign/gateway-branches-v1.png" width="1774" height="887"/></svg>`).join('');
}
