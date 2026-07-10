/**
 * rolling-buffer.ts
 * ------------------------------------------------------------------
 * Adaptive rolling price buffer.
 *
 * - Default cadence: 1 sample / minute (1-minute OHLC-style bars).
 * - When a symbol enters "active watch" (recent sharp drop), cadence
 *   bumps to 1 sample / 15 seconds for ~30 minutes so bottoms can be
 *   detected earlier.
 * - Buffer holds the last 24h of samples in a ring buffer.
 *
 * The buffer is keyed by symbol inside a `RollingBufferRegistry` so
 * the UI layer can keep a single instance per app lifetime and the
 * detector can iterate over all tracked symbols cheaply.
 * ------------------------------------------------------------------
 */

import { ema, rsi, volumeRatio, higherLow, exhaustionCheck, slope } from "./indicators";

export interface Sample {
  /** Epoch ms (start of the sample's window) */
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Cadence = "1m" | "15s";

const CADENCE_MS: Record<Cadence, number> = {
  "1m": 60_000,
  "15s": 15_000,
};

const ACTIVE_WATCH_DURATION_MS = 30 * 60_000; // 30 min
const ACTIVE_WATCH_DROP_THRESHOLD = -5; // -5% in last 30m triggers active watch
const MAX_BUFFER_MS = 24 * 60 * 60_000; // 24h

/**
 * Per-symbol state.
 */
interface SymbolState {
  samples: Sample[];
  /** When the current sample window started */
  currentWindowStart: number;
  /** Aggregation scratch for the current (in-progress) window */
  pendingOpen: number;
  pendingHigh: number;
  pendingLow: number;
  pendingClose: number;
  pendingVolume: number;
  pendingCount: number;
  /** Cadence override expiry (epoch ms). If > now, use 15s; else 1m. */
  activeWatchUntil: number;
  /** Last time we evaluated the active-watch trigger */
  lastWatchCheck: number;
  /** Last emitted BottomEvent timestamp (dedup) */
  lastEventAt: number;
}

export interface BottomEventContext {
  price: number;
  /** 5m close-to-close delta (%) — the actual recent price move */
  delta5m: number;
  /** 15m delta (%) */
  delta15m: number;
  /** 30m delta (%) */
  delta30m: number;
  /** 1h delta (%) */
  delta1h: number;
  /** 24h delta (%) — exchange-style sliding window */
  delta24h: number;
  /** Latest EMA(9) */
  ema9: number | null;
  /** Latest EMA(21) */
  ema21: number | null;
  /** Latest RSI(14) */
  rsi14: number | null;
  /** Previous RSI(14) — for cross-back-above-30 detection */
  rsi14Prev: number | null;
  /** Volume ratio: current / avg(prev 20) */
  volRatio: number | null;
  /** Higher-low detected? */
  higherLow: boolean;
  /** Trend slope of EMA(9) over last 9 samples */
  emaSlope: number | null;
}

export interface BottomEvent {
  symbol: string;
  /** Epoch ms when the event was emitted */
  timestamp: number;
  /** Price at the moment of detection */
  price: number;
  /** 0-100 severity — higher = stronger signal */
  severity: number;
  /** Computed context for UI display */
  context: BottomEventContext;
  /** Which sub-signals fired */
  signals: {
    exhaustion: boolean;
    reversal: boolean;
    confirmation: boolean;
  };
}

export class RollingBufferRegistry {
  private states = new Map<string, SymbolState>();

