import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { Providers } from "@/components/providers";
import { SolanaStreamProvider } from "@/components/solana-stream-provider";
import { WebSocketProvider } from "@/components/websocket-provider";

const sendMock = vi.fn();
const matchesMock = vi.fn().mockReturnValue(false);

vi.mock("@xstate/react", () => ({
  useMachine: () => [
    {
      value: "idle",
      context: { attempt: 0, reason: null },
      matches: matchesMock
    },
    sendMock
  ]
}));

vi.mock("swr", () => ({
  default: () => ({
    data: null,
    error: null,
    mutate: vi.fn()
  }),
  SWRConfig: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("sonner", () => ({
  Toaster: () => <div>Toaster</div>
}));

vi.mock("@/store/market-store", () => ({
  useMarketStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      resetMarket: vi.fn(),
      hydrateSnapshot: vi.fn(),
      applyFrame: vi.fn(),
      clearGap: vi.fn(),
      markGap: vi.fn(),
      markPong: vi.fn(),
      setMessageRates: vi.fn(),
      setConnectionState: vi.fn()
    })
}));

describe("provider components", () => {
  it("renders Providers children and toaster", () => {
    render(
      <Providers>
        <div>child</div>
      </Providers>
    );

    expect(screen.getByText("child")).toBeInTheDocument();
    expect(screen.getByText("Toaster")).toBeInTheDocument();
  });

  it("renders WebSocketProvider children", () => {
    render(
      <WebSocketProvider marketId="BTC-PERP">
        <div>ws child</div>
      </WebSocketProvider>
    );

    expect(screen.getByText("ws child")).toBeInTheDocument();
  });

  it("renders SolanaStreamProvider children", () => {
    render(
      <SolanaStreamProvider>
        <div>solana child</div>
      </SolanaStreamProvider>
    );

    expect(screen.getByText("solana child")).toBeInTheDocument();
  });
});
