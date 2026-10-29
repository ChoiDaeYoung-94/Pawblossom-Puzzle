import {t,type Language,type TextKey} from './i18n';
import {LEVEL_COUNT} from './levels';

type TrailBeat=Readonly<{level:number;title:TextKey;problem:TextKey;task:TextKey;after:TextKey}>;
type TrailEpisode=Readonly<{id:'wolf-v1'|'beaver-v1';counter:'leaves'|'crates';journalTitle:TextKey;journalFrom:number;images:Readonly<{blocking:string;relieved:string}>;beats:readonly TrailBeat[]}>;
export const wolfImages={blocking:'/assets/trail-episode-v1/wolf-blocking-v1.webp',relieved:'/assets/trail-episode-v1/wolf-relieved-v1.webp'} as const;
export const beaverImages={blocking:'/assets/trail-episode-v2/beaver-blocking-v1.webp',relieved:'/assets/trail-episode-v2/beaver-relieved-v1.webp'} as const;
export const trailEpisodes:readonly TrailEpisode[]=[
  {id:'wolf-v1',counter:'leaves',journalTitle:'trailJournalTitle',journalFrom:1,images:wolfImages,beats:[
    {level:4,title:'trailFirstTitle',problem:'trailFirstProblem',task:'trailFirstTask',after:'trailFirstAfter'},
    {level:6,title:'trailSecondTitle',problem:'trailSecondProblem',task:'trailSecondTask',after:'trailSecondAfter'},
    {level:10,title:'trailFinalTitle',problem:'trailFinalProblem',task:'trailFinalTask',after:'trailFinalAfter'},
  ]},
  {id:'beaver-v1',counter:'crates',journalTitle:'trailBeaverJournalTitle',journalFrom:21,images:beaverImages,beats:[
    {level:36,title:'trailBeaverFirstTitle',problem:'trailBeaverFirstProblem',task:'trailBeaverFirstTask',after:'trailBeaverFirstAfter'},
    {level:38,title:'trailBeaverSecondTitle',problem:'trailBeaverSecondProblem',task:'trailBeaverSecondTask',after:'trailBeaverSecondAfter'},
    {level:40,title:'trailBeaverFinalTitle',problem:'trailBeaverFinalProblem',task:'trailBeaverFinalTask',after:'trailBeaverFinalAfter'},
  ]},
];
export function trailBeat(level:number){
  for(const episode of trailEpisodes){const beat=episode.beats.find(item=>item.level===level);if(beat)return {...beat,episode};}
}

/** 같은 원본을 상보 마스크로 나눠 귀·꼬리만 움직이며 그림 자체는 다시 그리지 않습니다. */
function wolfFigure(state:'blocking'|'relieved'){
  const id=`trail-wolf-${state}`,tail='M239 168Q290 149 340 185L353 238Q342 290 274 303L237 285L224 260Q243 233 239 168Z',ear='M119 78L122 16L160 30L180 69L171 85L137 87Z',src=wolfImages[state];
  return `<svg class="trail-wolf-${state}" viewBox="0 0 384 384" aria-hidden="true" focusable="false"><defs><clipPath id="${id}-tail"><path d="${tail}"/></clipPath><clipPath id="${id}-ear"><path d="${ear}"/></clipPath><mask id="${id}-body" maskUnits="userSpaceOnUse" x="0" y="0" width="384" height="384"><rect width="384" height="384" fill="white"/><path d="${tail}" fill="black"/><path d="${ear}" fill="black"/></mask></defs><g class="trail-wolf-tail"><image href="${src}" width="384" height="384" clip-path="url(#${id}-tail)"/></g><g class="trail-wolf-ear"><image href="${src}" width="384" height="384" clip-path="url(#${id}-ear)"/></g><image href="${src}" width="384" height="384" mask="url(#${id}-body)"/></svg>`;
}

function beaverFigure(state:'blocking'|'relieved'){
  const id=`trail-beaver-${state}`,tail='M258 260Q281 228 310 217Q341 206 352 225Q369 249 350 275Q318 313 258 319L257 300Q265 280 258 260Z',src=beaverImages[state];
  return `<svg class="trail-beaver-${state}" viewBox="0 0 384 384" aria-hidden="true" focusable="false"><defs><clipPath id="${id}-tail"><path d="${tail}"/></clipPath><mask id="${id}-body" maskUnits="userSpaceOnUse" x="0" y="0" width="384" height="384"><rect width="384" height="384" fill="white"/><path d="${tail}" fill="black"/></mask></defs><g class="trail-beaver-tail"><image href="${src}" width="384" height="384" clip-path="url(#${id}-tail)"/></g><image href="${src}" width="384" height="384" mask="url(#${id}-body)"/></svg>`;
}

