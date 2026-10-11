// Matches Depth_Max in the shipped nd_upgraded/search.hpp.
export const MAX_ENGINE_DEPTH = 99;

export function isScanFen(value: unknown): value is string {
  return typeof value === "string" && /^[WB][wWbBe]{50}$/.test(value);
}

export function isEngineDepth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_ENGINE_DEPTH;
}

export function parseEngineMoveRequest(input: unknown): {
  fen: string;
  thinkTimeSec: number;
  depth: number | undefined;
  usePst: boolean;
  supersedeKey: string | undefined;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid engine request");
  const body = input as Record<string, unknown>;
  if (!isScanFen(body.fen)) throw new Error("Invalid FEN: expected a side to move and exactly 50 valid squares");
  if (body.depth !== undefined && !isEngineDepth(body.depth)) {
    throw new Error(`Depth must be an integer between 1 and ${MAX_ENGINE_DEPTH}`);
  }
  if (body.supersedeKey !== undefined && (
    typeof body.supersedeKey !== "string" || body.supersedeKey.length > 128 || /[\r\n\0]/.test(body.supersedeKey)
  )) throw new Error("Invalid request cancellation key");

  const thinkTimeSec = typeof body.thinkTime === "number" && Number.isFinite(body.thinkTime)
    ? Math.max(0.05, Math.min(body.thinkTime, 5)) : 0.8;
  return {
    fen: body.fen,
    thinkTimeSec,
    depth: body.depth as number | undefined,
    usePst: body.usePst === true,
    supersedeKey: (body.supersedeKey as string | undefined) || undefined,
  };
}
