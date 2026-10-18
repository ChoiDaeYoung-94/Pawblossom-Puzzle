// 생성자 검사 전용입니다. 실제 소비/적용/운영 재시도 정책으로 사용하지 않습니다.
import {DatabaseSync} from 'node:sqlite';
import {step,matchesFailedConnection,refreshClosedConnections,type PhaseTrace,type ConstructorAttempt} from './ledgerDiagnostics.ts';

function observeClose<T>(trace:PhaseTrace,from:number,state:ConstructorAttempt,create:()=>T):T {
  const prototype=DatabaseSync.prototype;let descriptor:PropertyDescriptor|undefined,attempted=false;
  try{
    descriptor=Object.getOwnPropertyDescriptor(prototype,'close');
    if(!descriptor||typeof descriptor.value!=='function'||!descriptor.configurable)throw new Error('검사 close 관측 준비 실패');
    const original=descriptor.value;attempted=true;
    Object.defineProperty(prototype,'close',{...descriptor,value:function(this:unknown,...args:unknown[]){
      let matched=false;try{matched=matchesFailedConnection(trace,from,this);if(matched)state.closeObserved=true;}catch{}
      try{const result=Reflect.apply(original,this,args);try{if(matched)state.closeSucceeded=true;}catch{}return result;}
      catch(error){try{if(matched)state.closeFailed=true;}catch{}throw error;}
    }});state.closeHookInstalled=true;
  }catch{}
  try{return create();}
  finally{if(attempted&&descriptor)try{Object.defineProperty(prototype,'close',descriptor);state.closeHookRestored=true;}catch{}}
}

export function retryLedgerOpen<T>(trace:PhaseTrace|null,phase:'reward-open'|'round-open',enabled:boolean,create:()=>T,wait:(ms:number)=>void,onRetry?:(attempt:number)=>boolean):T {
  if(!trace||!enabled)return step(trace,phase,create);
  for(let attempt=1;attempt<=3;attempt++){
    const from=trace.sqliteErrors.length,state:ConstructorAttempt={attempt,opened:false,nativeCount:0,closeObserved:false,closeSucceeded:false,closeFailed:false,closeHookInstalled:false,closeHookRestored:false,retryScheduled:false,waitMs:0};
    trace.constructorAttempts.push(state);
    try{const result=step(trace,phase,()=>observeClose(trace,from,state,create));state.opened=true;return result;}
    catch(error){
      refreshClosedConnections(trace,from);const fresh=trace.sqliteErrors.slice(from);state.nativeCount=fresh.length;
      const eligible=trace.sqliteHook.installation==='installed'&&trace.sqliteHook.installedMethods===5&&!trace.sqliteErrorsTruncated
        &&state.closeHookInstalled&&state.closeHookRestored&&state.closeObserved&&state.closeSucceeded&&!state.closeFailed
        &&fresh.length>0&&fresh.every(row=>row.phase===phase&&row.operation==='database-exec'&&row.errorCode==='ERR_SQLITE_ERROR'&&row.extendedCode===5&&row.baseCode===5&&row.transactionActive===false&&row.connectionClosed===true);
      if(!eligible||attempt===3)throw error;
      try{if(onRetry&&!onRetry(attempt))throw error;state.waitMs=25;wait(25);state.retryScheduled=true;}catch{throw error;}
    }
  }
  throw new Error('검사 생성자 상한 오류');
}
