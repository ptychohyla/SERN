(function () {
  'use strict';

  window.SERN = window.SERN || {};

  // ==================== Model definitions ====================
  // valuation weights per spec §4.1; composite mix per spec §4.2
  var models = {
    multifactor: {
      scope: 'sector',
      valuation: { pe: 20, forwardPe: 20, pb: 20, ps: 15, evEbitda: 15, divYield: 10 },
      composite: { valuation: 50, quality: 30, growth: 20 },
      leverage: true
    },
    deepvalue: {
      scope: 'market',
      valuation: { pe: 30, pb: 30, ps: 15, divYield: 25 },
      composite: { valuation: 70, quality: 15, growth: 0 },
      leverage: true
    },
    peg: {
      scope: 'sector',
      valuation: { forwardPe: 20, ps: 15, evEbitda: 15, peg: 50 },
      composite: { valuation: 40, quality: 25, growth: 35 },
      leverage: false
    },
    qualitymomentum: {
      scope: 'sector',
      valuation: { pe: 20, forwardPe: 20, pb: 20, ps: 15, evEbitda: 15, divYield: 10 },
      composite: { valuation: 20, quality: 50, momentum: 30 },
      leverage: true
    }
  };

  // every valuation metric is lower-is-cheaper except dividend yield
  var HIGHER_BETTER = { divYield: true };

  // ==================== Percentile & aggregation ====================
  // 0–100 percentile of x within values; cheapest/highest scores 100.
  function percentile(values, x, higherBetter) {
    if (values.length < 2) return 50;
    var better = 0;
    for (var i = 0; i < values.length; i++) {
      if (higherBetter ? values[i] < x : values[i] > x) better++;
    }
    // tie correction: split ties evenly
    var ties = 0;
    for (var j = 0; j < values.length; j++) {
      if (values[j] === x) ties++;
    }
    return (better + (ties - 1) / 2) / (values.length - 1) * 100;
  }

  function groupKey(entry, cfg) {
    return cfg.scope === 'sector' ? entry.meta.sector : 'ALL';
  }

  // weighted mean of percentiles, skipping metrics a stock lacks (spec §4.3);
  // absent keys are undefined, explicitly-missing are null — both are skipped
  function metricAvg(metrics, pcts) {
    var sum = 0, wsum = 0;
    Object.keys(metrics).forEach(function (key) {
      if (typeof pcts[key] === 'number' && isFinite(pcts[key])) {
        sum += metrics[key] * pcts[key];
        wsum += metrics[key];
      }
    });
    return wsum ? sum / wsum : null;
  }

  // ==================== Scoring ====================
  // Computes valuation (cheapness) and composite scores for every entry with
  // enough data. Entries with fewer than two usable valuation metrics keep
  // scores === null so the UI can list them as data-insufficient (spec §4.3).
  function computeScores(entries, modelId) {
    var cfg = models[modelId];
    // Reset every entry first: one that just lost enough metrics must drop
    // its previous score, otherwise it falls out of the ranking board AND out
    // of the data-insufficient list (both filter on entry.scores).
    entries.forEach(function (e) { e.scores = null; });

    // Data-driven, not status-driven: an entry still holding last-known data
    // mid-refresh keeps its score instead of blanking the board.
    var valid = entries.filter(function (e) {
      return e.data && !e.data.insufficient;
    });

    // count usable valuation metrics per stock
    valid.forEach(function (e) {
      e.valKeys = Object.keys(cfg.valuation).filter(function (k) {
        var v = e.data[k];
        return v !== null && v !== undefined && isFinite(v);
      });
    });
    valid = valid.filter(function (e) { return e.valKeys.length >= 2; });

    // collect metric values per group
    var valGroups = {}; // group -> metric -> [values]
    function bucket(group) {
      if (!valGroups[group]) {
        valGroups[group] = {};
        Object.keys(cfg.valuation).forEach(function (m) { valGroups[group][m] = []; });
      }
      return valGroups[group];
    }
    valid.forEach(function (e) {
      var b = bucket(groupKey(e, cfg));
      e.valKeys.forEach(function (m) { b[m].push(e.data[m]); });
    });

    // quality / growth groups are market wide
    var qualityMetrics = ['roe', 'fcfYield', 'margin'];
    var momentumMetrics = ['momentum12m'];
    var growthMetrics = ['earningsGrowth', 'revenueGrowth'];
    var qGroups = {}, gGroups = {}, mGroups = {};
    qualityMetrics.forEach(function (m) {
      qGroups[m] = valid.map(function (e) { return e.data[m]; }).filter(function (v) { return v !== null; });
    });
    momentumMetrics.forEach(function (m) {
      mGroups[m] = valid.map(function (e) { return e.data[m]; }).filter(function (v) { return v !== null; });
    });
    growthMetrics.forEach(function (m) {
      gGroups[m] = valid.map(function (e) { return e.data[m]; }).filter(function (v) { return v !== null; });
    });

    valid.forEach(function (e) {
      var valPcts = {};
      var g = groupKey(e, cfg);
      e.valKeys.forEach(function (m) {
        valPcts[m] = percentile(valGroups[g][m], e.data[m], !!HIGHER_BETTER[m]);
      });
      var valScore = metricAvg(cfg.valuation, valPcts);

      var qParts = {};
      qualityMetrics.forEach(function (m) {
        var v = e.data[m];
        qParts[m] = (v === null) ? null : percentile(qGroups[m], v, true);
      });
      var qualityScore = metricAvg({ roe: 1, fcfYield: 1, margin: 1 }, qParts);

      var mParts = {};
      momentumMetrics.forEach(function (m) {
        var v = e.data[m];
        mParts[m] = (v === null) ? null : percentile(mGroups[m], v, true);
      });
      var momentumScore = metricAvg({ momentum12m: 1 }, mParts);

      var gParts = {};
      growthMetrics.forEach(function (m) {
        var v = e.data[m];
        gParts[m] = (v === null) ? null : percentile(gGroups[m], v, true);
      });
      var growthScore = metricAvg({ earningsGrowth: 1, revenueGrowth: 1 }, gParts);

      // Leverage penalty (spec §4.2: 有，最多 −10). Yahoo always reports
      // debt/equity as a percentage (148.7 = 148.7%), so the old `d > 5 ? d/100
      // : d` split read a near-debt-free 3.5% as a 3.5x ratio and max-penalized
      // it. Normalize unconditionally; 1x D/E is the neutral point.
      var penalty = 0;
      if (cfg.leverage && e.data.debtToEquity !== null) {
        var ratio = e.data.debtToEquity / 100;
        if (ratio > 1) penalty = Math.min(10, (ratio - 1) * 10);
      }

      // Composite: weights come from cfg.composite; missing components simply
      // drop out and the rest renormalize (spec §4.3).
      var cw = cfg.composite;
      var parts = { valuation: valScore, quality: qualityScore, growth: growthScore, momentum: momentumScore };
      var sum = 0, wsum = 0;
      Object.keys(cw).forEach(function (k) {
        if (cw[k] > 0 && parts[k] !== null) {
          sum += cw[k] * parts[k];
          wsum += cw[k];
        }
      });
      var composite = wsum ? sum / wsum - penalty : null;

      e.scores = {
        valuation: valScore,
        quality: qualityScore,
        growth: growthScore,
        momentum: momentumScore,
        penalty: penalty,
        composite: composite,
        valPcts: valPcts
      };
    });

    return valid;
  }

  window.SERN.scoring = {
    models: models,
    percentile: percentile,
    computeScores: computeScores
  };
})();
