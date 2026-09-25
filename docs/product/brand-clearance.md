# Brand clearance status

**Status: `NOT CLEARED`.**

`VivaahVarnam` is a **preliminary working brand name** chosen to make the product coherent while it
is being built. It has **not** been legally cleared. **No trademark, domain-availability or
registry search has been performed**, and none may be described as performed. No application,
registration, purchase or booking of any kind has been made or is authorised by this document.

Using the name in this repository and in the preview UI is a development convenience, not an
assertion of rights. No `™` or `®` marker is used anywhere in the product for that reason.

## What is currently true

- The name appears in `src/config/product.ts` and `src/components/brand/BrandLockup.tsx`, and
  nowhere else as a hardcoded string.
- The landing and legal pages describe the name as provisional/working.
- No domain name has been registered, and none is claimed anywhere in the product. The previous
  working domain reference has been removed from active surfaces.
- No business entity is claimed. No registered office address is published.
- No support or sales email address is published.
- No social handles are claimed or linked.
- No logo image asset exists. The lockup is typographic, so rebranding does not require replacing
  artwork.

## Pre-launch checklist

Each item is **open** until someone with authority completes it and records the evidence here.

| # | Item | Owner | Status | Evidence link |
| --- | --- | --- | --- | --- |
| 1 | Trademark similarity search in India (word mark), including phonetic and transliteration variants | Legal | Open | — |
| 2 | Legal / professional review of the name with counsel | Legal | Open | — |
| 3 | Identify the relevant Nice classes for the services actually offered (software/SaaS, design services, event services) before filing | Legal | Open | — |
| 4 | Domain availability and adequate defensive variants for the chosen TLD | Founder | Open | — |
| 5 | Social handle availability on the platforms actually used for distribution | Founder | Open | — |
| 6 | App store / Play Store name conflict check, if a native app ships | Founder | Open | — |
| 7 | Linguistic and cultural review of the name with native speakers of each launch language | Content | Open | — |
| 8 | Distinctiveness check against existing wedding-invitation products specifically | Founder | Open | — |
| 9 | Final approval decision, recorded, before the name becomes customer-facing in a paid product | Founder | Open | — |

## Consequences of `NOT CLEARED`

1. **UI must not assert legal ownership** of the mark. No `™`, `®`, "registered brand", or
   ownership-of-name language.
2. **Do not buy anything** — no domain, no handle, no trademark filing — without a separate,
   explicit decision. This stage authorises none of it.
3. **Assume the name can change.** Anything expensive to change later (a printed collateral system,
   a hard-coded email, a purchased domain) should be deferred until after item 9.
4. **A rename must be cheap by design.** Because the brand lives in one config module and one
   component, renaming should touch those, the metadata in `index.html`, the legal pages' prose, and
   the docs. The product-contract checker exists to catch stragglers, and its retired-name list must
   be updated as part of any rename.
5. **Never claim search completed.** Reporting "brand cleared", "trademark checked" or "domain
   verified" without evidence is prohibited.

## Rename procedure (for whoever executes it)

1. Update `src/config/product.ts` — name, descriptor, tagline.
2. Verify `BrandLockup` renders the new name and its accessible `sr-only` string.
3. Update the retired-name patterns in `scripts/check-product-contract.mjs` to include the *old*
   name, then run `npm run product:check`.
4. Update `index.html` title, description and OG/Twitter metadata.
5. Update the provisional-brand sentence in `TermsOfService.tsx`, `PrivacyPolicy.tsx`,
   `CookiePolicy.tsx` and `README.md`.
6. Re-run brand QA across landing, auth, dashboard and project screens at desktop and 360px widths.
7. Update this document's status line; do not backdate or delete the history that the previous name
   was in use.
