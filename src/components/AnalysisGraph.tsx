import React from 'react';
import type { MoveEvalResult } from '../types';
import { reviewWhiteScore } from '../lib/analysisPresentation';

export function AnalysisGraph({ moveEvaluations, count, historyViewIndex, onHistoryNavigate, initialTurn = 'W' }: {
  moveEvaluations: Record<number, MoveEvalResult>; count: number; historyViewIndex: number | null;
  onHistoryNavigate: (index: number) => void; initialTurn?: 'W' | 'B';
}) {
  if (!count) return null;
  const x = (i: number) => count === 1 ? 160 : 8 + i / (count - 1) * 304;
  const y = (i: number) => 40 - Math.max(-600, Math.min(600, reviewWhiteScore(moveEvaluations[i], i, initialTurn))) / 600 * 30;
  const indices = Array.from({ length: count }, (_, i) => i).filter(i => moveEvaluations[i] && Number.isFinite(moveEvaluations[i].score));
  return <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
    <p className="text-[10px] text-slate-400">White advantage ↑ · Black advantage ↓ · Select a reviewed move</p>
    <svg viewBox="0 0 320 80" className="w-full h-20" aria-label="Reviewed position estimates, White perspective">
      <line x1="0" y1="40" x2="320" y2="40" stroke="#475569" strokeDasharray="3 3" />
      {indices.map(i => <g key={i}>
        {i > 0 && indices.includes(i - 1) && <line x1={x(i - 1)} y1={y(i - 1)} x2={x(i)} y2={y(i)} stroke="#fbbf24" strokeWidth="2" />}
        <circle cx={x(i)} cy={y(i)} r={historyViewIndex === i ? 5 : 3} fill="#fbbf24" role="button" tabIndex={0}
          aria-label={`Review move ${i + 1}`} onClick={() => onHistoryNavigate(i)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onHistoryNavigate(i); } }} />
      </g>)}
    </svg>
    {!indices.length && <p className="text-xs text-slate-500">No reviewed positions yet. Unreviewed moves are not scored as equal.</p>}
  </div>;
}
