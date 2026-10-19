import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  GUEST_AI_LIMIT, getGuestAiUsed, getGuestName, isGuestActive,
  isGuestName, setGuestActive, claimGuestAiGame,
} from './guestTrial';

afterEach(() => vi.unstubAllGlobals());

describe('guest trials', () => {
  it('handles denied reads and keeps a stable in-memory guest identity', () => {
    vi.stubGlobal('window', { localStorage: {
      getItem() { throw new Error('storage denied'); },
      setItem() { throw new Error('storage denied'); },
      removeItem() { throw new Error('storage denied'); },
    } });
    expect(isGuestActive()).toBe(false);
    expect(getGuestAiUsed()).toBe(0);
    const name = getGuestName();
    expect(isGuestName(name)).toBe(true); expect(getGuestName()).toBe(name);
    expect(claimGuestAiGame()).toBe(false);
    expect(() => setGuestActive(true)).not.toThrow();
  });
  it('refuses to claim a durable AI allowance when storage is unavailable', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('security error'); } });
    expect(claimGuestAiGame()).toBe(false);
  });
  it('persists identity across visits and counts game starts, not moves', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); },
      },
    });
    expect(isGuestActive()).toBe(false);
    setGuestActive(true);
    expect(isGuestActive()).toBe(true);
    const name = getGuestName();
    expect(isGuestName(name)).toBe(true);
    expect(getGuestName()).toBe(name);
    expect(getGuestAiUsed()).toBe(0);
    for (let i = 1; i <= GUEST_AI_LIMIT; i++) {
      expect(claimGuestAiGame()).toBe(true);
      expect(getGuestAiUsed()).toBe(i);
    }
    expect(claimGuestAiGame()).toBe(false);
    setGuestActive(false);
    expect(getGuestAiUsed()).toBe(GUEST_AI_LIMIT); // sign-in prompt doesn't reset usage
  });
});
