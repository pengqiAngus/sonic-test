import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ConnectionIndicator } from "@/components/connection-indicator";
import { OrderPanel } from "@/components/order-panel";
import { OrderbookPanel } from "@/components/orderbook-panel";
import { SolanaTransactionsPanel } from "@/components/solana-transactions-panel";
import { TradeTape } from "@/components/trade-tape";
import { TVChart } from "@/components/tv-chart";

const { triggerMock, toastPromiseMock } = vi.hoisted(() => ({
  triggerMock: vi.fn().mockResolvedValue({ orderId: "o-1" }),
  toastPromiseMock: vi.fn(async (promise: Promise<unknown>) => promise)
}));

vi.mock("@/lib/hooks", () => ({
  useBookLevels: (side: "bids" | "asks") =>
    side === "bids" ? [{ price: 100, size: 1, total: 1 }] : [{ price: 101, size: 2, total: 2 }],
  useMidPrice: () => 100.5,
  useRecentTrades: () => [
    { tradeId: "t1", ts: 1_700_000_000_000, price: 100.12, size: 1.2345, side: "buy" as const }
  ],
  useSolanaStream: () => ({
    status: "open",
    statusReason: null,
    reconnectAttempt: 0,
    transactions: [
      {
        type: "transaction",
        signature: "sig-1",
        slot: 123,
        blockTime: null,
        fee: 10_000,
        computeUnitsConsumed: 1,
        err: null,
        accounts: [],
        programIds: ["prog-1", "prog-2", "prog-3", "prog-4"],
        instructions: [],
        seq: 1
      }
    ],
    lastReorgAt: null,
    lastRollbackSlot: null
  })
}));

vi.mock("@/store/market-store", () => ({
  useMarketStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      marketId: "BTC-PERP",
      connectionState: "open",
      reconnectAttempt: 1,
      lastSeq: 88,
      lastPongAt: Date.now() - 3_000,
      rates: { bookPerSecond: 4, tradePerSecond: 6 },
      gap: null,
      error: null,
      tradeVersion: 1,
      trades: [
        { tradeId: "tx", price: 100, size: 1, ts: Date.now(), side: "buy", marketId: "BTC-PERP" }
      ]
    })
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        size: 32,
        start: index * 32
      })),
    getTotalSize: () => count * 32,
    measureElement: vi.fn()
  })
}));

vi.mock("swr/mutation", () => ({
  default: () => ({
    trigger: triggerMock,
    isMutating: false
  })
}));

vi.mock("sonner", () => ({
  toast: {
    promise: toastPromiseMock
  }
}));

vi.mock("swr", () => ({
  default: () => ({
    data: { candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, trades: 1 }] },
    error: null,
    isLoading: false
  })
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "CandlestickSeries",
  ColorType: { Solid: "solid" },
  createChart: () => ({
    addSeries: () => ({
      setData: vi.fn(),
      update: vi.fn()
    }),
    timeScale: () => ({
      fitContent: vi.fn()
    }),
    remove: vi.fn()
  })
}));

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
});

describe("market components", () => {
  it("renders ConnectionIndicator", () => {
    render(<ConnectionIndicator />);
    expect(screen.getByText("Connection Indicator")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("submits OrderPanel", async () => {
    render(<OrderPanel marketId="BTC-PERP" />);
    const [priceInput, sizeInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(priceInput, { target: { value: "100.12" } });
    fireEvent.change(sizeInput, { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Limit Order" }));

    await waitFor(() => {
      expect(toastPromiseMock).toHaveBeenCalledTimes(1);
      expect(triggerMock).toHaveBeenCalledTimes(1);
    });
  });

  it("renders OrderbookPanel", () => {
    render(<OrderbookPanel marketId="BTC-PERP" />);
    expect(screen.getByText("Orderbook")).toBeInTheDocument();
    expect(screen.getByText("Best bid")).toBeInTheDocument();
    expect(screen.getByText("Best ask")).toBeInTheDocument();
  });

  it("renders TradeTape", () => {
    render(<TradeTape marketId="BTC-PERP" />);
    expect(screen.getByText("Trade Stream")).toBeInTheDocument();
    expect(screen.getByText("100.12")).toBeInTheDocument();
  });

  it("renders SolanaTransactionsPanel", () => {
    render(<SolanaTransactionsPanel marketId="BTC-PERP" />);
    expect(screen.getByText("Recent Transactions (Solana Stream)")).toBeInTheDocument();
    expect(screen.getByText("sig-1")).toBeInTheDocument();
  });

  it("renders TVChart with status", () => {
    render(<TVChart marketId="BTC-PERP" interval="1m" />);
    expect(screen.getByText("BTC-PERP · 1m · UTC+8")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
  });
});
