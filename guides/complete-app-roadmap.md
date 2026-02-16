# Complete App Roadmap: Zero to Production

**A comprehensive guide to building a modern web application from concept to production**

*Based on the real-world development of [angelsrest.online](https://angelsrest.online) — a portfolio + e-commerce site built with SvelteKit, Sanity CMS, Stripe, and modern web standards.*

---

## 🎯 What We're Building

**The Goal:** A professional portfolio and e-commerce website that showcases creative work and sells products online.

**Key Features:**
- **Portfolio gallery** with lightbox and filtering
- **Blog** with rich content management
- **E-commerce** with secure payments and automated emails
- **Responsive design** with light/dark mode
- **Content management** for non-technical users
- **Production-ready** deployment and monitoring

**Tech Stack:**
- **Frontend:** SvelteKit 5 + Svelte 5 (with Runes), TypeScript
- **Styling:** Tailwind CSS v4 + Skeleton UI
- **CMS:** Sanity (headless CMS)
- **Payments:** Stripe Checkout + Webhooks
- **Email:** Resend API
- **Deployment:** Vercel with automatic deployments

> **⚠️ Svelte 5 Required**: This guide uses modern Svelte 5 syntax throughout, including:
> - **Runes**: `$state()`, `$props()`, `$effect()` instead of stores and exports
> - **Event handlers**: `onclick` instead of `on:click`
> - **Content projection**: `{@render children?.()}` and snippets instead of deprecated `<slot />`
> - **Layout patterns**: `let { children } = $props();` to receive child content
> 
> All examples are Svelte 5 compatible and use current best practices.

---

## 📚 Learning Approach

This roadmap is designed as a **progressive skill-building journey:**

1. **Build core functionality first** — get something working
2. **Layer on complexity** — add features incrementally  
3. **Learn through implementation** — theory + practice together
4. **Document everything** — create guides as you build
5. **Deploy early and often** — test in production regularly

**Time Investment:** ~40-60 hours total (spread over weeks/months)
**Prerequisites:** Basic HTML/CSS/JavaScript knowledge

---

## Phase 1: Foundation & Setup
*Estimated time: 4-6 hours*

### Goals
- Set up development environment
- Get a basic SvelteKit app running
- Understand modern web development tooling

### Tasks

#### 1.1 Initialize SvelteKit Project
```bash
# Create new project
npm create svelte@latest my-app
cd my-app
npm install

# Start dev server
npm run dev
```

**Key Learnings:**
- **SvelteKit** is a full-stack framework built on Svelte
- **File-based routing** — `src/routes/` folder structure defines URLs
- **Server-side rendering** — pages render on server for better SEO/performance
- **TypeScript** provides better development experience with type checking

#### 1.2 Install Styling Framework
```bash
# Install Tailwind CSS v4 (via Vite plugin)
npm install -D @tailwindcss/vite

# Install Skeleton UI (component library)
npm install @skeletonlabs/skeleton @skeletonlabs/skeleton-svelte
```

**Key Learnings:**
- **Tailwind CSS** — utility-first framework (build UIs with classes like `flex`, `bg-blue-500`)
- **Skeleton UI** — pre-built components that work with Tailwind
- **Design systems** — consistent styling across your entire app

#### 1.3 Configure Global Styles

Create `src/lib/styles/global.css`:
```css
/* Import Tailwind and Skeleton */
@import 'tailwindcss';
@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton/themes/hamlindigo';

/* Enable class-based dark mode */
@custom-variant dark (&:where(.dark, .dark *));

/* Global design choices */
body {
  text-transform: lowercase;
  background: linear-gradient(...); /* Subtle brand gradients */
}
```

Import in `src/app.html`:
```html
<link rel="stylesheet" href="/src/lib/styles/global.css" />
```

**Key Learnings:**
- **Global CSS** handles framework imports and site-wide styles
- **CSS custom properties** and **design tokens** create consistent theming
- **Dark mode** can be handled with CSS classes or media queries

#### 1.4 Create Basic Layout

Create `src/routes/+layout.svelte`:
```svelte
<script>
  import '../lib/styles/global.css';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  
  let { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
  <Header />
  <main class="flex-1">
    {@render children?.()} <!-- Child pages render here -->
  </main>
  <Footer />
</div>
```

**Svelte 5 Snippets Example:**
```svelte
<!-- Parent component using snippets -->
<script>
  import Card from '$lib/components/Card.svelte';
</script>

<Card>
  {#snippet header()}
    <h2>Welcome!</h2>
  {/snippet}
  
  {#snippet content()}
    <p>This is the main content area.</p>
  {/snippet}
</Card>

<!-- Card.svelte component -->
<script>
  let { header, content, children } = $props();
</script>

<div class="card">
  <header>{@render header?.()}</header>
  <main>{@render content?.()}</main>
  <footer>{@render children?.()}</footer>
</div>
```

**Key Learnings:**
- **Layouts** wrap all pages with common elements (navigation, footer)
- **Snippets & children** — modern way to render child content (replaces deprecated slots)
- **`{#snippet name()} ... {/snippet}`** — define reusable content blocks
- **`{@render snippet?.()}`** — render snippets with optional chaining for safety
- **Flexbox** and **CSS Grid** handle complex layouts easily with Tailwind

#### 1.5 Build Navigation Components

Create responsive navigation with mobile menu:

`src/lib/components/Header.svelte`:
```svelte
<nav class="border-b border-surface-500/20">
  <div class="max-w-6xl mx-auto px-4">
    <!-- Desktop nav -->
    <div class="hidden md:flex items-center justify-between py-4">
      <a href="/" class="text-xl font-bold">Your Brand</a>
      <div class="flex gap-6">
        <a href="/gallery">Gallery</a>
        <a href="/shop">Shop</a>  
        <a href="/blog">Blog</a>
        <a href="/about">About</a>
      </div>
    </div>
    
    <!-- Mobile nav (implement hamburger menu) -->
  </div>
</nav>
```

**Key Learnings:**
- **Responsive design** — mobile-first approach with breakpoint prefixes (`md:`, `lg:`)
- **Component architecture** — break UI into reusable pieces
- **Navigation patterns** — hamburger menus, bottom nav, breadcrumbs

### Phase 1 Deliverables
✅ Working SvelteKit app with hot reloading  
✅ Responsive navigation and layout  
✅ Tailwind + Skeleton styling configured  
✅ Basic pages (Home, About) with consistent design  
✅ Dark/light mode toggle working  

**🎓 Skills Learned:**
- Modern JavaScript framework (SvelteKit)
- Utility-first CSS (Tailwind)
- Component architecture
- Responsive design principles
- Build tools and development workflow

---

## Phase 2: Content Management System
*Estimated time: 6-8 hours*

### Goals
- Set up headless CMS for content management
- Learn structured content and schemas
- Build dynamic pages that fetch data

### Why a CMS?
**Without CMS:** Content is hardcoded in components — updating requires code changes and deployments.

**With CMS:** Content is stored in a database — non-technical users can update content through a visual interface.

#### 2.1 Set Up Sanity CMS
```bash
# Install Sanity
npm install @sanity/client @sanity/image-url

# Create Sanity project (run in separate terminal)
npm create sanity@latest
cd my-sanity-studio
npm run dev
```

**Key Learnings:**
- **Headless CMS** — backend-only content management, separate from frontend
- **Structured content** — content is data (not HTML), can be used anywhere
- **Sanity Studio** — admin interface for managing content

#### 2.2 Define Content Schemas

Create schemas for different content types:

`schemas/gallery.ts`:
```typescript
export default defineType({
  name: 'gallery',
  title: 'Gallery',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Title', 
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' }
    },
    {
      name: 'images',
      title: 'Images',
      type: 'array',
      of: [
        {
          type: 'image',
          options: { hotspot: true }, // Enable crop/focal point
          fields: [
            {
              name: 'alt',
              title: 'Alt Text',
              type: 'string'
            }
          ]
        }
      ]
    }
  ]
})
```

**Key Learnings:**
- **Schema design** — define structure before building UI
- **Field types** — text, images, arrays, references between content
- **Validation** — ensure required fields and data integrity
- **SEO considerations** — alt text, slugs, meta descriptions

#### 2.3 Connect Frontend to CMS

Create Sanity client in `src/lib/sanity/client.ts`:
```typescript
import { createClient } from '@sanity/client';

export const client = createClient({
  projectId: 'your-project-id',
  dataset: 'production',
  useCdn: true, // Use CDN for production
  apiVersion: '2024-01-01'
});

// Helper function to fetch galleries
export async function getGalleries() {
  return await client.fetch(`
    *[_type == "gallery"] | order(_createdAt desc) {
      title,
      slug,
      "imageCount": count(images)
    }
  `);
}
```

**Key Learnings:**
- **Environment variables** — keep project IDs and API keys secure
- **GROQ queries** — Sanity's query language (similar to GraphQL)
- **Data fetching patterns** — server-side vs. client-side data loading

#### 2.4 Build Dynamic Routes

Create `src/routes/gallery/+page.server.ts`:
```typescript
import { getGalleries } from '$lib/sanity/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const galleries = await getGalleries();
  
  return {
    galleries
  };
};
```

Create `src/routes/gallery/+page.svelte`:
```svelte
<script lang="ts">
  let { data } = $props();
</script>

<h1>Gallery</h1>
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {#each data.galleries as gallery}
    <a 
      href="/gallery/{gallery.slug.current}"
      class="group block p-4 border rounded-lg hover:border-primary-500"
    >
      <h3 class="font-bold mb-2">{gallery.title}</h3>
      <p class="text-sm opacity-75">{gallery.imageCount} images</p>
    </a>
  {/each}
</div>
```

**Key Learnings:**
- **SvelteKit data loading** — `+page.server.ts` files run on server
- **TypeScript integration** — generated types for props and data
- **Dynamic routing** — `[slug]` creates pages for any URL parameter

### Phase 2 Deliverables
✅ Sanity CMS configured with custom schemas  
✅ Content types: Gallery, Product, Blog Post, About Page  
✅ Dynamic pages that fetch and display CMS content  
✅ Image handling with responsive optimization  
✅ Admin interface for content management  

**🎓 Skills Learned:**
- Headless CMS architecture
- Schema design and structured content
- Server-side data loading
- Dynamic routing and parameters
- GROQ/GraphQL query languages

---

## Phase 3: Advanced UI & Interactions
*Estimated time: 8-10 hours*

### Goals
- Build rich interactive components
- Master responsive design patterns
- Create polished user experiences

#### 3.1 Image Gallery with Lightbox

Build a masonry gallery layout:

`src/routes/gallery/[slug]/+page.svelte`:
```svelte
<script lang="ts">
  let { data } = $props();
  
  let selectedImage = $state(null);
  let lightboxOpen = $state(false);
  
  function openLightbox(image, index) {
    selectedImage = { ...image, index };
    lightboxOpen = true;
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape') lightboxOpen = false;
    if (event.key === 'ArrowLeft') showPrevious();
    if (event.key === 'ArrowRight') showNext();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Masonry Grid -->
<div class="columns-2 md:columns-3 lg:columns-4 gap-4">
  {#each data.gallery.images as image, i}
    <button 
      class="block w-full mb-4 group"
      onclick={() => openLightbox(image, i)}
    >
      <img 
        src={urlFor(image).width(400).url()}
        alt={image.alt}
        class="w-full rounded-lg shadow-lg group-hover:shadow-xl transition-shadow"
      />
    </button>
  {/each}
</div>

<!-- Lightbox Modal -->
{#if lightboxOpen}
  <div class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center">
    <img 
      src={urlFor(selectedImage).width(1200).url()}
      alt={selectedImage.alt}
      class="max-w-[90vw] max-h-[90vh] object-contain"
    />
  </div>
{/if}
```

**Key Learnings:**
- **Event handling** — modern `onclick` syntax, keyboard navigation
- **State management** — `$state()` for reactive variables, `$props()` for component props
- **Modal patterns** — overlays, z-index, accessibility
- **Image optimization** — responsive images, lazy loading
- **CSS layouts** — masonry columns, flexbox, grid

#### 3.2 Theme Switching System

Create a theme store and switcher:

`src/lib/stores/theme.ts`:
```typescript
import { browser } from '$app/environment';

// Initialize from localStorage or system preference
function createThemeStore() {
  const stored = browser && localStorage.getItem('theme');
  const prefersDark = browser && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = stored ? stored === 'dark' : prefersDark;
  
  let isDark = $state(initialTheme);
  
  // Update HTML class and localStorage when theme changes
  $effect(() => {
    if (browser) {
      document.documentElement.classList.toggle('dark', isDark);
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }
  });
  
  return {
    get isDark() { return isDark; },
    setDark: () => isDark = true,
    setLight: () => isDark = false,
    toggle: () => isDark = !isDark
  };
}

export const themeStore = createThemeStore();
```

**Using the theme store in components:**
```svelte
<script>
  import { themeStore } from '$lib/stores/theme';
</script>

<!-- Toggle button -->
<button onclick={() => themeStore.toggle()}>
  {themeStore.isDark ? '☀️ Light' : '🌙 Dark'}
</button>

<!-- Conditional rendering -->
{#if themeStore.isDark}
  <span>🌙 Dark mode active</span>
{:else}
  <span>☀️ Light mode active</span>
{/if}
```

**Key Learnings:**
- **Svelte 5 runes** — `$state()` for reactive variables, `$effect()` for side effects
- **Browser detection** — checking if code runs on client or server
- **Persistent state** — localStorage for user preferences
- **CSS class manipulation** — controlling dark mode with JavaScript
- **Reactive programming** — automatic updates when data changes

#### 3.3 Advanced Styling Techniques

Create a comprehensive styling system:

`src/lib/styles/global.css`:
```css
/* Theme-aware background gradients */
body {
  text-transform: lowercase;
  background-color: #f1f5f9;
  background-image: 
    radial-gradient(ellipse 80% 60% at 30% 20%, rgba(99, 102, 241, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 60% 80% at 80% 70%, rgba(139, 92, 246, 0.06) 0%, transparent 50%);
  background-attachment: fixed;
}

html.dark body {
  background-color: #1e293b;
  background-image: 
    radial-gradient(ellipse 80% 60% at 30% 20%, rgba(129, 140, 248, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse 60% 80% at 80% 70%, rgba(167, 139, 250, 0.08) 0%, transparent 50%);
}

/* Consistent card styling */
.card {
  @apply bg-surface-500/10 border border-surface-500/20 rounded-lg p-4;
  @apply hover:border-surface-400/40 transition-all duration-200;
}

/* Typography hierarchy */
h1, h2, h3, h4, h5, h6 {
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

/* Mobile-first responsive adjustments */
@media (min-width: 768px) {
  body {
    background-image: 
      radial-gradient(ellipse 80% 60% at 30% 20%, rgba(99, 102, 241, 0.12) 0%, transparent 50%),
      radial-gradient(ellipse 60% 80% at 80% 70%, rgba(139, 92, 246, 0.08) 0%, transparent 50%);
  }
}
```

**Key Learnings:**
- **Advanced CSS** — gradients, custom properties, responsive design
- **Design systems** — consistent spacing, colors, typography
- **Performance considerations** — when to use CSS vs. JavaScript
- **Accessibility** — color contrast, focus states, semantic HTML

### Phase 3 Deliverables
✅ Interactive image gallery with keyboard navigation  
✅ Responsive masonry layouts  
✅ Theme switching with persistent preferences  
✅ Advanced CSS animations and transitions  
✅ Accessible modal and form components  
✅ Mobile-first responsive design throughout  

**🎓 Skills Learned:**
- Advanced JavaScript/TypeScript patterns
- State management and reactive programming  
- Complex CSS layouts and animations
- User experience design principles
- Accessibility best practices
- Performance optimization techniques

---

## Phase 4: E-Commerce Integration
*Estimated time: 10-12 hours*

### Goals
- Integrate secure payment processing
- Build product catalog and checkout flow
- Handle different payment scenarios

### Why Stripe?
- **Security** — PCI compliance handled for you
- **Global** — supports many payment methods and currencies  
- **Developer experience** — excellent documentation and tools
- **Reliability** — battle-tested at scale

#### 4.1 Product Management Setup

Add product schema to Sanity:

`schemas/product.ts`:
```typescript
export default defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Product Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' }
    },
    {
      name: 'price',
      title: 'Price (USD)',
      type: 'number',
      validation: Rule => Rule.required().positive()
    },
    {
      name: 'images',
      title: 'Product Images',
      type: 'array',
      of: [{ type: 'image', options: { hotspot: true } }]
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text'
    },
    {
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {
        list: [
          { title: 'Prints', value: 'prints' },
          { title: 'Tapestries', value: 'tapestries' },
          { title: 'Postcards', value: 'postcards' }
        ]
      }
    },
    {
      name: 'inStock',
      title: 'In Stock',
      type: 'boolean',
      initialValue: true
    }
  ]
})
```

#### 4.2 Stripe Integration Setup

```bash
npm install stripe
```

Set up environment variables:
```bash
# .env (never commit to git)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLIC_KEY=pk_test_...
PUBLIC_SITE_URL=http://localhost:5173
```

#### 4.3 Server-Side Checkout API

Create `src/routes/api/checkout/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';
import { PUBLIC_SITE_URL } from '$env/static/public';

const stripe = new Stripe(STRIPE_SECRET_KEY);

export async function POST({ request }) {
  try {
    const { productId, title, price, image } = await request.json();

    // Input validation
    if (!productId || !title || !price) {
      throw error(400, 'Missing required fields');
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      
      // Collect shipping address
      shipping_address_collection: {
        allowed_countries: ['US'], // Expand as needed
      },
      
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: title,
            images: image ? [image] : [],
          },
          // CRITICAL: Stripe uses cents!
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      }],
      
      mode: 'payment',
      success_url: `${PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_SITE_URL}/checkout/cancel`,
      
      // Attach metadata for tracking
      metadata: { productId },
    });

    return json({ 
      sessionId: session.id, 
      url: session.url 
    });
    
  } catch (err) {
    console.error('Stripe checkout error:', err);
    throw error(500, 'Failed to create checkout session');
  }
}
```

**Key Learnings:**
- **Server-side security** — never expose secret keys to client
- **Input validation** — always validate user data
- **Error handling** — graceful failures with helpful messages
- **Stripe cents** — all amounts are in smallest currency unit
- **Metadata** — attach custom data to track orders

#### 4.4 Frontend Checkout Integration

Create product page with Buy Now button:

`src/routes/shop/[slug]/+page.svelte`:
```svelte
<script lang="ts">
  let { data } = $props();
  
  let loading = $state(false);
  
  async function handleBuyNow() {
    loading = true;
    
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: data.product.slug.current,
          title: data.product.title,
          price: data.product.price,
          image: data.product.images?.[0] ? urlFor(data.product.images[0]).width(500).url() : null
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }
      
      const { url } = await response.json();
      
      // Redirect to Stripe Checkout
      window.location.href = url;
      
    } catch (err) {
      alert('Sorry, something went wrong. Please try again.');
      console.error('Checkout error:', err);
    } finally {
      loading = false;
    }
  }
</script>

<div class="max-w-4xl mx-auto px-4 py-8">
  <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
    <!-- Product Images -->
    <div>
      {#if data.product.images?.[0]}
        <img 
          src={urlFor(data.product.images[0]).width(600).url()}
          alt={data.product.title}
          class="w-full rounded-lg"
        />
      {/if}
    </div>
    
    <!-- Product Details -->
    <div>
      <h1 class="text-3xl font-bold mb-4">{data.product.title}</h1>
      <p class="text-2xl font-bold mb-6">${data.product.price}</p>
      
      {#if data.product.description}
        <p class="mb-6 leading-relaxed">{data.product.description}</p>
      {/if}
      
      {#if data.product.inStock}
        <button 
          class="btn variant-filled-primary w-full md:w-auto px-8 py-3"
          onclick={handleBuyNow}
          disabled={loading}
        >
          {loading ? 'Processing...' : 'Buy Now'}
        </button>
      {:else}
        <div class="bg-surface-500/10 border border-surface-500/20 rounded-lg p-4">
          <p class="text-error-500 font-medium">Currently out of stock</p>
        </div>
      {/if}
    </div>
  </div>
</div>
```

**Key Learnings:**
- **Async JavaScript** — handling API calls with async/await
- **Loading states** — showing feedback during network requests
- **Error handling** — graceful fallbacks for failed operations
- **User experience** — preventing double-clicks, showing progress
- **Conditional rendering** — different UI based on data state

#### 4.5 Post-Purchase Pages

Create success and cancel pages:

`src/routes/checkout/success/+page.svelte`:
```svelte
<script lang="ts">
  import { page } from '$app/stores';
  
  // Get session ID from URL parameter
  const sessionId = $page.url.searchParams.get('session_id');
</script>

<div class="max-w-2xl mx-auto px-4 py-16 text-center">
  <div class="bg-success-500/10 border border-success-500/20 rounded-lg p-8 mb-8">
    <h1 class="text-3xl font-bold text-success-600 mb-4">Thank You!</h1>
    <p class="text-lg mb-4">Your order has been successfully processed.</p>
    
    {#if sessionId}
      <p class="text-sm opacity-75">Order ID: {sessionId}</p>
    {/if}
  </div>
  
  <div class="prose prose-sm mx-auto mb-8">
    <h2>What happens next?</h2>
    <ul>
      <li>You'll receive a confirmation email shortly</li>
      <li>Your order will be processed within 1-2 business days</li>
      <li>Made-to-order items typically ship within 2 weeks</li>
      <li>You'll receive tracking information once shipped</li>
    </ul>
  </div>
  
  <a href="/shop" class="btn variant-soft-primary">
    Continue Shopping
  </a>
</div>
```

**Key Learnings:**
- **URL parameters** — reading data from query strings
- **User communication** — clear next steps and expectations
- **Trust building** — professional follow-up processes
- **Navigation flow** — guiding users back to your site

### Phase 4 Deliverables
✅ Complete product catalog with filtering  
✅ Secure checkout flow with Stripe  
✅ Inventory management (in stock / out of stock)  
✅ Post-purchase success and cancellation pages  
✅ Error handling for payment failures  
✅ Mobile-optimized checkout experience  

**🎓 Skills Learned:**
- Payment processing and e-commerce patterns
- API design and server-side programming
- Security best practices (PCI compliance)
- Advanced error handling and user feedback
- Integration with third-party services
- Money handling (currency, taxes, international)

---

## Phase 5: Email Automation & Webhooks
*Estimated time: 6-8 hours*

### Goals
- Set up automated email notifications
- Handle real-time payment events
- Create reliable order processing

### The Problem
Currently, when someone buys something:
1. ✅ Customer gets charged successfully  
2. ✅ Customer sees success page  
3. ❌ **You** only find out by checking Stripe Dashboard manually  
4. ❌ Customer gets no email receipt  
5. ❌ No automatic order processing

### The Solution: Webhooks
**Webhooks** are HTTP callbacks that Stripe sends to your server when events happen. Think of them as "push notifications" for servers.

#### 5.1 Email Service Setup

```bash
npm install resend
```

Set up email service:
```bash
# Add to .env
RESEND_API_KEY=re_...
```

#### 5.2 Webhook Endpoint Creation

Create `src/routes/api/webhooks/stripe/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { Resend } from 'resend';
import { 
  STRIPE_SECRET_KEY, 
  STRIPE_WEBHOOK_SECRET, 
  RESEND_API_KEY 
} from '$env/static/private';

const stripe = new Stripe(STRIPE_SECRET_KEY);
const resend = new Resend(RESEND_API_KEY);

export async function POST({ request }) {
  // Get raw body and signature
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    throw error(400, 'Missing stripe-signature header');
  }

  let event: Stripe.Event;

  try {
    // 🔒 CRITICAL: Verify webhook came from Stripe
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    throw error(400, `Webhook Error: ${err.message}`);
  }

  console.log(`Received webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // ✅ Customer successfully completed payment
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      
      case 'payment_intent.payment_failed': {
        // ❌ Payment was attempted but failed
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log('Payment failed:', paymentIntent.id);
        // Could send failure notification email here
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return json({ received: true });

  } catch (err) {
    console.error('Error processing webhook:', err);
    throw error(500, 'Webhook processing failed');
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('Processing completed checkout:', session.id);

  try {
    // Get full session data
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'customer_details']
    });

    const customerEmail = fullSession.customer_details?.email;
    const shippingDetails = session.collected_information?.shipping_details;
    const lineItems = fullSession.line_items?.data || [];

    if (!customerEmail) {
      console.error('No customer email found for session:', session.id);
      return;
    }

    // Send customer confirmation email
    await sendCustomerConfirmation({
      session: fullSession,
      customerEmail,
      shippingDetails,
      lineItems
    });

    // Send admin notification email
    await sendAdminNotification({
      session: fullSession,
      customerEmail,
      shippingDetails,
      lineItems
    });

    console.log('Emails sent successfully for session:', session.id);

  } catch (err) {
    console.error('Error in handleCheckoutCompleted:', err);
    throw err;
  }
}

