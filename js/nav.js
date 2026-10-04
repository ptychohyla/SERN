/* ============================================================
   Mobile navigation toggle (shared by index.html and markets.html)
   Desktop: #nav-toggle is display:none and this is inert.
   Mobile (≤768px): toggles .open on #nav-links, keeps aria-expanded
   in sync, and closes on link click / outside click / Escape /
   resize back to desktop width.
   ============================================================ */
(function () {
  'use strict';

  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');
  if (!toggle || !links) return;

  var i18n = window.SERN && window.SERN.i18n;

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
