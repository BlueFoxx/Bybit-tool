"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Activity,
  RefreshCw,
  Search,
  Zap,
  BarChart3,
  Clock,
  Loader2,
  LineChart,
  FlaskConical,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import SimulatedTrading from "@/components/SimulatedTrading";
import BottomAlertsFeed from "@/components/BottomAlertsFeed";
import BottomMiniChart from "@/components/BottomMiniChart";
import BacktestPanel from "@/components/BacktestPanel";
import { useBottomDetector } from "@/lib/useBottomDetector";
import type { BottomEvent } from "@/lib/rolling-buffer";

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

interface MarketTicker {
  symbol: string;
  price: number;
  turnover24h: number;
  changes: TimeframeChanges;
  sparkline: number[];
  markPrice?: number;
  openInterestValue?: number;
  fundingRate?: number;
}

interface ApiResponse {
  type: string;
  data: MarketTicker[];
  count: number;
  totalAll: number;
  fetchedAt: string;
  error?: string;
  details?: string;
}

type MarketType = "spot" | "linear";
type ViewMode = "live" | "backtest";
type SortField =
  | "changes.m5"
  | "changes.m10"
  | "changes.m15"
  | "changes.m30"
  | "changes.h1"
  | "changes.h12"
  | "changes.h24"
  | "price"
  | "turnover24h"
  | "openInterestValue";
type SortOrder = "asc" | "desc";

/* ------------------------------------------------------------------ */
/*  Timeframe column config                                           */
/* ------------------------------------------------------------------ */

interface TfColumn {
  key: SortField;
  label: string;
  shortLabel: string;
  hideBelow?: number;
}

