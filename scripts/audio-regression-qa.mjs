import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// 기존 회귀 검사를 메모리에서 경로/날짜만 바꿔 실행해 과거 기록을 보존합니다.
// PAWBLOSSOM_PLAYWRIGHT_MODULE 설정과 포트 5173 Vite 개발 서버가 필요합니다.
assert(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE,'Playwright 절대 모듈 경로가 필요합니다.');
const hashes={};
function source(name,replacements){
  const original=fs.readFileSync(`scripts/${name}`,'utf8');
  hashes[name]=createHash('sha256').update(original).digest('hex');
  let code=original;
  for(const [before,after] of replacements){assert(code.includes(before),`${name}: 출력 치환 지점이 바뀌었습니다.`);code=code.replaceAll(before,after);}
  return code;
}
function run(code){return execFileSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',maxBuffer:4*1024*1024});}
const keyboard=JSON.parse(run(source('board-keyboard-qa.mjs',[
  ['2026-10-15','2026-10-16'],['Vite testing','Vite development'],
  ['docs/performance/board-keyboard-20261015.json','docs/audio/recovery-keyboard-20261016.json'],
  ['docs/screenshots/keyboard-','docs/audio/recovery-keyboard-20261016-'],
])));
const round=JSON.parse(run(source('round-save-qa.mjs',[
  ['docs/screenshots/round-save-recovery-mobile.png','docs/audio/recovery-round-20261016.png'],
])));
round.dateKst='2026-10-16';round.browser=keyboard.browser;round.environment='격리 headless Chrome·Vite development·실제 Phaser·저장 오류 주입. Android 실기기 검증 아님.';
fs.writeFileSync('docs/audio/recovery-round-20261016.json',JSON.stringify(round,null,2)+'\n');
fs.writeFileSync('docs/audio/recovery-regression-20261016.json',JSON.stringify({dateKst:'2026-10-16',scriptsSha256:hashes,
  audioSha256:createHash('sha256').update(fs.readFileSync('src/audio/AudioManager.ts')).digest('hex'),
  keyboardChecks:keyboard.checks.length,roundChecks:round.checks,pageerrors:[...keyboard.pageerrors,...round.pageerrors]},null,2)+'\n');
console.log(JSON.stringify({keyboardChecks:keyboard.checks.length,roundChecks:round.checks},null,2));
