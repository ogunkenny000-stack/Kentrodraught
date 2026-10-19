/** One authoritative quote for the Ken difficulty levels that are purchasable.
 * Levels 1-3 are free; the player may buy a contiguous higher entitlement.
 * The official win-to-next-level button never spends coins. */
export function quoteKenUnlock(
  currentLevel: number,
  requestedLevel: number | "all",
  perLevel: number,
  allLevelCost: number,
): { level: number; cost: number; currentUnlocked: number } {
  if (!Number.isInteger(currentLevel) || currentLevel < 0 || currentLevel > 8 ||
      !Number.isSafeInteger(perLevel) || perLevel < 0 ||
      !Number.isSafeInteger(allLevelCost) || allLevelCost < 0) {
    throw new Error("Invalid Ken level pricing or entitlement");
  }
  const currentUnlocked = Math.max(3, currentLevel);
  const level = requestedLevel === "all" ? 8 : requestedLevel;
  if (!Number.isInteger(level) || level < 2 || level > 8) throw new Error("Invalid Ken level");
  const remaining = Math.max(0, level - currentUnlocked);
  const incrementalCost = remaining * perLevel;
  if (!Number.isSafeInteger(incrementalCost)) throw new Error("AI unlock price exceeds safe limits");
  return { level, currentUnlocked, cost: requestedLevel === "all" ? Math.min(allLevelCost, incrementalCost) : incrementalCost };
}
