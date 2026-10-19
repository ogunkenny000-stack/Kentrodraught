import { ArrowLeft } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { PlayerStats } from "../../types";
import { MatchResultPair } from "../MatchResultPair";

interface HeadToHead {
  opponent: string;
  gamesPlayed: number;
  myWins: number;
  theirWins: number;
  draws: number;
}

interface PlayerDirectoryModalProps {
  open: boolean;
  onClose: () => void;
  viewingPlayer: string | null;
  viewingPlayerStats: PlayerStats | null;
  viewingPlayerGames: any[];
  isLoadingDirectory: boolean;
  isLoadingPlayerProfile: boolean;
  playersDirectoryList: PlayerStats[];
  headToHead: HeadToHead | null;
  onBack: () => void;
  onOpenPlayerProfile: (username: string) => void;
  onLoadGame: (game: any) => void;
}

export function PlayerDirectoryModal({
  open, onClose, viewingPlayer, viewingPlayerStats, viewingPlayerGames,
  isLoadingDirectory, isLoadingPlayerProfile, playersDirectoryList, headToHead,
  onBack, onOpenPlayerProfile, onLoadGame,
}: PlayerDirectoryModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          {viewingPlayer && (
            <button onClick={onBack} className="text-slate-400 hover:text-white cursor-pointer p-1 -ml-1">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <span className="uppercase tracking-widest text-sm">
            {viewingPlayer ? (viewingPlayerStats?.username || viewingPlayer) : "Players"}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-2.5 pb-1">
        {!viewingPlayer ? (
          isLoadingDirectory ? (
            <p className="text-xs text-slate-500 text-center py-8">Loading players...</p>
          ) : playersDirectoryList.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">No players found yet.</p>
          ) : (
            playersDirectoryList.map((p) => (
              <button
                key={p.username}
                onClick={() => onOpenPlayerProfile(p.username)}
                className="flex items-center justify-between bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-3 transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-slate-800" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-black text-xs">
                      {p.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-xs font-bold text-slate-200">{p.username}</span>
                </div>
                <span className="text-[10px] font-mono text-amber-400 font-bold">{Math.round(p.elo)}</span>
              </button>
            ))
          )
        ) : isLoadingPlayerProfile ? (
          <p className="text-xs text-slate-500 text-center py-8">Loading profile...</p>
        ) : !viewingPlayerStats ? (
          <p className="text-xs text-slate-500 text-center py-8">Player not found.</p>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2 py-2">
              {viewingPlayerStats.avatarUrl ? (
                <img src={viewingPlayerStats.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-amber-500/40" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-black text-2xl">
                  {viewingPlayerStats.username.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-black text-white">{viewingPlayerStats.username}</span>
              <span className="text-xs font-mono text-amber-400 font-bold">ELO {Math.round(viewingPlayerStats.elo)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-950/60 rounded-lg py-2">
                <div className="text-sm font-black text-emerald-400">{viewingPlayerStats.wins}</div>
                <div className="text-[9px] text-slate-500 font-bold uppercase">Wins</div>
              </div>
              <div className="bg-slate-950/60 rounded-lg py-2">
                <div className="text-sm font-black text-red-400">{viewingPlayerStats.losses}</div>
                <div className="text-[9px] text-slate-500 font-bold uppercase">Losses</div>
              </div>
              <div className="bg-slate-950/60 rounded-lg py-2">
                <div className="text-sm font-black text-slate-400">{viewingPlayerStats.draws}</div>
                <div className="text-[9px] text-slate-500 font-bold uppercase">Draws</div>
              </div>
            </div>

            {headToHead && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex flex-col gap-1.5">
                <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-wide">Head to Head vs You</span>
                <span className="text-xs text-slate-300">{headToHead.gamesPlayed} games played</span>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                  <div className="h-full bg-emerald-500" style={{ width: `${(headToHead.myWins / headToHead.gamesPlayed) * 100}%` }} />
                  <div className="h-full bg-red-500" style={{ width: `${(headToHead.theirWins / headToHead.gamesPlayed) * 100}%` }} />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>You {headToHead.myWins} ({Math.round((headToHead.myWins / headToHead.gamesPlayed) * 100)}%)</span>
                  <span>{headToHead.opponent} {headToHead.theirWins} ({Math.round((headToHead.theirWins / headToHead.gamesPlayed) * 100)}%)</span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wide">Games ({viewingPlayerGames.length})</span>
              {viewingPlayerGames.length === 0 ? (
                <p className="text-[11px] text-slate-600 py-2">No completed games yet.</p>
              ) : (
                viewingPlayerGames.slice(0, 50).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => onLoadGame(g)}
                    className="flex items-center justify-between bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 rounded-lg px-3 py-2.5 transition cursor-pointer"
                  >
                    <div className="flex-1 min-w-0"><MatchResultPair game={g} compact /></div>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
