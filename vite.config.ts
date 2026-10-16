import { defineConfig } from 'vite';

export default defineConfig(({mode})=>{
  const testTools=mode==='development'||mode==='testing';
  const androidTestAds=mode==='testing';
  const androidTestBilling=mode==='testing';
  return {
    define:{__TEST_TOOLS_ENABLED__:JSON.stringify(testTools),__ANDROID_TEST_ADS_ENABLED__:JSON.stringify(androidTestAds),__ANDROID_TEST_BILLING_ENABLED__:JSON.stringify(androidTestBilling)},
    plugins:[{
      name:'pawblossom-build-info',
      generateBundle(){this.emitFile({type:'asset',fileName:'build-info.json',source:JSON.stringify({testTools,androidTestAds,androidTestBilling})+'\n'});},
    }],
  };
});
