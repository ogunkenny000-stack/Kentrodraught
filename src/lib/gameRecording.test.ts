import {describe,it,expect} from 'vitest';
import {canonicalGameMove,recordedGameData,savedGameStart} from './gameRecording';
import {createInitialBoard,generateLegalMoves,applyMove,boardToScanFen,type Board,type Move} from '../gameLogic';
import {replayForAnalysis} from './analysisReplay';
describe('game recording integrity',()=>{
 it('rejects a raw engine move even when its source belongs to the mover',()=>{
  const board=createInitialBoard();expect(canonicalGameMove(board,'W',{from:38,to:33,caps:[]})).toBeNull();
  expect(()=>recordedGameData([{from:38,to:33,caps:[]}],board,'W',{})).toThrow('Illegal recorded move');
 });
 it('never repairs a mismatched capture merely by matching from/to',()=>{
  let board=createInitialBoard(),turn:'W'|'B'='W';let capture:Move|undefined;
  for(let i=0;i<80;i++){const legal=generateLegalMoves(board,turn);capture=legal.find(m=>m.caps.length>0);if(capture)break;if(!legal.length)break;board=applyMove(board,legal[i%legal.length]).board;turn=turn==='W'?'B':'W';}
  expect(capture).toBeDefined();expect(canonicalGameMove(board,turn,{...capture!,caps:[]})).toBeNull();
  expect(canonicalGameMove(board,turn,{...capture!,kenProof:'receipt'})).toEqual({...capture!,kenProof:'receipt'});
 });
 it('round trips a custom Black-first game through the database metadata',()=>{
  const board:Board={16:'b',34:'w'},turn='B';const moves=[generateLegalMoves(board,turn)[0]];expect(moves[0]).toBeDefined();
  const saved=recordedGameData(moves,board,turn,{'0':{score:12}});const start=savedGameStart(saved);expect(start).toEqual({board,turn});
  const replay=replayForAnalysis(saved.moveHistory,start.board,start.turn);expect(boardToScanFen(replay.boards[1],replay.turns[1])).toBe(boardToScanFen(applyMove(board,moves[0]).board,'W'));expect(saved.moveEvaluations['0']).toEqual({score:12});
 });
 it('keeps the standard start for legacy records without inventing missing boards',()=>{expect(savedGameStart({})).toEqual({board:undefined,turn:'W'});});
});
