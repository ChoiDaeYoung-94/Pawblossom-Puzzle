import {t,type Language,type TextKey} from './i18n';

const beats=[
  {level:4,title:'trailFirstTitle',problem:'trailFirstProblem',task:'trailFirstTask',after:'trailFirstAfter'},
  {level:6,title:'trailSecondTitle',problem:'trailSecondProblem',task:'trailSecondTask',after:'trailSecondAfter'},
  {level:10,title:'trailFinalTitle',problem:'trailFinalProblem',task:'trailFinalTask',after:'trailFinalAfter'},
] as const satisfies readonly {level:number;title:TextKey;problem:TextKey;task:TextKey;after:TextKey}[];
export const trailBeat=(level:number)=>beats.find(beat=>beat.level===level);
export const wolfImages={blocking:'/assets/trail-episode-v1/wolf-blocking-v1.webp',relieved:'/assets/trail-episode-v1/wolf-relieved-v1.webp'} as const;

/** 같은 원본을 상보 마스크로 나눠 귀·꼬리만 움직이며 그림 자체는 다시 그리지 않습니다. */
function wolfFigure(state:'blocking'|'relieved'){
  const id=`trail-wolf-${state}`,tail='M239 168Q290 149 340 185L353 238Q342 290 274 303L237 285L224 260Q243 233 239 168Z',ear='M119 78L122 16L160 30L180 69L171 85L137 87Z',src=wolfImages[state];
  return `<svg class="trail-wolf-${state}" viewBox="0 0 384 384" aria-hidden="true" focusable="false"><defs><clipPath id="${id}-tail"><path d="${tail}"/></clipPath><clipPath id="${id}-ear"><path d="${ear}"/></clipPath><mask id="${id}-body" maskUnits="userSpaceOnUse" x="0" y="0" width="384" height="384"><rect width="384" height="384" fill="white"/><path d="${tail}" fill="black"/><path d="${ear}" fill="black"/></mask></defs><g class="trail-wolf-tail"><image href="${src}" width="384" height="384" clip-path="url(#${id}-tail)"/></g><g class="trail-wolf-ear"><image href="${src}" width="384" height="384" clip-path="url(#${id}-ear)"/></g><image href="${src}" width="384" height="384" mask="url(#${id}-body)"/></svg>`;
}

/** 기존 고유 완료에서 표시만 파생하며 저장·보상·규칙을 바꾸지 않습니다. */
export function trailStoryCard(language:Language,level:number,phase:'preview'|'won'|'retry',completed:boolean,testing:boolean){
  const beat=trailBeat(level);if(!beat)return '';
  const resolved=phase==='won'||phase==='preview'&&completed&&!testing;
  const label=t(language,testing?'trailPractice':phase==='retry'?'trailTryAgain':resolved?'trailMemory':'trailEncounter');
  const line=t(language,phase==='retry'?'trailRetryLine':resolved?beat.after:beat.problem);
  return `<section class="trail-story-card" data-trail-level="${level}" data-trail-resolved="${resolved}"><div class="trail-story-picture" aria-hidden="true"><span class="trail-story-sun"></span><span class="trail-story-path"></span><img src="${wolfImages[resolved?'relieved':'blocking']}" alt="" width="96" height="96" decoding="async"/></div><div class="trail-story-copy"><small>${label}</small><h3>${t(language,beat.title)}</h3><p>${line}</p>${!resolved&&phase!=='retry'?`<p class="trail-story-task">${t(language,beat.task)}</p>`:''}</div></section>`;
}

/** 실제 완료에서만 추억을 읽습니다. 돌봄 체험·시험판은 수집을 만들지 않습니다. */
export function trailJournal(language:Language,completed:readonly number[]){
  const owned=beats.filter(beat=>completed.includes(beat.level));
  return `<details class="trail-journal"><summary><img src="${wolfImages[owned.length===beats.length?'relieved':'blocking']}" width="54" height="54" alt="" decoding="async"/><span><small>${t(language,'trailJournalLabel')}</small><strong>${t(language,'trailJournalTitle')}</strong></span><span class="trail-memory-count">${owned.length}/3</span></summary><p>${t(language,'trailJournalNote')}</p><ol>${beats.map(beat=>{const done=completed.includes(beat.level);return `<li data-memory-owned="${done}"><span class="trail-memory-stage">${beat.level}</span><div><strong>${t(language,beat.title)}</strong><p>${done?t(language,beat.after):t(language,'trailMemoryAt').replace('{level}',String(beat.level))}</p></div></li>`;}).join('')}</ol></details>`;
}

/** HUD는 확정된 낙엽 집계만 사용하며 중간 연출에서 진행을 앞당기지 않습니다. */
export function updateTrailEncounter(host:HTMLElement,language:Language,level:number,cleared:number,total:number){
  const beat=trailBeat(level),visible=Boolean(beat&&total>0);
  host.hidden=!visible;
  if(!beat||!visible){host.innerHTML='';delete host.dataset.trailLevel;return;}
  const remaining=Math.max(0,total-cleared),resolved=remaining===0;
  const identity=`${level}:${language}`;
  if(host.dataset.trailLevel!==identity){
    host.dataset.trailLevel=identity;
    host.innerHTML=`<span class="trail-opponent-art" aria-hidden="true">${wolfFigure('blocking')}${wolfFigure('relieved')}</span><span class="trail-opponent-copy"></span>`;
  }
  host.dataset.resolved=String(resolved);
  const copy=host.querySelector<HTMLElement>('.trail-opponent-copy');
  if(copy)copy.textContent=t(language,resolved?'trailLeavesReady':'trailLeavesLeft').replace('{count}',String(remaining));
  host.setAttribute('aria-label',t(language,'trailEncounter')+' · '+t(language,beat.title)+' · '+t(language,resolved?'trailLeavesReady':'trailLeavesLeft').replace('{count}',String(remaining)));
}
