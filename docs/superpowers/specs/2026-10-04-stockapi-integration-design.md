# StockAPI 集成设计

日期：2026-10-04
状态：设计已确认，待实施

## 背景与目标

将用户自建的行情聚合服务 **StockAPI**（Cloudflare Worker，`https://stockapi.hinsyeow.org`，2026-10-05 起绑定自有域名，原 `stockapi.hinsyeow.workers.dev` 继续可用）集成进 SERN markets 页面（原 rankings，已随本次改名）的多源降级链，作为覆盖市场的**最高优先级**价格 / K 线来源。现有 5 个数据源全部保留为后备，不删除、不改变既有降级逻辑。

StockAPI 由用户维护，源码位于 `/Users/hins/Project/stockapi`（Hono + TypeScript on Cloudflare Workers），上游为东方财富 + Yahoo Finance 自动切换。

## 实测结论（2026-10-04）

| 项 | 结论 |
|---|---|
| `GET /v1/quote?symbols=` | 批量，≤20 个/次，混合市场；字段 `price / pre_close / change_pct / currency / ts / source`；**无估值与基本面字段** |
| `GET /v1/kline/:symbol` | `period=daily&adjust=qfq&limit=60` 可用；candles 时间升序，含 `close` |
| 指数 | `000300.SH` 成功；`^GSPC` 400（插入符不支持）。图表链不需要它（东财单请求已覆盖全部 5 个指数） |
| 覆盖面 | universe 136 只中 **126 只可用**（美 85 + A 25 + 港 16）；JP/KR/TW/EU 共 10 只不覆盖 |
| 字段口径 | `change_pct` 为百分比数值（`1.0202` = 1.02%），使用时除以 100 |
| CORS | ❌ **Worker 未设置 CORS 头**，浏览器 fetch 会被拦截 —— 必须先在 Worker 侧添加 |
| 网络 | 开发者本机无法直连 `*.workers.dev`（TLS 被阻断）；用户浏览器可访问（代理）。所有防护机制必须按"可能不可达"设计 |

## 前置改动（stockapi 仓库）

1. `src/index.ts` 添加 Hono CORS 中间件：`import { cors } from "hono/cors"`，`app.use("*", cors())`。公开只读 API，允许任意来源（`*`）。
2. 新增 vitest 用例验证：带 `Origin` 的 GET 响应含 `access-control-allow-origin`；`OPTIONS` 预检返回成功。用 Hono `app.request()` 离线测试，不需要网络。
3. `npm run deploy` 部署生效（部署动作需用户确认）。

## SERN 侧设计（js/market-data.js）

### 符号映射 `stockapiSymbol(symbol)`

| 内部格式 | StockAPI 请求 | 说明 |
|---|---|---|
| `AAPL`、`BRK-B` | 原样 | 其归一化器支持点号与连字符 |
| `600519.SS` | `600519.SH` | |
| `000001.SZ` | `000001.SZ` | |
| `0700.HK` | `00700.HK` | 复用 `hkPad` 补足 5 位 |
| `.T/.KS/.TW/.PA/.DE` | `null` | 不覆盖，直接跳过 |

### 可用性状态机（会话级）

因为"连不上 workers.dev"是开发者本机的现实场景，必须按不可达设计：

- 状态：`'unknown' | 'ready' | 'down'`（会话级变量；`unknown` 仅为预热未结束的瞬时态）
- 预热在 prefetch 中发起，**不加入 `batchReady` 关键路径**（同 THS 模式，fire-and-forget），每请求 `AbortController` 8 秒超时（须覆盖 Worker 自身最坏情况：2 个上游 × 3 秒 + 开销 ≈ 6.5s）
- 预热按 20 个/块、并发 3；**中途不做判定**，整块序列结束后统一收敛：有任何成功 → `ready`；零成功（网络被阻断或上游全灭）→ `down`；已 `ready` 的会话不会被单次瞬时重热失败降级（其余符号快照仍然有效）
- `down` 状态下所有 stockapi 逻辑瞬时跳过，页面加载速度与现状完全一致
- `clearCache()` 重置状态并重新预热；`refreshQuote()` 在 `down` 时重置为 `unknown` 并 fire-and-forget 单符号探测，恢复后自动回到 `ready`

