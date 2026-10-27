/** 기존 꽃밭의480×280 좌표를 받아 무료 행동의 표시만 그립니다. */
export function gardenTendingArt(plot:number,point:readonly number[],elapsed=0){
  if(!Number.isInteger(plot)||plot<0||plot>4||point.length!==2||point.some(v=>!Number.isFinite(v))||point[0]<75||point[0]>450||point[1]<98||point[1]>250)return '';
  const [x,y]=point,age=Number.isFinite(elapsed)?Math.max(0,Math.min(2400,Math.floor(elapsed))):0;
  return `<svg class="garden-tending-art" viewBox="0 0 480 280" data-tending-plot="${plot}" style="--garden-tend-elapsed:${age}ms" aria-hidden="true" focusable="false"><g transform="translate(${x} ${y-18})"><ellipse class="garden-tending-bloom" rx="51" ry="24" fill="#fff1a223" stroke="#fff5ce" stroke-width="3"/><path class="garden-tending-spark" d="M-41-21v-10m-5 5h10M38-27v-8m-4 4h8" fill="none" stroke="#fff5ce" stroke-width="3" stroke-linecap="round"/></g><g transform="translate(${x-20} ${y-24})">${[0,1,2].map(i=>`<path class="garden-tending-drop" style="--garden-drop-delay:${150+i*280}ms" d="M0-4Q-4 1 0 4Q4 1 0-4Z" fill="#9ddbe9" stroke="#eafcff" stroke-width="1.5"/>`).join('')}</g></svg>`;
}
