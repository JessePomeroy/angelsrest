# angelsrest

Photography portfolio and e-commerce site built with SvelteKit 2, Sanity CMS, and Stripe.

## Tech Stack

- **SvelteKit 2** (Svelte 5) — Framework
- **Sanity CMS** — Content management (embedded studio at `/studio`)
- **Stripe** — Payment processing
- **TypeScript** — Type safety

## Project Structure

```
src/
├── lib/
│   ├── components/       # Reusable Svelte components
│   │   ├── Nav.svelte
│   │   └── Footer.svelte
│   ├── sanity/
│   │   ├── client.ts     # Sanity client + image URL builder
│   │   ├── studio.ts     # Sanity Studio config
│   │   └── schemas/      # Content schemas
│   │       ├── gallery.ts
│   │       ├── product.ts
│   │       ├── about.ts
│   │       └── index.ts
│   └── styles/
│       └── global.css    # Global styles (dark theme)
├── routes/
│   ├── +layout.svelte    # Main layout (nav + footer)
│   ├── +page.svelte      # Home
│   ├── gallery/
│   │   ├── +page.svelte  # Gallery grid
│   │   └── [slug]/+page.svelte  # Single image
│   ├── shop/
│   │   ├── +page.svelte  # Product grid
│   │   └── [slug]/+page.svelte  # Product detail
│   ├── about/+page.svelte
│   ├── contact/+page.svelte
│   └── (studio)/studio/[[...tool]]/  # Embedded Sanity Studio
```

## Sanity Schemas

- **Gallery** — Images with title, slug, description, category, tags, date, featured flag
- **Product** — Prints/merch with title, images, price (cents), variants, stock status
- **About** — Artist bio, portrait, social links

## Getting Started

```bash
# Install dependencies
npm install

# Copy env and fill in your values
cp .env.example .env

# Run dev server
npm run dev
```

## Environment Variables

| Variable | Description |
|---|---|
| `PUBLIC_SANITY_PROJECT_ID` | Sanity project ID |
| `PUBLIC_SANITY_DATASET` | Sanity dataset (default: `production`) |
| `SANITY_PROJECT_ID` | Server-side Sanity project ID |
| `SANITY_DATASET` | Server-side Sanity dataset |
| `STRIPE_SECRET_KEY` | Stripe secret key (server-side) |
| `STRIPE_PUBLIC_KEY` | Stripe publishable key |
| `PUBLIC_STRIPE_PUBLIC_KEY` | Client-side Stripe key |
| `PUBLIC_SITE_URL` | Site URL |

## Setup Sanity

1. Create a Sanity project at [sanity.io](https://sanity.io)
2. Add your project ID and dataset to `.env`
3. Access the studio at `http://localhost:5173/studio`

## Setup Stripe

1. Get API keys from [Stripe Dashboard](https://dashboard.stripe.com)
2. Add keys to `.env`
3. Implement checkout in `/shop/[slug]` and create API routes

## Next Steps

- [ ] Connect Sanity client to route data fetching
- [ ] Implement Stripe checkout flow
- [ ] Add image optimization and lazy loading
- [ ] Add cart functionality
- [ ] Set up Sanity webhooks for revalidation
- [ ] Add SEO meta tags per page
- [ ] Deploy (Vercel/Netlify)
