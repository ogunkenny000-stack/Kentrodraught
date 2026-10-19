import { describe, expect, it, vi } from "vitest";
import { calculateRating, defaultPlayerRating } from "../rating";
import { applyAuthoritativeRating } from "./authoritativeRatings";
import type { KentroGameRecord } from "../types/gameRecords";

const record = {
  gameCode: "26100001", gameMode: "Multiplayer", gameEndTime: 1000,
  whitePlayer: "Alice", blackPlayer: "Bob", winner: "Alice", isDraw: false,
  participantUserIds: ["uid-alice", "uid-bob"],
} as KentroGameRecord;
const profiles = [
  { usernameLower: "alice", ownerId: "uid-alice", elo: 1500, rd: null, vol: null, statsVersion: 0 },
  { usernameLower: "bob", ownerId: "uid-bob", elo: 1500, rd: null, vol: null, statsVersion: 0 },
];
function fixture() {
  const read = vi.fn().mockResolvedValue({ data: profiles, error: null });
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true, white: { username: "Alice", rating: 1662 }, black: { username: "Bob", rating: 1338 } }, error: null });
  return { db: { from: () => ({ select: () => ({ in: read }) }), rpc }, read, rpc };
}
describe("server-owned Glicko results", () => {
  it("matches the equal-new-player Glicko-2 fixture for both players", () => {
    const result = calculateRating(defaultPlayerRating,defaultPlayerRating,1);
    expect(result.newPlayer1.rating).toBeCloseTo(1662.310894,5);
    expect(result.newPlayer2.rating).toBeCloseTo(1337.689106,5);
    expect(result.newPlayer1.rd).toBeCloseTo(290.318964,5);
    expect(result.newPlayer1.vol).toBeCloseTo(0.059999675,8);
    const draw = calculateRating(defaultPlayerRating,defaultPlayerRating,0.5);
    expect(draw.newPlayer1.rating).toBe(1500); expect(draw.newPlayer2.rating).toBe(1500);
  });
  it("uses canonical verified owners and server Glicko values in the transaction", async () => {
    const f=fixture();
    await applyAuthoritativeRating(f.db as any,record);
    expect(f.rpc).toHaveBeenCalledWith("kentro_apply_rated_result",expect.objectContaining({
      p_white_owner: "uid-alice",p_black_owner:"uid-bob",p_white_version:0,p_black_version:0,
      p_winner:"W",p_after:{ white: expect.objectContaining({rating:1662}),black:expect.objectContaining({rating:1338}) },
    }));
  });
  it("recomputes with fresh snapshots after a concurrent completion", async () => {
    const f=fixture();
    f.rpc.mockResolvedValueOnce({data:{ok:false,retry:true},error:null});
    f.read.mockResolvedValueOnce({data:profiles,error:null}).mockResolvedValue({data:profiles.map(p=>({...p,elo:1600,statsVersion:1})),error:null});
    await applyAuthoritativeRating(f.db as any,record);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.rpc.mock.calls[1][1]).toMatchObject({p_white_version:1,p_black_version:1,p_after:{white:{rating:1762},black:{rating:1438}}});
  });
  it("fails closed on identity mismatch or unavailable profiles", async () => {
    const f=fixture();
    await expect(applyAuthoritativeRating(f.db as any,{...record,participantUserIds:["attacker","uid-bob"]})).rejects.toThrow("verified online participants");
    expect(f.rpc).not.toHaveBeenCalled();
    f.read.mockResolvedValue({data:null,error:new Error("database unavailable")});
    await expect(applyAuthoritativeRating(f.db as any,record)).rejects.toThrow("database unavailable");
  });
  it("leaves guests, local practice and AI games unranked", async () => {
    const f=fixture();
    for (const item of [{...record,gameMode:"Human_vs_AI"},{...record,participantUserIds:["uid-alice"]},{...record,gameEndTime:0}]) {
      expect(await applyAuthoritativeRating(f.db as any,item)).toBeNull();
    }
    expect(f.read).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
});
