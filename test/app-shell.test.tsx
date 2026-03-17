import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AppShell } from "@/components/app-shell";

vi.mock("@/components/connection-indicator", () => ({
  ConnectionIndicator: () => <div>ConnectionIndicator</div>
}));
vi.mock("@/components/order-panel", () => ({
  OrderPanel: ({ marketId }: { marketId: string }) => <div>OrderPanel:{marketId}</div>
}));
vi.mock("@/components/orderbook-panel", () => ({
  OrderbookPanel: ({ marketId }: { marketId: string }) => <div>OrderbookPanel:{marketId}</div>
}));
vi.mock("@/components/solana-transactions-panel", () => ({
  SolanaTransactionsPanel: ({ marketId }: { marketId: string }) => (
    <div>SolanaTransactionsPanel:{marketId}</div>
  )
}));
vi.mock("@/components/trade-tape", () => ({
  TradeTape: ({ marketId }: { marketId: string }) => <div>TradeTape:{marketId}</div>
}));
vi.mock("@/components/tv-chart", () => ({
  TVChart: ({ marketId, interval }: { marketId: string; interval: string }) => (
    <div>
      TVChart:{marketId}:{interval}
    </div>
  )
}));
vi.mock("@/components/websocket-provider", () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));
vi.mock("@/components/solana-stream-provider", () => ({
  SolanaStreamProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));
vi.mock("@/lib/hooks", () => ({
  useMidPrice: () => 123.45
}));

describe("AppShell", () => {
  it("renders core sections", () => {
    render(<AppShell />);

    expect(screen.getByText("Sonic Market Feed Service")).toBeInTheDocument();
    expect(screen.getByText("ConnectionIndicator")).toBeInTheDocument();
    expect(screen.getByText("OrderPanel:BTC-PERP")).toBeInTheDocument();
    expect(screen.getByText("OrderbookPanel:BTC-PERP")).toBeInTheDocument();
    expect(screen.getByText("TVChart:BTC-PERP:1m")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trade Stream" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Solana Transactions" })).toBeInTheDocument();
    expect(document.title).toBe("BTC-PERP 123.45 | Sonic Perps UI");
  });
});
