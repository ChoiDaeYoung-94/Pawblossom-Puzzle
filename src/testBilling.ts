import {registerPlugin,type PluginListenerHandle} from '@capacitor/core';

export const billingStates=['idle','connecting','querying','products','purchasing','cancelled','failed'] as const;
export const entitlements=['unknown','not-owned','pending','owned'] as const;
export interface BillingSnapshot {
  available:boolean;configured:boolean;state:typeof billingStates[number];entitlement:typeof entitlements[number];
  revision:number;error:string;price:string;overlay:boolean;adsBlocked:boolean;preparingPurchase:boolean;
}
export interface TestBillingBridge {
  getStatus():Promise<BillingSnapshot>;
  restore():Promise<BillingSnapshot>;
  queryProduct():Promise<BillingSnapshot>;
  purchase():Promise<BillingSnapshot>;
  addListener(name:'stateChange',callback:(value:BillingSnapshot)=>void):Promise<PluginListenerHandle>;
}
export const nativeTestBilling=()=>registerPlugin<TestBillingBridge>('PawblossomTestBilling');

// 소유권은 네이티브 서명 검증 결과만 반영합니다. 게임 저장에는 기록하지 않습니다.
export class TestBillingController {
  snapshot:BillingSnapshot={available:false,configured:false,state:'idle',entitlement:'unknown',revision:-1,error:'',price:'',overlay:false,adsBlocked:true,preparingPurchase:false};
  pending=false;
  private disposed=false;
  private listener?:PluginListenerHandle;
  private connection?:Promise<void>;
  private localError=false;
  private requestingPurchase=false;
  constructor(private bridge:TestBillingBridge,private changed:()=>void){}
  get busy(){return this.pending||this.snapshot.overlay||['connecting','querying','products','purchasing'].includes(this.snapshot.state);}
  get pausesGame(){return this.requestingPurchase||this.snapshot.preparingPurchase||this.snapshot.overlay||this.snapshot.state==='purchasing';}
  get blocksAds(){return this.snapshot.adsBlocked||this.busy;}
  get canPurchase(){return this.snapshot.available&&this.snapshot.configured&&!this.busy&&this.snapshot.entitlement==='not-owned'&&Boolean(this.snapshot.price);}
  private accept=(value:BillingSnapshot,authoritative=false)=>{
    if(this.disposed||!value||!Number.isSafeInteger(value.revision)||value.revision<this.snapshot.revision||(value.revision===this.snapshot.revision&&!(authoritative&&this.localError))||!billingStates.includes(value.state)||!entitlements.includes(value.entitlement))return;
    if(typeof value.available!=='boolean'||typeof value.configured!=='boolean'||typeof value.overlay!=='boolean'||typeof value.adsBlocked!=='boolean'||typeof value.preparingPurchase!=='boolean'||typeof value.price!=='string'||typeof value.error!=='string')return;
    this.localError=false;this.snapshot={...value};this.changed();
  };
  private async bounded<T>(promise:Promise<T>):Promise<T>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('IPC timeout')),12000);})]);}
    finally{clearTimeout(timer);}
  }
  private fail(){
    if(this.disposed)return;
    this.localError=true;
    this.snapshot={...this.snapshot,error:'bridge',price:'',adsBlocked:true,...(this.snapshot.overlay?{}:{state:'failed'})};this.changed();
  }
  async connect(){
    if(this.disposed)return;
    if(this.listener){await this.refresh();return;}
    if(!this.connection)this.connection=(async()=>{
      // addListener 자체는 타임아웃으로 버리지 않습니다. 늦게 등록되어도 종료 시 제거합니다.
      const listener=await this.bridge.addListener('stateChange',this.accept);
      if(this.disposed){await listener.remove();return;}
      this.listener=listener;await this.refresh();
    })().catch(()=>{this.connection=undefined;this.fail();});
    await this.connection;
  }
  async refresh(){
    if(this.disposed)return;
    try{this.accept(await this.bounded(this.bridge.getStatus()),true);}catch{this.fail();}
  }
  async command(action:'restore'|'queryProduct'|'purchase'){
    if(this.disposed||this.busy||!this.snapshot.available||!this.snapshot.configured||(action==='purchase'&&!this.canPurchase))return;
    this.pending=true;this.requestingPurchase=action==='purchase';this.changed();
    try{this.accept(await this.bounded(this.bridge[action]()));}catch{this.fail();await this.refresh();}
    finally{this.pending=false;this.requestingPurchase=false;if(!this.disposed)this.changed();}
  }
  async dispose(){
    if(this.disposed)return;this.disposed=true;
    try{await this.listener?.remove();}catch{/* 네이티브 종료 중 제거 실패는 재등록하지 않습니다. */}
    this.listener=undefined;
  }
}

export function billingCopy(language:'ko'|'en'){
  return language==='ko'?{
    title:'광고 제거 연동 시험',intro:'아직 운영 서비스가 아닙니다. Google Play 시험 연결입니다.',
    notice:'실제 운영 광고는 없습니다. Play 시험 계정·상품 설정을 확인한 뒤 이용해 주세요.',
    unconfigured:'구성 미완료 · 상품과 검증 설정이 없어 구매할 수 없어요.',
    queryProduct:'Play 상품 확인',purchase:'광고 제거 구매',restore:'구매 복원 / 다시 확인',close:'돌아가기',
    busy:'Play 응답을 확인하고 있어요.',
    entitlement:{unknown:'구매 여부 확인 전 · 광고 표시 보류',pending:'결제 대기 중 · 승인 전에는 혜택이 적용되지 않아요',owned:'검증된 광고 제거 권한 · 시험 광고 차단', 'not-owned':'Play 조회에서 광고 제거 구매가 확인되지 않았어요'},
    error:'확인을 마치지 못했어요. 구매 복원으로 다시 확인해 주세요.',
    verification:'구매 검증을 통과하지 못했어요. 새 혜택을 적용하지 않았어요.',
    ack:'구매 확인에 실패했어요. 제한된 자동 재시도 후에도 실패하면 구매 복원을 눌러 주세요.',cancelled:'구매 창을 취소했어요.',
    priceChanged:'가격이나 구매 조건이 바뀌었어요. 표시된 조건을 확인한 뒤 다시 눌러 주세요.',
  }:{
    title:'Ad removal integration test',intro:'Not a live service yet. Google Play test integration.',
    notice:'There are no live ads. Check Play test account and product settings before use.',
    unconfigured:'Setup incomplete · Product and verification settings are required to buy.',
    queryProduct:'Check Play product',purchase:'Buy ad removal',restore:'Restore / check again',close:'Go back',
    busy:'Checking the response from Play.',
    entitlement:{unknown:'Purchase status unknown · Ads held',pending:'Payment pending · No benefit before approval',owned:'Verified ad removal · Test ads blocked','not-owned':'Play query found no ad removal purchase'},
    error:'Could not finish checking. Try Restore / check again.',verification:'Purchase verification failed. No new benefit was applied.',
    ack:'Purchase acknowledgement failed. After limited automatic retries, tap Restore / check again if needed.',cancelled:'Purchase window cancelled.',
    priceChanged:'Price or purchase terms changed. Review the displayed terms, then tap again.',
  };
}
