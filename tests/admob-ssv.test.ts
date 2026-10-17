import {describe,it,expect,vi,afterEach} from 'vitest';
import {createPublicKey,generateKeyPairSync} from 'node:crypto';
import {ADMOB_KEYS_URL,createAdmobSsvVerifier,type AdmobPolicy,type SsvDependencies} from '../server/ads/admobSsv';
import {policy,pair,epoch,keyPair,keyEntry,keyResponse,callback,signature,malleate} from './helpers/ssvFixture';
afterEach(()=>vi.restoreAllMocks());
const rejected=(code:string)=>({kind:'rejected',code});
function setup(deps:SsvDependencies={},p:AdmobPolicy=policy) {
  const fetcher=vi.fn<typeof fetch>(async()=>keyResponse());
  return {verify:createAdmobSsvVerifier(p,{now:()=>epoch,transport:fetcher,...deps}),fetcher};
}
describe('SSV 자체 ASCII·ECDSA profile (Google 실콜백 미검증)',()=>{
  it.each(['prime256v1','secp256k1'])('합성 %s SPKI/SHA256/DER',async curve=>{
    const key=keyPair(curve),{verify}=setup({transport:async()=>keyResponse([keyEntry(key.publicKey)])});
    expect((await verify(callback({},key.privateKey))).kind).toBe('verified');
  });
  it('양쪽 AdMob network 큰 정수를 문자열로 보존',async()=>{
    const {verify}=setup();for(const ad_network of policy.adNetworks){const r=await verify(callback({ad_network}));expect(r.kind==='verified'&&r.event.adNetwork).toBe(ad_network);}
  });
  // 공식 Tink verifier의 독립 공개키 예시만 사용합니다(개인키·실키 서버 응답 아님).
  // https://github.com/tink-crypto/tink-java-apps/blob/main/rewardedads/src/main/java/com/google/crypto/tink/apps/rewardedads/RewardedAdsVerifier.java
  it.each([
    ['prime256v1','MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUaWMKcBHWdhUE+DncSIHhFCLLElnUs0LB9oanZ4K/FNICIM8ltS4nzc9yjmhgVQOlmSS6unqvN9t8sqajRTPcw=='],
    ['secp256k1','MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEtxg2BsK/fllIeADtLspezS6YfHFWXZ8tiJncm8LDBa/NxEC84akdWbWDCUrMMGIV27/3/e7UuKSEonjGvaDUsw=='],
  ])('공식 독립 public SPKI 예시 %s는 import 가능 (Google 서명 fixture 아님)',async(curve,base64)=>{
    const key=createPublicKey({key:Buffer.from(base64,'base64'),format:'der',type:'spki'});expect(key.asymmetricKeyDetails?.namedCurve).toBe(curve);
    const {verify}=setup({transport:async()=>keyResponse([keyEntry(key)])});expect(await verify(callback())).toEqual(rejected('invalid-signature'));
  });
  it.each([false,true])('base64url canonical padding=%s 지원',async padding=>{expect((await setup().verify(callback({},pair.privateKey,'3901585526',padding))).kind).toBe('verified');});
  it('실제 transaction은 signature malleability와 독립',async()=>{const raw=callback(),{verify}=setup();expect((await verify(raw)).kind).toBe('verified');expect((await verify(malleate(raw))).kind).toBe('verified');});
  const corruptions: [string,(s:string)=>unknown][]=[
    ['전체URL',s=>'https://synthetic.example/callback?'+s],['물음표',s=>'?'+s],['fragment',s=>s+'#x'],['배열',s=>[s]],['가짜fact',()=>({verified:true,fields:{}})],['null',()=>null],
    ['중복필드',s=>s+'&user_id='+ 'a'.repeat(43)],['누락custom',s=>s.replace(/custom_data=[^&]+&/,'')],['누락user',s=>s.replace(/user_id=[^&]+&/,'')],
    ['누락signature',s=>s.replace(/&signature=[^&]+/,'')],['누락key',s=>s.replace(/&key_id=.*/,'' )],['extra',s=>s.replace('&signature=','&extra=x&signature=')],
    ['encoded이름',s=>s.replace('ad_unit','ad%5funit')],['encoded정상문자',s=>s.replace('moves','%6doves')],['공백percent',s=>s.replace('moves','move%20s')],['불완전percent',s=>s.replace('moves','moves%')],
    ['invalidpercent',s=>s.replace('moves','%GG')],['invalidUTF8',s=>s.replace('moves','%C0%AF')],['비ASCII',s=>s.replace('moves','이동')],['CRLF',s=>s+'\r\n'],['encodedCRLF',s=>s+'%0D%0A'],['plus',s=>s.replace('moves','move+s')],
    ['서명순서',s=>s.replace(/&signature=([^&]+)&key_id=(.*)/,'&key_id=$2&signature=$1')],['필드순서',s=>s.replace(/^ad_network=([^&]+)&ad_unit=([^&]+)/,'ad_unit=$2&ad_network=$1')],
    ['구형필드',s=>s.replace('reward_amount','reward_value')],['구형16자리timestamp',s=>s.replace(String(epoch),'1507770365237823')],['소수timestamp',s=>s.replace(String(epoch),'1792200000000.1')],['과대timestamp',s=>s.replace(String(epoch),'99999999999999999')],
    ['keyzero',s=>s.replace(/key_id=.*/,'key_id=0')],['keyoverflow',s=>s.replace(/key_id=.*/,'key_id=4294967296')],['leadingzero',s=>s.replace(/key_id=.*/,'key_id=03901585526')],['key부호',s=>s.replace(/key_id=.*/,'key_id=-1')],
    ['emptyvalue',s=>s.replace('reward_item=moves','reward_item=')],['equal주입',s=>s.replace('moves','mov=es')],['noncepadding',s=>s.replace(/custom_data=[^&]+/,'custom_data='+ 'n'.repeat(43)+'=')],['oversize',()=> 'x'.repeat(4097)],
    ['transaction대문자',s=>s.replace('abcd'.repeat(8),'ABCD'.repeat(8))],['transaction비hex',s=>s.replace('abcd'.repeat(8),'xyz'.repeat(8))],['signaturepercent',s=>s.replace('signature=','signature=%')],['signaturepadding3',s=>s.replace('&key_id','===&key_id')],
  ];
  it.each(corruptions)('%s 거절·fetch 없음',async(_name,change)=>{const {verify,fetcher}=setup();expect(await verify(change(callback()))).toEqual(rejected('invalid-callback'));expect(fetcher).not.toHaveBeenCalled();});
  it.each([{ad_unit:'9999999999'},{ad_unit:'ca-app-pub-123-456'},{ad_network:'9999999999999999999'},{reward_amount:'6'},{reward_item:'coins'}] as Record<string,string>[])('정책 %j 거절',async patch=>{const {verify,fetcher}=setup();expect((await verify(callback(patch))).kind).toBe('rejected');expect(fetcher).not.toHaveBeenCalled();});
  it('본문 변조·다른키 서명은 거절',async()=>{const {verify}=setup();expect(await verify(callback().replace(String(epoch),String(epoch+1)))).toEqual(rejected('invalid-signature'));expect(await verify(callback({},keyPair().privateKey))).toEqual(rejected('invalid-signature'));});
  it.each(['3006020101020101','3006020100020101','3006020180020101','300702020001020101','300602010102010100','308106020101020101'])('DER %s 구조/암호 경계',async hex=>{const {verify}=setup();const r=await verify(signature(callback(),Buffer.from(hex,'hex')));expect(r.kind).toBe('rejected');if(hex==='3006020101020101')expect(r).toEqual(rejected('invalid-signature'));});
  it.each([0,-1,86400001,NaN])('cache 제한 %s',cacheMs=>{expect(()=>setup({cacheMs})).toThrow('invalid-ssv-config');});
  it.each([{...policy,adUnits:[]},{...policy,adUnits:['ca-app-pub-1/2']},{...policy,adNetworks:[5450213213286189855]},{...policy,adUnits:['1','1']},{...policy,rewardAmount:'6'}])('잘못된 구성 거절',p=>{expect(()=>setup({},p as AdmobPolicy)).toThrow('invalid-ssv-config');});
  it('구성 getter/extra 필드와 transport 교체를 노출/반영하지 않음',async()=>{
    expect(()=>setup({}, {get environment(){throw new Error('secret-config');}} as any)).toThrow('invalid-ssv-config');
    const p={...policy,adUnits:[...policy.adUnits],secret:'ignored'},deps={now:()=>epoch,transport:async()=>keyResponse()},v=createAdmobSsvVerifier(p,deps);
    p.adUnits[0]='999';deps.transport=async()=>{throw new Error('secret')};expect((await v(callback())).kind).toBe('verified');
  });
});
describe('고정 public key fetch·키 경계',()=>{
  it('고정 HTTPS·redirect:error·자격정보 없음',async()=>{const {verify,fetcher}=setup();await verify(callback());expect(fetcher).toHaveBeenCalledWith(ADMOB_KEYS_URL,expect.objectContaining({redirect:'error',credentials:'omit',method:'GET',signal:expect.any(AbortSignal)}));});
  const brokenKeys:[string,()=>unknown][]=[
    ['빈목록',()=>({keys:[]})],['키17개',()=>({keys:Array.from({length:17},(_,i)=>keyEntry(pair.publicKey,i+1))})],['중복ID',()=>({keys:[keyEntry(),keyEntry()]})],['음수ID',()=>({keys:[keyEntry(pair.publicKey,-1)]})],['소수ID',()=>({keys:[keyEntry(pair.publicKey,1.5)]})],['초과ID',()=>({keys:[keyEntry(pair.publicKey,4294967296)]})],['문자ID',()=>({keys:[{...keyEntry(),keyId:'3901585526'}]})],
    ['PEM불일치',()=>({keys:[{...keyEntry(),pem:keyEntry(keyPair().publicKey).pem}]})],['badDER',()=>({keys:[{...keyEntry(),base64:'AAAA'}]})],['base64비정규',()=>({keys:[{...keyEntry(),base64:keyEntry().base64+'='}]})],['PEM없음',()=>({keys:[{base64:keyEntry().base64,keyId:3901585526}]})],['extra키',()=>({keys:[{...keyEntry(),url:'https://evil.invalid'}]})],['extra최상위',()=>({keys:[keyEntry()],extra:1})],
    ['RSA',()=>({keys:[keyEntry(generateKeyPairSync('rsa',{modulusLength:1024}).publicKey)]})],['P384',()=>({keys:[keyEntry(keyPair('secp384r1').publicKey)]})],['P521',()=>({keys:[keyEntry(keyPair('secp521r1').publicKey)]})],['Ed25519',()=>({keys:[keyEntry(generateKeyPairSync('ed25519').publicKey)]})],['null키',()=>({keys:[null]})],['invalidroot',()=>[]],
  ];
  it.each(brokenKeys)('%s 차단·원문 비노출',async(_name,body)=>{const {verify}=setup({transport:async()=>new Response(JSON.stringify(body()),{headers:{'content-type':'application/json'}})});expect(await verify(callback())).toEqual(rejected('key-unavailable'));});
  it.each(['{"keys":[],"keys":[]}','{"keys":[{"keyId":1,"keyId":2}]}','{"keys":[{"keyId":1,"\\u006beyId":2}]}','{"keys":[[[[[[]]]]]]}','{broken-json','x'.repeat(32769)])('손상/중복 JSON #%#',async text=>{const {verify}=setup({transport:async()=>new Response(text,{headers:{'content-type':'application/json'}})});expect(await verify(callback())).toEqual(rejected('key-unavailable'));});
  it.each([201,204,301,400,500])('HTTP %s 차단',async status=>{const {verify}=setup({transport:async()=>new Response(status===204?null:'secret-body',{status,headers:{'content-type':'application/json'}})});expect(await verify(callback())).toEqual(rejected('key-unavailable'));});
  it.each([{'content-type':'text/plain'},{'content-type':'application/json','content-length':'32769'},{'content-type':'application/json','content-length':'x'}] as Record<string,string>[])('헤더 경계 %j',async headers=>{const {verify}=setup({transport:async()=>new Response(JSON.stringify({keys:[keyEntry()]}),{headers})});expect(await verify(callback())).toEqual(rejected('key-unavailable'));});
  it.each(['redirected','wrong-url','null-body','invalid-utf8','read-throw','read-shape','too-many-reads','cancel-throw','cancel-reject','cancel-hang'])('response %s',async kind=>{
    let reads=0;
    const cancel=vi.fn(()=>{if(kind==='cancel-throw')throw new Error('secret');if(kind==='cancel-reject')return Promise.reject(new Error('secret'));if(kind==='cancel-hang')return new Promise(()=>{});});
    const reader={read:async()=>{if(kind==='read-throw')throw new Error('secret');if(kind==='read-shape')return {done:0,value:'bad'};if(kind==='too-many-reads')return {done:false,value:new Uint8Array()};return reads++?{done:true}:{done:false,value:kind==='invalid-utf8'?new Uint8Array([0xff]):new TextEncoder().encode('bad-json')};},cancel};
    const response={status:200,redirected:kind==='redirected',url:kind==='wrong-url'?'https://evil.invalid':ADMOB_KEYS_URL,headers:new Headers({'content-type':'application/json'}),body:kind==='null-body'?null:{getReader:()=>reader,cancel}} as unknown as Response;
    const {verify}=setup({transport:async()=>response});expect(await verify(callback())).toEqual(rejected('key-unavailable'));
    if(kind!=='null-body')expect(cancel).toHaveBeenCalled();
  });
});
describe('캐시·rotation·동시 caller·timeout',()=>{
  it('24시간 미만 재사용·만료 실패 시 과거키 차단',async()=>{
    let now=epoch,fail=false;const transport=vi.fn<typeof fetch>(async()=>{if(fail)throw new Error('secret');return keyResponse();});const {verify}=setup({now:()=>now,transport});
    expect((await verify(callback())).kind).toBe('verified');now+=86399999;expect((await verify(callback())).kind).toBe('verified');expect(transport).toHaveBeenCalledTimes(1);
    now++;fail=true;expect(await verify(callback())).toEqual(rejected('key-unavailable'));expect(transport).toHaveBeenCalledTimes(2);
  });
  it('unknown key 공통 cooldown·singleflight·map 유한',async()=>{
    let now=epoch,entries=[keyEntry()];const transport=vi.fn<typeof fetch>(async()=>keyResponse(entries)),{verify}=setup({now:()=>now,transport,refreshCooldownMs:100});
    await verify(callback());for(let i=1;i<=40;i++)expect(await verify(callback({},pair.privateKey,String(i)))).toEqual(rejected('key-unavailable'));expect(transport).toHaveBeenCalledTimes(1);
    now+=100;entries=[keyEntry(pair.publicKey,44)];const results=await Promise.all(Array.from({length:30},()=>verify(callback({},pair.privateKey,'44'))));expect(results.every(v=>v.kind==='verified')).toBe(true);expect(transport).toHaveBeenCalledTimes(2);
    expect(await verify(callback())).toEqual(rejected('key-unavailable'));
  });
  it('한 caller abort가 공유 fetch를 취소하지 않음',async()=>{
    let resolve!:(r:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(r=>resolve=r)),{verify}=setup({transport});
    const a=new AbortController(),first=verify(callback(),a.signal),second=verify(callback());a.abort();expect(await first).toEqual(rejected('aborted'));expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false);
    resolve(keyResponse());expect((await second).kind).toBe('verified');expect(transport).toHaveBeenCalledTimes(1);
  });
  it('사전 abort는 fetch 없음',async()=>{const {verify,fetcher}=setup(),a=new AbortController();a.abort();expect(await verify(callback(),a.signal)).toEqual(rejected('aborted'));expect(fetcher).not.toHaveBeenCalled();});
  it('비협조 fetch timeout 뒤 추가 transport 누적 없음·늦은 응답 폐기·회복',async()=>{
    let now=epoch,resolve!:(r:Response)=>void;const transport=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockImplementation(async()=>keyResponse());const {verify}=setup({transport,now:()=>now,timeoutMs:10,refreshCooldownMs:1});
    expect(await verify(callback())).toEqual(rejected('key-unavailable'));now+=100;for(let i=0;i<20;i++)expect(await verify(callback())).toEqual(rejected('key-unavailable'));expect(transport).toHaveBeenCalledTimes(1);
    resolve(keyResponse());await new Promise(r=>setTimeout(r,0));expect((await verify(callback())).kind).toBe('verified');expect(transport).toHaveBeenCalledTimes(2);
  });
  it('abort 준수 fetch 일시 timeout은 cooldown 뒤 회복',async()=>{
    let now=epoch;const transport=vi.fn<typeof fetch>().mockImplementationOnce((_u,o)=>new Promise((_r,reject)=>o?.signal?.addEventListener('abort',()=>reject(new Error('secret'))))).mockImplementation(async()=>keyResponse());const {verify}=setup({transport,now:()=>now,timeoutMs:10,refreshCooldownMs:1});
    expect(await verify(callback())).toEqual(rejected('key-unavailable'));now+=100;expect((await verify(callback())).kind).toBe('verified');
  });
  it('stream 전체 read timeout/비협조 cancel도 결과 반환',async()=>{
    const response={status:200,redirected:false,url:ADMOB_KEYS_URL,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>{throw new Error('secret');}})}} as unknown as Response;
    const {verify}=setup({transport:async()=>response,timeoutMs:10});expect(await verify(callback())).toEqual(rejected('key-unavailable'));
  });
  it('clock 역행 뒤 인스턴스 fail closed',async()=>{let now=epoch;const {verify}=setup({now:()=>now});await verify(callback());now--;expect(await verify(callback())).toEqual(rejected('key-unavailable'));now+=10;expect(await verify(callback())).toEqual(rejected('key-unavailable'));});
  it('서버 transport 예외·console 원문 미노출',async()=>{
    const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];const {verify}=setup({transport:async()=>{throw new Error('secret-query-token');}});expect(await verify(callback())).toEqual(rejected('key-unavailable'));logs.forEach(log=>expect(log).not.toHaveBeenCalled());
  });
  it.each([null,{},'signal',123])('runtime signal %j는 fetch 이전 거절',async signal=>{const {verify,fetcher}=setup();expect(await verify(callback(),signal as any)).toEqual(rejected('invalid-callback'));expect(fetcher).not.toHaveBeenCalled();});
  it.each(['HTTP-error','body-read','late-response'])('cleanup body getter throw %s도 안전',async mode=>{
    const response={status:mode==='HTTP-error'?500:200,redirected:false,url:ADMOB_KEYS_URL,headers:new Headers({'content-type':'application/json'}),get body(){
      throw new Error('secret-body-getter');
    }} as unknown as Response;
    let resolve!:(r:Response)=>void;
    const {verify}=setup({timeoutMs:5,transport:mode==='late-response'?()=>new Promise(r=>resolve=r):async()=>response});
    expect(await verify(callback())).toEqual(rejected('key-unavailable'));
    if(mode==='late-response'){resolve(response);await new Promise(r=>setTimeout(r,0));}
  });
  it('reader 획득 이전 두 번째 body getter throw',async()=>{
    let n=0;const response={status:200,redirected:false,url:ADMOB_KEYS_URL,headers:new Headers({'content-type':'application/json'}),get body(){if(n++)throw new Error('secret');return {getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>{throw new Error('secret');}})};}} as unknown as Response;
    expect(await setup({transport:async()=>response,timeoutMs:5}).verify(callback())).toEqual(rejected('key-unavailable'));
  });
  it('EOF에 value가 있으면 손상 response',async()=>{
    const response={status:200,redirected:false,url:ADMOB_KEYS_URL,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:async()=>({done:true,value:new Uint8Array()}),cancel:()=>{}})}} as unknown as Response;
    expect(await setup({transport:async()=>response}).verify(callback())).toEqual(rejected('key-unavailable'));
  });
  it('대기 caller128개·공유 fetch1개 제한과 완료 후 회복',async()=>{
    let resolve!:(r:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(r=>resolve=r)),{verify}=setup({transport});
    const calls=Array.from({length:128},()=>verify(callback()));expect(await verify(callback())).toEqual(rejected('key-unavailable'));expect(transport).toHaveBeenCalledTimes(1);
    resolve(keyResponse());expect((await Promise.all(calls)).every(v=>v.kind==='verified')).toBe(true);expect((await verify(callback())).kind).toBe('verified');
  });
  it('검증 결과는 최소 frozen event·원문/서명/nonce/user/transaction 미노출',async()=>{
    const raw=callback(),r=await setup().verify(raw);expect(r.kind).toBe('verified');
    const output=JSON.stringify(r);for(const secret of [raw,'n'.repeat(43),'u'.repeat(43),'abcd'.repeat(8),raw.match(/signature=([^&]+)/)![1]])expect(output).not.toContain(secret);
    if(r.kind==='verified'){expect(Object.keys(r.event).sort()).toEqual(['adNetwork','adUnit','nonceHash','timestamp','transactionHash','userHash']);expect(Object.isFrozen(r.event)).toBe(true);for(const v of [r.event.nonceHash,r.event.userHash,r.event.transactionHash])expect(v).toMatch(/^[0-9a-f]{64}$/);}
  });
  it.each(['throw','bad-json','mismatched-key'])('unknown refresh %s 실패는 fresh trusted key 보존·만료 후 차단',async failure=>{
    let now=epoch,fail=false;const transport=vi.fn<typeof fetch>(async()=>{
      if(!fail)return keyResponse();if(failure==='throw')throw new Error('secret');if(failure==='bad-json')return new Response('{bad',{headers:{'content-type':'application/json'}});return keyResponse([{...keyEntry(),base64:'AAAA'}]);
    });
    const {verify}=setup({now:()=>now,transport,refreshCooldownMs:10});expect((await verify(callback())).kind).toBe('verified');now+=10;fail=true;
    expect(await verify(callback({},pair.privateKey,'1'))).toEqual(rejected('key-unavailable'));expect((await verify(callback())).kind).toBe('verified');
    now=epoch+86400000;expect(await verify(callback())).toEqual(rejected('key-unavailable'));expect(transport).toHaveBeenCalledTimes(3);
  });
});
