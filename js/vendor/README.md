# Vendored front-end libraries

These files are **third-party code, checked in deliberately**. Don't hand-edit
them — the site loaded them from public CDNs until we self-hosted them so the
page's motion doesn't depend on unpkg, cdnjs or jsDelivr staying reachable.

| File | Library | Version | License |
|---|---|---|---|
| `lenis.min.js` | [Lenis](https://github.com/darkroomengineering/lenis) | 1.0.39 | MIT |
| `gsap.min.js` | [GSAP](https://gsap.com) | 3.12.5 | GreenSock Standard License |
| `ScrollTrigger.min.js` | GSAP ScrollTrigger | 3.12.5 | GreenSock Standard License |
| `split-type.min.js` | [SplitType](https://github.com/lukePeavey/SplitType) | 0.3.4 | MIT |

Load order matters: GSAP must come before ScrollTrigger, and all four must come
before `js/main.js`, which registers the plugin and builds the timelines.

## Re-fetching / upgrading

```sh
cd js/vendor
curl -sSLf -o lenis.min.js         "https://unpkg.com/@studio-freight/lenis@1.0.39/dist/lenis.min.js"
curl -sSLf -o gsap.min.js          "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"
curl -sSLf -o ScrollTrigger.min.js "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"
curl -sSLf -o split-type.min.js    "https://cdn.jsdelivr.net/npm/split-type@0.3.4/umd/index.min.js"
```

Bump the version numbers in both the URLs and the table above together. After
any upgrade, check the scroll-pinned stats section and the SplitType heading
reveals — those are the two things that break on a GSAP major change.

## Licensing note

Lenis and SplitType are MIT: use freely, keep the copyright notices (they're in
the file banners).

GSAP 3.12.5 ships under the [GreenSock Standard
License](https://gsap.com/standard-license), which covers a marketing site like
this one at no cost. The condition to be aware of: it does **not** cover
products where users pay a recurring fee for access to the GSAP-powered
content, which needs a Club GSAP membership. If Moina Mel ever becomes a paid
web app built on these animations, re-read that license — note that GSAP 3.13+
(relicensed by Webflow in 2025) removed the restriction entirely and is the
easy way out.

## Still external

Fonts are **not** vendored — `index.html` still pulls Plus Jakarta Sans and
Noto Sans Bengali from `fonts.googleapis.com`. Self-hosting those would also
remove the third-party request that sends visitor IPs to Google, which is worth
doing if EU visitors matter.
