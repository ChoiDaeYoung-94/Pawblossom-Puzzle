import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// 과거 QA 소스/보고서를 보존하며 출력 경로와 기록 날짜만 메모리에서 치환합니다.
// 사용자 Chrome에 연결하지 않고 각 기존 스크립트의 새 headless 프로세스만 사용합니다.
const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const suite=option('suite'),output=option('output');
const suites={
  development:[['board-keyboard'],['round-save'],['save-recovery'],['touch-cancellation'],['readable-controls'],['audio-recovery']],
  testing:[['result-art'],['touch-build'],['billing','--dist'],['test-ads','--dist']],
  production:[['result-art'],['touch-build'],['billing','--dist'],['test-ads','--dist'],['audio-recovery','--production']],
};
assert(suites[suite]&&output,'--suite=development|testing|production 및 --output=새 폴더가 필요합니다.');
assert(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE,'Playwright 절대 모듈 경로가 필요합니다.');
const root=path.resolve(output);
assert(!fs.existsSync(root),'기존 결과 폴더를 덮어쓰지 않습니다.');
fs.mkdirSync(path.join(root,'docs/performance'),{recursive:true});
fs.mkdirSync(path.join(root,'docs/screenshots'),{recursive:true});
fs.mkdirSync(path.join(root,'docs/audio'),{recursive:true});
const dateKst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const report={dateKst,suite,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  scope:'격리 headless Chrome·기존 QA. Android 설치/OS 입력/오디오 포커스/광고 SDK/Play 결제 검증 아님.',scripts:[]};
try{
  for(const [name,...args] of suites[suite]){
    const file=`scripts/${name}-qa.mjs`,original=fs.readFileSync(file,'utf8');
    let code=original.replaceAll('docs/',root.replaceAll('\\','/')+'/docs/').replaceAll("dateKst:'2026-10-15'",`dateKst:'${dateKst}'`);
    if(suite==='development')code=code.replaceAll('Vite testing','Vite development');
    const record={file,sha256:createHash('sha256').update(original).digest('hex'),args};report.scripts.push(record);
    console.log(`${suite}: ${file}`);
    try{
      const result=execFileSync(process.execPath,['--input-type=module','--eval',code,'--',...args],{encoding:'utf8',maxBuffer:16*1024*1024});
      fs.writeFileSync(path.join(root,`${name}.log`),result);record.passed=true;
      if(name==='round-save')fs.writeFileSync(path.join(root,'docs/performance/round-save.json'),result);
    }catch(error){
      record.passed=false;fs.writeFileSync(path.join(root,`${name}.log`),(error.stdout??'')+'\n'+(error.stderr??''));throw error;
    }
  }
}finally{
  fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
