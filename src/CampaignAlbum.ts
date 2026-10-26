import {LEVEL_COUNT,chapterForLevel} from './levels';
import {campaignProgress} from './CampaignProgress';
import {campaignWorldName,campaignWorldPostcard} from './CampaignScenery';
import {t,type Language} from './i18n';

/** 실제 고유 완료 목록을 읽기만 합니다. 체험 조건/보상/별은 수집의 근거가 아닙니다. */
export function campaignAlbum(completed:readonly number[]){
  return Array.from({length:Math.ceil(LEVEL_COUNT/20)},(_,index)=>{
    const progress=campaignProgress(completed,index*20+1)!;
    return {...progress,collected:progress.done===progress.total,chapter:chapterForLevel(progress.first).id};
  });
}
export function parseAlbumIndex(value:string){
  if(!/^(0|[1-9]\d*)$/.test(value))return;
  const index=Number(value);return Number.isInteger(index)&&index>=0&&index<Math.ceil(LEVEL_COUNT/20)?index:undefined;
}
export function albumSelection(completed:readonly number[],selected:number|undefined){
  const worlds=campaignAlbum(completed),recent=[...worlds].reverse();
  return worlds.find(world=>world.index===selected)??recent.find(world=>world.collected)??recent.find(world=>world.done>0)??worlds[0];
}
export function campaignAlbumCard(language:Language,completed:readonly number[],selected:number|undefined,demo:boolean){
  const worlds=campaignAlbum(completed),world=albumSelection(completed,selected),count=worlds.filter(w=>w.collected).length;
  const text=(key:Parameters<typeof t>[1])=>t(language,key);
  const name=campaignWorldName(world.chapter,language);
  return `<section class="campaign-album journal-card" aria-labelledby="album-title"><div class="album-heading"><div><small>${text('albumLabel')}</small><h3 id="album-title" tabindex="-1">${text('albumTitle')}</h3></div><span class="album-count">${text('albumCollection').replace('{count}',String(count)).replace('{total}',String(worlds.length))}</span></div><p class="album-intro">${text('albumIntro')}</p>${demo?`<p class="album-demo-note">${text('albumRealOnly')}</p>`:''}<label for="album-world-select">${text('albumChoose')}</label><select id="album-world-select">${worlds.map(w=>`<option value="${w.index}" ${w.index===world.index?'selected':''}>${w.collected?'✓ ':''}${campaignWorldName(w.chapter,language)} · ${w.done}/${w.total}</option>`).join('')}</select><div id="album-picture" class="album-picture" data-collected="${world.collected}" role="img" aria-label="${name} · ${world.done}/${world.total} · ${text(world.collected?'albumCollected':'albumPending')}">${world.collected?`<div class="campaign-chapter" data-chapter="${world.chapter}">${campaignWorldPostcard(world.chapter,0,'album')}</div><span class="album-seal" aria-hidden="true">20/20</span>`:`<svg class="album-outline" viewBox="0 0 320 200" aria-hidden="true"><path d="M28 158Q78 115 122 149Q162 94 199 143Q255 103 292 157"/><path d="M103 150V91Q103 55 160 45Q217 55 217 91V150M94 91H226M152 150V119Q160 110 168 119V150"/><circle cx="248" cy="53" r="17"/><path d="M42 86L51 69L60 86L51 102Z"/></svg><span class="album-pending">${world.done}/${world.total}</span>`}</div><div class="album-caption"><strong>${name}</strong><span>${text(world.collected?'albumCollected':'albumPending')}</span></div><progress value="${world.done}" max="${world.total}" aria-label="${name} · ${text('albumProgress')}"></progress><p class="album-message">${world.collected?text('albumMemory'):text('albumRemaining').replace('{count}',String(world.total-world.done))}</p><button id="album-open-map" class="text-button" ${demo?'disabled':''}>${text('albumOpenMap')}</button></section>`;
}
