Updated: March 16, 2026
Tags: TypeScript, React, WebSocket

## Objective

Build a real-time **Sonic Perpetual Trading UI** that connects to the **Sonic Market Feed Service (SMFS)** backend.

The application must handle high-frequency updates while maintaining UI responsiveness.

---

## Deployment Requirements

- Code must be hosted on **GitHub**
- Application must be deployed publicly on **Vercel**
- Provide:
    - GitHub repository link
    - Public deployed URL
    - Backend API/WS URL used (must be the SMFS endpoints below)
- CI must run on GitHub Actions:
    - lint
    - build
    - test (if applicable)

---

## Data Source

You **must** use the Sonic Market Feed Service (SMFS) as your data source. Do not use third-party APIs (Binance, etc.).

### REST API

```
Base URL: <https://interviews-api.sonic.game>
```

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | GET | Server status, available markets, WebSocket URL |
| `/markets` | GET | List of available markets (BTC-PERP, SOL-PERP) |
| `/markets/:marketId/snapshot` | GET | Full order book snapshot + recent trades |
| `/markets/:marketId/candles` | GET | OHLCV candle data for charting (intervals: `1s`, `1m`, `5m`, `15m`) |
| `/orders` | POST | Submit a mock order |
| `/stats` | GET | Per-market throughput metrics + connected client count |

**API Explorer:** https://interviews-api.sonic.game/docs

Full endpoint documentation with schemas is available at the API explorer. You may also reference the OpenAPI spec at `/openapi.json` for type generation.

### Available Markets

The SMFS serves two markets. Your application should support **at least one**, but supporting both with a market selector earns additional credit.

| Market | Base | Quote | Description |
| --- | --- | --- | --- |
| `BTC-PERP` | BTC | USDT | Bitcoin perpetual |
| `SOL-PERP` | SOL | USDT | Solana perpetual |

Prices are synced from Jupiter Price API and reflect real Solana DEX prices.

### Market Feed WebSocket

```
wss://interviews-api.sonic.game/ws?marketId=BTC-PERP
```

The `marketId` query parameter selects which market to subscribe to. Valid values: `BTC-PERP`, `SOL-PERP`. An invalid `marketId` returns HTTP 400. Defaults to `BTC-PERP` if omitted.

Upon connection, the server sends a `hello` message:

```json
{
  "type": "hello",
  "serverTime": 1710000000000,
  "marketId": "BTC-PERP"
}
```

**Messages you will receive:**

| Type | Rate | Description |
| --- | --- | --- |
| `book_delta` | 20-50/sec | Order book updates with `bids` and `asks` arrays. `size: 0` = remove level. |
| `trade` | 5-20/sec | New trade with `price`, `size`, `side`, `tradeId` |
| `pong` | On request | Response to your `ping` |

**`book_delta` schema:**

```json
{
  "type": "book_delta",
  "marketId": "BTC-PERP",
  "ts": 1710000000000,
  "seq": 42,
  "bids": [{ "price": 65999.0, "size": 1.5 }],
  "asks": [{ "price": 66001.0, "size": 0.0 }]
}
```

**`trade` schema:**

```json
{
  "type": "trade",
  "marketId": "BTC-PERP",
  "ts": 1710000000000,
  "tradeId": "trd_123",
  "price": 66000.0,
  "size": 0.5,
  "side": "buy"
}
```

- `seq` is **monotonically increasing** per connection — each delta has `seq` exactly 1 greater than the previous
- If a gap is detected (e.g., you receive `seq` 45 after 42), fetch a fresh snapshot via `/markets/:marketId/snapshot` and reset your local book state
- Both `book_delta` and `trade` messages include a `marketId` field identifying which market the update belongs to

**Keepalive:** Send `{ "type": "ping" }` periodically (recommended every 15-30 seconds) to maintain the connection. The server responds with `{ "type": "pong", "ts": ... }`.

### Candle Data (for charting)

```
GET /markets/:marketId/candles?interval=1s&limit=3600
```

Returns OHLCV candle data aggregated from real-time trades. Use this to populate charts with historical data on load instead of starting with an empty chart.

