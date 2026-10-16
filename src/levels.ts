export interface LevelGoal { kind: number; count: number }
export interface Level { id: number; moves: number; goals: LevelGoal[] }

// 순서는 저장 데이터의 스테이지 ID와 연결되므로 기존 ID를 재배치하지 않습니다.
export const levels: Level[] = [
  {id:1, moves:26, goals:[{kind:0,count:12},{kind:1,count:10}]},
  {id:2, moves:24, goals:[{kind:1,count:12},{kind:2,count:10}]},
  {id:3, moves:24, goals:[{kind:2,count:14},{kind:3,count:10}]},
  {id:4, moves:24, goals:[{kind:3,count:14},{kind:4,count:12}]},
  {id:5, moves:24, goals:[{kind:4,count:16},{kind:5,count:12}]},
  {id:6, moves:24, goals:[{kind:5,count:16},{kind:0,count:12}]},
  {id:7, moves:24, goals:[{kind:0,count:18},{kind:1,count:14}]},
  {id:8, moves:24, goals:[{kind:1,count:18},{kind:2,count:14}]},
  {id:9, moves:24, goals:[{kind:2,count:20},{kind:3,count:14}]},
  {id:10,moves:24, goals:[{kind:3,count:20},{kind:4,count:16}]},
];
