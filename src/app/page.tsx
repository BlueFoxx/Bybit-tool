"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  hideBelow?: number; // min breakpoint in px
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
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("changes.h24");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [data, setData] = useState<MarketTicker[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [fetchedAt, setFetchedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPerp = marketType === "linear";

  /* ---- Fetch ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ type: marketType });
      const res = await fetch(`/api/market-changes?${params}`);
      const json: ApiResponse = await res.json();

      if (!res.ok || json.error) {
        throw new Error(json.details || json.error || "API request failed");
      }

      setData(json.data);
      setTotalCount(json.totalAll);
      setFetchedAt(json.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [marketType]);

  /* ---- Auto-refresh (60s to allow time for kline fetches) ---- */
  useEffect(() => {
    fetchData();
    setCountdown(60);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchData();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchData]);

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
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-4">
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

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
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
                    className={`text-lg font-bold tabular-nums ${pctColor(
                      getNestedValue(topBySort, sortField)
                    )}`}
                  >
                    {formatPct(getNestedValue(topBySort, sortField))}
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
                    <TableHead className="text-xs min-w-[120px]">Symbol</TableHead>
                    <TableHead
                      className="text-right text-xs cursor-pointer select-none"
                      onClick={() => handleSort("price")}
                    >
                      <span className="inline-flex items-center">
                        Price <SortIcon field="price" />
                      </span>
                    </TableHead>
                    {TF_COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`text-right text-xs cursor-pointer select-none ${
                          col.hideBelow ? `hidden xl:block` : ""
                        }`}
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
                        colSpan={3 + TF_COLUMNS.length + (isPerp ? 1 : 0)}
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

                  {!error && loading && (
                    <SkeletonRows colCount={TF_COLUMNS.length + 1} />
                  )}

                  {!error && !loading && displayData.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3 + TF_COLUMNS.length + (isPerp ? 1 : 0)}
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
                      return (
                        <TableRow
                          key={ticker.symbol}
                          className="border-border/30 group"
                        >
                          <TableCell className="text-center text-xs text-muted-foreground font-mono tabular-nums">
                            {idx + 1}
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
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-sm">
                            {formatPrice(ticker.price)}
                          </TableCell>
                          {TF_COLUMNS.map((col) => {
                            const val = getNestedValue(ticker, col.key);
                            return (
                              <TableCell
                                key={col.key}
                                className={`text-right font-mono tabular-nums text-xs font-medium ${pctColor(
                                  val
                                )} ${col.hideBelow ? "hidden xl:table-cell" : ""}`}
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
      </main>

      {/* ---- FOOTER ---- */}
      <footer className="border-t border-border/40 mt-auto">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Market data from{" "}
            <span className="text-foreground font-medium">Bybit</span> ·
            Multi-timeframe via kline API · Auto-refreshes every 60s
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