| Param | Required | Default | Description |
| --- | --- | --- | --- |
| `interval` | No | `1s` | Candle interval: `1s`, `1m`, `5m`, `15m` |
| `limit` | No | `3600` | Max candles to return (up to 10000) |

**Response:**

```json
{
  "marketId": "BTC-PERP",
  "interval": "1m",
  "candles": [
    {
      "time": 1710000060,
      "open": 66000.0,
      "high": 66050.5,
      "low": 65980.0,
      "close": 66020.0,
      "volume": 12.5,
      "trades": 150
    }
  ]
}
```

The candle store keeps up to 1 hour of trade history. New candles are generated from live trades in real-time.

---

## Core Functional Requirements

### UI Components

- **Market selector** (switch between BTC-PERP and SOL-PERP — single market is acceptable but multi-market earns bonus)
- **Order book** (bids & asks, real-time updates via delta application)
- **Trade tape** (recent trades, streaming)
- **Order entry panel** (mock submit via `POST /orders`)
- **Connection status indicator** (connected/disconnected/reconnecting)
- **Message rate display** (book updates/sec and trades/sec)

---

## Real-Time Requirements

The UI must handle:

- 20–50 order book updates per second
- 5–20 trades per second

The interface must remain responsive:

- No noticeable input lag
- No full re-render storms
- No flickering

---

## Technical Expectations

Must demonstrate at least **THREE** of:

- Virtualized list rendering (order book and/or trade tape)
- Batched state updates (throttling renders to 60fps or less)
- Granular state subscriptions (components only re-render when their data changes)
- Memoized row rendering (React.memo, useMemo, or equivalent)
- WebSocket reconnect handling with exponential backoff
- Snapshot reset logic when sequence gaps are detected
- Ping/pong keepalive implementation

---

## Bonus: Solana Transaction Feed

The SMFS also exposes a real-time Solana transaction stream. For bonus credit, add a **"Recent Transactions"** panel that:

- Connects to `wss://interviews-api.sonic.game/ws/stream`
- Displays recent transactions with signature, slot, fee, and program IDs
- Handles `reorg` events (removes rolled-back transactions from the display)
- Links transaction signatures to a Solana explorer (e.g., `https://explorer.sonic.game/tx/{signature}`)

This is **NOT required** but demonstrates SVM ecosystem awareness.

See the API explorer at `/docs` for the full `/ws/stream` message schema.

---

## Documentation Requirements

README must include:

- Architectural explanation
- Performance decisions (which optimizations you chose and why)
- Bottlenecks identified
- Scaling strategy (10x load scenario)
- Tradeoffs made

---

## Evaluation Criteria

| # | Category | Weight | What We Look For |
| --- | --- | --- | --- |
| 1 | **Real-Time Engineering** | 25% | WebSocket lifecycle (connect → hello → deltas → ping/pong), sequence gap detection, snapshot reset, reconnection with backoff, correct delta application |
| 2 | **Performance & Optimization** | 25% | Virtualized lists, batched updates, memoized rows, throttling to 60fps, no jank under 50 msg/sec, efficient state management |
| 3 | **Architecture & Code Quality** | 15% | Clean data/UI separation, strict TypeScript, modular hooks/stores, well-defined message types, reusable components |
| 4 | **Product Maturity** | 10% | All required components present, connection indicator, message rate display, loading states, error recovery, clear visual hierarchy |
| 5 | **Web3 / SVM Readiness** | 10% | Integrates `/ws/stream` bonus, understands reorg implications, reasons about slot ordering, handles `blockTime: null` |
| 6 | **Documentation** | 5% | All 5 required README sections (architecture, performance, bottlenecks, 10x scaling, tradeoffs) |
| 7 | **Testing & CI** | 5% | Meaningful test coverage, CI pipeline passing, component and/or integration tests |
| 8 | **Deployment & Production** | 5% | Stable Vercel deployment, responsive design, no console errors, works across browsers |

---

## Submission

When complete, send us:

1. **GitHub repository URL** (public, or grant access to the provided GitHub username)
2. **Deployed Vercel URL**

---

> **Important:** During the review call, you may be asked to:
> 
> - Modify part of the application live
> - Explain your WebSocket reconnection strategy
> - Demonstrate what happens when the connection drops
> - Add a new feature in real-time