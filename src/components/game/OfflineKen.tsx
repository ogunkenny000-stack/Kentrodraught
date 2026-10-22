import { OfflineReadyCard } from '../OfflineReadyCard';
import { InstallAppCard } from '../InstallAppCard';
import React, { useEffect, useMemo, useState } from 'react';
import { applyMove, captureClickTargets, checkGameEnd, createInitialBoard, generateLegalMoves, getCol, ngRcToSq, resolveCaptureClick } from '../../gameLogic';
import type { Move } from '../../gameLogic';
import { offlineKenMove } from '../../engine/offlineKen';

export function OfflineKen({ onBack }: { onBack: () => void }) {
  const [history, setHistory] = useState<Move[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [walked, setWalked] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(5);
  const [status, setStatus] = useState('Your turn — White');
  const [retry, setRetry] = useState(0);
  const board = useMemo(() => history.reduce((b, m) => applyMove(b, m).board, createInitialBoard()), [history]);
  const turn = history.length % 2 === 0 ? 'W' : 'B';
  const end = useMemo(() => checkGameEnd(history), [history]);
  const legal = useMemo(() => generateLegalMoves(board, turn), [board, turn]);
  const candidates = legal.filter(m => m.from === selected);
  const targets = captureClickTargets(candidates, walked);
  useEffect(() => {
    if (end.isOver) { setStatus(end.isDraw ? `Draw: ${end.reason}` : `${end.winner === 'W' ? 'You win' : 'Ken wins'}: ${end.reason}`); return; }
    if (turn === 'W') { setStatus('Your turn — White'); return; }
    const controller = new AbortController();
    setStatus(`Ken is thinking locally (${seconds}s)…`);
    offlineKenMove(board, 'B', seconds, 0, false, controller.signal).then(result => {
      if (!controller.signal.aborted && result.move) {
        setHistory(previous => [...previous, result.move!]);
      }
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, [board, turn, seconds, end, retry]);
  const click = (sq: number) => {
    if (turn !== 'W' || end.isOver) return;
    const result = resolveCaptureClick(candidates, walked, sq);
    if (result.kind === 'apply') { setHistory([...history, result.move]); setSelected(null); setWalked([]); }
    else if (result.kind === 'extend') setWalked(result.walked);
    else if (getCol(board[sq]) === 'W') { setSelected(sq); setWalked([]); }
  };
  return <main className="min-h-screen bg-slate-950 text-slate-100 p-4 flex flex-col items-center gap-4">
    <div className="w-full max-w-xl flex justify-between items-center"><button onClick={onBack}>← Back</button><h1 className="font-bold text-xl">Ken Offline · Full Strength</h1></div>
    <p className="max-w-xl text-sm text-slate-400">Local practice. Full evaluation, no handicap or artificial depth limit. No account, coins or ranked progression. Prepare the offline files once while connected.</p>
    <div className="w-full max-w-xl space-y-3"><OfflineReadyCard/><InstallAppCard variant="menu"/></div>
    <label>Thinking time <select aria-label="Thinking time" value={seconds} onChange={e => setSeconds(Number(e.target.value))} className="bg-slate-800 rounded p-2 ml-2">
      <option value={5}>5 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds · Maximum</option>
    </select></label>
    <p role="status" className="text-amber-300 text-center">{status}</p>
    <div aria-label="Draughts board" className="grid grid-cols-10 w-full max-w-xl border-4 border-amber-900">
      {Array.from({ length: 100 }, (_, i) => {
        const row = Math.floor(i / 10), col = i % 10, sq = ngRcToSq(row, col);
        const piece = sq ? board[sq] : null;
        return <button key={i} aria-label={sq ? `Square ${sq}${piece ? ` ${piece === piece.toUpperCase() ? 'king ' : ''}${getCol(piece) === 'W' ? 'white' : 'black'}` : ''}` : 'Light square'}
          disabled={!sq || turn !== 'W' || end.isOver} onClick={() => sq && click(sq)}
          className={`aspect-square relative flex items-center justify-center ${sq ? 'bg-amber-900' : 'bg-amber-100'} ${selected === sq ? 'ring-4 ring-inset ring-amber-400' : ''}`}>
          {sq && <span className="absolute top-0 left-0.5 text-[8px] text-amber-200/60">{sq}</span>}
          {piece ? <span className={`w-4/5 h-4/5 rounded-full border-2 flex items-center justify-center text-xl ${getCol(piece) === 'W' ? 'bg-stone-100 text-black border-stone-400' : 'bg-slate-950 text-amber-300 border-slate-600'}`}>{piece === piece.toUpperCase() ? '♛' : ''}</span> : sq && targets.has(sq) ? <span className="rounded-full w-1/3 h-1/3 bg-emerald-400" /> : null}
        </button>;
      })}
    </div>
    <div className="flex gap-4"><button className="rounded bg-slate-800 px-4 py-2" onClick={() => { setHistory([]); setSelected(null); setWalked([]); }}>New game</button>
      <button className="rounded bg-slate-800 px-4 py-2" disabled={turn !== 'B'} onClick={() => setRetry(n => n + 1)}>Retry engine</button></div>
  </main>;
}
