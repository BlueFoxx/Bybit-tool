/**
 * backtest-engine.ts
 * ------------------------------------------------------------------
 * Replays historical klines through the SAME RollingBufferRegistry
 * that the live detector uses, then simulates the slot's TP/SL logic
 * to measure the bottom-detector as an entry trigger.
 *
 * The detector module is designed to be deterministic given the same
 * input sequence — so a backtest gives an honest answer to
 * "would this rule have caught real bottoms in the past?"
 * ------------------------------------------------------------------
 */

import { RollingBufferRegistry, type BottomEvent } from "./rolling-buffer";
import type { BybitKline } from "./historical-klines";

export interface BacktestConfig {
  /** Take profit %, e.g. 2 means +2% */
  takeProfitPct: number;
  /** Stop loss %, e.g. 1.5 means -1.5% */
  stopLossPct: number;
  /** Max simultaneous open positions */
  maxPositions: number;
  /** Order size in USD per trade */
  orderSize: number;
  /** Cooldown between entries on the same symbol (ms) */
  cooldownMs?: number;
  /**
   * How long to hold a position before giving up (ms). 0 = no timeout.
   * Default: 24h.
   */
  maxHoldMs?: number;
}

export interface BacktestTrade {
  symbol: string;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
  reason: "take_profit" | "stop_loss" | "timeout" | "end_of_data";
  /** Severity of the bottom event that triggered this trade */
  triggerSeverity: number;
  /** Bottom event context snapshot */
  context: BottomEvent["context"];
}

export interface BacktestStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number; // 0-100
  totalPnlUsd: number;
  avgPnlUsd: number;
  avgPnlPct: number;
  maxWinUsd: number;
  maxLossUsd: number;
  avgHoldMs: number;
  /** Max consecutive losing trades */
  maxConsecutiveLosses: number;
  /** Largest drawdown from peak equity (USD) */
  maxDrawdownUsd: number;
  /** Final equity curve as array of {t, equity} */
  equityCurve: { t: number; equity: number }[];
  /** All bottom events detected, whether or not they became trades */
  detectedEvents: BottomEvent[];
  /** Trades that hit max positions and were skipped */
  skippedSignals: number;
}

interface OpenPosition {
  symbol: string;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  triggerSeverity: number;
  context: BottomEvent["context"];
  maxHoldMs: number;
}

/**
 * Run a backtest on a single symbol's kline series.
 *
 * - Klines are processed one by one; each kline becomes a "tick"
 *   with high/low/close prices.
 * - The rolling buffer is fed close prices at kline granularity.
 * - When a BottomEvent fires, if positions are available, a trade opens.
 * - On each subsequent kline, TP/SL/timeout are checked.
 *
 * Returns trades + aggregated stats.
 */
