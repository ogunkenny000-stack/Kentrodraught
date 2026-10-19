/** Graceful storage facade for embedded browsers, private mode and quota errors.
 * Storage must never prevent a player from reaching their board. */
export interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createSafeStorage(kind: "localStorage" | "sessionStorage"): SafeStorage {
  const open = (): Storage | null => {
    try { return typeof window !== "undefined" ? window[kind] : null; }
    catch { return null; }
  };
  return {
    getItem(key) { try { return open()?.getItem(key) ?? null; } catch { return null; } },
    setItem(key, value) { try { open()?.setItem(key, value); } catch { /* storage denied or full */ } },
    removeItem(key) { try { open()?.removeItem(key); } catch { /* storage denied */ } },
  };
}
export const safeStorage = createSafeStorage("localStorage");
export const safeSessionStorage = createSafeStorage("sessionStorage");
