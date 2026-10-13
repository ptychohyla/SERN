# 市场页行业分类、股票池与每日成交额热度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把市场页硬编码的 11 个 GICS 大类换成 31 个申万一级行业（全球通用），股票池按「市场 × 行业」维护龙头白马蓝筹，并新增「池内按当日成交额排序」的每日热度层；同时给 stockapi 加批量基本面端点，把冷启动请求量从 O(股票数) 降到 O(股票数/20)。

**Architecture:** 行业表与股票池是纯静态 JS 数据文件（方案 A），带 `generatedAt`，每周重新生成并提交；消费方（heatmap / markets / scoring / i18n）做 `sector` → `industry` 的机械迁移，不引入构建步骤或依赖。每日热度层（方案 A+）复用已有的 `/v1/quote` 批量预热返回的 `amount`，不新增请求。stockapi 侧新增 `GET /v1/fundamentals?symbols=` 批量端点，复用单股解析逻辑加一层有界并发。

**Tech Stack:** 浏览器原生 JS（IIFE + `'use strict'`，无框架/无构建）；stockapi 为 Hono on Cloudflare Workers + stock-sdk + vitest。

**Spec:** `docs/superpowers/specs/2026-10-14-market-industry-universe-design.md`

## Global Constraints

- **行业口径**：31 个申万一级行业，代码取自 stock-sdk 行业板块列表（`BKxxxx`），全球股票统一使用——行业分类描述公司主营业务，与上市市场无关。
- **纯静态、无构建**：不引入包管理清单、构建步骤或第三方前端依赖；`stockapi` 的既有 npm 脚本（`test` / `typecheck`）不算新增。
- **代码风格**：HTML / CSS / JS 一律 2 空格缩进；JS 保持现有 IIFE + `'use strict'`；HTML/CSS 类名用短横线（kebab-case）。
- **版本号**：任何 `js/*` 改动后，同步递增 `index.html` 与 `markets.html` 中所有 `?v=YYYYMMDD` 版本号，本次目标 `?v=20261014`。
- **stockapi 批量上限硬编码 20**：Cloudflare 免费版 50 子请求/请求；最坏路径 20×2 + 2（cookie + crumb）= 42 < 50，不得提高。
- **stockapi 注释/提交/文档一律中文**；改端点必须同步更新 `src/index.ts` 内嵌中文手册。
- **本次是机械迁移**：不改评分权重、不改布局算法、不改行情/K 线链路。股票池从 151 扩到 180–200 只属**另一份计划**。
- **不在本次范围**：策略公式展示、`js/scoring.js` 权重修复、`js/scoring.js.backup` 清理、`js/i18n.js` 末尾无效注释块（另见 spec §11）。

---

## 开工前必读：工作区未提交改动

执行本计划前，先确认工作区状态：

```bash
cd /Users/hins/Project/SERN
git status --short
```

基线提交是 `5833775`。若看到以下**与本计划无关**的未提交改动，先单独处理（提交或 `git stash`），不要混进本计划的任务提交：

- `M css/style.css`、`M js/i18n.js`、`M js/scoring.js`、`M markets.html`（策略公式/评分的半成品改动）
- `?? js/scoring.js.backup`

原因：本计划 Task 4/5 也要改 `js/scoring.js`、`js/i18n.js`、`markets.html`。如果带着这些半成品改动开工，任务级 `git add <文件>` 会把它们一起提交，导致每个 commit 都混入无关内容、审查时无法判断改动边界。建议先 `git stash push css/style.css js/i18n.js js/scoring.js markets.html`，把 `js/scoring.js.backup` 删掉或单独归档，再开始 Task 1。

---

## File Structure

**stockapi（/Users/hins/Project/stockapi）**
- Modify `src/lib/fundamentals.ts` — 抽出内部单股函数，新增批量导出。
- Modify `src/index.ts` — 注册 `/v1/fundamentals` 批量路由（**必须在 `/v1/fundamentals/:symbol` 之前**），并补中文手册条目。
- Modify `test/fundamentals.test.ts` — 新增 4 个批量用例。

**SERN（/Users/hins/Project/SERN）**
- Create `js/data/industries.js` — 31 个一级行业表 + `name(code, lang)`。
- Modify `js/data/universe.js` — `sector` → `industry`（BK 代码）+ `universeGeneratedAt`。
- Modify `js/heatmap.js` — 分组字段改 `industry`，标签走 `industries.name()`。
- Modify `js/markets.js` — 行业标签/配色/图例、收藏与外部 bucket 字段、`industryName()`、每日热度排序。
- Modify `js/scoring.js` — `groupKey()` 读 `industry`；`scope: 'sector'` → `'industry'`（仅改名）。
- Modify `js/i18n.js` — 删 `sector.*`，加 `industry.favorites`，`dist.by-sector` → `dist.by-industry`。
- Modify `js/market-data.js` — 批量基本面解析 + 分批预热；`amount` 透传到快照。
- Modify `markets.html` — 新增 `industries.js` 引用（在 `universe.js` 之前）、`data-i18n` 改名、版本号。
- Modify `index.html` — 仅版本号。
- Modify `AGENTS.md` — 修正「基本面按需拉取」为批量端点；补每日热度说明。

---

## Phase 1 — stockapi 批量基本面端点

### Task 1: `/v1/fundamentals` 批量端点

**Files:**
- Modify: `/Users/hins/Project/stockapi/src/lib/fundamentals.ts`
- Modify: `/Users/hins/Project/stockapi/src/index.ts`
- Test: `/Users/hins/Project/stockapi/test/fundamentals.test.ts`

**Interfaces:**
- Consumes: 现有的 `fetchFundamentals(symbol)`、`getCrumbAuth`、`qsFetch`、`crumbCache`、`Fundamentals`、`FundamentalsNotFound`。
- Produces:
  - `export const MAX_FUNDAMENTALS_BATCH = 20`
  - `export type FundamentalsBatchItem = Fundamentals | { symbol: string; error: string }`
  - `export async function fetchFundamentalsBatch(symbols: string[]): Promise<FundamentalsBatchItem[]>`（顺序与入参一致）
  - `export function toYahooSymbolLoose(symbol: string): string`

- [ ] **Step 1: 写失败的测试**

在 `test/fundamentals.test.ts` 末尾（`describe("GET /v1/fundamentals/:symbol", ...)` 的**后面**）追加一个新 describe：

