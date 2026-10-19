/**
 * Rules for finding real, joinable rooms in the Online Arena.
 * Pure functions shared by the lobby UI and regression checks.
 * The server remains authoritative: it re-checks availability on join.
 */
export interface ArenaRoom {
  id: string;
  creator: string;
  hostName: string;
  gameTime: number;
  specialRule: string;
  wagerAmount: number;
  bestOf: number;
  playersCount: number;
}

export const QUICK_MATCH_TIMES = [3, 5, 10, 15] as const;
export type ChallengeFilter = 'standard' | 'free' | 'all';

export function isOwnRoom(room: ArenaRoom, username: string): boolean {
  const you = username.trim().toLocaleLowerCase();
  return Boolean(you) && [room.creator, room.hostName].some(name => name?.trim().toLocaleLowerCase() === you);
}

/** Never advertise rooms the player cannot join (notably for guest trials). */
export function canJoinOpenRoom(room: ArenaRoom, username: string, isGuest: boolean): boolean {
  if (!room || typeof room.id !== 'string' || !room.id.trim()) return false;
  if (isOwnRoom(room, username) || room.playersCount !== 1) return false;
  if (!Number.isFinite(room.gameTime) || room.gameTime <= 0) return false;
  if (isGuest && ((room.wagerAmount ?? 0) > 0 || (room.bestOf ?? 1) !== 1)) return false;
  return true;
}

/** Casual Quick Match never silently joins wagered, modified-rule or series rooms. */
export function findQuickMatchRoom(rooms: ArenaRoom[], username: string, isGuest: boolean, gameTime: number): ArenaRoom | undefined {
  return rooms.find(room => canJoinOpenRoom(room, username, isGuest) &&
    room.gameTime === gameTime &&
    room.specialRule === 'none' &&
    (room.wagerAmount ?? 0) === 0 &&
    (room.bestOf ?? 1) === 1);
}

export function discoverChallenges(rooms: ArenaRoom[], username: string, isGuest: boolean, filter: ChallengeFilter): ArenaRoom[] {
  return rooms.filter(room => canJoinOpenRoom(room, username, isGuest) && (
    filter === 'all' ||
    (filter === 'free' && (room.wagerAmount ?? 0) === 0) ||
    (filter === 'standard' && room.specialRule === 'none' && (room.wagerAmount ?? 0) === 0 && (room.bestOf ?? 1) === 1)
  ));
}
