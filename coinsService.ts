import { getSupabaseAdmin } from "./supabaseAdmin";

export interface CoinTransactionRecord {
  type: "match_entry" | "tournament_entry" | "ai_unlock" | "purchase_credit" | "tournament_prize" | "match_prize" | "admin_adjustment" | "refund" | "rake" | "withdrawal";
  amount: number; // always positive; sign is implied by `direction`
  direction: "debit" | "credit";
  balanceAfter: number;
  reason: string;
  refId?: string;
  timestamp: number;
}

const cleanUsername = (username: string) => {
  if (typeof username !== "string" || !username.trim()) throw new Error("Wallet username is required");
  return username.toLowerCase().trim();
};

function requireCoinAmount(amount: number, allowZero = false): void {
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1)) {
    throw new Error(`Coin amount must be a ${allowZero ? "non-negative" : "positive"} safe integer`);
  }
}

/** Ensures a wallet exists (0 balance) and returns the current balance. */
export async function getOrCreateWallet(username: string, ownerId: string | null): Promise<number> {
  const uname = cleanUsername(username);
  const admin = getSupabaseAdmin();

  const { data: existing, error: selectError } = await admin
    .from("coin_wallets")
    .select("balance")
    .eq("username", uname)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return (existing.balance as number) ?? 0;

  const { error: insertError } = await admin
    .from("coin_wallets")
    .insert({ username: uname, balance: 0, ownerId: ownerId || null, createdAt: Date.now() });
  // A concurrent request may have created the row between our select and
  // this insert -- that's not a failure, just re-read below.
  if (insertError && insertError.code !== "23505") throw insertError;

  const { data: after, error: readError } = await admin.from("coin_wallets").select("balance").eq("username", uname).maybeSingle();
  if (readError) throw readError;
  if (!after) throw new Error("Wallet could not be read after creation");
  return (after.balance as number) ?? 0;
}

/**
 * Atomically debits `amount` coins from a SINGLE wallet if (and only if) the
 * balance covers it. Returns {ok:false} without changing anything if funds
 * are insufficient -- callers must treat {ok:false} as "do not proceed"
 * (e.g. don't unlock the AI level, don't start the match).
 *
 * The atomicity here comes from debit_wallet() in supabase/schema.sql -- a
 * SECURITY DEFINER function that locks the wallet row (SELECT ... FOR
 * UPDATE) and checks-then-debits inside one Postgres transaction, the same
 * guarantee Firestore's runTransaction used to give.
 */
export async function debitWallet(
  username: string,
  amount: number,
  reason: CoinTransactionRecord["type"],
  refId?: string
): Promise<{ ok: true; balance: number } | { ok: false; balance: number; reason: "insufficient_funds" }> {
  requireCoinAmount(amount);
  const uname = cleanUsername(username);

  const { data, error } = await getSupabaseAdmin().rpc("debit_wallet", {
    p_username: uname,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId ?? null,
  });
  if (error) throw error;
  const row = data?.[0] as { ok: boolean; balance: number } | undefined;
  if (!row) throw new Error("debit_wallet returned no result");

  if (row.ok) return { ok: true, balance: row.balance };
  return { ok: false, balance: row.balance, reason: "insufficient_funds" };
}

// Reserved system wallet that collects rake from wagered matches and
// tournament prize pools. Not a real player account -- permanently claimed
// at the database level (see supabase/migrations, "kentro_house" reservation)
// so no signup, however it's constructed, can ever land on this exact
// username and intercept rake headed here.
export const HOUSE_WALLET_USERNAME = "kentro_house";

/**
 * Settles the entry-fee pot for a finished PvP match. Called from every
 * game-ending path (resign, mutual draw agreement, and the rule-based
 * endings from checkGameEnd -- no legal moves, repetition, the 25-move
 * king rule, the 16/5-move material rules) so payout behavior can never
 * drift between them:
 *   - Draw: both players get their entry fee back (a genuine refund, not
 *     a "prize" -- no coins are created or destroyed, and no rake is taken
 *     on a game nobody actually won).
 *   - Win: the pot (both players' entry fees combined) is raked at
 *     `rakePercent`, rounded down so the winner is never shortchanged by a
 *     rounding quirk; the remainder goes to the winner, the rake goes to
 *     the house wallet. The loser's account is left as-is -- they already
 *     paid their entry fee when the match started; there is no additional
 *     debit on a loss.
 * A no-op if no fee was ever actually charged for this match (e.g. an
 * admin had pricing set to 0), so free matches don't generate pointless
 * zero-amount transactions.
 */