```ts
describe("GET /v1/fundamentals（批量）", () => {
  it("返回顺序与入参一致，部分失败内嵌 error 且整体 200", async () => {
    stubFetch(async (url) => {
      if (url.includes("quoteSummary")) {
        if (url.includes("BAD1")) {
          return jsonResponse({ quoteSummary: { result: null, error: { code: 404 } } }, 404);
        }
        if (url.includes("BAD2")) return jsonResponse({}, 500);
        return jsonResponse(QS_AAPL);
      }
      throw new Error("unexpected " + url);
    });
    const res = await app.request("/v1/fundamentals?symbols=AAPL,BAD1,MSFT,BAD2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.map((d: any) => d.symbol)).toEqual(["AAPL", "BAD1", "MSFT", "BAD2"]);
    expect(body.data[0].name).toBe("Apple Inc.");
    expect(body.data[1].error).toBe("NOT_FOUND");
    expect(body.data[2].name).toBe("Apple Inc.");
    expect(body.data[3].error).toBe("ALL_PROVIDERS_FAILED");
  });

  it("超过 20 个代码 → 400", async () => {
    const symbols = Array.from({ length: 21 }, (_, i) => `SYM${i}`);
    const res = await app.request("/v1/fundamentals?symbols=" + symbols.join(","));
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("INVALID_PARAMETER");
  });

  it("缺少 symbols 参数 → 400", async () => {
    const res = await app.request("/v1/fundamentals");
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("INVALID_PARAMETER");
  });

  it("crumb 全批次只取一次，且并发不超过 5", async () => {
    let inFlight = 0;
    let peak = 0;
    let cookieCalls = 0;
    stubFetch(async (url) => {
      if (url.includes("fc.yahoo.com")) {
        cookieCalls++;
        return new Response("", { status: 200, headers: cookieHeaders() });
      }
      if (url.includes("getcrumb")) return new Response("crumbABC123", { status: 200 });
      if (url.includes("quoteSummary")) {
        if (!url.includes("crumb=")) return jsonResponse({}, 401);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return jsonResponse(QS_AAPL);
      }
      throw new Error("unexpected " + url);
    });
    const symbols = Array.from({ length: 20 }, (_, i) => `SYM${i}`);
    const res = await app.request("/v1/fundamentals?symbols=" + symbols.join(","));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(20);
    expect(body.data.every((d: any) => d.name === "Apple Inc.")).toBe(true);
    expect(cookieCalls).toBe(1);
    expect(peak).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd /Users/hins/Project/stockapi && npx vitest run test/fundamentals.test.ts`
Expected: 新增 4 个用例 FAIL（`/v1/fundamentals?symbols=...` 命中 `:symbol` 路由或返回 404）；既有 7 个单股用例 PASS。

- [ ] **Step 3: 重构 `src/lib/fundamentals.ts`，抽出单股内部函数**

把文件末尾的 `export async function fetchFundamentals(symbol: string): Promise<Fundamentals> { ... }` **整段替换**为下面内容（解析逻辑逐字保留，只改结构）：

```ts
/** 规范化到 Yahoo 形态；无法归一化的输入按 Yahoo 风格原样返回 */
export function toYahooSymbolLoose(symbol: string): string {
  try {
    return toYahooSymbol(normalizeSymbol(symbol));
  } catch {
    /* 不是规范代码：按 Yahoo 风格原样查询 */
    return symbol;
  }
}

/** 携带上游 HTTP 状态的错误，供批量层区分「需要 crumb」与「真失败」 */
class UpstreamHttpError extends Error {
  constructor(readonly status: number) {
    super(`quoteSummary HTTP ${status}`);
    this.name = "UpstreamHttpError";
  }
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 429 || status === 400;
}

/** 把一条 quoteSummary 响应解析为 Fundamentals（原 fetchFundamentals 的解析段） */
function parseFundamentals(
  yahooSymbol: string,
  json: { quoteSummary?: { result?: Record<string, unknown>[]; error?: { code?: unknown } | null } },
): Fundamentals {
  const data = json?.quoteSummary?.result?.[0];
  if (!data) {
    const code = json?.quoteSummary?.error?.code;
    if (code === 404 || code === "404" || code === "Not Found") throw new FundamentalsNotFound(yahooSymbol);
    throw new Error("quoteSummary empty result");
  }
  const price = (data.price ?? {}) as Record<string, unknown>;
  const stats = (data.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const fin = (data.financialData ?? {}) as Record<string, unknown>;
  const detail = (data.summaryDetail ?? {}) as Record<string, unknown>;

  const marketCap = raw(price, "marketCap");
  const fcf = raw(fin, "freeCashflow");
  // P/S: Yahoo 在部分代码上把它放在 summaryDetail 而非 defaultKeyStatistics
  // （2026-10-05 边缘实测 AAPL/600519.SS/7203.T 均如此）；两处都没有时按
  // 定义用 marketCap / totalRevenue(TTM) 计算
  const totalRevenue = raw(fin, "totalRevenue");
  let ps =
    raw(stats, "priceToSalesTrailing12Months") ?? raw(detail, "priceToSalesTrailing12Months");
  if (ps === undefined && marketCap && totalRevenue) ps = marketCap / totalRevenue;
  return {
    symbol: yahooSymbol,
    name:
      typeof price.longName === "string"
        ? price.longName
        : typeof price.shortName === "string"
          ? price.shortName
          : undefined,
    pe: nonNegative(raw(detail, "trailingPE") ?? raw(stats, "trailingPE")),
    forward_pe: nonNegative(raw(stats, "forwardPE")),
    pb: nonNegative(raw(stats, "priceToBook")),
    ps,
    ev_ebitda: nonNegative(raw(stats, "enterpriseToEbitda")),
    peg: nonNegative(raw(stats, "pegRatio")),
    div_yield: nonNegative(
      raw(detail, "dividendYield") ?? raw(detail, "trailingAnnualDividendYield"),
    ),
    roe: raw(fin, "returnOnEquity"),
    margin: raw(fin, "profitMargins"),
    fcf,
    fcf_yield: fcf !== undefined && marketCap ? fcf / marketCap : undefined,
    market_cap: marketCap,
    earnings_growth: raw(fin, "earningsGrowth"),
    revenue_growth: raw(fin, "revenueGrowth"),
    debt_to_equity: raw(fin, "debtToEquity"),
    currency: typeof price.currency === "string" ? price.currency : undefined,
  };
}

/** 已拿到 auth（可为 null）时请求并解析一个 symbol */
async function fetchOne(
  yahooSymbol: string,
  auth: CrumbAuth | null,
  signal: AbortSignal,
): Promise<Fundamentals> {
  const res = await qsFetch(yahooSymbol, auth, signal);
  if (res.status === 404) throw new FundamentalsNotFound(yahooSymbol);
  if (!res.ok) throw new UpstreamHttpError(res.status);
  const json = (await res.json()) as {
    quoteSummary?: { result?: Record<string, unknown>[]; error?: { code?: unknown } | null };
  };
  return parseFundamentals(yahooSymbol, json);
}

/** 单股：保留原有的「裸试 → 401/429/400 再走 cookie+crumb」行为 */
export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const yahooSymbol = toYahooSymbolLoose(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  try {
    // 先试无 crumb（部分边缘位置仅带 UA 即放行），401/429/400 再走完整流程
    try {
      return await fetchOne(yahooSymbol, null, controller.signal);
    } catch (e) {
      if (!(e instanceof UpstreamHttpError) || !isAuthStatus(e.status)) throw e;
    }
    let auth: CrumbAuth;
    try {
      auth = await getCrumbAuth(controller.signal);
    } catch (e) {
      crumbCache = null; // 缓存失效时下次重建
      throw e;
    }
    try {
      return await fetchOne(yahooSymbol, auth, controller.signal);
    } catch (e) {
      if (e instanceof UpstreamHttpError && isAuthStatus(e.status) && crumbCache) {
        // crumb 过期：弃缓存，等下一次请求重建（本次不再重试，控制时延）
        crumbCache = null;
      }
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 批量上限：Cloudflare 免费版 50 子请求/请求；最坏 20×2 + 2（cookie+crumb）= 42 */
export const MAX_FUNDAMENTALS_BATCH = 20;
/** 批次内并发：比前端 8 更保守，降低被 Yahoo 限流的概率 */
const BATCH_CONCURRENCY = 5;

export type FundamentalsBatchItem = Fundamentals | { symbol: string; error: string };

/** 有界并发 map：保序写回结果 */
async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/**
 * 批量基本面：整批共享一次 cookie+crumb，逐项独立成败。
 * 部分失败不降级为 5xx——与 /v1/quote 的契约对齐。
 */
export async function fetchFundamentalsBatch(
  symbols: string[],
): Promise<FundamentalsBatchItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  try {
    const yahoo = symbols.map(toYahooSymbolLoose);
    const out: FundamentalsBatchItem[] = new Array(yahoo.length);

    // 决定 auth：有缓存直接用；否则用首只裸试探测，仅 401/429/400 时取一次 crumb。
    // 探测成功的结果直接复用，避免重复请求。
    let auth: CrumbAuth | null = crumbCache;
    let probed: Fundamentals | null = null;
    if (!auth && yahoo.length) {
      try {
        probed = await fetchOne(yahoo[0], null, controller.signal);
      } catch (e) {
        if (e instanceof UpstreamHttpError && isAuthStatus(e.status)) {
          try {
            auth = await getCrumbAuth(controller.signal);
          } catch {
            crumbCache = null;
            auth = null;
          }
        }
        // 其它错误（404 / 5xx）不阻断整批：下面逐项再取一次并各自报错
      }
    }

    let sawAuthFailure = false;
    await mapLimit(yahoo, BATCH_CONCURRENCY, async (ys, i) => {
      if (i === 0 && probed) {
        out[0] = probed;
        return;
      }
      try {
        out[i] = await fetchOne(ys, auth, controller.signal);
      } catch (e) {
        if (e instanceof UpstreamHttpError && isAuthStatus(e.status)) sawAuthFailure = true;
        out[i] = {
          symbol: ys,
          error: e instanceof FundamentalsNotFound ? "NOT_FOUND" : "ALL_PROVIDERS_FAILED",
        };
      }
    });

    // 缓存的 crumb 已失效：整批弃缓存，下次请求重建
    if (sawAuthFailure && crumbCache) crumbCache = null;

    return out;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: 在 `src/index.ts` 注册批量路由（必须在 `:symbol` 路由之前）**

先在 import 行补上批量函数与上限常量：

```ts
import {
  fetchFundamentals,
  fetchFundamentalsBatch,
  FundamentalsNotFound,
  MAX_FUNDAMENTALS_BATCH,
} from "./lib/fundamentals";
```

再把 `const FUND_SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,20}$/;` 这行**上移**到 `// 基本面指标：...` 注释块之后、批量路由之前，然后**紧接在单股路由 `app.get("/v1/fundamentals/:symbol", ...)` 之前**插入批量路由：

