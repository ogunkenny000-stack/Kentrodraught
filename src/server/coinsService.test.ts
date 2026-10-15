import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ rpc, from }) }));
import { creditWallet, debitWallet, debitMultipleWallets, getOrCreateWallet, settleMatchPot } from "../../coinsService";

beforeEach(() => { vi.resetAllMocks(); });

describe("coin service input boundaries", () => {
  it.each([NaN, Infinity, -Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid single-wallet amount %s before any RPC", async (amount) => {
    await expect(creditWallet("alice", amount, "refund")).rejects.toThrow("safe integer");
    await expect(debitWallet("alice", amount, "match_entry")).rejects.toThrow("safe integer");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("does not treat invalid multi-wallet amount %s as a free match", async (amount) => {
    await expect(debitMultipleWallets(["alice", "bob"], amount, "match_entry")).rejects.toThrow("safe integer");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps a zero-cost match database-free", async () => {
    await expect(debitMultipleWallets(["alice", "bob"], 0, "match_entry")).resolves.toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("retains amount, reason and normalized username on valid credits", async () => {
    rpc.mockResolvedValue({ data: 15, error: null });
    await expect(creditWallet(" Alice ", 5, "refund", "game-1")).resolves.toBe(15);
    expect(rpc).toHaveBeenCalledWith("credit_wallet", { p_username: "alice", p_amount: 5, p_reason: "refund", p_ref_id: "game-1" });
  });
  it("rejects empty wallet names", async () => {
    await expect(creditWallet("  ", 1, "refund")).rejects.toThrow("username");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("settles a 100% configured rake without an invalid zero credit", async () => {
    rpc.mockResolvedValue({ data: { ok: true, payout: 0, rake: 20 }, error: null });
    await settleMatchPot([{ username: "alice", color: "W" }, { username: "bob", color: "B" }], 10, { isDraw: false, winnerColor: "W" }, "game-1", 1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("kentro_settle_match_pot", expect.objectContaining({ p_match_id: "game-1", p_fee: 10, p_rake: 1 }));
  });
  it("settles a draw through one atomic RPC rather than independent credits", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await settleMatchPot([{ username: "alice", color: "W" }, { username: "bob", color: "B" }], 10, { isDraw: true, winnerColor: null }, "game-2");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("kentro_settle_match_pot", expect.objectContaining({ p_draw: true, p_winner: null }));
  });
  it("propagates a settlement error so the caller can retry safely", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("transaction aborted") });
    await expect(settleMatchPot([{ username: "alice", color: "W" }, { username: "bob", color: "B" }], 10, { isDraw: false, winnerColor: "W" }, "game-3")).rejects.toThrow("transaction aborted");
  });
  it("rejects duplicated multi-wallet identities before the database", async () => {
    await expect(debitMultipleWallets(["alice", " ALICE "], 5, "match_entry")).rejects.toThrow("distinct");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -0.1, 1.1])("rejects invalid rake %s before paying anyone", async (rake) => {
    await expect(settleMatchPot([{ username: "alice", color: "W" }, { username: "bob", color: "B" }], 10, { isDraw: false, winnerColor: "W" }, "game-1", rake)).rejects.toThrow("rake");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("wallet creation reread", () => {
  function setup(readResult: unknown, insertError: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce(readResult);
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle, insert: vi.fn().mockResolvedValue({ error: insertError }) };
    from.mockReturnValue(query);
    return query;
  }
  it("does not replace a failed database reread with a fabricated zero balance", async () => {
    const error = new Error("connection unavailable");
    setup({ data: null, error });
    await expect(getOrCreateWallet("alice", "uid")).rejects.toBe(error);
  });
  it("requires the inserted wallet to be readable", async () => {
    setup({ data: null, error: null });
    await expect(getOrCreateWallet("alice", "uid")).rejects.toThrow("after creation");
  });
  it("still handles a concurrent wallet creation", async () => {
    setup({ data: { balance: 17 }, error: null }, { code: "23505" });
    await expect(getOrCreateWallet("alice", "uid")).resolves.toBe(17);
  });
});
