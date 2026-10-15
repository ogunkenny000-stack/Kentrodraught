import { Board, Move } from "../gameLogic";

export interface KentroGameRecord {
  gameCode: string; // e.g. "2690001"
  private?: boolean;
  participantUserIds?: string[];
  serverSyncPending?: boolean;
  previousGameCode: string | null; // e.g. "2690000" if rematch
  nextGameCode?: string | null;
  seriesId: string; // Connected rematch series ID
  seriesGameNumber: number; // 1, 2, 3...
  player1: string; // White player username
  player2: string; // Black player username
  whitePlayer: string;
  blackPlayer: string;
  playerColors: Record<string, "W" | "B">;
  gameMode: string;
  timeControl: string;
  startingPosition?: Board | null;
  completeMoveHistory: Move[];
  moveHistoryStrings: string[];
  currentPosition?: Board | null;
  gameStartTime: number;
  gameEndTime: number;
  durationSeconds: number;
  finalResult: "1–0" | "0–1" | "½–½";
  resultReason: string; // "Resignation", "Draw Agreement", "Timeout", "Normal Win - Opponent has no legal moves", etc.
  winner: string | null;
  loser: string | null;
  isDraw: boolean;
  playerRatingsBefore?: Record<string, number>;
  playerRatingsAfter?: Record<string, number>;
  rematchStatus?: "none" | "waiting" | "requested" | "accepted" | "declined";
  connectionEvents?: Array<{
    timestamp: number;
    username: string;
    event: "connected" | "disconnected" | "reconnected";
  }>;
}

export interface SeriesGameSummary {
  gameCode: string;
  player1: string;
  player2: string;
  score: string; // "1–0", "0–1", "½–½"
  resultReason: string;
  winner: string | null;
  isDraw: boolean;
}

export interface RematchSeriesData {
  seriesId: string;
  games: SeriesGameSummary[];
  seriesGamesCount: number;
  scores: Record<string, number>;
  draws: number;
}
