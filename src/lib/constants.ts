import { MoveEvalResult } from "../types";

export const QUALITY_BADGE_CLASSES: Record<MoveEvalResult["quality"], string> = {
  "Brilliant": "bg-fuchsia-500/20 text-fuchsia-400",
  "Best": "bg-cyan-500/20 text-cyan-400",
  "Excellent": "bg-emerald-500/20 text-emerald-400",
  "Good": "bg-sky-500/20 text-sky-400",
  "Forced": "bg-slate-500/20 text-slate-400",
  "Inaccuracy": "bg-yellow-500/15 text-yellow-400",
  "Mistake": "bg-orange-500/20 text-orange-400",
  "Blunder": "bg-red-500/20 text-red-400",
  "Missed Win": "bg-rose-600/25 text-rose-400",
};

export const QUALITY_BADGE_ABBREV: Record<MoveEvalResult["quality"], string> = {
  "Brilliant": "!!",
  "Best": "BE",
  "Excellent": "EX",
  "Good": "GD",
  "Forced": "FC",
  "Inaccuracy": "IN",
  "Mistake": "MS",
  "Blunder": "BL",
  "Missed Win": "MW",
};

// Coin package prices/amounts come from the server (admin-configurable via
// /api/admin/coin-settings), not hardcoded here.
export const OPAY_PAYMENT_DETAILS = {
  provider: "OPay",
  accountName: "Ogunsola Kehinde Victor",
  phoneNumber: "8085538697",
};

/**
 * One Ken difficulty level, configured with EXACTLY the strategy lidraughts
 * uses for its Scan levels 1-8 (RoepStoep/draughtsnet, draughtsnet.py --
 * the LVL_* tables for the "normal" 10x10 variant):
 *
 *   LVL_MOVETIMES = [50, 100, 150, 200, 300, 400, 500, 1000]  (ms)
 *   LVL_NODES     = [50, 120, 400, 1200, 0, 0, 0, 0]          (0 = no cap)
 *   LVL_DEPTHS    = [0, 0, 0, 0, 6, 5, 11, 21]                (0 = no cap)
 *   LVL_PST       = [1, 1, 1, 1, 1, 0, 0, 0]   (1 = simple piece-value eval,
 *                                               0 = full positional eval)
 *   LVL_HANDICAPS = [3, 2, 0, 0, 0, 0, 0, 0]   (root randomness -- blunders)
 *   LVL_BOOK_PLY / LVL_BOOK_MARGIN describe Scan's opening book usage;
 *   kept here for reference/completeness (Ken plays from search directly).
 *
 * Levels 1-4 are node-limited with the simple eval plus handicap noise,
 * level 5 is shallow-depth simple eval, and 6-8 use the full evaluation
 * with growing depth/time -- the same shape of weakening Scan gets.
 */
export interface KenDifficulty {
  id: number;
  name: string;
  /** Scan LVL_MOVETIMES: hard wall-clock budget for the search, in ms. */
  moveTimeMs: number;
  /** Scan LVL_DEPTHS: max search depth; 0 = uncapped (time decides). */
  depth: number;
  /** Scan LVL_NODES: max search nodes; 0 = uncapped. */
  nodes: number;
  /** Scan LVL_PST: true = simple material/PST eval, false = full eval. */
  pst: boolean;
  /** Scan LVL_HANDICAPS: 0-3, random root noise making low levels blunder. */
  handicap: number;
  /** Scan LVL_BOOK_PLY / LVL_BOOK_MARGIN (reference). */
  bookPly: number;
  bookMargin: number;
}


// Mirrors KENTRO_COINS_ENABLED in server.ts. Coins are live: the store,
// AI-level unlock purchases, tournament entry fees, and match wagers all
// charge real wallet balances now. Flip both this and the server.ts copy
// back to false together if coins ever need to be pulled again.
export const KENTRO_COINS_ENABLED = true;

