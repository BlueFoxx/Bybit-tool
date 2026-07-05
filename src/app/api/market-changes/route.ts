export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";

const BYBIT_BASE = "https://api.bybit.com/v5/market/tickers";

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  prevPrice24h: string;
  price24hPcnt: string;
  highPrice24h: string;
  lowPrice24h: string;
  turnover24h: string;
  volume24h: string;
  markPrice?: string;
  indexPrice?: string;
  openInterest?: string;
  openInterestValue?: string;
  fundingRate?: string;
  nextFundingTime?: string;
  bid1Price: string;
  ask1Price: string;
}

export interface MarketTicker {
  symbol: string;
  price: number;
  change24h: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  turnover24h: number;
  markPrice?: number;
  indexPrice?: number;
  openInterest?: number;
  openInterestValue?: number;
  fundingRate?: number;
  nextFundingTime?: string;
}

const REQUEST_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

function parseTickers(list: BybitTicker[]): MarketTicker[] {
  return list
    .filter((t: BybitTicker) => {
      const price = parseFloat(t.lastPrice);
      return price > 0 && !isNaN(price);
    })
    .map((t: BybitTicker) => {
      const price = parseFloat(t.lastPrice);
      const prevPrice = parseFloat(t.prevPrice24h);
      const changePercent = parseFloat(t.price24hPcnt) * 100;
      const change24h = price - prevPrice;

      const ticker: MarketTicker = {
        symbol: t.symbol,
        price,
        change24h: isNaN(change24h) ? 0 : change24h,
        changePercent: isNaN(changePercent) ? 0 : changePercent,
        high24h: parseFloat(t.highPrice24h) || 0,
        low24h: parseFloat(t.lowPrice24h) || 0,
        volume24h: parseFloat(t.volume24h) || 0,
        turnover24h: parseFloat(t.turnover24h) || 0,
      };

      if (t.markPrice) ticker.markPrice = parseFloat(t.markPrice);
      if (t.indexPrice) ticker.indexPrice = parseFloat(t.indexPrice);
      if (t.openInterest) ticker.openInterest = parseFloat(t.openInterest);
      if (t.openInterestValue)
        ticker.openInterestValue = parseFloat(t.openInterestValue);
      if (t.fundingRate) ticker.fundingRate = parseFloat(t.fundingRate);
      if (t.nextFundingTime) ticker.nextFundingTime = t.nextFundingTime;

      return ticker;
    });
}

async function fetchFromBybitDirect(category: string): Promise<MarketTicker[]> {
  const url = `${BYBIT_BASE}?category=${category}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: REQUEST_HEADERS,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Direct fetch: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.retCode !== 0) {
      throw new Error(`Bybit error: ${data.retMsg} (${data.retCode})`);
    }
    if (!data.result?.list || !Array.isArray(data.result.list)) {
      throw new Error("Invalid response structure");
    }

    return parseTickers(data.result.list);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function fetchFromBybitProxy(category: string): Promise<MarketTicker[]> {
  const targetUrl = `${BYBIT_BASE}?category=${category}`;
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(proxyUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Proxy fetch: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.retCode !== 0) {
      throw new Error(`Bybit error: ${data.retMsg} (${data.retCode})`);
    }
    if (!data.result?.list || !Array.isArray(data.result.list)) {
      throw new Error("Invalid response from proxy");
    }

    return parseTickers(data.result.list);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function fetchBybitTickers(category: string): Promise<MarketTicker[]> {
  try {
    return await fetchFromBybitDirect(category);
  } catch (directError) {
    console.warn("Direct Bybit fetch failed, trying proxy:", directError);
    return await fetchFromBybitProxy(category);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "spot";
  const sort = searchParams.get("sort") || "changePercent";
  const order = searchParams.get("order") || "desc";
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const minVolume = parseFloat(searchParams.get("minVolume") || "0");

  if (!["spot", "linear"].includes(type)) {
    return NextResponse.json(
      { error: "Invalid type. Use 'spot' or 'linear'." },
      { status: 400 }
    );
  }

  try {
    const tickers = await fetchBybitTickers(type);

    let filtered = tickers;
    if (minVolume > 0) {
      filtered = tickers.filter((t) => t.turnover24h >= minVolume);
    }

    const validSortFields: (keyof MarketTicker)[] = [
      "changePercent",
      "volume24h",
      "turnover24h",
      "price",
      "openInterestValue",
    ];
    const sortField = validSortFields.includes(sort as keyof MarketTicker)
      ? (sort as keyof MarketTicker)
      : "changePercent";
    const orderMultiplier = order === "asc" ? 1 : -1;

    filtered.sort((a, b) => {
      const aVal: number = a[sortField] as number ?? 0;
      const bVal: number = b[sortField] as number ?? 0;
      return (aVal - bVal) * orderMultiplier;
    });

    const limited = filtered.slice(0, limit);

    const gainers = filtered.filter((t) => t.changePercent > 0).length;
    const losers = filtered.filter((t) => t.changePercent < 0).length;
    const unchanged = filtered.length - gainers - losers;

    return NextResponse.json({
      type,
      count: limited.length,
      totalFiltered: filtered.length,
      totalAll: tickers.length,
      stats: { gainers, losers, unchanged },
      sort: { field: sortField, order },
      data: limited,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      {
        error: "Failed to fetch Bybit market data",
        details: message,
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}
