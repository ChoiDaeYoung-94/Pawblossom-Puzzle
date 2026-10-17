/** 서버 내부 요청 계층입니다. HTTP/listen·앱 연결·자동 환경/키 읽기는 없습니다. */
import {existsSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {types} from 'node:util';
import {PlayFabSessionAuthenticator,type PlayFabSessionConfig,type PlayFabSessionResult} from '../auth/playfabSession.ts';
import {RewardLedger,type RewardLedgerOptions,type ClaimResult} from '../ads/rewardLedger.ts';
import {snapshotPolicy} from '../ads/admobSsv.ts';
import {RoundLedger,type RoundLedgerOptions,type RoundSnapshot,type TrustedRoundOwner,
  type StartRoundResult,type GetRoundResult,type RoundCommandResult,type ApplyRewardResult} from './roundLedger.ts';
import {commandSnapshot,exactRecord,isLevelId} from './roundState.ts';

export interface GameServiceOptions {
  readonly auth:PlayFabSessionConfig;
  readonly authTransport?:typeof fetch;
  readonly round:RoundLedgerOptions;
  readonly reward:RewardLedgerOptions;
  readonly rewardAdUnit:string;
  /** 신뢰된 동기 서버 정책입니다. 생략/예외/Promise는 거절합니다. 실제 연령·국가·동의 정책은 별도입니다. */
  readonly allowRewardClaim?:(context:Readonly<TrustedRoundOwner>,snapshot:RoundSnapshot)=>boolean;
}
interface SessionRequest {readonly sessionTicket:string;readonly signal?:AbortSignal;}
export interface StartGameRequest extends SessionRequest {readonly requestId:string;readonly levelId:number;}
export interface GetGameRequest extends SessionRequest {readonly roundId:string;}
export interface CommandGameRequest extends GetGameRequest {
  readonly operationId:string;readonly expectedRevision:number;readonly command:Parameters<RoundLedger['command']>[1]['command'];
}
export interface IssueRewardClaimRequest extends GetGameRequest {readonly expectedRevision:number;}
type BoundaryFailure=Exclude<PlayFabSessionResult,{kind:'authenticated'}>
  | {readonly kind:'rejected';readonly code:'invalid-input'|'aborted'|'ads-unavailable'|'revision-conflict'}
  | {readonly kind:'service-error';readonly code:'closed'|'storage-unavailable'};
export type GameCommandResult=RoundCommandResult&{readonly rewardCleanup?:'closed'|'retry-required'};
const invalid=():BoundaryFailure=>({kind:'rejected',code:'invalid-input'});
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const requestId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const revision=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=128;
function record(value:unknown,allowed:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=='object')throw new Error();
  const names=Reflect.ownKeys(value);
  if(names.some(k=>typeof k!=='string'||!allowed.includes(k)))throw new Error();
  return exactRecord(value,names as string[]);
}
function databaseIdentity(path:string):string {
  if(typeof path!=='string'||!isAbsolute(path)||!path.endsWith('.sqlite'))throw new Error();
  const p=resolve(path),physical=existsSync(p)?realpathSync(p):join(realpathSync(dirname(p)),basename(p));
  return process.platform==='win32'?physical.toLowerCase():physical;
}
function sameFile(a:string,b:string):boolean {
  if(databaseIdentity(a)===databaseIdentity(b))return true;
  if(!existsSync(a)||!existsSync(b))return false;
  const x=statSync(a),y=statSync(b);return x.dev===y.dev&&x.ino===y.ino;
}
function keyCopy(value:unknown):Buffer {
  if(!(value instanceof Uint8Array)||value.byteLength!==32)throw new Error();return Buffer.from(value);
}

