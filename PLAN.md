# Learning Plan & Roadmap

A phased plan for building out angelsrest.online, ordered to progressively re-learn web dev skills.

**Stack:** SvelteKit 2 (Svelte 5 runes) · Tailwind CSS v4 · Skeleton UI · Sanity CMS · Stripe

**Live Site:** [angelsrest.online](https://angelsrest.online)

---

## Phase 1 — Get It Running ✅

- [x] Dev server running at `localhost:5173`
- [x] Skeleton theme configured (hamlindigo)
- [x] Tailwind utility classes working
- [x] Nav and Footer components
- [x] Home page and About page (static)
- [x] Responsive breakpoints

## Phase 2 — Content Management ✅

- [x] Sanity project set up with project ID
- [x] `.env` file configured
- [x] Embedded studio at `/studio`
- [x] Schemas defined (`gallery`, `product`, `about`, `post`)
- [x] Sanity client wired up (`lib/sanity/client.ts`)
- [x] `@sanity/orderable-document-list` for drag-and-drop ordering

## Phase 3 — Dynamic Pages ✅

### Gallery ✅
- [x] Gallery index page — fetches all galleries, displays as grid
- [x] Gallery `[slug]` page — dynamic routing, masonry layout
- [x] Lightbox modal — keyboard nav (arrows, Escape), click outside to close
- [x] Responsive columns (2 → 3 → 4 based on screen size)
- [x] Galleries ordered by `orderRank` (drag-and-drop in studio)

### Blog ✅
- [x] Blog schema in Sanity (title, slug, body, featured image, date, categories)
- [x] Blog index page — fetch posts, display as cards
- [x] Blog `[slug]` page — full post view with rich text rendering
- [x] Portable Text component for Sanity block content
- [x] Author and category support

### Shop ✅
- [x] Shop index page — fetch products from Sanity
- [x] Product cards with consistent styling
- [x] Category filtering (All, Prints, Postcards, Tapestries, etc.)
- [x] Shop `[slug]` page — product detail with images, price, stock status
- [x] Product image lightbox

### About ✅
- [x] Contact form with Resend email integration

### Loading & Polish ✅
- [x] Error boundaries for failed fetches
- [x] 404 pages for missing content

---

## Phase 4 — E-Commerce (Stripe) ✅

- [x] Set up Stripe keys and dashboard
- [x] "Buy Now" checkout flow (Stripe Checkout Sessions)
- [x] API route for server-side Stripe session creation (`/api/checkout`)
- [x] Success page for completed payments
- [x] Cancel page for abandoned checkouts
- [x] Product metadata attached to Stripe sessions

### Still To Do 🔲
- [ ] Webhook endpoint for order notifications
- [ ] Email confirmation to customers
- [ ] Inventory management (auto-decrement stock)
- [ ] Order tracking in Sanity

---

## Phase 5 — Polish & Ship ✅

- [x] Image optimization — Sanity image pipeline with WebP
- [x] SEO — per-page meta tags, Open Graph
- [x] Dark/light mode toggle (Hamlindigo theme)
- [x] Deploy to Vercel with automatic deployments
- [x] Domain configured (angelsrest.online)
- [x] Environment variables in Vercel

### Theming ✅
- [x] Single hamlindigo theme for both light/dark modes
- [x] Subtle radial gradient backgrounds for depth
- [x] Global lowercase text transformation
- [x] Consistent card styling across shop/blog

---

## Phase 6 — Business Operations 🔲

### Order Management
- [ ] Stripe webhook endpoint (`/api/webhooks/stripe`)
- [ ] Order notification emails (to seller)
- [ ] Customer confirmation emails
- [ ] Order history in Sanity

### Inventory
- [ ] Stock tracking in Sanity
- [ ] Auto-update stock on purchase
- [ ] Low stock alerts

### Analytics
- [ ] Order dashboard/admin page
- [ ] Revenue tracking
- [ ] Popular products report

---

## Files Built During Stripe Integration (2025-02-12)

| File | Purpose |
|------|---------|
| `src/routes/api/checkout/+server.ts` | Creates Stripe Checkout Sessions |
| `src/routes/checkout/success/+page.svelte` | Post-payment success page |
| `src/routes/checkout/cancel/+page.svelte` | Payment cancelled page |
| `src/routes/shop/+page.server.ts` | Product list data loading with orderRank |
| `src/routes/shop/[slug]/+page.server.ts` | Single product data + image optimization |
| `src/routes/shop/[slug]/+page.svelte` | Product detail with Buy Now integration |
| `src/lib/styles/global.css` | Updated with gradients, lowercase, hamlindigo |
| `src/lib/components/ThemeSwitcher.svelte` | Simplified for single theme |
| `src/app.html` | Updated theme initialization |

### Sanity Studio Changes
| File | Change |
|------|--------|
| `schemaTypes/product.ts` | Added `orderRank` field for drag-and-drop ordering |
| `sanity.config.ts` | Added `orderableDocumentListDeskItem` for products |

---

## Code Quality

All major files include comprehensive educational comments explaining:
- Why architectural decisions were made
- How patterns work
- Security considerations
- Performance implications
- Future enhancement opportunities

Key documented files:
- `/api/checkout/+server.ts` — Stripe payment processing
- `/shop/[slug]/+page.svelte` — Frontend checkout integration
- `/shop/[slug]/+page.server.ts` — SvelteKit data loading
- `/checkout/success/+page.svelte` — Post-purchase UX
- `/checkout/cancel/+page.svelte` — Abandonment handling

---

## Stripe Webhook Roadmap (Next Priority)

### Why Webhooks?
Currently, you only know about orders by checking Stripe Dashboard. Webhooks notify your server in real-time.

### Implementation Plan

1. **Create webhook endpoint**
   ```
   src/routes/api/webhooks/stripe/+server.ts
   ```

2. **Configure Stripe Dashboard**
   - Add webhook URL
   - Select events: `checkout.session.completed`
   - Get webhook signing secret

3. **Handle webhook**
   - Verify Stripe signature
   - Extract order details
   - Send notification email
   - (Optional) Create order in Sanity

4. **Test with Stripe CLI**
   ```bash
   stripe listen --forward-to localhost:5173/api/webhooks/stripe
   stripe trigger checkout.session.completed
   ```

---

## Reference Docs

- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [Skeleton UI](https://www.skeleton.dev/docs)
- [Svelte 5 Runes](https://svelte.dev/docs/svelte/overview)
- [SvelteKit](https://svelte.dev/docs/kit/routing)
- [Sanity](https://www.sanity.io/docs)
- [Stripe Checkout](https://stripe.com/docs/payments/checkout)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)

---

## Responsiveness Reference

**Tailwind breakpoints (mobile-first):**
| Prefix | Min Width | Usage |
|--------|-----------|-------|
| (none) | 0px | Mobile default |
| `sm:` | 640px | Small tablets |
| `md:` | 768px | Tablets |
| `lg:` | 1024px | Laptops |
| `xl:` | 1280px | Desktops |

---

## Environment Variables Reference

### Required
| Variable | Description |
|----------|-------------|
| `PUBLIC_SANITY_PROJECT_ID` | Sanity project ID |
| `PUBLIC_SANITY_DATASET` | Sanity dataset |
| `PUBLIC_SITE_URL` | Site URL for Stripe redirects |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `RESEND_API_KEY` | Email service API key |

### Vercel Setup
1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add all required variables
3. Mark `STRIPE_SECRET_KEY` and `RESEND_API_KEY` as Sensitive
4. Redeploy after adding/changing variables