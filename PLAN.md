# Learning Plan & Roadmap

A phased plan for building out angelsrest.online, ordered to progressively re-learn web dev skills.

**Stack:** SvelteKit 2 (Svelte 5) · Tailwind CSS · Skeleton UI · Sanity CMS · Stripe

---

## Phase 1 — Get It Running (Tailwind + Skeleton refresher)

1. `npm install` and `npm run dev` — get the dev server up at `localhost:5173`
2. Explore the **Skeleton theme** — the project uses `cerberus` (dark theme). Browse available themes at [skeleton.dev](https://www.skeleton.dev) and try swapping in `global.css` + `app.html`
3. Tweak **Tailwind utility classes** in the existing components — colors, spacing, typography. Instant visual feedback
4. Get comfortable with **Skeleton's component classes** — `btn`, `preset-filled-*`, `preset-outlined-*`, etc.
5. Edit the **Nav** and **Footer** components — try Skeleton's AppBar or Navigation components as upgrades
6. Build out the **Home page** and **About page** — static content first, using Tailwind + Skeleton for layout and styling
7. Add **responsive breakpoints** — mobile nav (hamburger menu), responsive grids

**Docs to read:**
- Tailwind CSS: <https://tailwindcss.com/docs>
- Tailwind responsive design: <https://tailwindcss.com/docs/responsive-design>
- Skeleton getting started: <https://www.skeleton.dev/docs/svelte/get-started/introduction>
- Skeleton themes: <https://www.skeleton.dev/docs/svelte/design-system/themes>
- Skeleton components: <https://www.skeleton.dev/docs/svelte/tailwind-components/buttons>
- Svelte basics: <https://svelte.dev/docs/svelte/overview>
- SvelteKit routing: <https://svelte.dev/docs/kit/routing>
- CSS Flexbox: <https://css-tricks.com/snippets/css/a-guide-to-flexbox/>
- CSS Grid: <https://css-tricks.com/snippets/css/complete-guide-grid/>

## Responsiveness — Ongoing Throughout All Phases

Responsiveness isn't a phase — it's a mindset. Build mobile-first from day one.

**Tailwind breakpoints** (mobile-first — styles apply at that width and up):
- `sm:` → 640px
- `md:` → 768px
- `lg:` → 1024px
- `xl:` → 1280px
- `2xl:` → 1536px

**Every component you build, check it at:**
- Mobile (375px) — iPhone SE
- Tablet (768px) — iPad
- Desktop (1280px+)

**Key responsive patterns to practice:**
- Stacking → side-by-side layouts (`flex-col md:flex-row`)
- Grid column shifts (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- Responsive typography (`text-2xl md:text-4xl lg:text-5xl`)
- Hiding/showing elements (`hidden md:block`, `md:hidden`)
- Mobile hamburger nav → desktop horizontal nav
- Touch-friendly tap targets (min 44x44px on mobile)
- Image grids that reflow gracefully

**Dev tip:** Keep Chrome DevTools open in responsive mode the entire time you're building. Never code a component without checking how it looks on a phone.

---

## Phase 2 — Content Management (Sanity CMS)

8. Set up your **Sanity project** at [sanity.io](https://sanity.io), get your project ID
9. Fill in your `.env` file
10. Access the **embedded studio** at `/studio` — add some test gallery images and products
11. Learn the **schemas** (`lib/sanity/schemas/`) — understand how gallery, product, and about content is structured
12. Wire up the **Sanity client** (`lib/sanity/client.ts`) to fetch real data

## Phase 3 — Dynamic Pages (SvelteKit data loading + Skeleton components)

13. Connect the **Gallery page** — fetch images from Sanity, render with Skeleton's card components or a Tailwind grid
14. Build the **Gallery [slug] page** — dynamic routing, individual image view, use Skeleton's dialog/lightbox for fullscreen
15. Connect the **Shop page** — fetch products from Sanity, product cards with Skeleton styling
16. Build the **Shop [slug] page** — product detail with images, price, variants using Skeleton form elements
17. Wire up the **About page** to pull from Sanity instead of static content
18. Add **loading states** — Skeleton's placeholder/skeleton components for content loading

## Phase 4 — E-Commerce (Stripe + interactivity)

19. Set up **Stripe** keys and dashboard
20. Build a basic **"Buy Now" checkout** flow on product pages (Stripe Checkout is the easiest entry point)
21. Add **cart functionality** — state management in Svelte (stores), cart drawer using Skeleton's navigation/panel components
22. Create **API routes** for server-side Stripe session creation
23. Add a **success/cancel** page for post-checkout
24. Use Skeleton's **toast** component for cart/checkout notifications

## Phase 5 — Polish & Ship

25. **Image optimization** — lazy loading, responsive sizes, Sanity's image pipeline
26. **SEO** — meta tags, Open Graph, structured data per page
27. **Contact form** — hook up to an email service or Sanity, styled with Skeleton form components
28. **Dark/light mode** — Skeleton has built-in dark mode support
29. **Performance pass** — Lighthouse audit, fix any issues
30. **Deploy** to Vercel or Netlify
31. **Domain + DNS** setup for angelsrest.online

---

## Skills Progression

Each phase builds on the last:

**Tailwind utilities → Skeleton components → Svelte templating → data fetching → API routes → state management → deployment**