export function runBacktest(
  klines: BybitKline[],
  config: BacktestConfig,
  symbol: string = "BACKTEST"
): { trades: BacktestTrade[]; stats: BacktestStats } {
  const registry = new RollingBufferRegistry();
  const trades: BacktestTrade[] = [];
  const detectedEvents: BottomEvent[] = [];
  let skippedSignals = 0;

  const openPositions: OpenPosition[] = [];
  const cooldownMs = config.cooldownMs ?? 0;
  const maxHoldMs = config.maxHoldMs ?? 24 * 60 * 60_000;
  const lastTradeAt = new Map<string, number>();

  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  const equityCurve: { t: number; equity: number }[] = [];
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];

    // 1. Feed close into the registry (volume = k.volume)
    const event = registry.push(symbol, k.close, k.volume, k.startTime);
    if (event) {
      detectedEvents.push(event);

      // Check cooldown
      const lastAt = lastTradeAt.get(event.symbol) ?? 0;
      if (event.timestamp - lastAt < cooldownMs) {
        skippedSignals++;
      } else if (openPositions.length < config.maxPositions) {
        // Open a new position
        const qty = config.orderSize / event.price;
        openPositions.push({
          symbol: event.symbol,
          entryTime: event.timestamp,
          entryPrice: event.price,
          quantity: qty,
          triggerSeverity: event.severity,
          context: event.context,
          maxHoldMs,
        });
        lastTradeAt.set(event.symbol, event.timestamp);
      } else {
        skippedSignals++;
      }
    }

    // 2. Check TP/SL/timeout on all open positions using this kline's high/low
    const stillOpen: OpenPosition[] = [];
    for (const pos of openPositions) {
      // Skip if this position is for a different symbol (multi-symbol backtests)
      if (pos.symbol !== symbol) {
        stillOpen.push(pos);
        continue;
      }

      const tpPrice = pos.entryPrice * (1 + config.takeProfitPct / 100);
      const slPrice = pos.entryPrice * (1 - config.stopLossPct / 100);

      let exitPrice: number | null = null;
      let reason: BacktestTrade["reason"] | null = null;

      // TP first (conservative — assume TP hits before SL if both in range)
      if (k.high >= tpPrice) {
        exitPrice = tpPrice;
        reason = "take_profit";
      } else if (k.low <= slPrice) {
        exitPrice = slPrice;
        reason = "stop_loss";
      } else if (k.startTime - pos.entryTime >= pos.maxHoldMs) {
        exitPrice = k.close;
        reason = "timeout";
      }

      if (exitPrice !== null && reason !== null) {
        const pnlUsd = (exitPrice - pos.entryPrice) * pos.quantity;
        const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        trades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          entryPrice: pos.entryPrice,
          exitTime: k.startTime,
          exitPrice,
          pnlUsd,
          pnlPct,
          reason,
          triggerSeverity: pos.triggerSeverity,
          context: pos.context,
        });

        equity += pnlUsd;
        peakEquity = Math.max(peakEquity, equity);
        const dd = peakEquity - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;

        if (pnlUsd < 0) {
          consecutiveLosses++;
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
        } else {
          consecutiveLosses = 0;
        }

        equityCurve.push({ t: k.startTime, equity });
      } else {
        stillOpen.push(pos);
      }
    }
    openPositions.length = 0;
    openPositions.push(...stillOpen);
  }

  // 3. Close any remaining positions at the last close
  if (klines.length > 0) {
    const lastKline = klines[klines.length - 1];
    for (const pos of openPositions) {
      const exitPrice = lastKline.close;
      const pnlUsd = (exitPrice - pos.entryPrice) * pos.quantity;
      const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
      trades.push({
        symbol: pos.symbol,
        entryTime: pos.entryTime,
        entryPrice: pos.entryPrice,
        exitTime: lastKline.startTime,
        exitPrice,
        pnlUsd,
        pnlPct,
        reason: "end_of_data",
        triggerSeverity: pos.triggerSeverity,
        context: pos.context,
      });
      equity += pnlUsd;
      equityCurve.push({ t: lastKline.startTime, equity });
    }
  }

  // 4. Aggregate stats
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const losses = trades.filter((t) => t.pnlUsd < 0).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const avgPnl = trades.length > 0 ? totalPnl / trades.length : 0;
  const avgPnlPct =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length
      : 0;
  const maxWin = trades.reduce((m, t) => Math.max(m, t.pnlUsd), 0);
  const maxLoss = trades.reduce((m, t) => Math.min(m, t.pnlUsd), 0);
  const avgHoldMs =
    trades.length > 0
      ? trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / trades.length
      : 0;

  const stats: BacktestStats = {
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    totalPnlUsd: totalPnl,
    avgPnlUsd: avgPnl,
    avgPnlPct,
    maxWinUsd: maxWin,
    maxLossUsd: maxLoss,
    avgHoldMs,
    maxConsecutiveLosses,
    maxDrawdownUsd: maxDrawdown,
    equityCurve,
    detectedEvents,
    skippedSignals,
  };

  return { trades, stats };
}
