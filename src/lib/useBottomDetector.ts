/**
 * useBottomDetector.ts
 * ------------------------------------------------------------------
 * Wires the RollingBufferRegistry into the existing 10s price stream.
 *
 * Feed it the live ticker data (same `data` prop SimulatedTrading
 * receives) and it will:
 *   1. Push each ticker's latest price into the registry
 *   2. Collect any BottomEvents that fire
 *   3. Maintain a rolling list of recent events (last 100)
 *   4. Maintain a Set of symbols with active signals (for row badges)
 *
 * Also fires toast + audio chime for high-severity events.
 * ------------------------------------------------------------------
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRegistry,
  type BottomEvent,
  type RollingBufferRegistry,
} from "@/lib/rolling-buffer";

interface TickerLike {
  symbol: string;
  price: number;
  turnover24h: number;
}

export interface BottomDetectorState {
  /** Recent events, newest first. Capped at 100. */
  events: BottomEvent[];
  /** Set of symbols that have fired in the last 5 minutes */
  activeSymbols: Set<string>;
  /** Total events emitted since mount */
  totalEmitted: number;
}

interface UseBottomDetectorOptions {
  /** Minimum severity (0-100) to fire a toast notification. Default 70. */
  toastThreshold?: number;
  /** Whether to play a sound on high-severity events. Default true. */
  soundEnabled?: boolean;
  /** Whether toast notifications are enabled. Default true. */
  toastEnabled?: boolean;
}

export function useBottomDetector<T extends TickerLike>(
  data: T[],
  options: UseBottomDetectorOptions = {}
): BottomDetectorState & {
  registry: RollingBufferRegistry;
  clearEvents: () => void;
} {
  const { toastThreshold = 70, soundEnabled = true, toastEnabled = true } = options;

  const registryRef = useRef<RollingBufferRegistry>(getRegistry());
  const [events, setEvents] = useState<BottomEvent[]>([]);
  const [activeSymbols, setActiveSymbols] = useState<Set<string>>(new Set());
  const [totalEmitted, setTotalEmitted] = useState(0);
  const lastDataRef = useRef<T[]>([]);

  // Prune active-symbols set on a 30s timer (remove symbols whose last
  // event was >5 min ago).
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveSymbols((prev) => {
        const next = new Set<string>();
        for (const e of events) {
          if (now - e.timestamp < 5 * 60_000) {
            next.add(e.symbol);
          }
        }
        // Preserve symbols that have a recent event in the registry
        // (events array might be trimmed but the symbol is still active)
        for (const sym of prev) {
          if (registryRef.current.hasRecentEvent(sym)) {
            next.add(sym);
          }
        }
        return next.size === prev.size ? prev : next;
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [events]);

  // Process incoming data — push each ticker's price into the registry
  useEffect(() => {
    if (data.length === 0) return;
    const now = Date.now();
    const newEvents: BottomEvent[] = [];

    for (const ticker of data) {
      if (ticker.price <= 0) continue;
      // volume is unknown from the price-only stream — use 0.
      // The buffer will treat it as "no volume info" which means
      // volRatio returns null and confirmation can't fire on this path
      // alone. That's OK because the confirmation check is permissive
      // (RSI cross + higher-low alone can confirm if vol is null).
      // Actually we need volume for confirmation. So we pass 1.0 as a
      // neutral default — the volume ratio then reflects "average of
      // equal volumes" = 1.0, which won't trigger volConfirm.
      //
      // Better: use the ticker's turnover24h as a proxy for relative
      // volume activity (scaled). This is hacky but provides signal.
      // The real volume comes from kline fetches.
      const event = registryRef.current.push(
        ticker.symbol,
        ticker.price,
        1.0, // see note above
        now
      );
      if (event) {
        newEvents.push(event);
      }
    }

    if (newEvents.length > 0) {
      setEvents((prev) => {
        const merged = [...newEvents, ...prev];
        return merged.slice(0, 100);
      });
      setActiveSymbols((prev) => {
        const next = new Set(prev);
        for (const e of newEvents) next.add(e.symbol);
        return next;
      });
      setTotalEmitted((n) => n + newEvents.length);

      // Toast + sound for high-severity events
      for (const e of newEvents) {
        if (e.severity >= toastThreshold) {
          if (toastEnabled && typeof window !== "undefined") {
            try {
              new Notification(
                `Bottom signal: ${e.symbol.replace("USDT", "")}`,
                {
                  body: `Severity ${e.severity}/100 · Price ${e.price.toPrecision(6)} · 30m ${e.context.delta30m.toFixed(2)}%`,
                  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%88%3C/text%3E%3C/svg%3E",
                }
              );
            } catch {
              // Notification API may not be available or denied
            }
          }
          if (soundEnabled && typeof window !== "undefined") {
            playChime();
          }
        }
      }
    }

    lastDataRef.current = data;
  }, [data, toastThreshold, toastEnabled, soundEnabled]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setActiveSymbols(new Set());
  }, []);

  return {
    events,
    activeSymbols,
    totalEmitted,
    registry: registryRef.current,
    clearEvents,
  };
}

/**
 * Web Audio API chime — no asset file needed.
 */
function playChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const notes = [
      { f: 523.25, t: 0 }, // C5
      { f: 659.25, t: 0.12 }, // E5
      { f: 783.99, t: 0.24 }, // G5
    ];
    for (const { f, t } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, ctx.currentTime + t);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.35);
    }
    // Close the context after the chime finishes
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // ignore
  }
}
