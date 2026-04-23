# Angel's Rest

A personal portfolio and creative studio website for Jesse Pomeroy — photographer, visual artist, florist, and web developer.

**🎓 Educational Resource:** This project includes comprehensive documentation showing how to build a modern web application from scratch. See the [Complete App Roadmap](guides/complete-app-roadmap.md) for a full tutorial covering SvelteKit, Stripe e-commerce, email automation, and production deployment.

**Live:** [angelsrest.online](https://angelsrest.online) ✨

## What It Is

Angel's Rest showcases Jesse's multidisciplinary creative work through a thoughtfully designed digital experience. The site combines photography portfolio, art gallery, blog, and e-commerce in one cohesive platform.

## ✨ Special Features

### 🕐 Time-Aware Theming
The site subtly shifts its color palette based on your local time of day:
- **Dawn** (5-8am): Soft pink and coral warmth
- **Morning** (8am-12pm): Bright, clear yellows  
- **Afternoon** (12-5pm): Warm amber baseline
- **Golden Hour** (5-8pm): Rich orange and honey tones
- **Evening** (8-10pm): Deep purple and violet
- **Night** (10pm-5am): Cool indigo and blue

The effect is subtle — like natural lighting shifting throughout the day.

### 🎨 ASCII Art Portrait
On the about page, hover over Jesse's portrait to watch it transform into animated ASCII art:
- Starts with scrambled random characters
- Gradually "settles" into the final portrait over 2 seconds
- Rendered to canvas for pixel-perfect alignment with the original image
- No layout shift or zoom — just pure magic

### 📱 Thoughtful UX
- **Mobile-first design** with bottom navigation that feels native
- **Instant theme switching** between light and dark modes
- **Smooth animations** and micro-interactions throughout
- **Typography-focused** with all-lowercase aesthetic

## Tech Highlights

**Frontend:** SvelteKit 5 (with runes), TypeScript, Tailwind CSS v4  
**Design:** Skeleton UI with Hamlindigo theme  
**Content:** Sanity CMS with real-time editing  
**Commerce:** Stripe checkout + automated email notifications via webhooks  
**Deployment:** Vercel with automatic deployments

## Content Areas

- **Gallery** — Photography portfolio with category filtering and lightbox modal
- **Shop** — Print sales with live Stripe checkout 
- **Blog** — Flexible blog with 5 template types for different content needs
- **About** — Bio, contact form, and that ASCII portrait trick

### 📝 Flexible Blog Templates

The blog supports multiple post types, each rendering with a unique visual layout:

| Post Type | Description | Template Fields |
|-----------|-------------|-----------------|
| **Standard** | Simple blog layout (default) | None |
| **Case Study** | Brief → Approach → Result structure | brief, approach, result |
| **Behind the Scenes** | Narrative, full-width images, serif font | None |
| **Technical** | Gear grid, monospace font | gearUsed array |
| **Client Story** | Wedding/event stories with hero header | brief, approach, result |

**Schema location:** `angelsrest-studio/schemaTypes/post.ts`  
**Template components:** `src/lib/components/templates/`  
**Rendering logic:** `src/routes/blog/[slug]/+page.svelte`

**To add a new template:**
1. Create component in `src/lib/components/templates/`
2. Import and add case in `+page.svelte`
3. Add entry to Sanity schema options
4. (Optional) Add template-specific fields with `hidden` property

## Creative Code

This project explores the intersection of art and web development:
- **Time as a design element** — the site feels alive and responsive to the natural rhythm of the day
- **Canvas manipulation** — generating and animating ASCII art in real-time  
- **Subtle interactions** — effects that enhance without overwhelming
- **Performance-conscious creativity** — all animations are GPU-accelerated and lightweight

## Local Development

```bash
# Clone and install
git clone [repo-url]
cd angelsrest
pnpm install

# Set up environment
cp .env.example .env
# Add your Sanity project ID, Stripe keys, etc.

# Run dev server
pnpm dev

# Run Sanity Studio (separate terminal)
cd angelsrest-studio
pnpm dev
```

## Technical Guides

**📂 `/guides/`** — Detailed technical documentation:

### 🎯 **[Complete App Roadmap](guides/complete-app-roadmap.md)**
**The ultimate guide** — A comprehensive 48,000+ word roadmap taking you from zero to a production web application. Covers everything from initial setup to advanced business operations, organized into 7 progressive phases. Perfect for learning full-stack development systematically.

### 📚 **Specialized Guides**
- **[Stripe Webhooks](guides/stripe-webhooks.md)** — Complete setup guide for automated email notifications
- **[Theme Switching](guides/theme-switching.md)** — How the time-aware theming system works  
- **[Tailwind & CSS](guides/tailwind-and-global-css.md)** — Custom CSS architecture and Tailwind v4 setup

## About Jesse

Multidisciplinary artist based in Michigan, working across photography, printmaking, floral design, and web development. Currently exploring how these creative practices intersect and inform each other.

**Contact:** Through the site's contact form or [Instagram](https://instagram.com/username)

---

*Built with curiosity and attention to detail. All code is educational — feel free to learn from it.*