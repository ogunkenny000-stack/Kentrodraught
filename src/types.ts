import { Board, Move, Piece } from "./gameLogic";

export type PlayMode = "Home" | "Human_vs_AI" | "AI_vs_Human" | "AI_vs_AI" | "Analysis" | "Training" | "Puzzles" | "Learn" | "Editor" | "Multiplayer" | "OfflineNearby" | "KentroTV" | "Tournament" | "Global_Chat";

export interface Puzzle {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  theme: string;
  description: string;
  fen: string;
  solution: { from: number; to: number; text: string }[];
  explanation: string;
}

export interface EngineEval {
  score: number; // in centipawns
  depth: number;
  pv: string;
  isThinking: boolean;
  knps?: number;
  nodes?: number;
  time?: number;
}

export interface ClockState {
  whiteTime: number; // in seconds
  blackTime: number; // in seconds
  activeColor: "W" | "B" | null;
  limitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
}

export type BoardTheme = "wood" | "slate" | "green" | "vinyl" | "custom";

export interface ThemeColors {
  name: string;
  darkSquare: string;
  lightSquare: string;
  border: string;
  boardBg: string;
}

export const BOARD_THEMES: Record<BoardTheme, ThemeColors> = {
  wood: {
    name: "Royal Nigerian Wood",
    darkSquare: "bg-[#7c4c24]",
    lightSquare: "bg-[#eac494]",
    border: "border-[#4a2e16]",
    boardBg: "bg-[#4a2e16]",
  },
  slate: {
    name: "Midnight Slate",
    darkSquare: "bg-[#334155]",
    lightSquare: "bg-[#cbd5e1]",
    border: "border-[#1e293b]",
    boardBg: "bg-[#1e293b]",
  },
  green: {
    name: "Forest Green",
    darkSquare: "bg-[#2d6a4f]",
    lightSquare: "bg-[#d8f3dc]",
    border: "border-[#1b4332]",
    boardBg: "bg-[#1b4332]",
  },
  vinyl: {
    name: "Classic Vinyl",
    darkSquare: "bg-[#422006]",
    lightSquare: "bg-[#fef08a]",
    border: "border-[#1c1917]",
    boardBg: "bg-[#1c1917]"
  },
  custom: {
    name: "Custom Theme",
    darkSquare: "bg-[#1e293b]",
    lightSquare: "bg-[#f8fafc]",
    border: "border-[#0f172a]",
    boardBg: "bg-[#0f172a]"
  }
};

export interface PlayerStats {
  username: string;
  elo: number;
  rd?: number;
  vol?: number;
  wins: number;
  losses: number;
  draws: number;
  gamesCount: number;
  totalPlayTime: number; // in seconds
  averageDuration: number; // in seconds
  maxUnlockedKenLevel?: number;
  avatarUrl?: string;
}

export interface MoveEvalResult {
  index: number;
  score: number; // centipawns
  quality: "Best" | "Brilliant" | "Excellent" | "Good" | "Inaccuracy" | "Mistake" | "Blunder" | "Missed Win" | "Forced";
  comment: string;
  // True when the played move exactly matched the engine's top choice for
  // that position (used to render "Best move" independently of `quality`,
  // e.g. a Forced move can still have been the engine's best move too).
  isBestMove?: boolean;
  // Set when a materially better continuation existed and wasn't played
  // (i.e. Missed Tactics), regardless of the overall quality bucket above.
  missedTactic?: boolean;
  // Human-readable engine suggestion, e.g. "35-30", shown when the played
  // move differs from the engine's top choice.
  bestMoveHint?: string;
  // Same move as bestMoveHint, as raw square numbers -- used to draw the
  // suggestion arrow on the board directly (via each square's existing
  // DOM id) instead of re-parsing the display string back into numbers.
  bestMoveSquares?: { from: number; to: number };
}

