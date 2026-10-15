import { KEN_LEVELS } from "../lib/constants";
import { parseEngineMoveRequest } from "./engineRequest";
import { getSupabaseAdmin, verifyAccessToken } from "../../supabaseAdmin";

export class EngineAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export interface EngineAccessDependencies {
  verify(token: string): Promise<string | null>;
  unlocked(uid: string): Promise<number>;
}
export const hostedEngineAccess: EngineAccessDependencies = {
  verify: verifyAccessToken,
  async unlocked(uid) {
    const { data, error } = await getSupabaseAdmin()
      .from("profiles")
      .select("maxUnlockedKenLevel,banned,suspendedUntil")
      .eq("ownerId", uid)
      .maybeSingle();
    if (error)
      throw new EngineAccessError(
        "Level access is temporarily unavailable.",
        503,
      );
    if (!data || data.banned || Number(data.suspendedUntil) > Date.now())
      throw new EngineAccessError("Account access is unavailable.", 403);
    return Math.max(3, Math.min(8, Number(data.maxUnlockedKenLevel) || 3));
  },
};

/** Never trust client-supplied depth, evaluation mode or a claimed purchase. */
export async function authorizeEngineRequest(
  body: Record<string, unknown>,
  token: string,
  deps: EngineAccessDependencies = hostedEngineAccess,
  allowLegacyLocal = false,
) {
  const options = parseEngineMoveRequest(body);
  if (allowLegacyLocal && body.purpose === undefined) return options;
  if (
    body.purpose !== undefined &&
    !["play", "analysis"].includes(String(body.purpose))
  )
    throw new EngineAccessError("Invalid engine purpose.", 400);
  const play = body.purpose === "play";
  const requested = body.levelId;
  if (
    play &&
    (typeof requested !== "number" ||
      !Number.isInteger(requested) ||
      requested < 1 ||
      requested > 8)
  )
    throw new EngineAccessError("Choose a valid Ken level.", 400);
  let maximum = 3;
  if (token) {
    const uid = await deps.verify(token);
    if (!uid)
      throw new EngineAccessError(
        "Sign in again to use your level access.",
        401,
      );
    maximum = await deps.unlocked(uid);
  }
  const levelId = play ? Number(requested) : maximum;
  if (levelId > maximum)
    throw new EngineAccessError(
      token
        ? "Unlock this Ken level before playing."
        : "Sign in and unlock this Ken level before playing.",
      token ? 403 : 401,
    );
  const level = KEN_LEVELS.find((level) => level.id === levelId)!;
  return {
    ...options,
    depth: level.depth || undefined,
    usePst: level.pst,
    thinkTimeSec: play
      ? level.moveTimeMs / 1000
      : Math.min(options.thinkTimeSec, level.moveTimeMs / 1000),
  };
}
