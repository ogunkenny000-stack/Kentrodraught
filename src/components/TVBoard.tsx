import React from "react";
import { ngRcToSq, ngSqToRc } from "../gameLogic";
export function BoardReplay({ board, lastMove, arrows = [], onSquare, showNumbers=false }: {
    showNumbers?: boolean; arrows?: number[][];
    onSquare?: (square: number) => void;
    board: Record<number, string | null>;
    lastMove: {
        from: number;
        to: number;
    } | null;
}) {
    return <div className="relative aspect-square w-full max-w-[680px] kentro-royal-frame kentro-tv-replay-board" role={onSquare ? "group" : "img"} aria-label="10 by 10 Nigerian Draughts replay board">
    <div className="grid grid-cols-10 grid-rows-10 w-full h-full overflow-hidden kentro-royal-grid kentro-tv-replay-grid">
    {Array.from({ length: 100 }, (_, idx) => {
            const row = Math.floor(idx / 10), col = idx % 10;
            const sq = ngRcToSq(row, col);
            const piece = sq === null ? null : board[sq];
            return <div key={idx} role={sq !== null && onSquare ? "button" : undefined} tabIndex={sq !== null && onSquare ? 0 : undefined} aria-label={sq !== null ? `Square ${sq}${piece ? ` ${piece.toLowerCase()==="w"?"White":"Black"} ${piece===piece.toUpperCase()?"king":"man"}` : " empty"}` : undefined} onClick={() => { if (sq !== null)
                onSquare?.(sq); }} onKeyDown={e => { if (sq !== null && onSquare && ["Enter", " "].includes(e.key)) {
                e.preventDefault();
                onSquare(sq);
            } }} className={`kentro-tv-replay-cell relative flex items-center justify-center ${sq === null ? "kentro-wood-light" : "kentro-wood-dark"} ${sq !== null && (lastMove?.from === sq || lastMove?.to === sq) ? "ring-2 ring-inset ring-amber-300" : ""}`}>
        {showNumbers&&sq!==null&&<span className="k-study-square-number" aria-hidden="true">{sq}</span>}
        {piece && <span className={`kentro-royal-piece ${piece.toLowerCase() === "w" ? "kentro-royal-piece--gold" : "kentro-royal-piece--black"}`}>
          {(piece === "W" || piece === "B") && <span className="kentro-royal-king-mark" aria-hidden="true">♛</span>}
        </span>}
      </div>;
        })}
    </div>
    {arrows.length > 0 && <svg aria-label="Commentator arrows" className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100"><defs><marker id="tv-arrow-head" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4" fill="#f59e0b"/></marker></defs>{arrows.map(([from, to], i) => { const [r, c] = ngSqToRc(from), [rr, cc] = ngSqToRc(to); return <line key={i} x1={c * 10 + 5} y1={r * 10 + 5} x2={cc * 10 + 5} y2={rr * 10 + 5} stroke="#f59e0b" strokeWidth="1.4" markerEnd="url(#tv-arrow-head)"/>; })}</svg>}
  </div>;
}
