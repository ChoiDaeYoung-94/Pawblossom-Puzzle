import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText,{exports});
  return exports;
}
const {BoardEngine,seededRng}=load('../src/core/BoardEngine.ts');
const {levels}=load('../src/levels.ts');
const args=process.argv.slice(2);
const runs=Number(args.find(arg=>arg.startsWith('--runs='))?.split('=')[1]??100);
if(!Number.isInteger(runs)||runs<1||runs>10000)throw new Error('--runs는 1~10000 정수입니다.');
if(args.some(arg=>arg!=='--baseline'&&!/^--runs=\d+$/.test(arg)))throw new Error('지원 옵션: --baseline --runs=100');
const configs=args.includes('--baseline')?Array.from({length:10},(_,i)=>({id:i+1,moves:i<3?22:24,goals:[{kind:i%6,count:12+Math.floor(i/2)*2},{kind:(i+1)%6,count:10+Math.floor(i/3)*2}]})):levels;

// 현재 보드의 즉시 매치와 특수만 봅니다. swap() 결과나 보충 난수로 후보를 평가하지 않습니다.
function value(engine,move,remaining){
  const {a,b}=move, board=engine.board, x=board[a.row][a.col], y=board[b.row][b.col];
  let score=0;
  if(x.special==='rainbow'||y.special==='rainbow'){
    const other=x.special==='rainbow'?y:x;
    const counts=Array(6).fill(0);
    board.flat().forEach(tile=>{if(other.special==='rainbow'||tile.kind===other.kind)counts[tile.kind]++;});
    score=counts.reduce((sum,count,kind)=>sum+Math.min(count,remaining[kind]),0)+3;
  }else if(x.special&&y.special)score=8;
  else{
    [board[a.row][a.col],board[b.row][b.col]]=[y,x];
    try{
      const matches=engine.findMatches(), counts=Array(6).fill(0);
      matches.forEach(p=>{const tile=board[p.row][p.col];counts[tile.kind]++;if(tile.special)score+=2;});
      score+=counts.reduce((sum,count,kind)=>sum+Math.min(count,remaining[kind]),0);
      if(matches.length>=4)score+=2;
    }finally{[board[a.row][a.col],board[b.row][b.col]]=[x,y];}
  }
  return score;
}
const rows=[];
for(const policy of ['random','goal'])for(const level of configs){
  let wins=0,totalUsed=0,totalShortfall=0;
  const winningMoves=[];
  for(let seed=1;seed<=runs;seed++){
    const engine=new BoardEngine(8,8,seededRng(seed));
    const choose=seededRng(seed+1000000);
    const remaining=Array(6).fill(0);level.goals.forEach(g=>remaining[g.kind]=g.count);
    let used=0;
    while(used<level.moves&&remaining.some(count=>count>0)){
      const moves=engine.legalMoves();
      if(!moves.length)throw new Error('엔진이 이동 없는 보드를 남겼습니다.');
      let candidates=moves;
      if(policy==='goal'){
        const scores=moves.map(move=>value(engine,move,remaining));
        const best=Math.max(...scores);candidates=moves.filter((_,i)=>scores[i]===best);
      }
      const move=candidates[Math.floor(choose()*candidates.length)];
      const result=engine.swap(move.a,move.b);
      if(!result.valid)throw new Error('합법 이동 조회와 교환 결과가 다릅니다.');
      result.collected.forEach((count,kind)=>remaining[kind]=Math.max(0,remaining[kind]-count));used++;
    }
    const shortfall=remaining.reduce((a,b)=>a+b,0);
    totalUsed+=used;totalShortfall+=shortfall;
    if(!shortfall){wins++;winningMoves.push(used);}
  }
  winningMoves.sort((a,b)=>a-b);
  rows.push({policy,level:level.id,runs,wins,winPercent:Math.round(wins/runs*1000)/10,
    meanMoves:Math.round(totalUsed/runs*10)/10,
    medianWinningMoves:winningMoves.length?winningMoves[Math.floor((winningMoves.length-1)/2)]:null,
    meanShortfall:Math.round(totalShortfall/runs*10)/10});
}
console.log(JSON.stringify({schema:1,configuration:args.includes('--baseline')?'baseline':'current',
  seeds:[1,runs],manualShuffle:false,policies:['random','goal'],levels:configs,results:rows},null,2));
