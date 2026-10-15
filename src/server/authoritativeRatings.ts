import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateRating, defaultPlayerRating } from "../rating";
import type { KentroGameRecord } from "../types/gameRecords";

type RatingResult = { ok: boolean; retry?: boolean; white?: { username: string; rating: number }; black?: { username: string; rating: number } };
const keyOf = (value: string) => value.toLowerCase().trim();

/** Called only after the server's authoritative online record is persisted.
 * A unique game ledger and atomic version comparisons protect against retries,
 * concurrent games involving the same player, and moderation rating resets.
 */
export async function applyAuthoritativeRating(db: SupabaseClient, record: KentroGameRecord): Promise<RatingResult | null> {
  if (record.gameMode !== "Multiplayer" || record.gameEndTime <= 0 || record.participantUserIds?.length !== 2) return null;
  const whiteKey = keyOf(record.whitePlayer), blackKey = keyOf(record.blackPlayer);
  if (whiteKey === blackKey || [whiteKey,blackKey].includes("kentro_house")) throw new Error("Invalid rated identities");
  for (let attempt=0; attempt<8; attempt++) {
    const { data: profiles, error } = await db.from("profiles")
      .select("usernameLower, username, ownerId, elo, rd, vol, statsVersion")
      .in("usernameLower", [whiteKey,blackKey]);
    if (error) throw error;
    const white = profiles?.find(p => p.usernameLower === whiteKey);
    const black = profiles?.find(p => p.usernameLower === blackKey);
    if (!white?.ownerId || !black?.ownerId || white.ownerId===black.ownerId ||
        !record.participantUserIds.includes(white.ownerId) || !record.participantUserIds.includes(black.ownerId)) {
      throw new Error("Rated profiles must match both verified online participants");
    }
    const rating = (profile: typeof white) => ({
      rating: Number(profile.elo ?? defaultPlayerRating.rating),
      rd: Number(profile.rd ?? defaultPlayerRating.rd),
      vol: Number(profile.vol ?? defaultPlayerRating.vol),
    });
    const score = record.isDraw ? 0.5 : record.winner === record.whitePlayer ? 1 : 0;
    const { newPlayer1, newPlayer2 } = calculateRating(rating(white), rating(black), score);
    newPlayer1.rating = Math.max(100,Math.round(newPlayer1.rating));
    newPlayer2.rating = Math.max(100,Math.round(newPlayer2.rating));
    const { data, error: rpcError } = await db.rpc("kentro_apply_rated_result", {
      p_game_id: record.gameCode, p_white_owner: white.ownerId, p_black_owner: black.ownerId,
      p_white_version: white.statsVersion, p_black_version: black.statsVersion,
      p_winner: record.isDraw ? "Draw" : score === 1 ? "W" : "B",
      p_after: { white: newPlayer1, black: newPlayer2 },
    });
    if (rpcError) throw rpcError;
    const result = data as RatingResult | null;
    if (result?.ok && result.white && result.black) return result;
    if (!result?.retry) throw new Error("Rating transaction did not confirm success");
  }
  throw new Error("Rating snapshots remained busy after eight retries");
}
