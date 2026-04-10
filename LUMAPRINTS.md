# LumaPrints Integration — Angel's Rest

Print-on-demand fulfillment for the angelsrest.online shop. Customers check out through Stripe and this integration submits the order to LumaPrints for printing and shipping.

```
Customer → Shop → Stripe Checkout → Stripe webhook → LumaPrints API → Print + Ship → Customer
                                        ↓
                                 Convex order record
```

The Convex order is the source of truth for order state. There is (currently) no inbound LumaPrints webhook — tracking updates happen out-of-band.

---

## Account

| Field | Value |
|---|---|
| Store ID | `83765` |
| API Base (production) | `https://us.api.lumaprints.com` |
| API Base (sandbox) | `https://us.api-sandbox.lumaprints.com` |
| Auth | Basic HTTP (API Key = username, API Secret = password) |
| Dashboard | https://dashboard.lumaprints.com |
| Rate limit | 40 requests/minute (429 if exceeded) |

---

## Catalog (as of 2026-04-10)

Fine Art Paper only (category 103). 2 papers × 5 sizes = 10 SKUs.

| Paper | Subcategory ID | Notes |
|---|---|---|
| Archival Matte | `103001` | Default paper. Bright white, fingerprint resistant. |
| Glossy | `103007` | Vivid colors, high contrast. |

Available sizes: 4×6, 6×9, 8×12, 12×18, 16×24 (inches).

**Option 39** (No Bleed) is always used. See "Known Issues" below — option 36 causes aspect-ratio validation errors.

Expanding the catalog (more papers, sizes, canvas, metal, framed prints) is tracked as audit item #23. Bordered prints via Sharp compositing are tracked as audit item #24.

---

## Known Issues & Fixes

### Issue 1 — Aspect ratio rejection from query params

**Problem:** LumaPrints rejected orders with aspect-ratio validation errors even when the image and ordered size clearly matched (e.g. a 2:3 image ordered as 4×6).

**Root cause:** Sanity CDN URLs often arrive with transform params (`?w=1200&fm=webp&q=90`). LumaPrints' image processing can't parse those and fails validation with a cryptic "expectedAspectRatio" error.

**Fix:** Strip all query params from image URLs before sending. The raw Sanity CDN URL serves JPEG by default.

```ts
// BAD
"https://cdn.sanity.io/images/.../photo.jpg?w=1200&fm=webp"

// GOOD (cleanImageUrl does this automatically)
"https://cdn.sanity.io/images/.../photo.jpg"
```

This lives in `src/lib/server/lumaprints.ts` as `cleanImageUrl()` and is called by `buildLumaPrintsOrder()` so every order item is cleaned automatically.

### Issue 2 — Bleed option 36 conflicts with image aspect ratio

