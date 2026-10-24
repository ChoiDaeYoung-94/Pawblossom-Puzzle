import {bindPracticeBoard} from '../../bindPracticeInputs';
import {CarrierEngine,type CarrierFrame,type Grid,type Position} from './CarrierEngine';
import {carrierScenarios} from './carrierScenarios';

type Language='ko'|'en';
const kinds=['strawberry','carrot','leaf','blueberry','acorn','flower'] as const;
const names={ko:['딸기','당근','잎사귀','블루베리','도토리','꽃'],en:['Strawberry','Carrot','Leaf','Blueberry','Acorn','Flower']};
const copy={
  ko:{title:'씨앗 배달',back:'원래 게임으로',trial:'새 목표 체험',note:'이 체험은 진행·재화에 반영되지 않아요.',
    scenario:'정원 길 고르기',moves:'남은 이동',goal:'배달한 꾸러미',restart:'처음부터',hint:'교환 힌트',
    rule:'같은 블록 3개를 맞춰 꾸러미를 출구로 내려 주세요.',carrier:'씨앗 꾸러미',exit:'출구',
    keyboard:'방향키로 이동 · Enter/Space로 선택·교환 · Esc로 선택 취소',select:'선택됨',row:'행',col:'열',
    playing:'꾸러미 아래의 블록부터 살펴보세요.',won:'씨앗이 도착했어요!',lost:'이동을 모두 사용했어요.',
    blocked:'더 바꿀 수 있는 블록이 없어요.',again:'처음부터 다른 길을 찾아보세요.',
    invalid:'교환한 블록으로 3매치를 만들어 주세요.',cap:'연쇄가 길어 이번 교환은 취소했어요. 판과 이동은 그대로예요.',
    chain:'연쇄',choose:'다른 길도 둘러보세요.',hintReady:'빛나는 두 칸을 서로 바꿔보세요.',tabs:['첫 배달','옆으로','갈림길']},
  en:{title:'Seed delivery',back:'Back to the game',trial:'New goal trial',note:'This trial does not change progress or currency.',
    scenario:'Choose a garden path',moves:'Moves',goal:'Parcels delivered',restart:'Restart',hint:'Swap hint',
    rule:'Match three tiles to bring parcels down to the exits.',carrier:'Seed parcel',exit:'Exit',
    keyboard:'Arrow keys to move · Enter/Space to select or swap · Esc to cancel',select:'Selected',row:'Row',col:'column',
    playing:'Look for matches beneath the parcels.',won:'The seeds have arrived!',lost:'No moves left.',
    blocked:'There are no matching swaps left.',again:'Restart and try another path.',
    invalid:'Make a match of three with the swapped tiles.',cap:'That chain was too long. The swap was cancelled; your board and moves are unchanged.',
    chain:'Cascade',choose:'Try another garden path, too.',hintReady:'Swap the two glowing cells.',tabs:['First drop','Side step','Two paths']},
};
/** 자체 벡터 꾸러미입니다. 몸통은 고정하고 잎 두 장만 대기 중에 움직입니다. */
const parcelArt=()=>`<svg viewBox="0 0 100 108" aria-hidden="true" focusable="false"><path d="M50 36C31 23 26 8 30 5C49 8 56 20 50 36" class="parcel-leaf parcel-leaf-left" fill="#76a545" stroke="#376044" stroke-width="3"/><path d="M49 34C48 18 66 3 75 8C78 23 64 35 49 34" class="parcel-leaf parcel-leaf-right" fill="#9abb50" stroke="#376044" stroke-width="3"/><path d="M34 31Q50 22 66 31L61 42C86 55 91 91 73 98Q50 107 27 98C9 91 14 55 39 42Z" fill="#e6bd70" stroke="#765c35" stroke-width="4"/><path d="M27 58Q23 81 32 91" fill="none" stroke="#f7dea7" stroke-width="6" stroke-linecap="round"/><path d="M36 39Q50 45 64 39M39 46L61 47" fill="none" stroke="#896e40" stroke-width="4" stroke-linecap="round"/><path d="M39 74Q49 58 63 64Q62 82 44 83Z" fill="#789746" stroke="#46633c" stroke-width="2"/><path d="M44 80L57 69" stroke="#e4eab0" stroke-width="2"/></svg>`;
const positionKey=(p:Position)=>`${p.row}:${p.col}`;
const same=(a:Position,b:Position)=>a.row===b.row&&a.col===b.col;

