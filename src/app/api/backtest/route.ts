/**
 * /api/backtest
 * ------------------------------------------------------------------
 * Server-side backtest runner.
 *
 * POST body:
 *   {
 *     category: "spot" | "linear",
 *     symbol: string,
 *     interval: "1" | "5" | "15" | ...,
 *     start: epoch ms,
 *     end: epoch ms,
 *     config: {
 *       takeProfitPct, stopLossPct, maxPositions, orderSize,
 *       cooldownMs?, maxHoldMs?
 *     }
 *   }
 *
 * Returns:
 *   { trades: BacktestTrade[], stats: BacktestStats }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel hobby max

import { NextRequest, NextResponse } from "next/server";
import {
  fetchHistoricalKlines,
  type Category,
  type Interval,
} from "@/lib/historical-klines";
import { runBacktest, type BacktestConfig } from "@/lib/backtest-engine";

interface BacktestRequest {
  category: Category;
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
  config: BacktestConfig;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BacktestRequest;

    if (!body.symbol || !body.start || !body.end) {
      return NextResponse.json(
        { error: "Missing required fields: symbol, start, end" },
        { status: 400 }
      );
    }
    if (body.end <= body.start) {
      return NextResponse.json(
        { error: "end must be greater than start" },
        { status: 400 }
      );
    }
    if (!body.config || body.config.takeProfitPct <= 0 || body.config.stopLossPct <= 0) {
      return NextResponse.json(
        { error: "Invalid config: TP and SL must be > 0" },
        { status: 400 }
      );
    }

    // Fetch klines
    const klines = await fetchHistoricalKlines(
      body.category,
      body.symbol,
      body.interval,
      body.start,
      body.end
    );

    if (klines.length === 0) {
      return NextResponse.json(
        { error: "No klines returned for this range. Try a different symbol or wider range." },
        { status: 404 }
      );
    }

    // Run backtest
    const { trades, stats } = runBacktest(klines, body.config, body.symbol);

    return NextResponse.json({
      trades,
      stats,
      klineCount: klines.length,
      rangeStart: klines[0].startTime,
      rangeEnd: klines[klines.length - 1].startTime,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Backtest failed", details: message },
      { status: 500 }
    );
  }
}