async function sendCustomerConfirmation({ session, customerEmail, shippingDetails, lineItems }) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  const itemsList = lineItems.map(item => 
    `• ${item.description} (${item.quantity}x) - ${formatCurrency(item.amount_total)}`
  ).join('\n');

  const shippingAddress = shippingDetails?.address ? `
${shippingDetails.name}
${shippingDetails.address.line1}
${shippingDetails.address.line2 || ''}
${shippingDetails.address.city}, ${shippingDetails.address.state} ${shippingDetails.address.postal_code}
${shippingDetails.address.country}`.trim() : 'No shipping address';

  const emailContent = `
Hi ${shippingDetails?.name || 'there'},

Thank you for your order! Your payment has been successfully processed.

ORDER DETAILS
Order ID: ${session.id}
Total: ${formatCurrency(session.amount_total || 0)}

ITEMS ORDERED
${itemsList}

SHIPPING ADDRESS
${shippingAddress}

WHAT'S NEXT?
• Your order will be processed within 1-2 business days
• Made-to-order prints typically ship within 2 weeks  
• You'll receive tracking information once your order ships
• If you have any questions, just reply to this email

Thank you for your support!

Best regards,
Your Store
  `.trim();

  await resend.emails.send({
    from: 'Your Store <orders@yourdomain.com>',
    to: [customerEmail],
    subject: `Order Confirmation - ${session.id}`,
    text: emailContent,
  });
}

