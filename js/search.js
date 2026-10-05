/* ============================================================
   Stock search (markets page): local-first suggestions over the
   tracked universe, supplemented by the StockAPI worker's
   /v1/search (Yahoo + Eastmoney upstreams) for off-universe stocks.
   Pool results open the scored drawer; off-universe results open
   the external (scoreless) drawer via window.SERN.markets.
   ============================================================ */
(function () {
  'use strict';

  window.SERN = window.SERN || {};

  var STOCKAPI_ORIGIN = 'https://stockapi.hinsyeow.org';
  var SEARCH_TIMEOUT = 8000;   // mirrors market-data.js STOCKAPI_TIMEOUT
  var DEBOUNCE_MS = 300;
  var LOCAL_LIMIT = 5;
  var TOTAL_LIMIT = 10;

  var i18n = window.SERN.i18n;
  var universe = window.SERN.universe || [];

  function t(key) {
    return i18n ? i18n.t(key) : key;
  }

  // -------------------- pure helpers (Node-verifiable) --------------------

  // Rank: code prefix > name prefix > substring; universe order within each
  // group. Case-insensitive; matches symbol and en/zh names.
  function localMatches(query, list) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return [];
    var codePrefix = [], namePrefix = [], substr = [];
    list.forEach(function (u) {
      var sym = u.symbol.toLowerCase();
      var en = (u.name && u.name.en || '').toLowerCase();
      var zh = (u.name && u.name.zh || '').toLowerCase();
      if (sym.indexOf(q) === 0) codePrefix.push(u);
      else if ((en && en.indexOf(q) === 0) || (zh && zh.indexOf(q) === 0)) namePrefix.push(u);
      else if (sym.indexOf(q) !== -1 || (en && en.indexOf(q) !== -1) || (zh && zh.indexOf(q) !== -1)) substr.push(u);
    });
    return codePrefix.concat(namePrefix, substr).slice(0, LOCAL_LIMIT);
  }

  // Pool group first (universe entries), then off-universe remote items.
  // A remote hit that IS a pool stock but missed local matching (e.g. the
  // 5-digit form "00700" vs internal "0700.HK") joins the pool group so it
  // still opens the scored drawer, never the external one.
  function mergeSuggestions(local, remote) {
    var seen = {};
    local.forEach(function (u) { seen[u.symbol] = true; });
    var universeBySymbol = {};
    (universe || []).forEach(function (u) { universeBySymbol[u.symbol] = u; });
    var poolExtra = [], more = [];
    (remote || []).forEach(function (r) {
      if (!r || !r.symbol || seen[r.symbol]) return;
      seen[r.symbol] = true;
      if (universeBySymbol[r.symbol]) poolExtra.push(universeBySymbol[r.symbol]);
      else more.push({ symbol: r.symbol, name: r.name, market: r.market || null, external: true });
    });
    var pool = local.concat(poolExtra).slice(0, TOTAL_LIMIT);
    return {
      pool: pool,
      more: more.slice(0, Math.max(0, TOTAL_LIMIT - pool.length))
    };
  }

  window.SERN.search = {
    _test: { localMatches: localMatches, mergeSuggestions: mergeSuggestions }
  };

  // -------------------- DOM wiring --------------------

  var input = document.getElementById('search-input');
  var panel = document.getElementById('search-panel');
  var clearBtn = document.getElementById('search-clear');
  if (!input || !panel || !clearBtn) return;

  var remoteCtrl = null;      // AbortController for the in-flight remote call
  var debounceTimer = null;
  var flatItems = [];         // flattened {symbol, name, market, external?} for keyboard nav
  var activeIndex = -1;
  var lastGroups = { pool: [], more: [] };

  function applyLang() {
    input.setAttribute('placeholder', t('search.placeholder'));
  }

  function closePanel() {
    panel.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    flatItems = [];
    activeIndex = -1;
  }

  function setActive(index) {
    var nodes = panel.querySelectorAll('.search-item');
    activeIndex = index;
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('active', i === index);
    }
    if (index >= 0 && nodes[index]) {
      nodes[index].scrollIntoView({ block: 'nearest' });
    }
  }

  function marketChip(market) {
    if (!market) return null;
    var chip = document.createElement('span');
    chip.className = 'search-chip';
    chip.textContent = t('market.' + market);
    return chip;
  }

  function appendItem(box, item) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-item';
    row.setAttribute('role', 'option');

    var name = document.createElement('span');
    name.className = 'search-item-name';
    name.textContent = item.external ? item.name : (i18n && i18n.getLang() === 'zh' ? item.name.zh : item.name.en);

    var right = document.createElement('span');
    right.className = 'search-item-meta';
    var chip = marketChip(item.market);
    if (chip) right.appendChild(chip);
    var sym = document.createElement('span');
    sym.className = 'search-item-symbol';
    sym.textContent = item.symbol;
    right.appendChild(sym);

    row.appendChild(name);
    row.appendChild(right);
    row.addEventListener('click', function () { select(item); });
    row.addEventListener('mousemove', function () {
      var idx = flatItems.indexOf(item);
      if (idx >= 0 && idx !== activeIndex) setActive(idx);
    });
    box.appendChild(row);
  }

  function appendGroupTitle(box, key) {
    var el = document.createElement('div');
    el.className = 'search-group-title';
    el.textContent = t(key);
    box.appendChild(el);
  }

  function appendNote(box, key, className) {
    var el = document.createElement('div');
    el.className = className || 'search-note';
    el.textContent = t(key);
    box.appendChild(el);
  }

  function render(loading) {
    panel.innerHTML = '';
    flatItems = [];
    var groups = lastGroups;
    if (!groups.pool.length && !groups.more.length && !loading) {
      appendNote(panel, 'search.empty');
    } else {
      if (groups.pool.length) {
        appendGroupTitle(panel, 'search.group-pool');
        groups.pool.forEach(function (u) {
          flatItems.push(u);
          appendItem(panel, u);
        });
      }
      if (groups.more.length) {
        appendGroupTitle(panel, 'search.group-more');
        groups.more.forEach(function (item) {
          flatItems.push(item);
          appendItem(panel, item);
        });
      }
      if (loading) appendNote(panel, 'search.loading', 'search-note search-loading');
    }
    panel.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
    activeIndex = -1;
  }

  function select(item) {
    closePanel();
    input.value = '';
    clearBtn.classList.remove('visible');
    input.blur();
    var markets = window.SERN.markets;
    if (!markets) return;
    if (item.external) markets.openExternalDrawer(item.symbol, item.name);
    else markets.openDrawer(item.symbol);
  }

  function fetchRemote(query) {
    if (remoteCtrl) remoteCtrl.abort();
    var reachable = !window.SERN.yahoo || !window.SERN.yahoo.stockapiReachable
      || window.SERN.yahoo.stockapiReachable();
    if (!reachable) return; // origin unreachable this session: local-only
    remoteCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = remoteCtrl
      ? setTimeout(function () { remoteCtrl.abort(); }, SEARCH_TIMEOUT)
      : null;
    var ctrl = remoteCtrl;
    fetch(STOCKAPI_ORIGIN + '/v1/search?q=' + encodeURIComponent(query),
      ctrl ? { signal: ctrl.signal } : undefined
    ).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      if (ctrl !== remoteCtrl) return; // a newer query superseded this one
      var remote = (json && json.data) || [];
      lastGroups = mergeSuggestions(lastGroups.pool, remote);
      render(false);
    }, function () {
      if (timer) clearTimeout(timer);
      if (ctrl !== remoteCtrl) return; // superseded; not a real failure
      render(false); // remote failed: quietly keep local-only results
    });
  }

  function onInput() {
    var query = input.value.trim();
    clearBtn.classList.toggle('visible', !!query);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (remoteCtrl) { remoteCtrl.abort(); remoteCtrl = null; }
    if (!query) { closePanel(); lastGroups = { pool: [], more: [] }; return; }
    lastGroups = mergeSuggestions(localMatches(query, universe), []);
    var wantRemote = query.length >= 2;
    render(wantRemote);
    if (wantRemote) {
      debounceTimer = setTimeout(function () { fetchRemote(query); }, DEBOUNCE_MS);
    }
  }

  function onKeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!flatItems.length) return;
      e.preventDefault();
      var delta = e.key === 'ArrowDown' ? 1 : -1;
      var next = activeIndex + delta;
      if (next < 0) next = flatItems.length - 1;
      if (next >= flatItems.length) next = 0;
      setActive(next);
    } else if (e.key === 'Enter') {
      if (!flatItems.length) return;
      e.preventDefault();
      select(flatItems[activeIndex >= 0 ? activeIndex : 0]);
    } else if (e.key === 'Escape') {
      closePanel();
    }
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', function () {
    setTimeout(closePanel, 150); // let item click fire first
  });
  clearBtn.addEventListener('click', function () {
    input.value = '';
    clearBtn.classList.remove('visible');
    lastGroups = { pool: [], more: [] };
    closePanel();
    input.focus();
  });

  applyLang();
  if (i18n && i18n.onChange) i18n.onChange(applyLang);
})();
