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

async function fetchBybitTickers(category: string): Promise<MarketTicker[]> {
  const url = `${BYBIT_BASE}?category=${category}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 0 },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Bybit API returned ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
    }

    if (!data.result?.list || !Array.isArray(data.result.list)) {
      throw new Error("Invalid response structure from Bybit API");
    }

    const tickers: MarketTicker[] = data.result.list
      .filter((t: BybitTicker) => {
        // Filter out inactive pairs with no trading data
        const price = parseFloat(t.lastPrice);
        const vol = parseFloat(t.volume24h);
        return price > 0 && !isNaN(price);
      })
      .map((t: BybitTicker) => {
        const price = parseFloat(t.lastPrice);
        const prevPrice = parseFloat(t.prevPrice24h);
        const changePercent = parseFloat(t.price24hPcnt) * 100; // decimal to percentage
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

        // Derivatives-specific fields (linear/perpetual)
        if (t.markPrice) ticker.markPrice = parseFloat(t.markPrice);
        if (t.indexPrice) ticker.indexPrice = parseFloat(t.indexPrice);
        if (t.openInterest) ticker.openInterest = parseFloat(t.openInterest);
        if (t.openInterestValue)
          ticker.openInterestValue = parseFloat(t.openInterestValue);
        if (t.fundingRate) ticker.fundingRate = parseFloat(t.fundingRate);
        if (t.nextFundingTime) ticker.nextFundingTime = t.nextFundingTime;

        return ticker;
      });

    return tickers;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request to Bybit API timed out after 10 seconds");
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "spot"; // spot | linear
  const sort = searchParams.get("sort") || "changePercent"; // changePercent | volume24h | turnover24h
  const order = searchParams.get("order") || "desc"; // desc | asc
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const minVolume = parseFloat(searchParams.get("minVolume") || "0");

  // Validate type
  if (!["spot", "linear"].includes(type)) {
    return NextResponse.json(
      { error: "Invalid type. Use 'spot' or 'linear'." },
      { status: 400 }
    );
  }

  try {
    const tickers = await fetchBybitTickers(type);

    // Filter by minimum volume if specified
    let filtered = tickers;
    if (minVolume > 0) {
      filtered = tickers.filter((t) => t.turnover24h >= minVolume);
    }

    // Sort
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
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      return (aVal - bVal) * orderMultiplier;
    });

    // Limit
    const limited = filtered.slice(0, limit);

    // Compute summary stats
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