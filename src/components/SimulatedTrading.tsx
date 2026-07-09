"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  X,
  Trash2,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TickerData = any;

interface SlotConfig {
  id: number;
  timeframe: string;
  buyThreshold: number;
  takeProfitPct: number;
  stopLossPct: number;
  orderSize: number;
  maxPositions: number;
  enabled: boolean;
}

interface SimPosition {
  id: number;
  symbol: string;
  slotId: number;
  entryPrice: number;
  entryTime: string;
  quantity: number;
}

interface TradeEntry {
  id: number;
  symbol: string;
  slotId: number;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  time: string;
  pnl: number;
  reason: "trigger" | "take_profit" | "stop_loss" | "manual";
}

interface SlotStats {
  realized: number;
  unrealized: number;
  trades: number;
  wins: number;
  openCount: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TIMEFRAMES = [
  { value: "m5", label: "5 Min" },
  { value: "m10", label: "10 Min" },
  { value: "m15", label: "15 Min" },
  { value: "m30", label: "30 Min" },
  { value: "h1", label: "1 Hour" },
  { value: "h12", label: "12 Hours" },
  { value: "h24", label: "24 Hours" },
];

const TF_SHORT: Record<string, string> = {
  m5: "5m",
  m10: "10m",
  m15: "15m",
  m30: "30m",
  h1: "1h",
  h12: "12h",
  h24: "24h",
};

const DEFAULT_SLOTS: SlotConfig[] = [
  {
    id: 1,
    timeframe: "m5",
    buyThreshold: 3,
    takeProfitPct: 2,
    stopLossPct: 1.5,
    orderSize: 1000,
    maxPositions: 5,
    enabled: false,
  },
  {
    id: 2,
    timeframe: "h1",
    buyThreshold: 5,
    takeProfitPct: 3,
    stopLossPct: 2,
    orderSize: 1000,
    maxPositions: 5,
    enabled: false,
  },
  {
    id: 3,
    timeframe: "h24",
    buyThreshold: 8,
    takeProfitPct: 5,
    stopLossPct: 3,
    orderSize: 1000,
    maxPositions: 5,
    enabled: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getChange(ticker: TickerData, tf: string): number | null {
  return ticker.changes[tf] ?? null;
}

function fmtPrice(n: number): string {
  if (n === 0) return "\u2014";
  if (n < 0.01) return "$" + n.toPrecision(4);
  if (n < 1) return "$" + n.toFixed(4);
  if (n < 100) return "$" + n.toFixed(3);
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtPct(n: number, showSign = true): string {
  const sign = showSign && n > 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
}

function fmtPnl(n: number): string {
  const sign = n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return sign + "$" + (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return sign + "$" + (n / 1_000).toFixed(2) + "K";
  return sign + "$" + n.toFixed(2);
}

function fmtTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function pnlColor(n: number): string {
  if (n > 0) return "text-[var(--gain)]";
  if (n < 0) return "text-[var(--loss)]";
  return "text-muted-foreground";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SimulatedTrading({
  data,
  marketType,
}: {
  data: TickerData[];
  marketType: string;
}) {
  /* ---- State ---- */
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [slots, setSlots] = useState<SlotConfig[]>(DEFAULT_SLOTS);
  const [expanded, setExpanded] = useState(true);
  const [simVersion, setSimVersion] = useState(0);

  /* ---- Refs ---- */
  const simRef = useRef<{
    positions: SimPosition[];
    tradeLog: TradeEntry[];
    nextId: number;
  }>({ positions: [], tradeLog: [], nextId: 1 });

  const masterRef = useRef(masterEnabled);
  masterRef.current = masterEnabled;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  /* ---- Price lookup ---- */
  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data) m.set(t.symbol, t.price);
    return m;
  }, [data]);

  /* ================================================================ */
  /*  Simulation effect – runs on every data update                    */
  /* ================================================================ */
  useEffect(() => {
    if (!masterRef.current) return;
    if (marketType !== "spot") return;
    if (data.length === 0) return;

    const sim = simRef.current;
    const currentSlots = slotsRef.current;
    let changed = false;

    for (const slot of currentSlots) {
      if (!slot.enabled) continue;

      /* --- 1. Check TP/SL for existing positions --- */
      const toClose: {
        pos: SimPosition;
        reason: "take_profit" | "stop_loss";
      }[] = [];

      for (const pos of sim.positions.filter((p) => p.slotId === slot.id)) {
        const cur = priceMap.get(pos.symbol);
        if (!cur) continue;
        const pct = ((cur - pos.entryPrice) / pos.entryPrice) * 100;
        if (pct >= slot.takeProfitPct) toClose.push({ pos, reason: "take_profit" });
        else if (pct <= -slot.stopLossPct) toClose.push({ pos, reason: "stop_loss" });
      }

      for (const { pos, reason } of toClose) {
        const cur = priceMap.get(pos.symbol) ?? pos.entryPrice;
        const pnl = (cur - pos.entryPrice) * pos.quantity;
        sim.tradeLog.unshift({
          id: sim.nextId++,
          symbol: pos.symbol,
          slotId: slot.id,
          side: "SELL",
          price: cur,
          quantity: pos.quantity,
          time: new Date().toISOString(),
          pnl,
          reason,
        });
        sim.positions = sim.positions.filter((p) => p.id !== pos.id);
        changed = true;
      }

      /* --- 2. Check for new buy signals --- */
      const openForSlot = sim.positions.filter((p) => p.slotId === slot.id);
      if (openForSlot.length >= slot.maxPositions) continue;

      const openSymbols = new Set(openForSlot.map((p) => p.symbol));
      const candidates = data
        .filter((t) => {
          if (openSymbols.has(t.symbol)) return false;
          const ch = getChange(t, slot.timeframe);
          return ch !== null && ch >= slot.buyThreshold;
        })
        .sort(
          (a, b) =>
            (getChange(b, slot.timeframe) ?? 0) -
            (getChange(a, slot.timeframe) ?? 0)
        );

      const toBuy = candidates.slice(
        0,
        slot.maxPositions - openForSlot.length
      );

      for (const t of toBuy) {
        const qty = slot.orderSize / t.price;
        sim.positions.push({
          id: sim.nextId++,
          symbol: t.symbol,
          slotId: slot.id,
          entryPrice: t.price,
          entryTime: new Date().toISOString(),
          quantity: qty,
        });
        sim.tradeLog.unshift({
          id: sim.nextId++,
          symbol: t.symbol,
          slotId: slot.id,
          side: "BUY",
          price: t.price,
          quantity: qty,
          time: new Date().toISOString(),
          pnl: 0,
          reason: "trigger",
        });
        changed = true;
      }
    }

    /* Trim log to last 500 */
    if (sim.tradeLog.length > 500) sim.tradeLog.length = 500;

    if (changed) setSimVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, priceMap, marketType]);

  /* ================================================================ */
  /*  Memoized calculations                                            */
  /* ================================================================ */

  const slotStats = useMemo(() => {
    const sim = simRef.current;
    const stats = new Map<number, SlotStats>();
    for (const s of slots)
      stats.set(s.id, {
        realized: 0,
        unrealized: 0,
        trades: 0,
        wins: 0,
        openCount: 0,
      });

    for (const trade of sim.tradeLog) {
      const st = stats.get(trade.slotId);
      if (!st) continue;
      if (trade.side === "SELL") {
        st.realized += trade.pnl;
        st.trades++;
        if (trade.pnl > 0) st.wins++;
      }
    }
    for (const pos of sim.positions) {
      const st = stats.get(pos.slotId);
      if (!st) continue;
      const cur = priceMap.get(pos.symbol) ?? pos.entryPrice;
      st.unrealized += (cur - pos.entryPrice) * pos.quantity;
      st.openCount++;
    }
    return stats;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simVersion, slots, priceMap]);

  const displayPositions = useMemo(() => {
    return simRef.current.positions
      .map((pos) => {
        const cur = priceMap.get(pos.symbol) ?? pos.entryPrice;
        const pnl = (cur - pos.entryPrice) * pos.quantity;
        const pct =
          pos.entryPrice > 0
            ? ((cur - pos.entryPrice) / pos.entryPrice) * 100
            : 0;
        const slot = slots.find((s) => s.id === pos.slotId);
        return {
          ...pos,
          currentPrice: cur,
          unrealizedPnl: pnl,
          changePct: pct,
          tpDist: slot ? slot.takeProfitPct - pct : 0,
          slDist: slot ? pct + slot.stopLossPct : 0,
        };
      })
      .sort(
        (a, b) => a.slotId - b.slotId || b.unrealizedPnl - a.unrealizedPnl
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simVersion, priceMap, slots]);

  const displayLog = useMemo(
    () => simRef.current.tradeLog.slice(0, 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simVersion]
  );

  const totalOpen = simRef.current.positions.length;
  const totalPnl = Array.from(slotStats.values()).reduce(
    (s, v) => s + v.realized + v.unrealized,
    0
  );

  /* ================================================================ */
  /*  Handlers                                                         */
  /* ================================================================ */

  const updateSlot = (
    id: number,
    field: keyof SlotConfig,
    value: string | number | boolean
  ) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const closePosition = (posId: number) => {
    const sim = simRef.current;
    const pos = sim.positions.find((p) => p.id === posId);
    if (!pos) return;
    const cur = priceMap.get(pos.symbol) ?? pos.entryPrice;
    sim.tradeLog.unshift({
      id: sim.nextId++,
      symbol: pos.symbol,
      slotId: pos.slotId,
      side: "SELL",
      price: cur,
      quantity: pos.quantity,
      time: new Date().toISOString(),
      pnl: (cur - pos.entryPrice) * pos.quantity,
      reason: "manual",
    });
    sim.positions = sim.positions.filter((p) => p.id !== posId);
    setSimVersion((v) => v + 1);
  };

  const closeAll = (slotId?: number) => {
    const sim = simRef.current;
    const targets = slotId
      ? sim.positions.filter((p) => p.slotId === slotId)
      : [...sim.positions];
    for (const pos of targets) {
      const cur = priceMap.get(pos.symbol) ?? pos.entryPrice;
      sim.tradeLog.unshift({
        id: sim.nextId++,
        symbol: pos.symbol,
        slotId: pos.slotId,
        side: "SELL",
        price: cur,
        quantity: pos.quantity,
        time: new Date().toISOString(),
        pnl: (cur - pos.entryPrice) * pos.quantity,
        reason: "manual",
      });
    }
    sim.positions = slotId
      ? sim.positions.filter((p) => p.slotId !== slotId)
      : [];
    setSimVersion((v) => v + 1);
  };

  const resetAll = () => {
    closeAll();
    simRef.current.tradeLog = [];
    setSimVersion((v) => v + 1);
  };

  const clearLog = () => {
    simRef.current.tradeLog = [];
    setSimVersion((v) => v + 1);
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const slotLabel = (id: number) => {
    const s = slots.find((sl) => sl.id === id);
    return s ? TF_SHORT[s.timeframe] ?? s.timeframe : `S${id}`;
  };

  const reasonLabel = (r: string) => {
    switch (r) {
      case "take_profit":
        return "TP";
      case "stop_loss":
        return "SL";
      case "manual":
        return "Manual";
      default:
        return "Trigger";
    }
  };

  return (
    <div className="mt-6 space-y-4">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded((p) => !p)}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            />
          </Button>
          <h2 className="text-sm font-semibold tracking-tight">
            Simulated Spot Trading
          </h2>
          <Badge
            variant={masterEnabled ? "default" : "secondary"}
            className={`text-[10px] px-1.5 ${masterEnabled ? "bg-green-600/80 hover:bg-green-600" : ""}`}
          >
            {masterEnabled ? "\u25CF LIVE" : "\u25CB OFF"}
          </Badge>
          {totalOpen > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5">
              {totalOpen} open
            </Badge>
          )}
          {totalPnl !== 0 && (
            <span
              className={`text-xs font-bold tabular-nums ${pnlColor(totalPnl)}`}
            >
              {fmtPnl(totalPnl)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant={masterEnabled ? "destructive" : "default"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMasterEnabled((p) => !p)}
            disabled={marketType !== "spot"}
            title={
              marketType !== "spot"
                ? "Simulation only runs on Spot market"
                : masterEnabled
                  ? "Stop simulation"
                  : "Start simulation"
            }
          >
            {masterEnabled ? (
              <>
                <Pause className="h-3 w-3 mr-1" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1" />
                Start
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={resetAll}
            title="Reset all positions & log"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* ---- Expanded content ---- */}
      {expanded && (
        <>
          {/* ==== Slot Configuration Cards ==== */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {slots.map((slot) => {
              const st = slotStats.get(slot.id);
              const slotPnl =
                (st?.realized ?? 0) + (st?.unrealized ?? 0);
              const winRate =
                st && st.trades > 0
                  ? ((st.wins / st.trades) * 100).toFixed(1)
                  : "\u2014";

              return (
                <Card
                  key={slot.id}
                  className={`bg-card/70 border-border/50 transition-colors ${slot.enabled ? "border-green-500/30" : ""}`}
                >
                  <CardContent className="p-3 space-y-3">
                    {/* Slot header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            updateSlot(slot.id, "enabled", !slot.enabled)
                          }
                          className={`w-2.5 h-2.5 rounded-full transition-colors ${slot.enabled ? "bg-green-500" : "bg-muted-foreground/30"}`}
                          title={slot.enabled ? "Disable slot" : "Enable slot"}
                        />
                        <span className="text-xs font-medium">
                          Slot {slot.id}
                        </span>
                      </div>
                      <span
                        className={`text-xs font-bold tabular-nums ${pnlColor(slotPnl)}`}
                      >
                        {fmtPnl(slotPnl)}
                      </span>
                    </div>

                    {/* Inputs grid */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="block text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                          TF
                        </label>
                        <select
                          value={slot.timeframe}
                          onChange={(e) =>
                            updateSlot(slot.id, "timeframe", e.target.value)
                          }
                          disabled={!slot.enabled}
                          className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-40"
                        >
                          {TIMEFRAMES.map((tf) => (
                            <option key={tf.value} value={tf.value}>
                              {tf.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                          Buy &ge;%
                        </label>
                        <input
                          type="number"
                          value={slot.buyThreshold}
                          onChange={(e) =>
                            updateSlot(
                              slot.id,
                              "buyThreshold",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          disabled={!slot.enabled}
                          step="0.5"
                          min="0"
                          className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                          TP %
                        </label>
                        <input
                          type="number"
                          value={slot.takeProfitPct}
                          onChange={(e) =>
                            updateSlot(
                              slot.id,
                              "takeProfitPct",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          disabled={!slot.enabled}
                          step="0.5"
                          min="0"
                          className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                          SL %
                        </label>
                        <input
                          type="number"
                          value={slot.stopLossPct}
                          onChange={(e) =>
                            updateSlot(
                              slot.id,
                              "stopLossPct",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          disabled={!slot.enabled}
                          step="0.5"
                          min="0"
                          className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                          Size $
                        </label>
                        <input
                          type="number"
                          value={slot.orderSize}
                          onChange={(e) =>
                            updateSlot(
                              slot.id,
                              "orderSize",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          disabled={!slot.enabled}
                          step="100"
                          min="0"
                          className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                          Max
                        </label>
                        <input
                          type="number"
                          value={slot.maxPositions}
                          onChange={(e) =>
                            updateSlot(
                              slot.id,
                              "maxPositions",
                              parseInt(e.target.value) || 1
                            )
                          }
                          disabled={!slot.enabled}
                          min="1"
                          max="50"
                          className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-40"
                        />
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>
                        Trades:{" "}
                        <span className="text-foreground tabular-nums">
                          {st?.trades ?? 0}
                        </span>
                      </span>
                      <span>
                        Wins:{" "}
                        <span className="text-foreground tabular-nums">
                          {st?.wins ?? 0}
                        </span>{" "}
                        ({winRate}%)
                      </span>
                      <span>
                        Open:{" "}
                        <span className="text-foreground tabular-nums">
                          {st?.openCount ?? 0}/{slot.maxPositions}
                        </span>
                      </span>
                      {(st?.openCount ?? 0) > 0 && (
                        <button
                          onClick={() => closeAll(slot.id)}
                          className="text-red-400/80 hover:text-red-400 transition-colors"
                        >
                          Close all
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* ==== Active Positions ==== */}
          {displayPositions.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Active Positions ({displayPositions.length})
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-red-400/70 hover:text-red-400"
                  onClick={() => closeAll()}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Close all
                </Button>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/30 overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow className="border-border/40 hover:bg-transparent">
                        <TableHead className="text-[10px] w-12">Slot</TableHead>
                        <TableHead className="text-[10px] min-w-[100px]">
                          Symbol
                        </TableHead>
                        <TableHead className="text-[10px] text-right">
                          Entry
                        </TableHead>
                        <TableHead className="text-[10px] text-right">
                          Current
                        </TableHead>
                        <TableHead className="text-[10px] text-right">
                          Change
                        </TableHead>
                        <TableHead className="text-[10px] text-right">
                          PnL
                        </TableHead>
                        <TableHead className="text-[10px] text-right hidden sm:table-cell">
                          TP / SL
                        </TableHead>
                        <TableHead className="text-[10px] text-center w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayPositions.map((pos) => (
                        <TableRow
                          key={pos.id}
                          className="border-border/30 hover:bg-muted/20"
                        >
                          <TableCell className="text-[10px] py-1.5 pr-1">
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 font-mono"
                            >
                              {slotLabel(pos.slotId)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-medium py-1.5">
                            {pos.symbol.replace("USDT", "")}
                            <span className="text-muted-foreground/60 text-[10px]">
                              /USDT
                            </span>
                          </TableCell>
                          <TableCell className="text-[11px] text-right tabular-nums py-1.5">
                            {fmtPrice(pos.entryPrice)}
                          </TableCell>
                          <TableCell className="text-[11px] text-right tabular-nums py-1.5">
                            {fmtPrice(pos.currentPrice)}
                          </TableCell>
                          <TableCell
                            className={`text-[11px] text-right tabular-nums font-medium py-1.5 ${pnlColor(pos.changePct)}`}
                          >
                            {fmtPct(pos.changePct)}
                          </TableCell>
                          <TableCell
                            className={`text-[11px] text-right tabular-nums font-medium py-1.5 ${pnlColor(pos.unrealizedPnl)}`}
                          >
                            {fmtPnl(pos.unrealizedPnl)}
                          </TableCell>
                          <TableCell className="text-[10px] text-right tabular-nums text-muted-foreground py-1.5 hidden sm:table-cell">
                            <span className="text-[var(--gain)]">
                              {pos.tpDist.toFixed(1)}%
                            </span>
                            {" / "}
                            <span className="text-[var(--loss)]">
                              {pos.slDist.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-center py-1.5 pl-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-muted-foreground/50 hover:text-red-400"
                              onClick={() => closePosition(pos.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* ==== Trade Log ==== */}
          {displayLog.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Trade Log ({simRef.current.tradeLog.length} total)
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={clearLog}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/30 overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar max-h-60 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow className="border-border/40 hover:bg-transparent">
                        <TableHead className="text-[10px]">Time</TableHead>
                        <TableHead className="text-[10px]">Slot</TableHead>
                        <TableHead className="text-[10px]">Symbol</TableHead>
                        <TableHead className="text-[10px]">Side</TableHead>
                        <TableHead className="text-[10px] text-right">
                          Price
                        </TableHead>
                        <TableHead className="text-[10px] text-right hidden md:table-cell">
                          Qty
                        </TableHead>
                        <TableHead className="text-[10px] text-right">
                          PnL
                        </TableHead>
                        <TableHead className="text-[10px] hidden sm:table-cell">
                          Reason
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayLog.map((t) => (
                        <TableRow
                          key={t.id}
                          className="border-border/30 hover:bg-muted/20"
                        >
                          <TableCell className="text-[10px] text-muted-foreground tabular-nums py-1">
                            {fmtTime(t.time)}
                          </TableCell>
                          <TableCell className="text-[10px] py-1 pr-1">
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 font-mono"
                            >
                              {slotLabel(t.slotId)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[11px] font-medium py-1">
                            {t.symbol.replace("USDT", "")}
                            <span className="text-muted-foreground/60 text-[9px]">
                              /U
                            </span>
                          </TableCell>
                          <TableCell className="py-1">
                            <Badge
                              variant={
                                t.side === "BUY" ? "default" : "destructive"
                              }
                              className={`text-[9px] px-1.5 py-0 ${t.side === "BUY" ? "bg-blue-600/80 hover:bg-blue-600" : ""}`}
                            >
                              {t.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] text-right tabular-nums py-1">
                            {fmtPrice(t.price)}
                          </TableCell>
                          <TableCell className="text-[10px] text-right tabular-nums py-1 hidden md:table-cell">
                            {t.quantity < 0.001
                              ? t.quantity.toExponential(2)
                              : t.quantity.toFixed(4)}
                          </TableCell>
                          <TableCell
                            className={`text-[10px] text-right tabular-nums font-medium py-1 ${t.side === "BUY" ? "text-muted-foreground" : pnlColor(t.pnl)}`}
                          >
                            {t.side === "BUY" ? "\u2014" : fmtPnl(t.pnl)}
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground py-1 hidden sm:table-cell">
                            {reasonLabel(t.reason)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* ==== Empty state ==== */}
          {displayPositions.length === 0 && displayLog.length === 0 && (
            <div className="text-center py-8 text-muted-foreground/60 text-xs">
              {masterEnabled
                ? "Monitoring for buy signals\u2026"
                : "Enable a slot and press Start to begin simulation."}
            </div>
          )}
        </>
      )}
    </div>
  );
}