```ts
// 批量基本面：一次最多 20 个代码，整批共享 cookie+crumb，逐项独立成败。
// 注意：本路由必须注册在 /v1/fundamentals/:symbol 之前，否则会被路径参数路由吞掉。
app.get("/v1/fundamentals", async (c) => {
  const raw = c.req.query("symbols");
  if (!raw) {
    return c.json(
      {
        error: {
          code: "INVALID_PARAMETER",
          message: "缺少 symbols 参数，示例：?symbols=AAPL,600519.SS",
        },
      },
      400,
    );
  }
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_FUNDAMENTALS_BATCH) {
    return c.json(
      {
        error: {
          code: "INVALID_PARAMETER",
          message: `symbols 数量须为 1-${MAX_FUNDAMENTALS_BATCH}`,
        },
      },
      400,
    );
  }
  for (const p of parts) {
    if (!FUND_SYMBOL_RE.test(p)) {
      return c.json(
        { error: { code: "INVALID_SYMBOL", message: `代码格式非法：${p}` } },
        400,
      );
    }
  }
  const data = await fetchFundamentalsBatch(parts);
  return c.json({ data });
});
```

- [ ] **Step 5: 更新内嵌中文手册**

在 `src/index.ts` 的 `usagePage` 里，`<h2>GET /v1/fundamentals/:symbol — 基本面指标</h2>` 这一节的**前面**插入：

```html
<h2>GET /v1/fundamentals — 批量基本面指标</h2>
<p>一次最多 20 个代码，逗号分隔，可混合市场。整批共享一次 cookie + crumb，逐项独立成败；<strong>部分失败返回 HTTP 200</strong>，失败项内嵌 <code>error</code>（与 <code>/v1/quote</code> 契约一致）：</p>
<pre>curl '${origin}/v1/fundamentals?symbols=600519.SS,AAPL,0700.HK'</pre>
<pre>{
  "data": [
    { "symbol": "600519.SS", "name": "Kweichow Moutai Co., Ltd.", "pe": 20.1, "market_cap": 1580000000000 },
    { "symbol": "AAPL", "name": "Apple Inc.", "pe": 31.2, "market_cap": 5000000000000 },
    { "symbol": "0700.HK", "error": "ALL_PROVIDERS_FAILED" }
  ]
}</pre>
<p>字段与单股端点完全一致；数量为空或超过 20 返回 400。需要单只股票的抽屉/详情时仍可用 <code>/v1/fundamentals/:symbol</code>。</p>
```

同时在「错误码」表里把 `INVALID_PARAMETER` 一行的说明补上批量基本面：

```html
<tr><td>400</td><td>INVALID_PARAMETER</td><td>参数缺失或非法（symbols 为空/超过 20 个、period 或 adjust 取值错误等）</td></tr>
```

- [ ] **Step 6: 跑测试与类型检查**

Run: `cd /Users/hins/Project/stockapi && npx vitest run test/fundamentals.test.ts && npx tsc --noEmit`
Expected: 13 个用例全 PASS（9 旧 + 4 新）；`tsc` 无输出。

- [ ] **Step 7: 提交**

```bash
cd /Users/hins/Project/stockapi
git add src/lib/fundamentals.ts src/index.ts test/fundamentals.test.ts
git commit -m "feat: 新增 /v1/fundamentals 批量端点"
```

---
## Phase 2 — SERN 静态行业表与股票池

### Task 2: 新增 `js/data/industries.js` 行业表

**Files:**
- Create: `/Users/hins/Project/SERN/js/data/industries.js`
- Modify: `/Users/hins/Project/SERN/markets.html`（脚本引用）

**Interfaces:**
- Produces:
  - `window.SERN.industries.list` — `Array<{code:string, zh:string, en:string}>`（31 项）
  - `window.SERN.industries.byCode` — `{ [code]: {code, zh, en} }`
  - `window.SERN.industries.name(code, lang)` — 未知 code 原样返回，永不返回空串

- [ ] **Step 1: 创建 `js/data/industries.js`（完整内容）**