  /**
   * Push a raw price tick into the registry. The tick will be
   * aggregated into the current sample window; when the window ends,
   * the sample is finalized and pushed onto the buffer.
   *
   * Returns any BottomEvent that fired as a result of this tick.
   */
  push(symbol: string, price: number, volume: number, now: number): BottomEvent | null {
    let st = this.states.get(symbol);
    if (!st) {
      st = {
        samples: [],
        currentWindowStart: 0,
        pendingOpen: 0,
        pendingHigh: -Infinity,
        pendingLow: Infinity,
        pendingClose: 0,
        pendingVolume: 0,
        pendingCount: 0,
        activeWatchUntil: 0,
        lastWatchCheck: 0,
        lastEventAt: 0,
      };
      this.states.set(symbol, st);
    }

    const cadence = this.cadenceFor(st, now);

    // Initialize window on first tick
    if (st.currentWindowStart === 0) {
      st.currentWindowStart = Math.floor(now / CADENCE_MS[cadence]) * CADENCE_MS[cadence];
      st.pendingOpen = price;
      st.pendingHigh = price;
      st.pendingLow = price;
      st.pendingClose = price;
      st.pendingVolume = volume;
      st.pendingCount = 1;
      return null;
    }

    // If we crossed into a new window, finalize the previous one
    const windowEnd = st.currentWindowStart + CADENCE_MS[cadence];
    if (now >= windowEnd) {
      const finalized: Sample = {
        t: st.currentWindowStart,
        open: st.pendingOpen,
        high: st.pendingHigh,
        low: st.pendingLow,
        close: st.pendingClose,
        volume: st.pendingVolume,
      };
      st.samples.push(finalized);

      // Drop samples older than 24h
      const cutoff = now - MAX_BUFFER_MS;
      while (st.samples.length > 0 && st.samples[0].t < cutoff) {
        st.samples.shift();
      }

      // Cap array size at 1500 (defensive — slightly more than 24h of 1m)
      if (st.samples.length > 1500) {
        st.samples.splice(0, st.samples.length - 1500);
      }

      // Start a new window. If cadence changed mid-window, re-align.
      const newCadence = this.cadenceFor(st, now);
      st.currentWindowStart = Math.floor(now / CADENCE_MS[newCadence]) * CADENCE_MS[newCadence];
      st.pendingOpen = price;
      st.pendingHigh = price;
      st.pendingLow = price;
      st.pendingClose = price;
      st.pendingVolume = volume;
      st.pendingCount = 1;

      // After finalizing a sample, check for active-watch promotion
      this.maybePromoteToActiveWatch(symbol, st, now);

      // Run the bottom detector on finalized samples
      return this.runDetector(symbol, st, now);
    }

    // Otherwise, aggregate into the current window
    st.pendingHigh = Math.max(st.pendingHigh, price);
    st.pendingLow = Math.min(st.pendingLow, price);
    st.pendingClose = price;
    st.pendingVolume += volume;
    st.pendingCount++;

    return null;
  }

  /**
   * Returns the close price from `minutesAgo` minutes ago, or null
   * if the buffer doesn't reach back that far.
   *
   * Uses approximate matching (nearest sample ≤ target timestamp).
   */
  priceAgo(symbol: string, minutesAgo: number, now: number): number | null {
    const st = this.states.get(symbol);
    if (!st || st.samples.length === 0) return null;
    const target = now - minutesAgo * 60_000;
    // Binary search for the largest sample.t <= target
    let lo = 0;
    let hi = st.samples.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (st.samples[mid].t <= target) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return null;
    return st.samples[best].close;
  }

  /**
   * Returns a copy of the last N samples (oldest → newest).
   */
  lastSamples(symbol: string, n: number): Sample[] {
    const st = this.states.get(symbol);
    if (!st) return [];
    return st.samples.slice(Math.max(0, st.samples.length - n));
  }

  /**
   * Returns the current cadence for a symbol.
   */
  cadence(symbol: string, now: number = Date.now()): Cadence {
    const st = this.states.get(symbol);
    if (!st) return "1m";
    return this.cadenceFor(st, now);
  }

  /**
   * Returns true if a symbol currently has an active bottom signal
   * within the last `windowMs` (default 5 min).
   */
  hasRecentEvent(symbol: string, windowMs: number = 5 * 60_000): boolean {
    const st = this.states.get(symbol);
    if (!st) return false;
    return Date.now() - st.lastEventAt < windowMs;
  }

  /**
   * Clear all state for a symbol (used when leaving a market tab).
   */
  clear(symbol: string): void {
    this.states.delete(symbol);
  }

  /**
   * Clear everything.
   */
  clearAll(): void {
    this.states.clear();
  }

  /* ----------------------------------------------------------------
   * Private
   * ---------------------------------------------------------------- */

  private cadenceFor(st: SymbolState, now: number): Cadence {
    return now < st.activeWatchUntil ? "15s" : "1m";
  }

  /**
   * If the symbol just dropped ≥5% in the last 30 minutes, bump it
   * to 15s cadence for 30 minutes. This is the "active watch" state.
   */
  private maybePromoteToActiveWatch(symbol: string, st: SymbolState, now: number): void {
    // Throttle check to once per minute
    if (now - st.lastWatchCheck < 60_000) return;
    st.lastWatchCheck = now;

    // Skip if already on active watch
    if (now < st.activeWatchUntil) return;

    // Compute 30m delta using close prices
    const samples = st.samples;
    if (samples.length < 30) return;
    const recent = samples[samples.length - 1].close;
    const past = samples[samples.length - 30].close;
    if (past <= 0) return;
    const delta = ((recent - past) / past) * 100;
    if (delta <= ACTIVE_WATCH_DROP_THRESHOLD) {
      st.activeWatchUntil = now + ACTIVE_WATCH_DURATION_MS;
    }
  }

