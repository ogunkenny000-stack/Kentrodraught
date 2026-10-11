// Room / multiplayer state as ONE reducer (audit item H3).
//
// Every value a socket message handler needs to read lives here, and the
// decisions that depend on current state ("is this room-cancelled for the
// room I'm in?") are taken INSIDE the reducer, so they can never see a
// stale closure. `RESET_ROOM` is the single exit path for leave / cancel /
// spectate-stop and clears everything at once.

import type { Color, RoomPhase, PendingOffer, ChatTailEntry } from "../shared/protocol";
import type { SeriesInfo } from "./constants";
import { ClockSnapshot, makeClockSnapshot, withOffset, clockRemainingMs } from "./useServerClock";

export interface RoomPlayer {
  username: string;
  color: Color;
  ready: boolean;
  /** Present on newer servers: whether this seat currently has a live socket. */
  connected?: boolean;
}

export interface RoomChatMessage {
  from: string;
  text: string;
  voiceDuration?: number;
  ts?: number;
}

export type RematchStatus = "idle" | "waiting" | "requested" | "accepted" | "declined";

export interface RematchState {
  status: RematchStatus;
  fromUsername?: string;
  message?: string;
  newGameCode?: string;
}

export interface ServerGameEnd {
  winnerColor: Color | null;
  reason?: string;
  statusMessage?: string;
}

export interface OpponentAway {
  username: string;
  strikes: number;
  maxStrikes: number;
}

export type ClockLimitType = "Blitz" | "Rapid" | "Classical" | "Untimed";

export interface RoomState {
  roomId: string | null;
  phase: RoomPhase | null;
  players: RoomPlayer[];
  yourColor: Color | null;
  isReady: boolean;
  /** Legacy `started` flag (board shown). */
  started: boolean;
  isSpectating: boolean;
  spectatorCount: number;
  gameTime: number;
  specialRule: string;
  hostTime: number;
  guestTime: number;
  creator: string;
  wagerAmount: number;
  clockLimitType: ClockLimitType | null;
  seriesInfo: SeriesInfo | null;
  setupPhase: any;
  drawOfferReceived: string | null;
  drawOfferSent: boolean;
  resignOfferReceived: string | null;
  resignOfferSent: boolean;
  serverGameEnd: ServerGameEnd | null;
  opponentAway: OpponentAway | null;
  opponentConnected: boolean;
  messages: RoomChatMessage[];
  roomError: string | null;
  rematch: RematchState;
  clock: ClockSnapshot | null;
  /** Server game code for the current game (each series game has its own). */
  gameCode: string | null;
  previousGameCode: string | null;
}

export const MAX_ROOM_CHAT = 200;

export const initialRoomState: RoomState = {
  roomId: null,
  phase: null,
  players: [],
  yourColor: null,
  isReady: false,
  started: false,
  isSpectating: false,
  spectatorCount: 0,
  gameTime: 5,
  specialRule: "none",
  hostTime: 5,
  guestTime: 5,
  creator: "",
  wagerAmount: 0,
  clockLimitType: null,
  seriesInfo: null,
  setupPhase: null,
  drawOfferReceived: null,
  drawOfferSent: false,
  resignOfferReceived: null,
  resignOfferSent: false,
  serverGameEnd: null,
  opponentAway: null,
  opponentConnected: true,
  messages: [],
  roomError: null,
  rematch: { status: "idle" },
  clock: null,
  gameCode: null,
  previousGameCode: null,
};

export type RoomAction =
  | { type: "RESET_ROOM" }
  | { type: "PATCH"; patch: Partial<RoomState> }
  | { type: "ROOM_INFO"; data: any; username: string | null; receivedAt: number; rejoin?: boolean }
  | { type: "SPECTATE_JOINED"; data: any; receivedAt: number }
  | { type: "ROOM_CANCELLED"; roomId: string }
  | { type: "GAME_STARTED"; data: any; username: string | null; receivedAt: number }
  | { type: "GAME_ENDED"; data: any; receivedAt: number }
  | { type: "GAME_RESET"; players?: RoomPlayer[]; username: string | null; yourColor?: Color | null }
  | { type: "CHAT"; message: RoomChatMessage }
  | { type: "SERIES_UPDATE"; data: any }
  | { type: "CLOCK"; clock: any; receivedAt: number }
  | { type: "OFFSET"; offset: number }
  | { type: "OFFER_RESET" }
  | { type: "REMATCH"; rematch: RematchState };

