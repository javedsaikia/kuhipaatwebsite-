/* ==========================================================================
   Moina Mel — Kuhipaat
   Animation stack ported from papumba.com:
     · Lenis smooth scroll (lerp .1, wheelMultiplier .8)
     · SplitType word/letter reveals driven by GSAP ScrollTrigger
     · a scroll-pinned stat section whose cards cross-fade on scrub
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var STORAGE_KEY = 'moinamel-lang';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var hasGsap  = typeof window.gsap !== 'undefined';
  var hasST    = hasGsap && typeof window.ScrollTrigger !== 'undefined';
  var hasSplit = typeof window.SplitType !== 'undefined';
  var hasLenis = typeof window.Lenis !== 'undefined';

  if (hasST) gsap.registerPlugin(ScrollTrigger);

  var lenis = null;

  /* ============================================================ 1. Lenis  */
  function initSmoothScroll() {
    if (reduceMotion || !hasLenis) return;

    lenis = new Lenis({
      lerp: 0.1,
      wheelMultiplier: 0.8,
      gestureOrientation: 'vertical',
      normalizeWheel: false,
      smoothTouch: false
    });

    if (hasST) {
      // Keep ScrollTrigger in step with Lenis rather than the native scroll.
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
      window.__lenis = lenis; // handle for debugging / programmatic scrolling
    } else {
      requestAnimationFrame(function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      });
    }

    // Lenis owns the scroll position, so anchors have to go through it.
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var id = link.getAttribute('href');
        if (!id || id === '#') return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -80, duration: 1.2 });
        closeNav();
      });
    });
  }

  /* ================================================= 2. text animations  */
  /* Attribute names and easings match papumba's implementation exactly. */
  var EFFECTS = {
    'words-slide-up':         { unit: 'word', from: { opacity: 0, yPercent: 100 }, duration: 0.5, ease: 'back.out(2)',  stagger: 0.5 },
    'words-rotate-in':        { unit: 'word', from: { rotationX: -90 },            duration: 0.6, ease: 'power2.out',   stagger: 0.6, perspective: true },
    'words-slide-from-right': { unit: 'word', from: { opacity: 0, x: '1em' },      duration: 0.6, ease: 'power2.out',   stagger: 0.2 },
    'letters-slide-up':       { unit: 'char', from: { yPercent: 100 },             duration: 0.5, ease: 'power1.out',   stagger: 0.6 },
    'letters-slide-down':     { unit: 'char', from: { yPercent: -120 },            duration: 0.3, ease: 'power1.out',   stagger: 0.7 },
    'letters-fade-in':        { unit: 'char', from: { opacity: 0 },                duration: 0.2, ease: 'power1.out',   stagger: 0.8 },
    'letters-fade-in-random': { unit: 'char', from: { opacity: 0 },                duration: 0.05, ease: 'power1.out',  stagger: 0.4, random: true }
  };

  /* Assamese is a Brahmic script — splitting it per character tears matras
     and conjuncts apart, so letter effects degrade to their word equivalent. */
  var CHAR_TO_WORD = {
    'letters-slide-up':       'words-slide-up',
    'letters-slide-down':     'words-slide-up',
    'letters-fade-in':        'words-slide-up',
    'letters-fade-in-random': 'words-slide-up'
  };

  var splitInstances = [];
  var textTriggers = [];

  function isVisible(el) {
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  function effectNameFor(el) {
    for (var name in EFFECTS) {
      if (el.hasAttribute(name)) return name;
    }
    return 'words-slide-up';
  }

  function teardownText() {
    textTriggers.forEach(function (t) { t.kill(); });
    textTriggers = [];
    splitInstances.forEach(function (s) { s.revert(); });
    splitInstances = [];
  }

  function buildText() {
    if (!hasGsap || !hasSplit || !hasST) {
      document.querySelectorAll('[text-split]').forEach(function (el) { el.style.opacity = 1; });
      return;
    }

    var targets = Array.prototype.filter.call(
      document.querySelectorAll('[text-split]'), isVisible
    );

    targets.forEach(function (el) {
      var name = effectNameFor(el);
      // degrade letter effects for Assamese text
      if (el.classList.contains('as') && CHAR_TO_WORD[name]) name = CHAR_TO_WORD[name];
      var fx = EFFECTS[name];

      var split = new SplitType(el, {
        types: fx.unit === 'char' ? 'words, chars' : 'words',
        tagName: 'span'
      });
      splitInstances.push(split);

      var pieces = fx.unit === 'char' ? split.chars : split.words;
      if (!pieces || !pieces.length) return;

      gsap.set(el, { opacity: 1 });

      var tl = gsap.timeline({ paused: true });
      if (fx.perspective) tl.set(pieces, { transformPerspective: 1000 });
      tl.from(pieces, {
        duration: fx.duration,
        ease: fx.ease,
        stagger: fx.random
          ? { amount: fx.stagger, from: 'random' }
          : { amount: fx.stagger },
        ...fx.from
      });

      // Same play/reset pair papumba uses: play at 70% up the viewport,
      // rewind once the element has scrolled back below the fold.
      textTriggers.push(ScrollTrigger.create({
        trigger: el,
        start: 'top bottom',
        onLeaveBack: function () { tl.progress(0); tl.pause(); }
      }));
      textTriggers.push(ScrollTrigger.create({
        trigger: el,
        start: 'top 70%',
        onEnter: function () { tl.play(); }
      }));

      // A reload part-way down the page, or a shared #anchor link, can land
      // already past the trigger — onEnter never fires and the text would be
      // stuck at its hidden "from" state. Show those straight away.
      if (el.getBoundingClientRect().top < window.innerHeight * 0.7) {
        tl.progress(1).pause();
      }
    });

    ScrollTrigger.refresh();
  }

  function initText() {
    if (reduceMotion) {
      document.querySelectorAll('[text-split]').forEach(function (el) { el.style.opacity = 1; });
      return;
    }
    buildText();
  }

  /* ==================================== 3. generic reveal for non-text  */
  function initReveals() {
    var items = document.querySelectorAll('[data-reveal]');
    if (!items.length) return;

    if (reduceMotion || !hasST) {
      items.forEach(function (el) { el.style.opacity = 1; });
      return;
    }

    items.forEach(function (el) {
      gsap.from(el, {
        opacity: 0,
        y: 40,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 85%' }
      });
    });
  }

  /* ================================ 4. pinned stat section (papumba #stats) */
  function initStickyStats() {
    var section = document.getElementById('stats');
    if (!section || reduceMotion || !hasST) return;

    var c1 = section.querySelector('.c-home-stat-card.cc-1');
    var c2 = section.querySelector('.c-home-stat-card.cc-2');
    var c3 = section.querySelector('.c-home-stat-card.cc-3');
    if (!c1 || !c2 || !c3) return;

    gsap.set([c2, c3], { opacity: 0, scale: 0.85, y: 50 });

    // 5 equal beats: hold 1 · swap · hold 2 · swap · hold 3
    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.6
      }
    });

    tl.to(c1, { opacity: 0, scale: 0.85, y: -50, duration: 1, ease: 'power2.inOut' }, 1)
      .to(c2, { opacity: 1, scale: 1, y: 0, duration: 1, ease: 'power2.inOut' }, 1)
      .to(c2, { opacity: 0, scale: 0.85, y: -50, duration: 1, ease: 'power2.inOut' }, 3)
      .to(c3, { opacity: 1, scale: 1, y: 0, duration: 1, ease: 'power2.inOut' }, 3)
      .to({}, { duration: 1 }, 4); // pad so card 3 holds before the section releases
  }

  /* ============================================= 5. decor parallax  */
  function initParallax() {
    if (reduceMotion || !hasST) return;

    document.querySelectorAll('.c-decor').forEach(function (el, i) {
      gsap.to(el, {
        yPercent: i % 2 === 0 ? -60 : 45,
        ease: 'none',
        scrollTrigger: {
          trigger: el.closest('section') || el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true
        }
      });
    });
  }

  /* ============================================= 6. marquee  */
  /* Each copy is translated by -100% of its own width, so the row needs one
     more copy than fits across it to stay covered at the wrap point. */
  function initMarquee() {
    document.querySelectorAll('.c-marquee').forEach(function (row) {
      var first = row.querySelector('.c-marquee_content');
      if (!first || !first.offsetWidth) return;

      var needed = Math.ceil(row.offsetWidth / first.offsetWidth) + 1;
      while (row.children.length < needed) {
        row.appendChild(first.cloneNode(true));
      }
    });
  }

  /* ============================================= 7. language toggle  */
  function applyLang(lang) {
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang === 'as' ? 'as' : 'en');

    var toggle = document.getElementById('lang-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', lang === 'as' ? 'true' : 'false');

    updatePlaceholders(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  function updatePlaceholders(lang) {
    document.querySelectorAll('[data-ph-en]').forEach(function (field) {
      var ph = lang === 'as' ? field.getAttribute('data-ph-as') : field.getAttribute('data-ph-en');
      field.setAttribute('placeholder', ph || '');
    });
  }

  function initLang() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    applyLang(saved === 'as' ? 'as' : 'en');

    var toggle = document.getElementById('lang-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', function () {
      applyLang(root.getAttribute('data-lang') === 'as' ? 'en' : 'as');
      // The other language's nodes were display:none and unmeasurable, so the
      // splits have to be thrown away and rebuilt against the new text.
      if (!reduceMotion) {
        teardownText();
        buildText();
      }
      initMarquee();
      if (hasST) ScrollTrigger.refresh();
    });
  }

  /* ============================================= 8. nav  */
  function closeNav() {
    var nav = document.querySelector('.c-nav');
    var btn = document.getElementById('nav-menu-button');
    if (!nav || !btn) return;
    nav.classList.remove('nav-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  function initNav() {
    var nav = document.querySelector('.c-nav');
    var btn = document.getElementById('nav-menu-button');
    if (!nav) return;

    if (btn) {
      btn.addEventListener('click', function () {
        var open = nav.classList.toggle('nav-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    nav.querySelectorAll('.c-nav_menu a').forEach(function (link) {
      link.addEventListener('click', closeNav);
    });

    var onScroll = function () {
      nav.classList.toggle('is-scrolled', window.scrollY > 20);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ============================================= 9. form + year  */
  function initForm() {
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
      if (hasST) ScrollTrigger.refresh();
    });
  }

  function initYear() {
    var el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ============================================= boot  */
  document.addEventListener('DOMContentLoaded', function () {
    initLang();
    initNav();
    initSmoothScroll();
    initMarquee();
    initText();
    initReveals();
    initStickyStats();
    initParallax();
    initForm();
    initYear();

    // Web fonts change metrics, which moves every trigger point.
    if (document.fonts && document.fonts.ready && hasST) {
      document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    }
  });
})();
