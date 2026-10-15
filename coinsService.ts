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

  if (result.isDraw) {
    await Promise.all(
      players.map((p) => creditWallet(p.username, entryFeePerPlayer, "refund", matchId))
    );
    return;
  }

  if (!result.winnerColor) return; // shouldn't happen (non-draw with no winner), but don't guess
  const winner = players.find((p) => p.color === result.winnerColor);
  if (!winner) return;

  const pot = entryFeePerPlayer * 2;
  const rake = Math.max(0, Math.min(pot, Math.floor(pot * rakePercent)));
  const payout = pot - rake;

  if (payout > 0) await creditWallet(winner.username, payout, "match_prize", matchId);
  if (rake > 0) {
    await creditWallet(HOUSE_WALLET_USERNAME, rake, "rake", `rake:${matchId}`);
  }
  // Loser: intentionally no action -- their entry fee was already debited
  // at match start and is not returned on a loss.
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

export interface AtomicFinancialResult {
  ok: boolean;
  errorReason?: string;
  balance?: number;
  maxUnlockedKenLevel?: number;
  requestId?: string;
  nairaAmount?: number;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(value: string): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error("A valid account or request UUID is required");
}
async function financialRpc(name: string, args: Record<string, unknown>): Promise<AtomicFinancialResult> {
  const { data, error } = await getSupabaseAdmin().rpc(name, args);
  if (error) throw error;
  if (!data || typeof data.ok !== "boolean") throw new Error(`${name} returned no valid result`);
  return data as AtomicFinancialResult;
}

/** Charge and profile unlock commit together; retries never charge an unlocked level. */
export async function unlockAiLevel(ownerId: string, level: number, cost: number): Promise<AtomicFinancialResult> {
  requireUuid(ownerId);
  requireCoinAmount(cost, true);
  if (!Number.isInteger(level) || level < 2 || level > 8) throw new Error("Invalid AI level");
  return financialRpc("unlock_ai_level", { p_owner_id: ownerId, p_level: level, p_cost: cost });
}

/** Request id is an idempotency key: escrow and durable request are one transaction. */
export async function submitWithdrawal(input: {
  ownerId: string; requestId: string; coins: number; nairaAmount: number;
  accountName: string; accountNumber: string; bankName: string | null;
}): Promise<AtomicFinancialResult> {
  requireUuid(input.ownerId); requireUuid(input.requestId);
  requireCoinAmount(input.coins); requireCoinAmount(input.nairaAmount, true);
  if (typeof input.accountName !== "string" || !input.accountName.trim() || input.accountName.length > 120 ||
      typeof input.accountNumber !== "string" || !/^[0-9]{8,20}$/.test(input.accountNumber) ||
      (input.bankName !== null && (typeof input.bankName !== "string" || input.bankName.length > 120))) {
    throw new Error("Invalid bank account details");
  }
  return financialRpc("submit_withdrawal", { p_owner_id: input.ownerId, p_request_id: input.requestId,
    p_coins: input.coins, p_naira_amount: input.nairaAmount, p_account_name: input.accountName,
    p_account_number: input.accountNumber, p_bank_name: input.bankName });
}

export async function resolveWithdrawal(requestId: string, approve: boolean, adminUid: string, ip?: string): Promise<AtomicFinancialResult> {
  requireUuid(requestId); requireUuid(adminUid);
  if (typeof approve !== "boolean") throw new Error("Resolution must be a boolean");
  return financialRpc("resolve_withdrawal", { p_request_id: requestId, p_approve: approve, p_admin_uid: adminUid, p_ip: ip || null });
}

export async function resolvePurchase(requestId: string, approve: boolean, coins: number, packageId: string, adminUid: string, ip?: string): Promise<AtomicFinancialResult> {
  requireUuid(requestId); requireUuid(adminUid); requireCoinAmount(coins, !approve);
  if (typeof approve !== "boolean" || typeof packageId !== "string" || !packageId) throw new Error("Invalid purchase resolution");
  return financialRpc("resolve_purchase", { p_request_id: requestId, p_approve: approve, p_coins: coins,
    p_package_id: packageId, p_admin_uid: adminUid, p_ip: ip || null });
}
