/** Startup money-system gate. A missing migration must never become a charge. */
import { getSupabaseAdmin } from "../../supabaseAdmin";

export interface CoinReadiness { ok: boolean; reason: string }
export async function checkCoinInfrastructure(): Promise<CoinReadiness> {
  if (process.env.KENTRO_COINS_ENABLED !== "1") return { ok: false, reason: "KENTRO_COINS_ENABLED is not 1" };
  try {
    const { data, error } = await getSupabaseAdmin().rpc("kentro_coin_readiness");
    if (error || data?.ready !== true) return { ok: false, reason: "Coin migration incomplete or database unavailable" };
    return { ok: true, reason: "Required atomic financial RPCs installed" };
  } catch {
    return { ok: false, reason: "Coin database preflight failed" };
  }
}
