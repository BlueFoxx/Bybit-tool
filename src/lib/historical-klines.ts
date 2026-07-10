/**
 * historical-klines.ts
 * ------------------------------------------------------------------
 * Fetches historical klines (OHLCV) from Bybit v5 with pagination.
 *
 * Bybit returns up to 1000 candles per request. To get longer history
 * we paginate backwards using the `end` cursor on each call.
 *
 * Interval values supported by Bybit v5:
 *   1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M
 *
 * Each kline is: [startTime, open, high, low, close, volume, turnover]
 *   - startTime: epoch ms string
 *   - all numeric fields are strings
 * ------------------------------------------------------------------
 */

export interface BybitKline {
  startTime: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export type Category = "spot" | "linear";
export type Interval = "1" | "3" | "5" | "15" | "30" | "60" | "240" | "D";

const INTERVAL_MS: Record<Interval, number> = {
  "1": 60_000,
  "3": 3 * 60_000,
  "5": 5 * 60_000,
  "15": 15 * 60_000,
  "30": 30 * 60_000,
  "60": 60 * 60_000,
  "240": 4 * 60 * 60_000,
  D: 24 * 60 * 60_000,
};

const BYBIT_API = "https://api.bybit.com/v5/market/kline";

/**
 * Fetches klines for a symbol between `start` and `end` (epoch ms).
 *
 * Paginates backward from `end` to `start` in 1000-candle batches.
 * Returns the merged list sorted oldest → newest.
 *
 * `onProgress` is called with the cumulative count after each batch
 * so the UI can show progress.
 */
export async function fetchHistoricalKlines(
  category: Category,
  symbol: string,
  interval: Interval,
  start: number,
  end: number,
  onProgress?: (count: number) => void
): Promise<BybitKline[]> {
  const intervalMs = INTERVAL_MS[interval];
  const allKlines: BybitKline[] = [];
  let cursor = end;
  let guard = 0; // safety: max 50 batches = 50,000 candles

  while (cursor > start && guard < 50) {
    guard++;
    const batchEnd = cursor;
    const batchStart = Math.max(start, cursor - intervalMs * 1000);

    const url = `${BYBIT_API}?category=${category}&symbol=${symbol}&interval=${interval}&start=${batchStart}&end=${batchEnd}&limit=1000`;

    let json: { retCode: number; retMsg: string; result?: { list?: string[][] } };

    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) {
        // Try proxy fallback
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetch(proxyUrl, {
          headers: { Accept: "application/json" },
        });
        if (!proxyRes.ok) break;
        json = await proxyRes.json();
      } else {
        json = await res.json();
      }
    } catch {
      // Network error — try proxy
      try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetch(proxyUrl, {
          headers: { Accept: "application/json" },
        });
        if (!proxyRes.ok) break;
        json = await proxyRes.json();
      } catch {
        break;
      }
    }

    if (json.retCode !== 0 || !json.result?.list || json.result.list.length === 0) {
      break;
    }

    // Bybit returns newest-first; reverse for oldest-first
    const batch: BybitKline[] = json.result.list
      .map((k) => ({
        startTime: Number(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        turnover: parseFloat(k[6]),
      }))
      .sort((a, b) => a.startTime - b.startTime);

    // If the oldest kline in this batch is already older than our start,
    // we're done — filter out anything before start
    const oldestInBatch = batch[0].startTime;
    if (oldestInBatch <= start) {
      allKlines.unshift(...batch.filter((k) => k.startTime >= start));
      onProgress?.(allKlines.length);
      break;
    }

    allKlines.unshift(...batch);
    onProgress?.(allKlines.length);

    // Move cursor back. Use the oldest startTime in this batch.
    cursor = oldestInBatch - 1;

    // If the batch was smaller than 1000, Bybit ran out of history
    if (batch.length < 1000) break;

    // Be polite to the API
    await new Promise((r) => setTimeout(r, 150));
  }

  // Deduplicate by startTime (in case batches overlap)
  const seen = new Set<number>();
  const deduped = allKlines.filter((k) => {
    if (seen.has(k.startTime)) return false;
    seen.add(k.startTime);
    return true;
  });

  return deduped;
}

/**
 * Estimate the number of candles a given range will produce.
 * Useful for showing progress UI.
 */
export function estimateCandleCount(
  interval: Interval,
  start: number,
  end: number
): number {
  return Math.ceil((end - start) / INTERVAL_MS[interval]);
}