async function sendAdminNotification({ session, customerEmail, shippingDetails, lineItems }) {
  // Similar email but focused on fulfillment details for you
  // Include link to Stripe Dashboard, customer details, etc.
}
```

#### 5.3 Webhook Configuration

**In Stripe Dashboard:**
1. Go to Webhooks → Add Endpoint  
2. Set URL: `https://yourdomain.com/api/webhooks/stripe`
3. Select events: `checkout.session.completed`
4. Copy the **signing secret** (starts with `whsec_`)

**Add to environment:**
```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

#### 5.4 Local Testing Setup

```bash
# Install Stripe CLI
# https://stripe.com/docs/cli

# Login to Stripe
stripe login

# Forward webhooks to local dev server
stripe listen --forward-to localhost:5173/api/webhooks/stripe

# Test specific events
stripe trigger checkout.session.completed
```

**Key Learnings:**
- **Webhook security** — cryptographic verification prevents fake events
- **Event-driven architecture** — responding to external system events
- **Email automation** — transactional vs. marketing emails
- **Testing webhooks** — simulating production scenarios locally
- **Error handling** — webhooks must be reliable and idempotent

### Phase 5 Deliverables
✅ Automated customer confirmation emails  
✅ Admin notification system for new orders  
✅ Webhook signature verification for security  
✅ Local testing setup with Stripe CLI  
✅ Comprehensive error handling and logging  
✅ Professional email templates  

**🎓 Skills Learned:**
- Event-driven programming and webhooks
- Email automation and transactional messaging  
- Security patterns (signature verification)
- Third-party API integration testing
- Production monitoring and debugging
- Customer communication workflows

---

## Phase 6: Production Deployment
*Estimated time: 4-6 hours*

### Goals
- Deploy to production hosting
- Set up automated deployments  
- Configure environment variables securely
- Monitor and maintain the application

#### 6.1 Vercel Deployment Setup

**Why Vercel?**
- **Automatic deployments** — git push triggers builds
- **Serverless functions** — your API routes become AWS Lambda functions
- **Global CDN** — fast loading worldwide
- **Environment variables** — secure secret management
- **Preview deployments** — test branches before merging

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from your project directory
vercel

# Follow prompts to link GitHub repo
```

