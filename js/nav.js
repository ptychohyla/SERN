/* ============================================================
   Mobile navigation toggle (shared by index.html and markets.html)
   Desktop: #nav-toggle is display:none and this is inert.
   Mobile (≤768px): toggles .open on #nav-links, keeps aria-expanded
   in sync, and closes on link click / outside click / Escape /
   resize back to desktop width.
   ============================================================ */
(function () {
  'use strict';

  var i18n = window.SERN && window.SERN.i18n;

  // Language toggle (both pages): icon-only button in the navbar. Wiring
  // lives here so every page shares it — page scripts must NOT add their
  // own click handler or the toggle fires twice and cancels out.
  var langBtn = document.getElementById('lang-toggle');
  if (i18n && langBtn) {
    var applyLangBtn = function () {
      langBtn.setAttribute('aria-label', i18n.t('lang.switch'));
    };
    applyLangBtn();
    langBtn.addEventListener('click', function () { i18n.toggle(); });
    i18n.onChange(applyLangBtn);
    // first-load localization for pages whose static markup carries
    // data-i18n (index.html has no other applyStatic caller)
    i18n.applyStatic();
  }

  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');
  if (!toggle || !links) return;

  function applyLabel() {
    if (i18n) toggle.setAttribute('aria-label', i18n.t('nav.menu'));
  }

  function setOpen(open) {
    links.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function isOpen() {
    return links.classList.contains('open');
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!isOpen());
  });

  links.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('click', function (e) {
    if (isOpen() && !links.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 768 && isOpen()) setOpen(false);
  });

  applyLabel();
  if (i18n && i18n.onChange) i18n.onChange(applyLabel);
})();
