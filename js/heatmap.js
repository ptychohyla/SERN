(function () {
  'use strict';

  window.SERN = window.SERN || {};

  // Market heatmap: sector-grouped tile wall over the whole tracked universe.
  // Two color modes — daily change % (red up / green down, CN convention)
  // and valuation score (green = cheap); tiles with no data render gray.
  // Pure renderer: markets.js owns state and calls render() on every refresh.

  function changeClass(pct) {
    if (pct === null || pct === undefined || !isFinite(pct)) return 'heat-na';
    if (pct >= 0.03) return 'heat-up-3';
    if (pct >= 0.015) return 'heat-up-2';
    if (pct >= 0.005) return 'heat-up-1';
    if (pct > -0.005) return 'heat-flat';
    if (pct > -0.015) return 'heat-down-1';
    if (pct > -0.03) return 'heat-down-2';
    return 'heat-down-3';
  }

  function scoreClass(s) {
    if (s === null || s === undefined || !isFinite(s)) return 'heat-na';
    if (s >= 80) return 'heat-s-4';
    if (s >= 65) return 'heat-s-3';
    if (s >= 50) return 'heat-s-2';
    if (s >= 35) return 'heat-s-1';
    return 'heat-s-0';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fmtPct(p) {
    return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%';
  }

  function tileValue(entry, mode) {
    if (mode === 'score') {
      var s = entry.scores ? entry.scores.valuation : null;
      return {
        text: (s === null || s === undefined) ? '—' : String(Math.round(s)),
        cls: scoreClass(s)
      };
    }
    var p = entry.data ? entry.data.changePct : null;
    return {
      text: (p === null || p === undefined) ? '—' : fmtPct(p),
      cls: changeClass(p)
    };
  }

  // opts: {entries, mode, watchOnly, isWatched, t, langName, onSelect}
  function render(container, opts) {
    container.innerHTML = '';

    var order = [];
    var bySector = {};
    opts.entries.forEach(function (e) {
      if (e.status !== 'done' || !e.data) return;
      if (opts.watchOnly && !opts.isWatched(e.meta.symbol)) return;
      var s = e.meta.sector;
      if (!bySector[s]) {
        bySector[s] = [];
        order.push(s);
      }
      bySector[s].push(e);
    });

    if (!order.length) {
      container.appendChild(el('div', 'board-placeholder', opts.t('freshness.loading')));
      return;
    }

    order.forEach(function (sector) {
      var card = el('div', 'heat-group');
      card.appendChild(el('h3', 'heat-group-title', opts.t('sector.' + sector)));
      var grid = el('div', 'heat-grid');
      bySector[sector].slice().sort(function (a, b) {
        var ma = a.data.marketCap;
        var mb = b.data.marketCap;
        if (ma === null && mb === null) return a.meta.symbol < b.meta.symbol ? -1 : 1;
        if (ma === null) return 1;
        if (mb === null) return -1;
        return mb - ma;
      }).forEach(function (e) {
        var v = tileValue(e, opts.mode);
        var tile = el('div', 'heat-tile ' + v.cls);
        tile.dataset.symbol = e.meta.symbol;
        tile.setAttribute('title', opts.langName(e.meta.name) + ' ' + e.meta.symbol + ' · ' + v.text);
        tile.appendChild(el('div', 'heat-symbol', e.meta.symbol));
        tile.appendChild(el('div', 'heat-value', v.text));
        tile.addEventListener('click', function () { opts.onSelect(e.meta.symbol); });
        grid.appendChild(tile);
      });
      card.appendChild(grid);
      container.appendChild(card);
    });
  }

  window.SERN.heatmap = {
    render: render,
    changeClass: changeClass,
    scoreClass: scoreClass
  };
})();