/** 기존 고유 완료에서 표시만 파생하며 저장·보상·규칙을 바꾸지 않습니다. */
export function trailStoryCard(language:Language,level:number,phase:'preview'|'won'|'retry',completed:boolean,testing:boolean){
  const beat=trailBeat(level);if(!beat)return '';
  const resolved=phase==='won'||phase==='preview'&&completed&&!testing;
  const label=t(language,testing?'trailPractice':phase==='retry'?'trailTryAgain':resolved?'trailMemory':'trailEncounter');
  const line=t(language,phase==='retry'?'trailRetryLine':resolved?beat.after:beat.problem);
  return `<section class="trail-story-card" data-trail-level="${level}" data-trail-episode="${beat.episode.id}" data-trail-resolved="${resolved}"><div class="trail-story-picture" aria-hidden="true"><span class="trail-story-sun"></span><span class="trail-story-path"></span><img src="${beat.episode.images[resolved?'relieved':'blocking']}" alt="" width="96" height="96" decoding="async"/></div><div class="trail-story-copy"><small>${label}</small><h3>${t(language,beat.title)}</h3><p>${line}</p>${!resolved&&phase!=='retry'?`<p class="trail-story-task">${t(language,beat.task)}</p>`:''}</div></section>`;
}

/** 실제 완료에서만 추억을 읽습니다. 돌봄 체험·시험판은 수집을 만들지 않습니다. */
export function trailJournal(language:Language,completed:readonly number[]){
  return trailEpisodes.filter(episode=>episode.journalFrom===1||completed.some(level=>Number.isInteger(level)&&level>=episode.journalFrom-1&&level<=LEVEL_COUNT)).map(episode=>{
    const beats=episode.beats,owned=beats.filter(beat=>completed.includes(beat.level));
    return `<details id="trail-journal-${episode.id}" class="trail-journal" data-trail-episode="${episode.id}" data-retain-open><summary id="trail-journal-${episode.id}-summary"><img src="${episode.images[owned.length===beats.length?'relieved':'blocking']}" width="54" height="54" alt="" decoding="async"/><span><small>${t(language,'trailJournalLabel')}</small><strong>${t(language,episode.journalTitle)}</strong></span><span class="trail-memory-count">${owned.length}/${beats.length}</span></summary><p>${t(language,'trailJournalNote')}</p><ol>${beats.map(beat=>{const done=completed.includes(beat.level);return `<li data-memory-owned="${done}"><span class="trail-memory-stage">${beat.level}</span><div><strong id="trail-memory-${beat.level}-title" tabindex="-1">${t(language,beat.title)}</strong><p>${done?t(language,beat.after):t(language,'trailMemoryAt').replace('{level}',String(beat.level))}</p></div></li>`;}).join('')}</ol></details>`;
  }).join('');
}

/** HUD는 확정된 낙엽/상자 집계만 사용하며 중간 연출에서 진행을 앞당기지 않습니다. */
export function updateTrailEncounter(host:HTMLElement,language:Language,level:number,cleared:number,total:number,crates?:{cleared:number;total:number}){
  const beat=trailBeat(level);
  if(beat?.episode.counter==='crates'){cleared=crates?.cleared??0;total=crates?.total??0;}
  const visible=Boolean(beat&&total>0);
  host.hidden=!visible;
  if(!beat||!visible){host.innerHTML='';delete host.dataset.trailLevel;delete host.dataset.trailEpisode;return;}
  const remaining=Math.max(0,total-cleared),resolved=remaining===0;
  const identity=`${level}:${language}`;
  if(host.dataset.trailLevel!==identity){
    host.dataset.trailLevel=identity;host.dataset.trailEpisode=beat.episode.id;
    const figure=beat.episode.id==='wolf-v1'?wolfFigure:beaverFigure;
    host.innerHTML=`<span class="trail-opponent-art" aria-hidden="true">${figure('blocking')}${figure('relieved')}</span><span class="trail-opponent-copy"></span>`;
  }
  host.dataset.resolved=String(resolved);
  const copy=host.querySelector<HTMLElement>('.trail-opponent-copy');
  const key=beat.episode.counter==='crates'?(resolved?'trailCratesReady':'trailCratesLeft'):(resolved?'trailLeavesReady':'trailLeavesLeft');
  const status=t(language,key).replace('{count}',String(remaining));
  if(copy)copy.textContent=status;
  host.setAttribute('aria-label',t(language,'trailEncounter')+' · '+t(language,beat.title)+' · '+status);
}
