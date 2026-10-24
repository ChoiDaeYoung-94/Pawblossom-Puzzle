import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import {TEST_TOOLS_ENABLED} from '../../buildFlags';
import {App} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {mountCarrierTrial} from './CarrierTrialView';
import {bindCarrierPage} from './CarrierPageLifecycle';
import './carrierTrial.css';

const root=document.querySelector<HTMLElement>('#carrier-trial')!;
if(TEST_TOOLS_ENABLED){
  const params=new URLSearchParams(location.search);
  const language=params.get('lang')==='en'?'en':'ko',mode=params.get('mode')==='column'?'column':'classic';
  const native=Capacitor.isNativePlatform()&&Capacitor.isPluginAvailable('App')?{
    listen:(callback:(active:boolean)=>void)=>App.addListener('appStateChange',state=>callback(state.isActive)),
    active:async()=>(await App.getState()).isActive,
  }:undefined;
  bindCarrierPage(window,()=>mountCarrierTrial(root,language,mode),native);
}else{
  root.textContent='이 체험은 테스트 빌드에서만 열 수 있어요.';
}
