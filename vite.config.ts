import { defineConfig } from 'vite';

export default defineConfig(({mode})=>{
  const testTools=mode==='development'||mode==='testing';
  const androidTestAds=mode==='testing';
  return {
    define:{__TEST_TOOLS_ENABLED__:JSON.stringify(testTools),__ANDROID_TEST_ADS_ENABLED__:JSON.stringify(androidTestAds)},
    plugins:[{
      name:'pawblossom-build-info',
      generateBundle(){this.emitFile({type:'asset',fileName:'build-info.json',source:JSON.stringify({testTools,androidTestAds})+'\n'});},
    }],
  };
});
