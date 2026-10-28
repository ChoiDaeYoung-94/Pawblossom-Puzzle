import './StudioIntro.css';
import {App} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {showStudioIntro,studioPreferences} from './StudioIntro';
import {bindStudioLifecycle,createStudioBoot} from './StudioBoot';
import {reducedMotion} from './reducedMotion';

const host=document.getElementById('app')??document.body;
const prefs=studioPreferences();
const start=createStudioBoot({
  intro:()=>showStudioIntro(host,prefs,reducedMotion()),
  guard:finish=>Capacitor.isNativePlatform()?bindStudioLifecycle({
    back:listener=>App.addListener('backButton',listener),
    active:listener=>App.addListener('appStateChange',state=>listener(state.isActive)),
    current:()=>App.getState().then(state=>state.isActive),
  },finish):{ready:Promise.resolve(true),release:()=>{}},
  load:()=>import('./main'),
  failed:()=>{
    const panel=document.createElement('div'),message=document.createElement('p'),retry=document.createElement('button');
    panel.id='app-startup';panel.setAttribute('role','alert');
    message.textContent=prefs.language==='ko'?'게임을 불러오지 못했어요. 다시 시도해 주세요.':'The game could not load. Please try again.';
    retry.type='button';retry.className='studio-boot-retry';retry.textContent=prefs.language==='ko'?'다시 시도':'Try again';
    retry.onclick=()=>window.location.reload();panel.append(message,retry);host.replaceChildren(panel);retry.focus({preventScroll:true});
  },
});
void start();
