"use client";

import { useState } from "react";
import {
  Play,
  Loader2,
  TrendingUp,
  TrendingDown,
  Activity,
  Clock,
  Target,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BacktestStats, BacktestTrade } from "@/lib/backtest-engine";

interface BacktestPanelProps {
  /** Currently selected symbol from the main table, if any */
  defaultSymbol?: string;
  marketType: string;
}

interface BacktestResponse {
  trades: BacktestTrade[];
  stats: BacktestStats;
  klineCount: number;
  rangeStart: number;
  rangeEnd: number;
  fetchedAt: string;
  error?: string;
}

type RangePreset = "1d" | "3d" | "7d" | "14d" | "30d";

const RANGE_MS: Record<RangePreset, number> = {
  "1d": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "14d": 14 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};

function fmtPrice(n: number): string {
  if (n === 0) return "—";
  if (n < 0.01) return "$" + n.toPrecision(4);
  if (n < 1) return "$" + n.toFixed(4);
  if (n < 100) return "$" + n.toFixed(3);
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(n: number, showSign = true): string {
  const sign = showSign && n > 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
}

function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return sign + "$" + (n / 1000).toFixed(2) + "K";
  return sign + "$" + n.toFixed(2);
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return (ms / 1000).toFixed(0) + "s";
  if (ms < 3_600_000) return (ms / 60_000).toFixed(1) + "m";
  return (ms / 3_600_000).toFixed(1) + "h";
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function BacktestPanel({
  defaultSymbol = "BTCUSDT",
  marketType,
}: BacktestPanelProps) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [interval, setInterval_] = useState<"1" | "5" | "15" | "60">("1");
  const [tpPct, setTpPct] = useState(3);
  const [slPct, setSlPct] = useState(2);
  const [orderSize, setOrderSize] = useState(1000);
  const [maxPositions, setMaxPositions] = useState(5);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const now = Date.now();
      const start = now - RANGE_MS[preset];
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: marketType,
          symbol: symbol.toUpperCase().trim(),
          interval,
          start,
          end: now,
          config: {
            takeProfitPct: tpPct,
            stopLossPct: slPct,
            orderSize,
            maxPositions,
            cooldownMs: 10 * 60_000,
            maxHoldMs: 24 * 60 * 60_000,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || json.details || "Backtest failed");
        setResult(null);
      } else {
        setResult(json as BacktestResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const stats = result?.stats;
  const trades = result?.trades ?? [];

  return (
    <div className="space-y-4">
      {/* Configuration */}
      <Card className="bg-card/70 border-border/50">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Symbol
              </label>
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="BTCUSDT"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Range
              </label>
              <Tabs value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
                <TabsList className="h-8 grid grid-cols-5">
                  <TabsTrigger value="1d" className="text-[10px]">1d</TabsTrigger>
                  <TabsTrigger value="3d" className="text-[10px]">3d</TabsTrigger>
                  <TabsTrigger value="7d" className="text-[10px]">7d</TabsTrigger>
                  <TabsTrigger value="14d" className="text-[10px]">14d</TabsTrigger>
                  <TabsTrigger value="30d" className="text-[10px]">30d</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Interval
              </label>
              <Tabs value={interval} onValueChange={(v) => setInterval_(v as "1" | "5" | "15" | "60")}>
                <TabsList className="h-8 grid grid-cols-4">
                  <TabsTrigger value="1" className="text-[10px]">1m</TabsTrigger>
                  <TabsTrigger value="5" className="text-[10px]">5m</TabsTrigger>
                  <TabsTrigger value="15" className="text-[10px]">15m</TabsTrigger>
                  <TabsTrigger value="60" className="text-[10px]">1h</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Max Positions
              </label>
              <Input
                type="number"
                value={maxPositions}
                onChange={(e) => setMaxPositions(parseInt(e.target.value) || 1)}
                min={1}
                max={20}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                TP %
              </label>
              <Input
                type="number"
                value={tpPct}
                onChange={(e) => setTpPct(parseFloat(e.target.value) || 0)}
                step="0.5"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                SL %
              </label>
              <Input
                type="number"
                value={slPct}
                onChange={(e) => setSlPct(parseFloat(e.target.value) || 0)}
                step="0.5"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Order Size $
              </label>
              <Input
                type="number"
                value={orderSize}
                onChange={(e) => setOrderSize(parseFloat(e.target.value) || 0)}
                step="100"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={runBacktest}
                disabled={loading}
                className="w-full h-8"
                size="sm"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                Run Backtest
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="bg-red-500/5 border-red-500/30">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
          </CardContent>
        </Card>
      )}

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/70 border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Target className="h-3 w-3 text-amber-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Win Rate</span>
              </div>
              <p className={`text-xl font-bold tabular-nums ${
                stats.winRate >= 50 ? "text-[var(--gain)]" : "text-[var(--loss)]"
              }`}>
                {stats.winRate.toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                {stats.wins}W / {stats.losses}L of {stats.totalTrades}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card/70 border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                {stats.totalPnlUsd >= 0 ? (
                  <TrendingUp className="h-3 w-3 text-[var(--gain)]" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-[var(--loss)]" />
                )}
                <span className="text-[10px] text-muted-foreground uppercase">Total P&L</span>
              </div>
              <p className={`text-xl font-bold tabular-nums ${
                stats.totalPnlUsd >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"
              }`}>
                {fmtUsd(stats.totalPnlUsd)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                Avg {fmtPct(stats.avgPnlPct)} / trade
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card/70 border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="h-3 w-3 text-amber-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Signals</span>
              </div>
              <p className="text-xl font-bold tabular-nums">
                {stats.detectedEvents.length}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                {stats.skippedSignals} skipped · {stats.totalTrades} traded
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card/70 border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="h-3 w-3 text-amber-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Max DD</span>
              </div>
              <p className="text-xl font-bold tabular-nums text-[var(--loss)]">
                {fmtUsd(-stats.maxDrawdownUsd)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                Avg hold {fmtDuration(stats.avgHoldMs)} · max consec loss {stats.maxConsecutiveLosses}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Equity curve */}
      {stats && stats.equityCurve.length > 0 && (
        <Card className="bg-card/70 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Equity Curve</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {stats.equityCurve.length} trades · {result?.klineCount} candles analyzed
              </span>
            </div>
            <EquityCurve points={stats.equityCurve} />
          </CardContent>
        </Card>
      )}

      {/* Trades table */}
      {trades.length > 0 && (
        <Card className="bg-card/70 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                Trades ({trades.length})
              </span>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto custom-scrollbar">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border/40 text-[10px] text-muted-foreground uppercase">
                    <th className="text-left py-1.5 px-2">Entry</th>
                    <th className="text-right py-1.5 px-2">Entry $</th>
                    <th className="text-left py-1.5 px-2">Exit</th>
                    <th className="text-right py-1.5 px-2">Exit $</th>
                    <th className="text-right py-1.5 px-2">P&L</th>
                    <th className="text-right py-1.5 px-2">%</th>
                    <th className="text-center py-1.5 px-2">Hold</th>
                    <th className="text-center py-1.5 px-2">Sev</th>
                    <th className="text-center py-1.5 px-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="py-1.5 px-2 text-muted-foreground tabular-nums">
                        {fmtTime(t.entryTime)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {fmtPrice(t.entryPrice)}
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground tabular-nums">
                        {fmtTime(t.exitTime)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {fmtPrice(t.exitPrice)}
                      </td>
                      <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${
                        t.pnlUsd >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"
                      }`}>
                        {fmtUsd(t.pnlUsd)}
                      </td>
                      <td className={`py-1.5 px-2 text-right tabular-nums ${
                        t.pnlPct >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"
                      }`}>
                        {fmtPct(t.pnlPct)}
                      </td>
                      <td className="py-1.5 px-2 text-center text-muted-foreground tabular-nums">
                        {fmtDuration(t.exitTime - t.entryTime)}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0 tabular-nums"
                        >
                          {t.triggerSeverity}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 ${
                            t.reason === "take_profit"
                              ? "border-[var(--gain)]/30 text-[var(--gain)]"
                              : t.reason === "stop_loss"
                              ? "border-[var(--loss)]/30 text-[var(--loss)]"
                              : "text-muted-foreground"
                          }`}
                        >
                          {t.reason === "take_profit"
                            ? "TP"
                            : t.reason === "stop_loss"
                            ? "SL"
                            : t.reason === "timeout"
                            ? "T/O"
                            : "EOD"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!stats && !loading && !error && (
        <Card className="bg-card/40 border-dashed border-border/40">
          <CardContent className="p-8 text-center text-muted-foreground/60">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">
              Configure parameters above and click <b>Run Backtest</b> to replay
              historical candles through the bottom-detector.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Equity curve sparkline — wide format with zero baseline.
 */
function EquityCurve({ points }: { points: { t: number; equity: number }[] }) {
  if (points.length < 2) return null;
  const W = 1000;
  const H = 80;
  const values = points.map((p) => p.equity);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const range = maxV - minV || 1;
  const xStep = W / (points.length - 1);
  const y = (v: number) => H - ((v - minV) / range) * H;

  const linePath = points
    .map((p, i) => `${i * xStep},${y(p.equity)}`)
    .join(" ");
  const areaPath = `M0,${y(0)} ` +
    points.map((p, i) => `L${i * xStep},${y(p.equity)}`).join(" ") +
    ` L${W},${y(0)} Z`;

  const isProfit = values[values.length - 1] >= 0;
  const color = isProfit ? "var(--gain)" : "var(--loss)";

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block"
    >
      {/* Zero line */}
      <line
        x1={0}
        x2={W}
        y1={y(0)}
        y2={y(0)}
        stroke="currentColor"
        className="text-muted-foreground/30"
        strokeDasharray="3,3"
        strokeWidth={1}
      />
      <path d={areaPath} fill={color} opacity={0.12} />
      <polyline
        points={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={0.9}
      />
    </svg>
  );
}
