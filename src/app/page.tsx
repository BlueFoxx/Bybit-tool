"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  Zap,
  BarChart3,
  Clock,
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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MarketTicker {
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

interface ApiResponse {
  type: string;
  count: number;
  totalFiltered: number;
  totalAll: number;
  stats: { gainers: number; losers: number; unchanged: number };
  sort: { field: string; order: string };
  data: MarketTicker[];
  fetchedAt: string;
  error?: string;
  details?: string;
}

type MarketType = "spot" | "linear";
type ViewFilter = "all" | "gainers" | "losers";
type SortField = "changePercent" | "volume24h" | "turnover24h" | "price" | "openInterestValue";
type SortOrder = "asc" | "desc";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPrice(n: number, symbol: string): string {
  if (n === 0) return "—";
  // Very small prices (meme coins) need more decimals
  if (n < 0.001) return "$" + n.toPrecision(4);
  if (n < 0.01) return "$" + n.toPrecision(4);
  if (n < 1) return "$" + n.toFixed(4);
  if (n < 100) return "$" + n.toFixed(3);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVolume(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function formatNumber(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatPercent(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return sign + pct.toFixed(2) + "%";
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function extractBase(symbol: string): string {
  // BTCUSDT -> BTC, 1000PEPEUSDT -> 1000PEPE
  const usdMatch = symbol.match(/^(.+?)(USDT|USDC|USDP|DAI|TUSD|BUSD)$/);
  if (usdMatch) return usdMatch[1];
  return symbol;
}

/* ------------------------------------------------------------------ */
/*  Skeleton Row                                                       */
/* ------------------------------------------------------------------ */

function SkeletonRows({ count = 10 }: { count?: number }) {
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
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-5 w-16" />
          </TableCell>
          <TableCell className="text-right hidden sm:table-cell">
            <Skeleton className="ml-auto h-4 w-20" />
          </TableCell>
          <TableCell className="text-right hidden md:table-cell">
            <Skeleton className="ml-auto h-4 w-24" />
          </TableCell>
          <TableCell className="text-right hidden lg:table-cell">
            <Skeleton className="ml-auto h-4 w-20" />
          </TableCell>
          <TableCell className="text-right hidden lg:table-cell">
            <Skeleton className="ml-auto h-4 w-20" />
          </TableCell>
          {typeof window !== "undefined" && window.innerWidth >= 1024 && (
            <TableCell className="text-right hidden xl:table-cell">
              <Skeleton className="ml-auto h-4 w-16" />
            </TableCell>
          )}
        </TableRow>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function Home() {
  /* ---- State ---- */
  const [marketType, setMarketType] = useState<MarketType>("spot");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("changePercent");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [data, setData] = useState<MarketTicker[]>([]);
  const [stats, setStats] = useState({ gainers: 0, losers: 0, unchanged: 0, total: 0 });
  const [fetchedAt, setFetchedAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPerp = marketType === "linear";

  /* ---- Fetch ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch a large dataset — sorting/filtering is done client-side
      const params = new URLSearchParams({
        type: marketType,
        sort: "changePercent",
        order: "desc",
        limit: "500",
        minVolume: "10000",
      });
      const res = await fetch(`/api/market-changes?${params}`);
      const json: ApiResponse = await res.json();

      if (!res.ok || json.error) {
        throw new Error(json.details || json.error || "API request failed");
      }

      // Also fetch losers (ascending) to have a complete dataset
      const paramsAsc = new URLSearchParams({
        type: marketType,
        sort: "changePercent",
        order: "asc",
        limit: "500",
        minVolume: "10000",
      });
      const resAsc = await fetch(`/api/market-changes?${paramsAsc}`);
      const jsonAsc: ApiResponse = await resAsc.json();

      // Merge both sets, deduplicate by symbol
      const allData = new Map<string, MarketTicker>();
      for (const t of json.data) allData.set(t.symbol, t);
      for (const t of jsonAsc.data) {
        if (!allData.has(t.symbol)) allData.set(t.symbol, t);
      }
      const mergedData = Array.from(allData.values());

      setData(mergedData);
      setStats({
        gainers: mergedData.filter((t) => t.changePercent > 0).length,
        losers: mergedData.filter((t) => t.changePercent < 0).length,
        unchanged: mergedData.filter((t) => t.changePercent === 0).length,
        total: json.totalAll,
      });
      setFetchedAt(json.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [marketType]);

  /* ---- Auto-refresh timer ---- */
  useEffect(() => {
    fetchData();
    setCountdown(30);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchData();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchData]);

  /* ---- Handle sort click ---- */
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
      } else {
        setSortField(field);
        setSortOrder("desc");
      }
    },
    [sortField]
  );

  /* ---- Sort icon ---- */
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sortOrder === "desc" ? (
      <ArrowDown className="ml-1 h-3 w-3 text-amber-400" />
    ) : (
      <ArrowUp className="ml-1 h-3 w-3 text-amber-400" />
    );
  };

  /* ---- Filtered & sorted data ---- */
  const displayData = useMemo(() => {
    let filtered = data;

    // Apply view filter
    if (viewFilter === "gainers") {
      filtered = filtered.filter((t) => t.changePercent > 0);
    } else if (viewFilter === "losers") {
      filtered = filtered.filter((t) => t.changePercent < 0);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((t) => t.symbol.toLowerCase().includes(q));
    }

    // Sort client-side
    const orderMul = sortOrder === "desc" ? -1 : 1;
    filtered = [...filtered].sort((a, b) => {
    const aVal = (a as unknown as Record<string, number>)[sortField] ?? 0;
    const bVal = (b as unknown as Record<string, number>)[sortField] ?? 0;
      return (aVal - bVal) * orderMul;
    });

    return filtered;
  }, [data, searchQuery, viewFilter, sortField, sortOrder]);

  /* ---- Gainers / Losers top 3 for stat cards ---- */
  const topGainer = useMemo(() => {
    return [...data].sort((a, b) => b.changePercent - a.changePercent)[0];
  }, [data]);
  const topLoser = useMemo(() => {
    return [...data].sort((a, b) => a.changePercent - b.changePercent)[0];
  }, [data]);
  const highestVolume = useMemo(() => {
    return [...data].sort((a, b) => b.turnover24h - a.turnover24h)[0];
  }, [data]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ---- HEADER ---- */}
      <header className="border-b border-border/60 bg-card/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
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
                  Top gainers &amp; losers across {isPerp ? "perpetual" : "spot"} markets
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {fetchedAt && !error && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="hidden sm:inline">Updated {timeAgo(fetchedAt)}</span>
                </div>
              )}
              <Badge
                variant="outline"
                className="text-xs font-mono tabular-nums text-muted-foreground border-border/60"
              >
                <Clock className="mr-1 h-3 w-3" />
                {countdown}s
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={fetchData}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* ---- MARKET TYPE TABS ---- */}
        <Tabs
          value={marketType}
          onValueChange={(v) => {
            setMarketType(v as MarketType);
            setViewFilter("all");
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

            {/* Search */}
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

          {/* ---- STATS BAR ---- */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
            <Card className="bg-card/70 border-border/50">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                    <Activity className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Total Pairs</span>
                </div>
                <p className="text-xl font-bold tabular-nums">{stats.total}</p>
              </CardContent>
            </Card>

            <Card className="bg-card/70 border-border/50">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-md bg-gain-muted flex items-center justify-center">
                    <TrendingUp className="h-3 w-3 text-[var(--gain)]" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Gainers</span>
                </div>
                <p className="text-xl font-bold tabular-nums text-[var(--gain)]">{stats.gainers}</p>
              </CardContent>
            </Card>

            <Card className="bg-card/70 border-border/50">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-md bg-loss-muted flex items-center justify-center">
                    <TrendingDown className="h-3 w-3 text-[var(--loss)]" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Losers</span>
                </div>
                <p className="text-xl font-bold tabular-nums text-[var(--loss)]">{stats.losers}</p>
              </CardContent>
            </Card>

            {topGainer && (
              <Card className="bg-card/70 border-border/50 hidden lg:block">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-md bg-gain-muted flex items-center justify-center">
                      <TrendingUp className="h-3 w-3 text-[var(--gain)]" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Top Gainer</span>
                  </div>
                  <p className="text-sm font-semibold truncate">{topGainer.symbol}</p>
                  <p className="text-lg font-bold tabular-nums text-[var(--gain)]">
                    {formatPercent(topGainer.changePercent)}
                  </p>
                </CardContent>
              </Card>
            )}

            {topLoser && (
              <Card className="bg-card/70 border-border/50 hidden lg:block">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-md bg-loss-muted flex items-center justify-center">
                      <TrendingDown className="h-3 w-3 text-[var(--loss)]" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Top Loser</span>
                  </div>
                  <p className="text-sm font-semibold truncate">{topLoser.symbol}</p>
                  <p className="text-lg font-bold tabular-nums text-[var(--loss)]">
                    {formatPercent(topLoser.changePercent)}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ---- VIEW FILTER TABS ---- */}
          {marketType === "spot" && <TabsContent value="spot" />}
          {marketType === "linear" && <TabsContent value="linear" />}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {(["all", "gainers", "losers"] as ViewFilter[]).map((vf) => (
                <button
                  key={vf}
                  onClick={() => setViewFilter(vf)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    viewFilter === vf
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {vf === "all"
                    ? `All (${displayData.length})`
                    : vf === "gainers"
                    ? `Gainers (${data.filter((t) => t.changePercent > 0).length})`
                    : `Losers (${data.filter((t) => t.changePercent < 0).length})`}
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Min. $10K turnover · Sorted by{" "}
              {sortField === "changePercent"
                ? "24h Change"
                : sortField === "volume24h"
                ? "Volume"
                : sortField === "turnover24h"
                ? "Turnover"
                : sortField === "price"
                ? "Price"
                : "Open Interest"}
            </p>
          </div>

          {/* ---- DATA TABLE ---- */}
          <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar max-h-[70vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="border-border/40 hover:bg-transparent">
                    <TableHead className="w-10 text-center text-xs">#</TableHead>
                    <TableHead className="text-xs">Symbol</TableHead>
                    <TableHead
                      className="text-right text-xs cursor-pointer select-none"
                      onClick={() => handleSort("price")}
                    >
                      <span className="inline-flex items-center">
                        Price <SortIcon field="price" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-right text-xs cursor-pointer select-none"
                      onClick={() => handleSort("changePercent")}
                    >
                      <span className="inline-flex items-center">
                        24h Change <SortIcon field="changePercent" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-right text-xs hidden sm:table-cell cursor-pointer select-none"
                      onClick={() => handleSort("volume24h")}
                    >
                      <span className="inline-flex items-center">
                        Volume <SortIcon field="volume24h" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-right text-xs hidden md:table-cell cursor-pointer select-none"
                      onClick={() => handleSort("turnover24h")}
                    >
                      <span className="inline-flex items-center">
                        Turnover <SortIcon field="turnover24h" />
                      </span>
                    </TableHead>
                    <TableHead className="text-right text-xs hidden lg:table-cell">24h High</TableHead>
                    <TableHead className="text-right text-xs hidden lg:table-cell">24h Low</TableHead>
                    {isPerp && (
                      <TableHead
                        className="text-right text-xs hidden xl:table-cell cursor-pointer select-none"
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
                        colSpan={isPerp ? 9 : 8}
                        className="h-40 text-center"
                      >
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <Activity className="h-8 w-8 opacity-40" />
                          <div>
                            <p className="font-medium text-foreground">Failed to load market data</p>
                            <p className="text-sm mt-1 max-w-md">{error}</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchData}
                            className="mt-1"
                          >
                            <RefreshCw className="mr-2 h-3 w-3" />
                            Retry
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {!error && loading && <SkeletonRows count={15} />}

                  {!error && !loading && displayData.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={isPerp ? 9 : 8}
                        className="h-40 text-center text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Search className="h-6 w-6 opacity-40" />
                          <p className="font-medium text-foreground">
                            {searchQuery
                              ? "No pairs match your search"
                              : viewFilter === "gainers"
                              ? "No gainers right now"
                              : viewFilter === "losers"
                              ? "No losers right now"
                              : "No data available"}
                          </p>
                          {searchQuery && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSearchQuery("")}
                              className="text-xs"
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
                      const isPositive = ticker.changePercent > 0;
                      const isNegative = ticker.changePercent < 0;
                      const changeColor = isPositive
                        ? "text-[var(--gain)]"
                        : isNegative
                        ? "text-[var(--loss)]"
                        : "text-muted-foreground";
                      const changeBg = isPositive
                        ? "bg-gain-muted"
                        : isNegative
                        ? "bg-loss-muted"
                        : "bg-muted";

                      return (
                        <TableRow
                          key={ticker.symbol}
                          className="border-border/30 group"
                        >
                          <TableCell className="text-center text-xs text-muted-foreground font-mono tabular-nums">
                            {idx + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm group-hover:text-amber-400 transition-colors">
                                {extractBase(ticker.symbol)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                /{ticker.symbol.replace(extractBase(ticker.symbol), "")}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-sm">
                            {formatPrice(ticker.price, ticker.symbol)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={`inline-flex items-center gap-0.5 font-mono tabular-nums text-sm font-semibold ${changeColor}`}
                            >
                              {isPositive ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : isNegative ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : null}
                              {formatPercent(ticker.changePercent)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right hidden sm:table-cell">
                            <span className="font-mono tabular-nums text-sm text-muted-foreground">
                              {formatNumber(ticker.volume24h)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right hidden md:table-cell">
                            <span className="font-mono tabular-nums text-sm">
                              {formatVolume(ticker.turnover24h)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <span className="font-mono tabular-nums text-xs text-muted-foreground">
                              {formatPrice(ticker.high24h, ticker.symbol)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <span className="font-mono tabular-nums text-xs text-muted-foreground">
                              {formatPrice(ticker.low24h, ticker.symbol)}
                            </span>
                          </TableCell>
                          {isPerp && (
                            <TableCell className="text-right hidden xl:table-cell">
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
                  Showing {displayData.length} of {data.length} filtered pairs
                  {searchQuery && ` matching "${searchQuery}"`}
                </span>
                <div className="flex items-center gap-2">
                  {highestVolume && (
                    <span className="hidden sm:inline">
                      Highest volume:{" "}
                      <span className="text-foreground font-medium">{highestVolume.symbol}</span>{" "}
                      ({formatVolume(highestVolume.turnover24h)})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </Tabs>

        {/* Perpetual-specific info cards */}
        {isPerp && data.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data
              .filter((t) => t.fundingRate !== undefined && t.fundingRate !== 0)
              .sort((a, b) => Math.abs(b.fundingRate || 0) - Math.abs(a.fundingRate || 0))
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
                      <span>Mark: {formatPrice(t.markPrice || 0, t.symbol)}</span>
                      <span>OI: {t.openInterestValue ? formatVolume(t.openInterestValue) : "—"}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </main>

      {/* ---- FOOTER ---- */}
      <footer className="border-t border-border/40 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Market data from{" "}
            <span className="text-foreground font-medium">Bybit</span> via public API · Auto-refreshes every 30s
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