（以上语义为对抗性审查后的修订版：初版"首块失败立即置 down 并跳过剩余块"会把进行中块的成功成果 stranded，且 4s 超时短于 Worker 最坏情况会误伤慢而健康的服务。）

### 行情链接入

```
QUOTE_SOURCES: stockapi → tencent → eastmoney → tradingview → ths → yahoo
```

- `quoteFrom('stockapi')` **只读预热好的快照，不逐 symbol 懒加载**（避免冷启动竞态卡顿）；状态非 `ready` 直接返回 null
- 贡献字段仅 `price` + `changePct`（`change_pct / 100`，两个字段同源自洽）；PE/PB/成长等由后续源按现有 field-level fill 补齐
- 竞态说明：预热未完成时行情走原链，完全可接受（数据是每日缓存，值来自同上游）

### Sparkline 链接入

```
getSpark: stockapi kline → eastmoney → tencent(ifzq) → yahoo
```

- `/v1/kline/:symbol?period=daily&adjust=qfq&limit=60` → `candles[].close`
- 仅状态 `ready` 时尝试；覆盖市场之外（JP/KR/TW/EU）直接走原链
- 逐 symbol 懒加载（与现有 spark 模式一致），结果按现有日缓存存入 localStorage
- 单 symbol 的 HTTP 错误（400/502）只是回退，不标记源故障；网络级失败（abort/断连）走现有 `markDown` 60 秒冷却

### 配套改动

- `sourceDownUntil` 增加 `stockapi` 键；`clearCache()` 清空 `stockapiSnapshots` 并重置状态
- i18n：新增 `source.stockapi`（en `StockAPI` / zh `StockAPI`）；顺带修正 `method.p6` 两语言文案（现文案已过时：漏 THS、写"缓存 30 分钟"实为每日 06:00 滚动）
- `_test` 暴露纯函数：`stockapiSymbol`、`parseStockapiQuotes`、`parseStockapiKline`，供 /tmp Node 校验脚本使用
- 模块顶部降级链注释同步更新

### 不做

- 图表（指数）接入：东财单请求已覆盖全部指数，StockAPI 仅支持 A 股指数，无收益
- 基本面端点：StockAPI 目前没有，属 Worker 后续 roadmap（估值排行页最缺的是基本面兜底）
- yahoo-finance2：用户已确认不做（StockAPI 已在服务端聚合 Yahoo，同数据更稳）

## 测试与验收

1. **解析层（可在本机完成）**：/tmp Node 脚本用今日实测抓取的真实响应 + 合成用例（部分失败 item、HK 补位、change_pct 换算、candles→closes）校验 `_test` 纯函数
2. **Worker 侧（可在本机完成）**：`npm test`（含新增 CORS 用例）、`npm run typecheck`
3. **端到端成功路径**：Worker 部署后，用户在浏览器打开 markets 页面验证 —— 抽屉数据源标签出现 StockAPI、价格正确、sparkline 渲染、控制台无报错
4. **端到端降级路径**：开发者本机浏览器（连不上 workers.dev）验证 —— 页面与现状一致、预热在后台静默放弃（≤ 两轮 8s 超时，均在关键路径之外）、控制台无 CORS 报错、无加载延迟

## 风险

| 风险 | 缓解 |
|---|---|
| workers.dev 在国内被阻断 | 已按不可达设计（预热零成功后置 down + 会话级跳过，均在后台）；**2026-10-05 已绑定自有域名 stockapi.hinsyeow.org，该阻断不再影响**，状态机继续兜底其他不可达网络 |
| Worker 未部署 CORS 前浏览器必失败 | 部署顺序：先改 Worker + 部署，再验收 SERN 侧 |
| StockAPI 无估值字段，贡献有限 | 定位即"价格/K 线一级源"；基本面仍走现有链，后续可在 Worker 加基本面端点 |
