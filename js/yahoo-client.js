(function () {
  'use strict';

  window.SERN = window.SERN || {};
  window.SERN.providers = window.SERN.providers || {};

  // Raw Yahoo Finance provider: no caching, no degradation — js/market-data.js
  // owns caching, the fallback chain and the circuit breaker.

  var MAX_ATTEMPTS = 3;
  var crumbPromise = null;

  // -------------------- http helpers --------------------
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function fetchText(url, useCredentials) {
    return fetch(url, {
      credentials: useCredentials ? 'include' : 'omit',
      headers: { 'Accept': 'application/json,text/plain,*/*' }
    }).then(function (res) {
      if (res.status === 429) {
        var err429 = new Error('rate limited');
        err429.limited = true;
        throw err429;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function fetchJson(url, attempt, useCredentials, alternate) {
    return fetchText(url, useCredentials).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('bad JSON');
      }
    }).catch(function (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      var wait = 500 * Math.pow(2, attempt) + Math.random() * 400;
      return delay(wait).then(function () {
        var nextUrl = alternate ? alternate(url) : url;
        return fetchJson(nextUrl, attempt + 1, useCredentials, alternate);
      });
    });
  }

  function swapHost(url) {
    if (url.indexOf('query1.') !== -1) return url.replace('query1.', 'query2.');
    if (url.indexOf('query2.') !== -1) return url.replace('query2.', 'query1.');
    return url;
  }

  // -------------------- crumb --------------------
  function getCrumb() {
    if (crumbPromise) return crumbPromise;
    crumbPromise = Promise.resolve()
      .then(function () {
        // Obtain the A3 session cookie; ignore failures (endpoint may lack CORS headers).
        return fetch('https://fc.yahoo.com', { credentials: 'include', mode: 'cors' }).catch(function () {});
      })
      .then(function () {
        return fetchText('https://query2.finance.yahoo.com/v1/test/getcrumb', true);
      })
      .then(function (text) {
        var crumb = (text || '').trim();
        if (!crumb || crumb.length > 40) throw new Error('invalid crumb');
        return crumb;
      })
      .catch(function () {
        crumbPromise = null;
        return '';
      });
    return crumbPromise;
  }

  // -------------------- field extraction --------------------
  function raw(obj, key) {
    if (obj && obj[key] && typeof obj[key].raw === 'number' && isFinite(obj[key].raw)) {
      return obj[key].raw;
    }
    return null;
  }

  // negative valuation ratios mean losses/negative equity, not cheapness;
  // treat them as missing so they cannot top a lower-is-cheaper percentile
  function nonNegative(x) {
    return (typeof x === 'number' && x < 0) ? null : x;
  }

  function normalize(symbol, json) {
    var qs = json.quoteSummary || {};
    if (qs.error) throw new Error('quoteSummary error');
    var results = qs.result || [];
    if (!results[0]) throw new Error('quoteSummary empty result');
    var data = results[0];
    var price = data.price || {};
    var stats = data.defaultKeyStatistics || {};
    var fin = data.financialData || {};
    var detail = data.summaryDetail || {};

    var marketCap = raw(price, 'marketCap');
    var fcf = raw(fin, 'freeCashflow');
    var out = {
      symbol: symbol,
      name: price.longName || price.shortName || symbol,
      currency: price.currency || null,
      price: raw(price, 'regularMarketPrice'),
      marketCap: marketCap,
      pe: nonNegative(raw(detail, 'trailingPE')),
      forwardPe: nonNegative(raw(stats, 'forwardPE')),
      pb: nonNegative(raw(stats, 'priceToBook')),
      ps: raw(stats, 'priceToSalesTrailing12Months'),
      evEbitda: nonNegative(raw(stats, 'enterpriseToEbitda')),
      peg: nonNegative(raw(stats, 'pegRatio')),
      divYield: nonNegative(raw(detail, 'dividendYield')),
      roe: raw(fin, 'returnOnEquity'),
      margin: raw(fin, 'profitMargins'),
      fcf: fcf,
      fcfYield: (fcf !== null && marketCap) ? fcf / marketCap : null,
      earningsGrowth: raw(fin, 'earningsGrowth'),
      revenueGrowth: raw(fin, 'revenueGrowth'),
      debtToEquity: raw(fin, 'debtToEquity'),
      insufficient: false
    };
    if (out.pe === null) out.pe = nonNegative(raw(stats, 'trailingPE'));
    if (out.divYield === null) out.divYield = nonNegative(raw(stats, 'trailingAnnualDividendYield'));
    return out;
  }

  // -------------------- chart API --------------------
  function chartPayload(symbol, range, interval) {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) + '?range=' + range + '&interval=' + interval;
    return fetchJson(url, 1, false, swapHost).then(function (json) {
      var result = json.chart && json.chart.result && json.chart.result[0];
      if (!result) throw new Error('no chart result');
      return result;
    });
  }

  function getChart(symbol) {
    return chartPayload(symbol, '1d', '1d').then(function (result) {
      var meta = result.meta || {};
      var price = meta.regularMarketPrice;
      var prev = meta.previousClose || meta.chartPreviousClose;
      var pct = (price !== undefined && prev) ? (price - prev) / prev : null;
      return {
        symbol: symbol,
        name: meta.shortName || meta.symbol || symbol,
        price: price,
        previousClose: prev,
        changePct: pct,
        currency: meta.currency || null
      };
    });
  }

  function getSpark(symbol) {
    return chartPayload(symbol, '3mo', '1d').then(function (result) {
      var closes = (result.indicators && result.indicators.quote &&
        result.indicators.quote[0] && result.indicators.quote[0].close) || [];
      var points = [];
      for (var i = 0; i < closes.length; i++) {
        if (typeof closes[i] === 'number' && isFinite(closes[i])) points.push(closes[i]);
      }
      return { symbol: symbol, points: points };
    });
  }

  // -------------------- quoteSummary --------------------
  function quoteSummaryUrl(symbol, crumb) {
    return 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' +
      encodeURIComponent(symbol) +
      '?modules=price%2CdefaultKeyStatistics%2CfinancialData%2CsummaryDetail' +
      (crumb ? '&crumb=' + encodeURIComponent(crumb) : '');
  }

  function getQuote(symbol) {
    return getCrumb().then(function (crumb) {
      return fetchJson(quoteSummaryUrl(symbol, crumb), 1, !!crumb, swapHost);
    }).then(function (json) {
      return normalize(symbol, json);
    });
  }

  window.SERN.providers.yahoo = {
    getQuote: getQuote,
    getChart: getChart,
    getSpark: getSpark
  };
})();
