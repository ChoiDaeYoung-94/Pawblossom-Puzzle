export const pipIdleImages=['/assets/pip-idle-open-v2.webp','/assets/pip-idle-blink-v2.webp'] as const;
let nextRig=0;

/** #273 자체 시제품의 최종320좌표 마스크입니다. 원본 비트맵은 가공하지 않습니다. */
export function createPipRig(document:Document,alignment:'center'|'bottom'='center'){
  const id=`pip-rig-${++nextRig}`,rig=document.createElement('span');
  rig.className='pip-idle-rig';rig.setAttribute('aria-hidden','true');
  rig.innerHTML=`<svg viewBox="0 0 320 320" preserveAspectRatio="xMid${alignment==='bottom'?'YMax':'YMid'} meet" aria-hidden="true" focusable="false"><defs>
    <clipPath id="${id}-left"><path d="M20 40H98L120 80L139 100L126 113L100 115L20 90Z"/></clipPath>
    <clipPath id="${id}-back"><path d="M115 0H205L215 76L194 103L157 100L135 80L112 35Z"/></clipPath>
    <mask id="${id}-body" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="320"><rect width="320" height="320" fill="white"/><path d="M0 0H320V120H210Q187 86 157 95Q129 96 109 116H0Z" fill="black"/></mask>
    <radialGradient id="${id}-soft"><stop offset="0" stop-color="white"/><stop offset=".74" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient>
    <mask id="${id}-eyes" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="320"><ellipse cx="143" cy="145" rx="20" ry="22" fill="url(#${id}-soft)"/><ellipse cx="198" cy="136" rx="19" ry="22" fill="url(#${id}-soft)"/></mask>
    </defs><g class="pip-rig-ear-back"><image href="${pipIdleImages[0]}" width="320" height="320" clip-path="url(#${id}-back)"/></g><g class="pip-rig-ear-left"><image href="${pipIdleImages[0]}" width="320" height="320" clip-path="url(#${id}-left)"/></g><image href="${pipIdleImages[0]}" width="320" height="320" mask="url(#${id}-body)"/><image class="pip-rig-eyelids" href="${pipIdleImages[1]}" width="320" height="320" mask="url(#${id}-eyes)"/></svg>`;
  return rig;
}
