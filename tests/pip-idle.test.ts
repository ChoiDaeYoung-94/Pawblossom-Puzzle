import {describe,it,expect,vi} from 'vitest';
import {createPipIdle} from '../src/PipIdle';

function setup(){
  const pip={dataset:{} as Record<string,string>,isConnected:true};
  const image={alt:'',decoding:'',src:'',onload:null as null|(()=>void),onerror:null as null|(()=>void),decode:vi.fn(()=>Promise.resolve())};
  const idle=createPipIdle(pip as unknown as HTMLElement,()=>image as unknown as HTMLImageElement);
  return {pip,image,idle};
}
async function settle(){for(let i=0;i<5;i++)await Promise.resolve();}

describe('핍의 표시 전용 눈 깜빡임',()=>{
  it('해독 성공 뒤에만 전환을 허용하며 비활성 상태를 덮어쓰지 않습니다',async()=>{
    const h=setup();h.idle.setActive(true);expect(h.pip.dataset.idleReady).toBeUndefined();
    expect(h.image.src).toBe('/assets/pip-idle-blink-v2.webp');
    h.image.onload!();h.idle.setActive(false);await settle();
    expect(h.pip.dataset).toEqual({idleReady:'true',idleActive:'false'});
    h.idle.setActive(true);expect(h.pip.dataset.idleActive).toBe('true');
  });
  it.each(['load','decode'] as const)('%s 실패에는 기본 얼굴을 유지하고 반복 요청하지 않습니다',async mode=>{
    const h=setup();h.idle.setActive(true);
    if(mode==='load')h.image.onerror!();else{h.image.decode.mockRejectedValueOnce(new Error('decode'));h.image.onload!();}
    await settle();expect(h.pip.dataset.idleReady).toBeUndefined();expect(h.image.onload).toBeNull();expect(h.image.onerror).toBeNull();
  });
  it('해제/분리 이후 도착한 콜백은 준비 상태를 되살리지 않습니다',async()=>{
    const h=setup(),late=h.image.onload!;h.idle.setActive(true);h.idle.dispose();late();await settle();h.idle.setActive(true);
    expect(h.pip.dataset).toEqual({});
    const detached=setup();detached.pip.isConnected=false;detached.image.onload!();await settle();expect(detached.pip.dataset.idleReady).toBeUndefined();
  });
});
