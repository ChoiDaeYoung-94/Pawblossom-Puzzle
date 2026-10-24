/** 기존 무료 행동의 표시만 그립니다. 재화·성장·저장·타이머를 소유하지 않습니다. */
export function pipTendingArt(elapsed=0):string {
  const age=Number.isFinite(elapsed)?Math.max(0,Math.min(2400,Math.floor(elapsed))):0;
  return `<span class="pip-tending-scene" style="--tend-elapsed:${age}ms" aria-hidden="true"><svg viewBox="0 0 320 320" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">
    <ellipse cx="156" cy="307" rx="24" ry="5" fill="#47644426"/><path d="M135 291H177L171 309H141Z" fill="#c98c66" stroke="#946747" stroke-width="2"/><ellipse cx="156" cy="291" rx="22" ry="7" fill="#e9bd8c" stroke="#946747" stroke-width="2"/><ellipse cx="156" cy="291" rx="16" ry="4" fill="#816950"/>
    <path d="M156 289V267M156 282Q138 266 141 283Q149 287 156 283M156 278Q174 262 172 280Q164 286 156 281" fill="#8fa879" stroke="#68855b" stroke-width="2"/>
    <g class="pip-tending-flower">${[0,60,120,180,240,300].map(angle=>`<ellipse cx="156" cy="253" rx="5" ry="9" fill="#f0c4ae" stroke="#bf937b" stroke-width="1" transform="rotate(${angle} 156 262)"/>`).join('')}<circle cx="156" cy="262" r="5" fill="#eac674"/></g>
    ${[0,1,2].map(i=>`<path class="pip-tending-drop" style="--drop-delay:${250+i*230}ms" d="M200 233Q194 241 200 243Q206 241 200 233Z" fill="#99cad0" stroke="#edf6e8" stroke-width="1.5"/>`).join('')}
  </svg></span>`;
}
