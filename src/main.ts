import Phaser from 'phaser';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/fraunces/latin-600.css';
import './style.css';
import { BoardScene,tileNames } from './BoardScene';
import { AudioManager } from './audio/AudioManager';
import { loadSave,saveData,clearSave,levels } from './state';
import { t,type TextKey } from './i18n';
import { icon } from './icons';

let save=loadSave(), currentLevel=save.highestLevel, moves=0, score=0, collected=Array(6).fill(0) as number[], shuffles=1;
let scene:BoardScene, game:Phaser.Game, route='puzzle', toastTimer:ReturnType<typeof setTimeout>;
let resultTimer:ReturnType<typeof setTimeout>|undefined;
let round=0;
const audio=new AudioManager();audio.setMusicEnabled(save.music);audio.setSfxEnabled(save.sfx);
const text=(key:TextKey)=>t(save.language,key);
const label=(key:TextKey)=>`<span data-t="${key}">${text(key)}</span>`;
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
function persist(){if(!saveData(save))notice(save.language==='ko'?'기기 저장 공간을 사용할 수 없어요. 이번 진행은 앱을 닫으면 사라질 수 있어요.':'Storage is unavailable. This session’s progress may not be saved.');}

$('#app').innerHTML=`
  <header class="topbar">
    <a class="brand" href="#puzzle" aria-label="Pawblossom Puzzle"><span class="brand-mark">${icon('paw',26)}</span><span>Pawblossom<small>PUZZLE</small></span></a>
    <div class="header-right"><div class="wallet stars">${icon('star',18)}<strong id="star-count">0</strong><span class="sr-only">${text('stars')}</span></div><div class="wallet coins">${icon('coin',18)}<strong id="coin-count">0</strong><span class="sr-only">${text('coins')}</span></div><button id="language-toggle" class="language-button" aria-label="한국어 / English">${save.language==='en'?'한국어':'EN'}</button><button id="settings-button" class="icon-button" aria-label="${text('settings')}">${icon('settings',21)}</button></div>
  </header>
  <main class="workspace">
    <section class="story-panel">
      <div class="eyebrow"><span class="tiny-leaf">${icon('leaf',15)}</span>${label('chapter')}</div>
      <h1>${label('greeting')}</h1><p class="story-copy">${label('story')}</p>
      <div class="meadow-art"><img class="environment" src="/assets/meadow.png" alt=""/><div class="art-shade"></div><span class="art-label">${icon('home',15)} Blossom Meadow</span><img class="pip" src="/assets/pip.png" alt="Pip"/><span class="floating-flower f1">✦</span><span class="floating-flower f2">✧</span></div>
      <div class="friend-message"><span class="friend-avatar"><img src="/assets/pip.png" alt=""/></span><div><strong>${label('pip')}</strong><p>${label('request')}</p></div><span class="message-flower">${icon('flower',25)}</span></div>
      <div class="garden-status"><div><span>${icon('leaf',16)} ${label('garden')}</span><strong id="garden-count">0 / 5</strong></div><div class="garden-track"><i id="garden-fill"></i></div></div>
    </section>
    <section class="game-panel">
      <div id="puzzle-view" class="view">
        <div class="level-top"><div><div class="eyebrow">${label('chapter')}</div><h2><span data-t="level">${text('level')}</span> <span id="level-number">1</span><span class="level-flower">${icon('flower',21)}</span></h2></div><button id="restart" class="icon-button" aria-label="${text('restart')}">${icon('restart',20)}</button></div>
        <div class="mission-bar"><div class="moves-box"><strong id="moves">22</strong>${label('moves')}</div><div class="goal-box"><div class="goal-heading">${label('goal')}<span id="score">0</span></div><div id="goals"></div></div></div>
        <div class="board-wrap"><div id="game-canvas" aria-label="Match-3 puzzle board. Tap two neighboring tiles or swipe a tile." role="application"></div><div id="board-notice" aria-live="polite"></div></div>
        <p class="board-hint">${icon('leaf',15)} ${label('hint')}</p>
        <div class="tools"><button id="shuffle" class="shuffle-button">${icon('shuffle',20)}${label('shuffle')}<span id="shuffle-count">1</span></button><span class="tool-note">${label('shuffleHelp')}</span></div>
      </div>
      <div id="village-view" class="view" hidden></div><div id="journal-view" class="view" hidden></div><div id="settings-view" class="view" hidden></div>
      <nav class="bottom-nav" aria-label="Main navigation">${(['puzzle','village','journal'] as const).map((name,i)=>`<button data-route="${name}" class="${i===0?'active':''}" ${i===0?'aria-current="page"':''}>${icon(['puzzle','home','paw'][i],21)}${label(name)}</button>`).join('')}</nav>
    </section>
  </main>
  <footer class="page-footer"><span>${label('tagline')}</span><span>${label('prototype')}</span></footer>
  <div id="toast" role="status"></div><dialog id="result-dialog"></dialog>
`;

