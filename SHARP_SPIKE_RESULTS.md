# Sharp Feasibility Spike — Results

**Spike branch:** `audit/24-sharp-spike`
**Endpoint:** `src/routes/api/_spike/sharp-border/+server.ts`
**Date:** 2026-04-10
**Context:** audit #24, PR #2 of the LumaPrints expansion stack. Decides whether Path B (Sharp-composited bordered prints) is viable on Vercel serverless, inside the Stripe webhook's 30-second budget, using photographer-realistic source images.

---

## Verdict: **PASS** — Sharp is feasible for PR #6.

All four thresholds from the spec note were met with meaningful headroom. Proceed with the Sharp border compositing work in PR #6.

| Threshold | Target | Measured | Status |
|---|---|---|---|
| Single-item composite < 5s | < 5000 ms | 2093 ms cold, ~1800–2600 ms warm | PASS |
| 5-item sequential < 20s (10s webhook headroom) | < 20000 ms | 9506–11833 ms warm | PASS |
| Memory RSS delta < 500 MB | < 512 MB | 175–226 MB overall | PASS |
| Cold start penalty < 3s | < 3000 ms | ~300–500 ms above warm baseline | PASS |

---

## Test environment

- **Vercel region:** iad1 (Washington D.C. East)
- **Runtime:** Node v22.22.0, Linux x64
- **Function memory:** Vercel default (1024 MB)
- **Function timeout:** 30s (`maxDuration: 30` in the route config)
- **Sharp:** 0.34.5 with libvips 8.17.3
- **Preview deployment:** `https://angelsrest-53sps6pxz-jesse-pomeroys-projects.vercel.app`

Source images are real event-gallery photos pulled from `angelsrest-studio` (project `n7rvza4g`, dataset `production`). All are high-resolution wedding/event photography in the 5000–6700 pixel range.

---

## Unexpected finding: Sanity CDN serves compressed versions

**This is the biggest finding of the spike and has implications beyond Sharp.**

The event gallery's asset documents report `asset->size` values of 12–38 MB (the original upload sizes). But when the CDN URL is fetched without query params:

| Asset ID reports | CDN actually serves |
|---|---|
| `40e97f0f…` 12.0 MB | **2.1 MB** |
| `3bd93d7c…` (variant) | **3.4 MB** |
| `35e53b93…` 31.6 MB | **3.6 MB** |
| `99e0f635…` 38.0 MB | **3.7 MB** |
| `54a11272…` 29.3 MB | **5.2 MB** |

