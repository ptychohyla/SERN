(function () {
  'use strict';

  window.SERN = window.SERN || {};

  // Market data facade, single-source: EVERYTHING goes through the self-hosted
  // StockAPI Worker (stockapi.hinsyeow.org), which aggregates Eastmoney +
  // Yahoo server-side. No browser-side fallback chain remains — quotes and
  // index prices come from /v1/quote, fundamentals from /v1/fundamentals,
  // sparklines from /v1/kline. Exposes the same interface the markets page
  // has always consumed (window.SERN.yahoo):
  //   getQuote / getChart / getSpark / refreshQuote / clearCache / prefetch
  //
  // Quotes: a batch warm (chunks of 20, 3 in flight) fills the snapshot map
  // off the critical path; getQuote then merges the warmed price with a lazy
  // per-symbol fundamentals fetch, field-level (a field already set is never
  // overwritten). A session availability flag plus per-endpoint cooldowns
  // keep an unreachable origin from stalling the page: failures resolve to
  // "insufficient"/"failed" entries the UI can retry, never to a hang.

  var QUOTE_SOURCES = ['stockapi', 'stockapiFundamentals'];

  // -------------------- cache --------------------
  // Data is daily (T-1 close): persist in localStorage across sessions and
  // expire at the next local 06:00 rollover instead of a short session TTL.
  function lastRollover(now) {
    var d = new Date(now);
    d.setHours(6, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  function cacheEntry(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.at !== 'number' || parsed.at < lastRollover(Date.now())) {
        if (parsed) cacheRemove(key);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: data }));
    } catch (e) { /* quota / private mode: ignore */ }
  }

  function cacheRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  var DATA_KEY_PREFIXES = ['sern-quote-', 'sern-chart-', 'sern-spark-', 'sern-candle-'];

  // Force refresh: wipe every data cache (but never user preferences),
  // clear in-memory snapshots, then re-warm.
  function clearCache() {
    try {
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        for (var j = 0; j < DATA_KEY_PREFIXES.length; j++) {
          if (k.indexOf(DATA_KEY_PREFIXES[j]) === 0) {
            toRemove.push(k);
            break;
          }
        }
      }
      toRemove.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    stockapiSnapshots = {};
    stockapiState = 'unknown';
    resetSourceCooldowns();
    return prefetch();
  }

  // -------------------- per-endpoint cooldown (lazy fetch throttle) --------------------
  var SOURCE_DOWN_COOLDOWN = 60 * 1000;
  var sourceDownUntil = { stockapi: 0, 'stockapi-fund': 0 };
  function markDown(src) { sourceDownUntil[src] = Date.now() + SOURCE_DOWN_COOLDOWN; }
  function isDown(src) { return Date.now() < sourceDownUntil[src]; }
  function resetSourceCooldowns() {
    Object.keys(sourceDownUntil).forEach(function (src) { sourceDownUntil[src] = 0; });
  }

  // -------------------- shared helpers --------------------
  function num(x) {
    var n = parseFloat(x);
    return isFinite(n) ? n : null;
  }

  // negative valuation ratios mean losses/negative equity, not cheapness
  function nonNeg(x) {
    return (typeof x === 'number' && x < 0) ? null : x;
  }

  function currencyFor(symbol) {
    var dot = symbol.indexOf('.');
    if (dot === -1) return 'USD';
    var suffix = symbol.slice(dot + 1);
    if (suffix === 'HK') return 'HKD';
    if (suffix === 'SS' || suffix === 'SZ') return 'CNY';
    if (suffix === 'T') return 'JPY';
    if (suffix === 'KS' || suffix === 'KQ') return 'KRW';
    if (suffix === 'TW') return 'TWD';
    return 'EUR';
  }

  function universeName(symbol) {
    var u = window.SERN.universe || [];
    for (var i = 0; i < u.length; i++) {
      if (u[i].symbol === symbol) return u[i].name.en;
    }
    return symbol;
  }

  function emptyQuote(symbol) {
    return {
      symbol: symbol,
      name: universeName(symbol),
      currency: currencyFor(symbol),
      price: null, marketCap: null, changePct: null,
      pe: null, forwardPe: null, pb: null, ps: null, evEbitda: null,
      peg: null, divYield: null, roe: null, margin: null, fcf: null,
      fcfYield: null, earningsGrowth: null, revenueGrowth: null,
      debtToEquity: null,
      insufficient: false,
      source: null
    };
  }

  var VALUATION_KEYS = ['pe', 'forwardPe', 'pb', 'ps', 'evEbitda', 'peg', 'divYield'];
  function valuationKeyCount(q) {
    var n = 0;
    VALUATION_KEYS.forEach(function (k) {
      if (q[k] !== null && q[k] !== undefined && isFinite(q[k])) n++;
    });
    return n;
  }

  // HK codes are 5 digits on the Worker (00700.HK); the universe writes
  // them 4-digit (0700.HK), which silently matches nothing.
  function hkPad(code) {
    while (code.length < 5) code = '0' + code;
    return code;
  }

  // -------------------- StockAPI (stockapi.hinsyeow.org) --------------------
  // Self-hosted Cloudflare Worker aggregating Eastmoney + Yahoo server-side.
  // Covers the whole universe (US/CN/HK/JP/KR/TW/EU) plus the tracked indices.
  // Batch quotes warm in the background behind a session availability flag:
  // the custom domain bypasses the *.workers.dev block, but on any network
  // where the origin is unreachable the warm settles with zero successes and
  // the source is flagged 'down' for the rest of the session instead of
  // stalling quotes.
  var stockapiSnapshots = {}; // internal symbol -> {price, changePct}
  var stockapiState = 'unknown'; // 'unknown' | 'ready' | 'down'
  var STOCKAPI_ORIGIN = 'https://stockapi.hinsyeow.org';
  // Abort budget must exceed the Worker's own worst case (2 providers x 3s
  // upstream timeout + overhead), else a slow-but-healthy Worker looks blocked
  var STOCKAPI_TIMEOUT = 8000;
  var STOCKAPI_BATCH = 20;     // API hard limit per /v1/quote request

  // Internal (Yahoo-style) symbol -> Worker canonical. Mirrors the Worker's
  // normalization: US gets an explicit .US suffix (the Worker canonicalizes
  // responses to AAPL.US, so a bare code never matches back), CN exchanges
  // map to .SH/.SZ, HK pads to 5 digits, and JP/KR/TW map to market suffixes.
  // EU codes and indices are already in canonical (Yahoo) form.
  function stockapiSymbol(symbol) {
    if (symbol.charAt(0) === '^') return symbol; // global index: ^GSPC 等原样
    var dot = symbol.indexOf('.');
    if (dot === -1) return symbol + '.US';
    var suffix = symbol.slice(dot + 1);
    var code = symbol.slice(0, dot);
    if (suffix === 'SS') {
      // 000 开头上证指数（000300.SS）保持原形态，其余沪市股票归一为 .SH
      return code.indexOf('000') === 0 ? code + '.SS' : code + '.SH';
    }
    if (suffix === 'SZ') return code + '.SZ';
    if (suffix === 'HK') return hkPad(code) + '.HK';
    if (suffix === 'T') return code + '.JP';
    if (suffix === 'KS') return code + '.KR';
    if (suffix === 'KQ') return code + '.KQ';
    if (suffix === 'TW') return code + '.TW';
    if (suffix === 'PA' || suffix === 'DE') return symbol; // 欧股即 Yahoo 形态
    return null;
  }

  function fetchStockapi(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, STOCKAPI_TIMEOUT) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        var httpErr = new Error('HTTP ' + res.status);
        httpErr.httpStatus = res.status; // per-symbol upstream miss, not an outage
        throw httpErr;
      }
      return res.text();
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && typeof err === 'object') err.network = true; // abort / conn reset
      throw err;
    });
  }

  // Pure: /v1/quote body -> {canonical: {price, changePct}}. A per-symbol
  // error item ('ALL_PROVIDERS_FAILED') is skipped, not a source outage.
  // change_pct is optional in the Worker's contract, but an item without it
  // is dropped too: price+changePct stay pair-or-nothing, so a later field
  // fill never computes a changePct against a different fetch's price.
  function parseStockapiQuotes(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return {}; }
    var out = {};
    ((json && json.data) || []).forEach(function (item) {
      if (!item || item.error || typeof item.symbol !== 'string') return;
      var price = num(item.price);
      var cp = num(item.change_pct);
      if (price === null || cp === null) return;
      out[item.symbol] = { price: price, changePct: cp / 100 };
    });
    return out;
  }

  // Pure: /v1/kline body -> close prices (candles are time-ascending).
  function parseStockapiKline(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return null; }
    var candles = json && json.data && json.data.candles;
    if (!candles || !candles.length) return null;
    var points = [];
    candles.forEach(function (c) {
      var close = c ? num(c.close) : null;
      if (close !== null) points.push(close);
    });
    return points.length >= 2 ? points : null;
  }

  // Pure: /v1/kline body -> OHLC candles (time-ascending) for the ticker
  // mini K-line charts.
  function parseStockapiCandles(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return null; }
    var candles = json && json.data && json.data.candles;
    if (!candles || !candles.length) return null;
    var out = [];
    candles.forEach(function (c) {
      if (!c) return;
      var o = num(c.open);
      var h = num(c.high);
      var l = num(c.low);
      var cl = num(c.close);
      if (o === null || h === null || l === null || cl === null) return;
      out.push({ o: o, h: h, l: l, c: cl });
    });
    return out.length >= 2 ? out : null;
  }

  function warmStockapi(symbols) {
    var pairs = [];
    symbols.forEach(function (s) {
      var canonical = stockapiSymbol(s);
      if (canonical) pairs.push({ internal: s, canonical: canonical });
    });
    if (!pairs.length) return Promise.resolve();
    var successes = 0;
    return runChunks(chunkOf(pairs, STOCKAPI_BATCH), 3, function (chunk) {
      var url = STOCKAPI_ORIGIN + '/v1/quote?symbols=' + chunk.map(function (p) {
        return encodeURIComponent(p.canonical);
      }).join(',');
      return fetchStockapi(url).then(function (text) {
        var map = parseStockapiQuotes(text);
        chunk.forEach(function (p) {
          if (map[p.canonical]) stockapiSnapshots[p.internal] = map[p.canonical];
        });
        successes++;
        stockapiState = 'ready';
      }, function () {
        // No mid-run verdict: flipping 'down' here would strand in-flight
        // sibling chunks (their successes land after the flag) and one
        // transient error must not kill a proven-good session.
      });
    }).then(function () {
      // Verdict once, when the whole warm settles: zero successes means the
      // source is unusable right now (blocked network OR its upstreams all
      // failing) — flag 'down' so refreshQuote's manual retry re-tests it.
      // A 'ready' session keeps its flag: a failed re-warm must not discard
      // the other symbols' intact snapshots.
      if (!successes && stockapiState !== 'ready') stockapiState = 'down';
    });
  }

  function stockapiQuote(symbol) {
    var snap = stockapiSnapshots[symbol];
    if (stockapiState !== 'ready' || !snap) return null;
    var q = emptyQuote(symbol);
    q.source = 'stockapi';
    q.price = snap.price;
    // pair-or-nothing was enforced at parse time — self-consistent
    q.changePct = snap.changePct;
    return q;
  }

  function stockapiKline(symbol) {
    var canonical = stockapiSymbol(symbol);
    if (!canonical) return Promise.reject(new Error('no stockapi symbol for ' + symbol));
    var url = STOCKAPI_ORIGIN + '/v1/kline/' + encodeURIComponent(canonical) +
      '?period=daily&adjust=qfq&limit=60';
    return fetchStockapi(url).then(function (text) {
      var points = parseStockapiKline(text);
      if (!points) throw new Error('stockapi kline too short');
      return points;
    });
  }

  // OHLC candles for the index ticker mini K-line charts: last 40 daily bars.
  // Same /v1/kline endpoint as the sparkline, full candle shape instead of
  // closes. Cached like every other data fetch.
  function getCandles(symbol) {
    var key = 'sern-candle-' + symbol;
    var hit = cacheEntry(key);
    if (hit) return Promise.resolve(hit.data);
    var canonical = stockapiSymbol(symbol);
    if (!canonical) return Promise.reject(new Error('no stockapi symbol for ' + symbol));
    var url = STOCKAPI_ORIGIN + '/v1/kline/' + encodeURIComponent(canonical) +
      '?period=daily&adjust=qfq&limit=40';
    return fetchStockapi(url).then(function (text) {
      var candles = parseStockapiCandles(text);
      if (!candles) throw new Error('stockapi candles too short');
      var out = { symbol: symbol, candles: candles };
      cacheSet(key, out);
      return out;
    }, function (err) {
      if (err && err.network) markDown('stockapi');
      throw err;
    });
  }

  // Fundamentals endpoint (server-side Yahoo v10 quoteSummary with the full
  // cookie+crumb flow the browser can't do cross-origin). Accepts Yahoo-style
  // symbols — which the internal symbols already ARE, so no canonical mapping
  // — covering every market.
  function parseStockapiFundamentals(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return null; }
    var d = json && json.data;
    if (!d) return null;
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

  function stockapiFundamentals(symbol) {
    var url = STOCKAPI_ORIGIN + '/v1/fundamentals/' + encodeURIComponent(symbol);
    return fetchStockapi(url).then(function (text) {
      var parsed = parseStockapiFundamentals(text);
      if (!parsed) throw new Error('bad fundamentals payload');
      return parsed;
    });
  }

  // -------------------- field-level merge --------------------
  // changePct is source-self-consistent by construction (pair-or-nothing at
  // parse time); prevClose is deliberately NOT here: mixing it with another
  // fetch's price is garbage.
  var FILL_KEYS = ['price', 'marketCap', 'changePct', 'pe', 'forwardPe', 'pb', 'ps',
    'evEbitda', 'peg', 'divYield', 'roe', 'margin', 'fcf', 'fcfYield',
    'earningsGrowth', 'revenueGrowth', 'debtToEquity'];

  function fillFrom(q, partial, source, contributors) {
    if (!partial) return;
    var added = false;
    FILL_KEYS.forEach(function (k) {
      if (q[k] === null && partial[k] !== null && partial[k] !== undefined) {
        q[k] = partial[k];
        added = true;
      }
    });
    if (added && contributors.indexOf(source) === -1) contributors.push(source);
  }

  // Both legs read the warmed state first and only fetch on a miss, so the
  // walk costs nothing once prefetch has run.
  function quoteFrom(source, symbol) {
    if (source === 'stockapi') {
      // warm-only: no per-symbol lazy fetch, so the walk never stalls on a
      // cold or blocked StockAPI — a miss simply ends the walk
      return Promise.resolve(stockapiQuote(symbol));
    }
    // stockapiFundamentals: lazy per-symbol, gated on the session flag plus
    // its own cooldown so a fundamentals outage never touches the quote warm
    if (stockapiState !== 'ready' || isDown('stockapi-fund')) return Promise.resolve(null);
    return stockapiFundamentals(symbol).then(null, function (err) {
      if (err && err.network) markDown('stockapi-fund');
      return null; // HTTP errors (404/502) simply leave fields null
    });
  }

  // Scan QUOTE_SOURCES in priority order, filling only null fields of q.
  function backfill(q, contributors) {
    var chain = Promise.resolve();
    QUOTE_SOURCES.forEach(function (src) {
      chain = chain.then(function () {
        return quoteFrom(src, q.symbol).then(function (partial) {
          // fundamentals from the Worker credit the same 'stockapi' label
          fillFrom(q, partial, 'stockapi', contributors);
        });
      });
    });
    return chain.then(function () { return q; });
  }

  // -------------------- public API --------------------
  function getQuote(symbol) {
    var key = 'sern-quote-' + symbol;
    var hit = cacheEntry(key);
    if (hit) {
      // surface the real cache time so the UI can show data freshness
      hit.data.cachedAt = hit.at;
      return Promise.resolve(hit.data);
    }
    var done = function (q) { cacheSet(key, q); return q; };

    // Wait for the batch quote warm so the walk reads snapshots instead of
    // firing one request per symbol.
    var ready = batchReady || Promise.resolve();
    return ready.then(function () {
      var q = emptyQuote(symbol);
      var contributors = [];
      return backfill(q, contributors).then(function (filled) {
        filled.sources = contributors;
        return filled;
      });
    }).then(function (filled) {
      if (valuationKeyCount(filled) >= 2) {
        filled.source = filled.sources[0] || null;
        return done(filled);
      }
      if (filled.price !== null) {
        filled.insufficient = true;
        filled.source = 'price';
        return done(filled);
      }
      throw new Error('all sources failed for ' + symbol);
    });
  }

  // Tracked index symbols (markets.js INDEX_SYMBOLS) are already canonical.
  // One batch request covers every index and fills all their caches at once.
  // initTicker fires one getChart per index concurrently, so the batch is
  // deduped through a shared inflight promise — parallel identical batches
  // would multiply the Worker's upstream fan-out and get it rate-limited.
  var INDEX_CANONICALS = ['^GSPC', '^IXIC', '^HSI', '000300.SS', '^N225'];
  var indexChartsInflight = null;

  function fetchIndexCharts() {
    if (indexChartsInflight) return indexChartsInflight;
    indexChartsInflight = fetchIndexBatch().then(function (v) {
      indexChartsInflight = null;
      return v;
    }, function (e) {
      indexChartsInflight = null;
      throw e;
    });
    return indexChartsInflight;
  }

  function fetchIndexBatch() {
    var url = STOCKAPI_ORIGIN + '/v1/quote?symbols=' + INDEX_CANONICALS.map(encodeURIComponent).join(',');
    return fetchStockapi(url).then(function (text) {
      var json;
      try { json = JSON.parse(text); } catch (e) { json = null; }
      ((json && json.data) || []).forEach(function (item) {
        if (!item || item.error || typeof item.symbol !== 'string') return;
        var price = num(item.price);
        var cp = num(item.change_pct);
        if (price === null || cp === null) return;
        cacheSet('sern-chart-' + item.symbol, {
          symbol: item.symbol,
          name: typeof item.name === 'string' ? item.name : item.symbol,
          price: price,
          previousClose: num(item.pre_close),
          changePct: cp / 100,
          currency: item.currency || null,
          source: 'stockapi'
        });
      });
    });
  }

  function getChart(symbol) {
    var key = 'sern-chart-' + symbol;
    var hit = cacheEntry(key);
    if (hit) return Promise.resolve(hit.data);
    return fetchIndexCharts().then(function () {
      var done = cacheEntry(key);
      if (!done) throw new Error('index missing in stockapi batch for ' + symbol);
      return done.data;
    });
  }

  function getSpark(symbol) {
    var key = 'sern-spark-' + symbol;
    var hit = cacheEntry(key);
    if (hit) return Promise.resolve(hit.data);
    if (stockapiState !== 'ready' || isDown('stockapi')) {
      return Promise.reject(new Error('stockapi not ready'));
    }
    return stockapiKline(symbol).then(function (points) {
      var out = { symbol: symbol, points: points, source: 'stockapi' };
      cacheSet(key, out);
      return out;
    }, function (err) {
      if (err && err.network) markDown('stockapi');
      throw err;
    });
  }

  function refreshQuote(symbol) {
    cacheRemove('sern-quote-' + symbol);

    // Manual retry re-runs the fetch path for this symbol instead of reusing
    // the warmed snapshot or honoring a recent cooldown.
    resetSourceCooldowns();

    if (stockapiSymbol(symbol)) {
      delete stockapiSnapshots[symbol];
      if (stockapiState === 'ready') {
        // known-good source: wait for the fresh snapshot so the refreshed
        // quote still credits StockAPI (the Worker answers in milliseconds)
        return warmStockapi([symbol]).then(function () { return getQuote(symbol); });
      }
      if (stockapiState === 'down') {
        stockapiState = 'unknown'; // manual retry re-tests a blocked source
        warmStockapi([symbol]);    // fire-and-forget: never stall the retry
      }
      // 'unknown' means a warm is already in flight — let it land
    }
    return getQuote(symbol);
  }

  // -------------------- prefetch --------------------
  // The batch-warmed snapshot is the primary quote input, so warming runs
  // immediately at load; getQuote awaits batchReady before walking.
  var batchReady = null;

  // limited-concurrency runner: chunks overlap a little without hammering
  // the Worker
  function runChunks(items, size, fn) {
    var queue = items.slice();
    function worker() {
      if (!queue.length) return Promise.resolve();
      var item = queue.shift();
      return fn(item).catch(function () {}).then(worker);
    }
    var workers = [];
    for (var k = 0; k < Math.min(size, items.length); k++) workers.push(worker());
    return Promise.all(workers);
  }

  function chunkOf(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function prefetch() {
    var universe = window.SERN.universe || [];
    batchReady = warmStockapi(universe.map(function (u) { return u.symbol; }));
    return batchReady;
  }

  if (window.SERN.universe && window.SERN.universe.length) {
    prefetch();
  }

  window.SERN.yahoo = {
    getQuote: getQuote,
    getChart: getChart,
    getSpark: getSpark,
    getCandles: getCandles,
    refreshQuote: refreshQuote,
    clearCache: clearCache,
    prefetch: prefetch,
    // search.js gates its remote suggestions on this: false means the
    // origin is unreachable this session and remote search would just stall
    stockapiReachable: function () { return stockapiState !== 'down'; },
    // pure parsers exposed so the Node verification harness (run from
    // /tmp, not committed — AGENTS.md defines manual smoke testing) can
    // exercise them outside the DOM
    _test: {
      stockapiSymbol: stockapiSymbol,
      parseStockapiQuotes: parseStockapiQuotes,
      parseStockapiKline: parseStockapiKline,
      parseStockapiCandles: parseStockapiCandles,
      parseStockapiFundamentals: parseStockapiFundamentals,
      stockapiQuote: stockapiQuote,
      resetCooldowns: function () {
        resetSourceCooldowns();
      }
    }
  };
})();
