import type { BoardMask, LeafPile, Position } from './core';
import type { TextKey } from './i18n';
export interface LevelGoal { kind: number; count: number }
export interface Level { id: number; moves: number; goals: LevelGoal[]; leaves?: LeafPile[]; mask?: BoardMask; crates?:Position[] }

const patches=(cells:number[][],layers:1|2=1):LeafPile[]=>cells.map(([row,col])=>({row,col,layers}));
const center=[[2,2],[2,5],[5,2],[5,5]];
const ring=[...center,[3,3],[4,4]];
const edges=[...ring,[1,4],[6,3]];
const trail=[[1,1],[2,2],[3,3],[4,4],[5,5],[6,6]];
const border=[[1,1],[1,3],[1,5],[3,6],[5,6],[6,4],[6,2],[4,1]];
const crossed=[...center,[1,3],[1,4],[3,1],[4,1],[3,6],[4,6],[6,3],[6,4]];
const mixed=(cells:number[][]):LeafPile[]=>cells.map(([row,col],i)=>({row,col,layers:i%2===0?2:1}));

// 31~35 비정형 도입 형태를 유지하며 #219에서 목표·이동 파형을 재설계했습니다.
const shape=(rows:string[]):BoardMask=>rows.map(row=>[...row].map(cell=>cell==='#'));
const shapes={
  rounded:shape(['..####..','.######.','########','########','########','########','.######.','..####..']),
  pond:shape(['########','########','########','###..###','###..###','########','########','########']),
  hourglass:shape(['########','########','.######.','..####..','..####..','.######.','########','########']),
  u:shape(['##....##','##....##','##....##','########','########','########','########','########']),
  // 첫 U자 판만 양팔을 3칸으로 열어 가로 매치와 특수 생성 선택을 익힙니다.
  uIntro:shape(['###..###','###..###','###..###','########','########','########','########','########']),
  slant:shape(['#######.','#######.','.######.','.######.','.######.','.######.','.#######','.#######']),
};

// 순서는 저장 데이터의 스테이지 ID와 연결되므로 기존 ID를 재배치하지 않습니다.
export const levels: Level[] = [
  {id:1, moves:26, goals:[{kind:0,count:12},{kind:1,count:10}]},
  {id:2, moves:24, goals:[{kind:1,count:12},{kind:2,count:10}]},
  {id:3, moves:24, goals:[{kind:2,count:14},{kind:3,count:10}]},
  {id:4, moves:26, goals:[{kind:3,count:14},{kind:4,count:12}],leaves:patches(center)},
  {id:5, moves:26, goals:[{kind:4,count:16},{kind:5,count:12}],leaves:patches(ring)},
  {id:6, moves:28, goals:[{kind:5,count:16},{kind:0,count:12}],leaves:patches(center,2)},
  {id:7, moves:28, goals:[{kind:0,count:18},{kind:1,count:14}],leaves:patches(ring,2)},
  {id:8, moves:28, goals:[{kind:1,count:18},{kind:2,count:14}],leaves:patches(edges)},
  {id:9, moves:30, goals:[{kind:2,count:20},{kind:3,count:14}],leaves:patches(edges,2)},
  {id:10,moves:30, goals:[{kind:3,count:20},{kind:4,count:16}],leaves:patches(edges,2)},
  // 11~30은 출시 전 난이도 검토용 콘텐츠 초안입니다.
  {id:11,moves:28, goals:[{kind:5,count:22},{kind:2,count:18}],leaves:patches(trail)},
  {id:12,moves:28, goals:[{kind:0,count:26},{kind:3,count:20}],leaves:patches(border)},
  {id:13,moves:26, goals:[{kind:1,count:24},{kind:4,count:20}],leaves:mixed(trail)},
  {id:14,moves:28, goals:[{kind:2,count:28},{kind:5,count:22}],leaves:mixed(border)},
  {id:15,moves:28, goals:[{kind:0,count:22},{kind:2,count:22},{kind:5,count:22}]},
  {id:16,moves:28, goals:[{kind:3,count:28},{kind:1,count:22}],leaves:patches(trail,2)},
  {id:17,moves:28, goals:[{kind:4,count:28},{kind:0,count:24}],leaves:patches(border,2)},
  {id:18,moves:28, goals:[{kind:5,count:30},{kind:2,count:24}],leaves:patches(crossed)},
  {id:19,moves:30, goals:[{kind:0,count:30},{kind:1,count:26}],leaves:mixed(crossed)},
  {id:20,moves:30, goals:[{kind:2,count:32},{kind:3,count:26}],leaves:patches(crossed,2)},
  {id:21,moves:30, goals:[{kind:4,count:26},{kind:5,count:22}],leaves:patches(border)},
  {id:22,moves:30, goals:[{kind:0,count:24},{kind:1,count:24},{kind:2,count:20}]},
  {id:23,moves:28, goals:[{kind:3,count:32},{kind:4,count:24}],leaves:mixed(border)},
  {id:24,moves:30, goals:[{kind:5,count:32},{kind:0,count:26}],leaves:mixed(crossed)},
  {id:25,moves:30, goals:[{kind:1,count:34},{kind:2,count:26}],leaves:patches(crossed,2)},
  {id:26,moves:30, goals:[{kind:3,count:26},{kind:4,count:26},{kind:5,count:24}]},
  {id:27,moves:30, goals:[{kind:0,count:34},{kind:2,count:28}],leaves:patches(border,2)},
  {id:28,moves:30, goals:[{kind:1,count:36},{kind:3,count:28}],leaves:mixed(crossed)},
  {id:29,moves:32, goals:[{kind:4,count:36},{kind:5,count:30}],leaves:patches(crossed,2)},
  {id:30,moves:32, goals:[{kind:0,count:38},{kind:5,count:30}],leaves:patches(crossed,2)},
  {id:31,moves:26,goals:[{"kind":1,"count":22},{"kind":2,"count":20}],mask:shapes.rounded},
  {id:32,moves:28,goals:[{"kind":0,"count":22},{"kind":5,"count":22}],mask:shapes.pond},
  {id:33,moves:28,goals:[{"kind":3,"count":24},{"kind":4,"count":22}],mask:shapes.hourglass},
  {id:34,moves:30,goals:[{"kind":2,"count":26},{"kind":5,"count":22}],mask:shapes.uIntro},
  {id:35,moves:30,goals:[{"kind":0,"count":28},{"kind":1,"count":24}],mask:shapes.slant},
  // 36~40: 고정 1hit 나무상자. 색 목표와 별개로 모두 제거해야 합니다.
  {id:36,moves:28,goals:[{kind:3,count:24},{kind:5,count:22}],crates:center.map(([row,col])=>({row,col}))},
  {id:37,moves:30,goals:[{kind:2,count:26},{kind:4,count:24}],mask:shapes.rounded,crates:[...center,[3,1],[3,6]].map(([row,col])=>({row,col}))},
  {id:38,moves:30,goals:[{kind:1,count:28},{kind:5,count:24}],mask:shapes.pond,crates:center.map(([row,col])=>({row,col}))},
  {id:39,moves:32,goals:[{kind:0,count:26},{kind:1,count:24}],mask:shapes.hourglass,crates:[[1,1],[1,6],[2,3],[5,4],[6,1],[6,6]].map(([row,col])=>({row,col}))},
  {id:40,moves:34,goals:[{kind:3,count:28},{kind:5,count:26}],mask:shapes.u,crates:[[2,0],[2,7],[4,0],[4,7],[5,1],[5,6],[7,2],[7,5]].map(([row,col])=>({row,col}))},
];


