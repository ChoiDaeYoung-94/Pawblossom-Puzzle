/** 연출 시작 경계에서 조회하며 OS 설정용 리스너를 만들지 않습니다. */
export function reducedMotion(){
  return typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