// Match wager range for Create Game -- host picks the per-player entry fee
// directly instead of it being auto-derived from time control. Mirrors
// MIN_MATCH_WAGER/MAX_MATCH_WAGER/MATCH_WAGER_STEP in server.ts, which
// re-validates this same range server-side (never trust the client's number
// alone for anything money-related).
/** Visible build stamp -- bump on every delivery so a stale deployment is
 *  obvious at a glance (logged on boot, see main.tsx). If the running app
 *  doesn't show this exact tag, it is NOT running this source. */
export const APP_BUILD = "r5 · 2026-07-28";

export const MIN_MATCH_WAGER = 10;
export const MAX_MATCH_WAGER = 1000;
export const MATCH_WAGER_STEP = 10;

// Match series lengths for online play ("Best of 5" option in Create Game).
// Mirrors ALLOWED_BEST_OF in server.ts, which re-validates it (series length
// decides when the wager pot pays out, so the client is never trusted alone).
export const ALLOWED_BEST_OF = [1, 3, 5] as const;
export const BEST_OF_LABELS: Record<number, { label: string; desc: string }> = {
  1: { label: "Single Game", desc: "One game decides the match." },
  3: { label: "Best of 3", desc: "First to 2 game wins takes the match." },
  5: { label: "Best of 5", desc: "First to 3 game wins takes the match." },
};

/** Live series state pushed by the server for Best-of-N rooms. */
export interface SeriesInfo {
  bestOf: number;
  gameNumber: number;
  score: Record<string, number>;
  draws: number;
  seriesOver: boolean;
  seriesWinner: string | null;
}

export const KEN_LEVELS: KenDifficulty[] = [
  // Ken 1-4: DEPTH-driven, simple evaluation (material + centre only -- the
  // Nigerian-specific positional terms are switched off via pst:true). The
  // moveTimeMs on these is only a safety ceiling so a pathological position
  // can never hang the game; depth is what actually decides the move.
  { id: 1, name: "Ken 1 (Novice)",       moveTimeMs: 2000,  depth: 9,  nodes: 0, pst: true,  handicap: 0, bookPly: 4, bookMargin: 100 },
  { id: 2, name: "Ken 2 (Casual)",       moveTimeMs: 2500,  depth: 12, nodes: 0, pst: true,  handicap: 0, bookPly: 4, bookMargin: 100 },
  { id: 3, name: "Ken 3 (Amateur)",      moveTimeMs: 3000, depth: 14, nodes: 0, pst: true,  handicap: 0, bookPly: 4, bookMargin: 90 },
  { id: 4, name: "Ken 4 (Club)",         moveTimeMs: 3500, depth: 16, nodes: 0, pst: true,  handicap: 0, bookPly: 4, bookMargin: 90 },
  // Ken 5-8: TIME-driven at full engine power -- every positional term on,
  // no depth ceiling, no node cap, no handicap. Ken 8 is everything the
  // engine has, for a full 1.5 seconds.
  { id: 5, name: "Ken 5 (Expert)",       moveTimeMs: 400,   depth: 0,  nodes: 0, pst: false, handicap: 0, bookPly: 6, bookMargin: 80 },
  { id: 6, name: "Ken 6 (Master)",       moveTimeMs: 600,   depth: 0,  nodes: 0, pst: false, handicap: 0, bookPly: 6, bookMargin: 70 },
  { id: 7, name: "Ken 7 (Grandmaster)",  moveTimeMs: 800,   depth: 0,  nodes: 0, pst: false, handicap: 0, bookPly: 8, bookMargin: 60 },
  { id: 8, name: "Ken 8 (Championship)", moveTimeMs: 1500,  depth: 0,  nodes: 0, pst: false, handicap: 0, bookPly: 8, bookMargin: 50 },
];


/** Admin-configurable coin economy settings served by /api/admin/coin-settings. */
export interface CoinSettings {
  matchEntryFee: { blitz: number; rapid: number; classical: number };
  crownCrownSurcharge: number;
  tournamentEntryFeeDefault: number;
  aiUnlockCostPerLevel: number;
  aiUnlockAllCost: number;
  withdrawalRatePerHundredCoins: number;
  withdrawalMinCoins: number;
  withdrawalMinGamesPlayed: number;
  withdrawalMinAccountAgeDays: number;
}

export interface CoinPackage {
  id: string;
  coins: number;
  priceNaira: number;
}