```js
(function () {
  'use strict';

  window.SERN = window.SERN || {};

  // 申万一级行业（31 个）。code 为 stock-sdk 行业板块代码，仅作稳定标识，
  // 与上市市场无关——行业分类描述公司主营业务，全球股票通用。
  // 生成日期：2026-10-14
  var list = [
    { code: 'BK0433', zh: '农林牧渔', en: 'Agriculture' },
    { code: 'BK1206', zh: '基础化工', en: 'Basic Chemicals' },
    { code: 'BK0479', zh: '钢铁', en: 'Steel' },
    { code: 'BK0478', zh: '有色金属', en: 'Non-ferrous Metals' },
    { code: 'BK1201', zh: '电子', en: 'Electronics' },
    { code: 'BK1211', zh: '汽车', en: 'Automobiles' },
    { code: 'BK0456', zh: '家用电器', en: 'Home Appliances' },
    { code: 'BK0438', zh: '食品饮料', en: 'Food & Beverage' },
    { code: 'BK0436', zh: '纺织服饰', en: 'Textiles & Apparel' },
    { code: 'BK1212', zh: '轻工制造', en: 'Light Industry' },
    { code: 'BK1216', zh: '医药生物', en: 'Pharmaceuticals & Biotech' },
    { code: 'BK0427', zh: '公用事业', en: 'Utilities' },
    { code: 'BK1210', zh: '交通运输', en: 'Transportation' },
    { code: 'BK1202', zh: '房地产', en: 'Real Estate' },
    { code: 'BK1213', zh: '商贸零售', en: 'Commerce & Retail' },
    { code: 'BK1214', zh: '社会服务', en: 'Social Services' },
    { code: 'BK1217', zh: '综合', en: 'Conglomerates' },
    { code: 'BK1208', zh: '建筑材料', en: 'Building Materials' },
    { code: 'BK1209', zh: '建筑装饰', en: 'Construction & Decoration' },
    { code: 'BK1200', zh: '电力设备', en: 'Power Equipment' },
    { code: 'BK1204', zh: '国防军工', en: 'Defense & Aerospace' },
    { code: 'BK1207', zh: '计算机', en: 'Computers' },
    { code: 'BK0486', zh: '传媒', en: 'Media' },
    { code: 'BK1215', zh: '通信', en: 'Telecommunications' },
    { code: 'BK1283', zh: '银行', en: 'Banks' },
    { code: 'BK1203', zh: '非银金融', en: 'Non-bank Financials' },
    { code: 'BK0437', zh: '煤炭', en: 'Coal' },
    { code: 'BK0464', zh: '石油石化', en: 'Oil & Petrochemicals' },
    { code: 'BK0728', zh: '环保', en: 'Environmental Protection' },
    { code: 'BK1035', zh: '美容护理', en: 'Beauty & Personal Care' },
    { code: 'BK1205', zh: '机械设备', en: 'Machinery' }
  ];

  var byCode = {};
  list.forEach(function (i) { byCode[i.code] = i; });

  window.SERN.industries = {
    list: list,
    byCode: byCode,
    // 未知 code 回退为 code 本身，保证标签永不空白
    name: function (code, lang) {
      var i = byCode[code];
      if (!i) return code;
      return i[lang] || i.en || i.zh;
    }
  };
})();
```

- [ ] **Step 2: 在 `markets.html` 里把 `industries.js` 引到 `universe.js` 之前**

把：

```html
  <script src="js/data/universe.js?v=20261013c"></script>
```

改成：

```html
  <script src="js/data/industries.js?v=20261014"></script>
  <script src="js/data/universe.js?v=20261014"></script>
```

- [ ] **Step 3: 两个 HTML 的版本号统一升到 `20261014`**

本计划后续每个 Task 都会改 `js/*`，按仓库规则必须同步递增两个 HTML 的 `?v=YYYYMMDD`。在第一个改动 JS 的 Task 里一次升到位，后续 Task 沿用同一版本号：

```bash
cd /Users/hins/Project/SERN
sed -i '' 's/?v=20261013c/?v=20261014/g' index.html markets.html
grep -c '?v=20261014' index.html markets.html
grep -c '20261013c' index.html markets.html || true
```

Expected：两个文件都有非零的 `?v=20261014`；`grep -c '20261013c'` 两个文件均输出 `0`。

- [ ] **Step 4: Node 校验行业表可加载且回退正确**

Run:

```bash
node -e "global.window={}; require('/Users/hins/Project/SERN/js/data/industries.js'); var I=window.SERN.industries; console.log('count', I.list.length); console.log('BK1201 zh=' + I.name('BK1201','zh'), 'en=' + I.name('BK1201','en')); console.log('unknown: ' + I.name('BK9999','zh'));"
```

Expected：`count 31`、`BK1201 zh=电子 en=Electronics`、`unknown: BK9999`。

- [ ] **Step 5: 提交**

```bash
cd /Users/hins/Project/SERN
git add js/data/industries.js markets.html index.html
git commit -m "feat: 新增申万一级行业静态表"
```

---

### Task 3: `js/data/universe.js` 迁移为 `industry` + `generatedAt`

**Files:**
- Modify: `/Users/hins/Project/SERN/js/data/universe.js`（整体重写）

**Interfaces:**
- Consumes: Task 2 的 31 个 `BKxxxx` code。
- Produces: `window.SERN.universe`（每项 `{symbol, name, market, industry}`）、`window.SERN.universeGeneratedAt === '2026-10-14'`。

- [ ] **Step 1: 用一次性脚本重写 `universe.js`**

把下面脚本存为 `/tmp/regen_universe.js`。它读取现有 `universe.js`（保留 symbol/name/market 与原始顺序），按 `MAP` 把 `sector` 换成 `industry`，输出到 `js/data/universe.js`。

