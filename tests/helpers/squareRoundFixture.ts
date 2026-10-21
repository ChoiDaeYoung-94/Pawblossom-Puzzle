import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,createHmac} from 'node:crypto';
import {RoundLedger,type RoundSnapshot} from '../../server/game/roundLedger';
import {startState,type Command} from '../../server/game/roundState';
import {BoardEngine} from '../../src/core';

/** 현재 V2 엔진으로 새 상태·명령 영수증을 만듭니다. 옛 DB의 해시/상태를 덮어 호환을 가장하지 않습니다.
 * 이전 보상 voucher와 결합할 합성 회차 ID만 재사용하고, 보드·RNG·점수·명령은 새로 계산합니다. */
export function squareRoundFixture(legacy:any,key:Uint8Array,owner:{ownerId:string},epoch:number){
  const directory=mkdtempSync(join(tmpdir(),'pawblossom-square-fixture-')),path=join(directory,'round.sqlite');
  let ledger:RoundLedger|undefined,db:DatabaseSync|undefined;
  const mac=(domain:string,value:string)=>createHmac('sha256',createHmac('sha256',key).update('pawblossom-round-v1\0'+domain).digest()).update(value).digest('hex');
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  try{
    ledger=new RoundLedger({databasePath:path,serverKey:key,environment:'test',now:()=>epoch});ledger.close();ledger=undefined;
    db=new DatabaseSync(path);
    const profile=String(db.prepare('SELECT profile FROM round_meta').get()!.profile),ownerHash=mac('owner',owner.ownerId);
    for(const [name,metadata] of Object.entries(legacy.rounds) as [string,RoundSnapshot][]){
      const state=startState(metadata.state.level.id,1),id=metadata.roundId,createHash=mac('create',JSON.stringify([ownerHash,'fixture-'+name]));
      const digest=hash(JSON.stringify({levelId:state.level.id})),json=JSON.stringify(state);
      const signature=mac('state',JSON.stringify([profile,id,ownerHash,createHash,digest,epoch,epoch+3_600_000,0,json]));
      db.prepare('INSERT INTO round_rounds VALUES(?,?,?,?,?,?,?,?,?)').run(id,ownerHash,createHash,digest,epoch,epoch+3_600_000,0,json,signature);
    }
    ledger=new RoundLedger({databasePath:path,serverKey:key,environment:'test',now:()=>epoch});
    const rounds:Record<string,RoundSnapshot>={};
    for(const [name,metadata] of Object.entries(legacy.rounds) as [string,RoundSnapshot][]){
      const get=ledger.get(owner,{roundId:metadata.roundId});if(get.kind!=='round-snapshot')throw Error('square-fixture-read');let snapshot=get.snapshot;
      for(let turn=0;turn<40&&snapshot.state.status==='active'&&name!=='active';turn++){
        const engine=new BoardEngine(8,8,()=>{throw Error('fixture-query-rng');},snapshot.state as never);
        const moves=engine.legalMoves();
        // 실패 후 +5 경계를 위한 합성 경로입니다. seed/난수를 바꾸지 않고 현재 보이는 목표 피해가 작은 교환을 고릅니다.
        const ranked=name==='failed'?moves.map(move=>{
          const {a,b}=move,x=engine.board[a.row][a.col],y=engine.board[b.row][b.col];
          [engine.board[a.row][a.col],engine.board[b.row][b.col]]=[y,x];
          let score=0;
          try{
            const matched=engine.findMatches();score=matched.length+(x.special||y.special?10_000:0);
            for(const p of matched){
              if(snapshot.state.level.goals.some(g=>g.kind===engine.board[p.row][p.col].kind))score+=100;
              for(const [dr,dc] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]])if(engine.leaves[p.row+dr]?.[p.col+dc])score+=1000;
            }
          }finally{[engine.board[a.row][a.col],engine.board[b.row][b.col]]=[x,y];}
          return {move,score};
        }).sort((a,b)=>a.score-b.score):undefined;
        const command:Command=name==='abandoned'?{type:'abandon'}:{type:'swap',...(ranked?.[0].move??moves[(turn*7)%moves.length])};
        const result=ledger.command(owner,{roundId:snapshot.roundId,operationId:'fixture-turn-'+turn,expectedRevision:snapshot.revision,command});
        if(result.kind!=='command-result')throw Error('square-fixture-command');snapshot=result.snapshot;
      }
      if(snapshot.state.status!==name)throw Error(`square-fixture-status:${name}:${snapshot.state.status}`);
      rounds[name]=snapshot;
    }
    ledger.close();ledger=undefined;
    const round=db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t=>({name:String(t.name),sql:String(t.sql),rows:db!.prepare('SELECT * FROM '+t.name+' ORDER BY 1').all()}));
    // 별도 계약: 같은 V2 엔진/profile source를 가진 스키마1 파일의 기존 스키마2 이전만 확인합니다.
    const schema1=JSON.parse(JSON.stringify(round)).filter((t:any)=>t.name!=='round_rewards');
    const oldProfile=profile.replace('"version":2','"version":1');
    for(const table of schema1){
      if(table.name==='round_ops')table.sql=legacy.round.find((t:any)=>t.name==='round_ops').sql;
      for(const row of table.rows){
        if(table.name==='round_meta'){row.profile=oldProfile;row.meta_mac=mac('meta',JSON.stringify([oldProfile,row.high_water]));}
        if(table.name==='round_rounds')row.state_mac=mac('state',JSON.stringify([oldProfile,row.round_id,row.owner_hash,row.create_hash,row.create_digest,row.created_at,row.expires_at,row.revision,row.state_json]));
        if(table.name==='round_ops')row.receipt_mac=mac('receipt',JSON.stringify([oldProfile,row.round_id,row.op_hash,row.request_digest,row.revision,row.outcome]));
      }
    }
    return {round,rounds,schema1};
  }finally{
    ledger?.close();db?.close();
    if(!resolve(directory).startsWith(resolve(tmpdir())+sep)||!directory.includes('pawblossom-square-fixture-'))throw Error('fixture-cleanup-path');
    rmSync(directory,{recursive:true,force:true});
  }
}