#### 6.2 Environment Variables Configuration

**In Vercel Dashboard:**
1. Go to Project → Settings → Environment Variables
2. Add all environment variables:

```bash
# Production values (different from dev!)
STRIPE_SECRET_KEY=sk_live_...           # Live key (not test)
STRIPE_PUBLIC_KEY=pk_live_...           # Live key (not test)  
STRIPE_WEBHOOK_SECRET=whsec_...         # Production webhook secret
RESEND_API_KEY=re_...                   # Production API key
PUBLIC_SANITY_PROJECT_ID=your-id        # Same as dev
PUBLIC_SANITY_DATASET=production        # Production dataset
PUBLIC_SITE_URL=https://yourdomain.com  # Production URL
```

**Security Notes:**
- ✅ Mark sensitive keys as "Sensitive" in Vercel
- ✅ Use different Stripe keys for production vs. development
- ✅ Never commit secrets to git
- ✅ Rotate keys if accidentally exposed

#### 6.3 Custom Domain Setup

**In Vercel Dashboard:**
1. Go to Project → Settings → Domains
2. Add your domain (e.g., `yourdomain.com`)  
3. Configure DNS records as instructed
4. SSL certificates are automatically provisioned

**DNS Configuration:**
```
CNAME    www    cname.vercel-dns.com
ALIAS    @      alias.vercel-dns.com  
```

