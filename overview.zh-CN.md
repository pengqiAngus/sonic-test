更新日期：2026 年 3 月 16 日
标签：TypeScript、React、WebSocket

## 目标

构建一个实时的 **Sonic 永续交易 UI**，并连接到 **Sonic Market Feed Service (SMFS)** 后端。

应用必须在保持界面响应性的同时，处理高频更新。

---

## 部署要求

- 代码必须托管在 **GitHub**
- 应用必须公开部署在 **Vercel**
- 需提供：
    - GitHub 仓库链接
    - 公开可访问的部署 URL
    - 使用的后端 API/WS URL（必须是下方 SMFS 端点）
- CI 必须在 GitHub Actions 运行：
    - lint
    - build
    - test（如适用）

---

## 数据源

你**必须**使用 Sonic Market Feed Service (SMFS) 作为数据源。不得使用第三方 API（如 Binance 等）。

### REST API

```
基础 URL: <https://interviews-api.sonic.game>
```

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/health` | GET | 服务器状态、可用市场、WebSocket URL |
| `/markets` | GET | 可用市场列表（BTC-PERP、SOL-PERP） |
| `/markets/:marketId/snapshot` | GET | 完整订单簿快照 + 最近成交 |
| `/markets/:marketId/candles` | GET | 用于图表的 OHLCV K 线数据（周期：`1s`、`1m`、`5m`、`15m`） |
| `/orders` | POST | 提交一笔模拟订单 |
| `/stats` | GET | 按市场的吞吐指标 + 已连接客户端数量 |

**API Explorer：** https://interviews-api.sonic.game/docs

包含 schema 的完整端点文档可在 API Explorer 中查看。你也可以参考 `/openapi.json` 的 OpenAPI 规范进行类型生成。

### 可用市场

SMFS 提供两个市场。你的应用应至少支持**一个**，但若支持两个并提供市场切换器可获得额外加分。

| 市场 | Base | Quote | 说明 |
| --- | --- | --- | --- |
| `BTC-PERP` | BTC | USDT | 比特币永续 |
| `SOL-PERP` | SOL | USDT | Solana 永续 |

价格与 Jupiter Price API 同步，反映真实的 Solana DEX 价格。

### 市场行情 WebSocket

```
wss://interviews-api.sonic.game/ws?marketId=BTC-PERP
```

`marketId` 查询参数用于选择订阅的市场。有效值：`BTC-PERP`、`SOL-PERP`。无效 `marketId` 会返回 HTTP 400。若省略则默认 `BTC-PERP`。

连接建立后，服务端会发送一条 `hello` 消息：

```json
{
  "type": "hello",
  "serverTime": 1710000000000,
  "marketId": "BTC-PERP"
}
```

**你将接收到的消息：**

| 类型 | 频率 | 说明 |
| --- | --- | --- |
| `book_delta` | 20-50/秒 | 订单簿更新，包含 `bids` 与 `asks` 数组。`size: 0` 表示移除该档位。 |
| `trade` | 5-20/秒 | 新成交，包含 `price`、`size`、`side`、`tradeId` |
| `pong` | 按请求 | 对 `ping` 的响应 |

**`book_delta` schema：**

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

**`trade` schema：**

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

- `seq` 在单个连接内**严格递增**——每条 delta 的 `seq` 都应比上一条大 1
- 若检测到序列缺口（例如收到 `seq` 45 紧接在 42 之后），需通过 `/markets/:marketId/snapshot` 拉取最新快照并重置本地订单簿状态
- `book_delta` 与 `trade` 消息都包含 `marketId` 字段，用于标识更新所属市场

**保活机制：** 定期发送 `{ "type": "ping" }`（建议每 15-30 秒）以维持连接。服务端会返回 `{ "type": "pong", "ts": ... }`。

### K 线数据（用于图表）

```
GET /markets/:marketId/candles?interval=1s&limit=3600
```

返回由实时成交聚合得到的 OHLCV K 线数据。用于在页面加载时填充历史图表，避免从空图开始。

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `interval` | 否 | `1s` | K 线周期：`1s`、`1m`、`5m`、`15m` |
| `limit` | 否 | `3600` | 返回的最大 K 线数量（最高 10000） |

**响应：**

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

K 线存储最多保留 1 小时成交历史。新的 K 线会由实时成交数据持续生成。

---

## 核心功能要求

### UI 组件

- **市场选择器**（在 BTC-PERP 与 SOL-PERP 间切换——仅支持单市场可接受，但多市场有加分）
- **订单簿**（买盘/卖盘，基于 delta 应用进行实时更新）
- **成交明细（Trade Tape）**（最近成交，流式更新）
- **下单面板**（通过 `POST /orders` 提交模拟订单）
- **连接状态指示器**（已连接/已断开/重连中）
- **消息速率展示**（每秒订单簿更新数与每秒成交数）

---

## 实时性要求

UI 必须能够处理：

- 每秒 20-50 次订单簿更新
- 每秒 5-20 次成交更新

界面必须保持响应：

- 不可出现明显输入延迟
- 不可出现整页重渲染风暴
- 不可出现闪烁

---

## 技术期望

至少体现以下 **三项**：

- 虚拟列表渲染（订单簿和/或成交明细）
- 批量状态更新（将渲染节流到 60fps 或更低）
- 细粒度状态订阅（仅数据变化的组件重渲染）
- 行渲染记忆化（`React.memo`、`useMemo` 或同类方案）
- 带指数退避的 WebSocket 重连处理
- 检测到序列缺口时的快照重置逻辑
- Ping/Pong 保活实现

---

## 加分项：Solana 交易流

SMFS 还提供实时 Solana 交易流。加分实现为添加一个 **“最近交易（Recent Transactions）”** 面板，要求：

- 连接 `wss://interviews-api.sonic.game/ws/stream`
- 展示最近交易：签名（signature）、slot、fee、program IDs
- 处理 `reorg` 事件（从展示中移除被回滚的交易）
- 将交易签名链接到 Solana 浏览器（例如 `https://explorer.sonic.game/tx/{signature}`）

