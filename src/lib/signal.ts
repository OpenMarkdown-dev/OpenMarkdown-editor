/**
 * The app's one local pub/sub (change: feedback, design D8). Every "tell me
 * when X happens" inside the frontend — the effective theme, the left peek, the
 * math converter being ready, the content zoom, the shared clock, the
 * notification list — is one of these, instead of a hand-rolled
 * `new Set<() => void>()` per module that each re-decides whether a subscriber
 * may unsubscribe itself mid-emit. `check-app-surface.mjs` (`hand-rolled-signal`)
 * fails on a second implementation.
 */
export interface Signal<T = void> {
  /** Be told on every `emit`. Returns the unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
  /** Notify every subscriber present when the emit started. */
  emit(value: T): void;
  /** Drop every subscriber (one-shot signals clear after firing). */
  clear(): void;
  /** How many subscribers there are — the clock starts / stops its ticker on it. */
  readonly size: number;
}

export function createSignal<T = void>(): Signal<T> {
  const subscribers = new Set<(value: T) => void>();
  return {
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    emit(value) {
      // Copy first: a subscriber may unsubscribe itself (or another) while
      // being notified, and one added mid-emit waits for the next one.
      for (const fn of [...subscribers]) fn(value);
    },
    clear() {
      subscribers.clear();
    },
    get size() {
      return subscribers.size;
    },
  };
}
