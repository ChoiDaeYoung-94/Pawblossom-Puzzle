// 합성 검사 전용입니다. SQL·인수·경로·원문 오류를 관측 결과에 넣지 않습니다.
import {performance} from 'node:perf_hooks';
export interface ClaimBeginObservation {
  stage:'inbox-claim-begin';outcome:'returned'|'threw';elapsedMs:number|null;
  primaryCode:number|null;extendedCode:number|null;
}
export function createCallbackClaimProbe(enabled:boolean,clock:()=>number=()=>performance.now()){
  let armed=false,row:ClaimBeginObservation|undefined;
  const time=()=>{try{const value=clock();return Number.isFinite(value)?value:null;}catch{return null;}};
  const codes=(error:unknown)=>{
    try{const value=error as {code?:unknown;errcode?:unknown};const code=value?.code==='ERR_SQLITE_ERROR'?value.errcode:undefined;
      return typeof code==='number'&&Number.isSafeInteger(code)&&code>=0&&code<=0x7fffffff?{primaryCode:code&255,extendedCode:code}:{primaryCode:null,extendedCode:null};
    }catch{return {primaryCode:null,extendedCode:null};}
  };
  return {
    arm(){if(enabled&&!row)armed=true;},
    observe<T>(sql:unknown,operation:()=>T):T {
      if(!armed||row||sql!=='BEGIN IMMEDIATE')return operation();
      armed=false;const start=time();
      const record=(outcome:ClaimBeginObservation['outcome'],error?:unknown)=>{const end=time();row={stage:'inbox-claim-begin',outcome,elapsedMs:start!==null&&end!==null&&end>=start?end-start:null,...codes(error)};};
      try{const result=operation();record('returned');return result;}
      catch(error){record('threw',error);throw error;}
    },
    snapshot(){return row?{...row}:undefined;},
  };
}