#### 6.4 Production Webhook Setup

**Update webhook URL in Stripe Dashboard:**
- **Development:** `https://ngrok-url.ngrok.io/api/webhooks/stripe`
- **Production:** `https://yourdomain.com/api/webhooks/stripe`

**Test production webhook:**
1. Make a real purchase with a test card
2. Check Vercel function logs for webhook execution
3. Verify emails are sent successfully
4. Check Stripe Dashboard for delivery status

#### 6.5 Monitoring & Analytics

**Vercel Analytics:**
```bash
npm install @vercel/analytics

# Add to app.html
<script>
  import { inject } from '@vercel/analytics';
  inject();
</script>
```

**Error Monitoring:**
- **Vercel Functions:** Built-in error tracking
- **Client-side:** Consider Sentry for comprehensive error tracking
- **Email delivery:** Monitor Resend dashboard for bounce rates

**Performance Monitoring:**
- **Core Web Vitals** — automatic in Vercel
- **Lighthouse scores** — run regularly  
- **Image optimization** — ensure Sanity images are optimized

#### 6.6 Backup & Security

**Content Backup:**
- **Sanity:** Automatic backups included
- **Code:** Git repository serves as backup
- **Environment variables:** Document in secure location

**Security Checklist:**
- ✅ All API keys are in environment variables
- ✅ Webhook signatures are verified  
- ✅ HTTPS enforced (automatic with Vercel)
- ✅ Input validation on all API endpoints
- ✅ Rate limiting considered for public APIs
- ✅ Error messages don't expose sensitive data

