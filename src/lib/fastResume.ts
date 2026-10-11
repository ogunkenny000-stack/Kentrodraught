import type { Board, Move } from "../gameLogic";

export interface FastResumeData {
  roomId: string;
  board: Board;
  turn: "W" | "B";
  lastMove: Move | null;
  moveHistory: Move[];
  yourColor?: "W" | "B" | null;
  whiteName?: string;
  blackName?: string;
  specialRule?: string;
  timestamp: number;
}

export interface ActiveRoomState {
  roomId: string;
  playMode: "Multiplayer";
  yourColor?: "W" | "B" | null;
  specialRule?: string;
  isHost?: boolean;
  gameStarted?: boolean;
  timestamp: number;
}

const STORAGE_PREFIX = "kd.fast_resume.";
const LATEST_KEY = "kd.fast_resume_latest";
const ACTIVE_ROOM_KEY = "kd.active_room";
const MAX_CACHE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const storage = pick();
      storage.setItem("kd.resume.probe", "1");
      storage.removeItem("kd.resume.probe");
      return storage;
    } catch {
      // Accessors and writes can both fail; try the other storage backend.
    }
  }
  return null;
}

/**
 * Persists the currently active room to local storage.
 * Ensures that if the player switches to WhatsApp or if the browser tab reloads,
 * the player directly lands in their created/joined room instead of the home screen.
 */
export function saveActiveRoom(data: Omit<ActiveRoomState, "timestamp">): void {
  const storage = getStorage();
  if (!storage || !data.roomId) return;
  try {
    const payload: ActiveRoomState = {
      ...data,
      timestamp: Date.now(),
    };
    storage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[FastResume] Failed to save active room:", err);
  }
}

/**
 * Loads the active room metadata to restore room presence upon app load/resume.
 */
export function loadActiveRoom(): ActiveRoomState | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const json = storage.getItem(ACTIVE_ROOM_KEY);
    if (!json) return null;
    const data: ActiveRoomState = JSON.parse(json);
    if (!data || !data.roomId || typeof data.roomId !== "string" || data.playMode !== "Multiplayer" || !Number.isFinite(data.timestamp)) return null;
    if (Date.now() - data.timestamp > MAX_CACHE_AGE_MS) {
      clearActiveRoom();
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[FastResume] Failed to load active room:", err);
    return null;
  }
}

/**
 * Clears the active room state when the user leaves, cancels, or completes a match.
 */
export function clearActiveRoom(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

/**
 * Persists the latest active board state and move history to local storage.
 * This enables instant fast-resume without board flickering upon reconnection.
 */
export function saveFastResumeState(data: Omit<FastResumeData, "timestamp">): void {
  const storage = getStorage();
  if (!storage || !data.roomId) return;
  try {
    const payload: FastResumeData = {
      ...data,
      timestamp: Date.now(),
    };
    const json = JSON.stringify(payload);
    storage.setItem(`${STORAGE_PREFIX}${data.roomId}`, json);
    storage.setItem(LATEST_KEY, json);
  } catch (err) {
    console.warn("[FastResume] Failed to save state to cache:", err);
  }
}

/**
 * Loads the cached board state for a given room (or the most recent game).
 */
export function loadFastResumeState(roomId?: string | null): FastResumeData | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const key = roomId ? `${STORAGE_PREFIX}${roomId}` : LATEST_KEY;
    const json = storage.getItem(key);
    if (!json) return null;
    const data: FastResumeData = JSON.parse(json);
    // Board is a numeric-keyed object, not an array. Check persisted values
    // before handing the snapshot to React; malformed caches are ignored.
    if (!data || !data.board || typeof data.board !== "object" || Array.isArray(data.board)) return null;
    if (typeof data.roomId !== "string" || !data.roomId || (roomId && data.roomId !== roomId)) return null;
    if ((data.turn !== "W" && data.turn !== "B") || !Array.isArray(data.moveHistory) || !Number.isFinite(data.timestamp)) return null;
    for (const [square, piece] of Object.entries(data.board)) {
      const n = Number(square);
      if (!Number.isInteger(n) || n < 1 || n > 50 || (piece !== null && !["w", "b", "W", "B"].includes(piece))) return null;
    }
    if (Date.now() - data.timestamp > MAX_CACHE_AGE_MS) {
      clearFastResumeState(data.roomId);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[FastResume] Failed to load cached state:", err);
    return null;
  }
}

/**
 * Removes cached resume state when a match concludes or user exits.
 */
export function clearFastResumeState(roomId?: string | null): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (roomId) {
      storage.removeItem(`${STORAGE_PREFIX}${roomId}`);
    }
    for (const key of [LATEST_KEY, ACTIVE_ROOM_KEY]) {
      try {
        const raw = storage.getItem(key);
        if (!roomId || (raw && JSON.parse(raw)?.roomId === roomId)) storage.removeItem(key);
      } catch {
        // One malformed entry must not prevent cleanup of the other.
      }
    }
  } catch {
    // Ignore storage removal errors
  }
}
