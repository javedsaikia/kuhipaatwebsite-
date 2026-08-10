# Self-hosted fonts

`.woff2` files mirrored from Google Fonts so the site makes **no third-party
font requests**. Besides removing a dependency, this stops visitor IP addresses
being sent to Google on every page load — the thing German courts have ruled
against under GDPR.

`css/fonts.css` is generated from the upstream CSS, not written by hand.

| Family | Weights | Subsets kept |
|---|---|---|
| Plus Jakarta Sans | 500, 700, 800 | latin, latin-ext |
| Noto Sans Bengali | 500, 700, 800 | latin, latin-ext, bengali |

15 files, ~575 KB on disk.

## What a visitor actually downloads

Far less than 575 KB. Every `@font-face` keeps its `unicode-range`, so browsers
fetch only the subsets they need to draw the text on screen:

- **English** → Plus Jakarta Sans latin only, ~80 KB across the three weights.
- **Assamese** → Noto Sans Bengali bengali + latin, ~390 KB. Bengali is simply
  a large script: hundreds of conjuncts and matra forms. This is identical to
  what Google served before, so self-hosting costs visitors nothing.

The two Latin faces used above the fold are `<link rel="preload">`ed in
`index.html`, so the hero doesn't flash in a fallback face.

## Regenerating

```sh
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
curl -sSLf -A "$UA" \
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Noto+Sans+Bengali:wght@500;700;800&display=swap' \
  -o gf.css
```

The `User-Agent` matters: without a modern one Google returns TTF instead of
woff2. Then rewrite each `src: url(...)` to `../assets/fonts/<family>-<weight>-<subset>.woff2`,
download each file under that name, and drop the `vietnamese` and
`cyrillic-ext` blocks.

## Two things to keep in mind

**Weight 600 is deliberately absent.** It was used by exactly one rule
(`.c-input`), and carrying it cost ~190 KB across both families — including a
whole extra 105 KB Bengali face. `.c-input` uses 500 instead. If you add a
`font-weight: 600` rule, it will render as synthetic/faux bold rather than the
real cut, so either use 500/700/800 or re-add the weight here.

**Licensing.** Both families are under the
[SIL Open Font License 1.1](https://openfontlicense.org), which explicitly
permits redistribution and self-hosting like this. No attribution is required
in the page UI.
