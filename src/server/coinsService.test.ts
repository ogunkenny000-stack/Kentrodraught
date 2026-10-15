import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ rpc, from }) }));
import { creditWallet, debitWallet, debitMultipleWallets, getOrCreateWallet, settleMatchPot, unlockAiLevel, submitWithdrawal, resolvePurchase, resolveWithdrawal } from "../../coinsService";

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
    rpc.mockResolvedValue({ data: 20, error: null });
    await settleMatchPot([{ username: "alice", color: "W" }, { username: "bob", color: "B" }], 10, { isDraw: false, winnerColor: "W" }, "game-1", 1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("credit_wallet", expect.objectContaining({ p_username: "kentro_house", p_amount: 20, p_reason: "rake" }));
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


describe("atomic financial operations", () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const request = "22222222-2222-4222-8222-222222222222";
  it("never charges an invalid target or a fractional cost", async () => {
    await expect(unlockAiLevel(owner, 8, 1.1)).rejects.toThrow("safe integer");
    await expect(unlockAiLevel(owner, 9, 1)).rejects.toThrow("level");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses a single operation for a free or paid unlock", async () => {
    rpc.mockResolvedValue({ data: { ok: true, balance: 9, maxUnlockedKenLevel: 8 }, error: null });
    await expect(unlockAiLevel(owner, 8, 0)).resolves.toMatchObject({ ok: true, maxUnlockedKenLevel: 8 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
  it("propagates transaction failures instead of fabricating completed requests", async () => {
    const error = new Error("transaction rolled back");
    rpc.mockResolvedValue({ data: null, error });
    await expect(submitWithdrawal({ ownerId: owner, requestId: request, coins: 500, nairaAmount: 4750,
      accountName: "Alice", accountNumber: "0123456789", bankName: null })).rejects.toBe(error);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
  it("requires a stable request id and real boolean decision before resolving money", async () => {
    await expect(resolveWithdrawal("bad-id", true, owner)).rejects.toThrow("UUID");
    await expect(resolveWithdrawal(request, "false" as unknown as boolean, owner)).rejects.toThrow("boolean");
    await expect(resolvePurchase(request, true, 0, "starter", owner)).rejects.toThrow("safe integer");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not turn an empty RPC response into a success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(resolveWithdrawal(request, false, owner)).rejects.toThrow("valid result");
  });
});
