import {gardenArt} from './GardenArt';
import {gardenDesignFor,validateGardenDesign,freshGardenDesign,gardenThemes,themeReady,type GardenDesign,type GardenTheme,type GardenAction} from './gardenDesign';
import {t,type Language,type TextKey} from './i18n';

type Care={growth:number;affection:number};
const nameKeys={meadow:'gardenThemeMeadow',sunset:'gardenThemeSunset',starlight:'gardenThemeStarlight'} as const;
let renderId=0;
/** after는 표시용입니다. 구매 확인은 원래 GardenAction을 다시 검증해야 합니다. */
export function previewGardenTheme(id:GardenTheme,current:GardenDesign|undefined,plots:number,pip:Care,clears:number,coins:number){
  if(!Object.hasOwn(nameKeys,id)||!Number.isInteger(coins)||coins<0||coins>1_000_000||!Number.isInteger(plots)||plots<0||plots>5)return;
  const before=validateGardenDesign(current??freshGardenDesign(),plots,pip,clears);if(!before)return;
  const spec=gardenThemes.find(theme=>theme.id===id),owned=id==='meadow'||Boolean(before.ownedThemes?.includes(id));
  const cost=owned?0:spec!.cost,ready=owned||themeReady(spec!,plots,pip,clears),changed=(before.theme??'meadow')!==id;
  const after=gardenDesignFor(before);after.theme=id;
  const action:GardenAction=owned?{kind:'selectTheme',theme:id}:{kind:'buyTheme',theme:id as Exclude<GardenTheme,'meadow'>};
  return {before,after,action,owned,cost,ready,changed,canApply:ready&&changed&&coins>=cost};
}
export function gardenThemePreview(language:Language,current:GardenDesign|undefined,plots:number,pip:Care,clears:number,coins:number,id:GardenTheme,showCurrent:boolean,blocked:boolean,demo:boolean){
  const plan=previewGardenTheme(id,current,plots,pip,clears,coins);if(!plan)return '';
  const text=(key:TextKey)=>t(language,key),fill=(key:TextKey,values:Record<string,string|number>)=>Object.entries(values).reduce((copy,[key,value])=>copy.replaceAll('{'+key+'}',String(value)),text(key));
  const spec=gardenThemes.find(theme=>theme.id===id),name=text(nameKeys[id]);
  const conditions=spec?fill('gardenThemeConditions',{clears,needClears:spec.clears,plots,needPlots:spec.plots,growth:pip.growth,needGrowth:spec.growth,affection:pip.affection,needAffection:spec.affection}):'';
  const reason=blocked?text('careSaveBlocked'):!plan.ready?conditions:coins<plan.cost?text('spaceNeedCoins'):!plan.changed?text('lookSame'):text(plan.owned?'spaceSwitchFree':'themePreviewReady');
  return `<section class="garden-look-preview garden-theme-preview"><h2 id="garden-look-title" tabindex="-1">${name} · ${text('spacePreview')}</h2><p id="garden-look-description">${text('themePreviewIntro')}</p>${demo?`<p class="space-preview-demo">${text('spaceDemo')}</p>`:''}<div class="space-preview-layout"><div class="space-preview-visual"><div class="garden-look-art" role="img" aria-label="${text(showCurrent?'spaceCurrent':'spaceAfter')} · ${text(nameKeys[showCurrent?plan.before.theme??'meadow':id])}">${gardenArt(plots,false,showCurrent?plan.before:plan.after,{renderer:'painted-v4',idPrefix:`theme-preview-${++renderId}`})}</div><div class="space-preview-compare"><button id="garden-look-current" type="button" aria-pressed="${showCurrent}">${text('spaceCurrent')}</button><button id="garden-look-after" type="button" aria-pressed="${!showCurrent}">${text('spaceAfter')}</button></div></div><div class="space-preview-details"><h3>${name}</h3><p>${plan.owned?text('spaceSwitchFree'):fill('themePreviewCost',{cost:plan.cost})}</p><p>${fill('themePreviewBalance',{coins})}</p>${coins>=plan.cost?`<p>${fill('themePreviewRemaining',{coins:coins-plan.cost})}</p>`:''}${!plan.owned&&plan.ready?`<p>${conditions}</p>`:''}<p id="garden-look-status" role="status">${reason}</p><div class="space-preview-actions"><button id="garden-look-confirm" class="primary" type="button" aria-describedby="garden-look-status" ${blocked||!plan.canApply?'disabled':''}>${plan.owned?text('gardenThemeSelect'):fill('themePreviewConfirm',{cost:plan.cost})}</button><button id="garden-look-cancel" class="text-button" type="button">${text('spaceCancel')}</button></div></div></div></section>`;
}
