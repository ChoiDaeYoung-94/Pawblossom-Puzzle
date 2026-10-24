import {afterEach,describe,expect,it,vi} from 'vitest';
import {createGardenNature} from '../src/GardenNature';

// controller는 실제 원본입니다. SVG paint/모션 감소의 최종 표시는 별도 실제 브라우저 검수입니다.
class NatureNode {
  dataset:Record<string,string>={};attributes:Record<string,string>={};children:NatureNode[]=[];
  parentElement:NatureNode|null=null;connected=false;innerHTML='';
  constructor(public ownerDocument:Document,public tagName:string){}
  get isConnected():boolean{return this.parentElement?this.parentElement.isConnected:this.connected;}
  get nextSibling():NatureNode|null {const siblings=this.parentElement?.children??[];return siblings[siblings.indexOf(this)+1]??null;}
  setAttribute(key:string,value:string){this.attributes[key]=value;}
  getAttribute(key:string){return this.attributes[key]??null;}
  hasAttribute(key:string){return Object.hasOwn(this.attributes,key);}
  removeAttribute(key:string){delete this.attributes[key];}
  contains(node:NatureNode):boolean{return this===node||this.children.some(child=>child.contains(node));}
  insertBefore(node:NatureNode,reference:NatureNode|null){node.remove();node.parentElement=this;const index=reference?this.children.indexOf(reference):-1;if(index<0)this.children.push(node);else this.children.splice(index,0,node);return node;}
  append(...nodes:NatureNode[]){nodes.forEach(node=>this.insertBefore(node,null));}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;this.connected=false;}
  matches(selector:string){
    const tag=selector.match(/^[a-z]+/)?.[0],cls=selector.match(/\.([\w-]+)/)?.[1],attribute=selector.match(/\[([^=]+)="([^"]+)"\]/);
    return (!tag||this.tagName===tag)&&(!cls||this.attributes.class?.split(' ').includes(cls))&&(!attribute||this.getAttribute(attribute[1])===attribute[2]);
  }
  querySelectorAll(selector:string):NatureNode[]{return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector:string):NatureNode|null{return this.querySelectorAll(selector)[0]??null;}
}
class ImageStub {
  src='';alt='';decoding='';onload:null|(()=>void)=null;onerror:null|(()=>void)=null;
  decode=vi.fn(()=>Promise.resolve());
}
const dom=(node:NatureNode)=>node as unknown as HTMLElement;
function setup(area:'flowers'|'pond'|'shelter'='flowers',phase=2,count=3,renderer='painted-v4'){
  const document={createElementNS:(_namespace:string,tag:string)=>new NatureNode(document as unknown as Document,tag)} as unknown as Document;
  const node=(tag:string,attributes:Record<string,string>={})=>{const result=new NatureNode(document,tag);Object.assign(result.attributes,attributes);return result;};
  const picture=node('div',{class:'garden-picture'}),art=node('svg',{class:'garden-art','data-renderer':renderer,...(area==='flowers'?{'data-stage':'5'}:{'data-space':area,'data-phase':String(phase)})});
  picture.connected=true;picture.append(art);
  const sources:NatureNode[]=[],parents:NatureNode[]=[];
  if(area==='flowers')for(let i=0;i<count;i++){
    const outer=node('g',{transform:`translate(${[189,282,351,400][i]} ${[107,191,101,100][i]}) rotate(${i*20-15})`}),parent=node('g',{class:'garden-painted-butterfly'});
    const source=node('image',{'data-garden-structure-image':'butterfly',href:'/assets/garden-structures-v1/butterfly.webp',x:'-20',y:'-18',width:'40',height:'36',preserveAspectRatio:'xMidYMid meet'});
    art.append(outer);outer.append(parent);parent.append(source);sources.push(source);parents.push(parent);
  }else{
    art.append(node('ellipse',{id:'shadow'}));
    const source=node('image',{'data-garden-structure-image':area==='pond'&&phase===2?'pond-base':'pond-foundation',href:`/assets/garden-structures-v1/${area==='pond'&&phase===2?'pond-base':'pond-foundation'}.webp`,x:'151',y:'110',width:'296',height:'148',preserveAspectRatio:'xMidYMid meet'});
    art.append(source,node('image',{'data-garden-structure-image':'lily'}),node('image',{'data-garden-structure-image':'lily'}));sources.push(source);parents.push(art);
  }
  const foreground=node('svg',{class:'garden-structure-foreground'}),button=node('button',{id:'garden-activity-ripples',width:'44',height:'44'});picture.append(foreground,button);
  const images:ImageStub[]=[],createImage=()=>{const image=new ImageStub();images.push(image);return image as unknown as HTMLImageElement;};
  const nature=createGardenNature(dom(picture),createImage);
  return {picture,art,sources,parents,foreground,button,images,createImage,nature,node};
}
async function settle(){for(let i=0;i<10;i++)await Promise.resolve();}
async function load(images:ImageStub[]){images.forEach(image=>image.onload?.());await settle();}
const rigs=(h:ReturnType<typeof setup>)=>h.picture.querySelectorAll('.garden-nature-butterfly');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('실제 정원 한 곳의 자연 모션 표시 소유권',()=>{
  it('원본3개를 보존하고 자산1개 decode 뒤 최대6날개군·고정 몸통을 같은 부모에 붙입니다',async()=>{
    const h=setup(),originals=h.sources.map(source=>({...source.attributes})),transforms=h.parents.map(parent=>parent.parentElement!.attributes.transform);
    expect(h.images).toHaveLength(1);expect(h.images[0].src).toBe('/assets/garden-structures-v1/butterfly.webp');
    h.nature.setActive(true);expect(h.picture.dataset).toEqual({natureActive:'true'});expect(rigs(h)).toEqual([]);
    await load(h.images);expect(h.images[0].decode).toHaveBeenCalledOnce();expect(h.picture.dataset).toEqual({natureActive:'true',natureReady:'true'});
    expect(rigs(h)).toHaveLength(3);
    for(let i=0;i<3;i++){
      const rig=rigs(h)[i];expect(h.parents[i].children).toEqual([rig,h.sources[i]]);
      expect(rig.attributes).toMatchObject({x:'-20',y:'-18',width:'40',height:'36',viewBox:'0 0 128 128',preserveAspectRatio:'xMidYMid meet','aria-hidden':'true'});
      expect(rig.innerHTML.match(/class="garden-nature-wing"/g)).toHaveLength(2);expect(rig.innerHTML.match(/data-garden-nature-fixed="body-and-antennae"/g)).toHaveLength(1);
      expect(rig.innerHTML).toContain('translate(60 66) rotate(24.443954780416536)');
      for(const [key,value] of Object.entries(originals[i]))expect(h.sources[i].getAttribute(key)).toBe(value);
      expect(h.sources[i].getAttribute('data-garden-nature-source')).not.toBeNull();
    }
    expect(h.parents.map(parent=>parent.parentElement!.attributes.transform)).toEqual(transforms);
    expect(h.foreground.parentElement).toBe(h.picture);expect(h.button.attributes).toMatchObject({width:'44',height:'44'});
  });
  it('정상 해독의 늦은 완료는 비활성을 켜지 않으며 토글은 같은 rig를 재사용합니다',async()=>{
    const h=setup();let complete!:()=>void;h.images[0].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    h.nature.setActive(true);h.images[0].onload!();await settle();h.nature.setActive(false);complete();await settle();
    const first=rigs(h);expect(first).toHaveLength(3);expect(h.picture.dataset).toEqual({natureActive:'false',natureReady:'true'});
    h.nature.setActive(true);h.nature.setActive(false);expect(rigs(h)).toEqual(first);expect(h.images).toHaveLength(1);expect(h.images[0].decode).toHaveBeenCalledOnce();
  });
  it.each(['load','decode','create'] as const)('%s 실패는 원본과 버튼·전경을 보존하고 반복 요청하지 않습니다',async mode=>{
    const h=setup();
    if(mode==='load')h.images[0].onerror!();else if(mode==='decode'){h.images[0].decode.mockRejectedValueOnce(new Error('decode'));h.images[0].onload!();}
    else {h.nature.dispose();const create=vi.fn(()=>{throw new Error('create');});h.nature=createGardenNature(dom(h.picture),create);expect(create).toHaveBeenCalledOnce();}
    await settle();h.nature.setActive(true);h.nature.setActive(false);expect(rigs(h)).toEqual([]);expect(h.picture.dataset.natureReady).toBeUndefined();
    expect(h.sources.every(source=>!source.hasAttribute('data-garden-nature-source'))).toBe(true);expect(h.parents.every((parent,i)=>parent.children[0]===h.sources[i])).toBe(true);
    expect(h.foreground.parentElement).toBe(h.picture);expect(h.button.parentElement).toBe(h.picture);expect(h.images).toHaveLength(1);
  });
  it('완성 연못만 base 뒤·수련 앞에355/193 물결2개를 두고 다리·44px 버튼을 건드리지 않습니다',async()=>{
    const h=setup('pond'),before=h.art.children.slice(),foreground=h.foreground;
    expect(h.images).toHaveLength(1);expect(h.images[0].src).toBe('/assets/garden-structures-v1/pond-base.webp');
    h.nature.setActive(true);await load(h.images);const water=h.art.children[2];
    expect(water.getAttribute('class')).toBe('garden-nature-water');expect(water.innerHTML.match(/<ellipse /g)).toHaveLength(2);expect(water.innerHTML.match(/cx="355" cy="193" rx="18" ry="4"/g)).toHaveLength(2);
    expect(h.art.children).toEqual([before[0],before[1],water,...before.slice(2)]);expect(h.picture.children).toEqual([h.art,foreground,h.button]);
    expect(h.sources[0].hasAttribute('data-garden-nature-source')).toBe(false);h.nature.dispose();expect(h.art.children).toEqual(before);expect(h.picture.dataset).toEqual({});
  });
  it.each(['load','decode'] as const)('연못 %s 실패에는 물결 없이 정지 원본만 유지합니다',async mode=>{
    const h=setup('pond'),before=h.art.children.slice();h.nature.setActive(true);
    if(mode==='load')h.images[0].onerror!();else{h.images[0].decode.mockRejectedValueOnce(new Error('decode'));h.images[0].onload!();}await settle();
    expect(h.art.children).toEqual(before);expect(h.picture.dataset.natureReady).toBeUndefined();expect(h.images).toHaveLength(1);
  });
  it.each([['pond',0,'painted-v4'],['pond',1,'painted-v4'],['shelter',2,'painted-v4'],['flowers',2,'legacy']] as const)('%s phase%s/%s와 미배치 꽃밭은 자산을 해독하지 않습니다',(area,phase,renderer)=>{
    const h=setup(area,phase,3,renderer);h.nature.setActive(true);expect(h.images).toEqual([]);expect(h.picture.dataset.natureReady).toBeUndefined();
    const empty=setup('flowers',2,0);empty.nature.setActive(true);expect(empty.images).toEqual([]);
  });
  it('소스가4개여도 나비3마리·6날개군 상한을 넘지 않습니다',async()=>{
    const h=setup('flowers',2,4);await load(h.images);expect(rigs(h)).toHaveLength(3);expect(h.sources[3].hasAttribute('data-garden-nature-source')).toBe(false);
  });
  it.each(['picture','source','parent','href','geometry','foreign-marker','phase','art'] as const)('decode 사이 %s가 바뀌면 옛 slot에 붙이거나 원본을 숨기지 않습니다',async mode=>{
    const h=setup(mode==='phase'?'pond':'flowers');let complete!:()=>void;
    h.images[0].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));h.images[0].onload!();await settle();
    if(mode==='picture')h.picture.connected=false;
    if(mode==='source')h.sources.forEach(source=>source.remove());
    if(mode==='parent')h.sources.forEach(source=>h.art.append(source));
    if(mode==='href')h.sources.forEach(source=>source.setAttribute('href','/foreign.webp'));
    if(mode==='geometry')h.sources.forEach(source=>source.setAttribute('width','20'));
    if(mode==='foreign-marker')h.sources.forEach(source=>source.setAttribute('data-garden-nature-source','foreign'));
    if(mode==='phase')h.art.setAttribute('data-phase','1');
    if(mode==='art')h.picture.insertBefore(h.node('svg',{class:'garden-art','data-renderer':'painted-v4','data-stage':'5'}),h.art);
    complete();await settle();expect(rigs(h)).toHaveLength(0);expect(h.picture.querySelectorAll('.garden-nature-water')).toEqual([]);expect(h.picture.dataset.natureReady).toBeUndefined();
    if(mode==='foreign-marker')expect(h.sources.every(source=>source.getAttribute('data-garden-nature-source')==='foreign')).toBe(true);
  });
  it('한 slot의 foreign marker는 다른2개가ready여도 원본 교체 관계에 포함하지 않습니다',async()=>{
    const h=setup();h.sources[0].setAttribute('data-garden-nature-source','foreign');h.nature.setActive(true);await load(h.images);
    expect(rigs(h)).toHaveLength(2);expect(h.picture.dataset.natureReady).toBe('true');expect(h.parents[0].children).toEqual([h.sources[0]]);
    for(let i=1;i<3;i++)expect(h.parents[i].children[0].nextSibling).toBe(h.sources[i]);
    expect(h.sources[0].getAttribute('data-garden-nature-source')).toBe('foreign');h.nature.dispose();expect(h.sources[0].getAttribute('data-garden-nature-source')).toBe('foreign');
  });
  it('rig와 원본 사이 foreign 삽입은 원본 교체를 해제하고 foreign node를 보존합니다',async()=>{
    const h=setup();await load(h.images);const foreign=h.node('g',{class:'foreign'});h.parents[0].insertBefore(foreign,h.sources[0]);h.nature.setActive(true);
    expect(rigs(h)).toHaveLength(2);expect(h.parents[0].children).toEqual([foreign,h.sources[0]]);expect(h.sources[0].hasAttribute('data-garden-nature-source')).toBe(false);
  });
  it('잘못된 원본 크기나 foreign marker는 생성 전부터 관측 대상으로 삼지 않습니다',()=>{
    const h=setup();h.nature.dispose();h.sources.forEach(source=>source.setAttribute('width','41'));
    h.nature=createGardenNature(dom(h.picture),h.createImage);expect(h.images).toHaveLength(1);h.nature.dispose();
    h.sources.forEach(source=>{source.setAttribute('width','40');source.setAttribute('data-garden-nature-source','foreign');});
    createGardenNature(dom(h.picture),h.createImage);expect(h.images).toHaveLength(1);
  });
  it('dispose 뒤 보관된 load/미완료 decode는 원본과 새 controller를 되살리거나 덮지 않습니다',async()=>{
    const unloaded=setup(),late=unloaded.images[0].onload!;unloaded.nature.dispose();late();await settle();expect(unloaded.images[0].decode).not.toHaveBeenCalled();expect(rigs(unloaded)).toEqual([]);
    const h=setup();let complete!:()=>void;h.images[0].decode.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));h.images[0].onload!();await settle();
    const replacement=createGardenNature(dom(h.picture),h.createImage);replacement.setActive(true);await load(h.images.slice(1));const fresh=rigs(h);
    h.nature.setActive(false);h.nature.dispose();complete();await settle();expect(rigs(h)).toEqual(fresh);expect(h.picture.dataset).toEqual({natureActive:'true',natureReady:'true'});
    expect(h.images[0].onload).toBeNull();expect(h.images[0].onerror).toBeNull();replacement.dispose();expect(h.picture.dataset).toEqual({});
  });
  it('재생성의 clip ID는 서로 고유하며 소유 node/marker만 정리합니다',async()=>{
    const h=setup(),other=setup();await load(h.images);await load(other.images);const previous=rigs(h),unrelated=h.node('g',{class:'foreign-decoration'});h.parents[0].append(unrelated);
    const replacement=createGardenNature(dom(h.picture),h.createImage);await load(h.images.slice(1));const fresh=rigs(h),otherRigs=rigs(other);
    const ids=[...previous,...fresh,...otherRigs].flatMap(rig=>[...rig.innerHTML.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));expect(new Set(ids).size).toBe(ids.length);expect(ids).toHaveLength(45);
    h.sources[0].setAttribute('data-garden-nature-source','foreign');replacement.dispose();replacement.dispose();expect(rigs(h)).toEqual([]);expect(h.parents[0].children).toContain(unrelated);
    expect(h.sources[0].getAttribute('data-garden-nature-source')).toBe('foreign');expect(rigs(other)).toEqual(otherRigs);expect(other.picture.dataset.natureReady).toBe('true');
  });
  it('활성 뒤 없어진 slot은 원본을 다시 보이게 하고 붙어 있던 자신의 rig만 회수합니다',async()=>{
    const h=setup();await load(h.images);h.nature.setActive(true);const original=h.sources[0];original.setAttribute('width','41');h.nature.setActive(false);
    expect(rigs(h)).toHaveLength(2);expect(original.hasAttribute('data-garden-nature-source')).toBe(false);expect(original.getAttribute('width')).toBe('41');expect(h.picture.dataset.natureActive).toBe('false');
  });
  it.each(['prune','dispose'] as const)('재부모화된 자신의 rig·표시는 %s에서 회수하고 원본·foreign 형제는 보존합니다',async mode=>{
    const h=setup();await load(h.images);h.nature.setActive(true);
    const own=rigs(h)[0],source=h.sources[0],foreign=h.node('g',{class:'foreign-parent'}),sibling=h.node('path',{class:'foreign-sibling'});
    h.art.append(foreign);foreign.append(own,source,sibling);
    if(mode==='prune')h.nature.setActive(true);else h.nature.dispose();
    expect(own.parentElement).toBeNull();expect(source.hasAttribute('data-garden-nature-source')).toBe(false);
    expect(foreign.children).toEqual([source,sibling]);expect(source.parentElement).toBe(foreign);
    expect(rigs(h)).toHaveLength(mode==='prune'?2:0);
  });
  it('부분 DOM 삽입 실패도 원본을 숨기지 않고 나머지 소유 표시를 안전히 정리합니다',async()=>{
    const h=setup();vi.spyOn(h.parents[1],'insertBefore').mockImplementation(()=>{throw new Error('insert');});await load(h.images);
    expect(rigs(h)).toHaveLength(2);expect(h.sources[1].hasAttribute('data-garden-nature-source')).toBe(false);h.nature.dispose();expect(rigs(h)).toEqual([]);expect(h.sources.every(source=>!source.hasAttribute('data-garden-nature-source'))).toBe(true);
  });
  it('반복 활성·폐기에 timer/RAF/RNG·원본 교체가 없고 다른 정원을 변경하지 않습니다',async()=>{
    const timer=vi.spyOn(globalThis,'setTimeout'),random=vi.spyOn(Math,'random'),raf=vi.fn();vi.stubGlobal('requestAnimationFrame',raf);
    const h=setup(),other=setup('pond'),sourceBefore=h.sources.map(source=>JSON.stringify(source.attributes));await load(h.images);await load(other.images);
    h.nature.setActive(true);h.nature.setActive(false);h.nature.dispose();h.nature.dispose();h.nature.setActive(true);
    expect(h.sources.map(source=>JSON.stringify(source.attributes))).toEqual(sourceBefore);expect(h.picture.dataset).toEqual({});expect(other.picture.dataset.natureReady).toBe('true');
    expect(timer).not.toHaveBeenCalled();expect(random).not.toHaveBeenCalled();expect(raf).not.toHaveBeenCalled();
  });
});
