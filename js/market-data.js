(function () {
  'use strict';

  window.SERN = window.SERN || {};
  var yahooDirect = (window.SERN.providers || {}).yahoo;

  // Multi-source market data orchestrator. Exposes the same interface the
  // rankings page has always consumed (window.SERN.yahoo):
  //   getQuote / getChart / getSpark / refreshQuote
  //
  // Field-level fallback: sources are scanned in priority order
  //   Yahoo -> Tencent -> Eastmoney -> TradingView
  // and each source fills ONLY the fields still missing — a value already
  // fetched from a higher-priority source is never overwritten. This applies
  // both when Yahoo fails outright (lazy walk) and when Yahoo succeeds but
  // individual metrics are null (peek at warmed snapshots only, no extra
  // requests). A circuit breaker short-circuits Yahoo after repeated
  // failures; a per-source cooldown throttles lazy fetches when a fallback
  // source itself is down.

  var CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  var CIRCUIT_THRESHOLD = 6;      // consecutive Yahoo quote failures
  var CIRCUIT_COOLDOWN = 30 * 1000;
  var SOURCE_DOWN_COOLDOWN = 60 * 1000;
  var FALLBACK_SOURCES = ['tencent', 'eastmoney', 'tradingview'];

  // -------------------- cache --------------------
  function cacheGet(key) {
    try {
      var raw = sessionStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.at > CACHE_TTL) {
        sessionStorage.removeItem(key);
        return null;
      }
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: data }));
    } catch (e) { /* quota / private mode: ignore */ }
  }

  function cacheRemove(key) {
    try { sessionStorage.removeItem(key); } catch (e) {}
  }

  // -------------------- circuit breaker (quote chain) --------------------
  var yahooFailures = 0;
  var circuitOpenUntil = 0;

  function circuitOpen() {
    return yahooFailures >= CIRCUIT_THRESHOLD && Date.now() < circuitOpenUntil;
  }
  function recordYahooSuccess() {
    yahooFailures = 0;
    circuitOpenUntil = 0;
  }
  function recordYahooFailure() {
    yahooFailures++;
    if (yahooFailures >= CIRCUIT_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN;
    }
  }
  function resetCircuit() {
    yahooFailures = 0;
    circuitOpenUntil = 0;
  }

  // -------------------- per-source cooldown (lazy fetch throttle) --------------------
  var sourceDownUntil = { tencent: 0, eastmoney: 0, tradingview: 0 };
  function markDown(src) { sourceDownUntil[src] = Date.now() + SOURCE_DOWN_COOLDOWN; }
  function isDown(src) { return Date.now() < sourceDownUntil[src]; }

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
    if (symbol.indexOf('.HK') !== -1) return 'HKD';
    if (symbol.indexOf('.SS') !== -1 || symbol.indexOf('.SZ') !== -1) return 'CNY';
    if (symbol.indexOf('.T') !== -1) return 'JPY';
    if (symbol.indexOf('.KS') !== -1) return 'KRW';
    if (symbol.indexOf('.TW') !== -1) return 'TWD';
    if (symbol.indexOf('.') !== -1) return 'EUR';
    return 'USD';
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

  // -------------------- Tencent Finance (qt.gtimg.cn) --------------------
  // CORS-enabled, GBK-encoded tilde rows; field positions differ by market.
  var txSnapshots = {}; // txCode -> snapshot

  function txCode(symbol) {
    var dot = symbol.indexOf('.');
    if (dot === -1) return 'us' + symbol;                    // US
    var suffix = symbol.slice(dot + 1);
    var code = symbol.slice(0, dot);
    if (suffix === 'SS') return 'sh' + code;
    if (suffix === 'SZ') return 'sz' + code;
    if (suffix === 'HK') return 'hk' + code;
    return null; // .T/.KS/.TW/.PA/.DE not covered by Tencent
  }

  function parseTxLine(body) {
    var f = body.split('~');
    if (f.length < 50) return null;
    var flag = f[0];
    var snap = { price: num(f[3]), prevClose: num(f[4]), pe: null, pb: null, ps: null, marketCap: null, divYield: null };
    if (flag === '200') {          // US
      snap.pe = num(f[39]);
      snap.ps = num(f[47]);
      snap.pb = num(f[51]);
      snap.marketCap = num(f[45]) !== null ? num(f[45]) * 1e8 : null;
      var dy = num(f[52]);
      snap.divYield = dy !== null ? dy / 100 : null;
    } else if (flag === '100') {   // Hong Kong
      snap.pe = num(f[39]);
      snap.marketCap = num(f[45]) !== null ? num(f[45]) * 1e8 : null;
    } else if (flag === '1') {     // A-shares (sh/sz)
      snap.pe = num(f[52]) !== null ? num(f[52]) : num(f[39]); // TTM preferred
      snap.pb = num(f[46]);
      snap.marketCap = num(f[45]) !== null ? num(f[45]) * 1e8 : null;
    } else {
      return null;
    }
    if (snap.price === null) return null;
    return snap;
  }

  function fetchTx(codes) {
    if (!codes.length) return Promise.resolve({});
    var url = 'https://qt.gtimg.cn/q=' + codes.join(',');
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      var text = new TextDecoder('gbk').decode(buf);
      var out = {};
      var re = /v_(\w+)="([^"]*)";/g;
      var m;
      while ((m = re.exec(text))) {
        var snap = parseTxLine(m[2]);
        if (snap) out[m[1]] = snap;
      }
      return out;
    }).catch(function (e) { markDown('tencent'); throw e; });
  }

  function mergeTx(map) {
    Object.keys(map).forEach(function (k) { txSnapshots[k] = map[k]; });
  }

  function ensureTx(symbol) {
    var code = txCode(symbol);
    if (!code) return Promise.resolve(null);
    if (txSnapshots[code]) return Promise.resolve(txSnapshots[code]);
    if (isDown('tencent')) return Promise.resolve(null);
    return fetchTx([code]).then(function (map) {
      mergeTx(map);
      return txSnapshots[code] || null;
    }).catch(function () { return null; });
  }

  function txQuote(symbol, snap) {
    var q = emptyQuote(symbol);
    q.source = 'tencent';
    q.price = snap.price;
    // changePct is always computed within one source — mixing a price from
    // one provider with a previous close from another yields garbage
    q.changePct = (snap.price !== null && snap.prevClose)
      ? (snap.price - snap.prevClose) / snap.prevClose : null;
    q.pe = nonNeg(snap.pe);
    q.pb = nonNeg(snap.pb);
    q.ps = nonNeg(snap.ps);
    q.marketCap = snap.marketCap;
    q.divYield = nonNeg(snap.divYield);
    return q;
  }

  // -------------------- Eastmoney (push2 / push2his) --------------------
  var emSnapshots = {}; // secid -> {price, changePct, marketCap, peTtm, pb}

  function emSecid(symbol) {
    var dot = symbol.indexOf('.');
    if (dot === -1) return null; // US secid is ambiguous (105/106); Tencent covers US
    var suffix = symbol.slice(dot + 1);
    var code = symbol.slice(0, dot);
    if (suffix === 'SS') return '1.' + code;
    if (suffix === 'SZ') return '0.' + code;
    if (suffix === 'HK') return '116.' + code;
    return null;
  }

  function emNum(x) {
    return (typeof x === 'number' && isFinite(x)) ? x : null; // fltt=2 floats; '-' stays a string
  }

  function emFetchUlist(secids, fields) {
    var url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=' +
      fields + '&secids=' + secids.join(',');
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var json = JSON.parse(text);
      if (!json || json.rc !== 0 || !json.data) throw new Error('eastmoney rc ' + (json && json.rc));
      return json.data.diff || [];
    }).catch(function (e) { markDown('eastmoney'); throw e; });
  }

  function emQuoteRow(row) {
    return {
      price: emNum(row.f2),
      changePct: emNum(row.f3) !== null ? row.f3 / 100 : null,
      marketCap: emNum(row.f116),
      peTtm: emNum(row.f162),
      pb: emNum(row.f167)
    };
  }

  function ensureEm(symbol) {
    var secid = emSecid(symbol);
    if (!secid) return Promise.resolve(null);
    if (emSnapshots[secid]) return Promise.resolve(emSnapshots[secid]);
    if (isDown('eastmoney')) return Promise.resolve(null);
    return emFetchUlist([secid], 'f2,f3,f12,f14,f116,f162,f167').then(function (diff) {
      if (diff[0]) emSnapshots[secid] = emQuoteRow(diff[0]);
      return emSnapshots[secid] || null;
    }).catch(function () { return null; });
  }

  function emQuote(symbol, row) {
    var q = emptyQuote(symbol);
    q.source = 'eastmoney';
    q.price = row.price;
    q.changePct = row.changePct;
    q.pe = nonNeg(row.peTtm);
    q.pb = nonNeg(row.pb);
    q.marketCap = row.marketCap;
    return q;
  }

  // -------------------- TradingView (scanner.tradingview.com) --------------------
  // CORS-enabled POST scanner with global fundamentals. Covers every market
  // in the universe, including JP/KR/TW/EU names no other fallback reaches.
  var tvSnapshots = {}; // tvTicker -> column array

  var TV_EXCHANGES = {
    SS: 'SSE', SZ: 'SZSE', HK: 'HKEX', T: 'TSE',
    KS: 'KRX', TW: 'TWSE', PA: 'EURONEXT', DE: 'XETR'
  };

  function tvCandidates(symbol) {
    var dot = symbol.indexOf('.');
    if (dot === -1) return ['NASDAQ:' + symbol, 'NYSE:' + symbol]; // TV returns only the real one
    var suffix = symbol.slice(dot + 1);
    var code = symbol.slice(0, dot);
    var exch = TV_EXCHANGES[suffix];
    if (!exch) return [];
    if (suffix === 'HK') {
      var stripped = parseInt(code, 10); // HKEX:700, not 0700
      if (!isNaN(stripped)) code = String(stripped);
    }
    return [exch + ':' + code];
  }

  var TV_COLUMNS = [
    'name', 'close', 'currency',
    'price_earnings_ttm', 'price_book_fq', 'price_sales_current',
    'enterprise_value_ebitda_ttm',
    'return_on_equity_fq', 'net_margin_ttm', 'debt_to_equity_fq',
    'dividends_yield'
  ];

  function fetchTv(tickers) {
    if (!tickers.length) return Promise.resolve({});
    return fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: { tickers: tickers, query: { types: [] } },
        columns: TV_COLUMNS
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var json = JSON.parse(text);
      var out = {};
      (json && json.data ? json.data : []).forEach(function (row) {
        if (row && row.s && row.d) out[row.s] = row.d;
      });
      return out;
    }).catch(function (e) { markDown('tradingview'); throw e; });
  }

  function mergeTv(map) {
    Object.keys(map).forEach(function (k) { tvSnapshots[k] = map[k]; });
  }

  function ensureTv(symbol) {
    var cands = tvCandidates(symbol);
    if (!cands.length) return Promise.resolve(null);
    for (var i = 0; i < cands.length; i++) {
      if (tvSnapshots[cands[i]]) return Promise.resolve(tvSnapshots[cands[i]]);
    }
    if (isDown('tradingview')) return Promise.resolve(null);
    return fetchTv(cands).then(function (map) {
      mergeTv(map);
      for (var i = 0; i < cands.length; i++) {
        if (tvSnapshots[cands[i]]) return tvSnapshots[cands[i]];
      }
      return null;
    }).catch(function () { return null; });
  }

  function tvQuote(symbol, d) {
    var q = emptyQuote(symbol);
    q.source = 'tradingview';
    q.price = num(d[1]);
    if (d[2]) q.currency = d[2];
    q.pe = nonNeg(num(d[3]));
    q.pb = nonNeg(num(d[4]));
    q.ps = nonNeg(num(d[5]));
    q.evEbitda = nonNeg(num(d[6]));
    q.roe = num(d[7]) !== null ? num(d[7]) / 100 : null;
    q.margin = num(d[8]) !== null ? num(d[8]) / 100 : null;
    q.debtToEquity = num(d[9]); // ratio form (1.18 = 118%)
    var dy = num(d[10]);
    q.divYield = dy !== null ? nonNeg(dy) / 100 : null;
    return q;
  }

  // -------------------- field-level backfill --------------------
  // Every field a fallback source can possibly supply. changePct is
  // source-self-consistent by construction (see txQuote), prevClose is
  // deliberately NOT here: mixing it with another source's price is garbage.
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

  function quoteFrom(source, symbol, lazy) {
    if (source === 'tencent') {
      if (!lazy) {
        var c = txCode(symbol);
        var snap = c && txSnapshots[c];
        return Promise.resolve(snap ? txQuote(symbol, snap) : null);
      }
      return ensureTx(symbol).then(function (s) { return s ? txQuote(symbol, s) : null; });
    }
    if (source === 'eastmoney') {
      if (!lazy) {
        var id = emSecid(symbol);
        var row = id && emSnapshots[id];
        return Promise.resolve(row ? emQuote(symbol, row) : null);
      }
      return ensureEm(symbol).then(function (s) { return s ? emQuote(symbol, s) : null; });
    }
    if (!lazy) {
      var cands = tvCandidates(symbol);
      for (var i = 0; i < cands.length; i++) {
        if (tvSnapshots[cands[i]]) return Promise.resolve(tvQuote(symbol, tvSnapshots[cands[i]]));
      }
      return Promise.resolve(null);
    }
    return ensureTv(symbol).then(function (d) { return d ? tvQuote(symbol, d) : null; });
  }

  // Scan FALLBACK_SOURCES in priority order, filling only null fields of q.
  // lazy=false reads warmed snapshots only (used after a successful Yahoo
  // quote, so the happy path never fires extra requests); lazy=true allows
  // on-demand fetches (used when Yahoo itself failed).
  function backfill(q, contributors, lazy) {
    var chain = Promise.resolve();
    FALLBACK_SOURCES.forEach(function (src) {
      chain = chain.then(function () {
        return quoteFrom(src, q.symbol, lazy).then(function (partial) {
          fillFrom(q, partial, src, contributors);
        });
      });
    });
    return chain.then(function () { return q; });
  }

  // -------------------- public API --------------------
  function getQuote(symbol) {
    var key = 'sern-quote-' + symbol;
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);
    var done = function (q) { cacheSet(key, q); return q; };

    var wasOpen = circuitOpen();
    var yahooAttempt = wasOpen
      ? Promise.reject(new Error('circuit open'))
      : yahooDirect.getQuote(symbol);

    return yahooAttempt.then(function (q) {
      recordYahooSuccess();
      q.source = 'yahoo';
      var contributors = ['yahoo'];
      return backfill(q, contributors, false).then(function (filled) {
        filled.sources = contributors;
        return done(filled);
      });
    }, function () {
      if (!wasOpen) recordYahooFailure();
      var q = emptyQuote(symbol);
      var contributors = [];
      return backfill(q, contributors, true).then(function (filled) {
        if (valuationKeyCount(filled) >= 2) {
          filled.source = contributors[0] || null;
          filled.sources = contributors;
          return done(filled);
        }
        if (filled.price !== null) {
          filled.insufficient = true;
          filled.source = 'price';
          filled.sources = contributors;
          return done(filled);
        }
        throw new Error('all sources failed for ' + symbol);
      });
    });
  }

  var EM_INDEX_SECIDS = {
    '^GSPC': '100.SPX', '^IXIC': '100.NDX', '^HSI': '100.HSI',
    '000300.SS': '1.000300', '^N225': '100.N225'
  };

  function getChart(symbol) {
    var key = 'sern-chart-' + symbol;
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);
    return yahooDirect.getChart(symbol).then(function (out) {
      out.source = 'yahoo';
      cacheSet(key, out);
      return out;
    }, function () {
      if (!EM_INDEX_SECIDS[symbol]) throw new Error('no index fallback for ' + symbol);
      // one batch covers every index; fill all their caches at once
      var secids = Object.keys(EM_INDEX_SECIDS).map(function (k) { return EM_INDEX_SECIDS[k]; });
      return emFetchUlist(secids, 'f2,f3,f4,f12,f14').then(function (diff) {
        var bySecid = {};
        diff.forEach(function (row, i) {
          // ulist rows follow request order; trust f12 when it matches
          bySecid[secids[i]] = row;
        });
        Object.keys(EM_INDEX_SECIDS).forEach(function (yahooSym) {
          var row = bySecid[EM_INDEX_SECIDS[yahooSym]];
          if (row && emNum(row.f2) !== null) {
            cacheSet('sern-chart-' + yahooSym, {
              symbol: yahooSym,
              name: row.f14 || yahooSym,
              price: emNum(row.f2),
              previousClose: null,
              changePct: emNum(row.f3) !== null ? row.f3 / 100 : null,
              currency: null,
              source: 'eastmoney'
            });
          }
        });
        var hit = cacheGet(key);
        if (!hit) throw new Error('index missing in eastmoney batch');
        return hit;
      });
    });
  }

  function emKline(secid) {
    var url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=60';
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var json = JSON.parse(text);
      if (!json || json.rc !== 0 || !json.data || !json.data.klines) throw new Error('eastmoney kline rc');
      var points = [];
      json.data.klines.forEach(function (line) {
        var close = parseFloat(String(line).split(',')[1]);
        if (isFinite(close)) points.push(close);
      });
      if (points.length < 2) throw new Error('kline too short');
      return points;
    });
  }

  function getSpark(symbol) {
    var key = 'sern-spark-' + symbol;
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);
    return yahooDirect.getSpark(symbol).then(function (out) {
      out.source = 'yahoo';
      cacheSet(key, out);
      return out;
    }, function () {
      // A/HK shares have deterministic secids; US kline sits on 105 for
      // Nasdaq names — best effort only, failure just hides the sparkline
      var secid = emSecid(symbol) || (symbol.indexOf('.') === -1 ? '105.' + symbol : null);
      if (!secid) throw new Error('no spark fallback for ' + symbol);
      return emKline(secid).then(function (points) {
        var out = { symbol: symbol, points: points, source: 'eastmoney' };
        cacheSet(key, out);
        return out;
      });
    });
  }

  function refreshQuote(symbol) {
    cacheRemove('sern-quote-' + symbol);
    resetCircuit(); // manual retry expresses intent to try Yahoo again
    return getQuote(symbol);
  }

  // -------------------- prefetch --------------------
  // Batch-warm all three fallback stores so a Yahoo outage degrades instantly.
  function prefetch() {
    var universe = window.SERN.universe || [];
    var codes = [];
    var secids = [];
    var tickers = [];
    universe.forEach(function (u) {
      var c = txCode(u.symbol);
      if (c) codes.push(c);
      var s = emSecid(u.symbol);
      if (s) secids.push(s);
      tvCandidates(u.symbol).forEach(function (t) { tickers.push(t); });
    });

    var chain = Promise.resolve();
    var i;
    for (i = 0; i < codes.length; i += 40) {
      (function (chunk) {
        chain = chain.then(function () {
          return fetchTx(chunk).then(mergeTx).catch(function () {});
        });
      })(codes.slice(i, i + 40));
    }
    for (i = 0; i < tickers.length; i += 50) {
      (function (chunk) {
        chain = chain.then(function () {
          return fetchTv(chunk).then(mergeTv).catch(function () {});
        });
      })(tickers.slice(i, i + 50));
    }
    chain = chain.then(function () {
      if (!secids.length) return;
      return emFetchUlist(secids, 'f2,f3,f12,f14,f116,f162,f167').then(function (diff) {
        diff.forEach(function (row, i2) {
          if (secids[i2] && row) emSnapshots[secids[i2]] = emQuoteRow(row);
        });
      }).catch(function () {});
    });
    return chain;
  }

  if (window.SERN.universe && window.SERN.universe.length) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function () { prefetch(); });
    } else {
      setTimeout(function () { prefetch(); }, 0);
    }
  }

  window.SERN.yahoo = {
    getQuote: getQuote,
    getChart: getChart,
    getSpark: getSpark,
    refreshQuote: refreshQuote,
    prefetch: prefetch
  };
})();