### Phase 6 Deliverables
✅ Production deployment on custom domain  
✅ Automated deployments from git repository  
✅ All environment variables configured securely  
✅ SSL certificates and HTTPS enforced  
✅ Webhook endpoints working in production  
✅ Monitoring and error tracking set up  
✅ Backup and security measures implemented  

**🎓 Skills Learned:**
- Production deployment and DevOps
- Environment management and security
- DNS configuration and domain management  
- Monitoring and observability
- Performance optimization
- Security best practices

---

## Phase 7: Business Operations & Growth
*Estimated time: Ongoing*

### Goals
- Create sustainable business processes
- Implement growth and optimization strategies  
- Build long-term maintenance workflows

#### 7.1 Order Management System

**Current State:** You receive email notifications but manage orders manually.

**Enhanced System:**
```typescript
// Add to Sanity schema: orders.ts
export default defineType({
  name: 'order',
  title: 'Order',
  type: 'document',
  fields: [
    {
      name: 'stripeSessionId',
      title: 'Stripe Session ID',
      type: 'string',
    },
    {
      name: 'customerEmail',
      title: 'Customer Email',
      type: 'string',
    },
    {
      name: 'total',
      title: 'Total Amount',
      type: 'number',
    },
    {
      name: 'status',
      title: 'Order Status',
      type: 'string',
      options: {
        list: [
          { title: 'New', value: 'new' },
          { title: 'Processing', value: 'processing' },
          { title: 'Shipped', value: 'shipped' },
          { title: 'Delivered', value: 'delivered' },
          { title: 'Cancelled', value: 'cancelled' }
        ]
      },
      initialValue: 'new'
    },
    {
      name: 'trackingNumber',
      title: 'Tracking Number',
      type: 'string',
    }
  ]
});
```

**Enhanced webhook to create orders:**
```typescript
// In webhook handler
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // ... existing email logic ...
  
  // Create order record in Sanity
  const order = {
    _type: 'order',
    stripeSessionId: session.id,
    customerEmail: fullSession.customer_details?.email,
    total: session.amount_total,
    status: 'new',
    orderDate: new Date().toISOString(),
    // ... other fields
  };
  
  await sanityClient.create(order);
}
```

#### 7.2 Inventory Management

**Automatic Stock Updates:**
```typescript
// In webhook, after successful payment
async function updateInventory(productId: string) {
  const product = await sanityClient
    .patch(productId)
    .dec({ stock: 1 })  // Decrease stock by 1
    .commit();
    
  if (product.stock <= 0) {
    // Send low stock alert
    await sendLowStockAlert(product);
  }
}
```

