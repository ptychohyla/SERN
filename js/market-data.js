(function () {
  'use strict';

  window.SERN = window.SERN || {};
  var yahooDirect = (window.SERN.providers || {}).yahoo;

  // Multi-source market data orchestrator. Exposes the same interface the
  // markets page has always consumed (window.SERN.yahoo):
  //   getQuote / getChart / getSpark / refreshQuote
  //
  // Quote chain, strict priority with field-level fill — each source fills
  // ONLY the fields still missing, a value set by a higher-priority source
  // is never overwritten:
  //   StockAPI -> Tencent -> Eastmoney -> TradingView -> THS -> Yahoo (last resort)
  // Yahoo sits last: it is the flakiest (rate limits) and the only source
  // fetched per-symbol; it still uniquely supplies forwardPe/peg/fcf for
  // names the CN sources don't cover. The batch-warmed snapshots
  // (prefetch) are the primary input — getQuote waits for that warm so
  // the walk reads snapshots instead of firing one request per symbol per
  // source. A circuit breaker short-circuits Yahoo after repeated
  // failures; a per-source cooldown throttles sources that go down.
  // StockAPI (self-hosted Cloudflare Worker) warms OFF that critical path
  // behind a session availability flag — see its section below.

  var CIRCUIT_THRESHOLD = 6;      // consecutive Yahoo quote failures
  var CIRCUIT_COOLDOWN = 30 * 1000;
  var SOURCE_DOWN_COOLDOWN = 60 * 1000;
  var QUOTE_SOURCES = ['stockapi', 'tencent', 'eastmoney', 'tradingview', 'ths', 'yahoo'];

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

  var DATA_KEY_PREFIXES = ['sern-quote-', 'sern-chart-', 'sern-spark-'];

  // Force refresh: wipe every data cache (but never user preferences),
  // clear in-memory snapshots and the circuit breaker, then re-warm.
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
    txSnapshots = {};
    emSnapshots = {};
    tvSnapshots = {};
    thsSnapshots = {};
    stockapiSnapshots = {};
    stockapiState = 'unknown';
    resetCircuit();
    return prefetch();
  }

  // -------------------- circuit breaker (yahoo, last resort) --------------------
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
  var sourceDownUntil = { stockapi: 0, tencent: 0, eastmoney: 0, tradingview: 0, ths: 0 };
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
    if (suffix === 'KS') return 'KRW';
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

  // -------------------- Tencent Finance (qt.gtimg.cn) --------------------
  // CORS-enabled, GBK-encoded tilde rows; field positions differ by market.
  var txSnapshots = {}; // txCode -> snapshot

  // HK codes are 5 digits on both Tencent (hk00700) and Eastmoney
  // (116.00700); the universe writes them 4-digit (0700.HK). 4-digit forms
  // silently match nothing on either API.
  function hkPad(code) {
    while (code.length < 5) code = '0' + code;
    return code;
  }

  // US ADR/OTC equivalents for markets whose direct Tencent rows omit
  // valuation ratios. Ratios are currency-neutral, so they can fill the
  // local quote; ADR prices/market caps are deliberately not used.
  var TX_ADR_SYMBOLS = {
    '7203.T': 'TM',
    '6758.T': 'SONY',
    '9984.T': 'SFTBY',
    '8306.T': 'MUFG',
    '005930.KS': 'SSNLF',
    '000660.KS': 'SKHY',
    '035420.KS': 'NHNCF',
    '2330.TW': 'TSM',
    'MC.PA': 'LVMUY',
    'SAP.DE': 'SAP'
  };

  function txCode(symbol) {
    var dot = symbol.indexOf('.');
    if (dot === -1) {
      // Tencent uses a dot for Berkshire classes (BRK.B), Yahoo uses a hyphen.
      return 'us' + symbol.replace('-', '.');                // US
    }
    var suffix = symbol.slice(dot + 1);
    var code = symbol.slice(0, dot);
    if (suffix === 'SS') return 'sh' + code;
    if (suffix === 'SZ') return 'sz' + code;
    if (suffix === 'HK') return 'hk' + hkPad(code);
    if (suffix === 'T') return 'jp' + code;
    if (suffix === 'KS') return 'kr' + code;
    return null; // .TW/.PA/.DE direct rows not covered; ADR map supplies ratios
  }

  function txAdrCode(symbol) {
    var adr = TX_ADR_SYMBOLS[symbol];
    return adr ? 'us' + adr : null;
  }

  function txEmptySnap() {
    return {
      price: null, prevClose: null, currency: null,
      pe: null, forwardPe: null, pb: null, ps: null,
      marketCap: null, peg: null, divYield: null,
      margin: null, earningsGrowth: null, revenueGrowth: null
    };
  }

  function parseTxLine(body) {
    var f = body.split('~');
    if (f.length < 50) return null;
    var flag = f[0];
    var snap = txEmptySnap();
    snap.price = num(f[3]);
    snap.prevClose = num(f[4]);
    if (flag === '200') {          // US / ADR
      snap.pe = num(f[39]);
      snap.forwardPe = num(f[57]);
      snap.pb = num(f[51]);
      snap.peg = num(f[66]);
      snap.marketCap = num(f[45]) !== null ? num(f[45]) * 1e8 : null;
      var dy = num(f[52]);
      snap.divYield = dy !== null ? dy / 100 : null;
      snap.margin = num(f[65]) !== null ? num(f[65]) / 100 : null;
      snap.revenueGrowth = num(f[59]) !== null ? num(f[59]) / 100 : null;
      snap.earningsGrowth = num(f[60]) !== null ? num(f[60]) / 100 : null;
      // f47 is EPS (price / EPS = f39), not PS; the quote endpoint has no PS.
    } else if (flag === '100') {   // Hong Kong
      snap.pe = num(f[39]);
      snap.marketCap = num(f[45]) !== null ? num(f[45]) * 1e8 : null;
    } else if (flag === '1') {     // A-shares (sh/sz)
      snap.pe = num(f[52]) !== null ? num(f[52]) : num(f[39]); // TTM preferred
      snap.pb = num(f[46]);
      snap.marketCap = num(f[45]) !== null ? num(f[45]) * 1e8 : null;
    } else if (flag === '351' || flag === '352') { // Japan / Korea
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
      var re = /v_([a-zA-Z0-9_.]+)="([^"]*)";/g;
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

  var TX_ADR_FILL_KEYS = ['pe', 'forwardPe', 'pb', 'peg', 'divYield',
    'margin', 'earningsGrowth', 'revenueGrowth'];

  function fillTxSnap(target, adr) {
    TX_ADR_FILL_KEYS.forEach(function (k) {
      if (target[k] === null && adr[k] !== null && adr[k] !== undefined) {
        target[k] = adr[k];
      }
    });
  }

  function snapshotTxCode(code) {
    if (!code) return Promise.resolve(null);
    if (txSnapshots[code]) return Promise.resolve(txSnapshots[code]);
    if (isDown('tencent')) return Promise.resolve(null);
    return fetchTx([code]).then(function (map) {
      mergeTx(map);
      return txSnapshots[code] || null;
    }).catch(function () { return null; });
  }

  function ensureTx(symbol) {
    var localCode = txCode(symbol);
    var adrCode = txAdrCode(symbol);
    if (!localCode && !adrCode) return Promise.resolve(null);
    return Promise.all([
      snapshotTxCode(localCode),
      snapshotTxCode(adrCode)
    ]).then(function (parts) {
      var snap = parts[0] ? Object.assign(txEmptySnap(), parts[0]) : txEmptySnap();
      if (parts[1]) {
        fillTxSnap(snap, parts[1]);
        if (!parts[0]) {
          // No direct local row (and Eastmoney is rate-limited/unavailable).
          // The same Tencent response still carries a valid US ADR quote.
          snap.currency = 'USD';
          snap.price = parts[1].price;
          snap.marketCap = parts[1].marketCap;
        }
      }
      return snap;
    });
  }

  function txQuote(symbol, snap) {
    var q = emptyQuote(symbol);
    q.source = 'tencent';
    if (snap.currency) q.currency = snap.currency;
    q.price = snap.price;
    // changePct is always computed within one source — mixing a price from
    // one provider with a previous close from another yields garbage
    q.changePct = (snap.price !== null && snap.prevClose)
      ? (snap.price - snap.prevClose) / snap.prevClose : null;
    q.pe = nonNeg(snap.pe);
    q.forwardPe = nonNeg(snap.forwardPe);
    q.pb = nonNeg(snap.pb);
    q.ps = nonNeg(snap.ps);
    q.peg = nonNeg(snap.peg);
    q.marketCap = snap.marketCap;
    q.divYield = nonNeg(snap.divYield);
    q.margin = nonNeg(snap.margin);
    q.earningsGrowth = nonNeg(snap.earningsGrowth);
    q.revenueGrowth = nonNeg(snap.revenueGrowth);
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
    if (suffix === 'HK') return '116.' + hkPad(code);
    if (suffix === 'T') return '176.' + code;
    if (suffix === 'KS') return '177.' + code;
    if (suffix === 'TW') return '178.' + code;
    if (suffix === 'DE') return '185.' + code;
    if (suffix === 'PA') return '186.' + code;
    return null;
  }

  function emIsGlobal(secid) {
    return /^(176|177|178|185|186)\./.test(secid);
  }

  function emNum(x) {
    return (typeof x === 'number' && isFinite(x)) ? x : null; // fltt=2 floats; '-' stays a string
  }

  // Rows are keyed by secid rebuilt from f13.f12 — eastmoney OMITS rows for
  // secids it doesn't recognize, so positional mapping would silently shift
  // later rows onto the wrong symbols. Field map probed live 2026-10-03:
  // f2 price, f3 changePct, f9 PE(动), f20 总市值, f23 PB — the f116/f162/
  // f167 fields used before return '-' or unrelated values from ulist.
  function emFetchUlist(secids, fields) {
    var url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=' +
      fields + '&secids=' + secids.join(',');
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var json = JSON.parse(text);
      if (!json || json.rc !== 0 || !json.data) throw new Error('eastmoney rc ' + (json && json.rc));
      var wanted = {};
      secids.forEach(function (s) { wanted[s] = true; });
      var out = {};
      (json.data.diff || []).forEach(function (row) {
        if (!row) return;
        var key = String(row.f13) + '.' + row.f12;
        if (wanted[key]) out[key] = row;
      });
      return out;
    }).catch(function (e) { markDown('eastmoney'); throw e; });
  }

  function emQuoteRow(row) {
    return {
      price: emNum(row.f2),
      changePct: emNum(row.f3) !== null ? row.f3 / 100 : null,
      marketCap: emNum(row.f20),
      pe: emNum(row.f9),
      pb: emNum(row.f23)
    };
  }

  // Global markets do not reliably answer ulist; the single-stock endpoint
  // supplies local price, market cap and PB. f162 PE is commonly '-'.
  function emFetchStock(secid, suppressMarkdown) {
    var url = 'https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2' +
      '&fields=f43,f60,f116,f167&secid=' + secid;
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var json = JSON.parse(text);
      if (!json || json.rc !== 0 || !json.data) throw new Error('eastmoney stock rc');
      var row = json.data;
      var price = emNum(row.f43);
      var prevClose = emNum(row.f60);
      return {
        price: price,
        changePct: (price !== null && prevClose) ? (price - prevClose) / prevClose : null,
        marketCap: emNum(row.f116),
        pe: null,
        pb: emNum(row.f167)
      };
    }).catch(function (e) {
      if (!suppressMarkdown) markDown('eastmoney');
      throw e;
    });
  }

  function ensureEm(symbol) {
    var secid = emSecid(symbol);
    if (!secid) return Promise.resolve(null);
    if (emSnapshots[secid]) return Promise.resolve(emSnapshots[secid]);
    if (isDown('eastmoney')) return Promise.resolve(null);
    if (emIsGlobal(secid)) {
      return emFetchStock(secid).then(function (row) {
        emSnapshots[secid] = row;
        return row;
      }).catch(function () { return null; });
    }
    return emFetchUlist([secid], 'f2,f3,f9,f12,f13,f20,f23').then(function (map) {
      if (map[secid]) emSnapshots[secid] = emQuoteRow(map[secid]);
      return emSnapshots[secid] || null;
    }).catch(function () { return null; });
  }

  function emQuote(symbol, row) {
    var q = emptyQuote(symbol);
    q.source = 'eastmoney';
    q.price = row.price;
    q.changePct = row.changePct;
    q.pe = nonNeg(row.pe);
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

  // -------------------- THS F10 (basic.10jqka.com.cn) --------------------
  // The JSON API behind akshare's stock_financial_abstract_ths: CORS-open,
  // A-shares only, no cookie needed (any browser UA passes its UA filter).
  // Its unique value here is revenue/earnings YoY growth, which no other
  // fallback supplies for CN names. Growth is a scale-free ratio and comes
  // from the latest REPORT period; roe/margin/debt come from the ANNUAL
  // matrix so their magnitude matches the TTM/fq figures of the
  // higher-priority sources.
  var thsSnapshots = {}; // code -> fundamentals snapshot

  function thsCode(symbol) {
    var dot = symbol.indexOf('.');
    if (dot === -1) return null;
    var suffix = symbol.slice(dot + 1);
    if (suffix !== 'SS' && suffix !== 'SZ') return null;
    return symbol.slice(0, dot);
  }

  // THS values are Chinese-formatted strings: "445.17亿", "-1.95%", "--"
  function parseThsNumber(str) {
    if (typeof str !== 'string') return null;
    var s = str.replace(/,/g, '').trim();
    if (!s || s === '--' || s === '-') return null;
    var isPct = false;
    if (s.charAt(s.length - 1) === '%') {
      isPct = true;
      s = s.slice(0, -1);
    }
    var mult = 1;
    var last = s.charAt(s.length - 1);
    if (last === '亿') { mult = 1e8; s = s.slice(0, -1); }
    else if (last === '万') { mult = 1e4; s = s.slice(0, -1); }
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return { value: n * mult, isPct: isPct };
  }

  // fd.title[] and the report/year matrices are row-aligned; matrix row 0
  // lists periods newest-first, so column 0 of a row is its latest value.
  function thsRowLatest(fd, matrix, indicator) {
    var titles = fd.title || [];
    var rows = fd[matrix] || [];
    for (var i = 0; i < titles.length; i++) {
      var t = titles[i];
      var name = t instanceof Array ? t[0] : t;
      if (name === indicator) {
        var row = rows[i];
        return (row && row.length) ? row[0] : null;
      }
    }
    return null;
  }

  function thsPercent(str) { // "32.53%" -> 0.3253
    var p = parseThsNumber(str);
    return p ? p.value / 100 : null;
  }

  function parseThsFinance(body) {
    var raw;
    try { raw = JSON.parse(body); } catch (e) { return null; }
    if (!raw || typeof raw.flashData !== 'string') return null;
    var fd;
    try { fd = JSON.parse(raw.flashData); } catch (e) { return null; }
    var de = parseThsNumber(thsRowLatest(fd, 'year', '产权比率'));
    return {
      earningsGrowth: thsPercent(thsRowLatest(fd, 'report', '净利润同比增长率')),
      revenueGrowth: thsPercent(thsRowLatest(fd, 'report', '营业总收入同比增长率')),
      roe: thsPercent(thsRowLatest(fd, 'year', '净资产收益率')),
      margin: thsPercent(thsRowLatest(fd, 'year', '销售净利率')),
      // 产权比率 comes as a ratio (0.20 = 20%) but may carry a % sign on
      // other names; store as a percent-number to match Yahoo's
      // debtToEquity scale (148.5 = 148.5%)
      debtToEquity: de ? (de.isPct ? de.value : de.value * 100) : null
    };
  }

  function fetchThs(code) {
    var url = 'https://basic.10jqka.com.cn/api/stock/finance/' + code + '_main.json';
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      // a symbol THS doesn't cover answers with a parameter-error JSON —
      // that is not a source outage, resolve null without tripping cooldown
      return parseThsFinance(text);
    }).catch(function (e) { markDown('ths'); throw e; });
  }

  var thsInflight = {}; // dedup: background warm and quote walk can overlap
  function ensureThs(symbol) {
    var code = thsCode(symbol);
    if (!code) return Promise.resolve(null);
    if (thsSnapshots[code]) return Promise.resolve(thsSnapshots[code]);
    if (isDown('ths')) return Promise.resolve(null);
    if (!thsInflight[code]) {
      thsInflight[code] = fetchThs(code).then(function (snap) {
        delete thsInflight[code];
        if (snap) thsSnapshots[code] = snap;
        return thsSnapshots[code] || null;
      }, function () {
        delete thsInflight[code];
        return null;
      });
    }
    return thsInflight[code];
  }

  function thsQuote(symbol, snap) {
    var q = emptyQuote(symbol);
    q.source = 'ths';
    q.earningsGrowth = snap.earningsGrowth;
    q.revenueGrowth = snap.revenueGrowth;
    q.roe = snap.roe;
    q.margin = snap.margin;
    q.debtToEquity = snap.debtToEquity;
    return q;
  }

  // -------------------- StockAPI (stockapi.hinsyeow.workers.dev) --------------------
  // Self-hosted Cloudflare Worker aggregating Eastmoney + Yahoo server-side.
  // Covers US/CN/HK (126 of the 136 universe symbols) with price/changePct
  // only — valuation fields still come from the rest of the chain. Batch
  // quotes warm in the background OFF the batchReady critical path and
  // behind a session availability flag: *.workers.dev is blocked on some
  // networks, where the warm settles with zero successes and the source is
  // flagged 'down' for the rest of the session instead of stalling quotes.
  var stockapiSnapshots = {}; // internal symbol -> {price, changePct}
  var stockapiState = 'unknown'; // 'unknown' | 'ready' | 'down'
  var STOCKAPI_ORIGIN = 'https://stockapi.hinsyeow.workers.dev';
  // Abort budget must exceed the Worker's own worst case (2 providers x 3s
  // upstream timeout + overhead), else a slow-but-healthy Worker looks blocked
  var STOCKAPI_TIMEOUT = 8000;
  var STOCKAPI_BATCH = 20;     // API hard limit per /v1/quote request

  function stockapiSymbol(symbol) {
    var dot = symbol.indexOf('.');
    // US must carry the explicit .US suffix: the Worker normalizes responses
    // to canonical form (AAPL -> AAPL.US), so a bare code never matches back
    if (dot === -1) return symbol + '.US';
    var suffix = symbol.slice(dot + 1);
    var code = symbol.slice(0, dot);
    if (suffix === 'SS') return code + '.SH';
    if (suffix === 'SZ') return code + '.SZ';
    if (suffix === 'HK') return hkPad(code) + '.HK';
    return null; // .T/.KS/.TW/.PA/.DE not covered by the Worker
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
  // is dropped too: price+changePct stay pair-or-nothing, so a fallback
  // source never computes a changePct against a different source's price.
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
        return p.canonical;
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
    var url = STOCKAPI_ORIGIN + '/v1/kline/' + canonical + '?period=daily&adjust=qfq&limit=60';
    return fetchStockapi(url).then(function (text) {
      var points = parseStockapiKline(text);
      if (!points) throw new Error('stockapi kline too short');
      return points;
    });
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

  // ensure* reads the warmed snapshot first and only fetches on a miss, so
  // the walk costs nothing once prefetch has run.
  function quoteFrom(source, symbol) {
    if (source === 'stockapi') {
      // warm-only: no per-symbol lazy fetch, so the walk never stalls on a
      // cold or blocked StockAPI — a miss simply falls through the chain
      return Promise.resolve(stockapiQuote(symbol));
    }
    if (source === 'tencent') {
      return ensureTx(symbol).then(function (s) { return s ? txQuote(symbol, s) : null; });
    }
    if (source === 'eastmoney') {
      return ensureEm(symbol).then(function (s) { return s ? emQuote(symbol, s) : null; });
    }
    if (source === 'tradingview') {
      return ensureTv(symbol).then(function (d) { return d ? tvQuote(symbol, d) : null; });
    }
    if (source === 'ths') {
      return ensureThs(symbol).then(function (s) { return s ? thsQuote(symbol, s) : null; });
    }
    // yahoo: per-symbol only, never pre-warmed, circuit-broken
    if (!yahooDirect || circuitOpen()) return Promise.resolve(null);
    return yahooDirect.getQuote(symbol).then(function (yq) {
      recordYahooSuccess();
      return yq;
    }, function () {
      recordYahooFailure();
      return null;
    });
  }

  // Scan QUOTE_SOURCES in priority order, filling only null fields of q.
  function backfill(q, contributors) {
    var chain = Promise.resolve();
    QUOTE_SOURCES.forEach(function (src) {
      chain = chain.then(function () {
        return quoteFrom(src, q.symbol).then(function (partial) {
          fillFrom(q, partial, src, contributors);
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

    // Wait for the batch warm (tencent/eastmoney/tradingview) so the walk
    // reads snapshots instead of firing one request per symbol per source.
    // THS warms off the critical path; its ensure dedups against the walk.
    // StockAPI is read-only from its warm snapshot (see quoteFrom).
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

  var EM_INDEX_SECIDS = {
    '^GSPC': '100.SPX', '^IXIC': '100.NDX', '^HSI': '100.HSI',
    '000300.SS': '1.000300', '^N225': '100.N225'
  };

  // Eastmoney index batch — one request covers every index and fills all
  // their caches at once. Primary for charts; Yahoo is the fallback.
  function emIndexChart(symbol) {
    if (!EM_INDEX_SECIDS[symbol]) return Promise.reject(new Error('no eastmoney index for ' + symbol));
    var secids = Object.keys(EM_INDEX_SECIDS).map(function (k) { return EM_INDEX_SECIDS[k]; });
    return emFetchUlist(secids, 'f2,f3,f4,f12,f13,f14').then(function (map) {
      Object.keys(EM_INDEX_SECIDS).forEach(function (yahooSym) {
        var row = map[EM_INDEX_SECIDS[yahooSym]];
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
      var hit = cacheEntry('sern-chart-' + symbol);
      if (!hit) throw new Error('index missing in eastmoney batch');
      return hit.data;
    });
  }

  function getChart(symbol) {
    var key = 'sern-chart-' + symbol;
    var hit = cacheEntry(key);
    if (hit) return Promise.resolve(hit.data);
    return emIndexChart(symbol).then(null, function () {
      return yahooDirect.getChart(symbol).then(function (out) {
        out.source = 'yahoo';
        cacheSet(key, out);
        return out;
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

  // Tencent ifzq kline — the endpoint behind akshare's stock_zh_a_hist_tx /
  // stock_hk_hist_tx. CORS-open; A-shares answer with qfqday (前复权),
  // HK/US with day. Solid for A/HK; US responses are sparse, where a
  // too-short result simply hides the sparkline as before.
  function parseIfzqKline(text, code) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return []; }
    var node = json && json.data && json.data[code];
    if (!node) return [];
    var rows = node.qfqday || node.day || [];
    var dated = [];
    rows.forEach(function (r) {
      var close = parseFloat(r[2]); // [date, open, close, high, low, volume, ...]
      if (r[0] && isFinite(close)) dated.push([String(r[0]), close]);
    });
    // defensive: US responses can prepend a stray first-ever bar
    dated.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return dated.slice(-60).map(function (r) { return r[1]; });
  }

  function ifzqKline(symbol) {
    // txCode already yields the 5-digit HK form (hk00700) ifzq requires
    var code = txCode(symbol);
    if (!code) return Promise.reject(new Error('no ifzq code for ' + symbol));
    var url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' +
      code + ',day,,,60,qfq';
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var points = parseIfzqKline(text, code);
      if (points.length < 2) throw new Error('ifzq kline too short');
      return points;
    });
  }

  // Spark chain: StockAPI kline -> Eastmoney -> Tencent ifzq -> Yahoo.
  // For JP/KR/TW/EU names StockAPI and the first two reject instantly, so
  // Yahoo still effectively serves them.
  function getSpark(symbol) {
    var key = 'sern-spark-' + symbol;
    var hit = cacheEntry(key);
    if (hit) return Promise.resolve(hit.data);
    function store(points, source) {
      var out = { symbol: symbol, points: points, source: source };
      cacheSet(key, out);
      return out;
    }
    function fallbackChain() {
      // A/HK shares have deterministic secids; US kline sits on 105 for
      // Nasdaq names — best effort only, failure moves down the chain
      var secid = emSecid(symbol) || (symbol.indexOf('.') === -1 ? '105.' + symbol : null);
      var emAttempt = secid ? emKline(secid) : Promise.reject(new Error('no eastmoney kline for ' + symbol));
      return emAttempt.then(function (points) {
        return store(points, 'eastmoney');
      }, function () {
        return ifzqKline(symbol).then(function (points) {
          return store(points, 'tencent');
        }, function () {
          return yahooDirect.getSpark(symbol).then(function (out) {
            out.source = 'yahoo';
            cacheSet(key, out);
            return out;
          });
        });
      });
    }
    // StockAPI is warm-gated like quotes; its own per-symbol upstream miss
    // (HTTP error) falls through, only network-level errors cool it down
    var stockapiAttempt = (stockapiState === 'ready' && !isDown('stockapi') && stockapiSymbol(symbol))
      ? stockapiKline(symbol).then(function (points) { return store(points, 'stockapi'); })
      : Promise.reject(new Error('stockapi not used'));
    return stockapiAttempt.then(null, function (err) {
      if (err && err.network) markDown('stockapi');
      return fallbackChain();
    });
  }

  function refreshQuote(symbol) {
    cacheRemove('sern-quote-' + symbol);

    // Manual retry must re-run the full chain for this symbol instead of
    // reusing warmed snapshots or honoring a source's recent cooldown.
    [txCode(symbol), txAdrCode(symbol)].forEach(function (code) {
      if (code) delete txSnapshots[code];
    });
    var secid = emSecid(symbol);
    if (secid) delete emSnapshots[secid];
    tvCandidates(symbol).forEach(function (ticker) {
      delete tvSnapshots[ticker];
    });
    var ths = thsCode(symbol);
    if (ths) delete thsSnapshots[ths];

    resetCircuit();
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
  // The batch-warmed snapshots are the PRIMARY quote input (Yahoo-last
  // chain), so warming runs immediately at load, not on idle. The three
  // batchable sources warm in parallel; getQuote awaits batchReady.
  // THS can't batch — it warms sequentially in the background, off the
  // critical path (getQuote's ensureThs dedups against this warm).
  // StockAPI batches but also warms off-path, behind its session flag.
  var batchReady = null;

  // limited-concurrency runner: strictly sequential chunks made the batch
  // warm the critical-path bottleneck for the first quote (Yahoo-last
  // chain), so chunks overlap a little without hammering any one host
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
    var codes = [];
    var secids = [];
    var tickers = [];
    universe.forEach(function (u) {
      var c = txCode(u.symbol);
      if (c) codes.push(c);
      var a = txAdrCode(u.symbol);
      if (a) codes.push(a);
      var s = emSecid(u.symbol);
      if (s) secids.push(s);
      tvCandidates(u.symbol).forEach(function (t) { tickers.push(t); });
    });
    codes = codes.filter(function (code, i) {
      return codes.indexOf(code) === i;
    });

    var txChain = runChunks(chunkOf(codes, 40), 3, function (chunk) {
      return fetchTx(chunk).then(mergeTx);
    });
    var tvChain = runChunks(chunkOf(tickers, 50), 3, function (chunk) {
      return fetchTv(chunk).then(mergeTv);
    });
    var emTasks = [];
    var domesticSecids = secids.filter(function (secid) { return !emIsGlobal(secid); });
    var globalSecids = secids.filter(emIsGlobal);
    if (domesticSecids.length) {
      emTasks.push(
        emFetchUlist(domesticSecids, 'f2,f3,f9,f12,f13,f14,f20,f23').then(function (map) {
          Object.keys(map).forEach(function (secid) {
            emSnapshots[secid] = emQuoteRow(map[secid]);
          });
        })
      );
    }
    if (globalSecids.length) {
      // The single-stock endpoint rate-limits bursts. Warm sequentially with
      // a small gap; suppress its cooldown so one transient Empty reply does
      // skip the remaining markets. Lazy per-symbol fetches still mark down.
      var globalChain = Promise.resolve();
      globalSecids.forEach(function (secid) {
        globalChain = globalChain.then(function () {
          return emFetchStock(secid, true).then(function (row) {
            emSnapshots[secid] = row;
          }).catch(function () {}).then(function () {
            return new Promise(function (resolve) { setTimeout(resolve, 700); });
          });
        });
      });
      emTasks.push(globalChain);
    }
    var emChain = emTasks.length ? Promise.all(emTasks).catch(function () {}) : Promise.resolve();

    batchReady = Promise.all([txChain, tvChain, emChain]);

    // THS warms one symbol at a time in the background. ensureThs never
    // rejects and respects the source cooldown, so a THS outage shortens
    // the remaining chain instead of hammering the host.
    var thsChain = Promise.resolve();
    universe.forEach(function (u) {
      if (thsCode(u.symbol)) {
        thsChain = thsChain.then(function () { return ensureThs(u.symbol); });
      }
    });

    // StockAPI warms off the critical path too: snapshots feed the top of
    // the quote chain, but on networks that block workers.dev the warm
    // aborts once and flips to 'down' — batchReady never waits for it.
    warmStockapi(universe.map(function (u) { return u.symbol; }));

    return batchReady;
  }

  if (window.SERN.universe && window.SERN.universe.length) {
    prefetch();
  }

  window.SERN.yahoo = {
    getQuote: getQuote,
    getChart: getChart,
    getSpark: getSpark,
    refreshQuote: refreshQuote,
    clearCache: clearCache,
    prefetch: prefetch,
    // search.js gates its remote suggestions on this: false means workers.dev
    // is unreachable this session and remote search would just stall
    stockapiReachable: function () { return stockapiState !== 'down'; },
    // pure parsers exposed so the Node verification harness (run from
    // /tmp, not committed — AGENTS.md defines manual smoke testing) can
    // exercise them outside the DOM
    _test: {
      thsCode: thsCode,
      parseThsNumber: parseThsNumber,
      parseThsFinance: parseThsFinance,
      thsQuote: thsQuote,
      stockapiSymbol: stockapiSymbol,
      parseStockapiQuotes: parseStockapiQuotes,
      parseStockapiKline: parseStockapiKline,
      stockapiQuote: stockapiQuote,
      txCode: txCode,
      emSecid: emSecid,
      parseIfzqKline: parseIfzqKline,
      emFetchUlist: emFetchUlist,
      emQuoteRow: emQuoteRow,
      resetCooldowns: function () {
        resetSourceCooldowns();
      }
    }
  };
})();
