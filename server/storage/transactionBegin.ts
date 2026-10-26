import type {DatabaseSync} from 'node:sqlite';

const pause=new Int32Array(new SharedArrayBuffer(4));
function idle(db:DatabaseSync):boolean {
  try{return db.isOpen===true&&db.isTransaction===false;}catch{return false;}
}
function busy5(error:unknown):boolean {
  try{
    if(!(error instanceof Error))return false;
    const code=Object.getOwnPropertyDescriptor(error,'code'),number=Object.getOwnPropertyDescriptor(error,'errcode');
    return Boolean(code&&'value' in code&&code.value==='ERR_SQLITE_ERROR'&&number&&'value' in number&&number.value===5);
  }catch{return false;}
}
/** 허용된 멱등 요청의 업무 전 BEGIN만 추가1회 시도합니다. 본문/COMMIT/ROLLBACK은 재실행하지 않습니다.
 * native호출당500ms는 호출자가 유지하며 총진입은 명목상500+25+500ms일 수 있습니다. */
export function beginIdempotentWrite(db:DatabaseSync):void {
  const before=idle(db);
  try{db.exec('BEGIN IMMEDIATE');}
  catch(error){
    // 첫 BEGIN이 실패해 업무를 전혀 실행하지 않은 경계만 허용합니다. 확장 BUSY/알 수 없는 상태는 제외합니다.
    if(!before||!busy5(error)||!idle(db))throw error;
    try{Atomics.wait(pause,0,0,25);}catch{throw error;}
    if(!idle(db))throw error;
    // 추가 진입은 정확히1회입니다. 두 번째 오류는 그대로 전달하며 성공을 강제하지 않습니다.
    db.exec('BEGIN IMMEDIATE');
  }
}
