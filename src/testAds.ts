import { registerPlugin,type PluginListenerHandle } from '@capacitor/core';

export const adStates=['idle','consent','privacy','loading','ready','presenting','showing','closed','failed','cancelled'] as const;
export type AdState=typeof adStates[number];
export interface AdSnapshot {available:boolean;state:AdState;revision:number;error:string;privacyRequired:boolean}
export interface TestAdsBridge {
  getStatus():Promise<AdSnapshot>;
  prepare():Promise<AdSnapshot>;
  show():Promise<AdSnapshot>;
  cancel():Promise<AdSnapshot>;
  privacyOptions():Promise<AdSnapshot>;
  addListener(name:'stateChange',callback:(state:AdSnapshot)=>void):Promise<PluginListenerHandle>;
}
export const nativeTestAds=()=>registerPlugin<TestAdsBridge>('PawblossomTestAds');

// 네이티브가 상태의 원본입니다. 중복/역순 콜백을 revision으로 걸러내고 재개 시 재조회합니다.
export class TestAdsController {
  snapshot:AdSnapshot={available:false,state:'idle',revision:-1,error:'',privacyRequired:false};
  pending=false;
  needsCancellation=false;
  private disposed=false;
  private connection?:Promise<void>;
  private listener?:PluginListenerHandle;
  private localError=false;
  constructor(private bridge:TestAdsBridge,private changed:()=>void){}
  get overlay(){return ['privacy','presenting','showing'].includes(this.snapshot.state);}
  get busy(){return this.pending||['consent','privacy','loading','presenting','showing'].includes(this.snapshot.state);}
  get pausesGame(){return this.busy;}
  private accept=(value:AdSnapshot,authoritative=false)=>{
    if(this.disposed||!value||!adStates.includes(value.state)||!Number.isSafeInteger(value.revision)||value.revision<this.snapshot.revision||
      (value.revision===this.snapshot.revision&&!(authoritative&&this.localError)))return;
    this.localError=false;
    this.needsCancellation=['consent','privacy','loading','ready','presenting','showing'].includes(value.state);
    this.snapshot={...value,available:value.available===true,privacyRequired:value.privacyRequired===true};
    this.changed();
  };
  async connect(){
    if(this.disposed)return;
    if(this.listener){await this.refresh();return;}
    if(!this.connection)this.connection=(async()=>{
      const listener=await this.bridge.addListener('stateChange',this.accept);
      if(this.disposed){await listener.remove();return;}
      this.listener=listener;
      await this.refresh();
    })().catch(()=>{if(!this.disposed){this.connection=undefined;this.localFailure();}});
    await this.connection;
  }
  private localFailure(){
    // 불확실한 네이티브 전면창은 임의로 닫힌 것으로 처리하지 않습니다.
    this.localError=true;
    if(!this.overlay)this.snapshot={...this.snapshot,state:'failed',error:'bridge'};
    this.changed();
  }
  async refresh(){
    if(this.disposed)return;
    try{this.accept(await this.bridge.getStatus(),true);}catch{if(!this.disposed)this.localFailure();}
  }
  async command(action:'prepare'|'show'|'cancel'|'privacyOptions'){
    if(this.disposed||this.pending)return;
    if(action==='prepare'&&(this.busy||this.snapshot.state==='ready'))return;
    if(action==='show'&&(this.busy||this.snapshot.state!=='ready'))return;
    if(action==='cancel'&&this.overlay)return;
    if(action==='privacyOptions'&&(this.busy||!this.snapshot.privacyRequired))return;
    if(!this.snapshot.available)return;
    this.pending=true;this.changed();
    try{this.accept(await this.bridge[action]());}
    catch{if(!this.disposed){this.localFailure();await this.refresh();}}
    finally{this.pending=false;if(!this.disposed)this.changed();}
  }
  async dispose(){
    if(this.disposed)return;
    this.disposed=true;
    if(!this.overlay&&this.snapshot.available)void this.bridge.cancel().catch(()=>{});
    try{await this.listener?.remove();}catch{/* 종료 중 네이티브 브리지가 이미 해제되어도 재호출하지 않습니다. */}
    this.listener=undefined;
  }
}

export function adCopy(language:'ko'|'en'){
  return language==='ko'?{
    title:'시험 광고',intro:'Google 전면 테스트 광고 · 보상 없음',
    notice:'기본 꺼짐 · 버튼을 눌러야 요청합니다. 운영 연령 확인·부모 동의를 대신하지 않습니다. UMP는 앱 전체의 동의가 아닙니다.',
    prepare:'테스트 광고 불러오기',show:'테스트 광고 표시',cancel:'요청 취소',close:'돌아가기',privacy:'개인정보 선택',
    unavailable:'이 빌드에서는 시험 광고를 사용할 수 없어요.',
    states:{idle:'꺼짐',consent:'광고 요청 허용 상태 확인 중',privacy:'개인정보 양식 처리 중',loading:'테스트 광고 불러오는 중',ready:'준비됨 · 표시 버튼을 눌러 주세요',presenting:'전면 광고 표시 요청 중',showing:'테스트 광고 표시 중',closed:'광고가 닫혔어요 · 지급된 보상 없음',failed:'진행하지 못했어요',cancelled:'요청을 취소했어요'},
    recovery:'네트워크·동의 상태를 확인하고 다시 불러와 주세요. 계속 응답이 없으면 앱을 다시 열어 주세요.',
    blocked:'동의 정보가 불명확하거나 요청이 허용되지 않아 광고를 차단했어요.',
  }:{
    title:'Test ad',intro:'Google interstitial test ad · No reward',
    notice:'Off by default. Only the button starts a request. This does not replace age checks or parental consent. UMP is not consent for the entire app.',
    prepare:'Load test ad',show:'Show test ad',cancel:'Cancel request',close:'Go back',privacy:'Privacy choices',
    unavailable:'Test ads are unavailable in this build.',
    states:{idle:'Off',consent:'Checking permission to request ads',privacy:'Processing privacy form',loading:'Loading test ad',ready:'Ready · Tap Show test ad',presenting:'Requesting full-screen ad',showing:'Test ad showing',closed:'Ad closed · No reward granted',failed:'Unable to continue',cancelled:'Request cancelled'},
    recovery:'Check your network and consent status, then load again. If there is no response, reopen the app.',
    blocked:'Ads are blocked because consent information is unclear or requests are not allowed.',
  };
}
