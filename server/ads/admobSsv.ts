/** 서버 전용. 자체 ASCII profile이며 실제 Google callback 호환/HTTP 인증 완료가 아닙니다. */
import {createHash, createPublicKey, verify, type KeyObject} from 'node:crypto';

export const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
export const SSV_PROFILE = 'pawblossom-admob-ascii-v1';
export interface AdmobPolicy {
  readonly environment: 'synthetic' | 'production';
  /** full ca-app-pub ID가 아닌 SSV의 숫자 단위 ID입니다. */
  readonly adUnits: readonly string[];
  readonly adNetworks: readonly string[];
  readonly rewardAmount: '5';
  readonly rewardItem: 'moves';
}
export interface SsvDependencies {
  /** 신뢰된 서버 transport만 주입. URL은 입력/구성으로 바꿀 수 없습니다. */
  readonly transport?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
  readonly refreshCooldownMs?: number;
}
export interface VerifiedRewardEvent {
  readonly nonceHash:string;
  readonly userHash:string;
  readonly transactionHash:string;
  readonly adUnit:string;
  readonly adNetwork:string;
  readonly timestamp:number;
}
/** 원문 대신 최소 hash 식별자와 검증된 정책 값만 서버 원장에 반환합니다. */
export type SsvResult = {readonly kind: 'verified'; readonly event: Readonly<VerifiedRewardEvent>}
  | {readonly kind: 'rejected'; readonly code: 'invalid-callback' | 'policy-mismatch' | 'invalid-signature' | 'key-unavailable' | 'aborted'};
