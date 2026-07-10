/**
 * /api/klines
 * ------------------------------------------------------------------
 * Server-side proxy to Bybit's historical kline endpoint.
 *
 * Query params:
 *   category: "spot" | "linear"        (default: spot)
 *   symbol:   string                    (required, e.g. "BTCUSDT")
 *   interval: "1"|"3"|"5"|"15"|"30"|"60"|"240"|"D"  (default: "1")
 *   start:    epoch ms                  (required)
 *   end:      epoch ms                  (required)
 *
 * Returns:
 *   { klines: BybitKline[], count, symbol, interval, start, end }
 *
 * Runs on Node.js (not edge) because we may make many sequential
 * fetches with pagination.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  fetchHistoricalKlines,
  type Category,
  type Interval,
} from "@/lib/historical-klines";

const VALID_CATEGORIES: Category[] = ["spot", "linear"];
const VALID_INTERVALS: Interval[] = ["1", "3", "5", "15", "30", "60", "240", "D"];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const category = (searchParams.get("category") || "spot") as Category;
  const symbol = searchParams.get("symbol");
  const interval = (searchParams.get("interval") || "1") as Interval;
  const start = parseInt(searchParams.get("start") || "0", 10);
  const end = parseInt(searchParams.get("end") || "0", 10);

  if (!symbol) {
    return NextResponse.json(
      { error: "Missing 'symbol' parameter" },
      { status: 400 }
    );
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `Invalid category. Use one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: `Invalid interval. Use one of: ${VALID_INTERVALS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!start || !end || end <= start) {
    return NextResponse.json(
      { error: "Provide 'start' and 'end' as epoch ms with end > start" },
      { status: 400 }
    );
  }

  // Cap range at 30 days for 1m to prevent runaway queries
  const MAX_RANGE_MS = 30 * 24 * 60 * 60_000;
  if (end - start > MAX_RANGE_MS && interval === "1") {
    return NextResponse.json(
      {
        error: `Range too large for 1m interval. Max ${MAX_RANGE_MS / (24 * 60 * 60_000)} days. Use a larger interval.`,
      },
      { status: 400 }
    );
  }

  try {
    const klines = await fetchHistoricalKlines(
      category,
      symbol,
      interval,
      start,
      end
    );
    return NextResponse.json({
      klines,
      count: klines.length,
      symbol,
      interval,
      category,
      start,
      end,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch klines", details: message },
      { status: 502 }
    );
  }
}
