import {describe,it,expect} from 'vitest';
import {campaignAlbum,albumSelection,parseAlbumIndex,campaignAlbumCard} from '../src/CampaignAlbum';
import {campaignWorldPostcard} from '../src/CampaignScenery';
import {t} from '../src/i18n';
const completed=(n:number)=>Array.from({length:n},(_,i)=>i+1);

describe('실제 기록으로 다시 보는 풍경 앨범',()=>{
  it('중복·잘못된 완료와 마지막판 하나로 엽서를 얻지 않고 입력을 변경하지 않습니다',()=>{
    const ids=Object.freeze([1,1,20,500,0,501,1.2,NaN,Infinity]),before=[...ids];
    const worlds=campaignAlbum(ids);expect(worlds).toHaveLength(25);expect(worlds[0].done).toBe(2);expect(worlds[24].done).toBe(1);expect(worlds.some(w=>w.collected)).toBe(false);expect(ids).toEqual(before);
    expect(albumSelection(ids,undefined).index).toBe(24);expect(albumSelection([],undefined).index).toBe(0);
  });
  it('각 풍경의 빠진 한 판을 채워야 수집하고500고유완료는25장입니다',()=>{
    for(let index=0;index<25;index++){
      const ids=Array.from({length:20},(_,i)=>index*20+i+1),missing=ids.filter((_,i)=>i!==7);
      expect(campaignAlbum(missing)[index]).toMatchObject({done:19,collected:false});
      expect(campaignAlbum([...missing,ids[7],ids[7]])[index]).toMatchObject({done:20,collected:true});
    }
    expect(campaignAlbum(completed(500)).filter(w=>w.collected)).toHaveLength(25);
  });
  it.each([{done:0,world:0,collected:false},{done:19,world:0,collected:false},{done:20,world:0,collected:true},{done:21,world:1,collected:false},{done:39,world:1,collected:false},{done:40,world:1,collected:true},{done:41,world:2,collected:false},{done:500,world:24,collected:true}])('$done판의 기본 앨범은 진행 중 풍경을 잇고 완성 경계는 유지합니다',({done,world,collected})=>{
    const ids=Object.freeze(completed(done)),before=[...ids],selected=albumSelection(ids,undefined);
    expect(selected).toMatchObject({index:world,collected});expect(ids).toEqual(before);
  });
  it('선택은0–24 정규 정수만 받고 범위 밖 선택은 실제 기록에서 복구합니다',()=>{
    for(const value of ['','-1','1.2','01','1e1',' 1','25','NaN','Infinity'])expect(parseAlbumIndex(value)).toBeUndefined();
    expect(parseAlbumIndex('0')).toBe(0);expect(parseAlbumIndex('24')).toBe(24);
    expect(albumSelection(completed(21),NaN).index).toBe(1);expect(albumSelection(completed(40),undefined).index).toBe(1);expect(albumSelection([1,21],undefined).index).toBe(1);expect(albumSelection(completed(21),1).index).toBe(1);expect(albumSelection(completed(21),0).index).toBe(0);
  });
  it.each(['ko','en'] as const)('%s: 미완료는 그림을 해독하지 않고 수집한 선택 한 장만 표시하며 결과 엽서와 clip이 겹치지 않습니다',language=>{
    const pending=campaignAlbumCard(language,completed(19),0,false),ready=campaignAlbumCard(language,completed(20),0,false);
    expect(pending).toContain('19/20');expect(pending).toContain(t(language,'albumRemaining').replace('{count}','1'));expect(pending).not.toContain('data-map-src');
    expect(ready).toContain(t(language,'albumCollected'));expect([...ready.matchAll(/data-map-src=/g)]).toHaveLength(1);
    expect(ready).toContain('album-postcard-1-0');expect(campaignWorldPostcard(1,0)).toContain('world-postcard-1-0');
    expect(ready).not.toMatch(/\shref=|localStorage|data-level=/);
    const demo=campaignAlbumCard(language,[],24,true);expect(demo).toContain(t(language,'albumRealOnly'));expect(demo).toContain('id="album-open-map" class="text-button" disabled');expect(demo).not.toContain('data-map-src');
  });
  it.each(['ko','en'] as const)('%s: 다음 풍경 첫 완료의 기본 카드는 남은 수량을 안내하고 수집 그림을 열지 않습니다',language=>{
    const html=campaignAlbumCard(language,completed(21),undefined,false);
    expect(html).toContain('data-collected="false"');expect(html).toContain('1/20');expect(html).toContain(t(language,'albumRemaining').replace('{count}','19'));expect(html).not.toContain('data-map-src');
    expect(campaignAlbumCard(language,completed(21),0,false)).toContain('album-postcard-1-0');
  });
});
