export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";

const BYBIT_API = "https://api.bybit.com/v5/market";
const PROXY_API = "https://api.allorigins.win/raw?url=";

const STABLECOINS = new Set([
  "USDT", "USDC", "DAI", "TUSD", "BUSD", "USDP", "FDUSD",
  "USDE", "PYUSD", "RLUSD", "FRAX", "USDD", "CRVUSD", "EURC",
]);

const STABLE_PATTERN = new Set([
  "USDT", "USDC", "DAI", "TUSD", "BUSD", "USDP", "FDUSD",
  "USDE", "PYUSD", "RLUSD", "FRAX", "USDD", "CRVUSD", "EURC",
]);

const REQ_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TimeframeChanges {
  m5: number | null;
  m10: number | null;
  m15: number | null;
  m30: number | null;
  h1: number | null;
  h12: number | null;
  h24: number;
}

export interface MarketTicker {
  symbol: string;
  price: number;
  turnover24h: number;
  changes: TimeframeChanges;
  sparkline: number[];
  markPrice?: number;
  openInterestValue?: number;
  fundingRate?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isStablePair(symbol: string): boolean {
  for (const stable of STABLE_PATTERN) {
    if (symbol.endsWith(stable) && symbol !== stable) {
      const base = symbol.slice(0, -stable.length);
      if (STABLECOINS.has(base)) return true;
    }
  }
  return false;
}

function calcChange(current: number, past: number): number {
  if (past <= 0) return 0;
  return ((current - past) / past) * 100;
}

let useProxy = false;

async function bybitFetch(url: string): Promise<unknown> {
  if (!useProxy) {
    try {
      const res = await fetch(url, { headers: REQ_HEADERS });
      if (res.status === 403) {
        useProxy = true;
      } else if (res.ok) {
        return await res.json();
      } else {
        throw new Error(`${res.status} ${res.statusText}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("403")) {
        useProxy = true;
      } else {
        throw e;
      }
    }
  }
  const proxyUrl = `${PROXY_API}${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Proxy: ${res.status}`);
  return await res.json();
}

/* ------------------------------------------------------------------ */
/*  Concurrency-limited parallel map                                    */
/* ------------------------------------------------------------------ */

async function concurrentMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      if (idx < items.length) {
        results[idx] = await fn(items[idx], idx);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ */
/*  Kline helpers                                                      */
/* ------------------------------------------------------------------ */

interface KlineEntry {
  symbol: string;
  candles: string[][] | null;
}

async function fetchKline(
  category: string,
  symbol: string,
  interval: string,
  limit: number
): Promise<string[][] | null> {
  try {
    const url = `${BYBIT_API}/kline?category=${category}&symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const data = (await bybitFetch(url)) as {
      retCode: number;
      retMsg: string;
      result?: { list?: string[][] };
    };
    if (data.retCode !== 0 || !data.result?.list) return null;
    return data.result.list;
  } catch {
    return null;
  }
}

/* Sort klines by startTime descending (newest first) for reliable indexing */
function sortKlinesDesc(klines: string[][]): string[][] {
  return [...klines].sort((a, b) => Number(b[0]) - Number(a[0]));
}

function extractChanges(
  price: number,
  k5: string[][] | null,
  k60: string[][] | null
): TimeframeChanges {
  const changes: TimeframeChanges = {
    m5: null,
    m10: null,
    m15: null,
    m30: null,
    h1: null,
    h12: null,
    h24: 0,
  };

  // 5m klines → 5m, 10m, 15m, 30m changes
  // Ensure descending order (newest first) so indices map to correct timeframes
  if (k5 && k5.length >= 2) {
    const sorted = sortKlinesDesc(k5);
    const c5 = parseFloat(sorted[1][4]);
    if (c5 > 0) changes.m5 = calcChange(price, c5);
    if (sorted.length >= 3) {
      const c = parseFloat(sorted[2][4]);
      if (c > 0) changes.m10 = calcChange(price, c);
    }
    if (sorted.length >= 4) {
      const c = parseFloat(sorted[3][4]);
      if (c > 0) changes.m15 = calcChange(price, c);
    }
    if (sorted.length >= 7) {
      const c = parseFloat(sorted[6][4]);
      if (c > 0) changes.m30 = calcChange(price, c);
    }
  }

  // 60m klines → 1h, 12h changes
  if (k60 && k60.length >= 2) {
    const sorted = sortKlinesDesc(k60);
    const c1 = parseFloat(sorted[1][4]);
    if (c1 > 0) changes.h1 = calcChange(price, c1);
    if (sorted.length >= 13) {
      const c = parseFloat(sorted[12][4]);
      if (c > 0) changes.h12 = calcChange(price, c);
    }
  }

  return changes;
}

/* ------------------------------------------------------------------ */
/*  GET handler                                                        */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "spot";

  if (!["spot", "linear"].includes(type)) {
    return NextResponse.json(
      { error: "Invalid type. Use 'spot' or 'linear'." },
      { status: 400 }
    );
  }

  try {
    // Reset proxy flag for each request
    useProxy = false;

    // 1. Fetch all tickers
    const tickerUrl = `${BYBIT_API}/tickers?category=${type}`;
    const tickerData = (await bybitFetch(tickerUrl)) as {
      retCode: number;
      retMsg: string;
      result?: { list?: Record<string, string>[] };
    };

    if (tickerData.retCode !== 0) {
      throw new Error(`Bybit: ${tickerData.retMsg} (${tickerData.retCode})`);
    }

    const allTickers = tickerData.result?.list ?? [];

    // 2. Filter: >$300K turnover, active price, not stable/stable
    const MIN_TURNOVER = 300_000;
    const qualified = allTickers.filter((t) => {
      const turnover = parseFloat(t.turnover24h || "0");
      const price = parseFloat(t.lastPrice || "0");
      return turnover >= MIN_TURNOVER && price > 0 && !isStablePair(t.symbol);
    });

    if (qualified.length === 0) {
      return NextResponse.json({
        type,
        data: [],
        count: 0,
        totalAll: allTickers.length,
        fetchedAt: new Date().toISOString(),
      });
    }

    // 3. Build price map
    const priceMap = new Map<string, number>();
    for (const t of qualified) {
      priceMap.set(t.symbol, parseFloat(t.lastPrice));
    }

    // 4. Fetch klines in parallel (2 intervals per symbol)
    const symbols = qualified.map((t) => t.symbol);

    const kline5mResults: KlineEntry[] = await concurrentMap(
      symbols,
      15,
      async (sym) => ({
        symbol: sym,
        candles: await fetchKline(type, sym, "5", 7),
      })
    );

    const kline60mResults: KlineEntry[] = await concurrentMap(
      symbols,
      15,
      async (sym) => ({
        symbol: sym,
        candles: await fetchKline(type, sym, "60", 13),
      })
    );

    // 5. Build lookup maps
    const k5Map = new Map<string, string[][] | null>();
    for (const r of kline5mResults) k5Map.set(r.symbol, r.candles);

    const k60Map = new Map<string, string[][] | null>();
    for (const r of kline60mResults) k60Map.set(r.symbol, r.candles);

    // 6. Assemble final data
    const data: MarketTicker[] = qualified.map((t) => {
      const symbol = t.symbol;
      const price = priceMap.get(symbol) || 0;
      const k5 = k5Map.get(symbol) ?? null;
      const k60 = k60Map.get(symbol) ?? null;

      const changes = extractChanges(price, k5, k60);
      changes.h24 = parseFloat(t.price24hPcnt || "0") * 100;

      // Sparkline: 60m close prices in ascending time order (oldest → newest)
      let sparkline: number[] = [];
      if (k60 && k60.length >= 2) {
        const sorted60 = sortKlinesDesc(k60);
        sparkline = sorted60
          .slice()
          .reverse()
          .map((c) => parseFloat(c[4]));
        // Replace last point with live price for accuracy
        if (sparkline.length > 0) sparkline[sparkline.length - 1] = price;
      }

      const ticker: MarketTicker = {
        symbol,
        price,
        turnover24h: parseFloat(t.turnover24h || "0"),
        changes,
        sparkline,
      };

      // Perpetual-specific
      if (type === "linear") {
        const mp = parseFloat(t.markPrice || "0");
        if (mp > 0) ticker.markPrice = mp;
        const oi = parseFloat(t.openInterestValue || "0");
        if (oi > 0) ticker.openInterestValue = oi;
        const fr = parseFloat(t.fundingRate || "0");
        if (fr !== 0) ticker.fundingRate = fr;
      }

      return ticker;
    });

    return NextResponse.json({
      type,
      data,
      count: data.length,
      totalAll: allTickers.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      {
        error: "Failed to fetch market data",
        details: message,
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}
