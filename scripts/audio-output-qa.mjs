import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';

// 선택적 로컬 QA: 설치된 Playwright 모듈 경로와 Chrome을 사용합니다.
// 게임 의존성·CI 필수 환경에 브라우저 자동화 패키지를 추가하지 않습니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const args=process.argv.slice(2);
const baselineRef=args.find(arg=>arg.startsWith('--baseline='))?.split('=')[1]??'221a294';
const minimumGain=Number(args.find(arg=>arg.startsWith('--min-gain-db='))?.split('=')[1]??7);
const maximumGain=Number(args.find(arg=>arg.startsWith('--max-gain-db='))?.split('=')[1]??100);
const output=args.find(arg=>arg.startsWith('--output='))?.slice('--output='.length)??'docs/audio/louder-output-qa.json';
if(!/^[a-f0-9]{7,40}$/.test(baselineRef)||!Number.isFinite(minimumGain)||!Number.isFinite(maximumGain)||minimumGain<0||maximumGain<minimumGain)throw Error('비교 기준과 음량 범위를 확인해 주세요.');
const baseline=compile(execFileSync('git',['show',`${baselineRef}:src/audio/AudioManager.ts`],{encoding:'utf8'}));
const current=compile(fs.readFileSync('src/audio/AudioManager.ts','utf8'));
const browser=await chromium.launch({headless:true,channel:process.env.PAWBLOSSOM_CHROME_CHANNEL??'chrome'});
try{
  const page=await browser.newPage();
  const report=await page.evaluate(async({baseline,current})=>{
    const names=['tap','swap','invalid','match','special','win','lose','reward'];
    async function render(code,scenario){
      const ctx=new OfflineAudioContext(1,48000*2,48000);
      // 합성기는 running 상태에만 예약합니다. 오프라인 검사의 예약 단계만 허용합니다.
      Object.defineProperty(ctx,'state',{get:()=> 'running'});
      const previous=window.AudioContext;
      window.AudioContext=function(){return ctx;};
      const exports={};new Function('exports',code)(exports);
      const audio=new exports.AudioManager();
      if(scenario!=='music'&&scenario!=='overlap')audio.setMusicEnabled(false);
      await audio.unlock();
      if(names.includes(scenario))audio.play(scenario,8);
      if(scenario==='overlap'){
        for(let i=0;i<4;i++)audio.note('music',72+i*2,0.05,0.52,0.065);
        names.forEach(name=>audio.play(name,8));
      }
      if(scenario==='muted'){audio.setSfxEnabled(false);audio.play('special');}
      if(scenario==='limit'){
        const source=ctx.createConstantSource();source.offset.value=4;
        source.connect(audio.outputNodes.at(-2));source.start(0.02);source.stop(1);
      }
      const voices=audio.voices.size;
      clearInterval(audio.timer);audio.timer=undefined;
      ctx.onstatechange=null;
      const rendered=await ctx.startRendering(),samples=rendered.getChannelData(0);
      let energy=0,peak=0,clipped=0;
      for(const value of samples){energy+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=1)clipped++;}
      // 오프라인 컨텍스트는 close()를 지원하지 않아 앱 파괴 대신 예약 노드만 정리합니다.
      audio.stopVoices();audio.outputNodes.forEach(node=>node.disconnect());
      document.removeEventListener('visibilitychange',audio.onVisibility);
      window.AudioContext=previous;
      return {rms:Math.sqrt(energy/samples.length),peak,clipped,voices};
    }
    const results=[];
    for(const scenario of ['music',...names,'overlap','muted']){
      const before=await render(baseline,scenario),after=await render(current,scenario);
      results.push({scenario,before,after,rmsGainDb:before.rms?20*Math.log10(after.rms/before.rms):null});
    }
    return {sampleRate:48000,seconds:2,results,limit:await render(current,'limit')};
  },{baseline,current});
  report.baseline=baselineRef;
  for(const result of report.results){
    assert(result.after.clipped===0,`${result.scenario}: 출력 잘림`);
    assert(result.after.peak<0.98,`${result.scenario}: 출력 피크`);
    assert(result.after.voices<=20,`${result.scenario}: 동시음 상한`);
    if(result.scenario==='muted')assert.equal(result.after.rms,0);
    else assert(result.rmsGainDb>minimumGain&&result.rmsGainDb<=maximumGain,`${result.scenario}: 음량 증가가 요청 범위 밖입니다.`);
  }
  assert(report.limit.peak<0.98&&report.limit.clipped===0);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}