**Low Stock Notifications:**
- Automatic emails when inventory runs low
- Admin dashboard showing stock levels
- Ability to mark items as "made to order" vs. "in stock"

#### 7.3 Customer Analytics

**Order Analytics Dashboard:**
```typescript
// Analytics queries
const analytics = {
  totalRevenue: await sanityClient.fetch(`
    sum(*[_type == "order" && status != "cancelled"].total)
  `),
  
  ordersByMonth: await sanityClient.fetch(`
    *[_type == "order"] {
      "month": dateTime(_createdAt).month,
      "revenue": total
    } | group_by(month)
  `),
  
  topProducts: await sanityClient.fetch(`
    *[_type == "product"] {
      title,
      "sales": count(*[_type == "order" && references(^._id)])
    } | order(sales desc)
  `)
};
```

#### 7.4 SEO & Marketing

**Search Engine Optimization:**
```svelte
<!-- In +page.svelte files -->
<svelte:head>
  <title>{product.title} | Your Store</title>
  <meta name="description" content={product.description} />
  <meta property="og:title" content={product.title} />
  <meta property="og:description" content={product.description} />
  <meta property="og:image" content={productImageUrl} />
  <meta property="og:url" content="https://yourdomain.com/shop/{product.slug.current}" />
</svelte:head>
```

**Email Marketing Integration:**
- Collect emails during checkout
- Send welcome series to new customers  
- Product announcement emails
- Abandoned cart recovery (requires more complex setup)

#### 7.5 Performance Optimization

**Image Optimization:**
```typescript
// Sanity image URLs with optimization
const imageUrl = urlFor(image)
  .width(800)
  .height(600) 
  .format('webp')
  .quality(85)
  .url();
```

**Caching Strategies:**
```typescript
// In +page.server.ts
export const load: PageServerLoad = async ({ setHeaders }) => {
  // Cache for 1 hour
  setHeaders({
    'cache-control': 'public, max-age=3600'
  });
  
  return {
    products: await getProducts()
  };
};
```

**Performance Monitoring:**
- Core Web Vitals tracking
- Regular Lighthouse audits
- Image loading performance  
- API response times

#### 7.6 Customer Support

**Help Documentation:**
- Shipping and returns policy
- Size guides and product care
- FAQ section
- Contact form improvements

**Customer Communication:**
- Shipping confirmation emails
- Delivery notifications
- Order status updates
- Request for reviews/feedback

### Phase 7 Deliverables
✅ Comprehensive order management system  
✅ Automated inventory tracking and alerts  
✅ Customer analytics and reporting  
✅ SEO optimization across all pages  
✅ Performance monitoring and optimization  
✅ Customer support documentation and workflows  

**🎓 Skills Learned:**
- Business process automation
- Data analytics and reporting
- Search engine optimization (SEO)
- Customer relationship management  
- Performance monitoring and optimization
- Long-term system maintenance

---

## 🎯 Final Architecture Overview

After completing all phases, you'll have built:

```
┌─ Frontend (SvelteKit) ─────────────────────────────┐
│  • Dynamic pages with file-based routing          │
│  • Responsive design with Tailwind CSS            │  
│  • Interactive components (lightbox, forms)       │
│  • Theme switching and user preferences           │
│  • TypeScript for type safety                     │
└────────────────────────────────────────────────────┘
                            ↓
┌─ Content Management (Sanity) ──────────────────────┐
│  • Structured content with custom schemas         │
│  • Visual editor for non-technical users          │
│  • Image optimization and transformation          │
│  • Real-time content updates                      │
│  • Content versioning and collaboration           │
└────────────────────────────────────────────────────┘
                            ↓
┌─ E-Commerce (Stripe) ──────────────────────────────┐
│  • Secure payment processing                      │
│  • Multi-payment method support                   │
│  • Subscription billing capabilities              │
│  • International currency support                 │
│  • Comprehensive fraud protection                 │
└────────────────────────────────────────────────────┘
                            ↓
┌─ Email Automation (Resend + Webhooks) ─────────────┐
│  • Real-time order notifications                  │
│  • Customer confirmation emails                   │
│  • Admin alerts and reporting                     │
│  • Transactional email templates                  │
│  • Delivery tracking and analytics                │
└────────────────────────────────────────────────────┘
                            ↓
┌─ Production Hosting (Vercel) ──────────────────────┐
│  • Serverless function deployment                 │
│  • Global CDN for fast loading                    │
│  • Automatic HTTPS and security                   │
│  • Environment variable management                │
│  • Continuous deployment from Git                 │
└────────────────────────────────────────────────────┘
```

---

## 📚 Complete Technical Reference

### Essential Documentation Created

During this roadmap, you'll create comprehensive guides:

1. **[Stripe Webhooks Guide](guides/stripe-webhooks.md)** — Complete webhook implementation
2. **[Theme Switching Guide](guides/theme-switching.md)** — Dark/light mode system  
3. **[Tailwind & Global CSS Guide](guides/tailwind-and-global-css.md)** — Styling architecture
4. **[Complete App Roadmap](guides/complete-app-roadmap.md)** — This comprehensive guide

### Key Learning Resources