// 각 줄은 한 판의 배치입니다: 형태, 이동, 두 색 목표(0이면 한 색), 낙엽 좌표/겹, 상자 좌표.
// 장마다 1·6번은 회복, 4·9·10번은 도전입니다. 혼합 장애물은 한 색+낙엽+상자로 목표3칸을 지킵니다.
type Plan=[keyof typeof shapes|'square',number,number,number,string,string];
const plans:Plan[]=[
  // 41–50 꽃잎 회랑: 넓은 형태에서 낙엽과 상자를 번갈아 배운 뒤 조합합니다.
  ['square',30,26,22,'111 161 521 551',''],
  ['rounded',29,24,20,'222 252 522 552',''],
  ['pond',30,26,20,'','11 16 61 66'],
  ['square',28,27,0,'222 251 522 551','11 16 61 66'],
  ['hourglass',30,26,22,'112 162 522 552',''],
  ['rounded',32,26,22,'221 251 521 551',''],
  ['u',32,27,20,'','11 16 61 66'],
  ['slant',30,29,22,'222 252 321 351 522 552',''],
  ['pond',29,29,0,'222 252 522 552','11 16 61 66'],
  ['rounded',30,31,0,'222 252 422 452 522 552','11 16 61 66'],
  // 51–60 물결 산책: 연못 단절과 외곽 상자, 열린 중앙을 활용합니다.
  ['pond',32,28,24,'221 251 521 551',''],
  ['square',29,27,24,'','11 16 32 35 61 66'],
  ['pond',30,29,24,'222 252 522 552 612 662',''],
  ['hourglass',29,31,0,'222 252 521 551','11 16 61 66'],
  ['slant',30,31,24,'112 162 322 352 522 552',''],
  ['square',32,28,26,'111 161 521 551',''],
  ['pond',30,31,26,'','11 16 32 35 61 66'],
  ['rounded',29,32,24,'222 252 422 452 522 552',''],
  ['pond',30,32,0,'222 252 422 452 522 552','11 16 61 66'],
  ['u',32,31,0,'322 352 422 452 522 552','11 16 61 66'],
  // 61–70 모래시계 길: 좁은 허리 양쪽을 돌보되 중앙3×3 생성 공간을 남깁니다.
  ['hourglass',32,28,26,'111 161 521 551',''],
  ['rounded',30,29,24,'','11 16 32 35 61 66'],
  ['hourglass',30,31,24,'112 162 322 352 522 552',''],
  ['slant',28,32,0,'222 252 422 452','11 16 61 66'],
  ['square',29,34,26,'112 162 222 252 522 552 612 662',''],
  ['pond',33,30,26,'221 251 521 551',''],
  ['hourglass',31,32,24,'','11 16 53 54 61 66'],
  ['u',32,32,24,'322 352 422 452 522 552',''],
  ['hourglass',30,34,0,'222 252 422 452 522 552','11 16 61 66'],
  ['slant',30,35,0,'222 252 322 352 422 452 522 552','11 16 61 66'],
  // 71–80 숲의 갈림길: U자 두 팔과 아래 광장을 번갈아 회복/도전합니다.
  ['u',34,30,26,'321 351 521 551',''],
  ['slant',30,31,26,'','11 16 32 35 61 66'],
  ['u',32,32,26,'112 162 322 352 522 552',''],
  ['rounded',29,34,0,'222 252 422 452 522 552','11 16 61 66'],
  ['pond',30,34,27,'112 162 222 252 522 552 612 662',''],
  ['square',33,32,28,'111 161 321 351 521 551',''],
  ['u',33,34,26,'','11 16 30 37 61 66'],
  ['hourglass',30,36,26,'112 162 322 352 422 452 522 552',''],
  ['u',32,35,0,'322 352 422 452 522 552','11 16 61 66'],
  ['rounded',30,36,0,'222 252 322 352 422 452 522 552','11 16 61 66'],
  // 81–90 비스듬한 언덕: 다른 열의 낙하와 특수 직선을 연결합니다.
  ['slant',34,32,28,'221 251 521 551',''],
  ['pond',31,32,27,'','11 16 32 35 61 66'],
  ['slant',31,36,26,'112 162 222 252 522 552 612 662',''],
  ['hourglass',29,35,0,'222 252 422 452 522 552','11 16 61 66'],
  ['square',30,37,27,'112 162 222 252 322 352 522 552',''],
  ['rounded',34,34,28,'221 251 421 451 521 551',''],
  ['slant',31,36,27,'','11 16 32 35 61 66'],
  ['u',33,36,27,'112 162 322 352 422 452 522 552',''],
  ['slant',31,36,0,'222 252 322 352 422 452 522 552','11 16 61 66'],
  ['pond',30,34,0,'222 252 322 352 422 452 522 552','11 16 61 66'],
  // 91–100 꽃빛 축제: 다섯 형태를 재방문하고 마지막 혼합 목표를 완성합니다.
  ['rounded',34,34,30,'111 161 321 351 521 551',''],
  ['hourglass',32,36,27,'','11 16 32 35 61 66'],
  ['pond',31,37,27,'112 162 222 252 522 552 612 662',''],
  ['u',32,36,0,'322 352 422 452 522 552','11 16 61 66'],
  ['slant',31,37,29,'112 162 222 252 322 352 522 552',''],
  ['square',34,36,30,'111 161 221 251 521 551',''],
  ['rounded',31,37,29,'','11 16 32 35 61 66'],
  ['hourglass',31,39,29,'112 162 222 252 322 352 522 552',''],
  ['pond',31,38,0,'222 252 322 352 422 452 522 552','11 16 61 66'],
  ['u',34,35,0,'322 352 422 452 522 552 622 652','11 16 61 66'],
];
for(const [index,[form,moves,a,b,leafSpec,crateSpec]] of plans.entries()){
  const id=index+41,goals=[{kind:id%6,count:a},...(b?[{kind:(id+3)%6,count:b}]:[])];
  const leaves=leafSpec?leafSpec.split(' ').map(code=>({row:Number(code[0]),col:Number(code[1]),layers:Number(code[2]) as 1|2})):undefined;
  const crates=crateSpec?crateSpec.split(' ').map(code=>({row:Number(code[0]),col:Number(code[1])})):undefined;
  levels.push({id,moves,goals,...(form==='square'?{}:{mask:shapes[form]}),...(leaves?{leaves}:{}),...(crates?{crates}:{})});
}

export const LEVEL_COUNT=levels.length;
export const chapters:{id:number;first:number;last:number;title:TextKey}[]=[
  {id:1,first:1,last:10,title:'chapterMeadow'},
  {id:2,first:11,last:20,title:'chapterPath'},
  {id:3,first:21,last:30,title:'chapterSunshine'},
  {id:4,first:31,last:35,title:'chapterPond'},
  {id:5,first:36,last:40,title:'chapterCrates'},
  {id:6,first:41,last:50,title:'chapterPetals'},
  {id:7,first:51,last:60,title:'chapterRipples'},
  {id:8,first:61,last:70,title:'chapterHourglass'},
  {id:9,first:71,last:80,title:'chapterFork'},
  {id:10,first:81,last:90,title:'chapterHills'},
  {id:11,first:91,last:100,title:'chapterFestival'},
];
export const chapterForLevel=(id:number)=>chapters.find(chapter=>id>=chapter.first&&id<=chapter.last)??chapters[0];
