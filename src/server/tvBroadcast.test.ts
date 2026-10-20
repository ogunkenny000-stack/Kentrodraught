import {describe,it,expect} from 'vitest';
import {TVBroadcastBuffer,type TVSnapshot} from './tvBroadcast';
const snapshot=(roomId='public',code='game-1'):TVSnapshot=>({roomId,gameCode:code,white:'Alice',black:'Bob',board:{31:'w',20:'b'},turn:'W',lastMove:null,ply:0,whiteTime:300,blackTime:300,spectatorCount:0,phase:'playing',score:{},capturedAt:0});
describe('server delayed TV feeds',()=>{
 it('cannot expose a fresh board during warmup or before the configured delay',()=>{const b=new TVBroadcastBuffer(15000),s=snapshot();b.capture([s],1000);expect(b.list(15999)[0].snapshot).toBeNull();expect(b.list(16000)[0].snapshot?.board).toEqual(s.board);});
 it('uses immutable snapshots and always chooses the delayed board, never latest',()=>{const b=new TVBroadcastBuffer(15000),s=snapshot();b.capture([s],1000);s.board={26:'w',20:'b'};s.ply=1;b.capture([s],10000);expect(b.list(17000)[0].snapshot?.ply).toBe(0);expect(b.list(17000)[0].snapshot?.board[31]).toBe('w');expect(b.list(25000)[0].snapshot?.ply).toBe(1);});
 it('purges removed/private sources immediately on capture and resets rematch delay',()=>{const b=new TVBroadcastBuffer(15000);b.capture([snapshot()],0);b.capture([snapshot('public','new-game')],16000);expect(b.list(16000)[0].ready).toBe(false);b.capture([],17000);expect(b.list(50000)).toEqual([]);});
 it('bounds history and rejects invalid delays',()=>{expect(()=>new TVBroadcastBuffer(0)).toThrow();const b=new TVBroadcastBuffer(15000);for(let i=0;i<1000;i++)b.capture([{...snapshot(),ply:i}],i*1000);expect(b.list(999000)[0].snapshot?.ply).toBe(984);});
});
