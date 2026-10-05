# 基本面数据服务端化设计文档（Worker /v1/fundamentals）

日期：2026-10-05
状态：已实现，待部署

## 背景与根因

用户反馈"很多基本面的数据都是空的"。诊断结论：

SERN 抽屉的 15 个基本面指标中，**5 个只有浏览器端 Yahoo `v10/quoteSummary` 能供应**：

| 字段 | 唯一来源 | 影响市场 |
|---|---|---|
| 自由现金流 FCF（及 fcfYield） | 仅 Yahoo | 全部 |
| 预期市盈率 Forward P/E | 仅 Yahoo | 非美股（美股有腾讯兜底） |
| PEG | 仅 Yahoo | 非美股 |
| 盈利/营收增速 | 仅 Yahoo | 非 A 股（A 股有同花顺兜底） |

而 `v10/quoteSummary` 是 Yahoo 封锁最严的端点：需要 A3 会话 cookie + crumb，且 `fc.yahoo.com` 不下发 CORS 头 → 浏览器跨域拿不到 cookie → crumb 无效 → 401/429。行情/走势不受影响（`v8/chart` 仍开放），但这 5 个字段全灭，池外股票（无批量预热）尤其明显。**浏览器端无解**（Yahoo 的政策），必须服务端化。

## 方案

### Worker：`GET /v1/fundamentals/:symbol`（src/lib/fundamentals.ts）

- 与 `/v1/search` 一样**直接接受 Yahoo 风格符号**（`AAPL` / `600519.SS` / `0700.HK` / `7203.T`），不经过 `normalizeSymbol` —— 覆盖全部市场，不受行情端点 SH/SZ/BJ/HK/US 限制（SERN 内部符号即 Yahoo 符号，零转换）。
- 服务端调 `v10/quoteSummary`（modules=`price,defaultKeyStatistics,financialData,summaryDetail`，带浏览器 UA）：
  1. **先试无 crumb**（部分边缘位置仅 UA 即放行）；
  2. 401/429/400 → **完整 cookie+crumb 流程**：`fc.yahoo.com` 取 `set-cookie` → `getcrumb` → 带 Cookie+crumb 重试；crumb isolate 级缓存，过期弃用；
  3. 总预算 6 秒（SERN 端 8 秒 AbortController 覆盖）。
- 字段归一化（snake_case）：`pe/forward_pe/pb/ps/ev_ebitda/peg/div_yield/roe/margin/fcf/fcf_yield/market_cap/earnings_growth/revenue_growth/debt_to_equity/currency/name`；比率小数形式与 Yahoo 一致；`fcf_yield = fcf / market_cap` 服务端推导；**负估值比率按缺失处理**（与 SERN 约定一致）。
- 错误：非法代码 400 `INVALID_SYMBOL`；代码不存在/空结果 404 `NOT_FOUND`；上游失败 502 `ALL_PROVIDERS_FAILED`。
- 测试：7 个 vitest 用例（无 crumb 直通、crumb 流程与跨请求缓存、负比率过滤、404/502/400、CORS）。

### SERN：链中插入 `stockapiFundamentals`（js/market-data.js）

- `QUOTE_SOURCES` 变为 `stockapi → tencent → eastmoney → tradingview → ths → stockapiFundamentals → yahoo`——批量源填完后，**剩余空字段优先问 Worker**，浏览器 Yahoo 仍作最后兜底。
- 沿用"只补空字段"逻辑与 `fetchStockapi`（8s 超时）；归因统一记 `stockapi`（来源标签不变）。
- 门控：`stockapiState === 'ready'` + 独立冷却键 `stockapi-fund`（基本面故障不影响报价预热链的 `stockapi` 冷却）；HTTP 错误（404/502）直接 fall through，网络错误才冷却。
- 不含 price/changePct（pair-or-nothing 约定：基本面部分不提供价格对）。

## 验证

- Worker：49 个 vitest 全绿，`tsc --noEmit` 干净。
- SERN：/tmp 回归扩展至 63 项（新增：fcf/fcfYield 由 fundamentals 填充、不覆盖 TV 的 evEbitda、fundamentals 502 时报价照常组装且 fcf 为 null、被墙时零 fundamentals 请求）全绿。
- 端到端（待部署后执行）：`curl stockapi.hinsyeow.org/v1/fundamentals/{AAPL,600519.SS,7203.T}` 三市场验证，浏览器抽屉确认 5 个字段恢复。

## 改动文件

**stockapi**：`src/lib/fundamentals.ts`（新）、`src/index.ts`（路由 + 手册）、`test/fundamentals.test.ts`（新）。

**SERN**：`js/market-data.js`（fundamentals 源 + 链序 + 冷却键 + `_test` 导出）、`index.html`/`markets.html`（`?v=20261005c`）、本文档。
