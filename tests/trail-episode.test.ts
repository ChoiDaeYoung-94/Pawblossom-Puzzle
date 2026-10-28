import {describe,it,expect} from 'vitest';
import {trailBeat,trailStoryCard,trailJournal,updateTrailEncounter,wolfImages} from '../src/TrailEpisode';
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
    expect(levels.filter(l=>trailBeat(l.id)).map(l=>l.id)).toEqual([4,6,10]);
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