export async function settleMatchPot(
  players: { username: string; color: "W" | "B" }[],
  entryFeePerPlayer: number,
  result: { isDraw: boolean; winnerColor: "W" | "B" | null },
  matchId: string,
  rakePercent: number = 0
): Promise<void> {
  requireCoinAmount(entryFeePerPlayer, true);
  if (entryFeePerPlayer === 0) return;
  requireCoinAmount(entryFeePerPlayer * 2);
  if (!Number.isFinite(rakePercent) || rakePercent < 0 || rakePercent > 1) {
    throw new Error("Match rake must be between 0 and 1");
  }

  const white = players.find(p => p.color === "W");
  const black = players.find(p => p.color === "B");
  if (players.length !== 2 || !white || !black || !matchId || (!result.isDraw && !result.winnerColor)) {
    throw new Error("A match settlement requires two players and a final result");
  }
  const whiteName = cleanUsername(white.username);
  const blackName = cleanUsername(black.username);
  if (whiteName === blackName) throw new Error("Match players must have distinct wallets");
  const { data, error } = await getSupabaseAdmin().rpc("kentro_settle_match_pot", {
    p_match_id: matchId,
    p_white: whiteName,
    p_black: blackName,
    p_fee: entryFeePerPlayer,
    p_winner: result.isDraw ? null : result.winnerColor === "W" ? whiteName : blackName,
    p_draw: result.isDraw,
    p_rake: rakePercent,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("Match settlement returned no successful result");
}

/**
 * Atomically debits the SAME amount from MULTIPLE wallets (e.g. both
 * players' match entry fee) as a single all-or-nothing operation: if ANY
 * wallet lacks funds, NONE of them are charged, and the list of usernames
 * that came up short is returned so the caller can reject the match start
 * with a clear reason instead of half-charging one player.
 *
 * debit_multiple_wallets() in supabase/schema.sql locks every wallet row
 * (in sorted order, to avoid deadlocking against a concurrent call touching
 * an overlapping set of wallets) inside one transaction before deciding
 * whether to charge anyone.
 */
export async function debitMultipleWallets(
  usernames: string[],
  amount: number,
  reason: CoinTransactionRecord["type"],
  refId?: string
): Promise<{ ok: true } | { ok: false; insufficientUsers: string[] }> {
  // Free matches (0-coin wager / fee) are a legitimate, common case -- they
  // must start instantly with ZERO database work, not throw. (Previously
  // this threw, crashing the join handler for any free room.)
  requireCoinAmount(amount, true);
  if (amount === 0) return { ok: true };
  const cleaned = usernames.map(cleanUsername);
  if (cleaned.length === 0 || new Set(cleaned).size !== cleaned.length) {
    throw new Error("Wallets must be non-empty and distinct");
  }

  const { data, error } = await getSupabaseAdmin().rpc("debit_multiple_wallets", {
    p_usernames: cleaned,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId ?? null,
  });
  if (error) throw error;
  const row = data?.[0] as { ok: boolean; insufficientUsers: string[] | null } | undefined;
  if (!row) throw new Error("debit_multiple_wallets returned no result");

  if (row.ok) return { ok: true };
  return { ok: false, insufficientUsers: row.insufficientUsers ?? [] };
}

/** Credits coins to a wallet (purchases, tournament prizes, admin adjustments, refunds). */
export async function creditWallet(
  username: string,
  amount: number,
  reason: CoinTransactionRecord["type"],
  refId?: string
): Promise<number> {
  requireCoinAmount(amount);
  const uname = cleanUsername(username);

  const { data, error } = await getSupabaseAdmin().rpc("credit_wallet", {
    p_username: uname,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId ?? null,
  });
  if (error) throw error;
  return data as number;
}