```js
global.window = {};
require('/Users/hins/Project/SERN/js/data/universe.js');
var u = global.window.SERN.universe;

// 市场 × 行业归属（申万一级，见 js/data/industries.js）。跨行业集团按主营归一类。
var MAP = {
  // US
  AAPL:'BK1201',MSFT:'BK1207',NVDA:'BK1201',AVGO:'BK1201',ORCL:'BK1207',CRM:'BK1207',
  AMD:'BK1201',ADBE:'BK1207',CSCO:'BK1215',QCOM:'BK1201',TXN:'BK1201',IBM:'BK1207',
  INTC:'BK1201',NOW:'BK1207',INTU:'BK1207',ASML:'BK1201',
  GOOGL:'BK0486',META:'BK0486',NFLX:'BK0486',DIS:'BK0486',TMUS:'BK1215',VZ:'BK1215',T:'BK1215',
  AMZN:'BK1213',TSLA:'BK1211',HD:'BK1213',MCD:'BK1214',NKE:'BK0436',SBUX:'BK1214',
  LOW:'BK1213',BKNG:'BK1214',TJX:'BK1213',
  PG:'BK1035',COST:'BK1213',WMT:'BK1213',KO:'BK0438',PEP:'BK0438',PM:'BK0438',MO:'BK0438',MDLZ:'BK0438',
  UNH:'BK1216',JNJ:'BK1216',LLY:'BK1216',ABBV:'BK1216',MRK:'BK1216',TMO:'BK1216',ABT:'BK1216',
  DHR:'BK1216',PFE:'BK1216',CVS:'BK1216',AMGN:'BK1216',
  'BRK-B':'BK1203',JPM:'BK1283',V:'BK1203',MA:'BK1203',BAC:'BK1283',WFC:'BK1283',GS:'BK1203',
  MS:'BK1203',SCHW:'BK1203',AXP:'BK1203',BLK:'BK1203',C:'BK1283',
  GE:'BK1205',CAT:'BK1205',BA:'BK1204',HON:'BK1205',UNP:'BK1210',UPS:'BK1210',RTX:'BK1204',
  LMT:'BK1204',DE:'BK1205',ADP:'BK1214',
  XOM:'BK0464',CVX:'BK0464',COP:'BK0464',SLB:'BK0464',EOG:'BK0464',
  NEE:'BK0427',DUK:'BK0427',
  LIN:'BK1206',APD:'BK1206',SHW:'BK1206',
  PLD:'BK1202',AMT:'BK1202',
  // CN
  '600519.SS':'BK0438','300750.SZ':'BK1200','601318.SS':'BK1203','600036.SS':'BK1283',
  '000858.SZ':'BK0438','600900.SS':'BK0427','601899.SS':'BK0478','000333.SZ':'BK0456',
  '600276.SS':'BK1216','601012.SS':'BK1200','600030.SS':'BK1203','600048.SS':'BK1202',
  '002594.SZ':'BK1211','600887.SS':'BK0438','000651.SZ':'BK0456','601988.SS':'BK1283',
  '600028.SS':'BK0464','601857.SS':'BK0464','603288.SS':'BK0438','002475.SZ':'BK1201',
  '600941.SS':'BK1215','300059.SZ':'BK1203','601166.SS':'BK1283','601398.SS':'BK1283',
  '000568.SZ':'BK0438','603259.SS':'BK1216','601088.SS':'BK0437','300760.SZ':'BK1216',
  // HK
  '0700.HK':'BK0486','9988.HK':'BK1213','0939.HK':'BK1283','1299.HK':'BK1203',
  '0941.HK':'BK1215','3690.HK':'BK1214','9618.HK':'BK1213','1810.HK':'BK1201',
  '0883.HK':'BK0464','2318.HK':'BK1203','9999.HK':'BK0486','2020.HK':'BK0436',
  '0005.HK':'BK1283','1024.HK':'BK0486','2269.HK':'BK1216','2382.HK':'BK1201',
  '0388.HK':'BK1203','1109.HK':'BK1202',
  // JP
  '7203.T':'BK1211','6758.T':'BK1201','9984.T':'BK1203','8306.T':'BK1283',
  '8035.T':'BK1201','7974.T':'BK0486','8058.T':'BK1217',
  // KR
  '005930.KS':'BK1201','000660.KS':'BK1201','035420.KS':'BK0486','005380.KS':'BK1211','105560.KS':'BK1283',
  // TW
  '2330.TW':'BK1201','2317.TW':'BK1201','2881.TW':'BK1203',
  // EU
  'MC.PA':'BK0436','SAP.DE':'BK1207','OR.PA':'BK1035','TTE.PA':'BK0464','SIE.DE':'BK1205'
};

var missing = u.filter(function (x) { return !MAP[x.symbol]; });
if (missing.length) {
  console.error('未映射：', missing.map(function (x) { return x.symbol; }).join(','));
  process.exit(1);
}

// 与现有 universe.js 一致的引号风格：单引号；内含单引号时才转义
function q(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

var out = [];
out.push('(function () {');
out.push("  'use strict';");
out.push('');
out.push('  window.SERN = window.SERN || {};');
out.push('');
out.push('  // markets: US / CN / HK / JP / KR / TW / EU');
out.push('  // industry: 申万一级行业代码（见 js/data/industries.js），全球股票通用');
out.push('  // 选股口径：市场 × 行业的龙头 / 白马 / 蓝筹，详见 AGENTS.md');
out.push('  // 生成日期：2026-10-14');
out.push('  var universe = [');
var lastMkt = null;
u.forEach(function (x, i) {
  if (x.market !== lastMkt) {
    out.push('    // ==================== ' + x.market + ' ====================');
    lastMkt = x.market;
  }
  var comma = i === u.length - 1 ? '' : ',';
  out.push('    { symbol: ' + q(x.symbol) + ', name: { en: ' + q(x.name.en) + ', zh: ' + q(x.name.zh) +
    ' }, market: ' + q(x.market) + ', industry: ' + q(MAP[x.symbol]) + ' }' + comma);
});
out.push('  ];');
out.push('');
out.push('  window.SERN.universe = universe;');
out.push("  window.SERN.universeGeneratedAt = '2026-10-14';");
out.push('})();');

require('fs').writeFileSync('/Users/hins/Project/SERN/js/data/universe.js', out.join('\n') + '\n');
console.log('已写入', u.length, '条，全部映射完成');
```

Run:

```bash
node /tmp/regen_universe.js
```

Expected：`已写入 151 条，全部映射完成`（若池子已是 151 条；数字随池子规模而变，关键是**无「未映射」报错**）。

- [ ] **Step 2: 校验生成结果**

Run:

```bash
node -e "global.window={}; require('/Users/hins/Project/SERN/js/data/universe.js'); var u=window.SERN.universe; var bad=u.filter(function(x){return !x.industry||x.sector!==undefined;}); console.log('entries',u.length,'generatedAt',window.SERN.universeGeneratedAt,'bad',bad.length);"
```

Expected：`entries 151 generatedAt 2026-10-14 bad 0`（`bad 0` 必须成立：无残留 `sector`、全部有 `industry`）。

- [ ] **Step 3: 提交**

```bash
cd /Users/hins/Project/SERN
git add js/data/universe.js
git commit -m "refactor: 股票池改用申万一级行业代码"
```

---

### Task 4: 消费方 `sector` → `industry` 迁移（heatmap / markets / scoring）

**Files:**
- Modify: `/Users/hins/Project/SERN/js/heatmap.js`
- Modify: `/Users/hins/Project/SERN/js/markets.js`
- Modify: `/Users/hins/Project/SERN/js/scoring.js`

**Interfaces:**
- Consumes: `window.SERN.universe[].industry`（Task 3）、`window.SERN.industries.name()`（Task 2）。
- Produces:
  - `heatmap.render(container, opts)` 新增 `opts.industryName(code)` 回调（markets.js 注入）。
  - `markets.js` 内部 `industryName(code)`、`heatRank(entries)`。
  - `scoring.js` 配置项 `scope: 'industry'`，`groupKey` 读 `entry.meta.industry`。

- [ ] **Step 1: `js/scoring.js` 改字段名（仅改名，不动权重）**

`models` 里 3 处 `scope: 'sector'` 改为 `scope: 'industry'`（`deepvalue` 的 `scope: 'market'` 保持不变）：

```js
    multifactor: {
      scope: 'industry',
```

```js
    peg: {
      scope: 'industry',
```

```js
    qualitymomentum: {
      scope: 'industry',
```

`groupKey` 改为：

```js
  function groupKey(entry, cfg) {
    return cfg.scope === 'industry' ? entry.meta.industry : 'ALL';
  }
```

- [ ] **Step 2: `js/heatmap.js` 分组字段与标签改为 industry**

把 `render` 里按 `e.meta.sector` 分组的代码段整体改为：

```js
    // Group loaded entries by industry; entries without data (still pending on
    // the very first load) appear on a later render. Entries holding stale
    // data mid-refresh keep their tile — the wall never blanks.
    var order = [];
    var byIndustry = {};
    opts.entries.forEach(function (e) {
      if (!e.data) return;
      var s = e.meta.industry;
      if (!byIndustry[s]) {
        byIndustry[s] = [];
        order.push(s);
      }
      byIndustry[s].push(e);
    });
```

把紧随其后的 `minCap` 循环里 `bySector[s]` 改为 `byIndustry[s]`：

```js
    var minCap = Infinity;
    order.forEach(function (s) {
      byIndustry[s].forEach(function (e) {
        var w = weightOf(e, Infinity);
        if (w < minCap) minCap = w;
      });
    });
```

