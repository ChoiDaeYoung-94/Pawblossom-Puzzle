import {describe,it,expect} from 'vitest';
import {trailBeat,trailStoryCard,trailJournal,updateTrailEncounter,wolfImages,beaverImages} from '../src/TrailEpisode';
import {t} from '../src/i18n';
import {levels,levelSignature} from '../src/state';

describe('숲길 첫 만남의 표시 정책',()=>{
  it('추억은 실제 고유 완료에서만 파생하고 중복/무관한 완료는 수집 수를 늘리지 않는다',()=>{
    const completed=[1,4,4,6,99],before=completed.slice();
    const html=trailJournal('ko',completed);
    expect(html).toContain('2/3');expect(html.match(/data-memory-owned="true"/g)).toHaveLength(2);
    expect(html).toContain(t('ko','trailFirstAfter'));expect(html).toContain(t('ko','trailMemoryAt').replace('{level}','10'));
    expect(completed).toEqual(before);expect(trailJournal('en',[])).toContain('0/3');
  });
  it('기존 낙엽 도입4·두겹6·혼합10만 연결하고 목표를 새로 만들지 않는다',()=>{
    expect(levels.filter(l=>trailBeat(l.id)?.episode.id==='wolf-v1').map(l=>l.id)).toEqual([4,6,10]);
    for(const id of [4,6,10])expect(levels[id-1].leaves?.length).toBeGreaterThan(0);
    expect(levels[5].leaves!.every(p=>p.layers===2)).toBe(true);
    expect(trailStoryCard('ko',5,'preview',false,false)).toBe('');
    const before=levels.map(levelSignature);
    for(const level of levels)trailStoryCard('en',level.id,'preview',false,false);
    expect(levels.map(levelSignature)).toEqual(before);
  });
  it.each(['ko','en'] as const)('%s 첫 방문·기존 완료·시험 미리보기는 구분한다',language=>{
    const first=trailStoryCard(language,4,'preview',false,false);
    expect(first).toContain(t(language,'trailFirstProblem'));expect(first).toContain(wolfImages.blocking);
    const memory=trailStoryCard(language,4,'preview',true,false);
    expect(memory).toContain(t(language,'trailFirstAfter'));expect(memory).toContain(wolfImages.relieved);expect(memory).not.toContain(t(language,'trailFirstTask'));
    const practice=trailStoryCard(language,4,'preview',true,true);
    expect(practice).toContain(t(language,'trailPractice'));expect(practice).toContain(t(language,'trailFirstTask'));expect(practice).toContain(wolfImages.blocking);
  });
  it.each(['ko','en'] as const)('%s 실패는 기존 완료 이력과 관계없이 새 해결/보상을 주장하지 않는다',language=>{
    const retry=trailStoryCard(language,10,'retry',true,false);
    expect(retry).toContain(t(language,'trailRetryLine'));expect(retry).not.toContain(t(language,'trailFinalAfter'));
    const won=trailStoryCard(language,10,'won',false,true);
    expect(won).toContain(t(language,'trailPractice'));expect(won).toContain(t(language,'trailFinalAfter'));
    expect(won).not.toContain('button');
  });
  it('확정된 낙엽 수만 HUD에 적용하고 다른 색 목표 완료로 오해시키지 않는다',()=>{
    const text={textContent:''};const host={hidden:false,innerHTML:'',dataset:{} as Record<string,string>,attributes:{} as Record<string,string>,querySelector:()=>text,setAttribute(k:string,v:string){this.attributes[k]=v;}};
    updateTrailEncounter(host as unknown as HTMLElement,'ko',6,1,4);
    expect(host.hidden).toBe(false);expect(host.dataset.resolved).toBe('false');expect(text.textContent).toBe('남은 낙엽 3');
    const html=host.innerHTML;updateTrailEncounter(host as unknown as HTMLElement,'ko',6,4,4);
    expect(host.innerHTML).toBe(html);expect(host.dataset.resolved).toBe('true');expect(text.textContent).toBe(t('ko','trailLeavesReady'));
    updateTrailEncounter(host as unknown as HTMLElement,'en',6,4,4);expect(host.attributes['aria-label']).toContain('Leaves cleared!');
    updateTrailEncounter(host as unknown as HTMLElement,'ko',5,0,4);expect(host.hidden).toBe(true);expect(host.innerHTML).toBe('');expect(host.dataset.trailLevel).toBeUndefined();
  });
});


