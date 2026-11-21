/* ==========================================================================
   Moina — chat companion
   Depends on js/moina-guard.js (loaded first) for the safety rules.

   Two behaviours worth knowing about:

   1. The cursor magnet. Moina parks in her corner and leans toward the cursor
      only once it comes within MAGNET_RADIUS, then eases home. She never
      chases the pointer across the page, so she can't get between a child and
      something they're trying to click.

   2. Every message is screened locally before it goes anywhere. Blocked and
      deflected questions are answered from the canned replies in the guard —
      no network call, no tokens, no round trip. The same screen runs again in
      /api/chat, because this file is editable by anyone with DevTools.
   ========================================================================== */
(function () {
  'use strict';

  var guard = window.MoinaGuard;
  if (!guard) return;

  var root = document.documentElement;
  var el = document.getElementById('moina');
  if (!el) return;

  var launcher = el.querySelector('.moina_launcher');
  var panel    = el.querySelector('.moina_panel');
  var log      = el.querySelector('.moina_log');
  var form     = el.querySelector('.moina_form');
  var input    = el.querySelector('.moina_input');
  var send     = el.querySelector('.moina_send');
  var chipWrap = el.querySelector('.moina_chips');
  var closeBtn = el.querySelector('.moina_close');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer  = window.matchMedia('(pointer: fine)').matches;

  /* ---------------------------------------------------------- config ----- */
  var CONFIG = {
    // Serverless proxy that holds the API key. See api/chat.js.
    endpoint: '/api/chat',
    // Turns of history sent as context. Keeps the bill and the latency down.
    historyTurns: 8,
    // A child hammering the send button shouldn't become a bill.
    minSendGap: 700,
    maxPerSession: 40
  };

  var MAGNET_RADIUS = 240;   // px from launcher centre where the pull starts
  var MAGNET_PULL   = 0.28;  // fraction of the cursor delta Moina travels
  var MAGNET_MAX    = 26;    // px cap, so she never fully leaves her corner

  /* ---------------------------------------------------------- strings ---- */
  var UI = {
    en: {
      greeting: "Hi! I'm Moina, your bird friend. 🐦 Ask me about Assamese words, songs or stories!",
      chips: ['Tell me a story', 'Teach me a word', 'What is Bihu?'],
      placeholder: 'Say something to Moina…',
      thinking: 'Moina is thinking…',
      offline: "Moina is having a little nap right now. Try again in a moment! 💤",
      capped: "Phew, we've chatted a lot today! Let's take a little break. 🌿",
      tooFast: 'One at a time! 🐦',
      rateLimited: "We've had lots of chats — try again in a little while! 🐦"
    },
    as: {
      greeting: 'নমস্কাৰ! মই মৈনা, তোমাৰ চৰাই বন্ধু। 🐦 অসমীয়া শব্দ, গীত বা কাহিনীৰ বিষয়ে সোধা!',
      chips: ['এটা কাহিনী কোৱা', 'এটা শব্দ শিকোৱা', 'বিহু কি?'],
      placeholder: 'মৈনাক কিবা কোৱা…',
      thinking: 'মৈনাই ভাবি আছে…',
      offline: 'মৈনাই এতিয়া অলপ টোপনি গৈছে। অলপ পিছত চেষ্টা কৰা! 💤',
      capped: 'উফ, আজি বহুত কথা পাতিলোঁ! অলপ জিৰণি লওঁ আহা। 🌿',
      tooFast: 'এবাৰত এটাকৈ! 🐦',
      rateLimited: 'আজি বহুত কথা পাতিলোঁ — অলপ পিছত চেষ্টা কৰা! 🐦'
    }
  };

  function lang() { return root.getAttribute('data-lang') === 'as' ? 'as' : 'en'; }
  function t(key) { return UI[lang()][key]; }

  /* ---------------------------------------------------------- state ------ */
  var history = [];      // {role:'user'|'model', content:string}
  var open = false;
  var busy = false;
  var sentCount = 0;
  var lastSendAt = 0;
  var typingEl = null;

  /* ============================================================ magnet === */
  var mx = 0, my = 0;          // current offset
  var tx = 0, ty = 0;          // target offset
  var rafId = null;
  var cursorInside = false;

  function magnetFrame() {
    // critically damped enough to feel like weight, not lag
    mx += (tx - mx) * 0.14;
    my += (ty - my) * 0.14;

    launcher.style.setProperty('--moina-x', mx.toFixed(2) + 'px');
    launcher.style.setProperty('--moina-y', my.toFixed(2) + 'px');

    var settled = Math.abs(tx - mx) < 0.1 && Math.abs(ty - my) < 0.1;
    if (settled && tx === 0 && ty === 0) {
      launcher.style.setProperty('--moina-x', '0px');
      launcher.style.setProperty('--moina-y', '0px');
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(magnetFrame);
  }

  function kickMagnet() {
    if (rafId === null) rafId = requestAnimationFrame(magnetFrame);
  }

  function onPointerMove(e) {
    if (open) return;                       // she holds still while chatting

    var box = launcher.getBoundingClientRect();
    // subtract the live offset so "home" stays fixed while she's displaced
    var cx = box.left + box.width / 2 - mx;
    var cy = box.top + box.height / 2 - my;

    var dx = e.clientX - cx;
    var dy = e.clientY - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < MAGNET_RADIUS) {
      // pull ramps up as the cursor closes in, so the approach feels magnetic
      var strength = (1 - dist / MAGNET_RADIUS) * MAGNET_PULL;
      tx = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, dx * strength));
      ty = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, dy * strength));
      if (!cursorInside) {
        cursorInside = true;
        launcher.style.setProperty('--moina-scale', '1.08');
      }
    } else {
      tx = 0;
      ty = 0;
      if (cursorInside) {
        cursorInside = false;
        launcher.style.removeProperty('--moina-scale');
      }
    }
    kickMagnet();
  }

  function initMagnet() {
    // no cursor to chase on touch, and it's pure decoration under reduce-motion
    if (reduceMotion || !finePointer) return;
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    window.addEventListener('blur', function () { tx = 0; ty = 0; kickMagnet(); });
  }

  function focusablesWithin(node) {
    return Array.prototype.filter.call(
      node.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'),
      function (item) { return !item.disabled && item.tabIndex !== -1; }
    );
  }

  function onPanelKeydown(e) {
    if (!open || e.key !== 'Tab') return;
    var items = focusablesWithin(panel);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ============================================================ panel ==== */
  function setOpen(next) {
    open = next;
    el.classList.toggle('is-open', open);
    launcher.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));

    if (open) {
      el.classList.remove('has-unread');
      el.classList.add('is-hint-dismissed');
      try { localStorage.setItem('moina-seen', '1'); } catch (err) {}

      tx = 0; ty = 0; kickMagnet();          // return home before she freezes
      if (!history.length) greet();
      document.addEventListener('keydown', onPanelKeydown);
      // let the panel finish expanding before yanking focus into it
      setTimeout(function () { input.focus(); }, 280);
    } else {
      document.removeEventListener('keydown', onPanelKeydown);
      launcher.focus();
    }
  }

  function greet() {
    addMessage('bot', t('greeting'));
    renderChips();
  }

  function renderChips() {
    chipWrap.innerHTML = '';
    t('chips').forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'moina_chip';
      b.textContent = label;
      b.addEventListener('click', function () {
        chipWrap.innerHTML = '';
        submit(label);
      });
      chipWrap.appendChild(b);
    });
  }

  /* ============================================================ log ====== */
  function addMessage(kind, text) {
    var node = document.createElement('div');
    node.className = 'moina_msg cc-' + kind;
    node.textContent = text;
    log.appendChild(node);
    scrollLog();
    return node;
  }

  function scrollLog() {
    // after paint, or the height we scroll to is the pre-insert height
    requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; });
  }

  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'moina_typing';
    typingEl.setAttribute('aria-label', t('thinking'));
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(typingEl);
    scrollLog();
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  function setBusy(next) {
    busy = next;
    send.disabled = next;
    input.disabled = next;
  }

  /* ============================================================ send ===== */
  function submit(text) {
    var message = String(text || '').trim();
    if (!message || busy) return;

    var now = Date.now();
    if (now - lastSendAt < CONFIG.minSendGap) { addMessage('guard', t('tooFast')); return; }
    if (sentCount >= CONFIG.maxPerSession)     { addMessage('guard', t('capped')); return; }
    lastSendAt = now;

    addMessage('user', message);
    input.value = '';
    chipWrap.innerHTML = '';

    // Screened here purely for speed — api/chat.js screens it again server-side.
    var verdict = guard.screen(message, lang());
    if (verdict) {
      sentCount++;
      // a beat of "thinking" so the canned reply doesn't feel like a wall
      setBusy(true);
      showTyping();
      setTimeout(function () {
        hideTyping();
        setBusy(false);
        addMessage('guard', verdict.reply);
        input.focus();
      }, 420);
      return;
    }

    sentCount++;
    history.push({ role: 'user', content: message });
    ask();
  }

  function ask() {
    setBusy(true);
    showTyping();

    fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lang: lang(),
        messages: history.slice(-CONFIG.historyTurns * 2)
      })
    })
      .then(function (res) {
        if (res.status === 429) throw new Error('HTTP 429');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        hideTyping();
        setBusy(false);

        var reply = (data && data.reply) ? String(data.reply).trim() : '';
        if (!reply) { addMessage('error', t('offline')); return; }

        history.push({ role: 'model', content: reply });
        addMessage(data.guarded ? 'guard' : 'bot', reply);
        if (!open) el.classList.add('has-unread');
        input.focus();
      })
      .catch(function (err) {
        hideTyping();
        setBusy(false);
        if (err && err.message === 'HTTP 429') {
          addMessage('error', t('rateLimited'));
        } else {
          addMessage('error', t('offline'));
        }
        // Most likely cause by far: the static host has no /api/chat function.
        console.warn('[moina] chat request failed:', err.message,
          '\nIs the proxy running? Locally: node tools/moina-dev-proxy.js');
      });
  }

  /* ============================================================ wire ===== */
  launcher.addEventListener('click', function () { setOpen(!open); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submit(input.value);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  // Lenis owns the page scroll; without this the log swallows the wheel event
  // and the page jumps instead of the message list.
  log.setAttribute('data-lenis-prevent', '');

  // The language pill rewrites data-lang on <html>; follow it live so an open
  // panel switches its own furniture too.
  new MutationObserver(function () {
    input.placeholder = t('placeholder');
    input.setAttribute('aria-label', t('placeholder'));
    if (chipWrap.children.length) renderChips();
    var dialog = document.getElementById('moina-dialog');
    if (dialog) {
      dialog.setAttribute('aria-label', lang() === 'as'
        ? 'মৈনাৰ লগত চেট কৰক'
        : 'Chat with Moina');
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-lang'] });

  input.placeholder = t('placeholder');
  input.maxLength = guard.MAX_INPUT;

  try {
    if (localStorage.getItem('moina-seen')) el.classList.add('is-hint-dismissed');
  } catch (err) {}

  initMagnet();
  el.hidden = false;
})();