把「Sectors and the stocks…」注释到 `sectors` 变量的整段改为：

```js
    // Industries and the stocks inside them are both ordered by market cap
    // desc (treemap geography follows 体量); color alone carries 表现.
    var industries = order.map(function (s) {
      var stocks = byIndustry[s].map(function (e) {
        return { entry: e, weight: weightOf(e, fallback) };
      }).sort(function (a, b) { return b.weight - a.weight; });
      var wsum = 0;
      stocks.forEach(function (st) { wsum += st.weight; });
      return { industry: s, stocks: stocks, weight: wsum };
    }).sort(function (a, b) { return b.weight - a.weight; });
```

把 `sectorRects` 那两行改为：

```js
    var industryRects = squarify(industries.map(function (s) { return s.weight; }), 0, 0, W, H);

    industries.forEach(function (ind, i) {
      var r = insetRect(industryRects[i], SECTOR_PAD);
```

把标签行：

```js
      var label = opts.t('sector.' + sec.sector);
```

改为：

```js
      var label = opts.industryName ? opts.industryName(ind.industry) : ind.industry;
```

把该 forEach 内所有 `sec.stocks` 改为 `ind.stocks`（两处：`squarify(sec.stocks...)` 与 `sec.stocks.forEach(...)`）。

- [ ] **Step 3: `js/markets.js` 行业标签、配色、收藏 bucket、热度排序**

（3a）`SECTOR_COLORS` 由 11 个硬编码色改为按行业数均匀生成。把：

```js
  var SECTOR_COLORS = ['#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#f97316',
    '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#84cc16', '#f43f5e'];
```

改为：

```js
  function buildSectorColors(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push('hsl(' + Math.round(i * 360 / n) + ', 70%, 55%)');
    }
    return out;
  }
  var SECTOR_COLORS = buildSectorColors(
    (window.SERN.industries && window.SERN.industries.list.length) || 31);
```

（3b）新增 `industryName` 小工具（放在 `langName` 之后）：

```js
  function industryName(code) {
    if (code === 'favorites') return t('industry.favorites');
    if (!code) return t('common.na');
    var ind = window.SERN.industries;
    return ind ? ind.name(code, i18n.getLang()) : code;
  }
```

（3c）`favoriteMeta` 里 `sector: 'favorites'` 改为 `industry: 'favorites'`；`openExternalDrawer` 里 `sector: null` 改为 `industry: null`。同时把注释里的 "sector bucket" 改为 "industry bucket"。

（3d）`buildRow` 里：

```js
    var sectorTag = el('span', 'sector-tag', t('sector.' + entry.meta.sector));
```

改为：

```js
    var sectorTag = el('span', 'sector-tag', industryName(entry.meta.industry));
```

（3e）`renderLegend` 把 `labelPrefix` 改为标签函数：

```js
  function renderLegend(containerId, counts, colorMap, labelFn) {
    var box = document.getElementById(containerId);
    box.innerHTML = '';
    Object.keys(counts).filter(function (k) { return counts[k] > 0; }).forEach(function (key, i) {
      var row = el('div', 'legend-row');
      var dot = el('span', 'legend-dot');
      dot.style.background = colorMap[key] || SECTOR_COLORS[i % SECTOR_COLORS.length];
      row.appendChild(dot);
      var label = labelFn ? labelFn(key) : key;
      row.appendChild(el('span', 'legend-label', label));
      row.appendChild(el('span', 'legend-count', String(counts[key])));
      box.appendChild(row);
    });
  }
```

（3f）`renderDistribution` 整体改为：

```js
  var sectorColorMap = {};
  function renderDistribution(topList) {
    var sectorCounts = {}, marketCounts = {};
    topList.forEach(function (e) {
      sectorCounts[e.meta.industry] = (sectorCounts[e.meta.industry] || 0) + 1;
      marketCounts[e.meta.market] = (marketCounts[e.meta.market] || 0) + 1;
    });
    Object.keys(sectorColorMap).length = 0;
    var i = 0;
    Object.keys(sectorCounts).forEach(function (s) {
      sectorColorMap[s] = SECTOR_COLORS[i % SECTOR_COLORS.length];
      i++;
    });
    drawDonut('donut-sector', sectorCounts, sectorColorMap);
    drawDonut('donut-market', marketCounts, MARKET_COLORS);
    renderLegend('sector-legend', sectorCounts, sectorColorMap, industryName);
    renderLegend('market-legend', marketCounts, MARKET_COLORS, function (k) { return t('market.' + k); });
  }
```

> 注意：`renderLegend` 的市场图例原先靠 `labelPrefix='market.'` 拼 key，现在改成闭包 `function (k) { return t('market.' + k); }`，行为不变。

（3g）新增 `heatRank` 与榜单二级排序。在 `visibleRanked` 之前插入：

```js
  // 池内每日热度：在「市场 × 行业」桶内按当日成交额降序排名。
  // 不跨市场比较（amount 为各市场计价货币主单位，混排会失真）。
  // 只在同分/同数据完整度时作为榜单的二级排序键，不改变主排序（composite）。
  function heatRank(entries) {
    var buckets = {};
    entries.forEach(function (e) {
      if (!e.data) return;
      var a = e.data.amount;
      if (a === null || a === undefined || !isFinite(a)) return;
      var key = (e.meta.market || '') + '|' + (e.meta.industry || '');
      (buckets[key] || (buckets[key] = [])).push(e);
    });
    var rank = {};
    Object.keys(buckets).forEach(function (key) {
      buckets[key].sort(function (x, y) { return y.data.amount - x.data.amount; });
      buckets[key].forEach(function (e, i) { rank[e.meta.symbol] = i + 1; });
    });
    return rank;
  }
```

`visibleRanked` 改为：

```js
  function visibleRanked() {
    var scoped = state.scores.filter(inMarket);
    var ranks = heatRank(scoped);
    return scoped.sort(function (a, b) {
      var d = b.scores.composite - a.scores.composite;
      if (d !== 0) return d;
      var ra = ranks[a.meta.symbol] || Infinity;
      var rb = ranks[b.meta.symbol] || Infinity;
      return ra - rb;
    });
  }
```

（3h）`valuationTip` 的 scope 判断改名（i18n key 名不变）：

```js
    return t('score.tip.valuation.' + (cfg.scope === 'industry' ? 'sector' : 'market')) + ' ' + weights;
```

（3i）`renderHeatmap` 注入 `industryName` 回调：

```js
    window.SERN.heatmap.render(document.getElementById('heatmap-body'), {
      entries: visibleEntries(),
      t: t,
      langName: langName,
      industryName: industryName,
      isFavorite: isFavorite,
      loading: state.loading,
      onSelect: openDrawer
    });
```

（3j）把 `openExternalDrawer` 上方注释 "no sector peers" 改为 "no industry peers"。

- [ ] **Step 4: 校验无残留 `meta.sector` 且语法正确**

Run:

```bash
cd /Users/hins/Project/SERN
grep -n "meta\.sector\|'sector\.'\|scope: 'sector'" js/*.js || echo "无残留"
for f in js/heatmap.js js/markets.js js/scoring.js; do node --check "$f" && echo "$f OK"; done
```

Expected：第一行输出 `无残留`；三个文件均输出 `OK`（`js/i18n.js` 的 `score.tip.valuation.sector` key 不在上述 grep 模式内，属预期保留）。

