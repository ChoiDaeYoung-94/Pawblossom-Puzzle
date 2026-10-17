// 합성 키는 테스트 프로세스 메모리에서만 생성합니다. Google 개인키/운영 설정 없음.
import {generateKeyPairSync, sign, type KeyObject} from 'node:crypto';
import type {AdmobPolicy} from '../../server/ads/admobSsv';
export const policy:AdmobPolicy={environment:'synthetic',adUnits:['1234567890','2345678901'],adNetworks:['5450213213286189855','1215381445328257950'],rewardAmount:'5',rewardItem:'moves'};
export const epoch=1792200000000;
export function keyPair(curve='prime256v1') {return generateKeyPairSync('ec',{namedCurve:curve});}
export const pair=keyPair();
export function keyEntry(key:KeyObject=pair.publicKey,keyId=3901585526) {
  return {keyId,base64:key.export({type:'spki',format:'der'}).toString('base64'),pem:key.export({type:'spki',format:'pem'}).toString()};
}
export function keyResponse(entries=[keyEntry()]) {return new Response(JSON.stringify({keys:entries}),{headers:{'content-type':'application/json'}});}
export function fields(patch:Record<string,string>={}) {
  return {ad_network:policy.adNetworks[0],ad_unit:policy.adUnits[0],custom_data:'n'.repeat(43),reward_amount:'5',reward_item:'moves',timestamp:String(epoch),transaction_id:'abcd'.repeat(8),user_id:'u'.repeat(43),...patch};
}
export function callback(patch:Record<string,string>={},key=pair.privateKey,keyId='3901585526',padding=false) {
  const content=Object.entries(fields(patch)).map(([k,v])=>`${k}=${v}`).join('&');
  const sig=sign('sha256',Buffer.from(content),{key,dsaEncoding:'der'});
  const encoded=padding?sig.toString('base64').replace(/\+/g,'-').replace(/\//g,'_'):sig.toString('base64url');
  return `${content}&signature=${encoded}&key_id=${keyId}`;
}
export function signature(raw:string,bytes:Buffer) {return raw.replace(/signature=[^&]+/,`signature=${bytes.toString('base64url')}`);}
/** ECDSA (r,n-s)도 유효함을 검증하기 위한 독립적인 DER 정수 변형입니다. */
export function malleate(raw:string) {
  const bytes=Buffer.from(raw.match(/signature=([^&]+)/)![1],'base64url');
  const rLength=bytes[3], r=bytes.subarray(4,4+rLength), sAt=4+rLength, sLength=bytes[sAt+1];
  const s=BigInt('0x'+bytes.subarray(sAt+2,sAt+2+sLength).toString('hex'));
  const order=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  let hex=(order-s).toString(16);if(hex.length%2)hex='0'+hex;
  let other=Buffer.from(hex,'hex');if(other[0]&128)other=Buffer.concat([Buffer.from([0]),other]);
  const body=Buffer.concat([Buffer.from([2,r.length]),r,Buffer.from([2,other.length]),other]);
  return signature(raw,Buffer.concat([Buffer.from([0x30,body.length]),body]));
}