- **[SvelteKit Documentation](https://kit.svelte.dev/)** — Framework fundamentals
- **[Svelte 5 Runes Guide](https://svelte.dev/docs/svelte/overview)** — Modern reactive programming
- **[Tailwind CSS Documentation](https://tailwindcss.com/docs)** — Utility-first styling
- **[Stripe Documentation](https://stripe.com/docs)** — Payment processing
- **[Sanity Documentation](https://www.sanity.io/docs)** — Headless CMS
- **[Vercel Documentation](https://vercel.com/docs)** — Deployment and hosting

### Development Tools & CLI Commands

```bash
# SvelteKit development
npm run dev              # Start dev server
npm run build           # Build for production  
npm run preview         # Preview production build

# Stripe CLI tools  
stripe listen           # Forward webhooks to localhost
stripe trigger          # Simulate webhook events
stripe logs tail        # Monitor real-time events

# Vercel deployment
vercel                  # Deploy to preview
vercel --prod          # Deploy to production
vercel logs            # View function logs

# Sanity CMS
npx sanity start       # Start studio dev server
npx sanity deploy      # Deploy studio to production
npx sanity dataset     # Manage datasets
```

---

## 🎓 Skills Mastery Checklist

By the end of this roadmap, you'll have hands-on experience with:

### Frontend Development
- ✅ **Modern JavaScript/TypeScript** — ES6+, async/await, modules
- ✅ **Svelte/SvelteKit** — Component-based architecture, reactive programming
- ✅ **Responsive Design** — Mobile-first, CSS Grid, Flexbox
- ✅ **State Management** — Stores, reactive data, user preferences
- ✅ **Performance Optimization** — Image loading, caching, Core Web Vitals

### Backend Development  
- ✅ **API Design** — RESTful endpoints, request/response handling
- ✅ **Database Integration** — Headless CMS, structured content
- ✅ **Authentication & Security** — API keys, webhook verification
- ✅ **Third-party Integrations** — Stripe, email services, external APIs
- ✅ **Error Handling** — Graceful failures, logging, monitoring

### DevOps & Production
- ✅ **Version Control** — Git workflows, branching strategies
- ✅ **Environment Management** — Development vs. production configurations
- ✅ **Deployment Automation** — CI/CD pipelines, serverless functions
- ✅ **Monitoring & Analytics** — Error tracking, performance metrics
- ✅ **Security Best Practices** — Secret management, HTTPS, input validation

### Business Operations
- ✅ **E-commerce Fundamentals** — Payment processing, order management
- ✅ **Email Marketing** — Transactional emails, customer communication
- ✅ **SEO & Marketing** — Search optimization, social media integration
- ✅ **Analytics & Reporting** — Customer insights, revenue tracking
- ✅ **Customer Support** — Documentation, help systems, feedback loops

---

## 🚀 Next Steps & Advanced Topics

### Immediate Enhancements (Week 1-2)
- **Custom 404/Error Pages** — Better user experience for broken links
- **Search Functionality** — Product and content search across the site
- **Related Products** — "You might also like" recommendations
- **Product Reviews** — Customer feedback and ratings system

### Medium-term Growth (Month 1-3)
- **Multi-language Support** — International customer base
- **Subscription Products** — Recurring billing for services/memberships  
- **Advanced Analytics** — Custom dashboards, cohort analysis
- **Mobile App** — Progressive Web App (PWA) or native mobile app
- **Social Media Integration** — Instagram feed, social sharing

### Long-term Evolution (Month 3-12)
- **Marketplace Features** — Multi-vendor platform, commission system
- **Advanced Personalization** — AI-powered recommendations
- **Fulfillment Integration** — Third-party logistics, drop-shipping
- **Customer Portal** — Account management, order history, preferences
- **Advanced Marketing** — Email sequences, loyalty programs, affiliate system

### Technical Deep Dives
- **Database Optimization** — Query performance, caching strategies
- **Microservices Architecture** — Breaking monolith into smaller services
- **Real-time Features** — Live chat, notifications, collaborative editing
- **Testing Strategy** — Unit tests, integration tests, E2E testing  
- **Accessibility** — WCAG compliance, screen reader support

---

## 💡 Key Takeaways

### What Makes This Approach Effective

1. **Progressive Complexity** — Start simple, add features incrementally
2. **Real-world Application** — Every feature solves actual business needs
3. **Comprehensive Documentation** — Learn by doing, document for the future
4. **Modern Best Practices** — Current tools and patterns, not outdated techniques
5. **Full-stack Understanding** — Frontend, backend, and business operations

### Most Valuable Skills Learned

1. **System Architecture** — How to design scalable, maintainable applications
2. **Integration Patterns** — Connecting multiple services and APIs reliably  
3. **User Experience Design** — Building interfaces that customers love to use
4. **Business Process Automation** — Reducing manual work through smart workflows
5. **Production Operations** — Deploying, monitoring, and maintaining live systems

### Common Pitfalls Avoided

1. **Over-engineering** — Building only what you need, when you need it
2. **Vendor Lock-in** — Choosing tools that provide flexibility and exit strategies
3. **Security Vulnerabilities** — Following security best practices from day one
4. **Performance Issues** — Considering performance implications of architectural decisions
5. **Technical Debt** — Writing clean, documented code that future-you will thank you for

---

## 🎉 Congratulations!

If you've followed this roadmap to completion, you've built more than just a website — you've created a **complete digital business platform** with:

- **Professional frontend** that works beautifully on all devices
- **Flexible content management** that non-technical users can manage
- **Secure e-commerce functionality** that handles real money safely
- **Automated business processes** that save time and reduce errors
- **Production-ready deployment** that can scale with your business growth
- **Comprehensive monitoring** to maintain reliability and performance

**Most importantly**, you now have the knowledge and confidence to build complex web applications from scratch, integrate with modern services, and create solutions that solve real business problems.

**This is just the beginning.** The web development landscape is constantly evolving, but the fundamental principles you've learned — good architecture, security awareness, user-centered design, and systematic problem-solving — will serve you well regardless of which specific tools and frameworks you use in the future.

---

*Built with curiosity and attention to detail. All code and concepts are educational — feel free to learn from, adapt, and improve upon them.*

**Happy building! 🚀**