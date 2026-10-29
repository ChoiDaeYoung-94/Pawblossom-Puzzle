import {t,type Language,type TextKey} from './i18n';
import {icon} from './icons';
import {puzzleToolCatalog,puzzleTool,type PuzzleToolId,type PuzzleToolProgress} from './puzzleTools';
import type {RoundCheckpoint,SaveData} from './state';
import {specialBodyPath,specialTileArt} from './SpecialTileArt';
const nameKeys:Record<PuzzleToolId,TextKey>={trowel:'toolTrowel',gloves:'toolGloves',broom:'toolBroom',bell:'toolBell',seeds:'toolSeeds'};
const descKeys:Record<PuzzleToolId,TextKey>={trowel:'toolTrowelDesc',gloves:'toolGlovesDesc',broom:'toolBroomDesc',bell:'toolBellDesc',seeds:'toolSeedsDesc'};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const toolName=(language:Language,id:PuzzleToolId)=>t(language,nameKeys[id]);
export const toolPicture=(id:PuzzleToolId)=>{const def=puzzleTool(id);return 'special' in def?specialBodyPath(def.special):'/assets/puzzle-tools-v1/gloves-v1.webp';};
/** 보드와 같은 몸체·과일·방향 표시를 사용합니다. 안정 ID는 저장 호환용입니다. */
export function toolArt(id:PuzzleToolId,className=''){
  const def=puzzleTool(id);
  return `<span class="puzzle-tool-art ${className}" aria-hidden="true">${'special' in def?specialTileArt('strawberry',def.special):`<img src="${toolPicture(id)}" alt=""/>`}</span>`;
}
export function toolStatus(save:SaveData,round:RoundCheckpoint|undefined,id:PuzzleToolId,testing:boolean){
  const def=puzzleTool(id),language=save.language,locked=!testing&&save.highestLevel<def.unlock;
  const free=testing||!save.puzzleTools.trialUsed.includes(id),cost=testing?t(language,'toolPractice'):free?t(language,'toolFree'):t(language,'toolCost').replace('{coins}',String(def.coins));
  const reason=locked?t(language,'toolUnlock').replace('{level}',String(def.unlock)):round?.schema!==2||round.actionProfile!=='tools-v2'?t(language,'toolNewRound'):round.toolsUsed!.includes(id)?t(language,'toolAlreadyUsed'):round.toolsUsed!.length>=2?t(language,'toolRoundLimit'):!free&&save.coins<def.coins?t(language,'toolNoCoins'):'';
  return {available:!reason,reason,cost,locked};
}
export function toolShelf(language:Language,highest:number,progress:PuzzleToolProgress,testing:boolean,used:readonly PuzzleToolId[]=[]){
  return puzzleToolCatalog.map(def=>{const locked=!testing&&highest<def.unlock,spent=used.includes(def.id),free=testing||!progress.trialUsed.includes(def.id),name=toolName(language,def.id),cost=testing?t(language,'toolPractice'):free?t(language,'toolFree'):t(language,'toolCost').replace('{coins}',String(def.coins));
    return `<button id="tool-${def.id}" class="puzzle-tool-slot" data-tool="${def.id}" data-locked="${locked}" data-used="${spent}" aria-label="${escape(name+' · '+(locked?t(language,'toolUnlock').replace('{level}',String(def.unlock)):spent?t(language,'toolAlreadyUsed'):cost))}" title="${escape(name)}">${toolArt(def.id)}<span class="puzzle-tool-badge">${locked?icon('lock',9)+def.unlock:spent?t(language,'toolUsedBadge'):testing?t(language,'toolTrialBadge'):free?t(language,'toolFreeBadge'):icon('coin',9)+def.coins}</span></button>`;
  }).join('');
}
export function toolInfo(language:Language,save:SaveData,round:RoundCheckpoint|undefined,id:PuzzleToolId|undefined,testing:boolean){
  if(!id)return `<h2 id="tool-title" tabindex="-1">${t(language,'toolShelf')}</h2><div class="tool-info-list">${puzzleToolCatalog.map(def=>{const status=toolStatus(save,round,def.id,testing);return `<button id="tool-info-${def.id}" data-tool="${def.id}">${toolArt(def.id)}<span><strong>${toolName(language,def.id)}</strong>${status.reason||status.cost}</span></button>`;}).join('')}</div><p class="tool-info-note">${t(language,'toolLimits')}</p><div class="tool-info-actions"><button id="tool-info-close">${t(language,'toolClose')}</button></div>`;
  const status=toolStatus(save,round,id,testing),fresh=!status.locked&&!save.puzzleTools.introduced.includes(id);
  return `<p class="tool-info-label">${t(language,fresh?'toolNew':'toolLabel')}</p>${fresh&&status.available?`<div class="tool-info-pip"><img src="/assets/pip-idle-open-v2.webp" alt="" width="48" height="48"/><p><strong>${t(language,'toolPipName')}</strong>${t(language,'toolPipInvite')}</p></div>`:''}${toolArt(id,'tool-info-art')}<h2 id="tool-title" tabindex="-1">${toolName(language,id)}</h2><p class="tool-info-copy">${t(language,descKeys[id])}</p><p class="tool-info-cost">${status.reason||status.cost+' · '+t(language,'toolNoMoves')}</p>${!status.locked&&status.reason?`<p class="tool-info-note">${status.reason}</p>`:''}<p class="tool-info-note">${t(language,'toolLimits')}</p><div class="tool-info-actions"><button id="tool-info-start" class="tool-info-start" ${status.available?'':'disabled'}>${t(language,'toolChoose')}</button><button id="tool-info-close">${t(language,'toolClose')}</button><button id="tool-info-all">${t(language,'toolAll')}</button></div>`;
}
