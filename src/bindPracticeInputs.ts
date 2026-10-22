type Position={row:number,col:number};
interface PracticeActions {
  tap(pos:Position):void;
  swipe(pos:Position,dx:number,dy:number):void;
}

/** 실습 DOM 한 세대의 정상 pointerup만 실행하며, 포인터 click은 중복/취소 여부와 무관하게 무시합니다. */
export function bindPracticeBoard(board:HTMLElement,actions:PracticeActions){
  let pointer:{id:number,x:number,y:number,pos:Position,button:HTMLButtonElement}|undefined;
  let disposed=false;
  const buttons=Array.from(board.querySelectorAll<HTMLButtonElement>('button'));
  const cancel=()=>{
    const down=pointer;pointer=undefined;
    if(down)try{if(down.button.hasPointerCapture(down.id))down.button.releasePointerCapture(down.id);}catch{/* DOM 교체/이미 해제된 capture */}
  };
  const usable=(button:HTMLButtonElement)=>!disposed&&board.isConnected&&!button.disabled;
  for(const button of buttons){
    const pos={row:Number(button.dataset.row),col:Number(button.dataset.col)};
    button.onpointerdown=event=>{
      if(!usable(button)||pointer||event.button!==0||!event.isPrimary)return;
      // 터치 up에서 DOM을 교체한 뒤 브라우저가 모달로 초점을 다시 옮기지 않게 합니다.
      // 정상 탭의 초점은 actions.tap이 새 DOM으로 직접 옮깁니다.
      event.preventDefault();
      pointer={id:event.pointerId,x:event.clientX,y:event.clientY,pos,button};
      try{button.setPointerCapture(event.pointerId);}catch{cancel();}
    };
    const lost=(event:PointerEvent)=>{if(pointer?.id===event.pointerId)cancel();};
    button.onpointercancel=lost;button.onlostpointercapture=lost;
    button.onpointerup=event=>{
      if(!pointer||pointer.id!==event.pointerId||event.button!==0)return;
      const down=pointer;pointer=undefined;
      if(!usable(button)||button!==down.button)return;
      if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
      const rect=button.getBoundingClientRect();
      const dx=event.clientX-down.x,dy=event.clientY-down.y;
      // 정상 capture 종료는 보드 밖에서도 방향만 사용합니다. 실습 모델이 인접 목표를 검증합니다.
      if(Math.hypot(dx,dy)>16){event.preventDefault();actions.swipe(down.pos,dx,dy);}
      else if(event.clientX>=rect.left&&event.clientX<rect.right&&event.clientY>=rect.top&&event.clientY<rect.bottom)actions.tap(down.pos);
    };
    button.onclick=event=>{
      if(!usable(button)||event.button!==0)return;
      // Chrome은 취소/스와이프 뒤 다음 정상 touchup에도 click을 생략할 수 있습니다.
      // 탭은 위 정상 up에서 실행하고, Enter/Space·보조 기술의 detail=0 활성화만 click으로 처리합니다.
      if(event.detail===0){cancel();actions.tap(pos);return;}
    };
  }
  return {cancel,dispose(){
    disposed=true;cancel();
    for(const button of buttons)button.onclick=button.onpointerdown=button.onpointerup=button.onpointercancel=button.onlostpointercapture=null;
  }};
}