function updateWallet(){
  $('#star-count').textContent=String(save.stars);$('#coin-count').textContent=String(save.coins);$('#garden-count').textContent=`${save.garden} / 5`;$('#garden-fill').style.width=`${save.garden*20}%`;
}
function updateGoals(){
  const level=levels[currentLevel-1];
  $('#level-number').textContent=String(currentLevel);$('#moves').textContent=String(moves);$('#score').textContent=score.toLocaleString(save.language==='ko'?'ko-KR':'en-US');
  $('#goals').innerHTML=level.goals.map(goal=>{const remaining=Math.max(0,goal.count-collected[goal.kind]);return `<div class="goal-item ${remaining===0?'done':''}"><img src="/assets/tiles/${tileNames[goal.kind]}.svg" alt="${tileNames[goal.kind]}"/><strong>${remaining===0?icon('check',18):remaining}</strong><span class="goal-progress" style="--progress:${Math.min(100,collected[goal.kind]/goal.count*100)}%"></span></div>`;}).join('');
  $('#shuffle-count').textContent=String(shuffles);$('#shuffle').toggleAttribute('disabled',shuffles<1);
}
function startLevel(id:number){
  clearTimeout(resultTimer);resultTimer=undefined;round++;
  const activeRound=round;
  $<HTMLDialogElement>('#result-dialog').close();
  currentLevel=id;moves=levels[id-1].moves;score=0;collected=Array(6).fill(0);shuffles=1;
  game?.destroy(true);
  scene=new BoardScene({audio,onStart:()=>{void audio.unlock().catch(()=>{});},onNotice:key=>{
    $('#board-notice').textContent=text(key);$('#board-notice').classList.remove('pop');void $('#board-notice').offsetWidth;$('#board-notice').classList.add('pop');
  },onMove:(items,points)=>{
    moves--;score+=points;items.forEach((n,i)=>collected[i]+=n);updateGoals();
    const won=levels[currentLevel-1].goals.every(g=>collected[g.kind]>=g.count);
    if(won||moves<=0){scene.stopPlaying();resultTimer=setTimeout(()=>{if(activeRound===round)finish(won);},300);}
  }});
  game=new Phaser.Game({type:Phaser.AUTO,width:480,height:480,parent:'game-canvas',backgroundColor:'#dae6d7',scene:[scene],transparent:false,
    scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:true,roundPixels:false},audio:{noAudio:true},input:{activePointers:2}});
  updateGoals();
}
function notice(message:string){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3200);}
function finish(won:boolean){
  const first=won&&!save.completed.includes(currentLevel);
  if(first){save.completed.push(currentLevel);save.stars++;save.coins+=40;save.highestLevel=Math.min(10,Math.max(save.highestLevel,currentLevel+1));persist();updateWallet();renderViews();}
  audio.play(won?'win':'lose');
  const done=won&&currentLevel===10;
  const dialog=$<HTMLDialogElement>('#result-dialog');
  dialog.innerHTML=`<div class="result-content"><div class="result-badge ${won?'won':''}">${icon(won?'star':'leaf',42)}</div><div class="eyebrow">${text('level')} ${currentLevel}</div><h2>${text(done?'complete':won?'win':'lose')}</h2><p>${text(done?'completeDesc':won?'winDesc':'loseDesc')}</p>${first?`<div class="result-rewards"><span>${icon('star',20)} +1</span><span>${icon('coin',20)} +40</span></div>`:''}<button class="primary" id="result-next">${text(won?(done?'allDone':'next'):'retry')}${icon('arrow',19)}</button><button class="text-button" id="result-home">${text('home')}</button></div>`;
  dialog.showModal();
  $('#result-next').onclick=()=>{dialog.close();startLevel(won?Math.min(10,currentLevel+1):currentLevel);switchView('puzzle');};
  $('#result-home').onclick=()=>{dialog.close();switchView('village');};
}
function renderViews(){
  $('#village-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">BLOSSOM MEADOW</div><h2>${text('mapTitle')}</h2><p>${text('mapDesc')}</p></div><div class="garden-card"><div class="garden-picture"><img src="/assets/meadow.png" alt="Blossom Meadow"/><div class="planted-flowers">${Array.from({length:save.garden},(_,i)=>`<img src="/assets/tiles/flower.svg" alt="" style="left:${18+i*13}%;bottom:${12+(i%2)*12}%"/>`).join('')}</div><span class="garden-pill">${icon('flower',17)} ${save.garden} / 5</span></div><h3>${text('garden')}</h3><p>${text('gardenDesc')}</p><button class="primary" id="grow" ${save.stars<2||save.garden>=5?'disabled':''}>${icon('leaf',20)}${text(save.garden>=5?'gardenDone':'grow')}</button>${save.stars<2&&save.garden<5?`<small>${text('needStars')}</small>`:''}</div><div class="level-picker"><h3>${text('levelSelect')}</h3><div class="level-grid">${levels.map(l=>`<button data-level="${l.id}" ${l.id>save.highestLevel?'disabled':''} class="level-node ${save.completed.includes(l.id)?'completed':''}" aria-label="${text('level')} ${l.id}">${l.id>save.highestLevel?icon('lock',19):l.id}${save.completed.includes(l.id)?`<span>${icon('star',13)}</span>`:''}</button>`).join('')}</div></div>`;
  $('#journal-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">PAWBLOSSOM FRIENDS</div><h2>${text('friendsTitle')}</h2><p>${text('friendsDesc')}</p></div><div class="journal-card"><span class="friend-number">01</span><img src="/assets/pip.png" alt="Pip"/><h3>${text('pip')}</h3><p>${text('pipDesc')}</p><span class="friend-tag">${icon('leaf',15)} Blossom Meadow</span></div><div class="coming-card">${icon('paw',28)}<div><strong>${text('upcoming')}</strong><p>${text('upcomingDesc')}</p></div></div>`;
  $('#settings-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">PAWBLOSSOM PUZZLE</div><h2>${text('settingsTitle')}</h2><p>${text('settingsDesc')}</p></div><div class="settings-card"><div class="setting-row"><span>${icon('volume',22)}${text('music')}</span><button class="toggle ${save.music?'on':''}" id="music-toggle" role="switch" aria-checked="${save.music}" aria-label="${text('music')}"><i></i></button></div><div class="setting-row"><span>${icon('paw',22)}${text('sfx')}</span><button class="toggle ${save.sfx?'on':''}" id="sfx-toggle" role="switch" aria-checked="${save.sfx}" aria-label="${text('sfx')}"><i></i></button></div><div class="setting-row"><label for="language">${text('language')}</label><select id="language"><option value="en" ${save.language==='en'?'selected':''}>English</option><option value="ko" ${save.language==='ko'?'selected':''}>한국어</option></select></div><p class="sound-note">${text('soundHint')}</p></div><div class="save-note">${icon('leaf',20)}<p>${text('offline')}</p></div><button id="reset" class="text-button reset-button">${text('reset')}</button><p class="version">Pawblossom Puzzle · v0.1.0</p>`;
  $('#grow').onclick=()=>{if(save.stars<2||save.garden>=5)return;save.stars-=2;save.garden++;persist();updateWallet();renderViews();audio.play('reward');notice(text('planted'));};
  document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button=>button.onclick=()=>{if(!scene.canLeave())return;startLevel(Number(button.dataset.level));switchView('puzzle');});
  $('#music-toggle').onclick=()=>{save.music=!save.music;audio.setMusicEnabled(save.music);persist();renderViews();};
  $('#sfx-toggle').onclick=()=>{save.sfx=!save.sfx;audio.setSfxEnabled(save.sfx);persist();renderViews();};
  $<HTMLSelectElement>('#language').onchange=event=>changeLanguage((event.target as HTMLSelectElement).value==='ko'?'ko':'en');
  $('#reset').onclick=()=>{if(!confirm(text('resetConfirm')))return;save=clearSave();persist();audio.setMusicEnabled(save.music);audio.setSfxEnabled(save.sfx);localize();updateWallet();renderViews();startLevel(1);switchView('puzzle');};
}
function localize(){document.documentElement.lang=save.language;document.querySelectorAll<HTMLElement>('[data-t]').forEach(el=>el.textContent=text(el.dataset.t as TextKey));$('#language-toggle').textContent=save.language==='en'?'한국어':'EN';$('#settings-button').setAttribute('aria-label',text('settings'));$('#restart').setAttribute('aria-label',text('restart'));}
function changeLanguage(language:'en'|'ko'){save.language=language;persist();localize();renderViews();updateGoals();}
function switchView(name:string){
  if(!scene.canLeave())return;
  route=name;document.querySelectorAll<HTMLElement>('.view').forEach(view=>view.hidden=view.id!==`${name}-view`);
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(b=>{b.classList.toggle('active',b.dataset.route===name);if(b.dataset.route===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(name==='puzzle'){game.scale.refresh();if(game.scene.isPaused('Board'))game.scene.resume('Board');}else if(game.scene.isActive('Board'))game.scene.pause('Board');
}
document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button=>button.onclick=()=>switchView(button.dataset.route!));
$('#settings-button').onclick=()=>switchView(route==='settings'?'puzzle':'settings');
$('.brand').onclick=e=>{e.preventDefault();switchView('puzzle');};
$('#language-toggle').onclick=()=>changeLanguage(save.language==='en'?'ko':'en');
$('#restart').onclick=()=>{if(scene.canLeave())startLevel(currentLevel);};
$('#shuffle').onclick=()=>{if(shuffles>0&&scene.shuffle()){shuffles--;updateGoals();}};
$<HTMLDialogElement>('#result-dialog').addEventListener('cancel',event=>{event.preventDefault();$<HTMLDialogElement>('#result-dialog').close();switchView('village');});
document.addEventListener('pointerdown',()=>{void audio.unlock().catch(()=>{});},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.suspend();else audio.resume();});
if(Capacitor.isNativePlatform()){
  void App.addListener('appStateChange',({isActive})=>{if(isActive)audio.resume();else audio.suspend();});
  void App.addListener('backButton',()=>{const dialog=$<HTMLDialogElement>('#result-dialog');if(dialog.open){dialog.close();switchView('village');}else if(route!=='puzzle')switchView('puzzle');else void App.minimizeApp();});
}
startLevel(currentLevel);updateWallet();renderViews();localize();
