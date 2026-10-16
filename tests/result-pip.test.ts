import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

class ImageStub {
  static created:ImageStub[]=[];
  src='';className='';alt='';decoding='';
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
  decode=vi.fn(()=>Promise.resolve());
  constructor(){ImageStub.created.push(this);}
}
const placeholder=()=>({isConnected:true,replaceWith:vi.fn()});
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('결과 아트 지연 요청과 기본 핍 유지',()=>{
  beforeEach(()=>{vi.resetModules();ImageStub.created=[];vi.stubGlobal('Image',ImageStub);});
  afterEach(()=>vi.unstubAllGlobals());

  it('모듈 초기화에는 요청하지 않고 첫 결과 종류만 요청합니다',async()=>{
    const {showResultPip}=await import('../src/ResultPip');
    expect(ImageStub.created).toHaveLength(0);
    const fallback=placeholder();showResultPip(fallback as unknown as HTMLImageElement,true);
    expect(ImageStub.created.map(image=>image.src)).toEqual(['/assets/pip-win-v1.webp']);
    expect(fallback.replaceWith).not.toHaveBeenCalled();
  });
  it('해독이 끝나기 전에는 기본 그림을 유지하고 해독된 같은 노드로 교체합니다',async()=>{
    const {showResultPip}=await import('../src/ResultPip');const fallback=placeholder();
    showResultPip(fallback as unknown as HTMLImageElement,false);
    let decoded!:()=>void;const image=ImageStub.created[0];image.decode.mockImplementation(()=>new Promise(resolve=>{decoded=resolve;}));
    image.onload!();await flush();expect(fallback.replaceWith).not.toHaveBeenCalled();
    decoded();await flush();expect(fallback.replaceWith).toHaveBeenCalledWith(image);
    expect(image.onload).toBeNull();expect(image.onerror).toBeNull();
  });
  it('같은 결과의 동시 요청은 합치고 이미 해독된 그림을 재사용합니다',async()=>{
    const {showResultPip}=await import('../src/ResultPip');const old=placeholder(),latest=placeholder();
    showResultPip(old as unknown as HTMLImageElement,true);old.isConnected=false;
    showResultPip(latest as unknown as HTMLImageElement,true);
    expect(ImageStub.created).toHaveLength(1);const image=ImageStub.created[0];image.onload!();await flush();
    expect(old.replaceWith).not.toHaveBeenCalled();expect(latest.replaceWith).toHaveBeenCalledWith(image);
    const replay=placeholder();showResultPip(replay as unknown as HTMLImageElement,true);await flush();
    expect(ImageStub.created).toHaveLength(1);expect(image.decode).toHaveBeenCalledTimes(1);expect(replay.replaceWith).toHaveBeenCalledWith(image);
  });
  it.each(['요청','해독'])('%s 실패는 기본 핍을 유지하고 재요청·에러 재귀를 만들지 않습니다',async mode=>{
    const {showResultPip}=await import('../src/ResultPip');const fallback=placeholder();
    showResultPip(fallback as unknown as HTMLImageElement,false);const image=ImageStub.created[0];
    if(mode==='요청')image.onerror!();else{image.decode.mockRejectedValue(new Error('decode'));image.onload!();}
    await flush();showResultPip(fallback as unknown as HTMLImageElement,false);await flush();
    expect(fallback.replaceWith).not.toHaveBeenCalled();expect(ImageStub.created).toHaveLength(1);
    expect(image.onload).toBeNull();expect(image.onerror).toBeNull();
  });
  it('이전 결과가 늦게 해독되어도 다른 결과의 그림을 덮지 않습니다',async()=>{
    const {showResultPip}=await import('../src/ResultPip');const old=placeholder(),latest=placeholder();
    showResultPip(old as unknown as HTMLImageElement,true);old.isConnected=false;showResultPip(latest as unknown as HTMLImageElement,false);
    const [win,retry]=ImageStub.created;retry.onload!();await flush();win.onload!();await flush();
    expect(old.replaceWith).not.toHaveBeenCalled();expect(latest.replaceWith).toHaveBeenCalledTimes(1);expect(latest.replaceWith).toHaveBeenCalledWith(retry);
  });
  it.each(['동기 예외','메서드 없음'])('해독 %s도 기본 그림을 유지하고 실패를 캐시합니다',async mode=>{
    const {showResultPip}=await import('../src/ResultPip');const fallback=placeholder();
    showResultPip(fallback as unknown as HTMLImageElement,true);const image=ImageStub.created[0];
    if(mode==='동기 예외')image.decode.mockImplementation(()=>{throw new Error('decode');});
    else Object.defineProperty(image,'decode',{value:undefined});
    image.onload!();await flush();await flush();
    showResultPip(fallback as unknown as HTMLImageElement,true);await flush();
    expect(fallback.replaceWith).not.toHaveBeenCalled();expect(ImageStub.created).toHaveLength(1);
  });
});
