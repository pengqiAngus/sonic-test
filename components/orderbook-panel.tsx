"use client";

import { memo, useDeferredValue, useRef } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils";
import { useBookLevels, useMidPrice } from "@/store/market-store";

const ROW_HEIGHT = 30;

export function OrderbookPanel(): React.ReactElement {
  const bids = useDeferredValue(useBookLevels("bids"));
  const asks = useDeferredValue(useBookLevels("asks"));
  const midPrice = useMidPrice();

  return (
    <Panel
      eyebrow="Depth"
      title="Virtualized Orderbook"
      description="Map 存储 + RAF 批量提交后，列表只在动画帧重绘。"
      className="noise-grid"
    >
      <div className="mb-4 grid gap-3 rounded-[24px] border border-slate-200 bg-white/80 p-4 sm:grid-cols-3">
        <SummaryChip label="Best bid" value={bids[0] ? bids[0].price.toFixed(2) : "--"} tone="bid" />
        <SummaryChip
          label="Mid"
          value={midPrice ? midPrice.toFixed(2) : "--"}
          tone="neutral"
        />
        <SummaryChip label="Best ask" value={asks[0] ? asks[0].price.toFixed(2) : "--"} tone="ask" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BookSide title="Asks" side="asks" levels={asks} />
        <BookSide title="Bids" side="bids" levels={bids} />
      </div>
    </Panel>
  );
}

function SummaryChip({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "neutral" | "bid" | "ask";
}): React.ReactElement {
  const styles =
    tone === "bid"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "ask"
        ? "border-amber-200 bg-amber-50"
        : "border-slate-200 bg-slate-50";

  return (
    <div className={cn("rounded-3xl border px-4 py-3", styles)}>
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function BookSide({
  title,
  side,
  levels
}: {
  title: string;
  side: "bids" | "asks";
  levels: Array<{ price: number; size: number; total: number }>;
}): React.ReactElement {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: levels.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/80">
      <div className="grid grid-cols-3 border-b border-slate-200 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
        <span>{title}</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div
        ref={parentRef}
        className="h-[360px] overflow-auto"
        style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
      >
        <div
          className="relative"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`
          }}
        >
          {virtualItems.map((item) => {
            const level = levels[item.index];

            return (
              <BookRow
                key={`${side}-${level?.price ?? item.index}`}
                side={side}
                level={level}
                style={{
                  height: `${item.size}px`,
                  transform: `translateY(${item.start}px)`
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const BookRow = memo(function BookRow({
  level,
  side,
  style
}: {
  level: { price: number; size: number; total: number } | undefined;
  side: "bids" | "asks";
  style: React.CSSProperties;
}): React.ReactElement | null {
  if (!level) {
    return null;
  }

  const tone =
    side === "bids"
      ? "bg-gradient-to-r from-emerald-50 to-transparent text-emerald-900"
      : "bg-gradient-to-r from-amber-50 to-transparent text-amber-900";

  return (
    <div
      className={cn(
        "absolute left-0 top-0 grid w-full grid-cols-3 items-center px-4 text-sm",
        tone
      )}
      style={style}
    >
      <span className="font-medium">{level.price.toFixed(2)}</span>
      <span className="text-right tabular-nums text-slate-700">{level.size.toFixed(4)}</span>
      <span className="text-right tabular-nums text-slate-500">{level.total.toFixed(4)}</span>
    </div>
  );
});