/** PlayFab 선택형 어댑터를 소유하지만 최종 로그인 provider 채택을 의미하지 않습니다. */
export class GameService {
  #auth:PlayFabSessionAuthenticator;
  #round:RoundLedger;
  #reward:RewardLedger;
  #adUnit:string;
  #gate:NonNullable<GameServiceOptions['allowRewardClaim']>;
  #closed=false;
  constructor(input:GameServiceOptions) {
    const copies:Buffer[]=[];let auth:PlayFabSessionAuthenticator|undefined,round:RoundLedger|undefined,reward:RewardLedger|undefined;
    try {
      const o=record(input,['auth','authTransport','round','reward','rewardAdUnit','allowRewardClaim']);
      const a=record(o.auth,['titleId','environment','bindingDomain','bindingKey','getSecretKey','timeoutMs','maxConcurrent','maxResponseBytes','maxReads']);
      const r=record(o.round,['databasePath','serverKey','environment','now','maxRows','maxOperations','ttlMs']);
      const w=record(o.reward,['databasePath','serverKey','policy','dependencies']);
      // 외부 구성과 키는 소유하지 않습니다. 모든 생성 시도 후 임시 사본도 지웁니다.
      for(const key of [a.bindingKey,r.serverKey,w.serverKey])copies.push(keyCopy(key));
      const [authKey,roundKey,rewardKey]=copies;
      if(authKey.equals(roundKey)||authKey.equals(rewardKey)||roundKey.equals(rewardKey))throw new Error();
      const policy=snapshotPolicy(w.policy as RewardLedgerOptions['policy']);
      if(a.environment!==r.environment||!['test','production'].includes(String(a.environment))
        ||policy.environment!==(a.environment==='test'?'synthetic':'production'))throw new Error();
      if(sameFile(r.databasePath as string,w.databasePath as string))throw new Error();
      const adUnit=o.rewardAdUnit;
      if(typeof adUnit!=='string'||!policy.adUnits.includes(adUnit))throw new Error();
      if(o.allowRewardClaim!==undefined&&typeof o.allowRewardClaim!=='function')throw new Error();
      if(o.authTransport!==undefined&&typeof o.authTransport!=='function')throw new Error();
      const deps=w.dependencies===undefined?undefined:record(w.dependencies,['transport','now','timeoutMs','cacheMs','refreshCooldownMs']);
      this.#adUnit=adUnit;this.#gate=(o.allowRewardClaim as GameServiceOptions['allowRewardClaim'])??(()=>false);
      auth=new PlayFabSessionAuthenticator({...a,bindingKey:authKey} as unknown as PlayFabSessionConfig,o.authTransport as typeof fetch|undefined);
      round=new RoundLedger({...r,serverKey:roundKey} as unknown as RoundLedgerOptions);
      reward=new RewardLedger({...w,serverKey:rewardKey,policy,dependencies:deps} as unknown as RewardLedgerOptions);
      this.#auth=auth;this.#round=round;this.#reward=reward;
    } catch {
      for(const resource of [reward,round,auth])try{resource?.close();}catch{/* 다른 소유 자원도 끝까지 정리합니다. */}
      throw new Error('game-service-open-failed');
    } finally {copies.forEach(k=>k.fill(0));}
  }
  async #request<T>(input:unknown,fields:readonly string[],prepare:(r:Record<string,unknown>)=>(owner:Readonly<TrustedRoundOwner>)=>T):Promise<T|BoundaryFailure> {
    if(this.#closed)return {kind:'service-error',code:'closed'};
    let ticket:string,signal:AbortSignal|undefined,work:(owner:Readonly<TrustedRoundOwner>)=>T;
    try {
      const r=record(input,['sessionTicket','signal',...fields]);
      exactRecord(r,['sessionTicket',...fields,...(Object.hasOwn(r,'signal')?['signal']:[])]);
      if(typeof r.sessionTicket!=='string'||r.sessionTicket.length<1||r.sessionTicket.length>4096||!/^[\x21-\x7e]+$/.test(r.sessionTicket)
        ||r.signal!==undefined&&(!(r.signal instanceof AbortSignal)||types.isProxy(r.signal)))return invalid();
      ticket=r.sessionTicket;signal=r.signal as AbortSignal|undefined;
      // instanceof만 통과한 위조 signal의 네이티브 getter 예외도 입력 오류로 제한합니다.
      if(signal?.aborted)return {kind:'rejected',code:'aborted'};
      // 중첩 좌표/명령도 첫 await 전에 복제·검증합니다.
      work=prepare(r);
    }catch{return invalid();}
    try {
      const result=await this.#auth.authenticate({sessionTicket:ticket,signal});
      if(this.#closed)return {kind:'service-error',code:'closed'};
      if(signal?.aborted)return {kind:'rejected',code:'aborted'};
      if(result.kind!=='authenticated')return result;
      return work(Object.freeze({ownerId:result.context.ownerId}));
    }catch{return {kind:'service-error',code:'storage-unavailable'};}
  }
  start(input:StartGameRequest):Promise<StartRoundResult|BoundaryFailure> {
    return this.#request(input,['requestId','levelId'],r=>{
      if(!requestId(r.requestId)||!isLevelId(r.levelId))throw new Error();
      const request={requestId:r.requestId,levelId:r.levelId};return owner=>this.#round.start(owner,request);
    });
  }
  get(input:GetGameRequest):Promise<GetRoundResult|BoundaryFailure> {
    return this.#request(input,['roundId'],r=>{
      if(!opaque(r.roundId))throw new Error();const request={roundId:r.roundId};return owner=>this.#round.get(owner,request);
    });
  }
  command(input:CommandGameRequest):Promise<GameCommandResult|BoundaryFailure> {
    return this.#request(input,['roundId','operationId','expectedRevision','command'],r=>{
      if(!opaque(r.roundId)||!requestId(r.operationId)||!revision(r.expectedRevision))throw new Error();
      const request={roundId:r.roundId,operationId:r.operationId,expectedRevision:r.expectedRevision,command:commandSnapshot(r.command)};
      return owner=>{
        const result=this.#round.command(owner,request);
        if(result.kind!=='command-result'||result.outcome!=='abandoned')return result;
        // 게임 commit 성공 후에만 정리합니다. 같은 영수증 재시도도 cleanup을 다시 시도합니다.
        let closed=false;try{closed=this.#reward.closeRound({...owner,roundId:request.roundId}).kind==='round-closed';}catch{}
        return {...result,rewardCleanup:closed?'closed' as const:'retry-required' as const};
      };
    });
  }
  issueRewardClaim(input:IssueRewardClaimRequest):Promise<ClaimResult|BoundaryFailure|Exclude<GetRoundResult,{kind:'round-snapshot'}>> {
    return this.#request(input,['roundId','expectedRevision'],r=>{
      if(!opaque(r.roundId)||!revision(r.expectedRevision))throw new Error();const request={roundId:r.roundId},expected=r.expectedRevision;
      return owner=>{
        const result=this.#round.rewardEligibility(owner,request);
        if(result.kind!=='reward-eligible')return result;
        if(result.snapshot.revision!==expected)return {kind:'rejected',code:'revision-conflict'} as const;
        let allowed=false;try{
          const decision:unknown=this.#gate(owner,result.snapshot);
          // 잘못 주입한 async 정책의 늦은 reject도 관찰하지만 허용 결정으로 사용하지 않습니다.
          if(decision instanceof Promise)void decision.catch(()=>{});
          allowed=decision===true;
        }catch{}
        if(!allowed)return {kind:'rejected',code:'ads-unavailable'} as const;
        return this.#reward.issueClaim({...owner,...request},this.#adUnit);
      };
    });
  }
  applyReward(input:GetGameRequest):Promise<ApplyRewardResult|BoundaryFailure|Exclude<ClaimResult,{kind:'claim-issued'}>> {
    return this.#request(input,['roundId'],r=>{
      if(!opaque(r.roundId))throw new Error();const request={roundId:r.roundId};
      return owner=>{
        const eligible=this.#round.rewardEligibility(owner,request);
        if(eligible.kind!=='reward-eligible'&&!(eligible.kind==='rejected'&&eligible.code==='reward-used'))return eligible;
        const redeemed=this.#reward.redeemVoucher({...owner,...request});
        if(redeemed.kind!=='voucher-redeemed')return redeemed;
        return this.#round.applyReward(owner,request,redeemed.grant);
      };
    });
  }
  close():void {
    if(this.#closed)return;this.#closed=true;let failed=false;
    for(const resource of [this.#auth,this.#round,this.#reward])try{resource.close();}catch{failed=true;}
    if(failed)throw new Error('game-service-close-failed');
  }
}
