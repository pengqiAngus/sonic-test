"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ExternalLink } from "lucide-react";

import { Panel } from "@/components/panel";
import { useSolanaStream } from "@/lib/hooks";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SOLANA_STREAM_STATUS_BADGE_CLASS, SOLANA_STREAM_STATUS_LABEL } from "@/lib/const";
import type { MarketId } from "@/lib/types";

const MAX_PROGRAMS_VISIBLE = 3;
const ROW_HEIGHT = 56;
const EXPLORER_BASE_URL = "https://explorer.sonic.game/tx";

export function SolanaTransactionsPanel({ marketId }: { marketId: MarketId }): React.ReactElement {
  const { status, transactions, lastReorgAt, lastRollbackSlot, activeFilters } = useSolanaStream();
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => transactions[index]?.signature ?? index,
    overscan: 10
  });

  const statusText = useMemo(() => SOLANA_STREAM_STATUS_LABEL[status], [status]);

  return (
    <Panel
      eyebrow="Bonus"
      title="Recent Transactions (Solana Stream)"
      description="连接 /ws/stream，展示 signature / slot / fee / program IDs，并在 reorg 时回滚本地列表。"
      action={
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
            {marketId}
          </span>
          <span className={SOLANA_STREAM_STATUS_BADGE_CLASS[status]}>
            {statusText}
          </span>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>Transactions: {transactions.length}</span>
        {lastRollbackSlot !== null ? <span>Last rollback slot: {lastRollbackSlot}</span> : null}
        {lastReorgAt !== null ? (
          <span>Last reorg: {new Date(lastReorgAt).toLocaleTimeString()}</span>
        ) : null}
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Active Filters </span>
        <span>
          programs={activeFilters.programs.length > 0 ? activeFilters.programs.join(",") : "all"};
          accounts=
          {activeFilters.accounts.length > 0 ? activeFilters.accounts.join(",") : "all"}
        </span>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/80">
        <div className="grid grid-cols-[1.8fr_0.7fr_0.8fr_1.5fr] border-b border-slate-200 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          <span>Signature</span>
          <span className="text-right">Slot</span>
          <span className="text-right">Fee</span>
          <span className="text-right">Program IDs</span>
        </div>
        <div ref={parentRef} className="h-[360px] overflow-auto">
          {transactions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">等待交易流数据...</div>
          ) : (
            <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {rowVirtualizer.getVirtualItems().map((item) => {
                const tx = transactions[item.index];
                if (!tx) {
                  return null;
                }

                return (
                  <div
                    ref={rowVirtualizer.measureElement}
                    key={tx.signature}
                    className="absolute left-0 top-0 grid h-[56px] w-full grid-cols-[1.8fr_0.7fr_0.8fr_1.5fr] items-center border-b border-slate-100 px-4 text-sm"
                    style={{
                      height: `${item.size}px`,
                      transform: `translateY(${item.start}px)`
                    }}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate font-medium text-slate-800">{tx.signature}</span>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={8}>{tx.signature}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={`${EXPLORER_BASE_URL}/${tx.signature}`}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 rounded-md p-1 text-sky-700 transition hover:bg-sky-50 hover:text-sky-500"
                              aria-label={`Open ${tx.signature} in explorer`}
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={8}>在 Explorer 打开</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <span className="text-right tabular-nums text-slate-700">{tx.slot}</span>
                    <span className="text-right tabular-nums text-slate-700">
                      {tx.fee.toLocaleString()}
                    </span>
                    <div className="flex items-center justify-end gap-1 overflow-hidden text-slate-600">
                      {tx.programIds.slice(0, MAX_PROGRAMS_VISIBLE).map((programId) => (
                        <TooltipProvider key={programId}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="max-w-[90px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                                {programId}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent sideOffset={8}>{programId}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                      {tx.programIds.length > MAX_PROGRAMS_VISIBLE ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                                +{tx.programIds.length - MAX_PROGRAMS_VISIBLE}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent sideOffset={8}>
                              <div className="max-w-[360px] whitespace-pre-wrap break-all">
                                {tx.programIds.join("\n")}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
