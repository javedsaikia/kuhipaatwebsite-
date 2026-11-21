/* Cloudflare Turnstile for the early-access waitlist (optional when configured). */
(function () {
  'use strict';

  var mount = document.getElementById('ea-turnstile');
  if (!mount) return;

  var widgetId = null;
  var ready = false;

  window.__waitlistTurnstileToken = function () {
    if (!ready || widgetId === null || !window.turnstile) return '';
    try {
      return window.turnstile.getResponse(widgetId) || '';
    } catch (err) {
      return '';
    }
  };

  window.__waitlistTurnstileRequired = false;

  window.__waitlistTurnstileReset = function () {
    if (widgetId !== null && window.turnstile) {
      try { window.turnstile.reset(widgetId); } catch (err) { /* ignore */ }
    }
  };

  fetch('/api/site-config', { headers: { Accept: 'application/json' } })
    .then(function (res) { return res.ok ? res.json() : {}; })
    .then(function (cfg) {
      var siteKey = cfg && cfg.turnstileSiteKey ? String(cfg.turnstileSiteKey) : '';
      if (!siteKey) return;

      window.__waitlistTurnstileRequired = true;
      mount.hidden = false;

      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = function () {
        if (!window.turnstile) return;
        widgetId = window.turnstile.render(mount, {
          sitekey: siteKey,
          action: 'early-access',
          theme: 'light',
          size: 'flexible'
        });
        ready = true;
      };
      document.head.appendChild(script);
    })
    .catch(function () { /* no Turnstile — honeypot + rate limit only */ });
})();