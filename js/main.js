(function () {
  'use strict';

  var root = document.documentElement;
  var STORAGE_KEY = 'moinamel-lang';

  /* ---------------- language toggle ---------------- */
  function applyLang(lang) {
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang === 'as' ? 'as' : 'en');
    var toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', lang === 'as' ? 'true' : 'false');
    }
    updatePlaceholders(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  function updatePlaceholders(lang) {
    var fields = document.querySelectorAll('[data-ph-en]');
    fields.forEach(function (field) {
      var ph = lang === 'as' ? field.getAttribute('data-ph-as') : field.getAttribute('data-ph-en');
      field.setAttribute('placeholder', ph || '');
    });
  }

  function initLang() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    applyLang(saved === 'as' ? 'as' : 'en');

    var toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var current = root.getAttribute('data-lang');
        applyLang(current === 'as' ? 'en' : 'as');
      });
    }
  }

  /* ---------------- mobile nav ---------------- */
  function initMobileNav() {
    var header = document.querySelector('.site-header');
    var toggle = document.getElementById('mobile-menu-toggle');
    if (!header || !toggle) return;

    toggle.addEventListener('click', function () {
      var isOpen = header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.querySelectorAll('.main-nav a').forEach(function (link) {
      link.addEventListener('click', function () {
        header.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------------- scroll reveal ---------------- */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) || !items.length) {
      items.forEach(function (el) { el.classList.add('in-view'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---------------- early access form ---------------- */
  function initEarlyAccessForm() {
    var form = document.getElementById('early-access-form');
    var success = document.getElementById('form-success');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      // No backend wired up yet — swap this for a real signup endpoint
      // (e.g. Mailchimp, ConvertKit, or a custom API) when ready.
      form.hidden = true;
      if (success) success.hidden = false;
    });
  }

  /* ---------------- footer year ---------------- */
  function initYear() {
    var el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initLang();
    initMobileNav();
    initReveal();
    initEarlyAccessForm();
    initYear();
  });
})();
