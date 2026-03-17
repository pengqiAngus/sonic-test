"use client";

import { memo, useDeferredValue, useRef } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";

import { Panel } from "@/components/panel";
import { useRecentTrades } from "@/lib/hooks";
import type { MarketId } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 32;

// 成交明细：只展示最近 N 条，并通过虚拟列表降低滚动开销。
export function TradeTape({ marketId }: { marketId: MarketId }): React.ReactElement {
  const trades = useDeferredValue(useRecentTrades(120));
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: trades.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => trades[index]?.tradeId ?? index,
    overscan: 16
  });

  return (
    <Panel
      eyebrow="Tape"
      title="Trade Stream"
      description="Recent trades 通过虚拟化列表渲染，避免高频 append 导致整列重排。"
      action={
        <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
          {marketId}
        </span>
      }
    >
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/80">
        <div className="grid grid-cols-[1.1fr_0.9fr_0.8fr] border-b border-slate-200 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          <span>Time</span>
          <span className="text-right">Price</span>
          <span className="text-right">Size</span>
        </div>
        <div
          ref={parentRef}
          className="h-[360px] overflow-auto"
        >
          <div
            className="relative"
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`
            }}
          >
            {rowVirtualizer.getVirtualItems().map((item) => (
              <TradeRow
                key={trades[item.index]?.tradeId ?? item.index}
                trade={trades[item.index]}
                style={{
                  height: `${item.size}px`,
                  transform: `translateY(${item.start}px)`
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

const TradeRow = memo(function TradeRow({
  trade,
  style
}: {
  trade:
    | {
        tradeId: string;
        ts: number;
        price: number;
        size: number;
        side: "buy" | "sell";
      }
    | undefined;
  style: React.CSSProperties;
}): React.ReactElement | null {
  if (!trade) {
    return null;
  }

  return (
    <div
      className={cn(
        "absolute left-0 top-0 grid w-full grid-cols-[1.1fr_0.9fr_0.8fr] items-center px-4 text-sm",
        trade.side === "buy" ? "bg-emerald-50/70" : "bg-amber-50/70"
      )}
      style={style}
    >
      <span className="text-slate-500">{format(trade.ts, "HH:mm:ss")}</span>
      <span
        className={cn(
          "text-right font-medium tabular-nums",
          trade.side === "buy" ? "text-emerald-700" : "text-amber-700"
        )}
      >
        {trade.price.toFixed(2)}
      </span>
      <span className="text-right tabular-nums text-slate-700">{trade.size.toFixed(4)}</span>
    </div>
  );
});
