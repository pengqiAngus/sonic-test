"use client";

import { useDeferredValue, useEffect, useRef } from "react";

import useSWR from "swr";
import type { CandlestickData, IChartApi, ISeriesApi, Time } from "lightweight-charts";

import { fetchCandles } from "@/lib/api";
import type { Candle, CandleInterval, MarketId, TradeRecord } from "@/lib/types";
import { useMarketStore } from "@/store/market-store";

const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1s": 1,
  "1m": 60,
  "5m": 300,
  "15m": 900
};
const UTC_PLUS_8_OFFSET_SECONDS = 8 * 60 * 60;

// Convert into the candlestick shape required by lightweight-charts.
function toChartCandle(candle: Candle): CandlestickData {
  return {
    time: candle.time as CandlestickData["time"],
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close
  };
}

// Update current candle in real time from latest trade (or start a new candle).
function mergeTradeIntoCandle(
  trade: TradeRecord,
  previous: Candle | null,
  interval: CandleInterval
): Candle {
  const bucket =
    Math.floor(trade.ts / 1_000 / INTERVAL_SECONDS[interval]) * INTERVAL_SECONDS[interval];

  if (!previous || bucket > previous.time) {
    return {
      time: bucket,
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume: trade.size,
      trades: 1
    };
  }

  return {
    ...previous,
    high: Math.max(previous.high, trade.price),
    low: Math.min(previous.low, trade.price),
    close: trade.price,
    volume: previous.volume + trade.size,
    trades: previous.trades + 1
  };
}

function readUnixSecondsFromChartTime(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "year" in value &&
    "month" in value &&
    "day" in value
  ) {
    const year = Number((value as { year: number }).year);
    const month = Number((value as { month: number }).month);
    const day = Number((value as { day: number }).day);
    return Math.floor(Date.UTC(year, month - 1, day) / 1_000);
  }

  return null;
}

function formatInUtcPlus8(unixSeconds: number, includeSeconds: boolean): string {
  const shifted = new Date((unixSeconds + UTC_PLUS_8_OFFSET_SECONDS) * 1_000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");

  if (includeSeconds) {
    const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  return `${hh}:${mm}`;
}

export function TVChart({
  marketId,
  interval
}: {
  marketId: MarketId;
  interval: CandleInterval;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const latestCandleRef = useRef<Candle | null>(null);
  const lastTradeIdRef = useRef<string | null>(null);

  const latestTrade = useMarketStore((state) => {
    const tradeVersion = state.tradeVersion;
    void tradeVersion;
    return state.trades[0] ?? null;
  });
  const deferredTrade = useDeferredValue(latestTrade);

  const { data, error, isLoading } = useSWR(
    `${marketId}:${interval}:candles`,
    () => fetchCandles(marketId, interval, 720),
    {
      keepPreviousData: true
    }
  );

  useEffect(() => {
    let cleanup = () => undefined;
    let cancelled = false;

    // Lazy-load chart library to keep initial bundle smaller.
    void import("lightweight-charts").then(({ CandlestickSeries, ColorType, createChart }) => {
      if (cancelled || !containerRef.current) {
        return;
      }

      const chart = createChart(containerRef.current, {
        autoSize: true,
        localization: {
          // lightweight-charts defaults to UTC; map display time to UTC+8.
          timeFormatter: (time: Time) => {
            const unixSeconds = readUnixSecondsFromChartTime(time);
            if (unixSeconds === null) {
              return "";
            }
            return formatInUtcPlus8(unixSeconds, interval === "1s");
          }
        },
        layout: {
          background: {
            color: "transparent",
            type: ColorType.Solid
          },
          textColor: "#334155"
        },
        grid: {
          vertLines: {
            color: "rgba(16, 32, 45, 0.06)"
          },
          horzLines: {
            color: "rgba(16, 32, 45, 0.06)"
          }
        },
        rightPriceScale: {
          borderVisible: false
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: interval === "1s",
          tickMarkFormatter: (time: Time) => {
            const unixSeconds = readUnixSecondsFromChartTime(time);
            if (unixSeconds === null) {
              return "";
            }
            return formatInUtcPlus8(unixSeconds, interval === "1s");
          }
        },
        crosshair: {
          vertLine: {
            color: "rgba(15, 118, 110, 0.24)"
          },
          horzLine: {
            color: "rgba(15, 118, 110, 0.24)"
          }
        }
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#047857",
        downColor: "#b45309",
        wickUpColor: "#047857",
        wickDownColor: "#b45309",
        borderVisible: false
      });

      chartRef.current = chart;
      seriesRef.current = series;

      const observer = new ResizeObserver(() => {
        chart.timeScale().fitContent();
      });

      observer.observe(containerRef.current);

      cleanup = () => {
        observer.disconnect();
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [interval, marketId]);

  useEffect(() => {
    if (!data || !seriesRef.current) {
      return;
    }

    seriesRef.current.setData(data.candles.map(toChartCandle));
    chartRef.current?.timeScale().fitContent();
    latestCandleRef.current = data.candles.at(-1) ?? null;
    lastTradeIdRef.current = null;
  }, [data]);

  useEffect(() => {
    if (!deferredTrade || !seriesRef.current) {
      return;
    }

    if (lastTradeIdRef.current === deferredTrade.tradeId) {
      return;
    }

    // setData for history + update for realtime minimizes redraw cost.
    const nextCandle = mergeTradeIntoCandle(deferredTrade, latestCandleRef.current, interval);

    latestCandleRef.current = nextCandle;
    lastTradeIdRef.current = deferredTrade.tradeId;
    seriesRef.current.update(toChartCandle(nextCandle));
  }, [deferredTrade, interval]);

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/75">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">TradingView</p>
          <p className="truncate text-sm font-medium text-slate-800">
            {marketId} · {interval} · UTC+8
          </p>
        </div>
        <div className="text-xs text-slate-500 sm:text-sm">
          {error ? "candles unavailable" : isLoading ? "loading history" : "live"}
        </div>
      </div>
      <div ref={containerRef} className="h-[280px] w-full sm:h-[360px]" />
    </div>
  );
}