describe('물가 비버와 에피소드별 추억',()=>{
  const episodePart=(html:string,id:string)=>html.match(new RegExp(`<details[^>]*data-trail-episode="${id}"[^>]*>([\\s\\S]*?)</details>`))?.[1]??'';
  it('실제36/38/40 상자판에만 연결하고 500판 정의/서명을 바꾸지 않습니다',()=>{
    expect(levels.filter(level=>trailBeat(level.id)?.episode.id==='beaver-v1').map(level=>level.id)).toEqual([36,38,40]);
    expect([36,38,40].map(id=>levels[id-1].crates?.length)).toEqual([4,4,8]);
    expect([36,38,40].map(id=>levels[id-1].moves)).toEqual([28,30,34]);
    const before=levels.map(levelSignature);for(const level of levels)trailStoryCard('ko',level.id,'preview',false,false);expect(levels.map(levelSignature)).toEqual(before);
  });
  it('기존 늑대3/3과 비버1/3을 분리해 중복/무관 완료로 늘리지 않습니다',()=>{
    const completed=[4,6,10,36,36,99],before=completed.slice(),html=trailJournal('ko',completed);
    expect(episodePart(html,'wolf-v1')).toContain('3/3');expect(episodePart(html,'beaver-v1')).toContain('1/3');expect(html).not.toContain('/6');
    expect(html.match(/data-memory-owned="true"/g)).toHaveLength(4);expect(completed).toEqual(before);
  });
  it('다음 물가에 갈 수 있는20완료부터 예고하고 잘못된 완료값으로 개방하지 않습니다',()=>{
    expect(trailJournal('en',[19])).not.toContain('data-trail-episode="beaver-v1"');
    expect(episodePart(trailJournal('en',[20]),'beaver-v1')).toContain('0/3');
    expect(trailJournal('en',[Number.NaN,-1,999])).not.toContain('data-trail-episode="beaver-v1"');
  });
  it('기존40판 완료 저장은 새 필드 없이 두 에피소드3/3을 읽기만 합니다',()=>{
    const completed=Array.from({length:40},(_,i)=>i+1),before=completed.slice(),html=trailJournal('en',completed);
    expect(episodePart(html,'wolf-v1')).toContain('3/3');expect(episodePart(html,'beaver-v1')).toContain('3/3');expect(html.match(/data-memory-owned="true"/g)).toHaveLength(6);expect(completed).toEqual(before);
  });
  it.each(['ko','en'] as const)('%s 미리보기/기존완료/시험/패배는 새 실제 추억과 구분합니다',language=>{
    const preview=trailStoryCard(language,36,'preview',false,false);expect(preview).toContain(beaverImages.blocking);expect(preview).toContain(t(language,'trailBeaverFirstTask'));expect(preview).not.toContain(t(language,'trailBeaverFirstAfter'));
    const memory=trailStoryCard(language,36,'preview',true,false);expect(memory).toContain(beaverImages.relieved);expect(memory).toContain(t(language,'trailBeaverFirstAfter'));
    const practice=trailStoryCard(language,36,'preview',true,true);expect(practice).toContain(t(language,'trailPractice'));expect(practice).toContain(beaverImages.blocking);
    const retry=trailStoryCard(language,40,'retry',true,false);expect(retry).toContain(t(language,'trailRetryLine'));expect(retry).not.toContain(t(language,'trailBeaverFinalAfter'));
    expect(trailStoryCard(language,40,'won',false,true)).toContain(t(language,'trailPractice'));
  });
  it('낙엽 집계와 독립된 확정 상자 수만 HUD에 적용하고 일반판에서는 지웁니다',()=>{
    const copy={textContent:''},host={hidden:false,innerHTML:'',dataset:{} as Record<string,string>,attributes:{} as Record<string,string>,querySelector:()=>copy,setAttribute(k:string,v:string){this.attributes[k]=v;}};
    updateTrailEncounter(host as unknown as HTMLElement,'ko',36,4,4);expect(host.hidden).toBe(true);
    updateTrailEncounter(host as unknown as HTMLElement,'ko',36,9,9,{cleared:1,total:4});expect(host.hidden).toBe(false);expect(host.dataset.trailEpisode).toBe('beaver-v1');expect(host.dataset.resolved).toBe('false');expect(copy.textContent).toBe('남은 상자 3');
    const art=host.innerHTML;updateTrailEncounter(host as unknown as HTMLElement,'ko',36,9,9,{cleared:4,total:4});expect(host.innerHTML).toBe(art);expect(host.dataset.resolved).toBe('true');expect(copy.textContent).toBe(t('ko','trailCratesReady'));expect(host.innerHTML).not.toContain('trail-wolf');
    const ids=Array.from(host.innerHTML.matchAll(/ id="([^"]+)"/g),match=>match[1]);expect(new Set(ids).size).toBe(ids.length);
    updateTrailEncounter(host as unknown as HTMLElement,'en',36,0,0,{cleared:0,total:4});expect(copy.textContent).toBe('Crates left: 4');
    updateTrailEncounter(host as unknown as HTMLElement,'ko',5,0,0);expect(host.hidden).toBe(true);expect(host.innerHTML).toBe('');expect(host.dataset.trailEpisode).toBeUndefined();
  });
});
