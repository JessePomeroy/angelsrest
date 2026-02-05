# Learning Plan & Roadmap

A phased plan for building out angelsrest.online, ordered to progressively re-learn web dev skills.

**Stack:** SvelteKit 2 (Svelte 5) · Tailwind CSS · Skeleton UI · Sanity CMS · Stripe

---

## Phase 1 — Get It Running ✅

- [x] Dev server running at `localhost:5173`
- [x] Skeleton theme configured (`cerberus`)
- [x] Tailwind utility classes working
- [x] Nav and Footer components
- [x] Home page and About page (static)
- [x] Responsive breakpoints

## Phase 2 — Content Management ✅

- [x] Sanity project set up with project ID
- [x] `.env` file configured
- [x] Embedded studio at `/studio`
- [x] Schemas defined (`gallery`, products, about)
- [x] Sanity client wired up (`lib/sanity/client.ts`)
- [x] `@sanity/orderable-document-list` for drag-and-drop gallery ordering

## Phase 3 — Dynamic Pages (In Progress)

### Gallery ✅
- [x] Gallery index page — fetches all galleries, displays as grid
- [x] Gallery `[slug]` page — dynamic routing, masonry layout
- [x] Lightbox modal — keyboard nav (arrows, Escape), click outside to close
- [x] Responsive columns (2 → 3 → 4 based on screen size)
- [x] Galleries ordered by `orderRank` (drag-and-drop in studio)

### Blog 🔲
- [ ] Blog schema in Sanity (title, slug, body, featured image, date, tags)
- [ ] Blog index page — fetch posts, display as list/cards
- [ ] Blog `[slug]` page — full post view with rich text rendering
- [ ] Portable Text component for Sanity block content

### Shop 🔲
- [ ] Shop index page — fetch products from Sanity
- [ ] Product cards with Skeleton styling
- [ ] Shop `[slug]` page — product detail with images, price, variants
- [ ] Skeleton form elements for variant selection

### About 🔲
- [ ] Wire up About page to pull from Sanity instead of static content

### Loading & Polish 🔲
- [ ] Add loading states (Skeleton placeholder components)
- [ ] Error boundaries for failed fetches

---

## Phase 4 — E-Commerce (Stripe)

- [ ] Set up Stripe keys and dashboard
- [ ] "Buy Now" checkout flow (Stripe Checkout)
- [ ] Cart functionality — Svelte stores, cart drawer
- [ ] API routes for server-side Stripe session creation (`/api/checkout`)
- [ ] Success/cancel pages for post-checkout
- [ ] Toast notifications for cart/checkout events

---

## Phase 5 — Polish & Ship

- [ ] Image optimization — lazy loading, responsive sizes, Sanity image pipeline
- [ ] SEO — meta tags, Open Graph, structured data
- [ ] Contact form — email service or Sanity submission
- [ ] Dark/light mode toggle (Skeleton built-in support)
- [ ] Performance audit (Lighthouse)
- [ ] Deploy to Vercel or Netlify
- [ ] Domain + DNS for angelsrest.online

---

## What's Next?

**Immediate priorities (Phase 3 completion):**

1. **Shop page** — Similar pattern to gallery. Create:
   - `src/routes/shop/+page.server.ts` — fetch products
   - `src/routes/shop/+page.svelte` — product grid
   - `src/routes/shop/[slug]/+page.server.ts` — fetch single product
   - `src/routes/shop/[slug]/+page.svelte` — product detail

2. **About page** — Create an "about" document type in Sanity (if not already), fetch and render

3. **Loading states** — Add Skeleton placeholders while data loads

**After that:** Phase 4 (Stripe integration) is the big one — turns the site into a real shop.

---

## Files We Built Today (2025-02-04)

| File | Purpose |
|------|---------|
| `src/lib/components/GalleryModal.svelte` | Lightbox modal with keyboard nav |
| `src/routes/gallery/+page.svelte` | Gallery index (picker) |
| `src/routes/gallery/+page.server.ts` | Fetches all galleries |
| `src/routes/gallery/[slug]/+page.svelte` | Single gallery view (masonry) |
| `src/routes/gallery/[slug]/+page.server.ts` | Fetches single gallery by slug |
| `src/lib/sanity/studio.ts` | Added orderable document list |
| `src/lib/sanity/schemas/gallery.ts` | Added orderRankField |

---

## Responsiveness — Ongoing

Build mobile-first. Check every component at:
- Mobile (375px)
- Tablet (768px)
- Desktop (1280px+)

**Tailwind breakpoints:**
- `sm:` → 640px
- `md:` → 768px
- `lg:` → 1024px
- `xl:` → 1280px

---

## Reference Docs

- [Tailwind CSS](https://tailwindcss.com/docs)
- [Skeleton UI](https://www.skeleton.dev/docs/svelte/get-started/introduction)
- [Svelte 5](https://svelte.dev/docs/svelte/overview)
- [SvelteKit](https://svelte.dev/docs/kit/routing)
- [Sanity](https://www.sanity.io/docs)
- [Stripe Checkout](https://stripe.com/docs/payments/checkout)
