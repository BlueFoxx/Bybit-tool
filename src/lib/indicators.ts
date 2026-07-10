/**
 * indicators.ts
 * ------------------------------------------------------------------
 * Pure, allocation-light technical indicator helpers.
 *
 * All functions are designed to operate on small arrays (a few hundred
 * samples max) and return primitive numbers, so they can be called
 * inside a hot loop without creating intermediate arrays.
 *
 * Conventions:
 *   - `values` is ordered OLDEST → NEWEST (oldest at index 0)
 *   - `period` is the lookback window
 *   - All return `null` if there isn't enough data yet
 * ------------------------------------------------------------------
 */

/**
 * Simple Moving Average over the last `period` values.
 */
export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}

/**
 * Exponential Moving Average over the entire series, returns the
 * latest EMA value. Uses the standard seeding: first value = EMA[0].
 *
 * `k = 2 / (period + 1)` is the smoothing constant.
 */
export function ema(values: number[], period: number): number | null {
  if (values.length === 0 || period <= 0) return null;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/**
 * EMA computed across a series, returning the full series of EMA
 * values (same length as input). Useful for charting overlays.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  if (values.length === 0 || period <= 0) return values.map(() => null);
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(values.length).fill(null);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    const prev = out[i - 1] as number;
    out[i] = values[i] * k + prev * (1 - k);
  }
  // First `period-1` values are unreliable — null them out for charting
  for (let i = 0; i < Math.min(period - 1, values.length); i++) {
    out[i] = null;
  }
  return out;
}

/**
 * Wilder's RSI (the one TradingView / Bybit chart shows).
 *
 * Uses the standard "Wilder smoothing" of avg-gain / avg-loss:
 *   avgGain[i] = (avgGain[i-1] * (period-1) + gain[i]) / period
 *
 * Returns the latest RSI value, or null if not enough data.
 */
export function rsi(values: number[], period: number = 14): number | null {
  if (values.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Seed: average of the first `period` gains/losses
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth forward
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Full RSI series (for charting). Same algorithm as `rsi()` but
 * returns every intermediate value.
 */
export function rsiSeries(
  values: number[],
  period: number = 14
): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Volume ratio: current volume vs average of the previous `lookback`
 * candles. Returns a multiplier (e.g. 1.5 means current is 1.5× avg).
 *
 * `volumes` is OLDEST → NEWEST. The last entry is "current".
 */
export function volumeRatio(
  volumes: number[],
  lookback: number
): number | null {
  if (volumes.length < lookback + 1 || lookback <= 0) return null;
  let sum = 0;
  for (let i = volumes.length - 1 - lookback; i < volumes.length - 1; i++) {
    sum += volumes[i];
  }
  const avg = sum / lookback;
  if (avg <= 0) return null;
  return volumes[volumes.length - 1] / avg;
}

/**
 * Detect a "higher low" pattern: did the most recent local minimum
 * occur at a higher price than the previous local minimum?
 *
 * A local minimum is defined as a value that is strictly less than
 * its `window` neighbors on each side (or the array edge).
 *
 * Returns `{ currentLow, previousLow, isHigherLow }` or null.
 */
export function higherLow(
  values: number[],
  window: number = 2
): { currentLow: number; previousLow: number; isHigherLow: boolean } | null {
  if (values.length < window * 2 + 3) return null;

  const lows: { index: number; value: number }[] = [];
  for (let i = window; i < values.length - window; i++) {
    let isLow = true;
    for (let j = 1; j <= window; j++) {
      if (values[i] > values[i - j] || values[i] > values[i + j]) {
        isLow = false;
        break;
      }
    }
    if (isLow) lows.push({ index: i, value: values[i] });
  }

  if (lows.length < 2) return null;
  const current = lows[lows.length - 1];
  const previous = lows[lows.length - 2];
  return {
    currentLow: current.value,
    previousLow: previous.value,
    isHigherLow: current.value > previous.value,
  };
}

/**
 * Sequence-of-deltas check: are the last N deltas all negative AND
 * strictly decreasing in magnitude (i.e. the drop is losing steam)?
 *
 * `deltas` is OLDEST → NEWEST. The last `count` entries are checked.
 *
 * Example: deltas = [-5, -4, -3, -2] → decreasing magnitude → true
 *           deltas = [-2, -3, -4, -5] → accelerating drop → false
 */
export function exhaustionCheck(
  deltas: number[],
  count: number = 3
): boolean {
  if (deltas.length < count || count < 2) return false;
  const slice = deltas.slice(-count);
  for (const d of slice) {
    if (d >= 0) return false; // must all be negative
  }
  for (let i = 1; i < slice.length; i++) {
    // |delta| should be decreasing → d[i] should be > d[i-1] (less negative)
    if (slice[i] <= slice[i - 1]) return false;
  }
  return true;
}

/**
 * Linear regression slope over a window — useful for "trend is
 * flattening" detection on a short EMA.
 *
 * Returns slope per sample (units: price/sample).
 */
export function slope(values: number[], period: number): number | null {
  if (values.length < period || period < 2) return null;
  const slice = values.slice(-period);
  const n = slice.length;
  const xMean = (n - 1) / 2;
  const yMean = slice.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (slice[i] - yMean);
    den += (i - xMean) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}
