import type Phaser from 'phaser';

// 월드/규칙은480을 유지하고 실제 렌더 버퍼만 두 배로 만듭니다.
export const BOARD_WORLD_SIZE=480;
export const BOARD_RENDER_SCALE=2;
export const BOARD_RENDER_SIZE=BOARD_WORLD_SIZE*BOARD_RENDER_SCALE;

export function configureBoardCamera(camera:Phaser.Cameras.Scene2D.Camera):void {
  camera.setViewport(0,0,BOARD_RENDER_SIZE,BOARD_RENDER_SIZE)
    .setZoom(BOARD_RENDER_SCALE).centerOn(BOARD_WORLD_SIZE/2,BOARD_WORLD_SIZE/2);
  // CREATE/onReady 직후 첫 입력도 올바른 역행렬을 사용해야 합니다.
  camera.preRender();
}
