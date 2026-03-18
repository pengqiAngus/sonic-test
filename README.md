# Sonic Perps UI

A Sonic perpetual market frontend built with Next.js, SWR, XState, Zustand, and Lightweight Charts.

## Architecture

- Page shell: `app/page.tsx` only mounts `AppShell`, while `components/app-shell.tsx` composes the chart, orderbook, trade stream, order panel, and layout sections.
- Market data pipeline (core): `context/websocket-provider.tsx` handles snapshot-first flow, WS lifecycle, sequential seq validation, gap detection, reset recovery, and message-rate metrics.
- Connection control plane: `lib/websocket-machine.ts` uses XState with `idle -> connecting -> open -> reconnecting -> gapDetected` to make retry backoff and gap-recovery flow explicit.
- Data persistence layer: `store/market-store.ts` stores bids/asks in `Map<number, number>`, keeps recent trades, and uses `bookVersion/tradeVersion` for precise recomputation.
- Read layer: `lib/hooks.ts` exposes `useBookLevels/useRecentTrades/useMidPrice` to keep UI read logic separate from store write logic.
- Chart and trading: `components/tv-chart.tsx` loads historical candles first, then merges live trades into the current candle; `components/order-panel.tsx` implements order form flow with `zod + react-hook-form + SWR mutation`.
- Solana stream: `context/solana-stream-provider.tsx` + `store/solana-stream-store.ts` independently manage `/ws/stream`, render transactions, and roll back local rows on `reorg` by `rollbackSlot`.

## Performance Decisions (What and Why)

- Snapshot-first before WS connect: builds a consistent local baseline before consuming deltas, preventing cold-start mismatch from polluting local book state.
- RAF batching + hidden-tab fallback: high-frequency messages are buffered per frame and committed once; hidden tabs use a short timeout fallback to avoid unbounded buffer growth.
- `Map` for orderbook storage: O(1) incremental updates/deletes for high-frequency level changes, with per-side level caps to control memory and scroll cost.
- Fine-grained subscription + `useDeferredValue`: UI only subscribes to required fields and defers expensive list consumption under high message rates.
- Virtualized lists: orderbook / trade tape / solana transactions all use `@tanstack/react-virtual` to keep DOM size bounded.
- Incremental chart updates: one-time `setData` for history and `series.update` for live data minimizes full-chart redraw overhead.

## Identified Bottlenecks

- `useBookLevels` still sorts the full side after each version update, which increases CPU pressure on very deep books.
- Frequent `tradeVersion` changes can drive frequent chart/list updates; higher throughput may require sampling layers or worker offloading.
- Solana transaction dedup currently uses array `some`, which degrades to O(n) checks as data volume grows.
- `lightweight-charts` dynamic import still has first-load initialization cost, noticeable under weak network conditions.
- Current tests focus on component rendering and key flow assertions; end-to-end stress coverage for high WS throughput is still limited.

## Scaling Strategy (10x Load)

- Upgrade book structure to ordered indexing + incremental insertion (e.g. price bucket + binary insertion / skip list) to avoid full re-sort each update.
- Move derived computations to Web Worker (`book levels`, `running total`, `trade aggregation`) and keep the main thread focused on rendering.
- Apply adaptive sampling for non-critical panels (30fps/15fps) while keeping critical paths (connection state, best bid/ask) real-time.
- Replace Solana dedup with `Set/Map` index (`signature -> index`) to reduce duplicate detection from O(n) toward O(1).
- Split provider/store (or actors) by market to reduce single-store write amplification and cross-panel coupling.
- Add edge caching/compression/prewarm for snapshot/candles endpoints to reduce cold-start and reconnect recovery latency.

## Trade-offs

- Dual providers (market WS + Solana WS) instead of a single bus improve isolation and readability, but increase connection and state-sync complexity.
- Mutable `Map` + `version` counters outperform pure immutable structures under high write rates, but debugging depends on understanding version-driven recomputation.
- Defensive API normalization (default filling and numeric normalization) improves frontend resilience, but can hide backend contract drift without extra observability.
- Priority is correctness and recoverability (`seq` consistency + reconnect recovery + responsive UI); deeper algorithmic optimization and workerization are intentionally deferred to control implementation complexity.
- Test scope currently prioritizes core component/provider behavior, and CI runs `lint + typecheck + test + build`; this favors delivery speed over heavier end-to-end test cost.

## Local Development

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run dev
```
