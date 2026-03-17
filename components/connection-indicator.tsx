"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";

import { Panel } from "@/components/panel";
import { CONNECTION_STATE_LABEL, CONNECTION_STATE_TONE_CLASS } from "@/lib/const";
import type { ConnectionState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/store/market-store";

const STORAGE_KEY = "sonic:connection-indicator:layout";

interface IndicatorLayout {
  x: number;
  y: number;
  isMinimized: boolean;
}

function formatStatus(status: ConnectionState): string {
  return CONNECTION_STATE_LABEL[status];
}

// 根据状态给指示灯配色，便于快速识别连接健康度。
function statusTone(status: ConnectionState): string {
  return CONNECTION_STATE_TONE_CLASS[status];
}

export function ConnectionIndicator(): React.ReactElement {
  const marketId = useMarketStore((state) => state.marketId);
  const connectionState = useMarketStore((state) => state.connectionState);
  const reconnectAttempt = useMarketStore((state) => state.reconnectAttempt);
  const lastSeq = useMarketStore((state) => state.lastSeq);
  const lastPongAt = useMarketStore((state) => state.lastPongAt);
  const rates = useMarketStore((state) => state.rates);
  const gap = useMarketStore((state) => state.gap);
  const error = useMarketStore((state) => state.error);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 96 });
  const [hasRestoredLayout, setHasRestoredLayout] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const livePositionRef = useRef(position);
  const dragFrameRef = useRef<number | null>(null);

  const clampPosition = (x: number, y: number): { x: number; y: number } => {
    if (typeof window === "undefined" || !containerRef.current) {
      return { x, y };
    }

    const width = containerRef.current.offsetWidth;
    const height = containerRef.current.offsetHeight;
    const margin = 12;
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);

    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY)
    };
  };

  useEffect(() => {
    livePositionRef.current = position;
  }, [position]);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) {
      return;
    }

    let restored = false;

    // 恢复上次拖拽位置与折叠状态。
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<IndicatorLayout>;
        if (
          typeof parsed.x === "number" &&
          typeof parsed.y === "number" &&
          typeof parsed.isMinimized === "boolean"
        ) {
          setPosition(clampPosition(parsed.x, parsed.y));
          setIsMinimized(parsed.isMinimized);
          restored = true;
        }
      }
    } catch {
      // Ignore broken localStorage payload and fall back to default position.
    }

    if (!restored) {
      const width = containerRef.current.offsetWidth;
      const initialX = Math.max(12, window.innerWidth - width - 20);
      setPosition({ x: initialX, y: 96 });
    }

    setHasRestoredLayout(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onResize = (): void => {
      setPosition((prev) => clampPosition(prev.x, prev.y));
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setPosition((prev) => clampPosition(prev.x, prev.y));
  }, [isMinimized]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasRestoredLayout) {
      return;
    }

    const payload: IndicatorLayout = {
      x: position.x,
      y: position.y,
      isMinimized
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures (e.g. private mode quotas).
    }
  }, [position, isMinimized, hasRestoredLayout]);

  const onDragStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const applyLiveTransform = (): void => {
    dragFrameRef.current = null;

    if (!containerRef.current) {
      return;
    }

    const next = livePositionRef.current;
    containerRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
  };

  const onDragMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const nextX = event.clientX - dragRef.current.offsetX;
    const nextY = event.clientY - dragRef.current.offsetY;
    livePositionRef.current = clampPosition(nextX, nextY);

    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(applyLiveTransform);
    }
  };

  const onDragEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setIsDragging(false);
    setPosition(livePositionRef.current);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed left-0 top-0 z-50 w-[min(360px,calc(100vw-1.5rem))] touch-none",
        isMinimized ? "w-[min(260px,calc(100vw-1.5rem))]" : null
      )}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
    >
      <div
        className={cn(
          "mb-2 flex cursor-grab items-center justify-between rounded-full border border-slate-200/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur active:cursor-grabbing",
          isDragging ? "ring-2 ring-indigo-300" : null
        )}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", statusTone(connectionState))} />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
            Connection
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={() => {
            setIsMinimized((prev) => !prev);
          }}
        >
          {isMinimized ? "展开" : "最小化"}
        </button>
      </div>

      {!isMinimized ? (
        <Panel
          eyebrow="Transport"
          title="Connection Health"
          description="XState 管理连接生命周期，Zustand 只消费稳定帧。"
          action={
            <span className="w-[120px] text-center rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
              {marketId}
            </span>
          }
        >
          <div className="grid gap-4">
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className={cn("h-3 w-3 rounded-full", statusTone(connectionState))} />
                  <div>
                    <p className="text-sm text-slate-500">WebSocket</p>
                    <p className="text-lg font-semibold text-slate-900">
                      {formatStatus(connectionState)}
                    </p>
                  </div>
                </div>
                <div className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600">
                  retry #{reconnectAttempt}
                </div>
              </div>
              {gap ? (
                <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  seq 缺口：expected {gap.expectedSeq} / received {gap.receivedSeq}
                </p>
              ) : null}
              {error ? <p className="mt-3 text-sm text-slate-500">{error}</p> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard label="Book msg/s" value={String(rates.bookPerSecond)} tone="bid" />
              <MetricCard label="Trade msg/s" value={String(rates.tradePerSecond)} tone="ask" />
              <MetricCard label="Last seq" value={String(lastSeq)} />
              <MetricCard
                label="Last pong"
                value={
                  lastPongAt
                    ? `${formatDistanceToNowStrict(lastPongAt, { addSuffix: true })}`
                    : "pending"
                }
              />
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "bid" | "ask";
}): React.ReactElement {
  const className =
    tone === "bid"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "ask"
        ? "border-amber-200 bg-amber-50"
        : "border-slate-200 bg-white/80";

  return (
    <div className={cn("rounded-3xl border p-4", className)}>
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