  /**
   * The bottom-detector rule engine.
   *
   * Fires an event when:
   *   A. Exhaustion    — last 3 5m-close deltas are negative & shrinking in magnitude
   *   B. Reversal      — latest 5m delta is positive AND price > EMA(9)
   *   C. Confirmation  — RSI(14) crossed back above 30 AND vol ratio ≥ 1.5 AND higher-low detected
   *
   * Cooldown: 10 minutes between events for the same symbol.
   */
  private runDetector(symbol: string, st: SymbolState, now: number): BottomEvent | null {
    const samples = st.samples;
    // Need enough samples for: EMA(21), RSI(14), volRatio(20), higherLow(window=2 → 5+)
    if (samples.length < 25) return null;

    // Cooldown — don't spam events
    if (now - st.lastEventAt < 10 * 60_000) return null;

    const closes = samples.map((s) => s.close);
    const volumes = samples.map((s) => s.volume);
    const currentPrice = closes[closes.length - 1];

    // 5m close-to-close deltas
    const deltas: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        deltas.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
      }
    }
    if (deltas.length < 4) return null;

    const last5mDelta = deltas[deltas.length - 1];
    const last15mDelta =
      deltas.length >= 3
        ? deltas.slice(-3).reduce((s, d) => s + d, 0)
        : 0;
    const last30mDelta =
      deltas.length >= 6
        ? deltas.slice(-6).reduce((s, d) => s + d, 0)
        : 0;
    const last1hDelta =
      deltas.length >= 12
        ? deltas.slice(-12).reduce((s, d) => s + d, 0)
        : 0;

    // 24h delta — use first available close as reference
    const firstClose = closes[0];
    const delta24h = firstClose > 0 ? ((currentPrice - firstClose) / firstClose) * 100 : 0;

    // Indicators
    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const rsi14 = rsi(closes, 14);
    // For cross-back-above-30 detection, we need the previous RSI
    const rsi14Prev =
      closes.length >= 16 ? rsi(closes.slice(0, -1), 14) : null;
    const volRatio = volumeRatio(volumes, 20);
    const hl = higherLow(closes, 2);
    const ema9Series = closes.slice(-9);
    const emaSlope = slope(ema9Series, Math.min(9, ema9Series.length));

    /* ------------------ A. Exhaustion ------------------ */
    // Last 3 5m deltas negative & shrinking in magnitude
    const exhaustion = exhaustionCheck(deltas, 3);

    /* ------------------ B. Reversal ------------------ */
    // Latest delta > 0 AND price > EMA(9)
    const reversal =
      last5mDelta > 0 && ema9 !== null && currentPrice > ema9;

    /* ------------------ C. Confirmation ------------------ */
    // RSI crossed back above 30 (prev ≤ 30, current > 30)
    const rsiCrossUp =
      rsi14 !== null &&
      rsi14Prev !== null &&
      rsi14Prev <= 30 &&
      rsi14 > 30;
    // OR RSI was <35 and is now rising
    const rsiRising =
      rsi14 !== null && rsi14Prev !== null && rsi14 > rsi14Prev && rsi14 < 45;
    const volConfirm = volRatio !== null && volRatio >= 1.5;
    const hlConfirm = hl?.isHigherLow ?? false;
    const confirmation =
      (rsiCrossUp || rsiRising) && volConfirm && hlConfirm;

    if (!exhaustion || !reversal || !confirmation) {
      return null;
    }

    // Severity score (0-100)
    let severity = 50;
    // Stronger volume spike → more severe
    if (volRatio !== null && volRatio >= 2.5) severity += 15;
    else if (volRatio !== null && volRatio >= 2) severity += 10;
    // Deeper RSI oversold recovery → more severe
    if (rsi14Prev !== null && rsi14Prev < 20) severity += 15;
    else if (rsi14Prev !== null && rsi14Prev < 25) severity += 8;
    // Bigger reversal delta → more severe
    if (last5mDelta > 2) severity += 10;
    else if (last5mDelta > 1) severity += 5;
    severity = Math.min(100, severity);

    const event: BottomEvent = {
      symbol,
      timestamp: now,
      price: currentPrice,
      severity,
      context: {
        price: currentPrice,
        delta5m: last5mDelta,
        delta15m: last15mDelta,
        delta30m: last30mDelta,
        delta1h: last1hDelta,
        delta24h,
        ema9,
        ema21,
        rsi14,
        rsi14Prev,
        volRatio,
        higherLow: hlConfirm,
        emaSlope,
      },
      signals: {
        exhaustion,
        reversal,
        confirmation,
      },
    };

    st.lastEventAt = now;
    return event;
  }
}

/**
 * Singleton registry — shared across the app lifetime.
 */
let _registry: RollingBufferRegistry | null = null;
export function getRegistry(): RollingBufferRegistry {
  if (!_registry) _registry = new RollingBufferRegistry();
  return _registry;
}
