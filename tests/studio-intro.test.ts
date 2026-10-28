import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {showStudioIntro,studioPreferences} from '../src/StudioIntro';
import {bindStudioLifecycle,createStudioBoot} from '../src/StudioBoot';
import {BACKUP_KEY,RESET_KEY,SAVE_KEY,SaveStore,saveStatus} from '../src/state';
import {readFileSync} from 'node:fs';

class Events extends EventTarget {
  count=0;
  override addEventListener(type:string,callback:EventListenerOrEventListenerObject|null,options?:AddEventListenerOptions|boolean){super.addEventListener(type,callback,options);if(callback)this.count++;}
  override removeEventListener(type:string,callback:EventListenerOrEventListenerObject|null,options?:EventListenerOptions|boolean){super.removeEventListener(type,callback,options);if(callback)this.count--;}
}
class Element extends Events {
  id='';hidden=false;className='';textContent='';src='';poster='';muted=false;tabIndex=0;type='';playsInline=false;preload='';
  attrs=new Map<string,string>();children:Element[]=[];parent?:Element;
  isConnected=true;
  pause=vi.fn();load=vi.fn();focus=vi.fn();canPlayType=vi.fn(()=>this.ownerDocument.playable?'probably':'');
  play=vi.fn(()=>this.ownerDocument.play());
  constructor(readonly tag:string,readonly ownerDocument:Document){super();}
  append(...children:Element[]){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.isConnected=false;}
  setAttribute(key:string,value:string){this.attrs.set(key,value);}
  getAttribute(key:string){return this.attrs.get(key)??null;}
  removeAttribute(key:string){this.attrs.delete(key);if(key==='src')this.src='';}
  querySelector(selector:string){return this.children.find(child=>'#'+child.id===selector)??null;}
}
class Document extends Events {
  hidden=false;defaultView=new Events();playable=true;play=vi.fn<()=>Promise<void>>(()=>Promise.resolve());elements:Element[]=[];
  createElement(tag:string){const element=new Element(tag,this);this.elements.push(element);return element;}
  element(tag:string){return this.elements.find(el=>el.tag===tag)!;}
}
function setup(){
  const doc=new Document(),host=doc.createElement('host'),startup=doc.createElement('startup');startup.id='app-startup';host.append(startup);
  return {doc,host,startup,begin:(sound=true,reduce=false,language:'ko'|'en'='ko')=>showStudioIntro(host as unknown as HTMLElement,{sound,language},reduce)};
}
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());