const names = ['ad_network','ad_unit','custom_data','reward_amount','reward_item','timestamp','transaction_id','user_id','signature','key_id'];
const digits = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,19}$/.test(v);
export function snapshotPolicy(p: AdmobPolicy): AdmobPolicy {
  try {
    p={environment:p.environment,adUnits:p.adUnits,adNetworks:p.adNetworks,rewardAmount:p.rewardAmount,rewardItem:p.rewardItem};
    if (!['synthetic','production'].includes(p.environment) || p.rewardAmount !== '5' || p.rewardItem !== 'moves'
      || !Array.isArray(p.adUnits) || !Array.isArray(p.adNetworks)
      || [p.adUnits,p.adNetworks].some(a => a.length < 1 || a.length > 32 || a.some(v => !digits(v)) || new Set(a).size !== a.length)) throw new Error('invalid-ssv-config');
    return Object.freeze({environment:p.environment, rewardAmount:p.rewardAmount, rewardItem:p.rewardItem,
      adUnits: Object.freeze([...p.adUnits]), adNetworks: Object.freeze([...p.adNetworks])});
  } catch {throw new Error('invalid-ssv-config');}
}
function boundedNumber(value: number | undefined, fallback: number, min: number, max: number) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('invalid-ssv-config');
  return n;
}
function parse(raw: unknown) {
  // URL 전체·?·%·+·공백·비ASCII·구분자 주입은 변환하지 않고 거절합니다.
  if (typeof raw !== 'string' || raw.length > 4096 || !/^[A-Za-z0-9_=&.-]+$/.test(raw)) return;
  const parts = raw.split('&');
  if (parts.length !== names.length) return;
  const fields: Record<string,string> = Object.create(null);
  for (let i=0; i<names.length; i++) {
    const prefix = names[i] + '=';
    if (!parts[i].startsWith(prefix)) return;
    const value = parts[i].slice(prefix.length);
    if (!(names[i]==='signature' ? /^[A-Za-z0-9_-]{11,96}={0,2}$/ : /^[A-Za-z0-9_.-]{1,256}$/).test(value)) return;
    fields[names[i]] = value;
  }
  if (!digits(fields.ad_network) || !digits(fields.ad_unit) || !/^[1-9][0-9]{0,9}$/.test(fields.key_id)
    || BigInt(fields.key_id) > 4294967295n || !/^[1-9][0-9]{12}$/.test(fields.timestamp)
    || !Number.isSafeInteger(Number(fields.timestamp)) || !/^[0-9a-f]{16,128}$/.test(fields.transaction_id)
    || !/^[A-Za-z0-9_-]{43}$/.test(fields.custom_data) || !/^[A-Za-z0-9_-]{43}$/.test(fields.user_id)) return;
  const signature = Buffer.from(fields.signature, 'base64url');
  const unpadded=signature.toString('base64url'), padded=signature.toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
  if (![unpadded,padded].includes(fields.signature) || !canonicalDer(signature)) return;
  return {fields: Object.freeze(fields), signature, content: raw.slice(0, raw.lastIndexOf('&signature='))};
}
/** 구조만 검사합니다. 서명/정책 검증 결과나 원문 필드는 반환하지 않습니다. */
export function isAdmobCallbackStructure(raw: unknown): boolean {
  try {return parse(raw)!==undefined;} catch {return false;}
}
function canonicalDer(b: Buffer) {
  if (b[0] !== 0x30 || b[1] !== b.length - 2 || b.length < 8 || b.length > 72) return false;
  let offset = 2;
  for (let i=0;i<2;i++) {
    if (b[offset++] !== 2) return false;
    const n = b[offset++];
    if (n < 1 || n > 33 || offset+n > b.length || (b[offset] & 128)
      || (n > 1 && b[offset] === 0 && !(b[offset+1] & 128)) || b.subarray(offset,offset+n).every(v=>v===0)) return false;
    offset += n;
  }
  return offset === b.length;
}
function publicKeys(text: string): Map<string,KeyObject> {
  // JSON.parse 전 깊이 제한: 문자열 내 괄호/escape는 깊이로 세지 않습니다.
  let depth=0, quoted=false, escaped=false;
  for (const c of text) {
    if (quoted) {if (escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false;}
    else if(c==='"') quoted=true;
    else if(c==='{' || c==='[') {if(++depth>4) throw new Error();}
    else if(c==='}' || c===']') depth--;
  }
  const data = JSON.parse(text);
  // JSON.parse가 덮어쓰는 중복 object member도 거절합니다.
  const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)??[];
  const stack:(Set<string>|null)[]=[];
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if(token==='{') stack.push(new Set()); else if(token==='[') stack.push(null);
    else if(token==='}' || token===']') stack.pop();
    else if(token.startsWith('"') && tokens[i+1]===':') {
      const set=stack.at(-1), member=JSON.parse(token);
      if(!set || set.has(member)) throw new Error(); set.add(member);
    }
  }
  if (!data || Object.keys(data).join() !== 'keys' || !Array.isArray(data.keys) || data.keys.length<1 || data.keys.length>16) throw new Error();
  const keys = new Map<string,KeyObject>();
  for (const item of data.keys) {
    if (!item || Object.keys(item).sort().join() !== 'base64,keyId,pem' || !Number.isSafeInteger(item.keyId)
      || item.keyId<1 || item.keyId>4294967295 || typeof item.base64!=='string' || item.base64.length>512
      || typeof item.pem!=='string' || item.pem.length>1024 || keys.has(String(item.keyId))) throw new Error();
    const der = Buffer.from(item.base64,'base64');
    if (der.toString('base64')!==item.base64) throw new Error();
    const key = createPublicKey({key:der,format:'der',type:'spki'});
    const pem = createPublicKey(item.pem);
    if (key.asymmetricKeyType !== 'ec' || !['prime256v1','secp256k1'].includes(key.asymmetricKeyDetails?.namedCurve ?? '')
      || !key.export({format:'der',type:'spki'}).equals(der) || !pem.export({format:'der',type:'spki'}).equals(der)
      || !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/.test(item.pem)) throw new Error();
    keys.set(String(item.keyId),key);
  }
  return keys;
}

