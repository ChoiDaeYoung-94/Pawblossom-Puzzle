import {pipLevel,type PipCare} from './pipCare';
import {t,type Language} from './i18n';

export type PipUnlockLevel=2|3;
/** 확정한 돌봄의 전후만 비교합니다. 저장·소유·재화·타이머는 만들지 않습니다. */
export function reachedPipUnlock(before:PipCare,after:PipCare):PipUnlockLevel|undefined {
  const level=pipLevel(after);return level>pipLevel(before)&&level!==1?level:undefined;
}
export function pipUnlockCard(language:Language,level:PipUnlockLevel|undefined){
  if(level===undefined)return '';
  return `<aside id="pip-unlock-card" class="pip-unlock-card" aria-labelledby="pip-unlock-title"><div role="status" aria-live="polite" aria-atomic="true"><small>Lv. ${level}</small><h4 id="pip-unlock-title">${t(language,'pipUnlockTitle')}</h4><p>${t(language,level===2?'pipUnlockGreeting':'pipUnlockTending')}</p><p class="pip-unlock-shop">${t(language,'pipUnlockShop').replace('{item}',t(language,level===2?'pipRibbon':'pipWateringCan'))}</p></div><div class="pip-unlock-actions"><button id="pip-unlock-try" type="button" class="text-button">${t(language,level===2?'pipGreet':'pipTend')}</button><button id="pip-unlock-dismiss" type="button" class="text-button">${t(language,'pipUnlockDismiss')}</button></div></aside>`;
}