export function mountCarrierTrial(root:HTMLElement,initialLanguage:Language){
  let language=initialLanguage,index=0,engine=new CarrierEngine(carrierScenarios[0].level);
  let selected:Position|undefined,hinted:Position[]=[],busy=false,disposed=false,epoch=0,focused=document.hasFocus(),externalActive=true;
  let boardRows=engine.snapshot.board.length,boardCols=engine.snapshot.board[0].length;
  let binding:ReturnType<typeof bindPracticeBoard>|undefined;
  const animations=new Set<Animation>(),pieces=new Map<string,HTMLElement>(),buttons=new Map<string,HTMLButtonElement>();
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const text=()=>copy[language];
  root.className='carrier-trial';
  root.innerHTML=`<header class="trial-header"><a class="trial-back" href="/#map"></a><div class="trial-brand"><strong>Pawblossom Puzzle</strong><small class="trial-header-note"></small></div><select class="trial-language" aria-label="Language"><option value="ko">한국어</option><option value="en">English</option></select></header><section class="trial-shell"><div class="trial-heading"><span class="trial-eyebrow"></span><h1></h1><p class="trial-note"></p></div><nav class="trial-paths"></nav><section class="trial-play"><div class="trial-details"><h2 id="trial-scenario-title"></h2><p class="trial-description"></p><div class="trial-stats"><div><span class="trial-moves-label"></span><strong class="trial-moves"></strong></div><div><span class="trial-goal-label"></span><strong class="trial-goal"></strong></div></div><p class="trial-rule"></p><p class="trial-keyboard" id="trial-keyboard"></p><div class="trial-actions"><button class="trial-restart" type="button"></button><button class="trial-hint" type="button"></button></div><div class="trial-message" role="status" aria-live="polite"></div></div><div class="trial-board-wrap"><div class="trial-board" role="group" aria-describedby="trial-keyboard" aria-labelledby="trial-scenario-title"><div class="trial-cells"></div><div class="trial-pieces" aria-hidden="true"></div></div><div class="trial-result" tabindex="-1" hidden></div></div></section></section>`;
  const find=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
  const board=find('.trial-board'),cellLayer=find('.trial-cells'),pieceLayer=find('.trial-pieces');
  const languageControl=find<HTMLSelectElement>('.trial-language'),restart=find<HTMLButtonElement>('.trial-restart'),hint=find<HTMLButtonElement>('.trial-hint');
  languageControl.value=language;
  const announce=(message:string)=>{find('.trial-message').textContent=message;};
  function cancelAnimations(){epoch++;for(const animation of animations)animation.cancel();animations.clear();binding?.cancel();}
  function animate(element:HTMLElement,keyframes:Keyframe[],duration:number){
    if(reduced.matches||document.hidden||!focused||!element.animate)return Promise.resolve();
    const animation=element.animate(keyframes,{duration,easing:'cubic-bezier(.2,.7,.3,1)',fill:'none'});
    animations.add(animation);
    return animation.finished.catch(()=>{}).finally(()=>animations.delete(animation));
  }
  function place(element:HTMLElement,p:Position){
    element.style.left=`${p.col/boardCols*100}%`;
    element.style.top=`${p.row/boardRows*100}%`;
    element.dataset.row=String(p.row);element.dataset.col=String(p.col);
  }
  function renderPieces(grid:Grid){
    const present=new Set<string>();
    grid.forEach((row,r)=>row.forEach((cell,c)=>{
      if(!cell)return;present.add(cell.id);
      let element=pieces.get(cell.id);
      if(!element){
        element=document.createElement('div');element.className=`trial-piece ${cell.type==='carrier'?'trial-parcel':''}`;
        element.dataset.pieceId=cell.id;
        if(cell.type==='carrier')element.innerHTML=parcelArt();
        else{const image=document.createElement('img');image.src=`/assets/tiles-v3/${kinds[cell.color]}.webp`;image.alt='';image.draggable=false;element.append(image);}
        pieceLayer.append(element);pieces.set(cell.id,element);
      }
      place(element,{row:r,col:c});
    }));
    for(const [id,element] of pieces)if(!present.has(id)){element.remove();pieces.delete(id);}
  }
  function updateLabels(){
    const t=text(),state=engine.snapshot,scenario=carrierScenarios[index];
    document.documentElement.lang=language;
    document.title=`Pawblossom Puzzle · ${t.title}`;
    find('.trial-back').textContent=`‹ ${t.back}`;find('.trial-eyebrow').textContent=t.trial;
    find('h1').textContent=t.title;find('.trial-note').textContent=t.note;find('.trial-header-note').textContent=t.note;
    find('.trial-paths').setAttribute('aria-label',t.scenario);languageControl.setAttribute('aria-label',language==='ko'?'언어':'Language');
    find('h2').textContent=scenario.title[language];find('.trial-description').textContent=scenario.description[language];
    find('.trial-moves-label').textContent=t.moves;find('.trial-goal-label').textContent=t.goal;
    find('.trial-moves').textContent=String(state.movesRemaining);
    find('.trial-goal').textContent=`${state.delivered.length} / ${state.initialCarrierIds.length}`;
    find('.trial-rule').textContent=t.rule;find('.trial-keyboard').textContent=t.keyboard;
    restart.textContent=t.restart;hint.textContent=t.hint;hint.disabled=busy||state.status!=='playing';
    languageControl.disabled=busy;root.classList.toggle('is-busy',busy);board.setAttribute('aria-busy',String(busy));
    const result=find('.trial-result');result.hidden=state.status==='playing'||busy;
    if(!result.hidden)result.textContent=`${t[state.status as 'won'|'lost'|'blocked']} ${state.status==='won'?t.choose:t.again}`;
    for(const [key,button] of buttons){
      const [row,col]=key.split(':').map(Number),p={row,col},cell=state.board[row][col];
      const name=cell?.type==='carrier'?t.carrier:cell?.type==='tile'?names[language][cell.color]:'';
      const exit=state.exits.some(e=>same(e,p));
      const coordinate=language==='ko'?`${row+1}${t.row} ${col+1}${t.col}`:`${t.row} ${row+1}, ${t.col} ${col+1}`;
      button.setAttribute('aria-label',`${coordinate}: ${name}${exit?` · ${t.exit}`:''}${selected&&same(selected,p)?` · ${t.select}`:''}`);
      button.classList.toggle('is-selected',Boolean(selected&&same(selected,p)));
      button.classList.toggle('is-hinted',hinted.some(h=>same(h,p)));
      button.setAttribute('aria-disabled',String(busy||state.status!=='playing'));
    }
    root.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button,i)=>{
      button.textContent=`${i+1}. ${t.tabs[i]}`;button.setAttribute('aria-pressed',String(index===i));
    });
  }
  function showStable(){renderPieces(engine.snapshot.board);updateLabels();}
  function finishVisuals(){
    if(disposed)return;
    cancelAnimations();busy=false;selected=undefined;hinted=[];showStable();
    const status=engine.snapshot.status;announce(status==='playing'?text().playing:text()[status]);
  }
  function focusCell(p:Position){
    for(const button of buttons.values())button.tabIndex=-1;
    const button=buttons.get(positionKey(p));if(button){button.tabIndex=0;button.focus({preventScroll:true});}
  }
  async function playFrame(frame:CarrierFrame,active:number){
    const duration=frame.cascade>4?90:frame.kind==='fall'?235:frame.kind==='exit'?260:155;
    if(frame.kind==='clear'||frame.kind==='exit'){
      const targets=frame.kind==='clear'?frame.removed:frame.deliveries;
      await Promise.allSettled(targets.map(item=>{
        const element=pieces.get(item.id);if(!element)return Promise.resolve();
        return animate(element,frame.kind==='exit'?[{transform:'translateY(0) scale(1)',opacity:1},{transform:'translateY(50%) scale(.8)',opacity:0}]
          :[{transform:'scale(1)',opacity:1},{transform:'scale(1.18)',opacity:1,offset:.3},{transform:'scale(.2)',opacity:0}],duration);
      }));
      if(epoch!==active||disposed)return;
      renderPieces(frame.board);find('.trial-goal').textContent=`${frame.delivered.length} / ${engine.snapshot.initialCarrierIds.length}`;
    }else{
      const before=new Set(pieces.keys());renderPieces(frame.board);
      const state=engine.snapshot;
      await Promise.allSettled(frame.motions.map(m=>{
        const element=pieces.get(m.id);if(!element)return Promise.resolve();
        const dx=(m.from.col-m.to.col)*board.clientWidth/state.board[0].length,dy=(m.from.row-m.to.row)*board.clientHeight/state.board.length;
        return animate(element,[{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],duration);
      }).concat(frame.kind==='refill'?[...pieces].filter(([id])=>!before.has(id)).map(([,element])=>animate(element,[{opacity:0,transform:'scale(.7)'},{opacity:1,transform:'scale(1)'}],duration)):[]));
    }
    if(frame.kind==='clear'&&frame.cascade>1&&epoch===active)announce(`${text().chain} ${frame.cascade}`);
  }
  function usable(){return !disposed&&!busy&&!document.hidden&&focused&&externalActive&&engine.snapshot.status==='playing';}
  async function swap(a:Position,b:Position){
    if(!usable())return;
    const result=engine.swap(a,b);selected=undefined;hinted=[];
    if(!result.valid){updateLabels();announce(result.reason==='resolution-cap'?text().cap:text().invalid);focusCell(a);return;}
    cancelAnimations();const active=epoch;busy=true;updateLabels();
    // 모델이 확정됐더라도 배송 표시는 실제 exit 단계에 도착한 뒤 갱신합니다.
    find('.trial-goal').textContent=`${result.frames[0].delivered.length} / ${result.state.initialCarrierIds.length}`;
    try{
      for(const frame of result.frames){if(disposed||epoch!==active)return;await playFrame(frame,active);}
    }finally{
      if(!disposed&&epoch===active){
        busy=false;showStable();announce(result.state.status==='playing'?text().playing:text()[result.state.status]);
        if(result.state.status==='playing')focusCell(b);else find('.trial-result').focus({preventScroll:true});
      }
    }
  }
  function tap(p:Position){
    if(!usable())return;
    if(selected&&!same(selected,p)&&Math.abs(selected.row-p.row)+Math.abs(selected.col-p.col)===1){void swap(selected,p);return;}
    selected=selected&&same(selected,p)?undefined:p;hinted=[];updateLabels();focusCell(p);
  }
  function setupBoard(){
    binding?.dispose();buttons.clear();pieces.clear();cellLayer.replaceChildren();pieceLayer.replaceChildren();
    const state=engine.snapshot,rows=state.board.length,cols=state.board[0].length;
    boardRows=rows;boardCols=cols;
    board.style.setProperty('--rows',String(rows));board.style.setProperty('--cols',String(cols));board.style.aspectRatio=`${cols}/${rows}`;
    state.mask.forEach((row,r)=>row.forEach((active,c)=>{
      if(!active)return;
      const button=document.createElement('button');button.type='button';button.className='trial-cell';button.dataset.row=String(r);button.dataset.col=String(c);
      if(state.exits.some(exit=>exit.row===r&&exit.col===c)){button.classList.add('trial-exit');button.innerHTML='<span aria-hidden="true">↓</span>';}
      place(button,{row:r,col:c});button.tabIndex=-1;cellLayer.append(button);buttons.set(positionKey({row:r,col:c}),button);
    }));
    binding=bindPracticeBoard(cellLayer,{tap,swipe(p,dx,dy){
      const to={row:p.row+(Math.abs(dy)>Math.abs(dx)?Math.sign(dy):0),col:p.col+(Math.abs(dx)>=Math.abs(dy)?Math.sign(dx):0)};
      void swap(p,to);
    }});
    const first=buttons.values().next().value as HTMLButtonElement|undefined;if(first)first.tabIndex=0;
    showStable();
  }
  function startScenario(next:number,focus=true){
    cancelAnimations();index=next;engine=new CarrierEngine(carrierScenarios[index].level);selected=undefined;hinted=[];busy=false;
    setupBoard();announce(text().playing);if(focus){const first=buttons.keys().next().value as string;const [row,col]=first.split(':').map(Number);focusCell({row,col});}
  }
  carrierScenarios.forEach((_,i)=>{
    const button=document.createElement('button');button.type='button';button.dataset.scenario=String(i);button.onclick=()=>startScenario(i);find('.trial-paths').append(button);
  });
  restart.onclick=()=>startScenario(index);
  hint.onclick=()=>{
    if(!usable())return;
    const legal=engine.legalMoves(),authored=carrierScenarios[index].authoredPath;
    const move=legal.find(move=>authored.some(p=>same(move.a,p.a)&&same(move.b,p.b)||same(move.a,p.b)&&same(move.b,p.a)))??legal[0];if(!move)return;
    hinted=[move.a,move.b];selected=undefined;updateLabels();announce(text().hintReady);focusCell(move.a);
  };
  languageControl.onchange=()=>{language=languageControl.value==='en'?'en':'ko';updateLabels();const status=engine.snapshot.status;announce(status==='playing'?text().playing:text()[status]);};
  cellLayer.onkeydown=event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-row]');if(!button)return;
    const p={row:Number(button.dataset.row),col:Number(button.dataset.col)};
    if(event.key==='Escape'){selected=undefined;hinted=[];binding?.cancel();updateLabels();return;}
    const direction=event.key==='ArrowUp'?[-1,0]:event.key==='ArrowDown'?[1,0]:event.key==='ArrowLeft'?[0,-1]:event.key==='ArrowRight'?[0,1]:undefined;
    if(!direction)return;event.preventDefault();if(busy)return;
    let target={row:p.row+direction[0],col:p.col+direction[1]},state=engine.snapshot;
    while(target.row>=0&&target.row<state.board.length&&target.col>=0&&target.col<state.board[0].length){
      if(buttons.has(positionKey(target))){focusCell(target);return;}
      target={row:target.row+direction[0],col:target.col+direction[1]};
    }
  };
  const visibility=()=>{root.toggleAttribute('data-suspended',document.hidden||!focused||!externalActive);if(document.hidden||!externalActive)finishVisuals();};
  const blur=()=>{focused=false;finishVisuals();visibility();};
  const focus=()=>{focused=true;visibility();};
  const resize=()=>finishVisuals();
  const observer=new ResizeObserver(()=>{
    const available=find('.trial-board-wrap'),size=Math.max(0,Math.min(570,available.clientWidth,available.clientHeight));
    if(!size)return;
    if(board.style.width!==`${size}px`){if(busy)finishVisuals();board.style.width=`${size}px`;board.style.height=`${size}px`;}
  });
  document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);window.addEventListener('focus',focus);
  window.addEventListener('resize',resize);reduced.addEventListener('change',resize);
  setupBoard();announce(text().playing);visibility();observer.observe(find('.trial-board-wrap'));
  return {setActive(active:boolean){if(disposed)return;externalActive=active;visibility();},dispose(){
    if(disposed)return;disposed=true;cancelAnimations();binding?.dispose();
    root.setAttribute('data-suspended','');for(const button of buttons.values())button.classList.remove('is-hinted');
    document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);
    window.removeEventListener('resize',resize);reduced.removeEventListener('change',resize);cellLayer.onkeydown=null;
    observer.disconnect();
    restart.onclick=hint.onclick=null;languageControl.onchange=null;
    root.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button=>button.onclick=null);
  }};
}
