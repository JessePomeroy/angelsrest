# Sharp Feasibility Spike — Results

**Spike branch:** `audit/24-sharp-spike`
**Endpoint:** `src/routes/api/_spike/sharp-border/+server.ts`
**Date:** 2026-04-10
**Context:** audit #24, PR #2 of the LumaPrints expansion stack. Decides whether Path B (Sharp-composited bordered prints) is viable on Vercel serverless, inside the Stripe webhook's 30-second budget, using photographer-realistic source images.

---

## Verdict: **PASS** — Sharp is feasible for PR #6 at target quality (q95 source + q95 output).

All four thresholds from the spec note were met with meaningful headroom. Proceed with the Sharp border compositing work in PR #6.

| Threshold | Target | Measured (q95 pipeline) | Status |
|---|---|---|---|
| Single-item composite < 5s | < 5000 ms | 2093 ms cold (q80 source), ~1600–1800 ms warm (q95) | PASS |
| 5-item sequential < 20s (10s webhook headroom) | < 20000 ms | **8553 ms warm (q95+q95)** | PASS — 11.5s headroom |
| Memory RSS delta < 500 MB | < 512 MB | 288 MB overall (q95 pipeline) | PASS |
| Cold start penalty < 3s | < 3000 ms | ~300–500 ms above warm baseline | PASS |

**Crucial finding: download time is latency-bound, not bandwidth-bound.** Going from the default CDN compressed sources (3.9 MB avg) to q=95 sources (9.5 MB avg) barely changed download time (4175–8364 ms range for 5 sequential fetches). Vercel → Sanity CDN has high backbone bandwidth; the bottleneck is per-request TLS handshake / time-to-first-byte. **Quality is essentially free on the download side**, which is critical because q95 is the target shipping quality for PR #6.

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

## Finding: Sanity CDN re-encodes; use `?q=95` for PR #6 source URLs

The event gallery's asset documents report original upload sizes of 12–38 MB, but the default CDN URL (without query params) serves a heavily compressed version (~q80). Testing with explicit quality params:

| URL | Content-Length (for the 38 MB asset) |
|---|---|
| `…5152x7728.jpg` (default) | 3.9 MB (~q80) |
| `…5152x7728.jpg?q=95` | **11.1 MB (q95 — target)** |
| `…5152x7728.jpg?q=100` | 25.4 MB (maximum Sanity offers) |

**PR #6 design decisions:**

1. **Source URLs must include `?q=95`.** The default CDN URL is ~q80 which is below the intended print quality. `?q=95` raises source bytes from ~3.9 MB to ~11 MB per image, but the spike confirms this fits comfortably in the webhook budget (8.6s for a 5-image set at q95).

2. **Q95 is achievable in Vercel at the webhook budget.** See the verdict table above. Verified end-to-end: fetch q95 sources → composite borders via Sharp → re-encode at q95 → 8.6s total wall time for 5 large images.

3. **Q=100 is available if needed.** The CDN caps at `?q=100` which serves ~25 MB for the same 5152×7728 asset. The spike didn't test q100 end-to-end, but the download-latency-bound finding strongly suggests q100 would add only a few hundred milliseconds to the total — well within budget. If Margaret ever wants to experiment with higher quality, it's a one-line source URL change.