/** 기존 키의 만료/시계 역행은 차단합니다. unknown-key 갱신은 전체 ID 공통 cooldown/singleflight입니다. */
export function createAdmobSsvVerifier(policy: AdmobPolicy, deps: SsvDependencies = {}) {
  try {return makeVerifier(policy,deps);} catch {throw new Error('invalid-ssv-config');}
}
function safeCancel(getTarget:()=>{cancel:()=>unknown}|null|undefined) {
  try {void Promise.resolve(getTarget()?.cancel()).catch(()=>{});} catch { /* getter/원문/예외 비노출, 비협조 cancel 대기 없음 */ }
}
function makeVerifier(policy: AdmobPolicy, deps: SsvDependencies) {
  const p = snapshotPolicy(policy), transport = deps.transport ?? globalThis.fetch, now = deps.now ?? Date.now;
  if (typeof transport !== 'function' || typeof now !== 'function') throw new Error('invalid-ssv-config');
  const timeout = boundedNumber(deps.timeoutMs,5000,1,5000), cacheMs=boundedNumber(deps.cacheMs,86_400_000,1,86_400_000);
  const cooldown=boundedNumber(deps.refreshCooldownMs,60_000,1,86_400_000);
  let keys = new Map<string,KeyObject>(), loadedAt=-1, attemptedAt=-1, lastNow=-1;
  let flight: Promise<boolean> | undefined, poisoned=false, workActive=false, pendingCallers=0;
  function time() {
    const t=now();
    if (!Number.isSafeInteger(t) || t<0 || t<lastNow) {keys.clear(); poisoned=true; throw new Error();}
    lastNow=t; return t;
  }
  function refresh(t:number): Promise<boolean> {
    if (flight) return flight;
    if (poisoned || workActive || (attemptedAt>=0 && t-attemptedAt<cooldown)) return Promise.resolve(false);
    attemptedAt=t;
    const controller=new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, expired=false;
    let response: Response|undefined;
    workActive=true;
    let timer: ReturnType<typeof setTimeout>;
    const limit = new Promise<boolean>(resolve=>{timer=setTimeout(()=>{
      expired=true; controller.abort(); safeCancel(()=>reader??response?.body); resolve(false);
    },timeout);});
    const work = (async()=>{
      try {
        response=await transport(ADMOB_KEYS_URL,{method:'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
        if (expired) {safeCancel(()=>response?.body); return false;}
        if (response.status!==200 || response.redirected || (response.url && response.url!==ADMOB_KEYS_URL) || !response.body
          || !/^application\/json(?:\s*;.*)?$/i.test(response.headers.get('content-type')??'')) throw new Error();
        const length=response.headers.get('content-length');
        if (length!==null && (!/^[0-9]{1,6}$/.test(length) || Number(length)>32768)) throw new Error();
        reader=response.body.getReader();
        const chunks: Uint8Array[]=[]; let size=0, reads=0;
        while(true) {
          if (++reads>128) throw new Error();
          const part=await reader.read();
          if(expired) return false;
          if(!part || typeof part.done!=='boolean' || (part.done ? part.value!==undefined : !(part.value instanceof Uint8Array))) throw new Error();
          if(part.done) break;
          size+=part.value.byteLength; if(size>32768) throw new Error();
          chunks.push(part.value.slice());
        }
        const parsed=publicKeys(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
        const ended=time();
        if(expired || ended-t>timeout || poisoned) return false;
        keys=parsed; loadedAt=t; return true;
      } catch {return false;}
      finally {safeCancel(()=>reader??response?.body);workActive=false;}
    })();
    flight=Promise.race([work,limit]).finally(()=>{clearTimeout(timer!);flight=undefined;});
    return flight;
  }
  return async (rawQuery: unknown, signal?: AbortSignal): Promise<SsvResult> => {
    const rejected=(code: Exclude<SsvResult,{kind:'verified'}>['code']): SsvResult=>({kind:'rejected',code});
    let onAbort: (()=>void) | undefined;
    if(pendingCallers>=128) return rejected('key-unavailable');
    pendingCallers++;
    try {
      if(signal!==undefined && !(signal instanceof AbortSignal)) return rejected('invalid-callback');
      if(signal?.aborted) return rejected('aborted');
      const input=parse(rawQuery); if(!input) return rejected('invalid-callback');
      const f=input.fields;
      if(!p.adUnits.includes(f.ad_unit) || !p.adNetworks.includes(f.ad_network) || f.reward_amount!==p.rewardAmount || f.reward_item!==p.rewardItem) return rejected('policy-mismatch');
      let t=time();
      if(poisoned) return rejected('key-unavailable');
      if(loadedAt<0 || t-loadedAt>=cacheMs || !keys.has(f.key_id)) {
        if(signal?.aborted) return rejected('aborted');
        const aborted=new Promise<boolean>(resolve=>{onAbort=()=>resolve(false); signal?.addEventListener('abort',onAbort,{once:true});});
        await Promise.race([refresh(t),aborted]);
        if(signal?.aborted) return rejected('aborted');
        t=time();
      }
      const key=keys.get(f.key_id);
      if(poisoned || loadedAt<0 || t-loadedAt>=cacheMs || !key) return rejected('key-unavailable');
      if(!verify('sha256',Buffer.from(input.content,'utf8'),{key,dsaEncoding:'der'},input.signature)) return rejected('invalid-signature');
      const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
      return {kind:'verified',event:Object.freeze({nonceHash:hash(f.custom_data),userHash:hash(f.user_id),transactionHash:hash(f.transaction_id),
        adUnit:f.ad_unit,adNetwork:f.ad_network,timestamp:Number(f.timestamp)})};
    } catch {return rejected('key-unavailable');}
    finally {pendingCallers--;if(onAbort) signal?.removeEventListener('abort',onAbort);}
  };
}