const OFFERS_CLEARED: Pick<RoomState, "drawOfferReceived" | "drawOfferSent" | "resignOfferReceived" | "resignOfferSent"> = {
  drawOfferReceived: null,
  drawOfferSent: false,
  resignOfferReceived: null,
  resignOfferSent: false,
};

export function parseSeriesInfo(data: any): SeriesInfo | null {
  if (!data || typeof data.bestOf !== "number" || data.bestOf <= 1) return null;
  const score =
    data.seriesScore && typeof data.seriesScore === "object" ? data.seriesScore
    : data.score && typeof data.score === "object" ? data.score
    : {};
  return {
    bestOf: data.bestOf,
    gameNumber:
      typeof data.seriesGameNumber === "number" ? data.seriesGameNumber
      : typeof data.gameNumber === "number" ? data.gameNumber
      : 1,
    score,
    draws:
      typeof data.seriesDraws === "number" ? data.seriesDraws
      : typeof data.draws === "number" ? data.draws
      : 0,
    seriesOver: !!data.seriesOver,
    seriesWinner: typeof data.seriesWinner === "string" ? data.seriesWinner : null,
  };
}

export function isSameUser(u1: unknown, u2: unknown): boolean {
  if (typeof u1 !== "string" || typeof u2 !== "string") return false;
  return u1.trim().toLowerCase() === u2.trim().toLowerCase();
}

export function findMe(players: RoomPlayer[] | null | undefined, username: string | null | undefined): RoomPlayer | undefined {
  if (!players || !username) return undefined;
  return players.find((p) => p && isSameUser(p.username, username));
}

function parsePlayers(raw: unknown): RoomPlayer[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((p) => p && typeof p.username === "string")
    .map((p) => {
      const player: RoomPlayer = { username: p.username, color: p.color === "B" ? "B" : "W", ready: !!p.ready };
      if (typeof p.connected === "boolean") player.connected = p.connected;
      return player;
    });
}

/** Opponent connectivity from `players[].connected` when the server provides it. */
function opponentConnectedFrom(players: RoomPlayer[], username: string | null, fallback: boolean): boolean {
  if (!username) return fallback;
  const opp = players.find((p) => !isSameUser(p.username, username));
  return opp && typeof opp.connected === "boolean" ? opp.connected : fallback;
}

function parseChatTail(raw: unknown): RoomChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((m): m is ChatTailEntry => !!m && typeof m.from === "string" && typeof m.text === "string")
    .slice(-MAX_ROOM_CHAT)
    .map((m) => ({ from: m.from, text: m.text, ts: typeof m.ts === "number" ? m.ts : undefined }));
}

function derivePhase(data: any, fallback: RoomPhase | null): RoomPhase | null {
  const p = data?.phase;
  if (p === "lobby" || p === "setup" || p === "playing" || p === "ended") return p;
  if (typeof data?.started === "boolean") {
    if (!data.started) return "lobby";
    if (data.setupPhase) return "setup";
    return fallback === "ended" ? "ended" : "playing";
  }
  return fallback;
}

function applyPendingOffer(state: RoomState, pending: PendingOffer | null | undefined, username: string | null): RoomState {
  const next: RoomState = { ...state, ...OFFERS_CLEARED, rematch: state.rematch.status === "accepted" ? state.rematch : { status: "idle" } };
  if (!pending || typeof pending !== "object" || typeof pending.from !== "string") return next;
  const mine = !!username && pending.from === username;
  if (pending.type === "draw") {
    if (mine) next.drawOfferSent = true; else next.drawOfferReceived = pending.from;
  } else if (pending.type === "resign") {
    if (mine) next.resignOfferSent = true; else next.resignOfferReceived = pending.from;
  } else if (pending.type === "rematch") {
    next.rematch = mine ? { status: "waiting", fromUsername: pending.from } : { status: "requested", fromUsername: pending.from };
  }
  return next;
}

function applyClock(state: RoomState, raw: any, receivedAt: number): RoomState {
  if (!raw || typeof raw !== "object") return state;
  return { ...state, clock: makeClockSnapshot(raw, receivedAt) };
}