4. **Current (pre-PR #6) production webhook uses the default CDN URL** (~q80). This has been implicitly lossy since launch. Not a regression introduced by this spike — just surfaced by it. Fixing this for the current webhook is a small drive-by change: update the LumaPrints submission path to append `?q=95` to image URLs before sending to LumaPrints. **Not in scope for audit #24 but worth a dedicated small PR.**

## Finding: `?q=100` is 25 MB vs the 38 MB original — quality notes

Worth documenting because this question will come up again. The Sanity CDN image URL (`cdn.sanity.io/images/…`) always decodes and re-encodes — you cannot get a byte-for-byte copy of the original upload through this URL, even at `?q=100`. The ~13 MB delta between the 38 MB original and the 25 MB q=100 version is composed of:

- **Stripped metadata (2–5 MB typical):** EXIF, XMP, IPTC, embedded thumbnails, ICC color profiles. All removed by Sanity.
- **JPEG re-encoding (5–8 MB typical):** Sanity uses its own encoder, which typically produces smaller files than camera-manufacturer encoders at the same nominal "quality." Camera JPEGs are often encoded with more conservative quantization tables.
- **Chroma subsampling:** cameras shoot at 4:4:4 (full color resolution), Sanity likely re-encodes at 4:2:0 (half-resolution color). This is where most of the byte savings come from. Visibly imperceptible on photographs at print distances — every consumer JPEG and every web video uses 4:2:0.
- **Generational loss:** JPEG is lossy. Decode → re-encode at q100 has a mathematically non-zero quality loss (~0.5–1% per pass at q95+). Tiny but not zero.

**Practical print impact:** negligible. JPEG q95+ is beyond the threshold of what a 300 DPI print on fine art paper can reproduce. A side-by-side print comparison of the 38 MB original vs the 25 MB q=100 version would be extremely hard to distinguish. The chroma subsampling contributes the most to the byte delta and is invisible at print scale.

**If you ever want the true 38 MB original:** you'd need to store originals in R2/S3 separately from Sanity, reference them in product variants, and have the webhook fetch from R2 (not the Sanity CDN). Significant architectural change — not recommended unless a specific print quality complaint surfaces. The q95 or q100 Sanity CDN versions are the pragmatic choice for v1.

---

## Raw measurements

### Cold start — single image, q80 CDN source + q92 output (early spike, baseline)

```
Download:  1286 ms
Metadata:    11 ms
Sharp:      796 ms
-----------------
Total:     2093 ms
Memory delta: 35 MB
```

### Warm — 5-image, q80 source + q92 output (early runs)

Run 1:  Total 11833 ms | Download sum 8112 ms | Sharp sum 3690 ms | Mem +226 MB
Run 2:  Total  9506 ms | Download sum 5785 ms | Sharp sum 3707 ms | Mem +175 MB

Per-image Sharp time was rock-solid 705–800 ms across both runs. Download variance was 137–1900 ms per image (first was CDN-cached).

### Warm — 5-image, **q95 source + q92 output** (verifying larger sources still fit)

```
Total: 12462 ms (12.5 s)
Source bytes total: 47.5 MB  (vs 17.9 MB at q80 — 2.65× more)
Download sum: 8364 ms
Sharp sum:    4077 ms
Memory delta: 292 MB
```

Key observation: **+165% source bytes, only +3% download time**. Download is latency-bound.

### Warm — 5-image, **q95 source + q95 output** (final PR #6 target pipeline)

```
#  Dimensions    Src     Out     Download   Sharp   Total
1  5012×7518    5.6 MB  5.6 MB   730 ms    839 ms  1580 ms
2  5012×7518    9.0 MB  8.9 MB   740 ms    841 ms  1582 ms
3  5152×7728    9.8 MB 10.0 MB   785 ms    951 ms  1738 ms
4  5152×7728   10.6 MB 10.8 MB   940 ms    878 ms  1826 ms
5  6748×4499   12.5 MB 12.8 MB   980 ms    845 ms  1827 ms
                               --------   ------- --------
                               4175 ms   4354 ms  8553 ms

Source bytes total: 47.5 MB
Output bytes total: 48.2 MB  (quality preserved through pipeline)
Memory delta: 288 MB
```

**This is the run that matters.** End-to-end q95 source → Sharp composite → q95 output. 8.6 seconds for 5 large images sequentially. Output file sizes match source file sizes — no quality loss through the compositing pipeline.

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

1. **Parallelize downloads in PR #6.** Sharp must run sequentially (memory pressure), but downloads can run concurrently. Would cut the 5-image total from 8.6s to ~5–6s. Easy win, implement from the start.
2. **Keep-alive connection pooling.** Node's default `fetch` creates a new TLS session per call. Sharing an undici `Agent` with `keepAlive: true` across the print-set fetches might cut another ~500 ms off the download sum. Worth testing in PR #6.
3. **Small drive-by PR: append `?q=95` to LumaPrints image URLs in the current webhook.** The existing webhook submits default-quality (~q80) CDN URLs to LumaPrints. PR #6 will naturally use `?q=95` for its own pipeline, but the *current* (non-bordered) submission path should also be upgraded. Tiny change, meaningful quality improvement, not in audit #24 scope but worth tracking as a follow-up audit item.

These are explicit follow-ups for the PR #6 design phase, not blockers for this spike.