- [ ] **Step 5: 提交**

```bash
cd /Users/hins/Project/SERN
git add js/heatmap.js js/markets.js js/scoring.js
git commit -m "refactor: 市场页消费方迁移到 industry 字段"
```

---

### Task 5: `js/i18n.js` 行业键与 `markets.html` 文案

**Files:**
- Modify: `/Users/hins/Project/SERN/js/i18n.js`
- Modify: `/Users/hins/Project/SERN/markets.html`

**Interfaces:**
- Consumes: `industryName()` 的 `t('industry.favorites')`（Task 4）。
- Produces: 删除 `sector.*`（12 键 × 2 语言），新增 `industry.favorites`（× 2 语言），`dist.by-sector` → `dist.by-industry`（× 2 语言）。

- [ ] **Step 1: 删除 12 个 `sector.*` 键，新增 `industry.favorites`**

英文块：删掉 `'sector.technology'` 到 `'sector.favorites'` 共 12 行，替换为：

```js
      'industry.favorites': 'Favorites',
```

中文块：删掉对应的 12 行，替换为：

```js
      'industry.favorites': '收藏',
```

- [ ] **Step 2: 重命名 `dist.by-sector` → `dist.by-industry`**

英文块：

```js
      'dist.by-industry': 'By industry',
```

中文块：

```js
      'dist.by-industry': '按行业',
```

`score.tip.valuation.sector` 两个语言块**保持不动**（语义仍是「同行业」）。

- [ ] **Step 3: `markets.html` 的 `data-i18n` 同步**

把：

```html
            <h3 class="donut-card-title" data-i18n="dist.by-sector">By sector</h3>
```

改为：

```html
            <h3 class="donut-card-title" data-i18n="dist.by-industry">By industry</h3>
```

- [ ] **Step 4: 校验键名一致**

Run:

```bash
cd /Users/hins/Project/SERN
grep -n "dist\.by-sector\|dist\.by-industry\|industry\.favorites\|sector\." js/i18n.js markets.html
```

Expected：只剩 `dist.by-industry`（i18n 两处 + html 一处）、`industry.favorites`（两处），以及 `score.tip.valuation.sector`（两处，允许保留）；不再有 `sector.technology` 等 11 个旧键。

- [ ] **Step 5: 提交**

```bash
cd /Users/hins/Project/SERN
git add js/i18n.js markets.html
git commit -m "chore: 行业 i18n 键迁移到 industry"
```

---

### Task 6: `js/market-data.js` 批量基本面 + `amount` 透传 + 版本号

**Files:**
- Modify: `/Users/hins/Project/SERN/js/market-data.js`
- Modify: `/Users/hins/Project/SERN/index.html`（仅版本号）
- Modify: `/Users/hins/Project/SERN/markets.html`（仅版本号）

**Interfaces:**
- Consumes: Task 1 的 `GET /v1/fundamentals?symbols=`（≤20/批）。
- Produces:
  - `parseStockapiFundamentalsBatch(text) -> { [symbol]: fundamentals } | null`
  - `warmFundamentals(symbols)` 改为按批预热（批 20、并发 3）
  - `parseStockapiQuotes` 输出新增 `amount`
  - `stockapiQuote()` 返回的 quote 带 `amount`
  - `_test.parseStockapiFundamentalsBatch`、`_test.heatRank` 可选导出

- [ ] **Step 1: `emptyQuote` 增加 `amount` 字段**

在 `emptyQuote` 返回对象里，`price: null, marketCap: null, changePct: null,` 这一行下面加一行：

```js
      amount: null,
```

- [ ] **Step 2: `parseStockapiQuotes` 输出 `amount`**

把：

```js
      out[item.symbol] = { price: price, changePct: cp / 100 };
```

改为：

```js
      out[item.symbol] = { price: price, changePct: cp / 100, amount: num(item.amount) };
```

并把该函数上方的注释补一句：`amount` 仅用于每日热度排序（池内），不参与 pair-or-nothing。

- [ ] **Step 3: `stockapiQuote()` 带上 `amount`，并把 `amount` 加入 `FILL_KEYS`**

在 `q.changePct = snap.changePct;` 之后加：

```js
    q.amount = snap.amount === undefined ? null : snap.amount;
```

**同时**把 `amount` 加进 `FILL_KEYS`：

```js
  var FILL_KEYS = ['price', 'amount', 'marketCap', 'changePct', 'pe', 'forwardPe', 'pb', 'ps',
    'evEbitda', 'peg', 'divYield', 'roe', 'margin', 'fcf', 'fcfYield',
    'earningsGrowth', 'revenueGrowth', 'debtToEquity'];
```

> 为什么必须加进 `FILL_KEYS`：`getQuote()` 先建 `emptyQuote()`，再用 `fillFrom()` 把各来源的 partial 合并进来，而 `fillFrom` **只复制 `FILL_KEYS` 里的键**。只改 `stockapiQuote()` 的话，`amount` 会在合并时被丢掉，`entry.data.amount` 永远是 `null`，热度排序全部失效。`fillFrom` 的语义是「只在 `q[k] === null` 时用非空 partial 覆盖」，所以把 `amount` 加进去不会覆盖已有值、也不会把非空值写成 null——安全。

- [ ] **Step 4: 抽出基本面字段解析，新增批量解析**

把 `parseStockapiFundamentals` 改为复用字段函数：

```js
  function fundamentalsFields(d) {
    return {
      pe: num(d.pe),
      forwardPe: num(d.forward_pe),
      pb: num(d.pb),
      ps: num(d.ps),
      evEbitda: num(d.ev_ebitda),
      peg: num(d.peg),
      divYield: num(d.div_yield),
      roe: num(d.roe),
      margin: num(d.margin),
      fcf: num(d.fcf),
      fcfYield: num(d.fcf_yield),
      marketCap: num(d.market_cap),
      earningsGrowth: num(d.earnings_growth),
      revenueGrowth: num(d.revenue_growth),
      debtToEquity: num(d.debt_to_equity)
    };
  }

  function parseStockapiFundamentals(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return null; }
    var d = json && json.data;
    if (!d) return null;
    return fundamentalsFields(d);
  }

  // Pure: /v1/fundamentals?symbols= body -> { symbol: fundamentals }.
  // 失败项（item.error）跳过，不写缓存、不阻塞其他项。
  function parseStockapiFundamentalsBatch(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return null; }
    var arr = json && json.data;
    if (!Array.isArray(arr)) return null;
    var out = {};
    arr.forEach(function (item) {
      if (!item || typeof item.symbol !== 'string' || item.error) return;
      out[item.symbol] = fundamentalsFields(item);
    });
    return out;
  }
```

- [ ] **Step 5: `warmFundamentals` 改为分批，并保留逐股 join 语义**

> 关键点：原来 `warmFundamentals` 逐个调 `stockapiFundamentals()`，顺带把每个 symbol 登记进 `fundInflight`，于是并行触发的抽屉/评分 walk 会 **join 同一个请求**，不会重复发。改成批量后必须手动保留这个 join，否则冷启动时逐股 walk 会重新退化成 O(股票数) 个单股请求。

把 `var FUND_CONCURRENCY = 8;` 改为：

```js
  var FUND_BATCH = 20;            // 与 Worker 批量端点硬上限一致
  var FUND_CHUNK_CONCURRENCY = 3; // 与报价 warm 对齐
```

