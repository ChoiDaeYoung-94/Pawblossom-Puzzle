// 결과가 열릴 때만 요청합니다. 실패도 캐시하여 오프라인에서 반복 요청하지 않습니다.
const art = new Map<boolean, Promise<HTMLImageElement | null>>();

export function showResultPip(fallback: HTMLImageElement, won: boolean): void {
  let ready = art.get(won);
  if (!ready) {
    ready = new Promise(resolve => {
      const image = new Image();
      image.className = 'result-pip';
      image.alt = '';
      image.decoding = 'async';
      image.onload = () => {
        image.onload = image.onerror = null;
        // 해독이 끝난 같은 노드를 붙이므로 기본 핍이 빈 이미지로 바뀌지 않습니다.
        void Promise.resolve().then(() => image.decode()).then(() => resolve(image), () => resolve(null));
      };
      image.onerror = () => { image.onload = image.onerror = null; resolve(null); };
      image.src = won ? '/assets/pip-win-v1.webp' : '/assets/pip-retry-v1.webp';
    });
    art.set(won, ready);
  }
  void ready.then(image => {
    // 그 사이 다음 결과/스테이지로 이동했다면 오래된 그림을 붙이지 않습니다.
    if (image && fallback.isConnected) fallback.replaceWith(image);
  });
}
