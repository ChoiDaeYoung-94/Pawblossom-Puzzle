import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.choidaeyoung.pawblossompuzzle',
  appName: 'Pawblossom Puzzle',
  webDir: 'dist',
  android: { backgroundColor: '#f6f5ed' },
  // env(safe-area-inset-*)와 기존 Native 여백 처리를 사용합니다.
  plugins: { SystemBars: { insetsHandling: 'native' } },
};
export default config;
