/**
 * Fair, bounded lock for the one-process native draughts engine.
 *
 * Waiting evaluations can be superseded without stranding their promises:
 * the old implementation removed waiting entries without ever resolving or
 * rejecting their acquire() promises, leaking the request until process exit.
 * Running evaluations may be asked to stop, but the lock is transferred only
 * after the active evaluation actually releases it.
 */
interface Waiter {
  run: (release: () => void) => void;
  cancel: () => void;
  supersedeKey?: string;
}

export class Mutex {
  private highQueue: Waiter[] = [];
  private lowQueue: Waiter[] = [];
  private locked = false;
  private currentSupersedeKey?: string;
  private currentStopCallback?: () => void;

  private readonly maxHighWaiting: number;
  private readonly maxLowWaiting: number;
  constructor(maxHighWaiting = 128, maxLowWaiting = 32) {
    this.maxHighWaiting = maxHighWaiting;
    this.maxLowWaiting = maxLowWaiting;
  }

  /** Useful for instrumentation without exposing queued requests. */
  get waiting(): number { return this.highQueue.length + this.lowQueue.length; }

  acquire(isHighPriority = true, supersedeKey?: string, onSuperseded?: () => void): Promise<() => void> {
    if (supersedeKey) {
      this.cancelWaiting(supersedeKey);
      if (this.locked && this.currentSupersedeKey === supersedeKey) {
        this.currentStopCallback?.();
      }
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        supersedeKey,
        run: (release) => resolve(release),
        cancel: () => {
          try { onSuperseded?.(); } catch { /* callbacks cannot strand waiting jobs */ }
          reject(new Error("Superseded"));
        },
      };
      if (!this.locked) {
        this.locked = true;
        this.activate(waiter);
        return;
      }
      const queue = isHighPriority ? this.highQueue : this.lowQueue;
      if (queue.length >= (isHighPriority ? this.maxHighWaiting : this.maxLowWaiting)) {
        reject(new Error("Engine queue busy"));
        return;
      }
      queue.push(waiter);
    });
  }

  private activate(waiter: Waiter): void {
    this.currentSupersedeKey = waiter.supersedeKey;
    this.currentStopCallback = undefined;
    let released = false;
    waiter.run(() => {
      if (released) return;
      released = true;
      this.currentSupersedeKey = undefined;
      this.currentStopCallback = undefined;
      const next = this.highQueue.shift() ?? this.lowQueue.shift();
      if (next) this.activate(next);
      else this.locked = false;
    });
  }

  registerCurrentStop(callback: () => void): void {
    if (this.locked) this.currentStopCallback = callback;
  }

  cancelWaiting(supersedeKey: string): void {
    const filter = (queue: Waiter[]) => queue.filter((waiter) => {
      if (waiter.supersedeKey !== supersedeKey) return true;
      waiter.cancel();
      return false;
    });
    this.highQueue = filter(this.highQueue);
    this.lowQueue = filter(this.lowQueue);
  }
}
