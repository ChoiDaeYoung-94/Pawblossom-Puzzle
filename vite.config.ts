import { defineConfig } from 'vitest/config';
import packageInfo from './package.json' with { type: 'json' };
import {fileURLToPath} from 'node:url';

export default defineConfig(({mode})=>{
  const testTools=mode==='development'||mode==='testing';
  const androidTestAds=mode==='testing';
  const androidTestBilling=mode==='testing';
  return {
    // 파일 원장 검사들의 과도한 병렬 I/O를 제한합니다. 각 테스트 내부의 8worker 경합은 유지합니다.
    test:{maxWorkers:2},
    build:testTools?{rolldownOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),carrierTrial:fileURLToPath(new URL('./carrier-trial.html',import.meta.url))}}}:undefined,
    define:{__APP_VERSION__:JSON.stringify(packageInfo.version),__TEST_TOOLS_ENABLED__:JSON.stringify(testTools),__ANDROID_TEST_ADS_ENABLED__:JSON.stringify(androidTestAds),__ANDROID_TEST_BILLING_ENABLED__:JSON.stringify(androidTestBilling)},
    plugins:[{
      name:'pawblossom-build-info',
      generateBundle(){this.emitFile({type:'asset',fileName:'build-info.json',source:JSON.stringify({testTools,androidTestAds,androidTestBilling})+'\n'});},
    }],
  };
});