const TF_COLUMNS: TfColumn[] = [
  { key: "changes.m5", label: "5 Min", shortLabel: "5m", hideBelow: 640 },
  { key: "changes.m10", label: "10 Min", shortLabel: "10m", hideBelow: 768 },
  { key: "changes.m15", label: "15 Min", shortLabel: "15m", hideBelow: 1024 },
  { key: "changes.m30", label: "30 Min", shortLabel: "30m", hideBelow: 1024 },
  { key: "changes.h1", label: "1 Hour", shortLabel: "1h" },
  { key: "changes.h12", label: "12 Hours", shortLabel: "12h", hideBelow: 768 },
  { key: "changes.h24", label: "24 Hours", shortLabel: "24h" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPrice(n: number): string {
  if (n === 0) return "—";
  if (n < 0.001) return "$" + n.toPrecision(4);
  if (n < 0.01) return "$" + n.toPrecision(4);
  if (n < 1) return "$" + n.toFixed(4);
  if (n < 100) return "$" + n.toFixed(3);
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function formatPct(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  const sign = pct > 0 ? "+" : "";
  return sign + pct.toFixed(2) + "%";
}

function pctColor(pct: number | null): string {
  if (pct === null || pct === undefined) return "text-muted-foreground";
  return pct > 0
    ? "text-[var(--gain)]"
    : pct < 0
    ? "text-[var(--loss)]"
    : "text-muted-foreground";
}

function pctArrow(pct: number | null) {
  if (pct === null || pct === undefined) return null;
  if (pct > 0) return <ArrowUp className="h-3 w-3" />;
  if (pct < 0) return <ArrowDown className="h-3 w-3" />;
  return null;
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function extractBase(symbol: string): [string, string] {
  const stables = [
    "USDT", "USDC", "DAI", "TUSD", "BUSD", "USDP", "FDUSD",
    "USDE", "PYUSD", "RLUSD", "FRAX", "USDD", "CRVUSD", "EURC",
  ];
  for (const s of stables) {
    if (symbol.endsWith(s) && symbol.length > s.length) {
      return [symbol.slice(0, -s.length), s];
    }
  }
  return [symbol, ""];
}

function getNestedValue(obj: MarketTicker, path: string): number | null {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let val: any = obj;
  for (const p of parts) {
    if (val == null) return null;
    val = val[p];
  }
  return typeof val === "number" ? val : null;
}

/* ------------------------------------------------------------------ */
/*  Responsive class helper                                            */
/* ------------------------------------------------------------------ */

function responsiveClass(hideBelow?: number): string {
  if (!hideBelow) return "";
  if (hideBelow <= 640) return "hidden sm:table-cell";
  if (hideBelow <= 768) return "hidden md:table-cell";
  if (hideBelow <= 1024) return "hidden lg:table-cell";
  return "hidden xl:table-cell";
}

/* ------------------------------------------------------------------ */
/*  Sparkline component (memoized)                                     */
/* ------------------------------------------------------------------ */

const Sparkline = memo(function Sparkline({
  data,
  width = 88,
  height = 26,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = range * 0.15;
  const yMin = min - pad;
  const yMax = max + pad;
  const yRange = yMax - yMin;

  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((v - yMin) / yRange) * (height - 2) - 1,
  }));

  const linePoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const areaPath =
    `M${pts[0].x.toFixed(1)},${height} ` +
    pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${pts[pts.length - 1].x.toFixed(1)},${height} Z`;

  const isUp = data[data.length - 1] >= data[0];
  const strokeColor = isUp ? "var(--gain)" : "var(--loss)";
  const gradId = `slg-${data.length}-${isUp ? "u" : "d"}`;

  const lastPt = pts[pts.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
      <circle
        cx={lastPt.x}
        cy={lastPt.y}
        r="2"
        fill={strokeColor}
        opacity="0.9"
      />
    </svg>
  );
});

/* ------------------------------------------------------------------ */
/*  Skeleton rows                                                      */
/* ------------------------------------------------------------------ */

function SkeletonRows({ count = 12, colCount = 10 }: { count?: number; colCount?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-6" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-24" />
          </TableCell>
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-[88px]" />
          </TableCell>
          {Array.from({ length: colCount }).map((_, j) => (
            <TableCell key={j} className="text-right">
              <Skeleton className="ml-auto h-4 w-14" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [marketType, setMarketType] = useState<MarketType>("spot");
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("changes.h24");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [data, setData] = useState<MarketTicker[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [fetchedAt, setFetchedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPerp = marketType === "linear";

  // Bottom-detector UI state
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toastEnabled, setToastEnabled] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BottomEvent | null>(null);

  // Wire the bottom-detector into the live data stream
  const {
    events: bottomEvents,
    activeSymbols: bottomActiveSymbols,
    totalEmitted: bottomTotalEmitted,
    registry: bottomRegistry,
    clearEvents: clearBottomEvents,
  } = useBottomDetector(data, {
    soundEnabled,
    toastEnabled,
    toastThreshold: 70,
  });

  // Request notification permission on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Cache per-tab data so switching back is instant
  const tabCache = useRef<Map<MarketType, MarketTicker[]>>(new Map());
  // Guard against stale responses when switching tabs mid-fetch
  const requestIdRef = useRef(0);

  /* ---- Fetch: two-phase (prices first → klines second) ---- */
  const fetchData = useCallback(
    async (isBackgroundRefresh = false) => {
      const requestId = ++requestIdRef.current;
      const cached = tabCache.current.get(marketType);

      // Show cached data instantly (tab switch), or show skeleton (first load)
      if (isBackgroundRefresh) {
        setRefreshing(true);
      } else if (cached && cached.length > 0) {
        setData(cached);
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        // Phase 1: quick prices-only fetch → show table instantly
        if (!isBackgroundRefresh) {
          const quickRes = await fetch(
            `/api/market-changes?type=${marketType}&pricesOnly=true`
          );
          const quickJson: ApiResponse = await quickRes.json();
          if (requestId !== requestIdRef.current) return;
          if (
            quickRes.ok &&
            !quickJson.error &&
            quickJson.data.length > 0
          ) {
            setData(quickJson.data);
            setTotalCount(quickJson.totalAll);
            setFetchedAt(quickJson.fetchedAt);
            setLoading(false);
          }
        }

        // Phase 2: full kline fetch → enrich with all timeframes + sparklines
        const fullRes = await fetch(
          `/api/market-changes?type=${marketType}`
        );
        const fullJson: ApiResponse = await fullRes.json();
        if (requestId !== requestIdRef.current) return;
        if (fullRes.ok && !fullJson.error) {
          setData(fullJson.data);
          setTotalCount(fullJson.totalAll);
          setFetchedAt(fullJson.fetchedAt);
          tabCache.current.set(marketType, fullJson.data);
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        if (
          !isBackgroundRefresh &&
          (!cached || cached.length === 0)
        ) {
          setError(
            err instanceof Error ? err.message : "Failed to load data"
          );
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setRefreshing(false);
          setLoading(false);
        }
      }
    },
    [marketType]
  );

  /* ---- Fast price-only refresh (10s, single API call, no klines) ---- */
  const fetchPrices = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        type: marketType,
        pricesOnly: "true",
      });
      const res = await fetch(`/api/market-changes?${params}`);
      const json: ApiResponse = await res.json();
      if (!res.ok || json.error) return;

      // Build a lookup from the quick response
      const priceMap = new Map<string, MarketTicker>();
      for (const t of json.data) priceMap.set(t.symbol, t);

      // Merge new prices into existing data (preserve kline-based fields)
      setData((prev) => {
        const merged = prev.map((ticker) => {
          const update = priceMap.get(ticker.symbol);
          if (!update) return ticker;
          return {
            ...ticker,
            price: update.price,
            turnover24h: update.turnover24h,
            changes: {
              ...ticker.changes,
              h24: update.changes.h24,
            },
            markPrice: update.markPrice,
            openInterestValue: update.openInterestValue,
            fundingRate: update.fundingRate,
          };
        });
        // Also update cache
        tabCache.current.set(marketType, merged);
        return merged;
      });
      setFetchedAt(json.fetchedAt);
    } catch {
      // silently ignore
    }
  }, [marketType]);

  /* ---- Auto-refresh: full data every 60s + prices every 10s ---- */
  // Use refs for callbacks so the effect only re-runs on tab change
  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  const fetchPricesRef = useRef(fetchPrices);
  fetchPricesRef.current = fetchPrices;

  useEffect(() => {
    fetchDataRef.current();
    setCountdown(60);

    // Full refresh countdown (60s)
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchDataRef.current(true);
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    // Fast price refresh (10s)
    const priceInterval = setInterval(() => {
      fetchPricesRef.current();
    }, 10_000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      clearInterval(priceInterval);
    };
  }, [marketType]);

  /* ---- Sort ---- */
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortOrder((p) => (p === "desc" ? "asc" : "desc"));
      } else {
        setSortField(field);
        setSortOrder("desc");
      }
    },
    [sortField]
  );

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />;
    return sortOrder === "desc" ? (
      <ArrowDown className="ml-1 h-3 w-3 text-amber-400" />
    ) : (
      <ArrowUp className="ml-1 h-3 w-3 text-amber-400" />
    );
  };

  /* ---- Display data (search + sort) ---- */
  const displayData = useMemo(() => {
    let filtered = data;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((t) => t.symbol.toLowerCase().includes(q));
    }
    const mul = sortOrder === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const aV = getNestedValue(a, sortField) ?? -Infinity;
      const bV = getNestedValue(b, sortField) ?? -Infinity;
      return (aV - bV) * mul;
    });
  }, [data, searchQuery, sortField, sortOrder]);

  /* ---- Stats ---- */
  const stats = useMemo(() => {
    const gainers = data.filter((t) => t.changes.h24 > 0).length;
    const losers = data.filter((t) => t.changes.h24 < 0).length;
    return { gainers, losers, unchanged: data.length - gainers - losers };
  }, [data]);

  /* ---- Top by current sort ---- */
  const topBySort = useMemo(() => {
    if (data.length === 0) return null;
    const mul = sortOrder === "desc" ? -1 : 1;
    const sorted = [...data].sort((a, b) => {
      const aV = getNestedValue(a, sortField) ?? -Infinity;
      const bV = getNestedValue(b, sortField) ?? -Infinity;
      return (aV - bV) * mul;
    });
    return sorted[0];
  }, [data, sortField, sortOrder]);

  const sortLabel =
    sortField === "changes.h24"
      ? "24h"
      : sortField === "changes.h12"
      ? "12h"
      : sortField === "changes.h1"
      ? "1h"
      : sortField === "changes.m30"
      ? "30m"
      : sortField === "changes.m15"
      ? "15m"
      : sortField === "changes.m10"
      ? "10m"
      : sortField === "changes.m5"
      ? "5m"
      : sortField === "price"
      ? "Price"
      : sortField === "turnover24h"
      ? "Turnover"
      : "OI Value";

  /* ---------------------------------------------------------------- */
  /*  RENDER                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="min-h-screen flex flex-col">
      {/* ---- HEADER ---- */}
      <header className="border-b border-border/60 bg-card/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15 text-amber-400 shrink-0">
                <BarChart3 className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">
                  Bybit Price Movers
                </h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Multi-timeframe price changes across{" "}
                  {isPerp ? "perpetual" : "spot"} markets
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {/* View mode toggle */}
              <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5 border border-border/40">
                <button
                  onClick={() => setViewMode("live")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                    viewMode === "live"
                      ? "bg-amber-500/15 text-amber-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Live tracking"
                >
                  <LineChart className="h-3 w-3" />
                  <span className="hidden sm:inline">Live</span>
                </button>
                <button
                  onClick={() => setViewMode("backtest")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                    viewMode === "backtest"
                      ? "bg-amber-500/15 text-amber-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Backtest the bottom-detector on historical data"
                >
                  <FlaskConical className="h-3 w-3" />
                  <span className="hidden sm:inline">Backtest</span>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {fetchedAt && !error && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="hidden sm:inline">
                    Updated {timeAgo(fetchedAt)}
                  </span>
                  {!loading && data.length > 0 && (
                    <span className="hidden md:inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 tracking-wider">
                      LIVE
                    </span>
                  )}
                </div>
              )}
              <Badge
                variant="outline"
                className={`text-xs font-mono tabular-nums border-border/60 transition-colors ${
                  refreshing
                    ? "border-amber-500/40 text-amber-400"
                    : "text-muted-foreground"
                }`}
              >
                {refreshing ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Clock className="mr-1 h-3 w-3" />
                )}
                {countdown}s
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  tabCache.current.delete(marketType);
                  fetchData();
                }}
                disabled={loading || refreshing}
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    loading || refreshing ? "animate-spin" : ""
                  }`}
                />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* ---- BACKTEST MODE ---- */}
        {viewMode === "backtest" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-amber-400" />
                Bottom-Detector Backtest
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Replay historical candles through the same bottom-detector rule
                engine used in live mode. Tweak TP/SL to find configs that would
                have caught real bottoms.
              </p>
            </div>
            <BacktestPanel
              defaultSymbol={selectedSymbol || "BTCUSDT"}
              marketType={marketType}
            />
          </div>
        )}

        {/* ---- LIVE MODE ---- */}
        {viewMode === "live" && (
        <>
        <div className="flex flex-col xl:flex-row gap-4 sm:gap-6">
          {/* Main column: table + simulator */}
          <div className="flex-1 min-w-0 space-y-4 sm:space-y-6">
        {/* ---- MARKET TYPE TABS + SEARCH ---- */}
        <Tabs
          value={marketType}
          onValueChange={(v) => {
            setMarketType(v as MarketType);
            setSearchQuery("");
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <TabsList className="h-10">
              <TabsTrigger value="spot" className="px-4 text-sm">
                <Zap className="mr-1.5 h-3.5 w-3.5" />
                Spot
              </TabsTrigger>
              <TabsTrigger value="linear" className="px-4 text-sm">
                <Activity className="mr-1.5 h-3.5 w-3.5" />
                Perpetual
              </TabsTrigger>
            </TabsList>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search pair..."
                className="pl-9 h-9 text-sm bg-secondary/50 border-border/60"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {marketType === "spot" && <TabsContent value="spot" />}
          {marketType === "linear" && <TabsContent value="linear" />}

          {/* ---- STATS BAR ---- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-card/70 border-border/50">
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1">
                  Active Pairs
                </p>
                <p className="text-xl font-bold tabular-nums">{data.length}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  from {totalCount} total · min $300K turnover
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/70 border-border/50">
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1">
                  24h Gainers
                </p>
                <p className="text-xl font-bold tabular-nums text-[var(--gain)]">
                  {stats.gainers}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/70 border-border/50">
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1">
                  24h Losers
                </p>
                <p className="text-xl font-bold tabular-nums text-[var(--loss)]">
                  {stats.losers}
                </p>
              </CardContent>
            </Card>

            {topBySort && (
              <Card className="bg-card/70 border-border/50">
                <CardContent className="p-3 sm:p-4">
                  <p className="text-xs text-muted-foreground font-medium mb-1">
                    Top by {sortLabel}
                  </p>
                  <p className="text-sm font-semibold truncate">
                    {topBySort.symbol}
                  </p>
                  <p
                    className={`text-lg font-bold tabular-nums ${
                      sortField === "price" || sortField === "turnover24h" || sortField === "openInterestValue"
                        ? "text-foreground"
                        : pctColor(getNestedValue(topBySort, sortField))
                    }`}
                  >
                    {sortField === "price"
                      ? formatPrice(topBySort.price)
                      : sortField === "turnover24h"
                      ? formatVolume(topBySort.turnover24h)
                      : sortField === "openInterestValue"
                      ? formatVolume(topBySort.openInterestValue || 0)
                      : formatPct(getNestedValue(topBySort, sortField))}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ---- DATA TABLE ---- */}
          <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar max-h-[72vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="border-border/40 hover:bg-transparent">
                    <TableHead className="w-10 text-center text-xs">#</TableHead>
                    <TableHead className="text-xs min-w-[110px]">Symbol</TableHead>
                    <TableHead
                      className="text-right text-xs cursor-pointer select-none"
                      onClick={() => handleSort("price")}
                    >
                      <span className="inline-flex items-center">
                        Price <SortIcon field="price" />
                      </span>
                    </TableHead>
                    <TableHead className="text-xs hidden md:table-cell">
                      <span className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">
                        12h Trend
                      </span>
                    </TableHead>
                    {TF_COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`text-right text-xs cursor-pointer select-none ${responsiveClass(col.hideBelow)}`}
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="inline-flex items-center justify-end gap-0.5">
                          <span className="hidden sm:inline">{col.label}</span>
                          <span className="sm:hidden">{col.shortLabel}</span>
                          <SortIcon field={col.key} />
                        </span>
                      </TableHead>
                    ))}
                    <TableHead
                      className="text-right text-xs cursor-pointer select-none hidden lg:table-cell"
                      onClick={() => handleSort("turnover24h")}
                    >
                      <span className="inline-flex items-center">
                        Turnover <SortIcon field="turnover24h" />
                      </span>
                    </TableHead>
                    {isPerp && (
                      <TableHead
                        className="text-right text-xs cursor-pointer select-none hidden lg:table-cell"
                        onClick={() => handleSort("openInterestValue")}
                      >
                        <span className="inline-flex items-center">
                          OI Value <SortIcon field="openInterestValue" />
                        </span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {error && (
                    <TableRow>
                      <TableCell
                        colSpan={4 + TF_COLUMNS.length + (isPerp ? 1 : 0)}
                        className="h-40 text-center"
                      >
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <Activity className="h-8 w-8 opacity-40" />
                          <p className="font-medium text-foreground">
                            Failed to load market data
                          </p>
                          <p className="text-sm max-w-md">{error}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              tabCache.current.delete(marketType);
                              fetchData();
                            }}
                            className="mt-1"
                          >
                            <RefreshCw className="mr-2 h-3 w-3" />
                            Retry
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {!error && loading && (
                    <SkeletonRows colCount={TF_COLUMNS.length + 1} />
                  )}

                  {!error && !loading && displayData.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4 + TF_COLUMNS.length + (isPerp ? 1 : 0)}
                        className="h-40 text-center text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Search className="h-6 w-6 opacity-40" />
                          <p className="font-medium text-foreground">
                            {searchQuery
                              ? "No pairs match your search"
                              : "No data available"}
                          </p>
                          {searchQuery && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSearchQuery("")}
                            >
                              Clear search
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {!error &&
                    !loading &&
                    displayData.map((ticker, idx) => {
                      const [base, quote] = extractBase(ticker.symbol);
                      const hasBottomSignal = bottomActiveSymbols.has(ticker.symbol);
                      return (
                        <TableRow
                          key={ticker.symbol}
                          className={`border-border/30 group cursor-pointer hover:bg-muted/20 ${
                            hasBottomSignal ? "bg-amber-500/[0.04]" : ""
                          }`}
                          onClick={() => {
                            setSelectedSymbol(ticker.symbol);
                            setSelectedEvent(
                              bottomEvents.find((e) => e.symbol === ticker.symbol) ?? null
                            );
                          }}
                        >
                          <TableCell className="text-center text-xs text-muted-foreground font-mono tabular-nums">
                            {hasBottomSignal ? (
                              <span className="relative flex h-2 w-2 mx-auto" title="Active bottom signal">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                              </span>
                            ) : (
                              idx + 1
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-sm group-hover:text-amber-400 transition-colors">
                                {base}
                              </span>
                              {quote && (
                                <span className="text-xs text-muted-foreground">
                                  /{quote}
                                </span>
                              )}
                              {hasBottomSignal && (
                                <Badge
                                  variant="outline"
                                  className="text-[8px] px-1 py-0 ml-1 border-amber-500/40 text-amber-400"
                                >
                                  BOTTOM
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-sm">
                            {formatPrice(ticker.price)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Sparkline data={ticker.sparkline} />
                          </TableCell>
                          {TF_COLUMNS.map((col) => {
                            const val = getNestedValue(ticker, col.key);
                            return (
                              <TableCell
                                key={col.key}
                                className={`text-right font-mono tabular-nums text-xs font-medium ${pctColor(
                                  val
                                )} ${responsiveClass(col.hideBelow)}`}
                              >
                                <span className="inline-flex items-center justify-end gap-0.5">
                                  {val !== null && pctArrow(val)}
                                  {formatPct(val)}
                                </span>
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right hidden lg:table-cell">
                            <span className="font-mono tabular-nums text-xs text-muted-foreground">
                              {formatVolume(ticker.turnover24h)}
                            </span>
                          </TableCell>
                          {isPerp && (
                            <TableCell className="text-right hidden lg:table-cell">
                              <span className="font-mono tabular-nums text-xs text-muted-foreground">
                                {ticker.openInterestValue
                                  ? formatVolume(ticker.openInterestValue)
                                  : "—"}
                              </span>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>

            {/* Table footer */}
            {!error && !loading && displayData.length > 0 && (
              <div className="border-t border-border/40 px-4 py-2.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {displayData.length} of {data.length} pairs
                  {searchQuery && ` matching "${searchQuery}"`}
                  {refreshing && (
                    <span className="ml-2 inline-flex items-center gap-1 text-amber-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Updating…
                    </span>
                  )}
                </span>
                <span>
                  Sorted by {sortLabel} ({sortOrder})
                </span>
              </div>
            )}
          </div>
        </Tabs>

        {/* ---- FUNDING RATE CARDS (perpetual only) ---- */}
        {isPerp &&
          data.length > 0 &&
          data
            .filter(
              (t) => t.fundingRate !== undefined && t.fundingRate !== 0
            )
            .sort(
              (a, b) =>
                Math.abs(b.fundingRate || 0) -
                Math.abs(a.fundingRate || 0)
            )
            .slice(0, 3)
            .map((t) => (
              <Card key={t.symbol} className="bg-card/50 border-border/40">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{t.symbol}</span>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono tabular-nums ${
                        (t.fundingRate || 0) > 0
                          ? "border-[var(--gain)]/30 text-[var(--gain)]"
                          : "border-[var(--loss)]/30 text-[var(--loss)]"
                      }`}
                    >
                      Funding: {((t.fundingRate || 0) * 100).toFixed(4)}%
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>
                      Mark: {formatPrice(t.markPrice || 0)}
                    </span>
                    <span>
                      OI:{" "}
                      {t.openInterestValue
                        ? formatVolume(t.openInterestValue)
                        : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
        {/* ---- SIMULATED TRADING ---- */}
        <SimulatedTrading data={data} marketType={marketType} bottomEvents={bottomEvents} />
          </div>

          {/* Right sidebar: alerts feed */}
          <div className="xl:w-80 shrink-0">
            <BottomAlertsFeed
              events={bottomEvents}
              totalEmitted={bottomTotalEmitted}
              onClear={clearBottomEvents}
              soundEnabled={soundEnabled}
              toastEnabled={toastEnabled}
              onToggleSound={() => setSoundEnabled((p) => !p)}
              onToggleToast={() => setToastEnabled((p) => !p)}
              onSelectEvent={(e) => {
                setSelectedSymbol(e.symbol);
                setSelectedEvent(e);
              }}
              onSelectSymbol={(s) => {
                setSelectedSymbol(s);
                setSearchQuery(s);
              }}
            />
          </div>
        </div>

        {/* Mini-chart popover */}
        {selectedSymbol && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => {
              setSelectedSymbol(null);
              setSelectedEvent(null);
            }}
          >
            <div onClick={(e) => e.stopPropagation()} className="max-w-full">
              <BottomMiniChart
                symbol={selectedSymbol}
                registry={bottomRegistry}
                triggerEvent={selectedEvent}
                onClose={() => {
                  setSelectedSymbol(null);
                  setSelectedEvent(null);
                }}
              />
            </div>
          </div>
        )}
        </>
        )}
      </main>

      {/* ---- FOOTER ---- */}
      <footer className="border-t border-border/40 mt-auto">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Market data from{" "}
            <span className="text-foreground font-medium">Bybit</span> ·
            Prices live (10s) · Timeframes &amp; sparklines (60s) ·
            Bottom-detector (adaptive 1m/15s)
          </span>
          <span className="font-mono tabular-nums">
            {fetchedAt
              ? `Last fetch: ${new Date(fetchedAt).toLocaleTimeString()}`
              : ""}
          </span>
        </div>
      </footer>
    </div>
  );
}