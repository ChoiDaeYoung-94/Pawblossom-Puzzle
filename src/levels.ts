import type { BoardMask, LeafPile } from './core';
import type { TextKey } from './i18n';
export interface LevelGoal { kind: number; count: number }
export interface Level { id: number; moves: number; goals: LevelGoal[]; leaves?: LeafPile[]; mask?: BoardMask }

const patches=(cells:number[][],layers:1|2=1):LeafPile[]=>cells.map(([row,col])=>({row,col,layers}));
const center=[[2,2],[2,5],[5,2],[5,5]];
const ring=[...center,[3,3],[4,4]];
const edges=[...ring,[1,4],[6,3]];
const trail=[[1,1],[2,2],[3,3],[4,4],[5,5],[6,6]];
const border=[[1,1],[1,3],[1,5],[3,6],[5,6],[6,4],[6,2],[4,1]];
const crossed=[...center,[1,3],[1,4],[3,1],[4,1],[3,6],[4,6],[6,3],[6,4]];
const mixed=(cells:number[][]):LeafPile[]=>cells.map(([row,col],i)=>({row,col,layers:i%2===0?2:1}));

// 31~35 비정형 보드는 canonical 활성 칸만 사용합니다. 기존 1~30 정의는 그대로 유지합니다.
const shape=(rows:string[]):BoardMask=>rows.map(row=>[...row].map(cell=>cell==='#'));
const shapes={
  rounded:shape(['..####..','.######.','########','########','########','########','.######.','..####..']),
  pond:shape(['########','########','########','###..###','###..###','########','########','########']),
  hourglass:shape(['########','########','.######.','..####..','..####..','.######.','########','########']),
  u:shape(['##....##','##....##','##....##','########','########','########','########','########']),
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
  {id:11,moves:28, goals:[{kind:5,count:20},{kind:2,count:16}],leaves:patches(trail)},
  {id:12,moves:28, goals:[{kind:0,count:24},{kind:3,count:18}],leaves:patches(border)},
  {id:13,moves:28, goals:[{kind:1,count:20},{kind:4,count:18}],leaves:mixed(trail)},
  {id:14,moves:30, goals:[{kind:2,count:24},{kind:5,count:20}],leaves:mixed(border)},
  {id:15,moves:30, goals:[{kind:0,count:18},{kind:2,count:18},{kind:5,count:18}]},
  {id:16,moves:30, goals:[{kind:3,count:26},{kind:1,count:20}],leaves:patches(trail,2)},
  {id:17,moves:30, goals:[{kind:4,count:24},{kind:0,count:22}],leaves:patches(border,2)},
  {id:18,moves:30, goals:[{kind:5,count:26},{kind:2,count:22}],leaves:patches(crossed)},
  {id:19,moves:32, goals:[{kind:0,count:28},{kind:1,count:22}],leaves:mixed(crossed)},
  {id:20,moves:32, goals:[{kind:2,count:28},{kind:3,count:24}],leaves:patches(crossed,2)},
  {id:21,moves:28, goals:[{kind:4,count:26},{kind:5,count:22}],leaves:patches(border)},
  {id:22,moves:30, goals:[{kind:0,count:24},{kind:1,count:24},{kind:2,count:18}]},
  {id:23,moves:30, goals:[{kind:3,count:30},{kind:4,count:22}],leaves:mixed(border)},
  {id:24,moves:32, goals:[{kind:5,count:30},{kind:0,count:24}],leaves:mixed(crossed)},
  {id:25,moves:32, goals:[{kind:1,count:30},{kind:2,count:24}],leaves:patches(crossed,2)},
  {id:26,moves:30, goals:[{kind:3,count:24},{kind:4,count:24},{kind:5,count:24}]},
  {id:27,moves:32, goals:[{kind:0,count:32},{kind:2,count:26}],leaves:patches(border,2)},
  {id:28,moves:32, goals:[{kind:1,count:32},{kind:3,count:26}],leaves:mixed(crossed)},
  {id:29,moves:34, goals:[{kind:4,count:32},{kind:5,count:28}],leaves:patches(crossed,2)},
  {id:30,moves:34, goals:[{kind:0,count:34},{kind:5,count:28}],leaves:patches(crossed,2)},
  {id:31,moves:26,goals:[{"kind":1,"count":12},{"kind":2,"count":12}],mask:shapes.rounded},
  {id:32,moves:28,goals:[{"kind":0,"count":16},{"kind":5,"count":14}],mask:shapes.pond},
  {id:33,moves:28,goals:[{"kind":3,"count":14},{"kind":4,"count":14}],mask:shapes.hourglass},
  {id:34,moves:28,goals:[{"kind":2,"count":16},{"kind":5,"count":12}],mask:shapes.u},
  {id:35,moves:30,goals:[{"kind":0,"count":18},{"kind":1,"count":16}],mask:shapes.slant},
];

export const LEVEL_COUNT=levels.length;
export const chapters:{id:number;first:number;last:number;title:TextKey}[]=[
  {id:1,first:1,last:10,title:'chapterMeadow'},
  {id:2,first:11,last:20,title:'chapterPath'},
  {id:3,first:21,last:30,title:'chapterSunshine'},
  {id:4,first:31,last:35,title:'chapterPond'},
];
export const chapterForLevel=(id:number)=>chapters.find(chapter=>id>=chapter.first&&id<=chapter.last)??chapters[0];
