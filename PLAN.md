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
- [x] Webhook endpoint for order notifications
- [x] Email confirmation to customers
- [ ] Inventory management (auto-decrement stock)
- [x] Order tracking in Sanity

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

## Phase 6 — Business Operations 🔧

### Order Management ✅
- [x] Stripe webhook endpoint (`/api/webhooks/stripe`)
- [x] Order notification emails (to seller via Resend)
- [x] Customer confirmation emails (via Resend)
- [x] Order history in Sanity (order schema + webhook creates docs)
- [x] Idempotency check (prevents duplicate orders)
- [x] Sequential order numbers (ORD-001, ORD-002...)
- [x] Custom fulfillment status (New → Printing → Ready → Shipped → Delivered)
- [x] Internal notes field for fulfillment details
- [x] Admin Sanity client with write token
- [x] Actual Stripe fees captured from balance_transaction (3s delay approach)
- [x] Payment intent ID stored for fee lookups (`stripePaymentIntentId`)

### Inventory
- [ ] Stock tracking in Sanity

### Admin Dashboard ✅
- [x] Admin orders page (`/admin/orders`)
  - [x] Fetch orders from Sanity via GROQ
  - [x] Display orders in sortable/filterable table
  - [x] Show order details (customer, items, total, status)
  - [x] Update order status from frontend
  - [x] Filter by status
  - [x] Search by customer email/order number
  - [x] Edit notes in modal
  - [x] HTTP Basic Auth protection (password-protected)
  - [x] Year filter
  - [x] Period filter (today/week/month)
  - [x] CSV export with Gross Revenue / Stripe Fees / Net Revenue columns
  - [x] Revenue summary (filtered, all-time, average)
  - [x] HTTP Basic Auth protection (password-protected)
  - [x] Accessibility: keyboard navigation on table rows, ARIA roles on modal
  - [x] TypeScript: proper type annotations (Handle type, Set casting, array types)

### Analytics (Future)
- [ ] Revenue tracking
- [ ] Popular products report

---

## Admin Orders Page Design

**Purpose:** Cleaner order management than Sanity Studio

### Page Layout

**URL:** `/admin/orders`

**Features:**
- Table view of all orders (newest first)
- Columns: Order #, Date, Customer, Items, Total, Status
- Status badges with colors (New=blue, Printing=yellow, Shipped=green, etc.)
- Click row to expand details
- Filter dropdown: All, New, Printing, Ready, Shipped, Delivered
- Search: filter by email or order number

### Status Update

- Click status to change it (dropdown)
- Updates Sanity in real-time
- Changes reflect in Sanity Studio too

### Mobile

- Stacks to card view on mobile
- Horizontal scroll for table on tablet

### Implementation

```
src/routes/admin/orders/+page.server.ts  // Fetch orders via GROQ
src/routes/admin/orders/+page.svelte     // Table UI with Skeleton
src/routes/api/admin/orders/[id]/+server.ts  // Update status
```

### GROQ Query

```groq
*[_type == "order"] | order(createdAt desc) {
  _id,
  orderNumber,
  createdAt,
  customerEmail,
  customerName,
  total,
  status,
  items[]{
    productName,
    quantity,
    price
  }
}
```

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

## Files Built During Order History Integration (2026-03-06)

### Frontend (angelsrest)
| File | Purpose |
|------|---------|
| `src/lib/sanity/adminClient.ts` | Write-enabled Sanity client (server-side only) |
| `src/lib/server/adminAuth.ts` | HTTP Basic Auth handler (typed with SvelteKit's `Handle`) |
| `src/lib/orders/orderNumber.ts` | Sequential order number generator + idempotency check |
| `src/routes/api/webhooks/stripe/+server.ts` | Webhook: creates order, sends emails, captures Stripe fees |
| `src/hooks.server.ts` | Routes /admin requests through Basic Auth |
| `src/routes/admin/orders/+page.server.ts` | Fetch orders from Sanity via GROQ |
| `src/routes/admin/orders/+page.svelte` | Admin orders dashboard UI |
| `src/routes/api/admin/orders/[id]/+server.ts` | API to update order status/notes |

### Sanity Studio (angelsrest-studio)
| File | Purpose |
|------|---------|
| `schemaTypes/order.ts` | Order schema (customer, items, shipping, status, fees, notes) |
| `schemaTypes/index.ts` | Updated — added order import |
| `sanity.config.ts` | Updated — added Orders to sidebar structure |

---

## Stripe Fees Implementation (2026-03-06)

### The Problem
Stripe's `balance_transaction` (which contains actual fees) isn't available immediately
when `checkout.session.completed` fires. We tried several approaches:

1. **Expand at checkout time** — `balance_transaction` is null at this point
2. **Separate `charge.succeeded` webhook** — fires simultaneously on a different serverless
   instance, race condition with order creation
3. **Separate `payment_intent.succeeded` webhook** — same timing issue
4. **Retry logic in separate handlers** — still unreliable due to Vercel serverless isolation

### The Solution
After creating the order in `handleCheckoutCompleted`, wait 3 seconds, then fetch the
payment intent with expanded `latest_charge.balance_transaction`. By this point Stripe
has finalized the transaction. Everything happens in ONE handler — no race conditions.

```
checkout.session.completed → create order → wait 3s → fetch fees → update order
```

### Key Fields
- `stripePaymentIntentId` — stored on order for fee lookups
- `stripeFees` — actual fee in cents from `balance_transaction.fee`

### Lesson Learned
On Vercel (serverless), webhook events fire on separate instances simultaneously.
You can't rely on one webhook handler's work being visible to another handler that
fires at the same time. Keep related logic in a single handler when possible.

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
- `/api/webhooks/stripe/+server.ts` — Webhook handling & order creation
- `/admin/orders/+page.svelte` — Admin dashboard
- `hooks.server.ts` — HTTP Basic Auth

---

## Authentication Learning Guide

### HTTP Basic Auth (What We Used)

**How it works:**
1. User visits protected page
2. Server checks for `Authorization` header
3. If missing → returns `401 Unauthorized` + `WWW-Authenticate: Basic` header
4. Browser shows login popup
5. User enters credentials
6. Browser sends `Authorization: Basic base64(username:password)`
7. Server verifies password
8. If correct → serve the page

**Pros:** Simple, no database, works everywhere
**Cons:** No logout, single password, can't track "who"

**Code location:** `src/hooks.server.ts`

### Other Auth Options (For Future)

| Method | Pros | Cons | Use Case |
|--------|------|------|----------|
| Session cookies | User tracking, logout | Database needed | Real user accounts |
| OAuth (Google, GitHub) | No password management | Setup complexity | Social login |
| JWT tokens | Stateless, scalable | Complexity | APIs, SPAs |
| Clerk/Auth.js | Full-featured | Third-party dependency | Complete auth solution |

### When to Upgrade?

- Multiple users with different permissions
- Need user accounts for customers
- Want "forgot password" flow
- Need audit logs ("who did what")

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
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `RESEND_API_KEY` | Email service API key |
| `SANITY_WRITE_TOKEN` | Sanity token with write permissions (server-side only) |

### Vercel Setup
1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add all required variables
3. Mark `STRIPE_SECRET_KEY` and `RESEND_API_KEY` as Sensitive
4. Redeploy after adding/changing variables