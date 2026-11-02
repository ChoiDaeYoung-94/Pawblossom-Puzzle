// 검사에서 CallbackInbox.close의 반환만 관측합니다. native DB isOpen 관측이 아닙니다.
export function createCallbackCloseReceipt(enabled:boolean){
  const receipt=enabled?{outcome:'not-attempted' as 'not-attempted'|'returned'|'threw'}:undefined;
  return {receipt,close(resource:{close():void}|undefined){
    if(!resource)return;
    try{resource.close();}catch(error){if(receipt)receipt.outcome='threw';throw error;}
    if(receipt)receipt.outcome='returned';
  }};
}
