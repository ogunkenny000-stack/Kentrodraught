import React from 'react';
import { AdminTappableName } from '../lib/adminProfileContext';
import { matchOutcome, matchPlayers, type CompletedMatch } from '../lib/completedMatches';

const resultColor = {
  Won: 'text-emerald-400', Loss: 'text-rose-400', Draw: 'text-amber-400', Unknown: 'text-slate-500',
};

/** One game, both names, both results. No separate winner/loser log entries. */
export function MatchResultPair({ game, compact = false }: { game: CompletedMatch; compact?: boolean }) {
  const { white, black } = matchPlayers(game);
  const left = matchOutcome(game, 'white');
  const right = matchOutcome(game, 'black');
  return <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 min-w-0" aria-label={`${white} vs ${black}: ${left} and ${right}`}>
    <div className="min-w-0 text-center">
      <div className={`font-bold text-slate-100 truncate ${compact ? 'text-xs' : 'text-sm'}`}><AdminTappableName username={white} /></div>
      <div className={`uppercase tracking-wider font-black text-[10px] ${resultColor[left]}`}>{left === 'Unknown' ? '—' : left}</div>
    </div>
    <span className="text-[10px] font-bold text-slate-500">VS</span>
    <div className="min-w-0 text-center">
      <div className={`font-bold text-slate-100 truncate ${compact ? 'text-xs' : 'text-sm'}`}><AdminTappableName username={black} /></div>
      <div className={`uppercase tracking-wider font-black text-[10px] ${resultColor[right]}`}>{right === 'Unknown' ? '—' : right}</div>
    </div>
  </div>;
}