**Problem:** The default bleed option (`36` — 0.25" bleed) reduces the effective print area by a small amount. LumaPrints validates image aspect ratio against the *reduced* print area, not the paper size. A 4×6 image on 4×6 paper with option 36 produces a ~1% mismatch — just over the API's tolerance — triggering a 406.

**Fix:** Always use option `39` (No Bleed). This prints edge-to-edge with no border and no aspect-ratio math. Customers who want bordered prints will be served by audit item #24 (Sharp compositing) or #23 (framed fine art paper category 105).

`buildLumaPrintsOrder()` hardcodes `orderItemOptions: [39]` for this reason.

### Issue 3 — WebP format

**Problem:** WebP images are rejected — LumaPrints only accepts JPG, JPEG, and PNG.

**Fix:** `cleanImageUrl()` strips the `fm=webp` query param. Raw Sanity CDN URLs serve JPEG. Do not ever emit `?fm=webp` URLs toward LumaPrints.

---

## Pricing

Retail prices come from **Sanity**, not from code. Each shop product and print set has a `price` field that's fetched in the shop load functions:

- `src/routes/shop/+page.server.ts` — shop index grid
- `src/routes/shop/prints/[slug]/+page.server.ts` — single print page
- `src/routes/shop/sets/[slug]/+page.server.ts` — print set page

There is intentionally **no local `src/lib/shop/pricing.ts`** in this repo. Sanity is the source of truth and Margaret edits prices there directly. A local lookup table would duplicate Sanity and risk drift — reflecting-pool uses a local table because its prices are author-owned and version-controlled, but angelsrest's are merchant-owned.

Wholesale cost data (what LumaPrints charges us per print) lives in the reference doc at `/Users/jessepomeroy/Documents/quilt/02_reference/lumaprints-api-reference.md`. Use that when setting retail prices in Sanity so you can see your margin at a glance.

---

## Where the code lives

| File | Purpose |
|---|---|
| `src/lib/server/lumaprints.ts` | API client + `buildLumaPrintsOrder()` pure function + `cleanImageUrl()` + `LumaPrintsError` |
| `src/lib/shop/types.ts` | `PaperType`, `PAPER_SUBCATEGORY_IDS`, `AVAILABLE_SIZES`, `Recipient`, `OrderItem`, LumaPrints payload types |
| `src/lib/__tests__/lumaprints.test.ts` | Tests for pure functions and error handling |
| `src/routes/api/webhooks/stripe/+server.ts` | Stripe webhook → calls `submitToLumaPrints()` |

The webhook's `submitToLumaPrints()` is a thin wrapper: build items from session metadata (print set or single), build a recipient from shipping details, call `buildLumaPrintsOrder()`, call `createOrder()`, update the Convex order. All the messy work lives in pure functions that are unit tested.

---

## Error handling strategy

Per audit #1, the Stripe webhook **throws on LumaPrints failure** and returns HTTP 500. This triggers Stripe's automatic retry, which is safe because:

- Convex order creation is idempotent (audit #1)
- The LumaPrints external ID is derived from the order number, so duplicate submissions collide upstream

This is intentionally different from reflecting-pool, which marks the order `fulfillment_error` and returns 200. Reflecting-pool relies on manual admin follow-up; angelsrest relies on Stripe retries + webhook idempotency.

**Do not change this behavior without understanding the audit #1 context.**

---

## Environment variables

```
LUMAPRINTS_API_KEY=...
LUMAPRINTS_API_SECRET=...
LUMAPRINTS_STORE_ID=83765
LUMAPRINTS_USE_SANDBOX=true    # optional; default is production
```

All are set via Vercel environment variables for deployed environments, or via `.env` for local development. Tests mock them via `src/__mocks__/env-dynamic.ts`.

### Production vs sandbox routing

LumaPrints exposes a sandbox environment at `https://us.api-sandbox.lumaprints.com` that accepts fake orders for testing. The client picks which URL to hit based on `LUMAPRINTS_USE_SANDBOX`:

- `LUMAPRINTS_USE_SANDBOX=true` → sandbox
- unset or anything else → production

**Recommended Vercel configuration:**

| Vercel environment | `LUMAPRINTS_USE_SANDBOX` | Why |
|---|---|---|
| Production | `false` (or unset) | Real orders, real customers |
| Preview | `true` | Every PR branch deploys to a preview URL. Test the full checkout + webhook flow there without polluting production data or triggering real fulfillment. |
| Development (`.env.local`) | `true` | Local `pnpm dev` should never submit real orders |

**Why an explicit env var instead of `NODE_ENV` or Vite's `import.meta.env.DEV`:** those build-mode flags are `true` only for `pnpm dev`. Vercel sets `NODE_ENV=production` on every deploy including preview branches, so a `NODE_ENV`-based switch would route preview-branch checkouts to **production** LumaPrints — a silent footgun for any PR touching the webhook. The dedicated env var gives each Vercel target independent control.

---

## Testing

```sh
pnpm test src/lib/__tests__/lumaprints.test.ts   # unit tests for pure functions
pnpm test                                        # all tests incl. webhook integration
```

The webhook test in `src/routes/api/webhooks/stripe/__tests__/webhook.test.ts` mocks `$lib/server/lumaprints` end-to-end to cover the full "Stripe completed → Convex order → LumaPrints call → Convex update" flow.

---

## Future work

- **#23 — Catalog expansion:** Hot Press, Cold Press, Semi-Glossy, Metallic, Somerset Velvet papers. More sizes. Canvas (category 101), metal prints (category 106), framed fine art paper (category 105). See the refactor audit note.
- **#24 — Bordered prints via Sharp compositing:** Composite the photo onto a white canvas server-side, upload to R2, submit with option 39. Eliminates the bleed-option aspect-ratio bug entirely.
- **Pre-submission validation via `checkImageConfig`:** Currently deferred — the query-params fix + option 39 resolved the aspect-ratio bug in production, so pre-validation is defense-in-depth rather than a live bug fix.
- **Inbound shipping webhook:** LumaPrints can notify us when orders ship. Not currently wired — tracking updates happen manually. Consider adding `src/routes/api/webhooks/lumaprints/+server.ts` when catalog expands.