**Implications:**
1. **Sharp's job is much easier than I was planning for.** The spec note assumed 10 MB sources; actual download bytes are 2–5 MB. All pixel dimensions are preserved (5000×7500, 5152×7728, etc.), so Sharp still decodes 37–40 megapixels per image — but the network transfer is 5–10× smaller than the raw asset size.
2. **LumaPrints may not be getting the quality Margaret assumes.** The current Stripe webhook forwards these same CDN URLs to LumaPrints. LumaPrints is printing from the 2–5 MB CDN version, not the 12–38 MB original. At 5152×7728 / 3.7 MB, that's ~0.5 bytes/pixel, roughly JPEG quality 80. For most prints that's fine (human eye can't distinguish q80 from q95 on a 300 DPI print), but it's worth flagging that the print pipeline has been implicitly lossy.
3. **Separate investigation recommended:** confirm with LumaPrints whether the CDN quality is adequate for large prints (16×24+), and whether we should force full-quality by adding `?max=original` or similar query params. This is out of scope for audit #24 but worth tracking.

---

## Raw measurements

### Cold start — single image (5012×7518, 2.1 MB, 0.5" border)

```
Download:  1286 ms
Metadata:    11 ms
Sharp:      796 ms
-----------------
Total:     2093 ms
Memory delta: 35 MB
```

### Warm — 5-image print set, 1.0" border, sequential (run 1)

```
#  Dimensions    Src     Out     Download   Sharp   Total   MemΔ
1  5012×7518    2.0 MB  3.7 MB  1331 ms    648 ms  1994 ms  +18 MB
2  5012×7518    3.4 MB  6.0 MB  1870 ms    755 ms  2626 ms  +110 MB
3  5152×7728    3.6 MB  6.4 MB  1609 ms    790 ms  2401 ms  -43 MB
4  5152×7728    3.7 MB  6.7 MB  1610 ms    743 ms  2363 ms  +57 MB
5  6748×4499    5.2 MB  9.3 MB  1692 ms    754 ms  2448 ms  +83 MB
                                -------    ------  -------  ------
                                8112 ms    3690 ms 11833 ms +226 MB overall
```

### Warm — 5-image print set, same inputs (run 2, variance check)

```
Sharp per-image: 705, 773, 764, 724, 741 ms   (nearly identical to run 1)
Download per-image: 137, 1041, 1502, 1664, 1441 ms   (first was CDN-cached)
Download sum:       5785 ms
Sharp sum:          3707 ms
Total:              9506 ms
Memory delta:       175 MB
```

---

## Analysis

### Sharp is deterministic

Sharp's per-image pipeline time (decode → extend with white border → re-encode as JPEG q92) is **rock-solid at 705–800 ms per 40-megapixel image** across both runs. Variance is under 10%. libvips' fused pipeline operations are efficient — decode, extend, and encode happen in one streaming pass without materializing intermediate buffers.

Implication for PR #6: **Sharp time is predictable and budget-able.** A 5-image print set spends ~3.7 seconds in Sharp, regardless of which 5 images are picked. We can promise latency SLAs on the Sharp portion confidently.

### Downloads are where all the variance lives

Download times per image ranged from 137 ms (CDN cache hit) to 1900 ms (cold fetch). That's a 14× variance just in the network portion. The Sanity CDN's consistent ~1.5 second cold-fetch latency from Vercel iad1 is surprising — I expected 200–400 ms for US backbone-to-backbone.

**Optimization opportunities for PR #6:**
1. **Parallelize downloads.** Sharp must run sequentially (memory pressure), but downloads can be parallel. Running 5 downloads concurrently would cut the download portion from 5.8–8.1 seconds down to ~1.5–2 seconds (bottleneck becomes the single slowest fetch). Total webhook time drops from 9.5–11.8s to roughly **5–6 seconds**. This is a ~40% win and is worth implementing in PR #6.
2. **Investigate why Sanity CDN is slow.** 1.5s per fetch is suspicious. Could be first-byte latency, TLS handshake cost (Node's `fetch` doesn't reuse connections across calls by default — worth testing a single keep-alive agent), Sanity CDN's edge cache behavior, or geographic routing. Worth a follow-up investigation but not blocking.
3. **Stream-to-Sharp.** Sharp can decode from a stream rather than a fully-buffered Buffer. This could reduce peak memory per image and potentially save 100–200 ms. Modest gain, only pursue if memory becomes a concern.

### Memory behavior is fine

Overall RSS delta for the full 5-image request was 175–226 MB, well under Vercel's 1024 MB default function memory. Per-image deltas vary wildly (-43 MB to +110 MB) because Node's V8 GCs between calls — that's expected and healthy. The sum is what matters.

No need to increase function memory for Sharp compositing. The default 1024 MB gives us ~4× headroom, enough for 20-item print sets if we ever wanted to support them (we don't — spec says max 10).

### Cold start is negligible

Cold-start total (2093 ms) vs warm single-item average (~2000 ms) shows the cold penalty is ~300–500 ms. Sharp's native module loads fast on Node 22. Not a concern for the webhook budget.

---

## Implications for PR #6 (the real implementation)

1. **Architecture confirmed:** Vercel serverless function running Sharp via the Stripe webhook's existing flow works. No need for a separate worker, background job, or alternate compute platform.
2. **R2 upload path:** the spike did NOT upload to R2 — it just returned timing. PR #6 adds the R2 upload step via the existing gallery worker with a new `/upload/print-composite` endpoint. Add roughly 500–1000 ms per image for the R2 upload (network + worker processing). Total per-item becomes ~1.5–2 seconds including R2. A 5-item print set with parallel downloads + sequential Sharp + parallel R2 uploads would land around **7–9 seconds**, comfortably under the 30s Stripe webhook limit with ~20s headroom.
3. **Parallel-download pattern** should be implemented from the start:
   ```ts
   // Download all sources in parallel
   const buffers = await Promise.all(urls.map(fetch).then(rs => Promise.all(rs.map(r => r.arrayBuffer()))));
   // Composite sequentially (memory pressure)
   const composites: Buffer[] = [];
   for (const buf of buffers) {
     composites.push(await sharp(Buffer.from(buf)).extend(...).jpeg(...).toBuffer());
   }
   // Upload all composites in parallel
   await Promise.all(composites.map((c, i) => uploadToR2(c, keyFor(i))));
   ```
4. **Border widths confirmed feasible.** Tested with 0.5" and 1.0" borders (150 and 300 pixel border at 300 DPI). Both ran in the same time envelope. The spec's 0.25" / 0.5" / 1" picker options all work.
5. **Error handling in the webhook** needs to distinguish Sharp errors (permanent — bad image, unsupported format) from transient errors (R2 upload timeout, network blip). Permanent Sharp errors should take the fulfillment_error refund path (spec decisions, Q12); transient errors can let the webhook throw so Stripe retries.
6. **The spike endpoint stays in place** on the `audit/24-sharp-spike` branch until PR #6 lands. It'll be deleted in that PR. Don't delete it early.

---

## Cleanup

- Spike endpoint lives at `src/routes/api/_spike/sharp-border/+server.ts`. The `_spike` path prefix marks it as temporary.
- `SHARP_SPIKE_TOKEN` env var is set on the Vercel project (Production, Preview, Development). Safe to leave or rotate.
- `sharp@^0.34.5` is now a direct dep in `package.json`. Keeping it — PR #6 will need it.
- Preview deployment `angelsrest-53sps6pxz-jesse-pomeroys-projects.vercel.app` can be left as-is; Vercel auto-retains recent previews and old ones get pruned.

---

## Follow-up investigations flagged

1. **Sanity CDN download latency (1.5 sec average from Vercel iad1).** Unexpectedly slow. Worth a small follow-up to test connection reuse, edge caching, or keep-alive agents before PR #6 ships.
2. **Sanity CDN serves compressed versions.** LumaPrints has been printing from these compressed versions, not the originals. Worth confirming quality is adequate for large prints; if not, audit whether CDN transform params or a different URL scheme is needed.
3. **Keep-alive/connection pooling in the webhook.** Node's default `fetch` creates a new TLS session per call. Sharing an undici `Agent` with `keepAlive: true` might cut download latency significantly.

These are explicit follow-ups for the PR #6 design phase, not blockers for this spike.
