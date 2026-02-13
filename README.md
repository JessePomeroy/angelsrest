# angelsrest

Photography portfolio and e-commerce site built with SvelteKit 2, Sanity CMS, Skeleton UI, and Stripe.

**Live:** [angelsrest.online](https://angelsrest.online)

## Tech Stack

- **SvelteKit 2** (Svelte 5 with runes) — Framework
- **Sanity CMS** — Content management
- **Skeleton UI** — Component library with Hamlindigo theme
- **Stripe** — Payment processing (live checkout)
- **Tailwind CSS v4** — Styling
- **TypeScript** — Type safety
- **Vercel** — Hosting with automatic deployments

## Features

### ✅ Implemented
- **E-commerce checkout** — Full Stripe integration with Buy Now flow
- **Theming** — Hamlindigo theme with light/dark mode support
- **Product management** — Drag-and-drop ordering in Sanity Studio
- **Image optimization** — Automatic WebP conversion and responsive sizes
- **Mobile-first design** — Responsive layout with bottom navigation
- **SEO** — Per-page meta tags and OpenGraph support

### 🚧 Planned
- Webhook notifications for orders
- Email confirmations to customers
- Inventory management
- Customer reviews

## Project Structure

```
src/
├── lib/
│   ├── components/           # Reusable Svelte components
│   │   ├── Nav.svelte        # Desktop navigation
│   │   ├── BottomNav.svelte  # Mobile bottom navigation
│   │   ├── Footer.svelte     # Desktop footer
│   │   ├── ThemeSwitcher.svelte  # Light/dark toggle
│   │   ├── GalleryModal.svelte   # Image lightbox
│   │   ├── BlogCard.svelte   # Blog post preview cards
│   │   └── SEO.svelte        # Meta tags component
│   ├── sanity/
│   │   └── client.ts         # Sanity client + image URL builder
│   ├── stores/
│   │   └── theme.ts          # Theme state management
│   └── styles/
│       └── global.css        # Global styles, theming, gradients
│
├── routes/
│   ├── +layout.svelte        # Main layout (nav, footer, theme)
│   ├── +page.svelte          # Home (hero, CTA buttons)
│   │
│   ├── gallery/
│   │   ├── +page.svelte      # Gallery grid
│   │   └── [slug]/+page.svelte  # Single gallery view
│   │
│   ├── shop/
│   │   ├── +page.svelte      # Product grid with category filters
│   │   ├── +page.server.ts   # Product list data loading
│   │   └── [slug]/
│   │       ├── +page.svelte  # Product detail with Buy Now
│   │       └── +page.server.ts  # Product data + image optimization
│   │
│   ├── blog/
│   │   ├── +page.svelte      # Blog listing
│   │   └── [slug]/+page.svelte  # Blog post
│   │
│   ├── about/+page.svelte    # About page with contact form
│   │
│   ├── api/
│   │   └── checkout/
│   │       └── +server.ts    # Stripe checkout session creation
│   │
│   └── checkout/
│       ├── success/+page.svelte  # Post-payment success
│       └── cancel/+page.svelte   # Payment cancelled
│
└── angelsrest-studio/        # Sanity Studio (separate project)
    └── schemaTypes/
        ├── product.ts        # Products with orderRank for reordering
        ├── gallery.ts        # Gallery images
        ├── about.ts          # About page content
        ├── post.ts           # Blog posts
        └── index.ts          # Schema exports
```

## Sanity Schemas

| Schema | Purpose | Key Fields |
|--------|---------|------------|
| **Product** | Shop items | title, slug, images[], price, category, inStock, orderRank |
| **Gallery** | Portfolio images | title, slug, image, description, category, featured |
| **Post** | Blog articles | title, slug, body, author, categories, publishedAt |
| **About** | Artist bio | bio, portrait, socialLinks |

## Getting Started

```bash
# Install dependencies
npm install

# Copy env and fill in your values
cp .env.example .env

# Run dev server
npm run dev

# Run Sanity Studio (separate terminal)
cd angelsrest-studio && npm run dev
```

## Environment Variables

### Required for Production

| Variable | Description | Example |
|----------|-------------|---------|
| `PUBLIC_SANITY_PROJECT_ID` | Sanity project ID | `n7rvza4g` |
| `PUBLIC_SANITY_DATASET` | Sanity dataset | `production` |
| `PUBLIC_SITE_URL` | Your site URL | `https://angelsrest.online` |
| `STRIPE_SECRET_KEY` | Stripe secret key (server-side) | `sk_live_...` |
| `RESEND_API_KEY` | Resend email API key | `re_...` |

### Optional

| Variable | Description |
|----------|-------------|
| `STRIPE_PUBLIC_KEY` | Stripe publishable key (if using Stripe.js) |

## Stripe Integration

The checkout flow uses Stripe's hosted Checkout Sessions:

1. **User clicks "Buy Now"** on product page
2. **Frontend calls** `/api/checkout` with product data
3. **Server creates** Stripe Checkout Session
4. **User redirected** to Stripe's secure payment page
5. **After payment**, redirected to `/checkout/success` or `/checkout/cancel`

### Testing Payments

Use Stripe's test cards in test mode:
- **Success:** `4242 4242 4242 4242`
- **Decline:** `4000 0000 0000 0002`
- Any future expiry, any CVC

## Theming

The site uses Skeleton UI's **Hamlindigo** theme for both light and dark modes:

- **Theme toggle:** Sun/moon switcher in navigation
- **Preference persistence:** Saved to localStorage
- **System preference:** Respects OS dark mode setting
- **Gradient backgrounds:** Subtle radial gradients for depth

### Customizing Theme

Edit `src/lib/styles/global.css`:
- Background gradients (light and dark variants)
- Heading typography
- Global text transformations

## Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy automatically on push to `main`

### Environment Variables in Vercel

Navigate to: **Settings → Environment Variables**

Add all required variables. Mark `STRIPE_SECRET_KEY` and `RESEND_API_KEY` as **Sensitive** (Production/Preview only).

## Development Guides

See the `guides/` folder for detailed documentation:

- `theme-switching.md` — How theming works
- `tailwind-and-global-css.md` — CSS architecture

## Code Quality

The codebase includes comprehensive educational comments explaining:
- Why architectural decisions were made
- How patterns work
- Security considerations
- Performance implications
- Future enhancement opportunities

Key files with detailed comments:
- `/api/checkout/+server.ts` — Payment processing
- `/shop/[slug]/+page.svelte` — Frontend checkout
- `/shop/[slug]/+page.server.ts` — Data loading patterns
- `/checkout/success/+page.svelte` — Post-purchase UX

## Contributing

This is a personal portfolio project, but the code is educational. Feel free to reference patterns for your own projects!

## License

All code is available for learning purposes. Artwork and content are © Jesse Pomeroy.