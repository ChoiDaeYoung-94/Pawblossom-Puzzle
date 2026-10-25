import {chapterForLevel} from './levels';
import {campaignWorldName,campaignWorldPostcard} from './CampaignScenery';
import {t,type Language} from './i18n';
import type {campaignMilestone} from './CampaignProgress';
export type WorldMilestone=NonNullable<ReturnType<typeof campaignMilestone>>;
export function milestoneCopy(language:Language,milestone:WorldMilestone){
  return {title:t(language,'worldComplete'),name:campaignWorldName(chapterForLevel(milestone.first).id,language),note:t(language,milestone.journeyComplete||milestone.index===24?'worldLastMemory':'worldNextMemory')};
}
export function campaignMilestoneCard(language:Language,milestone:WorldMilestone|undefined,round:number){
  if(!milestone)return '';
  const copy=milestoneCopy(language,milestone),chapter=chapterForLevel(milestone.first).id;
  return `<section class="result-world-card" aria-labelledby="result-world-title"><div id="result-world-picture" class="result-world-picture"><div class="campaign-chapter" data-chapter="${chapter}">${campaignWorldPostcard(chapter,round)}</div><span class="result-world-seal" aria-hidden="true">20/20</span></div><div class="result-world-copy"><h3 id="result-world-title">${copy.title}</h3><p id="result-world-name">${copy.name}</p><small id="result-world-note">${copy.note}</small></div></section>`;
}
