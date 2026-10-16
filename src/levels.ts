import type { LeafPile } from './core';
export interface LevelGoal { kind: number; count: number }
export interface Level { id: number; moves: number; goals: LevelGoal[]; leaves?: LeafPile[] }

const patches=(cells:number[][],layers:1|2=1):LeafPile[]=>cells.map(([row,col])=>({row,col,layers}));
const center=[[2,2],[2,5],[5,2],[5,5]];
const ring=[...center,[3,3],[4,4]];
const edges=[...ring,[1,4],[6,3]];

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
];