把整个 `warmFundamentals` 函数替换为：

```js
  function warmFundamentals(symbols) {
    if (!symbols.length) return Promise.resolve();
    // 已有缓存或在途的直接跳过，只对真正的 miss 发批量请求
    var pending = symbols.filter(function (s) {
      return !cacheEntry(FUND_KEY_PREFIX + s) && !fundInflight[s];
    });
    if (!pending.length) return Promise.resolve();

    // 先跑批，再把整批的完成 promise 登记为每个 symbol 的 in-flight 句柄：
    // 必须在 runChunks 之前一次性登记，否则后面几批开始前，
    // 逐股 walk 仍可能抢跑发出重复的单股请求。
    var job = runChunks(chunkOf(pending, FUND_BATCH), FUND_CHUNK_CONCURRENCY, function (chunk) {
      // one network-level failure means the origin is unreachable: skip the
      // rest of the queue instead of burning the 8s abort budget each time
      if (isDown('stockapi-fund')) return Promise.resolve();
      var url = STOCKAPI_ORIGIN + '/v1/fundamentals?symbols=' +
        chunk.map(function (s) { return encodeURIComponent(s); }).join(',');
      return fetchStockapi(url).then(function (text) {
        var map = parseStockapiFundamentalsBatch(text);
        if (!map) return;
        chunk.forEach(function (s) {
          if (map[s]) cacheSet(FUND_KEY_PREFIX + s, map[s]);
        });
      }, function (err) {
        if (err && err.network) markDown('stockapi-fund');
      });
    });

    pending.forEach(function (s) {
      var joined = job.then(function () {
        var hit = cacheEntry(FUND_KEY_PREFIX + s);
        return hit ? hit.data : null; // 批量失败/该股无数据 -> null，walk 当作 miss
      });
      fundInflight[s] = joined;
      var settle = function () { delete fundInflight[s]; };
      joined.then(settle, settle);
    });

    return job;
  }
```

`stockapiFundamentals(symbol)` **保持原样**（先查缓存、再 join `fundInflight`、最后单股请求）——它是抽屉与池外股票的按需路径，行为不变。

- [ ] **Step 6: `_test` 导出新增解析函数**

在 `_test` 里 `parseStockapiFundamentals: parseStockapiFundamentals,` 下面加：

```js
      parseStockapiFundamentalsBatch: parseStockapiFundamentalsBatch,
```

- [ ] **Step 7: 确认两个 HTML 的版本号仍为 `20261014`**

版本号已在 Task 2 升到位；本 Task 又改了 `js/market-data.js`，同一天沿用同一版本号即可。只做校验：

```bash
cd /Users/hins/Project/SERN
grep -c '?v=20261014' index.html markets.html
grep -c '20261013c' index.html markets.html || true
```

Expected：两个文件 `?v=20261014` 计数非零；`20261013c` 计数均为 `0`。

- [ ] **Step 8: Node 纯函数回归**

Run:

```bash
cd /Users/hins/Project/SERN
node -e "
global.window={}; global.localStorage={getItem:function(){return null;},setItem:function(){}};
require('/Users/hins/Project/SERN/js/data/industries.js');
require('/Users/hins/Project/SERN/js/data/universe.js');
var md=require('fs').readFileSync('/Users/hins/Project/SERN/js/market-data.js','utf8');
// 该文件依赖 fetch 与 DOM，这里只做静态断言：关键符号存在
['parseStockapiFundamentalsBatch','FUND_BATCH','amount: num(item.amount)','/v1/fundamentals?symbols='].forEach(function(k){
  if (md.indexOf(k)===-1) { console.error('缺少', k); process.exit(1); }
});
console.log('market-data 关键改动齐全');
"
node --check js/market-data.js && echo "market-data OK"
```

Expected：`market-data 关键改动齐全` 与 `market-data OK`。

- [ ] **Step 9: 提交**

```bash
cd /Users/hins/Project/SERN
git add js/market-data.js index.html markets.html
git commit -m "feat: 基本面批量预热与成交额热度字段"
```

---

## Phase 3 — 文档与端到端验证

### Task 7: 修正 `AGENTS.md` 并做端到端冒烟

**Files:**
- Modify: `/Users/hins/Project/SERN/AGENTS.md`

**Interfaces:**
- Consumes: Task 1–6 的全部产出。
- Produces: 与实现一致的仓库文档。

- [ ] **Step 1: 修正 `AGENTS.md` 的「基本面按需拉取」表述**

把：

```markdown
- **基本面按需拉取**：`/v1/fundamentals` 是逐股接口，股票池扩容后不再全量预热，改为进入评分/抽屉时按需请求。
```

改为：

```markdown
- **基本面批量预热**：`/v1/fundamentals?symbols=` 每批最多 20 个代码（逐项独立成败），前端按批 20、并发 3 预热，冷启动请求数从 O(股票数) 降到 O(股票数/20)；单股抽屉仍走 `/v1/fundamentals/:symbol`。
- **每日成交额热度**：复用 `/v1/quote` 批量预热返回的 `amount`，在「市场 × 行业」桶内排序（不跨市场比较），随报价的每日 06:00 缓存滚动刷新，不新增请求。
- **行业分类**：市场页行业为 31 个申万一级行业（`js/data/industries.js`），股票池 `js/data/universe.js` 按「市场 × 行业」维护龙头/白马/蓝筹，每周重新生成并提交。
```

- [ ] **Step 2: 本地起服务并做端到端冒烟**

Run:

```bash
cd /Users/hins/Project/SERN
python3 -m http.server 8000
```

在浏览器打开 `http://localhost:8000/markets.html`，逐项确认：

- 热力图按 31 个申万一级行业分组，行业标签中英文正确（切换语言后仍正确）。
- 稀疏行业（只有 1 只股票）不崩、不出现空标签。
- 行业环形图图例完整，标题为「按行业 / By industry」。
- 榜单行业标签显示行业中文/英文名，收藏股票标签为「收藏 / Favorites」。
- 冷启动 Network 面板：`/v1/quote` 约 8 批、`/v1/fundamentals?symbols=` 约 8 批（151 只），合计 ≈16 请求，无逐股基本面请求。
- 控制台无报错；桌面端与移动端宽度各验证一次。

- [ ] **Step 3: 提交**

```bash
cd /Users/hins/Project/SERN
git add AGENTS.md
git commit -m "docs: 同步行业分类、批量基本面与每日热度说明"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3 行业表 → Task 2；§4 股票池 → Task 3；§4.6 每日热度 → Task 4（heatRank）+ Task 6（amount 透传）；§5 消费方迁移 → Task 4/5；§7 批量端点 → Task 1；§8 前端接入 → Task 6；§9 版本号 → Task 6；§10 验证 → Task 6/7；§11 非目标未纳入。
- **类型一致性**：`industryName(code)` 在 markets.js 定义并注入 heatmap 的 `opts.industryName`；`scope` 字符串统一为 `'industry'`；`parseStockapiFundamentalsBatch` 返回 `{symbol: fields}`，`warmFundamentals` 消费同名。
- **无占位符**：所有步骤含可直接执行的代码/命令与预期输出。
- **已知遗留（不在本计划）**：策略公式展示、scoring 权重修复、`scoring.js.backup`、i18n 末尾无效注释块（spec §11）。