export function appendChat(list: RoomChatMessage[], message: RoomChatMessage): RoomChatMessage[] {
  const next = list.length >= MAX_ROOM_CHAT ? list.slice(list.length - MAX_ROOM_CHAT + 1) : list.slice();
  next.push(message);
  return next;
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case "RESET_ROOM":
      return initialRoomState;

    case "PATCH":
      return { ...state, ...action.patch };

    case "ROOM_CANCELLED":
      return state.roomId !== null && state.roomId === action.roomId ? initialRoomState : state;

    case "OFFER_RESET":
      return { ...state, ...OFFERS_CLEARED };

    case "REMATCH":
      return { ...state, rematch: action.rematch };

    case "CHAT":
      return { ...state, messages: appendChat(state.messages, action.message) };

    case "CLOCK":
      return applyClock(state, action.clock, action.receivedAt);

    case "OFFSET":
      if (!state.clock) return state;
      if (Math.abs(state.clock.offset - action.offset) < 250) return state;
      return { ...state, clock: withOffset(state.clock, action.offset) };

    case "SERIES_UPDATE": {
      const info = parseSeriesInfo(action.data);
      return { ...state, seriesInfo: info };
    }

    case "GAME_RESET": {
      const players = action.players ?? state.players;
      const me = findMe(players, action.username);
      const yourColor =
        action.yourColor === "W" || action.yourColor === "B"
          ? action.yourColor
          : me
          ? me.color
          : state.yourColor;
      return {
        ...state,
        ...OFFERS_CLEARED,
        players,
        yourColor,
        started: false,
        phase: "lobby",
        serverGameEnd: null,
        opponentAway: null,
        rematch: { status: "idle" },
        clock: null,
        setupPhase: null,
        isReady: me ? !!me.ready : false,
      };
    }

    case "ROOM_INFO": {
      const { data, username, receivedAt, rejoin } = action;
      if (!data || typeof data.roomId !== "string") return state;
      const roomChanged = state.roomId !== null && state.roomId !== data.roomId;
      const base: RoomState = roomChanged
        ? { ...initialRoomState, clockLimitType: state.clockLimitType, isSpectating: false }
        : state;

      const players = parsePlayers(data.players) ?? base.players;
      const me = findMe(players, username);
      const yourColor: Color | null =
        data.yourColor === "W" || data.yourColor === "B" ? data.yourColor
        : me ? me.color
        : base.yourColor;

      const started = typeof data.started === "boolean" ? data.started : (rejoin ? true : base.started);
      const phase = derivePhase({ ...data, started }, base.phase);
      const seriesInfo = typeof data.bestOf === "number" ? parseSeriesInfo(data) : base.seriesInfo;

      let next: RoomState = {
        ...base,
        roomId: data.roomId,
        players,
        yourColor,
        isReady: me ? !!me.ready : base.isReady,
        started,
        phase,
        gameTime: typeof data.gameTime === "number" ? data.gameTime : base.gameTime,
        specialRule: typeof data.specialRule === "string" ? data.specialRule : base.specialRule,
        hostTime: typeof data.hostTime === "number" ? data.hostTime : base.hostTime,
        guestTime: typeof data.guestTime === "number" ? data.guestTime : base.guestTime,
        creator: typeof data.creator === "string" ? data.creator : base.creator,
        wagerAmount: typeof data.wagerAmount === "number" ? data.wagerAmount : 0,
        clockLimitType:
          data.clockLimitType === "Blitz" || data.clockLimitType === "Rapid" || data.clockLimitType === "Classical" || data.clockLimitType === "Untimed"
            ? data.clockLimitType
            : base.clockLimitType,
        seriesInfo,
        setupPhase: data.setupPhase !== undefined ? data.setupPhase : base.setupPhase,
        spectatorCount: typeof data.spectatorCount === "number" ? data.spectatorCount : base.spectatorCount,
        roomError: null,
        gameCode: typeof data.gameCode === "string" ? data.gameCode : (roomChanged ? null : base.gameCode),
        previousGameCode: typeof data.previousGameCode === "string" ? data.previousGameCode : base.previousGameCode,
        opponentConnected:
          typeof data.opponentConnected === "boolean" ? data.opponentConnected
          : opponentConnectedFrom(players, username, base.opponentConnected),
      };

      // Back in the lobby (fresh room / rematch reset): nothing from the
      // previous game may linger.
      if (phase === "lobby" || phase === "setup") {
        next = { ...next, ...OFFERS_CLEARED, serverGameEnd: null, opponentAway: null };
        if (phase === "lobby") next.rematch = { status: "idle" };
      }

      if (rejoin) {
        next.isSpectating = false;
        if (typeof data.opponentConnected !== "boolean" && !players.some((p) => typeof p.connected === "boolean")) {
          next.opponentConnected = true;
        }
        const tail = parseChatTail(data.chatTail);
        if (tail) next.messages = tail;
        next = applyPendingOffer(next, data.pendingOffer, username);
        next.opponentAway = null;
      } else if (data.pendingOffer && typeof data.pendingOffer === "object") {
        // Newer servers include the live pending offer on every room-info.
        // Only a NON-null offer is applied here: a null could race an offer
        // we just sent and wipe it before the server has processed it.
        next = applyPendingOffer(next, data.pendingOffer, username);
      }

      if (data.clock) next = applyClock(next, data.clock, receivedAt);
      return next;
    }

    case "SPECTATE_JOINED": {
      const { data, receivedAt } = action;
      if (!data || typeof data.roomId !== "string") return state;
      const players = parsePlayers(data.players) ?? [];
      let next: RoomState = {
        ...initialRoomState,
        clockLimitType:
          data.clockLimitType === "Blitz" || data.clockLimitType === "Rapid" || data.clockLimitType === "Classical" || data.clockLimitType === "Untimed"
            ? data.clockLimitType
            : state.clockLimitType,
        isSpectating: true,
        roomId: data.roomId,
        players,
        started: typeof data.started === "boolean" ? data.started : true,
        phase: derivePhase({ ...data, started: typeof data.started === "boolean" ? data.started : true }, "playing"),
        gameTime: typeof data.gameTime === "number" ? data.gameTime : 5,
        specialRule: typeof data.specialRule === "string" ? data.specialRule : "none",
        spectatorCount: typeof data.spectatorCount === "number" ? data.spectatorCount : 0,
        // Spectators always view from White's side.
        yourColor: "W",
        wagerAmount: typeof data.wagerAmount === "number" ? data.wagerAmount : 0,
        seriesInfo: parseSeriesInfo(data),
        setupPhase: data.setupPhase ?? null,
        opponentConnected: typeof data.opponentConnected === "boolean" ? data.opponentConnected : true,
        messages: parseChatTail(data.chatTail) ?? [],
        gameCode: typeof data.gameCode === "string" ? data.gameCode : null,
      };
      if (data.clock) next = applyClock(next, data.clock, receivedAt);
      return next;
    }

    case "GAME_STARTED": {
      const { data, username, receivedAt } = action;
      const players = parsePlayers(data?.players) ?? state.players;
      const me = findMe(players, username);
      let next: RoomState = {
        ...state,
        ...OFFERS_CLEARED,
        roomError: null,
        roomId: typeof data?.roomId === "string" ? data.roomId : state.roomId,
        players,
        yourColor: data?.yourColor === "W" || data?.yourColor === "B" ? data.yourColor : me ? me.color : state.yourColor,
        started: true,
        phase: derivePhase({ ...data, started: true }, "playing") ?? "playing",
        serverGameEnd: null,
        opponentAway: null,
        opponentConnected: true,
        rematch: { status: "idle" },
        setupPhase: data?.setupPhase !== undefined ? data.setupPhase : state.setupPhase,
        clockLimitType:
          data?.clockLimitType === "Blitz" || data?.clockLimitType === "Rapid" || data?.clockLimitType === "Classical" || data?.clockLimitType === "Untimed"
            ? data.clockLimitType
            : state.clockLimitType,
        seriesInfo: typeof data?.bestOf === "number" ? parseSeriesInfo(data) : state.seriesInfo,
        gameCode: typeof data?.gameCode === "string" ? data.gameCode : state.gameCode,
        previousGameCode: typeof data?.previousGameCode === "string" ? data.previousGameCode : state.previousGameCode,
      };
      if (data?.clock) next = applyClock(next, data.clock, receivedAt);
      return next;
    }

    case "GAME_ENDED": {
      const { data, receivedAt } = action;
      let next: RoomState = {
        ...state,
        ...OFFERS_CLEARED,
        opponentAway: null,
        phase: "ended",
        serverGameEnd: {
          winnerColor: data?.winnerColor === "W" || data?.winnerColor === "B" ? data.winnerColor : null,
          reason: typeof data?.reason === "string" ? data.reason : undefined,
          statusMessage: typeof data?.statusMessage === "string" ? data.statusMessage : undefined,
        },
        rematch: { status: "idle" },
      };
      if (data?.clock) {
        next = applyClock(next, data.clock, receivedAt);
      } else if (next.clock && next.clock.clock.running !== null) {
        // Bank the display at receipt time before stopping it, including the
        // measured server/client offset. Merely clearing running adds time back.
        const snap = next.clock;
        next = { ...next, clock: { ...snap, clock: {
          ...snap.clock,
          whiteMs: clockRemainingMs(snap, "W", receivedAt),
          blackMs: clockRemainingMs(snap, "B", receivedAt),
          running: null,
          turnStartedAt: receivedAt + snap.offset,
          serverNow: receivedAt + snap.offset,
        } } };
      }
      return next;
    }

    default:
      return state;
  }
}
