"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Trash2,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { BottomEvent } from "@/lib/rolling-buffer";

interface BottomAlertsFeedProps {
  events: BottomEvent[];
  totalEmitted: number;
  onClear: () => void;
  soundEnabled: boolean;
  toastEnabled: boolean;
  onToggleSound: () => void;
  onToggleToast: () => void;
  /** Called when user clicks an event to see details */
  onSelectEvent?: (event: BottomEvent) => void;
  /** Called when user clicks a symbol to filter the main table */
  onSelectSymbol?: (symbol: string) => void;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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

function severityColor(sev: number): string {
  if (sev >= 80) return "text-red-400 bg-red-500/10 border-red-500/30";
  if (sev >= 65) return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  if (sev >= 50) return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
  return "text-muted-foreground bg-muted/20 border-border/40";
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

export default function BottomAlertsFeed({
  events,
  totalEmitted,
  onClear,
  soundEnabled,
  toastEnabled,
  onToggleSound,
  onToggleToast,
  onSelectEvent,
  onSelectSymbol,
}: BottomAlertsFeedProps) {
  const [filter, setFilter] = useState<"all" | "high" | "medium">("all");

  const filteredEvents = useMemo(() => {
    if (filter === "high") return events.filter((e) => e.severity >= 75);
    if (filter === "medium") return events.filter((e) => e.severity >= 50);
    return events;
  }, [events, filter]);

  return (
    <Card className="bg-card/70 border-border/50 sticky top-20">
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-semibold tracking-tight">
              Bottom Signals
            </h3>
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 tabular-nums">
              {totalEmitted} total
            </Badge>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${toastEnabled ? "text-amber-400" : "text-muted-foreground/40"}`}
              onClick={onToggleToast}
              title={toastEnabled ? "Disable toast notifications" : "Enable toast notifications"}
            >
              {toastEnabled ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${soundEnabled ? "text-amber-400" : "text-muted-foreground/40"}`}
              onClick={onToggleSound}
              title={soundEnabled ? "Mute sound" : "Unmute sound"}
            >
              {soundEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/50 hover:text-red-400"
              onClick={onClear}
              title="Clear all"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {(["all", "high", "medium"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 text-[10px] py-0.5 rounded border transition-colors ${
                filter === f
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? `All (${events.length})` : f === "high" ? `High (≥75)` : `Med (≥50)`}
            </button>
          ))}
        </div>

        {/* Event list */}
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
          {filteredEvents.length === 0 && (
            <div className="text-center py-8 text-muted-foreground/60 text-xs">
              <TrendingUp className="h-6 w-6 mx-auto mb-2 opacity-40" />
              {events.length === 0
                ? "Waiting for bottom signals…"
                : "No events match this filter."}
            </div>
          )}
          {filteredEvents.map((e, idx) => {
            const base = e.symbol.replace("USDT", "");
            return (
              <div
                key={`${e.symbol}-${e.timestamp}-${idx}`}
                className={`rounded-md border p-2 cursor-pointer hover:bg-muted/30 transition-colors ${severityColor(e.severity)}`}
                onClick={() => {
                  onSelectEvent?.(e);
                  onSelectSymbol?.(e.symbol);
                }}
              >
                {/* Row 1: symbol + severity + time */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold text-xs truncate">
                      {base}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">
                      /USDT
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 tabular-nums font-bold"
                    >
                      {e.severity}
                    </Badge>
                    <span className="text-[9px] text-muted-foreground/70 tabular-nums">
                      {timeAgo(e.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Row 2: price + 30m delta */}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {fmtPrice(e.price)}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] tabular-nums">
                    <span className="text-muted-foreground/70">5m</span>
                    <span className={e.context.delta5m >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"}>
                      {fmtPct(e.context.delta5m)}
                    </span>
                    <span className="text-muted-foreground/70">30m</span>
                    <span className={e.context.delta30m >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"}>
                      {fmtPct(e.context.delta30m)}
                    </span>
                  </div>
                </div>

                {/* Row 3: indicators */}
                <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground/70 tabular-nums">
                  {e.context.rsi14 !== null && (
                    <span>
                      RSI{" "}
                      <span className={e.context.rsi14 < 35 ? "text-[var(--loss)]" : "text-foreground"}>
                        {e.context.rsi14.toFixed(1)}
                      </span>
                    </span>
                  )}
                  {e.context.volRatio !== null && (
                    <span>
                      Vol{" "}
                      <span className={e.context.volRatio >= 2 ? "text-amber-400" : "text-foreground"}>
                        {e.context.volRatio.toFixed(2)}×
                      </span>
                    </span>
                  )}
                  {e.context.higherLow && (
                    <span className="text-amber-400">HL ✓</span>
                  )}
                </div>

                {/* Signals fired */}
                <div className="flex items-center gap-1 mt-1">
                  {e.signals.exhaustion && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground">
                      EXH
                    </Badge>
                  )}
                  {e.signals.reversal && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground">
                      REV
                    </Badge>
                  )}
                  {e.signals.confirmation && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground">
                      CONF
                    </Badge>
                  )}
                  <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground/40" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        {events.length > 0 && (
          <p className="text-[9px] text-muted-foreground/50 text-center">
            Click an event to inspect the chart
          </p>
        )}
      </CardContent>
    </Card>
  );
}