describe('스튜디오 인트로 종료·미디어 수명',()=>{
  it('종료 이벤트가 게임을 한 번 열고 미디어·시계·리스너·시작 표시를 정리한다',async()=>{
    const h=setup(),task=h.begin(),video=h.doc.element('video'),launch=vi.fn();task.finished.then(launch);
    expect(h.startup.hidden).toBe(true);expect(video.muted).toBe(false);
    video.dispatchEvent(new Event('ended'));video.dispatchEvent(new Event('error'));task.finish();await tick();
    expect(launch).toHaveBeenCalledTimes(1);expect(h.startup.hidden).toBe(false);expect(h.startup.getAttribute('aria-hidden')).toBeNull();
    expect(video.muted).toBe(true);expect(video.src).toBe('');expect(video.load).toHaveBeenCalledOnce();expect(h.host.children).toEqual([h.startup]);
    expect(video.count).toBe(0);expect(h.doc.count).toBe(0);expect(h.doc.defaultView.count).toBe(0);expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['ko','en'] as const)('건너뛰기 버튼은 %s 이름과 실제 버튼 의미를 가지며 즉시 끝낸다',async language=>{
    const h=setup(),task=h.begin(true,false,language),button=h.doc.element('button');
    expect(button.type).toBe('button');expect(button.textContent).toBe(language==='ko'?'건너뛰기':'Skip');expect(button.focus).toHaveBeenCalledOnce();
    button.dispatchEvent(new Event('click'));await task.finished;expect(vi.getTimerCount()).toBe(0);
  });
  it('Escape도 종료하고 기본 동작을 취소한다',async()=>{
    const h=setup(),task=h.begin(),event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'Escape'});h.doc.element('section').dispatchEvent(event);
    await task.finished;expect(event.defaultPrevented).toBe(true);
  });
  it('모션 감소는 영상/소리를 재생하지 않고 짧은 정적 포스터로 끝낸다',async()=>{
    const h=setup(),task=h.begin(true,true);expect(h.doc.play).not.toHaveBeenCalled();expect(h.doc.element('video').src).toBe('');expect(h.doc.element('img').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1200);await task.finished;expect(vi.getTimerCount()).toBe(0);
  });
  it('지원하지 않는 동영상도 정적 포스터에서 끝난다',async()=>{
    const h=setup();h.doc.playable=false;const task=h.begin();expect(h.doc.play).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1200);await task.finished;
  });
  it('효과음 무음이면 첫 시도부터 음소거하고 거절 시 소리를 켜지 않는다',async()=>{
    const h=setup();h.doc.play.mockRejectedValue(new Error('autoplay'));const task=h.begin(false);expect(h.doc.element('video').muted).toBe(true);await tick();await task.finished;expect(h.doc.play).toHaveBeenCalledTimes(1);
  });
  it('소리 자동재생 거절은 무음 한 번만 재시도하며 다시 거절되면 진입한다',async()=>{
    const h=setup();h.doc.play.mockRejectedValue(new Error('autoplay'));const task=h.begin();await tick();await task.finished;expect(h.doc.play).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['error','throw','pending'] as const)('미디어 %s에서도 진입이 막히지 않는다',async kind=>{
    const h=setup();if(kind==='throw')h.doc.play.mockImplementation(()=>{throw Error('media');});if(kind==='pending')h.doc.play.mockImplementation(()=>new Promise(()=>{}));
    const task=h.begin();if(kind==='error')h.doc.element('video').dispatchEvent(new Event('error'));if(kind==='pending')await vi.advanceTimersByTimeAsync(6500);
    await task.finished;expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['visibilitychange','pagehide'] as const)('%s는 재생을 끝내고 복귀 때 되살리지 않는다',async kind=>{
    const h=setup(),task=h.begin();h.doc.hidden=true;(kind==='pagehide'?h.doc.defaultView:h.doc).dispatchEvent(new Event(kind));await task.finished;
    h.doc.hidden=false;h.doc.dispatchEvent(new Event('visibilitychange'));await tick();expect(h.doc.play).toHaveBeenCalledTimes(1);
  });
  it('처음부터 숨겨진 문서는 인트로를 만들지 않는다',async()=>{
    const h=setup();h.doc.hidden=true;await h.begin().finished;expect(h.doc.elements.map(e=>e.tag)).toEqual(['host','startup']);expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['resolve','reject'] as const)('종료 뒤 늦은 play %s가 미디어를 다시 시작하지 않는다',async mode=>{
    const h=setup();let resolve!:()=>void,reject!:(error:Error)=>void;h.doc.play.mockReturnValue(new Promise<void>((yes,no)=>{resolve=yes;reject=no;}));
    const task=h.begin();task.finish();await task.finished;if(mode==='resolve')resolve();else reject(Error('late'));await tick();
    expect(h.doc.play).toHaveBeenCalledTimes(1);expect(h.doc.element('video').muted).toBe(true);expect(h.doc.element('video').src).toBe('');expect(vi.getTimerCount()).toBe(0);
  });
});

describe('기존 저장 설정 의미 보존',()=>{
  const valid=(sfx:boolean,language:'ko'|'en'='ko')=>JSON.stringify({version:1,language,highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:!sfx,sfx,tutorialSeen:false});
  function probe(entries:Record<string,string>){const map=new Map(Object.entries(entries)),setItem=vi.fn(),removeItem=vi.fn();return {store:new SaveStore(()=>({getItem:key=>map.get(key)??null,setItem,removeItem})),setItem,removeItem};}
  it.each([true,false])('음악과 별개인 효과음 %s와 언어를 읽고 쓰지 않는다',sound=>{
    const h=probe({[SAVE_KEY]:valid(sound,'en')}),before=saveStatus();expect(studioPreferences(h.store)).toEqual({language:'en',sound});expect(saveStatus()).toEqual(before);expect(h.setItem).not.toHaveBeenCalled();expect(h.removeItem).not.toHaveBeenCalled();
  });
  it('손상 primary의 유효 backup 무음을 존중한다',()=>{const h=probe({[SAVE_KEY]:'broken',[BACKUP_KEY]:valid(false,'en')});expect(studioPreferences(h.store)).toEqual({language:'en',sound:false});expect(h.store.status.load).toBe('recovered');expect(h.setItem).not.toHaveBeenCalled();});
  it('초기화 의도는 과거 payload보다 우선하고 오래된 언어를 부활시키지 않는다',()=>{const h=probe({[RESET_KEY]:'1',[SAVE_KEY]:valid(false,'en')});expect(studioPreferences(h.store)).toEqual({language:'ko',sound:true});expect(h.removeItem).not.toHaveBeenCalled();});
  const uncertain:Record<string,string>[]=[{[SAVE_KEY]:'broken'},{[SAVE_KEY]:JSON.stringify({version:2}),[BACKUP_KEY]:valid(true)}];
  it.each(uncertain)('불확실한 저장은 소리를 켜지 않는다',data=>{expect(studioPreferences(probe(data).store).sound).toBe(false);});
  it('저장 읽기 예외도 무음 기본값으로 지나간다',()=>{const store=new SaveStore(()=>{throw Error('storage');});expect(studioPreferences(store)).toEqual({language:'ko',sound:false});});
});

describe('부트 경계와 임시 native 리스너',()=>{
  it('병렬 start·정리 실패에도 게임 import는 한 번이고 인트로보다 뒤다',async()=>{
    let finish!:()=>void;const loaded=vi.fn(async()=>{}),failed=vi.fn(),start=createStudioBoot({intro:()=>({finished:new Promise<void>(yes=>{finish=yes;}),finish:()=>finish()}),guard:()=>({ready:Promise.resolve(true),release:()=>{throw Error('remove');}}),load:loaded,failed});
    const first=start(),second=start();expect(first).toBe(second);expect(loaded).not.toHaveBeenCalled();await tick();finish();await first;expect(loaded).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled();
  });
  it('인트로 자체 예외는 진입을 막지 않으며 앱 import 실패는 복구 UI로 전달한다',async()=>{
    const error=Error('chunk'),failed=vi.fn(),loaded=vi.fn(async()=>{throw error;});await createStudioBoot({intro:()=>{throw Error('intro');},load:loaded,failed})();expect(loaded).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledWith(error);
  });
  it('Back/비활성만 인트로를 끝내며 늦은 개별 handle도 제거한다',async()=>{
    let back!:()=>void,active!:(value:boolean)=>void,resolve!:(value:{remove:()=>Promise<void>})=>void;const finish=vi.fn(),remove=vi.fn(async()=>{}),late=new Promise<{remove:()=>Promise<void>}>(yes=>{resolve=yes;});
    const guard=bindStudioLifecycle({back:fn=>{back=fn;return late;},active:fn=>{active=fn;return Promise.resolve({remove});},current:async()=>true},finish);
    active(true);expect(finish).not.toHaveBeenCalled();back();active(false);expect(finish).toHaveBeenCalledTimes(1);guard.release();guard.release();back();active(false);expect(finish).toHaveBeenCalledTimes(1);
    const lateRemove=vi.fn(async()=>{});resolve({remove:lateRemove});await tick();expect(remove).toHaveBeenCalledOnce();expect(lateRemove).toHaveBeenCalledOnce();
  });
  it('native 등록 실패도 throw/unhandled rejection 없이 정리한다',async()=>{
    const guard=bindStudioLifecycle({back:()=>{throw Error('native');},active:()=>Promise.reject(Error('bridge')),current:async()=>true},()=>{});guard.release();await tick();
  });
  it('native 초기 비활성이고 이벤트가 없어도 영상 시작 전에 게임으로 넘어간다',async()=>{
    const intro=vi.fn(()=>({finished:Promise.resolve(),finish:vi.fn()})),load=vi.fn(async()=>{}),remove=vi.fn(async()=>{});
    await createStudioBoot({intro,load,failed:vi.fn(),guard:finish=>bindStudioLifecycle({back:async()=>({remove}),active:async()=>({remove}),current:async()=>false},finish)})();
    expect(intro).not.toHaveBeenCalled();expect(load).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
  });
  it('등록 중 비활성 이벤트는 늦은 active 조회로 되살아나지 않는다',async()=>{
    let active!:(value:boolean)=>void;const finish=vi.fn(),remove=vi.fn(async()=>{}),query=vi.fn(async()=>true);
    const guard=bindStudioLifecycle({back:async()=>({remove}),active:async fn=>{active=fn;fn(false);return {remove};},current:query},finish);
    expect(await guard.ready).toBe(false);await tick();expect(query).not.toHaveBeenCalled();active(true);expect(finish).toHaveBeenCalledOnce();guard.release();
  });
  it('초기 조회 중 최신 활성 이벤트가 오면 늦은 이전 상태가 덮지 않는다',async()=>{
    let active!:(value:boolean)=>void,answer!:(value:boolean)=>void;const remove=vi.fn(async()=>{});
    const guard=bindStudioLifecycle({back:async()=>({remove}),active:async fn=>{active=fn;return {remove};},current:()=>new Promise<boolean>(yes=>{answer=yes;})},vi.fn());
    await tick();active(true);answer(false);expect(await guard.ready).toBe(true);guard.release();expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['reject','pending'] as const)('초기 상태 %s는 소리 없이 종료하며 늦은 응답을 무시한다',async mode=>{
    let answer!:(value:boolean)=>void;const finish=vi.fn(),remove=vi.fn(async()=>{});
    const guard=bindStudioLifecycle({back:async()=>({remove}),active:async()=>({remove}),current:()=>mode==='reject'?Promise.reject(Error('native')):new Promise<boolean>(yes=>{answer=yes;})},finish);
    await tick();if(mode==='pending')await vi.advanceTimersByTimeAsync(1500);expect(await guard.ready).toBe(false);guard.release();if(mode==='pending')answer(true);await tick();expect(finish).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('실제 HTML 진입은 bootstrap이며 main은 그 뒤에만 import한다',()=>{
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),boot=readFileSync(new URL('../src/bootstrap.ts',import.meta.url),'utf8');
    expect(html).toContain('src="/src/bootstrap.ts"');expect(html).not.toContain('src="/src/main.ts"');expect(boot).toContain("load:()=>import('./main')");expect(boot).toContain('window.location.reload()');
  });
});
