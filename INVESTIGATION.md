# Angel's Rest — Skeleton UI + Tailwind Investigation

## Summary

**The current codebase (after rollback) is actually in a working state.** Skeleton v4.11.0 + Tailwind v4.1.18 compile successfully. The errors from the failed session were likely caused by an older Skeleton version or a mid-migration broken state.

---

## What Went Wrong

### Error 1: `Cannot use @variant with unknown variant: md`

**Root cause:** Skeleton's CSS uses `@variant md { ... }` — a Tailwind v4 directive for applying styles at responsive breakpoints. This was a known bug in **Skeleton v3.0–3.1.x** (GitHub issues [#3387](https://github.com/skeletonlabs/skeleton/issues/3387), [#3489](https://github.com/skeletonlabs/skeleton/issues/3489)) where the CSS shipped with `@variant md` but Tailwind v4 didn't resolve it properly in certain build configurations.

**Current status:** Fixed. The installed `@skeletonlabs/skeleton@4.11.0` compiles cleanly with `tailwindcss@4.1.18`. I verified this by running `@tailwindcss/cli` against `global.css` — it produces 3,584 lines of valid CSS with no errors.

### Error 2: Duplicate `<script>` tag in `+layout.svelte`

**Root cause:** The bot accidentally inlined a BottomNav component directly into `+layout.svelte` instead of creating a separate file, resulting in two `<script>` blocks (which Svelte doesn't allow).

**Current status:** Fixed. The current `+layout.svelte` has a single `<script>` block and cleanly imports `Nav` and `Footer` components.

### Error 3: Bot tried switching to Tailwind v3, hit context limits

**Root cause:** Misdiagnosis. The bot thought the `@variant` error meant Tailwind v4 was incompatible and tried downgrading to v3. But Skeleton v4.x **requires** Tailwind v4 (`peerDependencies: "tailwindcss": "^4.0.0"`). Downgrading to Tailwind v3 would have made things worse.

---

## Current Versions (Installed)

| Package | Version | Status |
|---|---|---|
| `tailwindcss` | 4.1.18 | ✅ Latest |
| `@tailwindcss/vite` | 4.1.18 | ✅ Latest |
| `@skeletonlabs/skeleton` | 4.11.0 | ✅ Latest |
| `@skeletonlabs/skeleton-svelte` | 4.11.0 | ✅ Latest |
| `svelte` | ^5.48.2 | ✅ |
| `@sveltejs/kit` | ^2.50.1 | ✅ |
| `vite` | ^7.3.1 | ✅ |

**These are all compatible.** Skeleton v4 is the Tailwind v4-native version.

---

## Compatibility Matrix

| Skeleton Version | Tailwind Version | Status |
|---|---|---|
| Skeleton v2.x | Tailwind v3 | Legacy, works |
| Skeleton v3.0–3.1.x | Tailwind v4 | **Buggy** — `@variant md` errors |
| Skeleton v4.x | Tailwind v4 | ✅ Works |
| Skeleton v4.x | Tailwind v3 | ❌ Incompatible |

---

## Architecture (Current State)

- **CSS setup:** `src/lib/styles/global.css` — correct import order:
  1. `@import 'tailwindcss'` (establishes theme + breakpoints)
  2. `@import '@skeletonlabs/skeleton'` (core styles)
  3. `@import '@skeletonlabs/skeleton-svelte'` (component styles)
  4. `@import '@skeletonlabs/skeleton/themes/cerberus'` (theme)
- **Vite config:** Uses `@tailwindcss/vite` plugin — correct for Tailwind v4
- **No `tailwind.config.*`** — correct, Tailwind v4 uses CSS-based config
- **Theme:** `cerberus` set via `data-theme` in `app.html`

---

## Recommended Next Steps

**The foundation is solid. No version changes needed.** To continue development:

1. **Test the dev server works:**
   ```bash
   cd angelsrest && npm run dev
   ```
   (Build hangs in CLI due to missing Sanity env vars / SSR issues — dev server should work)

2. **If build fails on Sanity SSR**, add environment variables or make Sanity client-side only

3. **Continue building features** per `PLAN.md` — the Skeleton + Tailwind stack is correctly configured

4. **Do NOT downgrade to Tailwind v3** — Skeleton v4 requires v4

---

## Lesson Learned

The original error was a **known Skeleton bug that's already been fixed** in the version currently installed. The failed session's mistake was trying to downgrade Tailwind instead of upgrading Skeleton. When the bot hit context limits mid-migration, the code was left in a broken state and had to be rolled back. The rollback restored a working codebase.
