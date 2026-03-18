"use client";

import { startTransition, useEffect, useState } from "react";

import { ConnectionIndicator } from "@/components/connection-indicator";
import { OrderPanel } from "@/components/order-panel";
import { OrderbookPanel } from "@/components/orderbook-panel";
import { Panel } from "@/components/panel";
import { TradeTape } from "@/components/trade-tape";
import { SolanaTransactionsPanel } from "@/components/solana-transactions-panel";
import { TVChart } from "@/components/tv-chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SolanaStreamProvider } from "@/context/solana-stream-provider";
import { WebSocketProvider } from "@/context/websocket-provider";
import { useMidPrice } from "@/lib/hooks";
import type { CandleInterval, MarketId } from "@/lib/types";
import { SUPPORTED_MARKETS } from "@/lib/types";

const INTERVALS: CandleInterval[] = ["1s", "1m", "5m", "15m"];

// Main page shell: orchestrates modules and market/interval switching, not data computation.
export function AppShell(): React.ReactElement {
  const [marketId, setMarketId] = useState<MarketId>("BTC-PERP");
  const [interval, setInterval] = useState<CandleInterval>("1m");

  return (
    <main className="min-h-screen px-4 py-6 md:px-6 md:py-8 ">
      <div className="mx-auto flex w-full md:max-w-7xl flex-col gap-6">
        <header className="glass-panel rounded-[32px] px-6 py-6 md:px-8">
          <div className="flex flex-col gap-6">
            <h1 className="text-2xl font-semibold uppercase tracking-[0.24em] text-slate-500">
              Sonic Market Feed Service
            </h1>

            <div className="grid gap-3 sm:grid-cols-2 mb-5">
              <SelectorGroup label="Market">
                <Tabs
                  value={marketId}
                  onValueChange={(next) => {
                    if (SUPPORTED_MARKETS.includes(next as MarketId)) {
                      startTransition(() => setMarketId(next as MarketId));
                    }
                  }}
                  className="gap-2"
                >
                  <TabsList className="w-full justify-start">
                    {SUPPORTED_MARKETS.map((option) => (
                      <TabsTrigger key={option} value={option} className="px-3 py-1.5">
                        {option}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </SelectorGroup>

              <SelectorGroup label="Interval">
                <Tabs
                  value={interval}
                  onValueChange={(next) => {
                    if (INTERVALS.includes(next as CandleInterval)) {
                      startTransition(() => setInterval(next as CandleInterval));
                    }
                  }}
                  className="gap-2"
                >
                  <TabsList className="w-full justify-start">
                    {INTERVALS.map((option) => (
                      <TabsTrigger key={option} value={option} className="px-3 py-1.5">
                        {option}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </SelectorGroup>
            </div>
          </div>
        </header>

        {/* Recreate provider on market change to reset connections and local caches together */}
        <WebSocketProvider key={marketId} marketId={marketId}>
          <TabTitleSync marketId={marketId} />
          <ConnectionIndicator />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.7fr)]">
            <Panel title="TVChart + Live Candle Sync">
              <TVChart marketId={marketId} interval={interval} />
            </Panel>
            <OrderPanel marketId={marketId} />
          </div>
          <SolanaStreamProvider key={marketId}>
            <Tabs defaultValue="orderbook" className="gap-4">
              <TabsList variant="line" className="w-full justify-start rounded-2xl bg-white/80 p-2">
                <TabsTrigger value="orderbook" className="px-4 py-2">
                  Orderbook
                </TabsTrigger>
                <TabsTrigger value="trades" className="px-4 py-2">
                  Trade Stream
                </TabsTrigger>
                <TabsTrigger value="transactions" className="px-4 py-2">
                  Solana Transactions
                </TabsTrigger>
              </TabsList>
              {/* TabsContent mounts on demand; Solana stream stays subscribed at provider level and writes into store. */}
              <TabsContent value="orderbook">
                <OrderbookPanel marketId={marketId} />
              </TabsContent>
              <TabsContent value="trades">
                <TradeTape marketId={marketId} />
              </TabsContent>
              <TabsContent value="transactions">
                <SolanaTransactionsPanel marketId={marketId} />
              </TabsContent>
            </Tabs>
          </SolanaStreamProvider>
        </WebSocketProvider>
      </div>
    </main>
  );
}

function TabTitleSync({ marketId }: { marketId: MarketId }): null {
  const midPrice = useMidPrice();

  useEffect(() => {
    const priceText = midPrice !== null ? midPrice.toFixed(2) : "--";
    document.title = `${priceText} | ${marketId}`;
  }, [marketId, midPrice]);

  return null;
}

function SelectorGroup({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white/80 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
