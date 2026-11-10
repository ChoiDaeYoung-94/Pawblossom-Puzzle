import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.choidaeyoung.pawblossompuzzle',
  appName: 'Pawblossom Puzzle',
  webDir: 'dist',
  android: { backgroundColor: '#10151c' },
  // env(safe-area-inset-*)와 기존 Native 여백 처리를 사용합니다.
  // 어두운 시작 화면·안전 여백 위에는 OS 모드와 관계없이 밝은 시스템 아이콘을 사용합니다.
  plugins: { SystemBars: { insetsHandling: 'native', style: 'DARK' } },
};
export default config;
