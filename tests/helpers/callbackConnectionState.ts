// 테스트 전용입니다. native receiver·SQL·경로·원문 오류를 영수증에 넣지 않습니다.
import {DatabaseSync} from 'node:sqlite';
import type {SpanRecorder} from './ledgerTransactionSpans.ts';

const nativeExec=Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'exec')?.value;
const official={
  isOpen:Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'isOpen')?.get,
  isTransaction:Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'isTransaction')?.get
};
type Reason='not-reached'|'unverified'|'receiver-unavailable'|'unsupported'|'read-failed'|'closed';
export interface CallbackConnectionState {
  isOpen:boolean|null;isOpenReason:Reason|null;
  isTransaction:boolean|null;isTransactionReason:Reason|null;
}
type Accessors=Partial<Record<'isOpen'|'isTransaction',()=>unknown>>;
const unavailable=(reason:Reason):CallbackConnectionState=>({isOpen:null,isOpenReason:reason,isTransaction:null,isTransactionReason:reason});

/** 검증된 native accessor의 읽기 결과만 제한 DTO로 바꿉니다. 닫힘에서는 transaction getter를 호출하지 않습니다. */
export function readCallbackConnectionState(open:(()=>unknown)|undefined,transaction:(()=>unknown)|undefined):CallbackConnectionState {
  if(!open)return unavailable('unsupported');
  let isOpen:unknown;try{isOpen=open();}catch{return unavailable('read-failed');}
  if(typeof isOpen!=='boolean')return unavailable('read-failed');
  if(!isOpen)return {isOpen:false,isOpenReason:null,isTransaction:null,isTransactionReason:'closed'};
  if(!transaction)return {isOpen:true,isOpenReason:null,isTransaction:null,isTransactionReason:'unsupported'};
  let active:unknown;try{active=transaction();}catch{return {isOpen:true,isOpenReason:null,isTransaction:null,isTransactionReason:'read-failed'};}
  return {isOpen:true,isOpenReason:null,isTransaction:typeof active==='boolean'?active:null,isTransactionReason:typeof active==='boolean'?null:'read-failed'};
}

export function createCallbackConnectionProbe(enabled:boolean,spans?:{recorder:SpanRecorder;phase:()=>unknown}){
  const spanFailure=()=>{try{if(enabled&&spans)spans.recorder.report.observationFailed=true;}catch{}};
  const receipt=enabled?{afterBegin:unavailable('not-reached'),afterClose:unavailable('not-reached')}:undefined;
  const verified=new WeakMap<object,Accessors>();
  let armed=false,reached=false,target:WeakRef<object>|undefined;
  const verify=(receiver:unknown)=>{
    try{
      if(receiver===null||(typeof receiver!=='object'&&typeof receiver!=='function')||verified.has(receiver))return;
      const accessors:Accessors={};
      // 원본 native exec의 성공 반환으로 확인한 receiver에만 Node22/24 공식 accessor를 보존합니다.
      for(const key of ['isOpen','isTransaction'] as const){
        if(official[key])accessors[key]=official[key];
        else {const descriptor=Object.getOwnPropertyDescriptor(receiver,key);if(descriptor?.configurable===false&&typeof descriptor.get==='function')accessors[key]=descriptor.get;}
      }
      verified.set(receiver,accessors);
    }catch{}
  };
  const read=():CallbackConnectionState=>{
    try{
      if(!target)return unavailable('unverified');
      const receiver=target.deref();if(!receiver)return unavailable('receiver-unavailable');
      const accessors=verified.get(receiver);if(!accessors)return unavailable('unverified');
      return readCallbackConnectionState(accessors.isOpen?()=>Reflect.apply(accessors.isOpen!,receiver,[]):undefined,accessors.isTransaction?()=>Reflect.apply(accessors.isTransaction!,receiver,[]):undefined);
    }catch{return unavailable('read-failed');}
  };
  const record=(point:'afterBegin'|'afterClose')=>{try{if(receipt)receipt[point]=read();}catch{}};
  return {receipt,
    arm(){if(enabled&&!reached)armed=true;},
    observe<T>(sql:unknown,receiver:unknown,args:unknown[],around:(invoke:()=>unknown)=>T):T {
      let nativeReturned=false;
      // 성공 표식은 이 원본 호출 안에서만 생성합니다. callback의 반환·함수 참조만으로는 검증하지 않습니다.
      const invoke=()=>{
        let token:ReturnType<SpanRecorder['before']>=null;
        if(enabled&&spans)try{token=spans.recorder.before(sql,receiver,spans.phase());}catch{spanFailure();}
        try{
          const result=Reflect.apply(nativeExec,receiver,args);nativeReturned=true;
          if(enabled&&spans)try{spans.recorder.after(token,'returned',nativeExec);spans.recorder.nativeReturned?.('exec',sql,receiver,nativeExec);}catch{spanFailure();}
          return result;
        }catch(error){if(enabled&&spans)try{spans.recorder.after(token,'threw',nativeExec,error);}catch{spanFailure();}throw error;}
      };
      if(!enabled)return around(invoke);
      const selected=armed&&!reached&&sql==='BEGIN IMMEDIATE';
      if(selected){armed=false;reached=true;try{if(receiver!==null&&(typeof receiver==='object'||typeof receiver==='function'))target=new WeakRef(receiver);}catch{}}
      let result:T;
      try{result=around(invoke);}catch(error){if(nativeReturned)verify(receiver);if(selected)record('afterBegin');throw error;}
      if(nativeReturned)verify(receiver);if(selected)record('afterBegin');return result;
    },
    afterClose(){if(enabled&&reached)record('afterClose');}
  };
}
