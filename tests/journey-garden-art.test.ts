import {describe,it,expect,vi} from 'vitest';
import {createJourneyGardenArt,journeyGardenArt,journeyArtSource} from '../src/JourneyGardenArt';
import {journeyProjectSpecs} from '../src/journeyGarden';
import {journeyGardenPanel,journeyGardenPreview} from '../src/JourneyGardenUI';

class Slot {
  attributes=new Map<string,string>();isConnected=true;
  setAttribute(k:string,v:string){this.attributes.set(k,v);}getAttribute(k:string){return this.attributes.get(k)??null;}hasAttribute(k:string){return this.attributes.has(k);}removeAttribute(k:string){this.attributes.delete(k);}
}
class ImageStub {src='';alt='';decoding='';onload:null|(()=>void)=null;onerror:null|(()=>void)=null;decode=vi.fn(()=>Promise.resolve());}
function setup(path='/assets/journey-garden/works-a-v1.png'){
  const slot=new Slot();slot.setAttribute('data-journey-source',path);
  const host={isConnected:true,dataset:{} as Record<string,string>,querySelector:()=>slot};const images:ImageStub[]=[];
  const create=()=>{const image=new ImageStub();images.push(image);return image as unknown as HTMLImageElement;};
  const owner=createJourneyGardenArt(host as unknown as HTMLElement,create);
  return {slot,host,images,create,owner};
}
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
describe('여행 작품 원본의 실제 크롭과 표시 수명',()=>{
  it.each(['ribbon','wateringCan'] as const)('완성10작품의 idle·방문에서 장착 %s를 한 번 표시하고 미완성에는 핍을 미리 넣지 않습니다',equipped=>{
    for(const spec of journeyProjectSpecs)for(const moment of [false,true]){
      const projects={[spec.id]:{phase:2 as const,altOwned:false,style:'base' as const}};
      const html=journeyGardenPanel('ko',spec.id,projects,500,0,moment,equipped);
      expect(html.match(/id="village-pip-accessory"/g)).toHaveLength(1);expect(html).toContain(`data-pip-accessory="${equipped}"`);
      expect(journeyGardenPanel('ko',spec.id,undefined,500,0,moment,equipped)).not.toContain('village-pip-accessory');
      expect(journeyGardenPanel('ko',spec.id,projects,500,0,moment,'none')).not.toContain('village-pip-accessory');
    }
  });
  it('20스타일은5원본의실제분리경계를사용하고빈터/기초는완성bitmap을미리로드하지않습니다',()=>{
    const files=new Set<string>();
    for(const spec of journeyProjectSpecs)for(const style of ['base','alt'] as const){const source=journeyArtSource(spec.id,style==='alt');files.add(source.path);expect(source.x).toBe(style==='base'?0:627);expect(source.width).toBe(627);expect(source.y+source.height).toBe(source.y?1254:source.height);
      const svg=journeyGardenArt(spec.id,{phase:2,style,altOwned:style==='alt'});expect(svg).toContain(`viewBox="${source.x} ${source.y} ${source.width} ${source.height}"`);expect(svg).toContain('clipPathUnits="userSpaceOnUse"');expect(svg).toContain(`rect x="${source.x}" y="${source.y}" width="627" height="${source.height}"`);expect(svg).not.toContain(' href=');
      for(const phase of [0,1] as const)expect(journeyGardenArt(spec.id,{phase,style:'base',altOwned:false})).not.toContain('data-journey-source');
    }expect(files.size).toBe(5);
  });
  it('활성작품한장만load/decode뒤표시하고숨길때href/핸들러를해제합니다',async()=>{
    const h=setup();expect(h.images).toHaveLength(0);h.owner.setActive(true);h.owner.setActive(true);expect(h.images).toHaveLength(1);expect(h.slot.hasAttribute('href')).toBe(false);h.images[0].onload!();await settle();expect(h.images[0].decode).toHaveBeenCalledOnce();expect(h.slot.getAttribute('href')).toBe('/assets/journey-garden/works-a-v1.png');expect(h.host.dataset.journeyReady).toBe('true');h.owner.setActive(false);expect(h.slot.hasAttribute('href')).toBe(false);expect(h.host.dataset.journeyReady).toBeUndefined();expect(h.host.dataset.journeyActive).toBe('false');h.owner.setActive(true);expect(h.images).toHaveLength(2);h.owner.dispose();expect(h.images[1].onload).toBeNull();
  });
  it.each(['hidden','disposed','detached','source','slot'] as const)('%s 이후늦은decode는준비표시/href를붙이지않습니다',async kind=>{
    const h=setup();let resolve!:()=>void;h.owner.setActive(true);h.images[0].decode=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));h.images[0].onload!();await settle();
    if(kind==='hidden')h.owner.setActive(false);else if(kind==='disposed')h.owner.dispose();else if(kind==='detached')h.host.isConnected=false;else if(kind==='source')h.slot.setAttribute('data-journey-source','/assets/journey-garden/works-b-v1.png');else h.host.querySelector=()=>new Slot();
    resolve();await settle();expect(h.slot.hasAttribute('href')).toBe(false);expect(h.host.dataset.journeyReady).toBeUndefined();
  });
  it('새소유자와외부href를옛소유자가지우거나덮어쓰지않습니다',async()=>{
    const h=setup();h.owner.setActive(true);const load=h.images[0].onload!;const replacement=createJourneyGardenArt(h.host as unknown as HTMLElement,h.create);replacement.setActive(true);load();await settle();expect(h.slot.hasAttribute('href')).toBe(false);h.images[1].onload!();await settle();h.owner.dispose();expect(h.host.dataset.journeyReady).toBe('true');h.slot.setAttribute('href','/foreign.png');replacement.setActive(true);expect(h.slot.getAttribute('href')).toBe('/foreign.png');expect(h.host.dataset.journeyReady).toBeUndefined();replacement.dispose();expect(h.slot.getAttribute('href')).toBe('/foreign.png');
  });
  it('실패나외부주소는현재owner에서계속재시도하지않고fallback을유지합니다',()=>{
    const h=setup();h.owner.setActive(true);h.images[0].onerror!();for(let i=0;i<3;i++){h.owner.setActive(false);h.owner.setActive(true);}expect(h.images).toHaveLength(1);expect(h.host.dataset.journeyReady).toBeUndefined();const foreign=setup('https://example.com/asset.png');foreign.owner.setActive(true);expect(foreign.images).toHaveLength(0);
  });
  it.each(['ko','en'] as const)('%s:작품선택은하나의미리보기만표시하며부족조건도확정전에명시합니다',language=>{
    const panel=journeyGardenPanel(language,'starstage',undefined,499,0,false);expect(panel.match(/<option /g)).toHaveLength(10);expect(panel.match(/id="journey-work-picture"/g)).toHaveLength(1);expect(panel).not.toContain('data-journey-source');
    const preview=journeyGardenPreview(language,{starstage:{phase:1,altOwned:false,style:'base'}},{kind:'restore',project:'starstage'},499,25,0,false,false,false);expect(preview).toContain('id="space-preview-confirm"');expect(preview).toMatch(/id="space-preview-confirm"[^>]*disabled/);expect(preview.match(/data-journey-source/g)).toHaveLength(1);
  });
});