这**不是必做项**，但可体现你对 SVM 生态的理解。

完整 `/ws/stream` 消息 schema 见 `/docs` 的 API explorer。

---

## 文档要求

README 必须包含：

- 架构说明
- 性能决策（你选了哪些优化以及原因）
- 已识别瓶颈
- 扩展策略（10 倍负载场景）
- 取舍说明

---

## 评估标准

| # | 类别 | 权重 | 关注点 |
| --- | --- | --- | --- |
| 1 | **实时工程能力** | 25% | WebSocket 生命周期（connect → hello → deltas → ping/pong）、序列缺口检测、快照重置、退避重连、正确应用 delta |
| 2 | **性能与优化** | 25% | 虚拟列表、批量更新、行记忆化、节流至 60fps、在 50 msg/s 下无卡顿、高效状态管理 |
| 3 | **架构与代码质量** | 15% | 清晰的数据/UI 分层、严格 TypeScript、模块化 hooks/stores、明确定义的消息类型、可复用组件 |
| 4 | **产品成熟度** | 10% | 必需组件齐全、连接指示器、消息速率展示、加载态、错误恢复、清晰视觉层级 |
| 5 | **Web3 / SVM 就绪度** | 10% | 集成 `/ws/stream` 加分项、理解 reorg 影响、能推理 slot 顺序、处理 `blockTime: null` |
| 6 | **文档** | 5% | README 5 个必需章节齐全（架构、性能、瓶颈、10 倍扩展、取舍） |
| 7 | **测试与 CI** | 5% | 有意义的测试覆盖、CI 流程通过、组件和/或集成测试 |
| 8 | **部署与生产可用性** | 5% | Vercel 稳定部署、响应式设计、无控制台报错、跨浏览器可用 |

---

## 提交内容

完成后请发送：

1. **GitHub 仓库 URL**（公开，或授权给指定 GitHub 用户）
2. **Vercel 部署 URL**

---

> **重要：** 在评审通话中，你可能会被要求：
>
> - 现场修改应用的一部分
> - 解释你的 WebSocket 重连策略
> - 演示连接中断时会发生什么
> - 实时添加一个新功能
