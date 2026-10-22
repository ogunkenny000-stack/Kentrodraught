export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let prompt: InstallPromptEvent | null = null;
let hidden = false;
let busy = false;
let initialized = false;
const listeners = new Set<() => void>();
let snapshot = { hidden, busy, promptReady: false };
const emit = () => { snapshot = { hidden, busy, promptReady: !!prompt }; listeners.forEach(fn => fn()); };
export const subscribeInstall = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getInstallState = () => snapshot;
export function initializeInstallPrompt() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const media = window.matchMedia('(display-mode: standalone)');
  const standalone = () => media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  hidden = standalone(); emit();
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event as InstallPromptEvent; if (!standalone()) hidden = false; emit();
  });
  window.addEventListener('appinstalled', () => { hidden = true; prompt = null; busy = false; emit(); });
  media.addEventListener?.('change', () => { hidden = standalone(); emit(); });
}
export async function requestPwaInstall(): Promise<'accepted' | 'dismissed' | 'help'> {
  if (busy) return 'dismissed';
  if (!prompt) return 'help';
  const event = prompt;
  prompt = null; busy = true; emit();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') hidden = true;
    return choice.outcome;
  } catch { return 'help'; }
  finally { busy = false; emit(); }
}
export function installPlatform(): 'ios' | 'android' | 'desktop' {
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
}
