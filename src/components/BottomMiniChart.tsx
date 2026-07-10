"use client";

import { useEffect, useMemo, useState } from "react";
import { X, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  emaSeries,
  rsiSeries,
} from "@/lib/indicators";
import type { BottomEvent, RollingBufferRegistry } from "@/lib/rolling-buffer";

interface BottomMiniChartProps {
  symbol: string;
  registry: RollingBufferRegistry;
  /** Event that triggered this popover, if any */
  triggerEvent?: BottomEvent | null;
  onClose: () => void;
}

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

const CHART_W = 480;
const CHART_H = 180;
const RSI_H = 60;
const PAD = 4;

export default function BottomMiniChart({
  symbol,
  registry,
  triggerEvent,
  onClose,
}: BottomMiniChartProps) {
  const [, forceRender] = useState(0);
  const samples = useMemo(
    () => registry.lastSamples(symbol, 120),
    // Re-pull every 5 seconds while open
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, registry, triggerEvent]
  );

  // Re-render every 5s to refresh the chart
  useEffect(() => {
    const id = setInterval(() => forceRender((v) => v + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const base = symbol.replace("USDT", "");

  // Pull latest samples (re-pulled on each render via the memo above
  // and on the 5s interval)
  const liveSamples = registry.lastSamples(symbol, 120);

  if (liveSamples.length < 2) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/95 backdrop-blur-sm p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <span className="font-semibold text-sm">{base}</span>
            <span className="text-[10px] text-muted-foreground">/USDT</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="text-center py-12 text-muted-foreground/60 text-xs">
          Collecting samples… {liveSamples.length}/120
        </div>
      </div>
    );
  }

  const closes = liveSamples.map((s) => s.close);
  const ema9Series = emaSeries(closes, 9);
  const ema21Series = emaSeries(closes, 21);
  const rsi14Series = rsiSeries(closes, 14);

  // Y scale for price chart
  const allPrices = closes.filter((_, i) => ema9Series[i] !== null);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const pPad = (maxP - minP) * 0.1 || 1;
  const yMin = minP - pPad;
  const yMax = maxP + pPad;
  const yRange = yMax - yMin;

  const xStep = (CHART_W - PAD * 2) / (liveSamples.length - 1);
  const x = (i: number) => PAD + i * xStep;
  const y = (v: number) => PAD + (1 - (v - yMin) / yRange) * (CHART_H - PAD * 2);

  // RSI scale (0-100)
  const rsiY = (v: number) => PAD + (1 - v / 100) * (RSI_H - PAD * 2);

  // Build polyline strings
  const closePath = closes
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const ema9Path = ema9Series
    .map((v, i) => (v !== null ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null))
    .filter(Boolean)
    .join(" ");
  const ema21Path = ema21Series
    .map((v, i) => (v !== null ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null))
    .filter(Boolean)
    .join(" ");

  const currentPrice = closes[closes.length - 1];
  const currentEma9 = ema9Series[ema9Series.length - 1];
  const currentEma21 = ema21Series[ema21Series.length - 1];
  const currentRsi = rsi14Series[rsi14Series.length - 1];

  // Event marker position (if triggerEvent falls within the chart window)
  const eventIdx = triggerEvent
    ? liveSamples.findIndex((s) => s.t >= triggerEvent.timestamp)
    : -1;

  return (
    <div className="rounded-lg border border-border/60 bg-card/95 backdrop-blur-sm p-3 shadow-xl w-[520px] max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-amber-400" />
          <span className="font-semibold text-sm">{base}</span>
          <span className="text-[10px] text-muted-foreground">/USDT</span>
          {triggerEvent && (
            <Badge
              variant="outline"
              className="text-[9px] px-1.5 py-0 border-amber-500/40 text-amber-400"
            >
              Severity {triggerEvent.severity}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Price chart */}
      <div className="relative">
        <svg
          width="100%"
          height={CHART_H}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="block"
        >
          {/* Grid line at EMA21 level */}
          {currentEma21 !== null && (
            <line
              x1={PAD}
              x2={CHART_W - PAD}
              y1={y(currentEma21)}
              y2={y(currentEma21)}
              stroke="currentColor"
              className="text-muted-foreground/15"
              strokeDasharray="2,4"
              strokeWidth={1}
            />
          )}

          {/* Close price line */}
          <polyline
            points={closePath}
            fill="none"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            opacity={0.9}
          />

          {/* EMA9 line (amber) */}
          {ema9Path && (
            <polyline
              points={ema9Path}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1.2}
              opacity={0.85}
            />
          )}

          {/* EMA21 line (blue) */}
          {ema21Path && (
            <polyline
              points={ema21Path}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={1.2}
              opacity={0.7}
            />
          )}

          {/* Event marker */}
          {eventIdx >= 0 && (
            <g>
              <line
                x1={x(eventIdx)}
                x2={x(eventIdx)}
                y1={PAD}
                y2={CHART_H - PAD}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="3,3"
                opacity={0.6}
              />
              <circle
                cx={x(eventIdx)}
                cy={y(currentPrice)}
                r={4}
                fill="#ef4444"
                opacity={0.9}
              />
              <circle
                cx={x(eventIdx)}
                cy={y(currentPrice)}
                r={8}
                fill="#ef4444"
                opacity={0.2}
              />
            </g>
          )}

          {/* Latest price dot */}
          <circle
            cx={x(liveSamples.length - 1)}
            cy={y(currentPrice)}
            r={2.5}
            fill="var(--foreground)"
          />
        </svg>

        {/* Price legend overlay */}
        <div className="absolute top-1 left-2 flex flex-col gap-0.5 text-[9px] tabular-nums pointer-events-none">
          <div className="flex items-center gap-1">
            <span className="w-2 h-0.5 bg-foreground" />
            <span className="text-foreground font-medium">
              {fmtPrice(currentPrice)}
            </span>
          </div>
          {currentEma9 !== null && (
            <div className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-amber-500" />
              <span className="text-amber-400">EMA9 {fmtPrice(currentEma9)}</span>
            </div>
          )}
          {currentEma21 !== null && (
            <div className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-blue-500" />
              <span className="text-blue-400">EMA21 {fmtPrice(currentEma21)}</span>
            </div>
          )}
        </div>
      </div>

      {/* RSI subchart */}
      <div className="mt-2 border-t border-border/30 pt-1.5">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
            RSI(14)
          </span>
          <span
            className={`text-[10px] tabular-nums font-medium ${
              currentRsi !== null && currentRsi < 30
                ? "text-[var(--loss)]"
                : currentRsi !== null && currentRsi > 70
                ? "text-[var(--gain)]"
                : "text-foreground"
            }`}
          >
            {currentRsi !== null ? currentRsi.toFixed(1) : "—"}
          </span>
        </div>
        <svg
          width="100%"
          height={RSI_H}
          viewBox={`0 0 ${CHART_W} ${RSI_H}`}
          preserveAspectRatio="none"
          className="block"
        >
          {/* Overbought / oversold zones */}
          <rect
            x={0}
            y={rsiY(70)}
            width={CHART_W}
            height={rsiY(30) - rsiY(70)}
            fill="currentColor"
            className="text-muted-foreground/5"
          />
          {/* 30 / 70 lines */}
          <line
            x1={0}
            x2={CHART_W}
            y1={rsiY(30)}
            y2={rsiY(30)}
            stroke="#ef4444"
            strokeWidth={0.5}
            strokeDasharray="2,3"
            opacity={0.5}
          />
          <line
            x1={0}
            x2={CHART_W}
            y1={rsiY(70)}
            y2={rsiY(70)}
            stroke="#22c55e"
            strokeWidth={0.5}
            strokeDasharray="2,3"
            opacity={0.5}
          />
          {/* RSI line */}
          <polyline
            points={rsi14Series
              .map((v, i) => (v !== null ? `${x(i).toFixed(1)},${rsiY(v).toFixed(1)}` : null))
              .filter(Boolean)
              .join(" ")}
            fill="none"
            stroke="#a855f7"
            strokeWidth={1.2}
            opacity={0.9}
          />
          {/* Event marker on RSI */}
          {eventIdx >= 0 && rsi14Series[eventIdx] !== null && (
            <circle
              cx={x(eventIdx)}
              cy={rsiY(rsi14Series[eventIdx] as number)}
              r={3}
              fill="#ef4444"
            />
          )}
        </svg>
      </div>

      {/* Context stats */}
      {triggerEvent && (
        <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] tabular-nums">
          <div className="rounded border border-border/40 bg-background/50 px-1.5 py-1">
            <div className="text-[8px] text-muted-foreground uppercase">5m</div>
            <div className={triggerEvent.context.delta5m >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"}>
              {fmtPct(triggerEvent.context.delta5m)}
            </div>
          </div>
          <div className="rounded border border-border/40 bg-background/50 px-1.5 py-1">
            <div className="text-[8px] text-muted-foreground uppercase">30m</div>
            <div className={triggerEvent.context.delta30m >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"}>
              {fmtPct(triggerEvent.context.delta30m)}
            </div>
          </div>
          <div className="rounded border border-border/40 bg-background/50 px-1.5 py-1">
            <div className="text-[8px] text-muted-foreground uppercase">1h</div>
            <div className={triggerEvent.context.delta1h >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"}>
              {fmtPct(triggerEvent.context.delta1h)}
            </div>
          </div>
          <div className="rounded border border-border/40 bg-background/50 px-1.5 py-1">
            <div className="text-[8px] text-muted-foreground uppercase">24h</div>
            <div className={triggerEvent.context.delta24h >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"}>
              {fmtPct(triggerEvent.context.delta24h)}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground/60">
        <span>
          {liveSamples.length} samples · {registry.cadence(symbol)} cadence
        </span>
        <span>Updated every 5s</span>
      </div>
    </div>
  );
}
